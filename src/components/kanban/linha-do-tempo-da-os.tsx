import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nomesDaEquipe } from "@/lib/api/equipe";
import { rotuloDe } from "@/domain/os/etapas";
import { duracaoEmPalavras, linhaDoTempo, type TrocaDeStatus } from "@/domain/os/linha-do-tempo";
import { cn } from "@/lib/utils";

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Quem levou a OS a cada etapa e quanto tempo ela ficou em cada uma — na ficha do
 * quadro (15/11/2026). Os três passos mais recentes ficam à vista; o resto, recolhido.
 */
export function LinhaDoTempoDaOs({ osId }: { osId: string }) {
  const dados = useQuery({
    queryKey: ["os-linha-do-tempo", osId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("os_status_historico")
        .select("status_anterior, status_novo, mudou_em, mudou_por")
        .eq("os_id", osId)
        .order("mudou_em", { ascending: true });
      if (error) throw error;
      const trocas = (data ?? []) as TrocaDeStatus[];
      // Sem os nomes, a linha segue com "alguém da equipe".
      const nomes = await nomesDaEquipe(trocas.map((t) => t.mudou_por)).catch(() => new Map<string, string>());
      return { trocas, nomes };
    },
  });

  if (dados.isPending) return <p className="text-xs text-muted-foreground">Carregando a linha do tempo…</p>;
  if (dados.isError || !dados.data || dados.data.trocas.length === 0) return null;

  const passos = linhaDoTempo(dados.data.trocas).reverse();
  const nome = (id: string | null) => (id ? (dados.data.nomes.get(id)?.split(/\s+/)[0] ?? "alguém da equipe") : "o sistema");
  const Linha = ({ p }: { p: (typeof passos)[number] }) => (
    <li className={cn("flex flex-wrap items-baseline gap-x-1.5 text-xs", p.atual ? "text-foreground" : "text-muted-foreground")}>
      <span className="font-medium">{rotuloDe(p.status)}</span>
      <span>
        · {p.abertura ? "aberta" : "movida"} por {nome(p.por)} em {quando(p.em)}
      </span>
      <span className={cn("font-mono", p.atual && "font-semibold")}>
        · {p.atual ? `está há ${duracaoEmPalavras(p.minutos)}` : `ficou ${duracaoEmPalavras(p.minutos)}`}
      </span>
    </li>
  );

  return (
    <div className="space-y-1.5">
      <ol className="space-y-1" aria-label="Linha do tempo da OS">
        {passos.slice(0, 3).map((p) => (
          <Linha key={p.em + p.status} p={p} />
        ))}
      </ol>
      {passos.length > 3 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Ver os {passos.length - 3} passos anteriores</summary>
          <ol className="mt-1 space-y-1">
            {passos.slice(3).map((p) => (
              <Linha key={p.em + p.status} p={p} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
