/* eslint-disable @typescript-eslint/no-explicit-any -- tabela e função novas ainda fora de types.ts */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Carregando } from "@/components/bex/Carregando";
import { mensagemErro } from "@/lib/erros";

type Decisao = {
  chave: string;
  titulo: string;
  detalhe: string;
  criada_em: string;
  resolvida_em: string | null;
  resposta: string | null;
};

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/**
 * Decisões do dono: o que o sistema precisa que alguém decida para fechar números e preços.
 * Cada uma é um aviso para administrador, gestor e financeiro até ser respondida; a resposta fica
 * guardada com quem respondeu e quando. Escreve só pela função `resolver_decisao`.
 */
export function DecisoesDoDono() {
  const qc = useQueryClient();
  const [respostas, setRespostas] = useState<Record<string, string>>({});

  const lista = useQuery({
    queryKey: ["decisoes-do-dono"],
    queryFn: async () => {
      const { data: linhas, error } = await (supabase as any)
        .from("decisoes_pendentes")
        .select("chave, titulo, detalhe, criada_em, resolvida_em, resposta")
        .order("criada_em")
        .order("chave");
      if (error) throw error;
      return (linhas ?? []) as Decisao[];
    },
  });

  const resolver = useMutation({
    mutationFn: async (chave: string) => {
      const { error } = await (supabase as any).rpc("resolver_decisao", {
        p_chave: chave,
        p_resposta: respostas[chave] ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Decisão registrada");
      qc.invalidateQueries({ queryKey: ["decisoes-do-dono"] });
      qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  const abertas = (lista.data ?? []).filter((d) => !d.resolvida_em);
  const decididas = (lista.data ?? []).filter((d) => d.resolvida_em);

  return (
    <Card data-testid="decisoes-do-dono">
      <CardHeader>
        <CardTitle className="text-base">
          Decisões do dono{" "}
          {abertas.length > 0 && (
            <span className="text-muted-foreground">({abertas.length} a decidir)</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {lista.isLoading && <Carregando linhas={2} />}
        {lista.error && (
          <p className="text-sm text-destructive">Não foi possível ler as decisões.</p>
        )}
        {lista.data && abertas.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" /> Nenhuma decisão pendente.
          </p>
        )}
        {abertas.map((d) => (
          <div key={d.chave} className="space-y-2 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{d.titulo}</p>
              <p className="text-xs text-muted-foreground">{d.detalhe}</p>
            </div>
            <Textarea
              rows={2}
              aria-label={`Resposta: ${d.titulo}`}
              placeholder="A decisão, o valor ou a regra (opcional)"
              value={respostas[d.chave] ?? ""}
              onChange={(e) => setRespostas({ ...respostas, [d.chave]: e.target.value })}
            />
            <Button
              type="button"
              size="sm"
              disabled={resolver.isPending}
              onClick={() => resolver.mutate(d.chave)}
            >
              <Check className="h-4 w-4" /> Marcar como decidido
            </Button>
          </div>
        ))}
        {decididas.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Já decididas ({decididas.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {decididas.map((d) => (
                <li key={d.chave}>
                  <span className="font-medium">{d.titulo}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {data(d.resolvida_em as string)}
                    {d.resposta ? ` · ${d.resposta}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
