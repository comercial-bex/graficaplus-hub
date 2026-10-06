import { useEffect, useMemo, useState } from "react";
import { Palco } from "./palco";
import { EntradaDesligada, EntradaPorPin, type MotivoDaEntrada } from "./entrada-por-pin";
import { SemDado } from "./sem-dado";
import { TelaDaOficina, type FaixaDaBusca } from "./tela-da-oficina";
import { useFontesProntas, useMedidor } from "./medidas";
import { useSelo, useTique } from "./tique";
import { apagarToken, lerToken } from "./cracha";
import { usePainel } from "./usar-painel";
import { dataDoCabecalho, horaMinuto } from "@/domain/tv/frescor";
import { montarTela } from "@/domain/tv/tela";
import {
  PIN_MINIMO,
  ROTA_DO_PIN,
  interpretarEstadoDoPin,
  type EstadoDoPin,
} from "@/domain/tv/pin";

/**
 * A TV de verdade: com crachá, busca o painel; sem crachá, pede o PIN.
 *
 * O crachá só é lido depois de montar (localStorage e cookie não existem no
 * servidor). Enquanto não se sabe se há crachá, a tela fica preta — um
 * instante, antes de qualquer desenho.
 */
export function TvAoVivo() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [geracao, setGeracao] = useState(0);
  const [motivo, setMotivo] = useState<MotivoDaEntrada>(null);

  useEffect(() => {
    setToken(lerToken());
  }, []);

  if (token === undefined) return null;
  if (token === null) {
    return (
      <SemCracha
        motivo={motivo}
        aoEntrar={(novo) => {
          setMotivo(null);
          setGeracao((g) => g + 1);
          setToken(novo);
        }}
      />
    );
  }
  return (
    <PainelAoVivo
      token={token}
      geracao={geracao}
      aoRecusar={(porque) => {
        // 401: o crachá não vale mais. Apaga dos dois lugares e volta ao
        // PIN dizendo o motivo — nunca fica tentando com crachá morto.
        apagarToken();
        setMotivo(porque);
        setToken(null);
      }}
    />
  );
}

type ModoDeEntrada =
  | { tipo: "perguntando" }
  | { tipo: "pin"; digitos: number; aviso: { classe: "vermelha"; texto: string } | null }
  | { tipo: "desligada" };

/** Com o PIN desligado, de quanto em quanto tempo a TV pergunta de novo. */
const CONFERIR_PIN_DESLIGADO_S = 30;

/** GET /api/tv/pin: ligado e quantos números. Falha de rede ou resposta torta = null ("não sei"). */
async function perguntarEstadoDoPin(signal: AbortSignal): Promise<EstadoDoPin | null> {
  try {
    const resposta = await fetch(ROTA_DO_PIN, {
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      signal,
    });
    return resposta.ok ? interpretarEstadoDoPin(await resposta.json()) : null;
  } catch {
    return null;
  }
}

/**
 * A TV sem crachá. O PIN é a ÚNICA entrada desde 06/10/2026 (decisão do dono,
 * "só PIN mesmo" — o pareamento por código saiu). Pergunta ao servidor se o
 * PIN está ligado e quantos números ele tem: ligado, o teclado; desligado, o
 * aviso de entrada desligada, que pergunta de novo a cada 30 s em silêncio e
 * troca para o teclado sozinho quando alguém ligar o PIN em /telas.
 *
 * Servidor fora na hora de perguntar: mostra o teclado de 4 casas com o aviso.
 * Quem decide de verdade é o POST — se o PIN estiver desligado, a resposta
 * leva a TV para o aviso.
 */
