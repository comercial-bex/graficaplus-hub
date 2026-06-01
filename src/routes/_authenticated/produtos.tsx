import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Search,
  Copy,
  Trash2,
  Pencil,
  Upload,
  Download,
  MoreVertical,
  LayoutGrid,
  Rows3,
  Calculator,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  CATEGORIAS,
  UNIDADES,
  TIPOS,
  type Produto,
  categoriaLabel,
  calcMargem,
  calcMarkup,
  margemStatus,
  formatBRL,
  parseCSV,
  toCSV,
} from "@/lib/produtos-catalogo";
import { ProdutoMateriaisEditor } from "@/components/produto-materiais-editor";

export const Route = createFileRoute("/_authenticated/produtos")({
  head: () => ({ meta: [{ title: "Produtos & Serviços — BEX PRINT OS" }] }),
  component: ProdutosPage,
});

type FormState = {
  id?: string;
  sku: string;
  nome: string;
  descricao: string;
  categoria: string;
  tipo: "produto" | "servico";
  unidade: string;
  custo_medio: string;
  preco_base: string;
  margem_minima: string;
  tempo_producao_min: string;
  observacoes_internas: string;
  ativo: boolean;
};

const emptyForm: FormState = {
  sku: "",
  nome: "",
  descricao: "",
  categoria: "outros",
  tipo: "produto",
  unidade: "un",
  custo_medio: "0",
  preco_base: "0",
  margem_minima: "40",
  tempo_producao_min: "",
  observacoes_internas: "",
  ativo: true,
};

