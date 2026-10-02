import { useEffect, useState } from "react";
import { horaMinutoSegundo, idadeEmSegundos, textoDaIdade } from "@/domain/tv/frescor";

/**
 * O relógio de 56 px e a idade do selo: os dois únicos textos que mudam a
 * cada segundo. Cada um tem o próprio intervalo, para o resto da parede não
 * redesenhar sessenta vezes por minuto.
 *
 * `desvioMs` é a correção do relógio do aparelho (frescor.ts): a hora da
 * parede é a do servidor, não a da TV. No modo de exemplo o desvio leva o
 * relógio para o dia de exemplo.
 */
function useSegundo(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

export function Relogio({ desvioMs }: { desvioMs: number }) {
  const agora = useSegundo();
  return (
    <div className="relogio fixo" data-relogio>
      {horaMinutoSegundo(agora + desvioMs)}
    </div>
  );
}

export function Idade({ desvioMs, geradoEmMs }: { desvioMs: number; geradoEmMs: number }) {
  const agora = useSegundo();
  return <span data-idade>{textoDaIdade(idadeEmSegundos(agora, desvioMs, geradoEmMs))}</span>;
}
