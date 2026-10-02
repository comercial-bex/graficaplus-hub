import { useEffect, useMemo, useState } from "react";
import { Palco } from "./palco";
import { TelaDaOficina } from "./tela-da-oficina";
import { useFontesProntas, useMedidor } from "./medidas";
import { useSelo, useTique } from "./tique";
import { etiquetaDoExemplo, painelDeExemplo, type ModoDeExemplo } from "@/domain/tv/exemplo";
import { horaMinuto, seloDeRetrato } from "@/domain/tv/frescor";
import { montarTela } from "@/domain/tv/tela";

/**
 * `/tv/maquinas?demo=cheio` e `?demo=hoje`: a parede com dado embutido, sem
 * rede, sem crachá. Serve para testar o aparelho e para fotografar.
 *
 * O relógio é SIMULADO: começa 20 s depois da hora do dado e anda no ritmo
 * real, como na maquete. No dia de exemplo (cheio) uma "busca" de mentira
 * renova o dado a cada intervalo_s, e o selo escreve AO VIVO SIMULADO. No
 * retrato (hoje) nada renova: o selo diz RETRATO e a tela fica quieta.
 */
const ATRASO_INICIAL_MS = 20_000;

export function TvDeExemplo({ modo }: { modo: ModoDeExemplo }) {
  const painel = useMemo(() => painelDeExemplo(modo), [modo]);
  const geradoEmOriginalMs = Date.parse(painel.gerado_em);
  const [ligouEmMs] = useState(() => Date.now());
  const desvioMs = geradoEmOriginalMs + ATRASO_INICIAL_MS - ligouEmMs;

  // a busca simulada: só no dia de exemplo
  const [geradoEmMs, setGeradoEmMs] = useState(geradoEmOriginalMs);
  useEffect(() => {
    setGeradoEmMs(geradoEmOriginalMs);
    if (modo !== "cheio") return;
    const passo = painel.intervalo_s * 1000;
    const id = window.setInterval(() => setGeradoEmMs((g) => g + passo), passo);
    return () => window.clearInterval(id);
  }, [modo, painel.intervalo_s, geradoEmOriginalMs]);

  const tela = useMemo(() => montarTela(painel, geradoEmMs), [painel, geradoEmMs]);
  const seloVivo = useSelo({
    desvioMs,
    geradoEmMs,
    intervaloS: painel.intervalo_s,
    falha: null,
    dentroDoExpediente: painel.dentro_do_expediente,
    simulado: true,
  });
  const selo =
    modo === "hoje" ? seloDeRetrato(`01/10 ${horaMinuto(geradoEmOriginalMs)}`) : seloVivo;
  const tique = useTique(!selo.quieto);
  const fontes = useFontesProntas();
  const medir = useMedidor(fontes);

  return (
    <Palco etiqueta={etiquetaDoExemplo(modo)}>
      <TelaDaOficina
        tela={tela}
        selo={selo}
        faixaDaBusca={null}
        data="DIA DE EXEMPLO"
        exemplo
        desvioMs={desvioMs}
        geradoEmMs={geradoEmMs}
        tique={tique}
        medir={medir}
      />
    </Palco>
  );
}
