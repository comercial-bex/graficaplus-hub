import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Check, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";

/**
 * Quem se cadastrou pelo link de convite e está esperando a gráfica liberar.
 *
 * Existe porque o cadastro por convite nasce `pendente` e sem papel nenhum: é
 * o que impede um estranho com o link de enxergar preço de revenda, que é 15%
 * a 30% abaixo do balcão. Sem esta fila, o cadastro seria um buraco — a pessoa
 * se cadastra e some, e a gráfica não fica sabendo.
 *
 * Some quando não há ninguém esperando.
 */

interface Pendente {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  convidado_por: string;
  criado_em: string;
  tem_login: boolean;
}

export function FilaDeAprovacao({ podeAprovar }: { podeAprovar: boolean }) {
  const qc = useQueryClient();

  const { data: pendentes = [] } = useQuery({
    queryKey: ["parceiros-pendentes"],
    queryFn: async (): Promise<Pendente[]> => {
      const { data, error } = await (supabase.rpc as any)("parceiros_pendentes");
      if (error) throw error;
      return (data ?? []) as Pendente[];
    },
  });

  const aprovar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("parceiro_aprovar", { p_parceiro_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parceiro liberado. Ele já consegue entrar e orçar.");
      qc.invalidateQueries({ queryKey: ["parceiros-pendentes"] });
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (pendentes.length === 0) return null;

  return (
    <div className="rounded-xl border border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/5 p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-[color:var(--bex-cyan)]" />
        <h2 className="font-semibold">
          {pendentes.length === 1
            ? "1 revendedor esperando liberação"
            : `${pendentes.length} revendedores esperando liberação`}
        </h2>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Cadastraram-se pelo link de convite. Enquanto não forem liberados, não veem preço de
        revenda nem conseguem orçar.
      </p>

      <div className="mt-3 space-y-2">
        {pendentes.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.nome}</span>
                {!p.tem_login && (
                  <Badge variant="outline" className="h-4 text-[10px]">
                    sem login
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {[p.documento, [p.cidade, p.estado].filter(Boolean).join("/"), p.telefone, p.email]
                  .filter(Boolean)
                  .join(" · ") || "sem dados de contato"}
              </p>
              <p className="mt-0.5 text-xs">
                <span className="text-muted-foreground">Indicado por </span>
                <strong>{p.convidado_por}</strong>
                <span className="text-muted-foreground">
                  {" "}
                  · {new Date(p.criado_em).toLocaleDateString("pt-BR")}
                </span>
              </p>
            </div>

            {podeAprovar && (
              <Button
                size="sm"
                onClick={() => aprovar.mutate(p.id)}
                disabled={aprovar.isPending}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Liberar
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
