import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, History, Lock, Pencil, Percent, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";

/**
 * Os dez números que a casa usa para formar preço e medir resultado.
 *
 * Eles existiam no banco desde a carga inicial e NÃO tinham tela: só o PDF da
 * via interna os lia. Quer dizer que a alíquota de imposto, o markup e a perda
 * de refile da sua gráfica só mudavam por SQL — e desde que a Meta do mês
 * passou a dividir o custo fixo pela margem de contribuição, são eles que
 * decidem o número mais importante do sistema.
 *
 * Quem edita é quem tem `custos.update` (hoje só o admin). Os demais veem os
 * valores, porque entender de onde sai o preço é útil para a equipe inteira —
 * e a RLS da tabela recusa a escrita de qualquer forma.
 */

type Parametro = {
  id: string;
  categoria: string;
  codigo: string;
  descricao: string | null;
  unidade: string | null;
  valor: number;
  observacao: string | null;
  updated_at: string | null;
};

type Mudanca = {
  id: string;
  codigo: string;
  valor_anterior: number | null;
  valor_novo: number | null;
  created_at: string;
};

const NOME_DA_CATEGORIA: Record<string, string> = {
  markup: "Markup de venda",
  taxas: "Impostos e taxas",
  perdas: "Perdas de produção",
  mao_de_obra: "Mão de obra",
  energia: "Energia",
  geral: "Rateio administrativo",
};

/** Os que entram na conta da Meta do mês. Mudar um muda o ponto de equilíbrio. */
const ENTRA_NA_META = new Set([
  "impostos_venda",
  "taxa_cartao",
  "pct_perda_material",
  "pct_falha_producao",
]);

function formatar(valor: number, unidade: string | null): string {
  if (unidade === "%") return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (unidade?.startsWith("R$"))
    return `${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: unidade === "R$/kWh" ? 4 : 2 })}${unidade.replace("R$", "")}`;
  return `${valor.toLocaleString("pt-BR")} ${unidade ?? ""}`.trim();
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ParametrosDaCasa() {
  const qc = useQueryClient();
  const { hasPermission, hasRole } = useAuth();
  const podeEditar = hasRole("admin") || hasPermission("custos.update");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [verHistorico, setVerHistorico] = useState(false);

  const { data: parametros = [], isLoading } = useQuery({
    queryKey: ["parametros-da-casa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_tabela")
        .select("id, categoria, codigo, descricao, unidade, valor, observacao, updated_at")
        .eq("ativo", true)
        .order("categoria")
        .order("codigo");
      if (error) throw error;
      return (data ?? []) as unknown as Parametro[];
    },
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["parametros-da-casa-historico"],
    enabled: verHistorico,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_tabela_historico")
        .select("id, codigo, valor_anterior, valor_novo, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Mudanca[];
    },
  });

  const salvar = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: number }) => {
      // .select() de volta é o que separa "gravou" de "a RLS recusou em
      // silêncio": update barrado devolve zero linha e nenhum erro.
      const { data, error } = await supabase
        .from("custos_tabela")
        .update({ valor })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("Seu perfil não pode alterar os parâmetros da casa.");
    },
    onSuccess: () => {
      toast.success("Parâmetro salvo. A Meta do mês já usa o valor novo.");
      qc.invalidateQueries({ queryKey: ["parametros-da-casa"] });
      qc.invalidateQueries({ queryKey: ["parametros-da-casa-historico"] });
      qc.invalidateQueries({ queryKey: ["ponto-de-equilibrio"] });
      qc.invalidateQueries({ queryKey: ["meta-do-mes"] });
      setEditando(null);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (parametros.length === 0) return null;

  const categorias = [...new Set(parametros.map((p) => p.categoria))];

  return (
    <section className="mt-10 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Parâmetros da casa</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Os números que formam o preço e medem o resultado. Quatro deles entram direto na
            conta da <strong>Meta do mês</strong>: mudar aqui muda quanto a gráfica precisa
            faturar para empatar.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-9"
          onClick={() => setVerHistorico((v) => !v)}
        >
          <History className="mr-1.5 h-3.5 w-3.5" />
          {verHistorico ? "Esconder mudanças" : "Ver o que mudou"}
        </Button>
      </div>

      {!podeEditar && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            Você vê os parâmetros, mas quem altera é o administrador. Saber de onde sai o preço
            ajuda a explicar o orçamento ao cliente.
          </span>
        </div>
      )}

      <div className="space-y-4">
        {categorias.map((cat) => (
          <Card key={cat}>
            <CardContent className="p-4">
              <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {NOME_DA_CATEGORIA[cat] ?? cat}
              </h3>
              <ul className="divide-y divide-border">
                {parametros
                  .filter((p) => p.categoria === cat)
                  .map((p) => {
                    const emEdicao = editando === p.id;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{p.descricao ?? p.codigo}</span>
                            {ENTRA_NA_META.has(p.codigo) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bex-lime)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--bex-lime)]">
                                <Percent className="h-2.5 w-2.5" />
                                entra na meta
                              </span>
                            )}
                          </div>
                          {p.observacao && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{p.observacao}</p>
                          )}
                        </div>

                        {emEdicao ? (
                          <div className="flex items-center gap-2">
                            <Input
                              autoFocus
                              type="number"
                              step="0.0001"
                              inputMode="decimal"
                              value={rascunho}
                              onChange={(e) => setRascunho(e.target.value)}
                              className="h-11 w-28 text-base md:h-9 md:text-sm"
                              aria-label={`Novo valor de ${p.descricao ?? p.codigo}`}
                            />
                            <span className="text-xs text-muted-foreground">{p.unidade}</span>
                            <Button
                              size="sm"
                              className="min-h-11 md:min-h-9"
                              disabled={salvar.isPending || rascunho.trim() === ""}
                              onClick={() =>
                                salvar.mutate({ id: p.id, valor: Number(rascunho) })
                              }
                            >
                              <Check className="h-4 w-4" />
                              <span className="sr-only">Salvar</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-11 md:min-h-9"
                              onClick={() => setEditando(null)}
                            >
                              <X className="h-4 w-4" />
                              <span className="sr-only">Cancelar</span>
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold tabular-nums">
                              {formatar(Number(p.valor), p.unidade)}
                            </span>
                            {podeEditar && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-11 md:min-h-9"
                                onClick={() => {
                                  setEditando(p.id);
                                  setRascunho(String(p.valor));
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span className="sr-only">
                                  Editar {p.descricao ?? p.codigo}
                                </span>
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {verHistorico && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Últimas mudanças
            </h3>
            {historico.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum parâmetro foi alterado ainda. Os valores são os da carga inicial.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {historico.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {quando(h.created_at)}
                    </span>
                    <span className="font-medium">{h.codigo}</span>
                    <span className="text-muted-foreground">
                      {h.valor_anterior ?? "—"} → <strong>{h.valor_novo ?? "—"}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
