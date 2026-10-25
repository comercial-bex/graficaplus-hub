/* eslint-disable @typescript-eslint/no-explicit-any -- função nova ainda fora de types.ts */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Carregando } from "@/components/bex/Carregando";

const NOMES: Record<string, string> = {
  "novo-produto": "Novo produto",
  "novo-material": "Novo material",
  "novo-cliente": "Novo cliente",
  "nova-maquina": "Nova máquina",
  "novo-usuario": "Novo usuário",
};

export type LinhaDeUso = {
  tela: string;
  aberturas: number;
  concluidas: number;
  abandonadas: number;
  mediana_segundos: number | null;
  passo_mais_abandonado: number | null;
};

/** "1 min 05 s", "48 s", ou "—" sem conclusão para medir. */
export function duracaoLegivel(segundos: number | null | undefined): string {
  if (segundos == null || !Number.isFinite(segundos)) return "—";
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return `${m} min ${String(s).padStart(2, "0")} s`;
}

export function taxaDeConclusao(l: Pick<LinhaDeUso, "aberturas" | "concluidas">): string {
  return l.aberturas > 0 ? `${Math.round((l.concluidas / l.aberturas) * 100)}%` : "—";
}

/**
 * Quanto cada assistente é usado: aberturas, quantas terminaram, quanto tempo levam e em que passo
 * as pessoas desistem. Só o administrador (a função do banco confere). Sem uso ainda, diz isso.
 */
export function UsoDosAssistentes() {
  const uso = useQuery({
    queryKey: ["uso-dos-assistentes"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("uso_dos_assistentes", { p_dias: 30 });
      if (error) throw error;
      return (data ?? []) as LinhaDeUso[];
    },
  });

  return (
    <Card data-testid="uso-dos-assistentes">
      <CardHeader>
        <CardTitle className="text-base">Uso dos assistentes em passos (últimos 30 dias)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {uso.isLoading && <Carregando linhas={2} />}
        {uso.error && <p className="text-sm text-destructive">Não foi possível ler o uso.</p>}
        {uso.data && uso.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ainda sem uso registrado. Aparece aqui conforme a equipe abrir os assistentes.
          </p>
        )}
        {uso.data && uso.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Assistente</th>
                  <th className="py-1 pr-3 font-medium">Aberturas</th>
                  <th className="py-1 pr-3 font-medium">Concluídas</th>
                  <th className="py-1 pr-3 font-medium">Tempo típico</th>
                  <th className="py-1 font-medium">Desistem no passo</th>
                </tr>
              </thead>
              <tbody>
                {uso.data.map((l) => (
                  <tr key={l.tela} className="border-t">
                    <td className="py-1.5 pr-3">{NOMES[l.tela] ?? l.tela}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{l.aberturas}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {l.concluidas} ({taxaDeConclusao(l)})
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {duracaoLegivel(l.mediana_segundos)}
                    </td>
                    <td className="py-1.5 tabular-nums">{l.passo_mais_abandonado ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Mede só a tela, o passo e o tempo; nada do que foi digitado. O tempo típico é a mediana de
          quem concluiu.
        </p>
      </CardContent>
    </Card>
  );
}
