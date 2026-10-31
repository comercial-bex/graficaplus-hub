import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";

/**
 * Marcar o arquivo que está na tela como final de produção (31/10/2026).
 *
 * A trava "Sem arquivo final de produção" pedia para "anexar o arquivo e marcar como
 * final", mas OS com arquivo já anexado (161, 164, 165, 215...) não tinham onde marcar
 * sem abrir a OS completa. O nome do arquivo aparece ao lado: o botão age no que está
 * sendo mostrado, e a pessoa vê qual é. A marcação é conferida: a política de UPDATE
 * barra em silêncio (0 linhas, sem erro), e dizer "marcado" sem ter marcado é o defeito
 * que o sistema já teve.
 */
export function MarcarComoFinal({ arquivoId, nome }: { arquivoId: string; nome: string }) {
  const qc = useQueryClient();

  const marcar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("arquivos")
        .update({ final_producao: true })
        .eq("id", arquivoId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Seu perfil não pode marcar o arquivo como final. Peça a quem pode.");
      }
    },
    onSuccess: () => {
      toast.success("Arquivo marcado como final de produção.");
      for (const chave of [["kanban-os"], ["kanban-bloqueios"], ["ficha-os-arquivos"], ["arquivos-os"]]) {
        void qc.invalidateQueries({ queryKey: chave });
      }
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  return (
    <div className="min-w-0 space-y-1">
      <Button type="button" size="sm" disabled={marcar.isPending} onClick={() => marcar.mutate()}>
        {marcar.isPending ? "Marcando…" : "Marcar como final"}
      </Button>
      <p className="truncate text-[11px] text-muted-foreground">{nome}</p>
    </div>
  );
}
