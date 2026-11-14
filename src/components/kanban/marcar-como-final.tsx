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
export function MarcarComoFinal({
  arquivoId,
  nome,
  rotulo = "Marcar como final",
  compacto = false,
}: {
  arquivoId: string;
  nome: string;
  /** "Usar como arquivo de impressão" na ficha (14/11/2026): diz o que a marcação faz. */
  rotulo?: string;
  /** Numa lista: só o botão, sem o nome embaixo. */
  compacto?: boolean;
}) {
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
      toast.success(`${nome}: marcado como arquivo de impressão (final de produção).`);
      for (const chave of [["kanban-os"], ["kanban-bloqueios"], ["ficha-os-arquivos"], ["arquivos-os"]]) {
        void qc.invalidateQueries({ queryKey: chave });
      }
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  if (compacto) {
    return (
      <Button type="button" size="sm" variant="ghost" disabled={marcar.isPending} onClick={() => marcar.mutate()} aria-label={`${rotulo}: ${nome}`}>
        {marcar.isPending ? "Marcando…" : rotulo}
      </Button>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <Button type="button" size="sm" disabled={marcar.isPending} onClick={() => marcar.mutate()}>
        {marcar.isPending ? "Marcando…" : rotulo}
      </Button>
      <p className="truncate text-xs text-muted-foreground">{nome}</p>
    </div>
  );
}
