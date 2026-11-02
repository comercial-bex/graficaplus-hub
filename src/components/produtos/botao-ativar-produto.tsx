import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";

/**
 * Ativar e desativar o produto. Inativo some do item do orçamento, da busca e da IA, e continua nos orçamentos que
 * já o usam: é a saída para o que a gráfica não está vendendo, sem apagar o histórico.
 */
export function BotaoAtivarProduto({
  produto,
  rotuloCompleto = false,
}: {
  produto: { id: string; nome: string; ativo: boolean };
  /** "Desativar produto" na pasta; só "Desativar" na linha da lista. */
  rotuloCompleto?: boolean;
}) {
  const qc = useQueryClient();
  const alternar = useMutation({
    mutationFn: async () => {
      // A política barra sem erro (0 linhas): a tela não pode dizer que desativou sem ter desativado.
      const { data, error } = await supabase
        .from("produtos")
        .update({ ativo: !produto.ativo } as never)
        .eq("id", produto.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Nada mudou: seu perfil não pode ativar ou desativar produtos.");
    },
    onSuccess: () => {
      toast.success(
        produto.ativo
          ? `${produto.nome} saiu da venda. Para ver de novo, ligue "Mostrar inativos" na lista.`
          : `${produto.nome} voltou para a venda.`,
      );
      for (const chave of ["produtos", "produtos-catalog-picker", "pasta-produto"]) {
        void qc.invalidateQueries({ queryKey: [chave] });
      }
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const verbo = produto.ativo ? "Desativar" : "Ativar";
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={alternar.isPending}
      aria-label={`${verbo} ${produto.nome}`}
      data-testid="botao-ativar-produto"
      onClick={() => alternar.mutate()}
    >
      <Power className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {alternar.isPending ? "Salvando..." : rotuloCompleto ? `${verbo} produto` : verbo}
    </Button>
  );
}
