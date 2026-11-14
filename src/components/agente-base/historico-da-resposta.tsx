import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { mensagemErro } from "@/lib/erros";
import { lerHistoricoDaResposta } from "@/lib/api/agente-base.functions";
import { ROTULO_DO_EVENTO, ROTULO_DO_STATUS } from "@/domain/agente-base/fila";

/**
 * O histórico de versões de uma resposta: quem mexeu, quando e o que mudou. Só
 * cresce: o banco recusa mudar ou apagar uma linha dele. Só carrega quando a
 * pessoa abre.
 */
export function HistoricoDaResposta({
  id,
  versao,
  status,
}: {
  id: string;
  versao: number;
  status: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ler = useServerFn(lerHistoricoDaResposta);
  const historico = useQuery({
    queryKey: ["agente-base-historico", id, versao, status],
    queryFn: () => ler({ data: { id } }),
    enabled: aberto,
  });
  return (
    <details
      className="rounded-lg border border-border p-3"
      onToggle={(e) => setAberto((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-foreground">
        Histórico de versões
      </summary>
      {!aberto ? null : historico.isLoading ? (
        <p className="text-base text-foreground">Carregando o histórico.</p>
      ) : historico.error ? (
        <p role="alert" className="text-base font-medium text-destructive">
          {mensagemErro(historico.error, "Não foi possível carregar o histórico.")}
        </p>
      ) : (historico.data ?? []).length === 0 ? (
        <p className="text-base text-foreground">Nenhum registro ainda.</p>
      ) : (
        <ol className="mt-2 space-y-3">
          {(historico.data ?? []).map((l) => (
            <li key={l.id} className="rounded-md border border-border p-3 text-base text-foreground">
              <p className="font-semibold">
                Versão {l.versao}. {ROTULO_DO_EVENTO[l.evento] ?? l.evento}
              </p>
              <p className="text-muted-foreground">
                {new Date(l.em).toLocaleString("pt-BR", { timeZone: "America/Belem" })}
                {l.por ? `. Por ${l.por}` : ". Pelo sistema"}. Situação depois: {ROTULO_DO_STATUS[l.status]}.
              </p>
              <p className="mt-1 whitespace-pre-wrap">{l.resposta}</p>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
