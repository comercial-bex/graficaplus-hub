import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { Button } from "@/components/ui/button";
import {
  acabamentoCobravel,
  alternarEscolha,
  camposDaLinhaPorArea,
  ladosSugeridos,
  NENHUM_ACABAMENTO,
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
  peca?: { largura: number; altura: number; quantidade: number };
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
    ...(c.acabamento.medida === "area" && c.peca
      ? camposDaLinhaPorArea(c.peca, Number(c.servico.preco_base) || 0)
      : { unidade: c.servico.unidade, quantidade: c.quantidade, valor_unitario: Number(c.servico.preco_base) || 0 }),
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
 *
 * É opcional: tocar de novo no acabamento marcado (ou no lado marcado) desmarca, e com nada
 * marcado a tela diz que nada será cobrado. O cliente pode não contratar mão de obra nenhuma.
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
  // null = a pessoa ainda não mexeu (vale a sugestão); NENHUM_ACABAMENTO = desmarcou tudo.
  const [escolhido, setEscolhido] = useState<string | null>(null);
  if (linhas.length === 0) return null;
  // Lona aceita seis acabamentos: uma escolha por vez, para a tela não virar uma parede de cartões.
  const padrao = acabamentos.find((a) => a.padrao)?.nome;
  const atual =
    escolhido === NENHUM_ACABAMENTO
      ? null
      : (linhas.find((l) => l.regra.acabamento === escolhido) ??
        linhas.find((l) => l.regra.acabamento === padrao) ??
        linhas[0]);

  return (
    <div
      className="space-y-3 rounded-lg border border-dashed p-3"
      data-testid="cobranca-do-acabamento"
    >
      <p className="text-sm font-medium">
        Cobrar o acabamento à parte{" "}
        <span className="text-xs font-normal text-muted-foreground">opcional</span>
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qual acabamento cobrar">
        {linhas.map(({ regra }) => {
          const marcado = regra.acabamento === atual?.regra.acabamento;
          return (
            <Button
              key={regra.acabamento}
              type="button"
              size="sm"
              variant={marcado ? "default" : "outline"}
              aria-pressed={marcado}
              disabled={desabilitado}
              // Tocar no marcado desmarca: com nada marcado, nada é cobrado à parte.
              onClick={() =>
                setEscolhido(
                  alternarEscolha(atual?.regra.acabamento ?? null, regra.acabamento) ??
                    NENHUM_ACABAMENTO,
                )
              }
            >
              {regra.acabamento}
            </Button>
          );
        })}
      </div>
      {atual ? (
        <LinhaDeCobranca
          key={atual.servico.id}
          regra={atual.regra}
          servico={atual.servico}
          peca={peca}
          nomeDoProduto={nomeDoProduto}
          desabilitado={desabilitado}
          onAdicionar={(c) => {
            // Depois de acrescentar, volta a sugestão: o próximo acabamento vem marcado de novo.
            setEscolhido(null);
            onAdicionar(c);
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="cobranca-nenhuma">
          Nenhum acabamento será cobrado à parte. Toque em um acima se o cliente contratar.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {atual
          ? "A linha entra como um item comum: dá para mudar a quantidade depois ou apagar. Para não cobrar, toque de novo no que está marcado."
          : "Nada será acrescentado ao orçamento."}
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
  // null = nenhum lado marcado (a pessoa tocou de novo no marcado): não há o que cobrar.
  const [lados, setLados] = useState<LadosDaBainha | null>(() => ladosSugeridos(nomeDoProduto));
  const preco = Number(servico.preco_base);
  const temPreco = Number.isFinite(preco) && preco > 0;
  const unidade = regra.medida === "perimetro" ? "m" : regra.medida === "peca" ? "un" : "m²";
  const valorDe = (q: number) => brl(Math.round(q * preco * 100) / 100);
  const quantidade = quantidadeDoAcabamento(regra.medida, peca, lados);
  const semLados = regra.medida === "perimetro" && lados === null;

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
                onEscolher={() => setLados(alternarEscolha(lados, o.chave))}
                className="min-h-16"
              />
            );
          })}
        </GradeDeCartoes>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm" data-testid={semLados ? "cobranca-sem-lados" : undefined}>
          {semLados ? (
            <span className="text-muted-foreground">Marque os lados para ver o valor.</span>
          ) : (
            <>
              {num(quantidade)} {unidade}
              {temPreco && <span className="text-muted-foreground"> = {valorDe(quantidade)}</span>}
            </>
          )}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9"
          disabled={desabilitado || !(quantidade > 0)}
          onClick={() => onAdicionar({ acabamento: regra, servico, quantidade, peca })}
        >
          <Plus className="h-4 w-4" /> Adicionar ao orçamento
        </Button>
      </div>
    </div>
  );
}
