import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/produtos")({
  head: () => ({ meta: [{ title: "Produtos — BEX PRINT OS" }] }),
  component: ProdutosPage,
});

function ProdutosPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("");

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ["produtos", canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("produtos", canSeeFinancials)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("produtos").insert({
        nome,
        descricao: descricao || null,
        preco_base: canSeeFinancials && preco ? Number(preco) : null,
        ativo: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Produto cadastrado");
      qc.invalidateQueries({ queryKey: ["produtos"] });
      setOpen(false);
      setNome("");
      setDescricao("");
      setPreco("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos & Serviços</h1>
          <p className="text-muted-foreground">Catálogo da gráfica</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo produto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cadastrar produto</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Banner lona 440g"
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </div>
              {canSeeFinancials && (
                <div className="space-y-2">
                  <Label>Preço base (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={preco}
                    onChange={(e) => setPreco(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!nome || create.isPending}>
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">Carregando...</div>
          ) : produtos.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">Nenhum produto cadastrado</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Descrição</TableHead>
                  {canSeeFinancials && <TableHead className="text-right">Preço base</TableHead>}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate">
                      {p.descricao || "—"}
                    </TableCell>
                    {canSeeFinancials && (
                      <TableCell className="text-right font-mono">
                        {p.preco_base ? `R$ ${Number(p.preco_base).toFixed(2)}` : "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={p.ativo ? "default" : "secondary"}>
                        {p.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
