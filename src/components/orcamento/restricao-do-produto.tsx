import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Scale } from "lucide-react";

/**
 * A restrição legal do produto, nas palavras do próprio catálogo.
 *
 * Extraído de `faixa-de-preco.tsx` quando a tela de orçamento foi refeita: a
 * tabela por faixa, o pedido mínimo e a validade da tabela passaram a ser
 * respondidos por `domain/orcamentos/faixas.ts`, mas a EXIGÊNCIA LEGAL do
 * produto ficou sem dono. É a única parte daquele arquivo que ninguém mais
 * cobria, e é a que menos pode faltar — quem orça material de campanha precisa
 * ver a regra na hora de vender, não depois.
 *
 * Só o texto do cadastro: calcular "cabem N peças por veículo" respondia a
 * pergunta errada. O limite de 0,5 m² é regra de APLICAÇÃO no carro do eleitor,
 * e virar número na tela sugeria uma recomendação de venda que não existe — na
 * prática vai um adesivo por carro, não quatro. Quem pergunta "quantas saem"
 * está perguntando de produção, e isso o aproveitamento de bobina responde.
 *
 * Aparece para TODO MUNDO, inclusive quem não vê valor: é informação de venda e
 * de produção, não de dinheiro.
 */

export type RestricaoProduto = {
  exigencias: string | null;
  largura: number | null;
  altura: number | null;
};

export function useRestricaoProduto(produtoId: string | null) {
  return useQuery({
    queryKey: ["restricao-produto", produtoId],
    enabled: !!produtoId,
    queryFn: async (): Promise<RestricaoProduto | null> => {
      // View operacional, não a tabela: o acesso a `produtos` é por coluna e a
      // view é o caminho oficial de leitura do front.
      const { data } = await (supabase as any)
        .from("produtos_operacional")
        .select("exigencias, produto_tamanhos(largura, altura)")
        .eq("id", produtoId)
        .maybeSingle();
      if (!data) return null;
      const medida = data.produto_tamanhos?.[0];
      return {
        exigencias: data.exigencias ?? null,
        largura: medida?.largura != null ? Number(medida.largura) : null,
        altura: medida?.altura != null ? Number(medida.altura) : null,
      };
    },
  });
}

export function RestricaoDoProduto({ restricao }: { restricao: RestricaoProduto | null | undefined }) {
  if (!restricao?.exigencias) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
      <Scale className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <p>{restricao.exigencias}</p>
    </div>
  );
}
