import { useCallback, useEffect, useRef, useState } from "react";
import { Icone } from "./icones";
import { Relogio } from "./relogio";
import { MarcaETitulo } from "./tela-da-oficina";
import { gravarToken, gravarTokenPendente, lerTokenPendente } from "./cracha";
import { ROTA_DAS_TELAS } from "@/domain/tv/pareamento";
import {
  ROTA_DO_PIN,
  esperaPorExtenso,
  passoDaResposta,
  textoDoPinErrado,
  type PassoDoPin,
} from "@/domain/tv/pin";
import { gerarSegredo } from "@/domain/whatsapp/segredo-webhook";
import { horaMinuto } from "@/domain/tv/frescor";

/**
 * Por que a TV voltou para a entrada: o crachá dela foi revogado em /telas
 * (ou o PIN mudou), ou o servidor não reconhece mais o crachá guardado.
 */
export type MotivoDaEntrada = "tv_nao_pareada" | "tv_revogada" | null;

/**
 * A TV sem crachá, com a entrada por PIN ligada: um teclado em letra de parede.
 * É a ÚNICA porta da TV desde 06/10/2026 — decisão do dono, "só PIN mesmo".
 *
 * Dá para digitar de três jeitos, porque cada TV de oficina tem um:
 *   - os números do controle remoto (chegam como tecla "0"–"9"; alguns
 *     navegadores de TV só mandam o código numérico da tecla);
 *   - as setas do controle andando pelo teclado da tela e OK apertando;
 *   - toque ou o ponteiro do controle (LG, Samsung) nas teclas.
 * Completou as casas, manda sozinho — ninguém precisa achar o "Entrar".
 *
 * O contrato (tv-pin.server.ts), seguido à risca:
 *   liberado        guarda o crachá e sai daqui
 *   pin_errado      limpa as casas e diz quantas tentativas restam
 *   esperar         conta o tempo pelo CRONÔMETRO (nunca a hora do aparelho)
 *                   e não deixa mandar até acabar
 *   pin_desligado   o PIN foi desligado em /telas: sai do teclado para o
 *                   aviso de entrada desligada
 *   trocar_cracha   o crachá guardado foi revogado: sorteia outro e repete
 *                   uma vez, sozinho
 *   sem_servidor    avisa e deixa digitar de novo
 *
 * O PIN nunca é guardado: some das casas a cada resposta. O crachá sorteado é
 * guardado ANTES de ir ao servidor (`gravarTokenPendente`), para que uma
 * resposta perdida no Wi-Fi não vire outra TV em /telas.
 */

type Aviso = { classe: "vermelha" | "ambar" | "cinza"; texto: string };
type Espera = { s: number; marcadaEmMs: number };

const TEMPO_LIMITE_MS = 15_000;

/** As teclas na ordem da tela, linha a linha: é por esta grade que as setas andam. */
const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "apagar", "0", "entrar"] as const;
type Tecla = (typeof TECLAS)[number];
const COLUNAS = 3;

/** A tecla que o evento traz, inclusive do controle que só manda o código numérico. */
function digitoDoEvento(e: KeyboardEvent): string | null {
  if (/^[0-9]$/.test(e.key)) return e.key;
  const codigo = e.keyCode;
  if (codigo >= 48 && codigo <= 57) return String(codigo - 48);
  if (codigo >= 96 && codigo <= 105) return String(codigo - 96);
  return null;
}

