import { Link } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { avisosDaBase, contadorDoRamo, type CoberturaDaBase } from "@/domain/agente/painel";
import { Aviso, BOTAO } from "@/components/triagem/comum";

/**
 * Quantas respostas aprovadas o agente tem, por ramo, e o aviso que fica à vista enquanto houver menos que o mínimo. O
 * contador mostra sempre "N de 15": número solto engana. Sem nenhuma aprovada o aviso diz que o agente passaria toda
 * pergunta à equipe, e o painel não deixa subir para um degrau em que ele fala de verdade.
 */
export function BaseAprovada({ cobertura }: { cobertura: CoberturaDaBase }) {
  const avisos = avisosDaBase(cobertura);
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      aria-labelledby="titulo-base-aprovada"
    >
      <h3 id="titulo-base-aprovada" className="text-base font-semibold text-foreground">
        Respostas aprovadas que o agente pode usar
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {cobertura.porRamo.map((c) => (
          <li
            key={c.ramo}
            className="flex min-h-11 flex-col justify-center rounded-md border border-border bg-card px-3 py-2 text-base text-foreground"
          >
            <span className="font-semibold">{contadorDoRamo(c)}</span>
            {c.rascunhos > 0 ? (
              <span>
                {c.rascunhos} {c.rascunhos === 1 ? "rascunho espera" : "rascunhos esperam"} a sua
                aprovação.
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {avisos.length > 0 ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-warning bg-warning/15 p-4 text-base text-foreground"
        >
          <p className="font-semibold">Faltam respostas aprovadas.</p>
          {avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : (
        <Aviso>Todos os ramos têm o mínimo de respostas aprovadas.</Aviso>
      )}
      <Button asChild variant="outline" className={BOTAO}>
        <Link to="/configuracoes-agente-base">
          <ListChecks className="h-5 w-5" aria-hidden="true" /> Aprovar respostas
        </Link>
      </Button>
    </section>
  );
}
