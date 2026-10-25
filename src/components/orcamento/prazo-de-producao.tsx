import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mensagemErro } from "@/lib/erros";
import { CHAVE_PRAZOS, carregarPrazos } from "@/lib/parceiro-api";
import { PRAZO_NORMAL, prazoEscolhido } from "@/domain/parceiros/prazo";
import { EscolhaDoPrazo } from "./escolha-do-prazo";

/**
 * O prazo de produção do orçamento da equipe (passo "Condições"). Trocar o prazo
 * só grava `orcamentos.prazo_tipo`: quem cria, atualiza e apaga a linha da taxa
 * é o gatilho do banco (`recalcular_taxa_prazo`), pela mesma regra do pedido do
 * parceiro. Por isso, depois de gravar, a tela relê os itens.
 */
export function PrazoDeProducao({
  orcamentoId,
  prazoTipo,
  baseDaTaxa,
  podeEditar,
}: {
  orcamentoId: string;
  prazoTipo: string | null;
  /** Soma dos produtos; nulo para quem não vê preço. */
  baseDaTaxa: number | null;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { data: prazos = [] } = useQuery({
    queryKey: CHAVE_PRAZOS,
    queryFn: carregarPrazos,
    staleTime: 5 * 60_000,
  });

  const gravar = useMutation({
    mutationFn: async (chave: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("orcamentos")
        .update({ prazo_tipo: chave })
        .eq("id", orcamentoId)
        .select("id");
      if (error) throw error;
      // Escrita barrada pela RLS devolve 0 linhas e nenhum erro.
      if (!data || data.length === 0)
        throw new Error("Seu perfil não pode alterar este orçamento.");
    },
    onSuccess: async () => {
      // A taxa mudou dentro dos itens e dos totais: tudo isto se relê.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["orcamento", orcamentoId] }),
        qc.invalidateQueries({ queryKey: ["orc-itens", orcamentoId] }),
        qc.invalidateQueries({ queryKey: ["orcamentos"] }),
      ]);
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível trocar o prazo.")),
  });

  if (prazos.length < 2) return null;
  const atual = prazoEscolhido(prazos, prazoTipo ?? PRAZO_NORMAL);

  return (
    <Card id="acordo-prazo">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Prazo de produção</CardTitle>
      </CardHeader>
      <CardContent>
        <EscolhaDoPrazo
          prazos={prazos}
          escolhido={atual?.chave ?? PRAZO_NORMAL}
          baseDaTaxa={baseDaTaxa}
          desabilitado={!podeEditar || gravar.isPending}
          onEscolher={(chave) => gravar.mutate(chave)}
          ajuda="O expresso entra no orçamento como uma linha de taxa, em porcentagem sobre o valor dos produtos, e a OS nasce com prioridade alta. A taxa acompanha os itens: se eles mudarem, ela se recalcula."
        />
      </CardContent>
    </Card>
  );
}
