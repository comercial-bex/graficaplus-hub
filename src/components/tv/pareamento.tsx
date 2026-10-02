import { useEffect, useRef, useState } from "react";
import { Icone } from "./icones";
import { Relogio } from "./relogio";
import { Qr } from "./qr";
import { MarcaETitulo } from "./tela-da-oficina";
import { gravarPedido, gravarToken, lerPedidoGuardado } from "./cracha";
import {
  ROTA_DAS_TELAS,
  ROTA_DE_PAREAMENTO,
  formatarCodigo,
  retiradaPedeNovoCodigo,
  segredoBemFormado,
  segundosRestantes,
  urlDeAprovacao,
  type EstadoDaRetirada,
  type PedidoDePareamento,
} from "@/domain/tv/pareamento";
import { horaMinuto } from "@/domain/tv/frescor";

/**
 * A TV sem crachá: mostra o CÓDIGO em letra de parede e o QR que leva o
 * código até /telas, onde um admin ou gestor aprova.
 *
 * O contrato (tv-parear.server.ts), seguido à risca:
 *   {acao:"novo"}     200 → guardar o pedido em localStorage e REAPROVEITAR
 *                     SEMPRE (recarga, queda de luz); 429 → esperar o tempo
 *                     que o servidor pediu, sem pedir em laço; 503 → esperar
 *                     e tentar de novo.
 *   {acao:"retirar"}  a cada ~3 s: aguardando → continua; pareado → guarda o
 *                     crachá e sai daqui; expirado/consumido/401 → joga o
 *                     pedido fora e pede outro; 503/rede → MANTÉM o pedido e
 *                     tenta de novo (o código continua valendo).
 *
 * A contagem regressiva é de CRONÔMETRO (segundosRestantes): `validade_s`
 * vem do banco e o aparelho só mede o tempo que passou desde a resposta.
 * Nunca se compara `expira_em` com a hora do aparelho. Quem decreta que o
 * código venceu é o servidor.
 *
 * Na parede aparecem só o código e o QR (que leva só o código). O id do
 * pedido e o segredo de retirada nunca saem do storage.
 */
export type MotivoDoPareamento = "tv_nao_pareada" | "tv_revogada" | null;

const PERGUNTA_MS = 3_000;
const ESPERA_SEM_SERVIDOR_MS = 15_000;
const ESPERA_FILA_CHEIA_MS = 60_000;

type Aviso = { classe: "vermelha" | "ambar" | "cinza"; texto: string };

type Validade = { s: number; marcadaEmMs: number };