function ProdutosPage() {
  const qc = useQueryClient();
  const { canSeeFinancials, hasRole } = useAuth();
  const isAdmin = hasRole("admin") || hasRole("gestor");

  const [busca, setBusca] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState<string>("todas");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [view, setView] = useState<"tabela" | "grid">("tabela");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<Produto | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ["produtos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Produto[];
    },
  });

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (!mostrarInativos && !p.ativo) return false;
      if (filtroCategoria !== "todas" && p.categoria !== filtroCategoria) return false;
      if (filtroTipo !== "todos" && p.tipo !== filtroTipo) return false;
      if (!q) return true;
      return (
        p.nome.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.descricao ?? "").toLowerCase().includes(q)
      );
    });
  }, [produtos, busca, filtroCategoria, filtroTipo, mostrarInativos]);

  const stats = useMemo(() => {
    const total = produtos.length;
    const ativos = produtos.filter((p) => p.ativo).length;
    const margens = produtos
      .map((p) => calcMargem(Number(p.custo_medio), Number(p.preco_base ?? 0)))
      .filter((m): m is number => m !== null);
    const mediaMargem = margens.length
      ? margens.reduce((a, b) => a + b, 0) / margens.length
      : 0;
    return { total, ativos, mediaMargem };
  }, [produtos]);

  const upsert = useMutation({
    mutationFn: async (f: FormState) => {
      const payload = {
        sku: f.sku.trim() || null,
        nome: f.nome.trim(),
        descricao: f.descricao.trim() || null,
        categoria: f.categoria,
        tipo: f.tipo,
        unidade: f.unidade,
        custo_medio: canSeeFinancials ? Number(f.custo_medio) || 0 : undefined,
        preco_base: Number(f.preco_base) || 0,
        margem_minima: canSeeFinancials ? Number(f.margem_minima) || 0 : undefined,
        tempo_producao_min: f.tempo_producao_min
          ? Number(f.tempo_producao_min)
          : null,
        observacoes_internas: f.observacoes_internas.trim() || null,
        ativo: f.ativo,
      };
      // Strip undefined so we don't overwrite custo/margem when vendedor edits
      Object.keys(payload).forEach(
        (k) =>
          (payload as Record<string, unknown>)[k] === undefined &&
          delete (payload as Record<string, unknown>)[k],
      );
      if (f.id) {
        const { error } = await supabase
          .from("produtos")
          .update(payload as never)
          .eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("produtos")
          .insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Produto atualizado" : "Produto cadastrado");
      qc.invalidateQueries({ queryKey: ["produtos"] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: async (p: Produto) => {
      const { error } = await supabase
        .from("produtos")
        .update({ ativo: !p.ativo } as never)
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      toast.success(p.ativo ? "Produto desativado" : "Produto ativado");
      qc.invalidateQueries({ queryKey: ["produtos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (p: Produto) => {
      const { error } = await supabase.from("produtos").delete().eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Produto excluído");
      qc.invalidateQueries({ queryKey: ["produtos"] });
      setConfirmDelete(null);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("violates foreign key")
          ? "Produto em uso em OS/orçamentos. Desative em vez de excluir."
          : e.message,
      ),
  });

  function abrirNovo() {
    setForm(emptyForm);
    setOpen(true);
  }
  function abrirEdicao(p: Produto) {
    setForm({
      id: p.id,
      sku: p.sku ?? "",
      nome: p.nome,
      descricao: p.descricao ?? "",
      categoria: p.categoria,
      tipo: p.tipo,
      unidade: p.unidade,
      custo_medio: String(p.custo_medio ?? 0),
      preco_base: String(p.preco_base ?? 0),
      margem_minima: String(p.margem_minima ?? 0),
      tempo_producao_min: p.tempo_producao_min ? String(p.tempo_producao_min) : "",
      observacoes_internas: p.observacoes_internas ?? "",
      ativo: p.ativo,
    });
    setOpen(true);
  }
  function duplicar(p: Produto) {
    setForm({
      sku: p.sku ? `${p.sku}-COPY` : "",
      nome: `${p.nome} (cópia)`,
      descricao: p.descricao ?? "",
      categoria: p.categoria,
      tipo: p.tipo,
      unidade: p.unidade,
      custo_medio: String(p.custo_medio ?? 0),
      preco_base: String(p.preco_base ?? 0),
      margem_minima: String(p.margem_minima ?? 0),
      tempo_producao_min: p.tempo_producao_min ? String(p.tempo_producao_min) : "",
      observacoes_internas: p.observacoes_internas ?? "",
      ativo: true,
    });
    setOpen(true);
  }

  function exportar() {
    const csv = toCSV(filtrados);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalogo-produtos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos & Serviços</h1>
          <p className="text-muted-foreground">
            Catálogo da gráfica — base para orçamentos, OS e estoque
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Importar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportar}>
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
          <Button onClick={abrirNovo}>
            <Plus className="h-4 w-4 mr-2" />
            Novo item
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Itens no catálogo</div>
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.ativos} ativos
            </div>
          </CardContent>
        </Card>
        {canSeeFinancials && (
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Margem média do catálogo</div>
              <div className="text-2xl font-bold">
                {stats.mediaMargem.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Categorias ativas</div>
            <div className="text-2xl font-bold">
              {new Set(produtos.filter((p) => p.ativo).map((p) => p.categoria)).size}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome, SKU ou descrição…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas categorias</SelectItem>
              {CATEGORIAS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Produto e serviço</SelectItem>
              <SelectItem value="produto">Produtos</SelectItem>
              <SelectItem value="servico">Serviços</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={mostrarInativos} onCheckedChange={setMostrarInativos} />
            Mostrar inativos
          </label>
          <div className="ml-auto flex border rounded-md">
            <Button
              variant={view === "tabela" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("tabela")}
            >
              <Rows3 className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground">Carregando…</CardContent>
        </Card>
      ) : filtrados.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Nenhum item encontrado com os filtros atuais
          </CardContent>
        </Card>
      ) : view === "tabela" ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-center">Un</TableHead>
                  {canSeeFinancials && (
                    <TableHead className="text-right">Custo</TableHead>
                  )}
                  <TableHead className="text-right">Preço</TableHead>
                  {canSeeFinancials && (
                    <TableHead className="text-right">Margem</TableHead>
                  )}
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((p) => {
                  const margem = calcMargem(
                    Number(p.custo_medio),
                    Number(p.preco_base ?? 0),
                  );
                  const status = margemStatus(margem, Number(p.margem_minima));
                  return (
                    <TableRow key={p.id} className={!p.ativo ? "opacity-50" : ""}>
                      <TableCell>
                        <div className="font-medium">{p.nome}</div>
                        <div className="text-xs text-muted-foreground flex gap-2">
                          {p.sku && <span className="font-mono">{p.sku}</span>}
                          {p.tipo === "servico" && <Badge variant="outline" className="text-[10px] h-4">serviço</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {categoriaLabel(p.categoria)}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {p.unidade}
                      </TableCell>
                      {canSeeFinancials && (
                        <TableCell className="text-right font-mono text-sm">
                          {formatBRL(Number(p.custo_medio))}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono">
                        {formatBRL(Number(p.preco_base))}
                      </TableCell>
                      {canSeeFinancials && (
                        <TableCell className="text-right">
                          <MargemBadge status={status} margem={margem} />
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant={p.ativo ? "default" : "secondary"}>
                          {p.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <RowActions
                          produto={p}
                          isAdmin={isAdmin}
                          onEdit={abrirEdicao}
                          onDuplicar={duplicar}
                          onToggle={(x) => toggleAtivo.mutate(x)}
                          onDelete={(x) => setConfirmDelete(x)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtrados.map((p) => {
            const margem = calcMargem(
              Number(p.custo_medio),
              Number(p.preco_base ?? 0),
            );
            const status = margemStatus(margem, Number(p.margem_minima));
            return (
              <Card key={p.id} className={!p.ativo ? "opacity-60" : ""}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium leading-tight">{p.nome}</div>
                      {p.sku && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {p.sku}
                        </div>
                      )}
                    </div>
                    <RowActions
                      produto={p}
                      isAdmin={isAdmin}
                      onEdit={abrirEdicao}
                      onDuplicar={duplicar}
                      onToggle={(x) => toggleAtivo.mutate(x)}
                      onDelete={(x) => setConfirmDelete(x)}
                    />
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {categoriaLabel(p.categoria)}
                  </Badge>
                  <div className="flex justify-between items-end pt-2 border-t">
                    <div>
                      <div className="text-xs text-muted-foreground">Preço / {p.unidade}</div>
                      <div className="font-mono font-semibold">
                        {formatBRL(Number(p.preco_base))}
                      </div>
                    </div>
                    {canSeeFinancials && <MargemBadge status={status} margem={margem} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProdutoFormDialog
        open={open}
        onOpenChange={setOpen}
        form={form}
        setForm={setForm}
        canSeeFinancials={canSeeFinancials}
        onSubmit={() => upsert.mutate(form)}
        saving={upsert.isPending}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["produtos"] });
          setImportOpen(false);
        }}
      />

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{confirmDelete?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente. Se o produto já foi usado em OS ou orçamentos,
              o histórico será afetado — prefira desativar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && remover.mutate(confirmDelete)}
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MargemBadge({
  status,
  margem,
}: {
  status: "ok" | "alerta" | "ruim" | "vazio";
  margem: number | null;
}) {
  if (status === "vazio") return <span className="text-muted-foreground text-xs">—</span>;
  const cls =
    status === "ok"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : status === "alerta"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  return (
    <Badge variant="outline" className={`font-mono ${cls}`}>
      {margem!.toFixed(1)}%
    </Badge>
  );
}

function RowActions({
  produto,
  isAdmin,
  onEdit,
  onDuplicar,
  onToggle,
  onDelete,
}: {
  produto: Produto;
  isAdmin: boolean;
  onEdit: (p: Produto) => void;
  onDuplicar: (p: Produto) => void;
  onToggle: (p: Produto) => void;
  onDelete: (p: Produto) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit(produto)}>
          <Pencil className="h-4 w-4 mr-2" />
          Editar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDuplicar(produto)}>
          <Copy className="h-4 w-4 mr-2" />
          Duplicar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onToggle(produto)}>
          {produto.ativo ? "Desativar" : "Ativar"}
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(produto)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProdutoFormDialog({
  open,
  onOpenChange,
  form,
  setForm,
  canSeeFinancials,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: FormState;
  setForm: (f: FormState) => void;
  canSeeFinancials: boolean;
  onSubmit: () => void;
  saving: boolean;
}) {
  const custo = Number(form.custo_medio) || 0;
  const preco = Number(form.preco_base) || 0;
  const minima = Number(form.margem_minima) || 0;
  const margem = calcMargem(custo, preco);
  const markup = calcMarkup(custo, preco);
  const status = margemStatus(margem, minima);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar item" : "Novo item do catálogo"}</DialogTitle>
          <DialogDescription>
            Produto físico ou serviço. Campos comerciais ficam ocultos para quem
            não tem acesso financeiro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Identificação */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Identificação
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Nome *</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Banner lona 440g"
                />
              </div>
              <div className="space-y-1.5">
                <Label>SKU</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="IGF-LONA-440"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select
                  value={form.categoria}
                  onValueChange={(v) => setForm({ ...form, categoria: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v: "produto" | "servico") =>
                    setForm({ ...form, tipo: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unidade</Label>
                <Select
                  value={form.unidade}
                  onValueChange={(v) => setForm({ ...form, unidade: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIDADES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Detalhes técnicos visíveis no orçamento"
                rows={2}
              />
            </div>
          </section>

          {/* Comercial */}
          {canSeeFinancials && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Comercial
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Custo médio (R$/{form.unidade})</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.custo_medio}
                    onChange={(e) =>
                      setForm({ ...form, custo_medio: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Preço de venda (R$/{form.unidade})</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.preco_base}
                    onChange={(e) =>
                      setForm({ ...form, preco_base: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Margem mínima (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.margem_minima}
                    onChange={(e) =>
                      setForm({ ...form, margem_minima: e.target.value })
                    }
                  />
                </div>
              </div>

              {/* Calculadora ao vivo */}
              <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Margem atual</div>
                  <div className="font-mono font-semibold">
                    <MargemBadge status={status} margem={margem} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Markup</div>
                  <div className="font-mono font-semibold">
                    {markup ? `${markup.toFixed(2)}x` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Lucro / un</div>
                  <div className="font-mono font-semibold">
                    {formatBRL(preco - custo)}
                  </div>
                </div>
                {status === "ruim" && (
                  <div className="col-span-3 text-xs text-red-600">
                    ⚠ Margem abaixo do mínimo definido ({minima}%). Reveja o preço
                    ou o custo.
                  </div>
                )}
                {status === "alerta" && (
                  <div className="col-span-3 text-xs text-amber-600">
                    Margem perto do limite mínimo ({minima}%).
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Produção */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Produção
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tempo estimado (min / {form.unidade})</Label>
                <Input
                  type="number"
                  value={form.tempo_producao_min}
                  onChange={(e) =>
                    setForm({ ...form, tempo_producao_min: e.target.value })
                  }
                  placeholder="ex.: 8"
                />
              </div>
              <div className="space-y-1.5 flex items-end">
                <label className="flex items-center gap-2 text-sm pb-2">
                  <Switch
                    checked={form.ativo}
                    onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                  />
                  Item ativo no catálogo
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observações internas</Label>
              <Textarea
                value={form.observacoes_internas}
                onChange={(e) =>
                  setForm({ ...form, observacoes_internas: e.target.value })
                }
                placeholder="Gramatura, tinta, fornecedor preferido — não aparece para o cliente"
                rows={2}
              />
            </div>
          </section>

          {/* Materiais consumidos — só faz sentido em itens existentes */}
          {form.id && form.tipo === "produto" && (
            <ProdutoMateriaisEditor produtoId={form.id} produtoUnidade={form.unidade} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" asChild>
            <a href="/precificacao">
              <Calculator className="h-4 w-4 mr-2" />
              Abrir calculadora
            </a>
          </Button>
          <Button onClick={onSubmit} disabled={!form.nome || saving}>
            {saving ? "Salvando…" : form.id ? "Salvar alterações" : "Cadastrar item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);

  function baixarModelo() {
    const csv =
      "sku,nome,categoria,tipo,unidade,custo_medio,preco_base,margem_minima,tempo_producao_min,descricao\n" +
      "EX-001,Exemplo Banner 440g,impressao_grande_formato,produto,m2,48,95,40,10,Exemplo de produto\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-produtos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) return toast.error("Arquivo > 500KB");
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) return toast.error("CSV vazio ou inválido");
    if (rows.length > 500) return toast.error("Máximo 500 linhas por importação");
    setPreview(rows);
  }

  async function importar() {
    setImporting(true);
    try {
      const payload = preview
        .filter((r) => r.nome)
        .map((r) => ({
          sku: r.sku || null,
          nome: r.nome,
          descricao: r.descricao || null,
          categoria: (r.categoria || "outros") as string,
          tipo: (r.tipo === "servico" ? "servico" : "produto") as string,
          unidade: r.unidade || "un",
          custo_medio: Number(r.custo_medio) || 0,
          preco_base: Number(r.preco_base) || 0,
          margem_minima: Number(r.margem_minima) || 30,
          tempo_producao_min: r.tempo_producao_min ? Number(r.tempo_producao_min) : null,
          ativo: true,
        }));
      const { error } = await supabase.from("produtos").upsert(payload as never, {
        onConflict: "sku",
      });
      if (error) throw error;
      toast.success(`${payload.length} itens importados`);
      setPreview([]);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar catálogo via CSV</DialogTitle>
          <DialogDescription>
            Use o modelo abaixo. Itens com SKU existente são atualizados; novos
            são criados. Máximo 500 linhas por arquivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={baixarModelo}>
              <Download className="h-4 w-4 mr-2" />
              Baixar modelo
            </Button>
            <Input ref={fileRef} type="file" accept=".csv" onChange={onFile} />
          </div>
          {preview.length > 0 && (
            <div className="border rounded max-h-[300px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 50).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell>{r.nome}</TableCell>
                      <TableCell className="text-xs">{r.categoria}</TableCell>
                      <TableCell className="text-right font-mono">
                        {r.preco_base}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.length > 50 && (
                <div className="p-2 text-xs text-muted-foreground text-center">
                  +{preview.length - 50} linhas adicionais
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={importar}
            disabled={preview.length === 0 || importing}
          >
            {importing ? "Importando…" : `Importar ${preview.length} itens`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
