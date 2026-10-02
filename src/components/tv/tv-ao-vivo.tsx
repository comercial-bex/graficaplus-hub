import { useEffect, useMemo, useState } from "react";
import { Palco } from "./palco";
import { Pareamento, type MotivoDoPareamento } from "./pareamento";
import { SemDado } from "./sem-dado";
import { TelaDaOficina, type FaixaDaBusca } from "./tela-da-oficina";
import { useFontesProntas, useMedidor } from "./medidas";
import { useSelo, useTique } from "./tique";
import { apagarToken, lerToken } from "./cracha";
import { usePainel } from "./usar-painel";
import { dataDoCabecalho, horaMinuto } from "@/domain/tv/frescor";
import { montarTela } from "@/domain/tv/tela";

/**
 * A TV de verdade: com crachá, busca o painel; sem crachá, pareia.
 *
 * O crachá só é lido depois de montar (localStorage e cookie não existem no
 * servidor). Enquanto não se sabe se há crachá, a tela fica preta — um
 * instante, antes de qualquer desenho.
 */
export function TvAoVivo() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [geracao, setGeracao] = useState(0);
  const [motivo, setMotivo] = useState<MotivoDoPareamento>(null);

  useEffect(() => {
    setToken(lerToken());
  }, []);

  if (token === undefined) return null;
  if (token === null) {
    return (
      <Palco>
        <Pareamento
          motivo={motivo}
          aoParear={(novo) => {
            setMotivo(null);
            setGeracao((g) => g + 1);
            setToken(novo);
          }}
        />
      </Palco>
    );
  }
  return (
    <PainelAoVivo
      token={token}
      geracao={geracao}
      aoRecusar={(porque) => {
        // 401: o crachá não vale mais. Apaga dos dois lugares e volta ao
        // pareamento dizendo o motivo — nunca fica tentando com crachá morto.
        apagarToken();
        setMotivo(porque);
        setToken(null);
      }}
    />
  );
}

function PainelAoVivo({
  token,
  geracao,
  aoRecusar,
}: {
  token: string;
  geracao: number;
  aoRecusar: (m: Exclude<MotivoDoPareamento, null>) => void;
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
