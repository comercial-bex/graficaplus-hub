import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { Button } from "@/components/ui/button";
import {
  acabamentoCobravel,
  ladosSugeridos,
  OPCOES_DE_LADOS,
  quantidadeDoAcabamento,
  type AcabamentoCobravel,
  type LadosDaBainha,
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
        .select("padrao, acabamentos(nome, ativo, produto_servico_id)")
        .eq("produto_id", produtoId);
      if (error) throw error;
      return (
        (data ?? []) as {
          padrao: boolean;
          acabamentos: { nome: string; ativo: boolean; produto_servico_id: string | null } | null;
        }[]
      )
        .filter((l) => l.acabamentos?.ativo)
        .map((l) => ({
          nome: l.acabamentos!.nome,
          padrao: l.padrao,
          servicoId: l.acabamentos!.produto_servico_id,
        }));
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
  nomeDoProduto,
  jaNoOrcamento,
  desabilitado = false,
  onAdicionar,
}: {
  acabamentos: { nome: string; padrao: boolean; servicoId?: string | null }[];
  servicos: readonly ProdutoDeServico[];
  peca: { largura: number; altura: number; quantidade: number };
  /** para sugerir os lados da bainha (banner: em cima e embaixo) */
  nomeDoProduto?: string | null;
  /** ids dos produtos de serviço que já são linha deste orçamento */
  jaNoOrcamento: ReadonlySet<string>;
  desabilitado?: boolean;
  onAdicionar: (c: CobrancaPronta) => void;
}) {
  const linhas: { regra: AcabamentoCobravel; servico: ProdutoDeServico }[] = [];
  for (const a of acabamentos) {
    const regra = acabamentoCobravel(a.nome);
    if (!regra) continue;
    // O serviço que cobra vem da coluna `acabamentos.produto_servico_id`; o nome é só o plano B.
    const servico =
      servicos.find((s) => !!a.servicoId && s.id === a.servicoId) ??
      servicos.find((s) => s.nome.trim().toLowerCase() === regra.servico.toLowerCase());
    if (!servico || jaNoOrcamento.has(servico.id)) continue;
    if (quantidadeDoAcabamento(regra.medida, peca) > 0) linhas.push({ regra, servico });
  }
  if (linhas.length === 0) return null;

  return (
    <div
      className="space-y-3 rounded-lg border border-dashed p-3"
      data-testid="cobranca-do-acabamento"
    >
      <p className="text-sm font-medium">Cobrar o acabamento à parte</p>
      {linhas.map(({ regra, servico }) => (
        <LinhaDeCobranca
          key={servico.id}
          regra={regra}
          servico={servico}
          peca={peca}
          nomeDoProduto={nomeDoProduto}
          desabilitado={desabilitado}
          onAdicionar={onAdicionar}
        />
      ))}
      <p className="text-xs text-muted-foreground">
        A linha entra como um item comum: dá para mudar a quantidade depois ou apagar.
      </p>
    </div>
  );
}

function LinhaDeCobranca({
  regra,
  servico,
  peca,
  nomeDoProduto,
  desabilitado,
  onAdicionar,
}: {
  regra: AcabamentoCobravel;
  servico: ProdutoDeServico;
  peca: { largura: number; altura: number; quantidade: number };
  nomeDoProduto?: string | null;
  desabilitado: boolean;
  onAdicionar: (c: CobrancaPronta) => void;
}) {
  const [lados, setLados] = useState<LadosDaBainha>(() => ladosSugeridos(nomeDoProduto));
  const preco = Number(servico.preco_base);
  const temPreco = Number.isFinite(preco) && preco > 0;
  const unidade = regra.medida === "perimetro" ? "m" : "m²";
  const valorDe = (q: number) => brl(Math.round(q * preco * 100) / 100);
  const quantidade = quantidadeDoAcabamento(regra.medida, peca, lados);

  return (
    <div className="space-y-2" data-testid={`cobranca-${regra.medida}`}>
      <p className="text-sm">
        {regra.acabamento}
        {temPreco && (
          <span className="text-muted-foreground">
            {" "}
            · {brl(preco)}/{unidade}
          </span>
        )}
      </p>
      {regra.medida === "perimetro" && (
        <GradeDeCartoes
          rotulo={`Lados com ${regra.acabamento}`}
          className="sm:grid-cols-3 lg:grid-cols-3"
        >
          {OPCOES_DE_LADOS.map((o) => {
            const q = quantidadeDoAcabamento(regra.medida, peca, o.chave);
            return (
              <CartaoDeEscolha
                key={o.chave}
                ativo={lados === o.chave}
                titulo={o.titulo}
                detalhe={`${o.detalhe} · ${num(q)} m${temPreco ? ` · ${valorDe(q)}` : ""}`}
                desabilitado={desabilitado}
                onEscolher={() => setLados(o.chave)}
                className="min-h-16"
              />
            );
          })}
        </GradeDeCartoes>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">
          {num(quantidade)} {unidade}
          {temPreco && <span className="text-muted-foreground"> = {valorDe(quantidade)}</span>}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9"
          disabled={desabilitado}
          onClick={() => onAdicionar({ acabamento: regra, servico, quantidade })}
        >
          <Plus className="h-4 w-4" /> Adicionar ao orçamento
        </Button>
      </div>
    </div>
  );
}
