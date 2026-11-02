import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  faixaDaNota,
  fraseDaNota,
  type LinhasParaNota,
  type NotaDaPasta,
} from "@/domain/catalogo/pronto-para-ia";

/**
 * As linhas das tabelas satélites da pasta, para a nota "Pronto para a IA" de
 * todos os produtos de uma vez (quatro consultas leves; staff lê todas por RLS).
 * Falha numa delas vira lista vazia: a nota cai, a tela não.
 */
export function useLinhasParaNota() {
  return useQuery({
    queryKey: ["pasta-satelites-para-nota"],
    queryFn: async (): Promise<LinhasParaNota> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = supabase as any;
      const [fichas, processos, perguntas, formulas] = await Promise.all([
        s.from("produto_ficha").select("produto_id, largura_padrao_m, altura_padrao_m, ia_como_medir, ia_revisado_em"),
        s.from("produto_processos").select("produto_id"),
        s.from("produto_perguntas").select("produto_id, finalidade"),
        s.from("produto_formulas").select("produto_id"),
      ]);
      return {
        fichas: fichas.data ?? [],
        processos: processos.data ?? [],
        perguntas: perguntas.data ?? [],
        formulas: formulas.data ?? [],
      };
    },
  });
}

const COR = { boa: "bg-primary", media: "bg-warning", baixa: "bg-destructive" } as const;

/** "7/10" com a barra; o que falta vai no nome acessível e na dica de toque. */
export function NotaProntoParaIa({ nota, compacta = false }: { nota: NotaDaPasta; compacta?: boolean }) {
  const frase = fraseDaNota(nota);
  return (
    <div className={cn("inline-flex items-center gap-2", compacta ? "" : "min-w-[120px]")} aria-label={frase} role="img">
      <span className="font-mono text-sm tabular-nums">{nota.nota}/10</span>
      <span className="h-2 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={cn("block h-full", COR[faixaDaNota(nota.nota)])} style={{ width: `${nota.nota * 10}%` }} />
      </span>
    </div>
  );
}
