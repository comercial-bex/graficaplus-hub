import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  camposDaCobranca,
  descricaoDaLinha,
  rotuloDaQuantidade,
  totalDasCobrancas,
  unidadeNaTela,
  type CobrancaDaResposta,
  type PlanoDasLinhas,
  type ProcessoDaResposta,
} from "@/domain/orcamentos/cobranca-das-respostas";
import type { PerguntaDoProduto } from "@/domain/orcamentos/perguntas-do-item";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Os processos citados nas ações das perguntas, com o serviço que cobra cada um. */
export function useProcessosDasPerguntas(perguntas: readonly PerguntaDoProduto[]) {
  const ids = [...new Set(perguntas.flatMap((p) => p.acoes.map((a) => a.processo_id)))].sort();
  return useQuery({
    queryKey: ["processos-que-cobram", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<ProcessoDaResposta[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("processos")
        .select("id, nome, medida_cobrada, produto_servico_id")
        .in("id", ids);
      if (error) throw error;
      return (data ?? []) as ProcessoDaResposta[];
    },
  });
}

/**
 * Deixa as linhas presas ao item iguais ao que as respostas cobram. Cada escrita confere o que voltou: a política
 * barra sem erro, e a tela não pode dizer que cobrou sem ter cobrado.
 */
export async function gravarLinhasDasRespostas(a: {
  orcamentoId: string;
  itemId: string;
  descricaoDoItem: string;
  plano: PlanoDasLinhas;
  ordem: number;
}) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = supabase as any;
  for (const [n, c] of a.plano.inserir.entries()) {
    const { data, error } = await db
      .from("orcamento_itens")
      .insert({
        orcamento_id: a.orcamentoId,
        produto_id: c.servico!.id,
        descricao: descricaoDaLinha(c, a.descricaoDoItem),
        ...camposDaCobranca(c),
        ordem: a.ordem + n,
        gerado_por_item_id: a.itemId,
      })
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error(`${c.nome} não entrou no orçamento.`);
  }
  for (const { id, ...campos } of a.plano.atualizar) {
    const { data, error } = await db
      .from("orcamento_itens")
      .update(campos)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("A quantidade da cobrança não mudou.");
  }
  if (a.plano.apagar.length > 0) {
    const { data, error } = await db.from("orcamento_itens").delete().in("id", a.plano.apagar).select("id");
    if (error) throw error;
    if ((data ?? []).length !== a.plano.apagar.length) throw new Error("A cobrança antiga não saiu do orçamento.");
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** O que as respostas cobram, antes de salvar. Sem resposta que acrescente processo, não aparece. */
export function CobrancaDasRespostas({
  cobrancas,
  informadas,
  desabilitado = false,
  onInformar,
}: {
  cobrancas: readonly CobrancaDaResposta[];
  informadas: Readonly<Record<string, number>>;
  desabilitado?: boolean;
  onInformar: (processoId: string, quantidade: number) => void;
}) {
  if (cobrancas.length === 0) return null;
  const total = totalDasCobrancas(cobrancas);
  return (
    <section className="space-y-3 rounded-lg border bg-muted/20 p-3" aria-label="O que as respostas cobram" data-testid="cobranca-das-respostas">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Coins className="h-4 w-4 text-link" aria-hidden="true" />
        O que as respostas cobram
      </h3>
      <ul className="space-y-2 text-sm">
        {cobrancas.map((c) => (
          <li key={c.processo_id} className="space-y-1" data-cobranca={c.estado}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{c.nome}</span>
              <Situacao c={c} />
            </div>
            {c.medida === "informar" && (c.estado === "cobra" || c.estado === "falta_quantidade") && (
              <div className="flex items-center gap-2">
                <Label htmlFor={`quantidade-${c.processo_id}`} className="text-xs text-muted-foreground">
                  {rotuloDaQuantidade(c.servico?.unidade)}
                </Label>
                <Input
                  id={`quantidade-${c.processo_id}`}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  className="h-9 w-28"
                  disabled={desabilitado}
                  value={informadas[c.processo_id] ?? ""}
                  onChange={(e) => onInformar(c.processo_id, Number(e.target.value) || 0)}
                />
                <span className="text-xs text-muted-foreground">
                  {brl(c.preco)} por {c.servico?.unidade}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {total > 0 && (
        <p className="flex items-center justify-between gap-2 border-t pt-2 text-sm font-semibold">
          <span>Entra no orçamento ao salvar o item</span>
          <span className="font-mono">{brl(total)}</span>
        </p>
      )}
    </section>
  );
}

function Situacao({ c }: { c: CobrancaDaResposta }) {
  const fraco = "text-xs text-muted-foreground";
  switch (c.estado) {
    case "cobra":
      return (
        <span className="font-mono text-xs">
          {num(c.quantidade)} {unidadeNaTela(c.servico?.unidade)} × {brl(c.preco)} = {brl(c.total)}
        </span>
      );
    case "falta_quantidade":
      return <span className="text-xs text-destructive">Fica de fora até informar a quantidade</span>;
    case "falta_medida":
      return <span className="text-xs text-destructive">Fica de fora até informar a medida da peça</span>;
    case "ja_no_orcamento":
      return <span className={fraco}>Já está no orçamento</span>;
    default:
      return <span className={fraco}>Sem cobrança à parte</span>;
  }
}
