import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ArrowRight, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { DataPanel } from "@/components/bex/DataPanel";
import { mensagemErro } from "@/lib/erros";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo, dicaTela } from "@/lib/dicas";

export const Route = createFileRoute("/_authenticated/orcamentos/")({
  head: () => ({ meta: [{ title: "Orçamentos — BEX PRINT OS" }] }),
  component: OrcamentosPage,
});

const statusTone: Record<string, "cyan" | "magenta" | "lime" | "amber" | "muted"> = {
  rascunho: "muted",
  enviado: "cyan",
  aprovado: "lime",
  rejeitado: "magenta",
  expirado: "amber",
  convertido: "lime",
};
const statusLabel: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  expirado: "Expirado",
  convertido: "Convertido em OS",
};

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function OrcamentosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canSeeFinancials } = useAuth();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const [form, setForm] = useState({
    cliente_id: "",
    contato_nome: "",
    contato_telefone: "",
    contato_email: "",
    titulo: "",
  });

  const { data: orcamentos = [], isLoading } = useQuery({
    queryKey: ["orcamentos", canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("orcamentos", canSeeFinancials)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-select"],
    queryFn: async () => {
      const { data } = await supabase.from("clientes").select("id, nome").order("nome");
      return data ?? [];
    },
  });

  // Orçamentos originados no módulo 3D (para exibir tipo e link no funil único)
  const { data: mapa3d = {} } = useQuery({
    queryKey: ["orcamentos-3d-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orcamentos_3d")
        .select("id, orcamento_id")
        .not("orcamento_id", "is", null);
      const map: Record<string, string> = {};
      for (const r of data ?? []) if (r.orcamento_id) map[r.orcamento_id] = r.id;
      return map;
    },
  });

  async function handleCreate() {
    if (!form.titulo) return toast.error("Título é obrigatório");
    if (!form.cliente_id && !form.contato_nome.trim())
      return toast.error("Informe um cliente cadastrado ou o nome do contato");
    const { data: criado, error } = await supabase
      .from("orcamentos")
      .insert({
        cliente_id: form.cliente_id || null,
        contato_nome: form.cliente_id ? null : form.contato_nome.trim(),
        contato_telefone: form.cliente_id ? null : form.contato_telefone.trim() || null,
        contato_email: form.cliente_id ? null : form.contato_email.trim() || null,
        titulo: form.titulo,
        valor_total: 0,
        valor_subtotal: 0,
      } as any)
      .select("id")
      .single();
    if (error) return toast.error(mensagemErro(error));
    toast.success("Orçamento criado — lance os produtos");
    setOpen(false);
    setForm({
      cliente_id: "",
      contato_nome: "",
      contato_telefone: "",
      contato_email: "",
      titulo: "",
    });
    qc.invalidateQueries({ queryKey: ["orcamentos"] });
    const novoId = (criado as { id: string } | null)?.id;
    if (novoId) navigate({ to: "/orcamentos/$id", params: { id: novoId } });
  }

  async function converterEmOS(orc: any) {
    if (!orc.cliente_id)
      return toast.error(
        "Vincule um cliente cadastrado a este orçamento antes de convertê-lo em OS.",
      );
    const orc3dId = mapa3d[orc.id];
    const { data, error } = orc3dId
      ? await (supabase.rpc as any)("converter_orcamento_3d_em_os", { p_orcamento_3d_id: orc3dId })
      : await (supabase.rpc as any)("converter_orcamento_em_os", {
          p_orcamento_id: orc.id,
          p_opcoes: {},
        });
    if (error) return toast.error(mensagemErro(error));
    const osId = typeof data === "object" && data && "os_id" in data ? String((data as any).os_id) : "";
    toast.success(`OS criada${osId ? ` (${osId})` : ""}`);
    qc.invalidateQueries({ queryKey: ["orcamentos"] });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/orcamentos")}
        breadcrumb="Print OS · Comercial"
        title="Orçamentos"
        description="Propostas comerciais e conversão em Ordens de Serviço."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Novo orçamento
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo orçamento</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">Cliente<DicaIcone texto={dicaCampo("/orcamentos", "Cliente")} rotulo="Cliente" /></Label>
                  <Select
                    value={form.cliente_id || "__avulso"}
                    onValueChange={(v) =>
                      setForm({ ...form, cliente_id: v === "__avulso" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__avulso">Sem cadastro (contato avulso)</SelectItem>
                      {clientes.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    O cliente cadastrado só é exigido na conversão em OS.
                  </p>
                </div>
                {!form.cliente_id && (
                  <div className="grid gap-3 sm:grid-cols-3 rounded-lg border border-border/60 bg-card/40 p-3">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">Nome do contato *<DicaIcone texto={dicaCampo("/orcamentos", "Nome do contato *")} rotulo="Nome do contato *" /></Label>
                      <Input
                        value={form.contato_nome}
                        onChange={(e) => setForm({ ...form, contato_nome: e.target.value })}
                        placeholder="Ex.: Marina (Instagram)"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">Telefone<DicaIcone texto={dicaCampo("/orcamentos", "Telefone")} rotulo="Telefone" /></Label>
                      <Input
                        value={form.contato_telefone}
                        onChange={(e) => setForm({ ...form, contato_telefone: e.target.value })}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">E-mail<DicaIcone texto={dicaCampo("/orcamentos", "E-mail")} rotulo="E-mail" /></Label>
                      <Input
                        value={form.contato_email}
                        onChange={(e) => setForm({ ...form, contato_email: e.target.value })}
                        placeholder="contato@email.com"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">Título *<DicaIcone texto={dicaCampo("/orcamentos", "Título *")} rotulo="Título *" /></Label>
                  <Input
                    value={form.titulo}
                    onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  O valor é calculado automaticamente pelos produtos que você lançar na próxima
                  tela.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate}>Criar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Orçamentos em aberto" value={kpis.abertos} tone="cyan" icon={FileText} />
        <KpiCard
          label="Aguardando aprovação"
          value={kpis.enviados}
          tone="amber"
          hint={canSeeFinancials ? `Total ${moeda(kpis.valorEnviados)}` : undefined}
        />
        <KpiCard label="Convertidos em OS" value={kpis.convertidos} tone="magenta" />
        <KpiCard
          label={canSeeFinancials ? "Valor total" : "Total de orçamentos"}
          value={canSeeFinancials ? moeda(kpis.valorTotal) : orcamentos.length}
          tone="cyan"
        />
      </div>

      <DataPanel
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar orçamento..."
        rodape={
          <>
            <span>
              Mostrando {filtrados.length} de {orcamentos.length} orçamentos
            </span>
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              {canSeeFinancials && <TableHead>Valor</TableHead>}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtrados.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Nenhum orçamento
                </TableCell>
              </TableRow>
            )}
            {filtrados.map((o: any) => {
              return (
                <TableRow
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: "/orcamentos/$id", params: { id: o.id } })}
                >
                  <TableCell className="font-mono text-xs text-[color:var(--bex-cyan)]">
                    #{o.numero}
                  </TableCell>
                  <TableCell className="font-bold text-foreground">{o.titulo}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {mapa3d[o.id] ? (
                      <Link to="/orcamento-3d/$id" params={{ id: mapa3d[o.id] }}>
                        <StatusChip label="Impressão 3D" tone="magenta" />
                      </Link>
                    ) : (
                      <StatusChip label="Comunicação visual" tone="cyan" />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.cliente_nome ?? (
                      <span className="inline-flex items-center gap-1.5">
                        {o.contato_nome ?? "—"}
                        <StatusChip label="sem cadastro" tone="amber" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={statusLabel[o.status] ?? o.status}
                      tone={statusTone[o.status] ?? "muted"}
                    />
                  </TableCell>
                  {canSeeFinancials && (
                    <TableCell className="font-bold text-foreground">
                      {moeda(Number(o.valor_total))}
                    </TableCell>
                  )}
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {o.status !== "convertido" && (
                      <Button size="sm" variant="outline" onClick={() => converterEmOS(o)}>
                        Converter em OS <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataPanel>

    </div>
  );
}
