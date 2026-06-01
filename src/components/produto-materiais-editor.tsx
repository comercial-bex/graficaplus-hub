import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Boxes } from "lucide-react";
import { toast } from "sonner";

type ProdutoMaterial = {
  id: string;
  produto_id: string;
  material_id: string;
  quantidade_por_unidade: number;
  observacao: string | null;
};

type Material = {
  id: string;
  nome: string;
  unidade: string;
  estoque: number;
};

export function ProdutoMateriaisEditor({
  produtoId,
  produtoUnidade,
}: {
  produtoId: string;
  produtoUnidade: string;
}) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [qtdNova, setQtdNova] = useState("1");
  const [selectedMat, setSelectedMat] = useState<Material | null>(null);

  const { data: mapeamentos = [], isLoading } = useQuery({
    queryKey: ["produto-materiais", produtoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("produto_materiais" as any)
        .select("*")
        .eq("produto_id", produtoId);
      return (data ?? []) as unknown as ProdutoMaterial[];
    },
  });

  const { data: materiais = [] } = useQuery({
    queryKey: ["materiais-picker"],
    queryFn: async () => {
      const { data } = await supabase
        .from("materiais")
        .select("id, nome, unidade, estoque")
        .order("nome");
      return (data ?? []) as Material[];
    },
  });

  const matMap: Record<string, Material> = {};
  for (const m of materiais) matMap[m.id] = m;

  const jaAdicionados = new Set(mapeamentos.map((m) => m.material_id));
  const disponiveis = materiais.filter((m) => !jaAdicionados.has(m.id));

  async function adicionar() {
    if (!selectedMat) return toast.error("Selecione um material");
    const qtd = Number(qtdNova);
    if (!isFinite(qtd) || qtd <= 0) return toast.error("Quantidade inválida");
    const { error } = await supabase.from("produto_materiais" as any).insert({
      produto_id: produtoId,
      material_id: selectedMat.id,
      quantidade_por_unidade: qtd,
    });
    if (error) return toast.error(error.message);
    setSelectedMat(null);
    setQtdNova("1");
    qc.invalidateQueries({ queryKey: ["produto-materiais", produtoId] });
  }

  async function atualizar(id: string, novaQtd: string) {
    const qtd = Number(novaQtd);
    if (!isFinite(qtd) || qtd <= 0) return;
    const { error } = await supabase
      .from("produto_materiais" as any)
      .update({ quantidade_por_unidade: qtd })
      .eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["produto-materiais", produtoId] });
  }

  async function remover(id: string) {
    const { error } = await supabase
      .from("produto_materiais" as any)
      .delete()
      .eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["produto-materiais", produtoId] });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          Materiais consumidos
        </h3>
        <span className="text-xs text-muted-foreground">
          por {produtoUnidade} de produto
        </span>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start font-normal"
              >
                {selectedMat ? selectedMat.nome : "Selecionar material…"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[360px]" align="start">
              <Command>
                <CommandInput placeholder="Buscar material…" />
                <CommandList>
                  <CommandEmpty>Nenhum material disponível</CommandEmpty>
                  <CommandGroup>
                    {disponiveis.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.nome}
                        onSelect={() => {
                          setSelectedMat(m);
                          setPickerOpen(false);
                        }}
                      >
                        <div className="flex-1">
                          <div className="font-medium">{m.nome}</div>
                          <div className="text-xs text-muted-foreground">
                            estoque: {m.estoque} {m.unidade}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="w-32">
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={qtdNova}
            onChange={(e) => setQtdNova(e.target.value)}
            placeholder="Qtd"
          />
        </div>
        <div className="text-xs text-muted-foreground w-16 pb-2">
          {selectedMat ? selectedMat.unidade : "un"}
        </div>
        <Button type="button" onClick={adicionar} disabled={!selectedMat}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="border rounded-md">
        {isLoading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">Carregando…</div>
        ) : mapeamentos.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Nenhum material vinculado. Sem materiais cadastrados a baixa
            automática de estoque não funciona para este produto.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead className="text-right w-[140px]">Qtd / un</TableHead>
                <TableHead className="w-[80px]">Un</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mapeamentos.map((pm) => {
                const m = matMap[pm.material_id];
                return (
                  <TableRow key={pm.id}>
                    <TableCell>{m?.nome ?? "(removido)"}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        defaultValue={pm.quantidade_por_unidade}
                        className="h-8 text-right font-mono"
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (Number(v) !== pm.quantidade_por_unidade) atualizar(pm.id, v);
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m?.unidade ?? ""}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => remover(pm.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
