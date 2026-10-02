import { useEffect, useState } from "react";
import { PAGINA_S } from "@/domain/tv/paginacao";
import { idadeEmSegundos, seloDeIdade, type FalhaDaBusca, type Selo } from "@/domain/tv/frescor";

/**
 * Os dois relógios internos da parede, fora dos componentes de desenho:
 *
 *   useTique   o tique da troca de página (a cada PAGINA_S segundos), que SÓ
 *              anda com dado ao vivo — fora do AO VIVO nada se move;
 *   useSelo    o selo de idade recalculado a cada segundo, mas que só provoca
 *              redesenho quando MUDA de degrau (AO VIVO → ATRASADO → PARADO):
 *              a idade em si é do componente <Idade/>, com o próprio intervalo.
 */
export function useTique(ativo: boolean): number {
  const [tique, setTique] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    const id = window.setInterval(() => setTique((t) => t + 1), PAGINA_S * 1000);
    return () => window.clearInterval(id);
  }, [ativo]);
  return tique;
}

export function useSelo(args: {
  desvioMs: number;
  geradoEmMs: number;
  intervaloS: number;
  falha: FalhaDaBusca;
  dentroDoExpediente: boolean;
  simulado?: boolean;
  horaDoDado?: string;
}): Selo {
  const { desvioMs, geradoEmMs, intervaloS, falha, dentroDoExpediente, simulado, horaDoDado } =
    args;
  const calcular = () =>
    seloDeIdade({
      idadeS: idadeEmSegundos(Date.now(), desvioMs, geradoEmMs),
      intervaloS,
      falha,
      dentroDoExpediente,
      simulado,
      horaDoDado,
    });
  const [selo, setSelo] = useState<Selo>(calcular);
  useEffect(() => {
    setSelo(calcular());
    const id = window.setInterval(() => {
      setSelo((anterior) => {
        const novo = calcular();
        return novo.tipo === anterior.tipo && novo.texto === anterior.texto ? anterior : novo;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcula quando qualquer entrada muda
  }, [desvioMs, geradoEmMs, intervaloS, falha, dentroDoExpediente, simulado, horaDoDado]);
  return selo;
}