export function Pareamento({
  motivo,
  aoParear,
}: {
  motivo: MotivoDoPareamento;
  aoParear: (token: string) => void;
}) {
  const [pedido, setPedido] = useState<PedidoDePareamento | null>(null);
  const [validade, setValidade] = useState<Validade | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [restam, setRestam] = useState<number | null>(null);
  const [origem, setOrigem] = useState<string>("");
  const pedidoRef = useRef<PedidoDePareamento | null>(null);
  const aoParearRef = useRef(aoParear);
  aoParearRef.current = aoParear;

  useEffect(() => {
    setOrigem(window.location.origin);
    // reaproveita o pedido guardado: o servidor dirá se ainda vale
    const guardado = lerPedidoGuardado();
    pedidoRef.current = guardado;
    setPedido(guardado);
    if (guardado) setValidade({ s: guardado.validade_s, marcadaEmMs: performance.now() });

    let vivo = true;
    let timer: number | undefined;
    const agendar = (ms: number) => {
      if (!vivo) return;
      timer = window.setTimeout(() => void passo(), ms);
    };
    const avisarSemServidor = (detalhe: string, emS: number) =>
      setAviso({
        classe: "vermelha",
        texto: `SERVIDOR SEM RESPOSTA (${detalhe}) — ${pedidoRef.current ? "o código continua valendo; " : ""}nova tentativa em ${emS} s.`,
      });

    async function chamar(corpo: Record<string, unknown>): Promise<{
      status: number;
      corpo: Record<string, unknown> | null;
      retryAfter: number | null;
    }> {
      const resposta = await fetch(ROTA_DE_PAREAMENTO, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        body: JSON.stringify(corpo),
      });
      let json: Record<string, unknown> | null = null;
      try {
        const lido: unknown = await resposta.json();
        json = lido && typeof lido === "object" ? (lido as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      const retryAfter = Number(resposta.headers.get("retry-after"));
      return {
        status: resposta.status,
        corpo: json,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      };
    }

    async function pedirNovo() {
      let r: Awaited<ReturnType<typeof chamar>>;
      try {
        r = await chamar({ acao: "novo" });
      } catch {
        avisarSemServidor("sem rede", ESPERA_SEM_SERVIDOR_MS / 1000);
        return agendar(ESPERA_SEM_SERVIDOR_MS);
      }
      if (r.status === 200 && r.corpo) {
        const novo: PedidoDePareamento = {
          pareamento_id: String(r.corpo.pareamento_id ?? ""),
          codigo: String(r.corpo.codigo ?? ""),
          retirada: String(r.corpo.retirada ?? ""),
          expira_em: String(r.corpo.expira_em ?? ""),
          validade_s: Number(r.corpo.validade_s ?? 0),
        };
        if (!segredoBemFormado(novo.retirada) || !novo.codigo) {
          avisarSemServidor("resposta fora do contrato", ESPERA_SEM_SERVIDOR_MS / 1000);
          return agendar(ESPERA_SEM_SERVIDOR_MS);
        }
        gravarPedido(novo);
        pedidoRef.current = novo;
        setPedido(novo);
        setValidade({ s: novo.validade_s, marcadaEmMs: performance.now() });
        setAviso(null);
        return agendar(PERGUNTA_MS);
      }
      if (r.status === 429) {
        // Freio do servidor: 20 pedidos vivos, ou 5 deste endereço. Esperar é a
        // única resposta certa — pedir de novo só enche mais a fila.
        const espera = (r.retryAfter ?? ESPERA_FILA_CHEIA_MS / 1000) * 1000;
        setAviso({
          classe: "ambar",
          texto: `MUITOS PEDIDOS DE PAREAMENTO AO MESMO TEMPO — esperando a vez; novo código em ${Math.round(espera / 1000)} s.`,
        });
        return agendar(espera);
      }
      avisarSemServidor(`HTTP ${r.status}`, ESPERA_SEM_SERVIDOR_MS / 1000);
      return agendar(ESPERA_SEM_SERVIDOR_MS);
    }

    async function retirar(atual: PedidoDePareamento) {
      let r: Awaited<ReturnType<typeof chamar>>;
      try {
        r = await chamar({
          acao: "retirar",
          pareamento_id: atual.pareamento_id,
          retirada: atual.retirada,
        });
      } catch {
        avisarSemServidor("sem rede", PERGUNTA_MS / 1000);
        return agendar(PERGUNTA_MS);
      }
      if (r.status === 200 && r.corpo) {
        const estado = r.corpo.estado as EstadoDaRetirada | undefined;
        if (estado === "pareado" && segredoBemFormado(r.corpo.token)) {
          gravarToken(r.corpo.token);
          gravarPedido(null);
          pedidoRef.current = null;
          vivo = false;
          aoParearRef.current(r.corpo.token);
          return;
        }
        if (estado === "aguardando") {
          const s = Number(r.corpo.validade_s);
          if (Number.isFinite(s)) setValidade({ s, marcadaEmMs: performance.now() });
          setAviso(null);
          return agendar(PERGUNTA_MS);
        }
        if (estado && retiradaPedeNovoCodigo(estado)) {
          gravarPedido(null);
          pedidoRef.current = null;
          setPedido(null);
          setValidade(null);
          return agendar(0);
        }
        avisarSemServidor("resposta fora do contrato", ESPERA_SEM_SERVIDOR_MS / 1000);
        return agendar(ESPERA_SEM_SERVIDOR_MS);
      }
      if (r.status === 401) {
        // pedido que o servidor não reconhece: joga fora e pede outro
        gravarPedido(null);
        pedidoRef.current = null;
        setPedido(null);
        setValidade(null);
        return agendar(0);
      }
      avisarSemServidor(r.status === 503 ? "503" : `HTTP ${r.status}`, PERGUNTA_MS / 1000);
      return agendar(PERGUNTA_MS);
    }

    async function passo() {
      if (!vivo) return;
      // a TV só conversa com o servidor com a aba visível, como o painel
      if (document.hidden) return agendar(PERGUNTA_MS);
      const atual = pedidoRef.current;
      if (atual) await retirar(atual);
      else await pedirNovo();
    }

    void passo();
    return () => {
      vivo = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // a contagem regressiva: cronômetro desde a última resposta, nunca a hora do aparelho
  useEffect(() => {
    if (!validade) {
      setRestam(null);
      return;
    }
    const calcular = () =>
      setRestam(segundosRestantes(validade.s, performance.now() - validade.marcadaEmMs));
    calcular();
    const id = window.setInterval(calcular, 1000);
    return () => window.clearInterval(id);
  }, [validade]);

  const codigo = pedido ? formatarCodigo(pedido.codigo) : null;
  const url = pedido && origem ? urlDeAprovacao(origem, pedido.codigo) : null;
  const [ligouEm] = useState(() => Date.now());

  return (
    <div className="pareamento" data-pareamento={pedido ? "com-codigo" : "sem-codigo"}>
      <header className="cab">
        <MarcaETitulo data="TV DA OFICINA" exemplo={false} />
        <div className="dir">
          <div className="chip cinza fixo">
            <Icone nome="CircleAlert" px={24} />
            <span>SEM CRACHÁ · PAREAR</span>
          </div>
          <Relogio desvioMs={0} />
        </div>
      </header>
      {motivo === "tv_revogada" ? (
        <div className="aviso vermelha">
          <Icone nome="TriangleAlert" px={30} />
          <span>
            ESTA TV FOI REVOGADA em {ROTA_DAS_TELAS}. Para voltar à parede, aprove de novo com o
            código abaixo.
          </span>
        </div>
      ) : motivo === "tv_nao_pareada" ? (
        <div className="aviso ambar">
          <Icone nome="CircleAlert" px={30} />
          <span>O crachá desta TV não vale mais. Aprove de novo com o código abaixo.</span>
        </div>
      ) : null}
      {aviso ? (
        <div className={`aviso ${aviso.classe}`} data-aviso={aviso.classe}>
          <Icone nome={aviso.classe === "vermelha" ? "WifiOff" : "CircleAlert"} px={30} />
          <span>{aviso.texto}</span>
        </div>
      ) : null}
      <div className="miolo">
        <div>
          <div className="passo cx fixo">Parear esta TV</div>
          <div className="chamada">Esta TV ainda não tem crachá.</div>
          <div className={`codigo fixo ${codigo ? "" : "vago"}`} data-codigo={codigo ?? undefined}>
            {codigo ?? "— — —"}
          </div>
          <div className="instrucao">
            Abra o <b>Bex Print</b> no celular como <b>administrador</b> e aponte a câmera aqui.
          </div>
          <div className="ou">
            Ou entre em{" "}
            <b>
              {origem ? origem.replace(/^https?:\/\//, "") : ""}
              {ROTA_DAS_TELAS}
            </b>{" "}
            no computador e digite o código.
          </div>
          <div className="contagem">
            <Icone nome="Clock" px={28} />
            {restam === null ? (
              <span>{pedido ? "conferindo o código…" : "pedindo um código ao servidor…"}</span>
            ) : restam > 0 ? (
              <span>
                este código vale por mais{" "}
                <b>
                  {Math.floor(restam / 60)}:{String(restam % 60).padStart(2, "0")}
                </b>
              </span>
            ) : (
              <span>o código venceu — trocando por outro…</span>
            )}
          </div>
        </div>
        {url ? (
          <div className="qr">
            <Qr texto={url} />
          </div>
        ) : (
          <div className="qr vago">
            <span>o QR aparece junto com o código</span>
          </div>
        )}
      </div>
      <div className="rodape-par">
        <span className="fixo">
          ligada às {horaMinuto(ligouEm)} · o código troca a cada 10 minutos até alguém aprovar
        </span>
        <span className="fixo">/tv/maquinas</span>
      </div>
    </div>
  );
}
