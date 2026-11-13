import { History } from "lucide-react";
import { AjudaDaSecao } from "@/components/whatsapp/ajuda-da-secao";
import { DICAS_WA_GAVETA } from "@/lib/dicas";
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
import { Carregando } from "@/components/bex/Carregando";

const ROTULO_ORIGEM: Record<string, string> = {
  mensagem_recebida: "aberto pela mensagem do cliente",
  manual: "aberto pela equipe",
  reaberto: "reaberto: o cliente voltou a escrever",
};

/**
 * Os atendimentos da conversa (WA-AAMM-NNNN): cada ciclo aberto e resolvido é
 * um registro novo e imutável. O atual mostra há quanto tempo está aberto e
 * quanto levou a primeira resposta; os anteriores, o período e o motivo.
 */
export function AtendimentosDaConversa({
  conversaId,
  semMensagemDoCliente = false,
}: {
  conversaId: string;
  /** A conversa só tem mensagem da gráfica (aviso automático). */
  semMensagemDoCliente?: boolean;
}) {
  const atendimentos = useAtendimentos(conversaId);
  const equipe = useEquipe();
  const nomes = mapaDeNomes(equipe.data);
  const lista = atendimentos.data ?? [];
  const atual = lista.find((a) => !a.fechado_em) ?? null;
  const anteriores = lista.filter((a) => a.fechado_em);

  return (
    <section className="space-y-2 border-b p-4" aria-labelledby="gaveta-atendimentos">
      {/* Título de 15 px com a primeira letra maiúscula, sem caixa-alta espaçada
          (onda 1, 12/11/2026: o dono enxerga mal e o espaçamento corta a palavra). */}
      <h3
        id="gaveta-atendimentos"
        className="flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <History className="h-4 w-4" /> Atendimentos
        <AjudaDaSecao texto={DICAS_WA_GAVETA.atendimentos} rotulo="Atendimentos" />
      </h3>
      {atendimentos.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar os atendimentos: {mensagemErro(atendimentos.error)}
        </p>
      ) : atendimentos.isPending ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {semMensagemDoCliente
            ? "A gráfica começou esta conversa com um aviso automático. O atendimento abre quando o cliente responder."
            : "Nenhum atendimento registrado. O primeiro abre quando o cliente escrever."}
        </p>
      ) : (
        <>
          {atual ? <Atual a={atual} nomes={nomes} /> : (
            <p className="text-sm text-muted-foreground">Nenhum atendimento aberto agora.</p>
          )}
          {anteriores.length > 0 && (
            // Os anteriores ficam recolhidos: quem atende quer o atual (a1 8.6).
            <details className="group pt-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground">
                Atendimentos anteriores ({anteriores.length})
              </summary>
              <ul className="space-y-2 pb-1">
                {anteriores.slice(0, 6).map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="font-medium">{a.numero}</span>
                    <span className="block text-muted-foreground">
                      {diaEHora(a.aberto_em)} a {a.fechado_em ? diaEHora(a.fechado_em) : "sem data"}.{" "}
                      {rotuloDoMotivo(a.motivo_resolucao)}
                      {a.nota_resolucao ? ` (${a.nota_resolucao})` : ""}
                    </span>
                  </li>
                ))}
                {anteriores.length > 6 && (
                  <li className="text-sm text-muted-foreground">
                    e mais {anteriores.length - 6} anteriores.
                  </li>
                )}
              </ul>
            </details>
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
        <span className="font-semibold">{a.numero}</span>
        <span className={cn("rounded border px-1.5 py-0.5 text-xs", setor.cor)}>{setor.rotulo}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {ROTULO_ORIGEM[a.origem_abertura] ?? a.origem_abertura} · há {aberto?.texto ?? "instantes"}
      </p>
      <p className="text-sm">
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
