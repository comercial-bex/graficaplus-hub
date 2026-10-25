import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  acabamentoCobravel,
  quantidadeDoAcabamento,
  type AcabamentoCobravel,
} from "@/domain/orcamentos/cobranca-do-acabamento";

type ProdutoDeServico = {
  id: string;
  nome: string;
  unidade: string;
  preco_base?: number | string | null;
};

export type CobrancaPronta = {
  acabamento: AcabamentoCobravel;
  servico: ProdutoDeServico;
  quantidade: number;
};

/** Os acabamentos que o produto aceita (tabela `produto_acabamentos`, só leitura). */
export function useAcabamentosDoProduto(produtoId: string | null) {
  return useQuery({
    queryKey: ["produto-acabamentos", produtoId],
    enabled: !!produtoId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("produto_acabamentos")
        .select("padrao, acabamentos(nome, ativo)")
        .eq("produto_id", produtoId);
      if (error) throw error;
      return (
        (data ?? []) as { padrao: boolean; acabamentos: { nome: string; ativo: boolean } | null }[]
      )
        .filter((l) => l.acabamentos?.ativo)
        .map((l) => ({ nome: l.acabamentos!.nome, padrao: l.padrao }));
    },
  });
}

/** Grava o serviço como linha do orçamento; custo e total saem dos gatilhos do banco. */
export async function inserirLinhaDeAcabamento(
  orcamentoId: string,
  c: CobrancaPronta,
  ordem: number,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("orcamento_itens").insert({
    orcamento_id: orcamentoId,
    produto_id: c.servico.id,
    descricao: c.servico.nome,
    unidade: c.servico.unidade,
    quantidade: c.quantidade,
    valor_unitario: Number(c.servico.preco_base) || 0,
    ordem,
  });
  if (error) throw error;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * "Cobrar o acabamento à parte": para cada acabamento do produto que tem serviço com preço, mostra
 * o que seria cobrado e um botão que ACRESCENTA a linha ao orçamento. Nada é cobrado sozinho.
 * Some quando o serviço já está no orçamento ou o item ainda não tem medida.
 */
export function CobrancaDoAcabamento({
  acabamentos,
  servicos,
  peca,
  jaNoOrcamento,
  desabilitado = false,
  onAdicionar,
}: {
  acabamentos: { nome: string; padrao: boolean }[];
  servicos: readonly ProdutoDeServico[];
  peca: { largura: number; altura: number; quantidade: number };
  /** ids dos produtos de serviço que já são linha deste orçamento */
  jaNoOrcamento: ReadonlySet<string>;
  desabilitado?: boolean;
  onAdicionar: (c: CobrancaPronta) => void;
}) {
  const prontas: CobrancaPronta[] = [];
  for (const a of acabamentos) {
    const regra = acabamentoCobravel(a.nome);
    if (!regra) continue;
    const servico = servicos.find(
      (s) => s.nome.trim().toLowerCase() === regra.servico.toLowerCase(),
    );
    if (!servico || jaNoOrcamento.has(servico.id)) continue;
    const quantidade = quantidadeDoAcabamento(regra.medida, peca);
    if (quantidade > 0) prontas.push({ acabamento: regra, servico, quantidade });
  }
  if (prontas.length === 0) return null;

  return (
    <div
      className="space-y-2 rounded-lg border border-dashed p-3"
      data-testid="cobranca-do-acabamento"
    >
      <p className="text-sm font-medium">Cobrar o acabamento à parte</p>
      {prontas.map((c) => {
        const preco = Number(c.servico.preco_base);
        const unidade = c.acabamento.medida === "perimetro" ? "m" : "m²";
        return (
          <div key={c.servico.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm">
              {c.acabamento.acabamento}: {num(c.quantidade)} {unidade}
              {Number.isFinite(preco) && preco > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  × {brl(preco)} = {brl(Math.round(c.quantidade * preco * 100) / 100)}
                </span>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              disabled={desabilitado}
              onClick={() => onAdicionar(c)}
            >
              <Plus className="h-4 w-4" /> Adicionar ao orçamento
            </Button>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        {
          "A linha entra como um item comum: dá para mudar a quantidade (a bainha conta o contorno todo) ou apagar."
        }
      </p>
    </div>
  );
}
