/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Carregando } from "@/components/bex/Carregando";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import {
  filtrarModelos,
  parecidoNoCatalogo,
  produtoDoModelo,
  type ModeloDoMercado,
} from "@/domain/catalogo/modelos-do-mercado";

const LIMITE_NA_TELA = 60;

/**
 * "Modelos do mercado": o que uma gráfica vende e ainda não está no nosso catálogo.
 * Trazer cria um produto inativo e abre o cadastro, para ganhar máquina, custo e preço.
 */
export function ModelosDoMercado({
  aberto,
  aoFechar,
  produtos,
  aoTrazer,
}: {
  aberto: boolean;
  aoFechar: () => void;
  produtos: readonly { nome: string }[];
  aoTrazer: (produtoId: string) => void;
}) {
  const qc = useQueryClient();
  const [familia, setFamilia] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const modelos = useQuery({
    queryKey: ["catalogo-modelos"],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("catalogo_modelos")
        .select("id, familia, nome, produto_id")
        .order("familia")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ModeloDoMercado[];
    },
  });

  const familias = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const m of modelos.data ?? []) contagem.set(m.familia, (contagem.get(m.familia) ?? 0) + 1);
    return [...contagem.entries()];
  }, [modelos.data]);
  const filtrados = useMemo(() => filtrarModelos(modelos.data ?? [], familia, busca), [modelos.data, familia, busca]);

  const trazer = useMutation({
    mutationFn: async (m: ModeloDoMercado) => {
      const { data, error } = await (supabase as any).from("produtos").insert(produtoDoModelo(m)).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Nada foi gravado: seu perfil não pode criar produtos.");
      const produtoId = data[0].id as string;
      const { error: erroLiga } = await (supabase as any)
        .from("catalogo_modelos")
        .update({ produto_id: produtoId })
        .eq("id", m.id);
      if (erroLiga) toast.warning("O produto entrou, mas o modelo não foi marcado como trazido.");
      return produtoId;
    },
    onSuccess: (produtoId) => {
      toast.success("Produto criado inativo. Defina máquina, custo e preço para vender.");
      void qc.invalidateQueries({ queryKey: ["catalogo-modelos"] });
      void qc.invalidateQueries({ queryKey: ["produtos"] });
      aoTrazer(produtoId);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modelos do mercado</DialogTitle>
          <DialogDescription>
            O que uma gráfica vende. Traga o que for vender: o produto nasce inativo e só aparece no orçamento depois de ter preço.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Buscar modelo"
            className="pl-9"
            placeholder="Buscar: lona, totem, toldo..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={familia === null ? "default" : "outline"} onClick={() => setFamilia(null)}>
            Todos
          </Button>
          {familias.map(([f, n]) => (
            <Button key={f} size="sm" variant={familia === f ? "default" : "outline"} onClick={() => setFamilia(f)}>
              {f} ({n})
            </Button>
          ))}
        </div>
        {modelos.isLoading && <Carregando />}
        {modelos.isError && <p className="text-sm text-destructive">Não foi possível ler os modelos. Tente de novo.</p>}
        <div className="space-y-2">
          {filtrados.slice(0, LIMITE_NA_TELA).map((m) => {
            const parecido = parecidoNoCatalogo(m.nome, produtos);
            return (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{m.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.familia}
                    {parecido && !m.produto_id && ` · parecido com: ${parecido}`}
                  </div>
                </div>
                {m.produto_id ? (
                  <Badge variant="outline">Já trazido</Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={trazer.isPending} onClick={() => trazer.mutate(m)}>
                    <Plus className="mr-1 h-4 w-4" /> Trazer
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {filtrados.length > LIMITE_NA_TELA && (
          <p className="text-center text-xs text-muted-foreground">
            Mostrando {LIMITE_NA_TELA} de {filtrados.length}. Busque ou escolha uma família para achar o resto.
          </p>
        )}
        {!modelos.isLoading && filtrados.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum modelo com esse nome.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
