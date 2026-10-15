import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView, type NivelDeVisao } from "@/lib/supabase-financial-views";
import { mensagemErro } from "@/lib/erros";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProdutoAutocomplete } from "@/components/produto-autocomplete";

/** Linha da aba; valor_unitario e valor_total só vêm nas views comercial e financeira. */
type ItemDaOS = {
  id: string;
  descricao: string;
  quantidade: number;
  unidade: string | null;
  valor_unitario?: number;
  valor_total?: number;
};

/**
 * Aba Itens da OS: a lista para toda a equipe; incluir e apagar só para quem
 * mexe na venda. Saiu de `routes/_authenticated/os.$id.tsx` para poder ser
 * desenhada num teste (tests/itens-da-os-tela.test.ts).
 */
export function ItensDaOS({
  osId,
  canSeeFinancials,
  canSeePrices,
  nivelDeVisao,
  podeEditarItens,
}: {
  osId: string;
  canSeeFinancials: boolean;
  canSeePrices: boolean;
  nivelDeVisao: NivelDeVisao;
  /**
   * Incluir e apagar item é de quem mexe na venda: kanban.move ou
   * orcamentos.create, a mesma regra do banco (migração 20261008043700).
   * Os outros veem a lista — antes viam os botões e a regra recusava.
   */
  podeEditarItens: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    descricao: "",
    quantidade: "1",
    unidade: "un",
    valor_unitario: "0",
    custo_unitario: "0",
    produto_id: null as string | null,
  });
  const { data: itens = [] } = useQuery({
    queryKey: ["itens-os", osId, nivelDeVisao],
    queryFn: async () => {
      // select("*"): comercial devolve valor_unitario/valor_total sem custo_unitario.
      const { data } = await fromFinancialView("itens_os", nivelDeVisao)
        .select("*")
        .eq("os_id", osId)
        .order("ordem");
      return (data ?? []) as ItemDaOS[];
    },
  });
  async function add() {
    if (!form.descricao) return toast.error("Descrição obrigatória");
    const qtd = parseFloat(form.quantidade);
    // Quem vê preço digita preço (vendedor inclusive); quem não vê grava 0.
    const vu = canSeePrices ? parseFloat(form.valor_unitario) : 0;
    const { error } = await supabase.from("itens_os").insert({
      os_id: osId,
      descricao: form.descricao,
      quantidade: qtd,
      unidade: form.unidade,
      valor_unitario: vu,
      custo_unitario: parseFloat(form.custo_unitario),
      valor_total: qtd * vu,
      ordem: itens.length,
      produto_id: form.produto_id,
    });
    if (error) return toast.error(mensagemErro(error));
    setForm({
      descricao: "",
      quantidade: "1",
      unidade: "un",
      valor_unitario: "0",
      custo_unitario: "0",
      produto_id: null,
    });
    qc.invalidateQueries({ queryKey: ["itens-os", osId] });
  }
  async function remove(id: string) {
    const { data, error } = await supabase.from("itens_os").delete().eq("id", id).select("id");
    if (error) return toast.error(mensagemErro(error));
    // apagar barrado pela regra devolve 0 linhas e nenhum erro
    if (!data || data.length === 0) return toast.error("Seu perfil não pode apagar item desta OS.");
    qc.invalidateQueries({ queryKey: ["itens-os", osId] });
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {podeEditarItens && (
          <>
            <div className="flex justify-end">
              <ProdutoAutocomplete
                onSelect={(p) =>
                  setForm({
                    descricao: p.nome,
                    quantidade: form.quantidade || "1",
                    unidade: p.unidade,
                    valor_unitario: String(p.preco_base ?? 0),
                    custo_unitario: String(p.custo_medio ?? 0),
                    produto_id: p.id,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                <Label>Descrição</Label>
                <Input
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Label>Qtd</Label>
                <Input
                  type="number"
                  value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Label>Un</Label>
                <Input
                  value={form.unidade}
                  onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                />
              </div>
              {/* Valor un. é preço (vendedor vê); Custo un. é custo (só financeiro). */}
              {canSeePrices && (
                <div className="col-span-2">
                  <Label>Valor un.</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor_unitario}
                    onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })}
                  />
                </div>
              )}
              {canSeeFinancials && (
                <div className="col-span-2">
                  <Label>Custo un.</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.custo_unitario}
                    onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })}
                  />
                </div>
              )}
              <Button className="col-span-1" onClick={add}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Qtd</TableHead>
              {canSeePrices && (
                <>
                  <TableHead>Valor un.</TableHead>
                  <TableHead>Total</TableHead>
                </>
              )}
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Sem itens
                </TableCell>
              </TableRow>
            )}
            {itens.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.descricao}</TableCell>
                <TableCell>
                  {i.quantidade} {i.unidade}
                </TableCell>
                {canSeePrices && (
                  <>
                    <TableCell>R$ {Number(i.valor_unitario).toFixed(2)}</TableCell>
                    <TableCell>R$ {Number(i.valor_total).toFixed(2)}</TableCell>
                  </>
                )}
                <TableCell>
                  {podeEditarItens && (
                    <Button variant="ghost" size="icon" onClick={() => remove(i.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
