import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dica, DicaIcone } from "@/components/bex/Dica";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  dicaDaNota,
  faixaDaNota,
  fraseDaNota,
  type LinhasParaNota,
  type NotaDaPasta,
} from "@/domain/catalogo/pronto-para-ia";

/**
 * As linhas das tabelas satélites da pasta, para a nota "Pronto para a IA" de
 * todos os produtos de uma vez (três consultas leves; staff lê todas por RLS).
 * Falha numa delas é FALHA (17/11/2026): antes virava lista vazia e a nota de
 * todo produto caía sem aviso. Agora a consulta falha, e a tela mostra traço
 * no lugar da nota e diz por quê. Lê de mil em mil: o PostgREST corta em 1.000.
 */
const PAGINA = 1000;

async function lerTudo(tabela: string, colunas: string, ordem: string[]): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = supabase as any;
  const todas: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    let q = s.from(tabela).select(colunas);
    for (const o of ordem) q = q.order(o);
    const { data, error } = await q.range(de, de + PAGINA - 1);
    if (error) throw error;
    todas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return todas;
  }
}

export function useLinhasParaNota() {
  return useQuery({
    queryKey: ["pasta-satelites-para-nota"],
    queryFn: async (): Promise<LinhasParaNota> => {
      const [fichas, processos, perguntas] = await Promise.all([
        lerTudo("produto_ficha", "produto_id, largura_padrao_m, altura_padrao_m, ia_como_medir, ia_revisado_em", ["produto_id"]),
        lerTudo("produto_processos", "produto_id", ["produto_id", "id"]),
        lerTudo("produto_perguntas", "produto_id, finalidade", ["produto_id", "id"]),
      ]);
      return { fichas, processos, perguntas };
    },
  });
}

const COR = { boa: "bg-primary", media: "bg-warning", baixa: "bg-destructive" } as const;

/**
 * "7/10" com a barra. Passar o mouse (ou tocar no ?, no celular) mostra o que falta e em que aba
 * corrigir. `nota` nulo é "não deu para calcular": traço, nunca 0.
 */
export function NotaProntoParaIa({
  nota,
  compacta = false,
  calculando = false,
}: {
  nota: NotaDaPasta | null;
  compacta?: boolean;
  /** Sem nota ainda porque a leitura está em andamento (e não porque falhou). */
  calculando?: boolean;
}) {
  const celular = useIsMobile();
  const texto = !nota && calculando ? "Calculando a nota. Só um instante." : dicaDaNota(nota);
  const miolo = nota ? (
    <span
      className={cn("inline-flex items-center gap-2", compacta ? "" : "min-w-[120px]")}
      role="img"
      aria-label={fraseDaNota(nota)}
    >
      <span className="font-mono text-base tabular-nums">{nota.nota}/10</span>
      <span className="h-2 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={cn("block h-full", COR[faixaDaNota(nota.nota)])} style={{ width: `${nota.nota * 10}%` }} />
      </span>
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-2"
      role="img"
      aria-label={calculando ? "Calculando a nota" : "Nota indisponível: não deu para ler as fichas"}
      data-testid="nota-indisponivel"
    >
      <span className="font-mono text-base tabular-nums">—/10</span>
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1" data-testid="nota-pronto-para-ia">
      {celular ? miolo : <Dica texto={texto}>{miolo}</Dica>}
      {celular && <DicaIcone texto={texto} rotulo="o que falta para a nota" />}
    </span>
  );
}

/** A linha vermelha ao lado do campo: ícone e texto, nunca só cor. Some quando o campo é preenchido. */
export function AvisoDaFalta({ id, texto, className }: { id?: string; texto: string; className?: string }) {
  return (
    <p
      id={id}
      role="status"
      data-testid="aviso-da-falta"
      className={cn("flex items-start gap-1.5 text-base font-medium text-destructive", className)}
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{texto}</span>
    </p>
  );
}

/** Borda vermelha do campo com falta. Acompanha `aria-invalid`. */
export const BORDA_DA_FALTA = "border-destructive ring-1 ring-destructive";
