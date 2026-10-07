import { History } from "lucide-react";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { diaEHora } from "@/domain/whatsapp/caixa-de-entrada";
import {
  duracaoEntre,
  esperaDe,
  infoDoSetor,
  rotuloDoMotivo,
  type AtendimentoResumo,
} from "@/domain/whatsapp/filas";
import { mapaDeNomes, useAtendimentos, useEquipe } from "@/components/whatsapp/usar-caixa-de-entrada";

const ROTULO_ORIGEM: Record<string, string> = {
  mensagem_recebida: "aberto pela mensagem do cliente",
  manual: "aberto pela equipe",
  reaberto: "reaberto: o cliente voltou a escrever",
};

/**
 * Os atendimentos da conversa (WA-AAMM-NNNN): cada ciclo aberto → resolvido é
 * um registro novo e imutável. O atual mostra há quanto tempo está aberto e
 * quanto levou a primeira resposta; os anteriores, o período e o motivo.
 */
export function AtendimentosDaConversa({ conversaId }: { conversaId: string }) {
  const atendimentos = useAtendimentos(conversaId);
  const equipe = useEquipe();
  const nomes = mapaDeNomes(equipe.data);
  const lista = atendimentos.data ?? [];
  const atual = lista.find((a) => !a.fechado_em) ?? null;
  const anteriores = lista.filter((a) => a.fechado_em);

  return (
    <section className="space-y-2 border-b p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Atendimentos
      </div>
      {atendimentos.isError ? (
        <p className="text-xs text-destructive">
          Não foi possível carregar os atendimentos: {mensagemErro(atendimentos.error)}
        </p>
      ) : atendimentos.isPending ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum atendimento registrado. O primeiro abre quando o cliente escrever.
        </p>
      ) : (
        <>
          {atual ? <Atual a={atual} nomes={nomes} /> : (
            <p className="text-xs text-muted-foreground">Nenhum atendimento aberto agora.</p>
          )}
          {anteriores.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {anteriores.slice(0, 6).map((a) => (
                <li key={a.id} className="text-xs">
                  <span className="font-mono">{a.numero}</span>{" "}
                  <span className="text-muted-foreground">
                    · {diaEHora(a.aberto_em)} → {a.fechado_em ? diaEHora(a.fechado_em) : "—"} ·{" "}
                    {rotuloDoMotivo(a.motivo_resolucao)}
                    {a.nota_resolucao ? ` (${a.nota_resolucao})` : ""}
                  </span>
                </li>
              ))}
              {anteriores.length > 6 && (
                <li className="text-[11px] text-muted-foreground">e mais {anteriores.length - 6} anteriores.</li>
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Atual({ a, nomes }: { a: AtendimentoResumo; nomes: Map<string, string> }) {
  const aberto = esperaDe(a.aberto_em);
  const primeira = duracaoEntre(a.aberto_em, a.primeira_resposta_em);
  const setor = infoDoSetor(a.fila);
  return (
    <div className="space-y-1 rounded-md border p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold">{a.numero}</span>
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px]", setor.cor)}>{setor.rotulo}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {ROTULO_ORIGEM[a.origem_abertura] ?? a.origem_abertura} · há {aberto?.texto ?? "—"}
      </p>
      <p className="text-xs">
        1ª resposta:{" "}
        {primeira ? (
          <strong>{primeira}</strong>
        ) : (
          <span className="text-status-amber">ainda não respondido</span>
        )}
        {a.responsavel_id && (
          <span className="text-muted-foreground"> · com {nomes.get(a.responsavel_id) ?? "Equipe"}</span>
        )}
      </p>
    </div>
  );
}