export function EntradaPorPin({
  digitos,
  motivo,
  avisoInicial,
  aoEntrar,
  aoPinDesligado,
}: {
  digitos: number;
  motivo: MotivoDaEntrada;
  avisoInicial?: Aviso | null;
  aoEntrar: (token: string) => void;
  aoPinDesligado: () => void;
}) {
  const [pin, setPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(avisoInicial ?? null);
  const [espera, setEspera] = useState<Espera | null>(null);
  const [restam, setRestam] = useState<number | null>(null);
  const [ligouEm] = useState(() => Date.now());
  const teclasRef = useRef<(HTMLButtonElement | null)[]>([]);
  const aoEntrarRef = useRef(aoEntrar);
  aoEntrarRef.current = aoEntrar;
  const aoPinDesligadoRef = useRef(aoPinDesligado);
  aoPinDesligadoRef.current = aoPinDesligado;

  const esperando = restam !== null && restam > 0;

  // a contagem da espera: cronômetro desde a resposta, nunca a hora do aparelho
  useEffect(() => {
    if (!espera) {
      setRestam(null);
      return;
    }
    const calcular = () => {
      const falta = Math.max(0, Math.ceil(espera.s - (performance.now() - espera.marcadaEmMs) / 1000));
      setRestam(falta);
      if (falta === 0) {
        setEspera(null);
        setAviso({ classe: "cinza", texto: "PODE TENTAR DE NOVO — digite o PIN." });
      }
    };
    calcular();
    const id = window.setInterval(calcular, 1000);
    return () => window.clearInterval(id);
  }, [espera]);

  const mandar = useCallback(async (valor: string, segundaVez = false): Promise<void> => {
    setEnviando(true);
    let token = lerTokenPendente();
    if (!token) {
      token = gerarSegredo();
      gravarTokenPendente(token);
    }

    let passo: PassoDoPin;
    const controle = new AbortController();
    const limite = window.setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
    try {
      const resposta = await fetch(ROTA_DO_PIN, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        body: JSON.stringify({ pin: valor, token }),
        signal: controle.signal,
      });
      let corpo: unknown = null;
      try {
        corpo = await resposta.json();
      } catch {
        corpo = null;
      }
      const retryAfter = Number(resposta.headers.get("retry-after"));
      passo = passoDaResposta(
        resposta.status,
        corpo,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      );
    } catch {
      passo = { tipo: "sem_servidor", detalhe: "sem rede" };
    } finally {
      window.clearTimeout(limite);
    }

    switch (passo.tipo) {
      case "liberado":
        gravarToken(token);
        gravarTokenPendente(null);
        aoEntrarRef.current(token);
        return;
      case "trocar_cracha":
        // O crachá guardado foi revogado antes de ser usado. Outro, uma vez só:
        // se o servidor recusar de novo, o problema não é o crachá.
        gravarTokenPendente(null);
        if (!segundaVez) return mandar(valor, true);
        setAviso({ classe: "vermelha", texto: "O SERVIDOR RECUSOU O CRACHÁ DESTA TV — digite o PIN de novo." });
        break;
      case "pin_errado":
        setAviso({ classe: "vermelha", texto: textoDoPinErrado(passo.restantes) });
        break;
      case "esperar":
        setEspera({ s: passo.s, marcadaEmMs: performance.now() });
        setAviso({
          classe: "ambar",
          texto: "MUITOS PINS ERRADOS — por segurança, a entrada espera antes de aceitar de novo.",
        });
        break;
      case "pin_desligado":
        aoPinDesligadoRef.current();
        return;
      case "sem_servidor":
        setAviso({
          classe: "vermelha",
          texto: `SERVIDOR SEM RESPOSTA (${passo.detalhe}) — confira a internet da TV e digite o PIN de novo.`,
        });
        break;
    }
    setPin("");
    setEnviando(false);
  }, []);

  const digitar = useCallback(
    (d: string) => {
      if (enviando || esperando) return;
      setPin((atual) => (atual.length >= digitos ? atual : atual + d));
    },
    [digitos, enviando, esperando],
  );

  const apagar = useCallback(() => {
    if (enviando) return;
    setPin((atual) => atual.slice(0, -1));
  }, [enviando]);

  // casas completas: manda sozinho
  useEffect(() => {
    if (pin.length === digitos && !enviando && !esperando) void mandar(pin);
  }, [pin, digitos, enviando, esperando, mandar]);

  // o foco começa no "1", para as setas do controle terem por onde andar
  useEffect(() => {
    teclasRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const d = digitoDoEvento(e);
      if (d !== null) {
        e.preventDefault();
        digitar(d);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        apagar();
        return;
      }
      const atual = teclasRef.current.findIndex((b) => b === document.activeElement);
      const andar: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -COLUNAS,
        ArrowDown: COLUNAS,
      };
      if (e.key in andar) {
        e.preventDefault();
        const destino = atual < 0 ? 0 : atual + andar[e.key];
        if (destino >= 0 && destino < TECLAS.length) teclasRef.current[destino]?.focus();
        return;
      }
      // Enter com foco numa tecla é o clique dela (o navegador faz); fora delas, manda.
      if (e.key === "Enter" && atual < 0 && pin.length >= 4 && !enviando && !esperando) {
        e.preventDefault();
        void mandar(pin);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [digitar, apagar, mandar, pin, enviando, esperando]);

  function apertar(tecla: Tecla) {
    if (tecla === "apagar") apagar();
    else if (tecla === "entrar") {
      if (pin.length >= 4 && !enviando && !esperando) void mandar(pin);
    } else digitar(tecla);
  }

  return (
    <div className="pareamento pin" data-pin={esperando ? "esperando" : enviando ? "conferindo" : "digitando"}>
      <header className="cab">
        <MarcaETitulo data="TV DA OFICINA" exemplo={false} />
        <div className="dir">
          <div className="chip cinza fixo">
            <Icone nome="Lock" px={24} />
            <span>SEM CRACHÁ · PIN</span>
          </div>
          <Relogio desvioMs={0} />
        </div>
      </header>
      {motivo === "tv_revogada" ? (
        <div className="aviso vermelha">
          <Icone nome="TriangleAlert" px={30} />
          <span>ESTA TV FOI DESCONECTADA em {ROTA_DAS_TELAS} (ou o PIN mudou). Digite o PIN para voltar.</span>
        </div>
      ) : motivo === "tv_nao_pareada" ? (
        <div className="aviso ambar">
          <Icone nome="CircleAlert" px={30} />
          <span>O crachá desta TV não vale mais. Digite o PIN para voltar.</span>
        </div>
      ) : null}
      {aviso ? (
        <div className={`aviso ${aviso.classe}`} data-aviso={aviso.classe}>
          <Icone nome={aviso.classe === "cinza" ? "KeyRound" : "TriangleAlert"} px={30} />
          <span>{aviso.texto}</span>
        </div>
      ) : null}
      <div className="miolo">
        <div>
          <div className="passo cx fixo">Entrar com PIN</div>
          <div className="chamada">Digite o PIN para ver as máquinas.</div>
          <div className="casas" aria-label={`${pin.length} de ${digitos} números digitados`}>
            {Array.from({ length: digitos }, (_, i) => (
              <div
                key={i}
                className={`casa ${i < pin.length ? "cheia" : ""} ${i === pin.length && !enviando ? "atual" : ""}`}
              >
                {i < pin.length ? "•" : ""}
              </div>
            ))}
          </div>
          <div className="contagem">
            <Icone nome={esperando ? "Clock" : "KeyRound"} px={28} />
            {enviando ? (
              <span>conferindo o PIN…</span>
            ) : esperando ? (
              <span>
                a entrada volta a aceitar PIN em <b>{esperaPorExtenso(restam ?? 0)}</b>
              </span>
            ) : (
              <span>use os números do controle, as setas e OK, ou toque nas teclas</span>
            )}
          </div>
        </div>
        <div className="teclado" role="group" aria-label="Teclado do PIN">
          {TECLAS.map((tecla, i) => (
            <button
              key={tecla}
              type="button"
              ref={(el) => {
                teclasRef.current[i] = el;
              }}
              className={`tecla ${tecla === "apagar" || tecla === "entrar" ? "acao" : ""}`}
              disabled={enviando || (esperando && tecla !== "apagar")}
              aria-label={tecla === "apagar" ? "Apagar" : tecla === "entrar" ? "Entrar" : tecla}
              onClick={() => apertar(tecla)}
            >
              {tecla === "apagar" ? (
                <>
                  <Icone nome="Delete" px={40} />
                  <span>Apagar</span>
                </>
              ) : tecla === "entrar" ? (
                <>
                  <Icone nome="Check" px={40} />
                  <span>Entrar</span>
                </>
              ) : (
                tecla
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="rodape-par">
        <span className="fixo">
          ligada às {horaMinuto(ligouEm)} · o PIN é trocado em {ROTA_DAS_TELAS}, por administrador ou
          gestor
        </span>
        <span className="fixo">/tv/maquinas</span>
      </div>
    </div>
  );
}

/**
 * A TV sem crachá com o PIN DESLIGADO em /telas. Não há outra porta (o
 * pareamento por código saiu em 06/10/2026), então a tela diz o que fazer e
 * espera: quem a desenha (`SemCracha`) pergunta de novo ao servidor de tempos
 * em tempos e troca para o teclado assim que o PIN voltar a ser ligado.
 */
export function EntradaDesligada({
  motivo,
  conferirACadaS,
}: {
  motivo: MotivoDaEntrada;
  conferirACadaS: number;
}) {
  const [ligouEm] = useState(() => Date.now());
  return (
    <div className="pareamento pin desligada" data-pin="desligado">
      <header className="cab">
        <MarcaETitulo data="TV DA OFICINA" exemplo={false} />
        <div className="dir">
          <div className="chip cinza fixo">
            <Icone nome="Lock" px={24} />
            <span>SEM CRACHÁ · PIN DESLIGADO</span>
          </div>
          <Relogio desvioMs={0} />
        </div>
      </header>
      {motivo === "tv_revogada" ? (
        <div className="aviso vermelha">
          <Icone nome="TriangleAlert" px={30} />
          <span>ESTA TV FOI DESCONECTADA em {ROTA_DAS_TELAS}.</span>
        </div>
      ) : null}
      <div className="aviso ambar" data-aviso="ambar">
        <Icone nome="CircleAlert" px={30} />
        <span>A ENTRADA DA TV ESTÁ DESLIGADA — o PIN foi desligado em {ROTA_DAS_TELAS}.</span>
      </div>
      <div className="miolo">
        <div>
          <div className="passo cx fixo">Entrar com PIN</div>
          <div className="chamada">Peça para ligarem o PIN da TV.</div>
          <p className="instrucao">
            Um <b>administrador ou gestor</b> liga o PIN em <b>TVs da oficina</b> ({ROTA_DAS_TELAS}). Esta
            tela confere sozinha a cada {conferirACadaS} s e mostra o teclado assim que o PIN for ligado.
          </p>
        </div>
      </div>
      <div className="rodape-par">
        <span className="fixo">ligada às {horaMinuto(ligouEm)} · a TV entra só pelo PIN</span>
        <span className="fixo">/tv/maquinas</span>
      </div>
    </div>
  );
}