function SemCracha({
  motivo,
  aoEntrar,
}: {
  motivo: MotivoDaEntrada;
  aoEntrar: (token: string) => void;
}) {
  const [modo, setModo] = useState<ModoDeEntrada>({ tipo: "perguntando" });
  const tipo = modo.tipo;

  // Pergunta ao montar.
  useEffect(() => {
    if (tipo !== "perguntando") return;
    let vivo = true;
    const controle = new AbortController();
    const limite = window.setTimeout(() => controle.abort(), 15_000);
    void perguntarEstadoDoPin(controle.signal).then((estado) => {
      window.clearTimeout(limite);
      if (!vivo) return;
      if (estado && !estado.ligado) setModo({ tipo: "desligada" });
      else if (estado?.digitos) setModo({ tipo: "pin", digitos: estado.digitos, aviso: null });
      else {
        setModo({
          tipo: "pin",
          digitos: PIN_MINIMO,
          aviso: {
            classe: "vermelha",
            texto: "SERVIDOR SEM RESPOSTA — confira a internet da TV. Pode digitar o PIN assim mesmo.",
          },
        });
      }
    });
    return () => {
      vivo = false;
      window.clearTimeout(limite);
      controle.abort();
    };
  }, [tipo]);

  // Desligada: pergunta de novo de tempos em tempos, sem apagar a tela entre
  // uma pergunta e outra. Só sai daqui quando o servidor disser "ligado".
  useEffect(() => {
    if (tipo !== "desligada") return;
    let vivo = true;
    let controle: AbortController | null = null;
    const id = window.setInterval(() => {
      controle?.abort();
      const atual = new AbortController();
      controle = atual;
      const limite = window.setTimeout(() => atual.abort(), 15_000);
      void perguntarEstadoDoPin(atual.signal).then((estado) => {
        window.clearTimeout(limite);
        if (vivo && estado?.ligado && estado.digitos) {
          setModo({ tipo: "pin", digitos: estado.digitos, aviso: null });
        }
      });
    }, CONFERIR_PIN_DESLIGADO_S * 1000);
    return () => {
      vivo = false;
      window.clearInterval(id);
      controle?.abort();
    };
  }, [tipo]);

  if (modo.tipo === "perguntando") return null;
  if (modo.tipo === "desligada") {
    return (
      <Palco>
        <EntradaDesligada motivo={motivo} conferirACadaS={CONFERIR_PIN_DESLIGADO_S} />
      </Palco>
    );
  }
  return (
    <Palco>
      <EntradaPorPin
        digitos={modo.digitos}
        motivo={motivo}
        avisoInicial={modo.aviso}
        aoEntrar={aoEntrar}
        aoPinDesligado={() => setModo({ tipo: "desligada" })}
      />
    </Palco>
  );
}

function PainelAoVivo({
  token,
  geracao,
  aoRecusar,
}: {
  token: string;
  geracao: number;
  aoRecusar: (m: Exclude<MotivoDaEntrada, null>) => void;
}) {
  const estado = usePainel(token, geracao);
  const [ligouEmMs] = useState(() => Date.now());
  const fontes = useFontesProntas();
  const medir = useMedidor(fontes);

  useEffect(() => {
    if (estado.recusa) aoRecusar(estado.recusa);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a recusa interessa
  }, [estado.recusa]);

  const painel = estado.painel;
  const geradoEmMs = estado.geradoEmMs ?? ligouEmMs;
  const tela = useMemo(
    () => (painel ? montarTela(painel, geradoEmMs) : null),
    [painel, geradoEmMs],
  );
  const selo = useSelo({
    desvioMs: estado.desvioMs,
    geradoEmMs,
    intervaloS: painel?.intervalo_s ?? 60,
    falha: estado.falha,
    dentroDoExpediente: painel?.dentro_do_expediente ?? true,
    horaDoDado: horaMinuto(geradoEmMs),
  });
  const tique = useTique(!selo.quieto && tela !== null);
  const data = dataDoCabecalho(Date.now() + estado.desvioMs);
  const intervaloS = painel?.intervalo_s ?? 60;

  if (!painel || !tela) {
    const ligouAs = horaMinuto(ligouEmMs + estado.desvioMs);
    return (
      <Palco>
        <SemDado
          data={data}
          exemplo={false}
          desvioMs={estado.desvioMs}
          motivo={
            estado.carregando || !estado.falha
              ? { tipo: "carregando" }
              : {
                  tipo: estado.falha === "contrato" ? "dado_invalido" : "sem_conexao",
                  ligouAs,
                  detalhe: estado.detalheDaFalha ?? "sem resposta",
                  intervaloS,
                }
          }
        />
      </Palco>
    );
  }

  let faixaDaBusca: FaixaDaBusca | null = null;
  if (estado.falha) {
    const desde =
      estado.falhaDesdeMs !== null ? horaMinuto(estado.falhaDesdeMs + estado.desvioMs) : "—";
    faixaDaBusca =
      estado.falha === "contrato"
        ? {
            classe: "vermelha",
            icone: "TriangleAlert",
            texto: `DADO INVÁLIDO desde ${desde} — mostrando o último dado bom, parado como estava (${estado.detalheDaFalha}). Nova tentativa a cada ${intervaloS} s.`,
          }
        : {
            classe: "vermelha",
            icone: "WifiOff",
            texto: `SEM CONEXÃO desde ${desde} — mostrando o último dado, parado como estava (${estado.detalheDaFalha ?? "servidor sem resposta"}). Nova tentativa a cada ${intervaloS} s.`,
          };
  }

  return (
    <Palco>
      <TelaDaOficina
        tela={tela}
        selo={selo}
        faixaDaBusca={faixaDaBusca}
        data={data}
        exemplo={false}
        desvioMs={estado.desvioMs}
        geradoEmMs={geradoEmMs}
        tique={tique}
        medir={medir}
      />
    </Palco>
  );
}
