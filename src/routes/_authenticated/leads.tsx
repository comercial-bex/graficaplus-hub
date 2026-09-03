/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/module-data";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { UserCheck, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({ meta: [{ title: "Leads — BEX PRINT OS" }] }),
  component: LeadsPage,
});

const statusLabel: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  novo: { label: "Novo", variant: "secondary" },
  em_atendimento: { label: "Em atendimento", variant: "default" },
  orcamento: { label: "Orçamento", variant: "default" },
  ganho: { label: "Ganho", variant: "default" },
  perdido: { label: "Perdido", variant: "destructive" },
};

// O banco só aceita estes cinco (leads_status_check).
const ESTAGIOS = [
  { valor: "novo", rotulo: "Novo" },
  { valor: "em_atendimento", rotulo: "Em atendimento" },
  { valor: "orcamento", rotulo: "Orçamento" },
];

// Origem era fixa em "Manual" no código: todo lead nascia com o mesmo canal, e a
// quebra por origem do Funil não servia para nada. Lista curta e editável de
// verdade, porque a pergunta "de onde veio esse cliente" é a que decide onde
// gastar em divulgação.
const ORIGENS = [
  "Indicação",
  "Instagram",
  "Facebook",
  "Google",
  "WhatsApp",
  "Balcão",
  "Cliente antigo",
  "Outra",
];

const funilMeta = [
  { key: "novo", etapa: "Novos", cor: "bg-blue-500" },
  { key: "em_atendimento", etapa: "Em atendimento", cor: "bg-amber-500" },
  { key: "orcamento", etapa: "Orçamento", cor: "bg-violet-500" },
  { key: "ganho", etapa: "Ganhos", cor: "bg-emerald-500" },
  { key: "perdido", etapa: "Perdidos", cor: "bg-rose-500" },
];

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const vazio = {
  nome: "",
  telefone: "",
  email: "",
  empresa: "",
  documento: "",
  origem: "Indicação",
  campanha: "",
  interesse: "",
  valor_potencial: "",
};

function LeadsPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeCriar = hasPermission("leads.create");
  const podeEditar = hasPermission("leads.update");
  const podeConverter = hasPermission("leads.convert");

  const [form, setForm] = useState({ ...vazio });
  const [converter, setConverter] = useState<any | null>(null);
  const [comOrcamento, setComOrcamento] = useState(true);
  const [perder, setPerder] = useState<any | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await db
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("leads").insert({
        nome: form.nome.trim(),
        // Telefone é o que permite reconhecer um cliente que já existe na hora
        // de converter. Sem ele, o mesmo cliente entra duas vezes.
        telefone: form.telefone.trim() || null,
        email: form.email.trim() || null,
        empresa: form.empresa.trim() || null,
        documento: form.documento.trim() || null,
        origem: form.origem,
        campanha: form.campanha.trim() || null,
        interesse: form.interesse.trim() || null,
        valor_potencial: form.valor_potencial ? Number(form.valor_potencial) : null,
        status: "novo",
        etapa: "novo",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead criado");
      setForm({ ...vazio });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudarEstagio = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db.from("leads").update({ status, etapa: status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const converterLead = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("converter_lead_em_cliente", {
        p_lead_id: converter.id,
        p_dados: {},
        p_criar_orcamento: comOrcamento,
      });
      if (error) throw error;
      return data as {
        cliente_id: string;
        orcamento_id: string | null;
        cliente_existente?: boolean;
        idempotent?: boolean;
      };
    },
    onSuccess: (r) => {
      if (r.idempotent) {
        toast.info("Este lead já tinha virado cliente.");
      } else if (r.cliente_existente) {
        // Reaproveitar em vez de duplicar é o comportamento certo, mas quem
        // clicou precisa saber que não nasceu cadastro novo.
        toast.success(
          r.orcamento_id
            ? "Cliente já existia — reaproveitado, e o orçamento foi aberto."
            : "Cliente já existia e foi reaproveitado, sem cadastro duplicado.",
        );
      } else {
        toast.success(r.orcamento_id ? "Cliente criado e orçamento aberto." : "Cliente criado.");
      }
      setConverter(null);
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["funil"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const perderLead = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("marcar_lead_perdido", {
        p_lead_id: perder.id,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead fechado como perdido, com o motivo registrado.");
      setPerder(null);
      setMotivo("");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["funil"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const campo = (k: keyof typeof vazio, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          Quem procurou a gráfica e ainda não virou cliente.{" "}
          <Link to="/funil" className="underline">
            Ver o funil completo
          </Link>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {funilMeta.map((f) => (
          <Card key={f.key}>
            <CardContent className="p-4">
              <div className={`${f.cor} h-1 w-12 rounded mb-2`} />
              <div className="text-2xl font-bold">
                {leads.filter((l: any) => l.status === f.key).length}
              </div>
              <div className="text-xs text-muted-foreground">{f.etapa}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {podeCriar && (
        <Card>
          <CardHeader>
            <CardTitle>Novo lead</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="nome" className="text-xs">Nome *</Label>
              <Input id="nome" value={form.nome} onChange={(e) => campo("nome", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="telefone" className="text-xs">Telefone</Label>
              <Input
                id="telefone"
                value={form.telefone}
                onChange={(e) => campo("telefone", e.target.value)}
                placeholder="(96) 99999-0000"
              />
            </div>
            <div>
              <Label htmlFor="email" className="text-xs">E-mail</Label>
              <Input id="email" value={form.email} onChange={(e) => campo("email", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="empresa" className="text-xs">Empresa</Label>
              <Input id="empresa" value={form.empresa} onChange={(e) => campo("empresa", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="documento" className="text-xs">CPF / CNPJ</Label>
              <Input
                id="documento"
                value={form.documento}
                onChange={(e) => campo("documento", e.target.value)}
                placeholder="usado para não duplicar cliente"
              />
            </div>
            <div>
              <Label htmlFor="origem" className="text-xs">Origem *</Label>
              <Select value={form.origem} onValueChange={(v) => campo("origem", v)}>
                <SelectTrigger id="origem">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGENS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="campanha" className="text-xs">Campanha</Label>
              <Input
                id="campanha"
                value={form.campanha}
                onChange={(e) => campo("campanha", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="valor" className="text-xs">Valor potencial (R$)</Label>
              <Input
                id="valor"
                type="number"
                min="0"
                step="0.01"
                value={form.valor_potencial}
                onChange={(e) => campo("valor_potencial", e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Label htmlFor="interesse" className="text-xs">O que ele quer</Label>
              <Input
                id="interesse"
                value={form.interesse}
                onChange={(e) => campo("interesse", e.target.value)}
                placeholder="Banner 3x1, adesivo de frota, fachada…"
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => create.mutate()}
                disabled={!form.nome.trim() || create.isPending}
              >
                {create.isPending ? "Criando…" : "Criar lead"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Leads recentes</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">Carregando...</div>
          ) : leads.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhum lead cadastrado ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Interesse</TableHead>
                    <TableHead className="text-right">Potencial</TableHead>
                    <TableHead>Estágio</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((l: any) => {
                    const fechado = !!l.cliente_id || l.status === "perdido";
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="font-medium">{l.nome}</div>
                          {l.empresa && (
                            <div className="text-xs text-muted-foreground">{l.empresa}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {l.telefone || l.email ? (
                            <>
                              <div>{l.telefone || "—"}</div>
                              {l.email && (
                                <div className="text-xs text-muted-foreground">{l.email}</div>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-amber-600">sem contato</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {l.origem || "—"}
                          {l.campanha && (
                            <div className="text-xs text-muted-foreground">{l.campanha}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{l.interesse || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {l.valor_potencial ? brl(l.valor_potencial) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusLabel[l.status]?.variant ?? "outline"}>
                            {statusLabel[l.status]?.label ?? l.status}
                          </Badge>
                          {l.motivo_perda && (
                            <div className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
                              {l.motivo_perda}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {fechado ? (
                            <span className="text-xs text-muted-foreground">
                              {l.cliente_id ? "virou cliente" : "encerrado"}
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              {podeEditar && (
                                <Select
                                  value={l.status}
                                  onValueChange={(v) => mudarEstagio.mutate({ id: l.id, status: v })}
                                >
                                  <SelectTrigger className="h-8 w-[10rem]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ESTAGIOS.map((e) => (
                                      <SelectItem key={e.valor} value={e.valor}>
                                        {e.rotulo}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              {podeConverter && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setConverter(l);
                                    setComOrcamento(true);
                                  }}
                                >
                                  <UserCheck className="mr-1 h-4 w-4" />
                                  Converter
                                </Button>
                              )}
                              {podeEditar && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setPerder(l);
                                    setMotivo("");
                                  }}
                                >
                                  <XCircle className="mr-1 h-4 w-4" />
                                  Perdido
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!converter} onOpenChange={(o) => !o && setConverter(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converter em cliente</DialogTitle>
            <DialogDescription>
              {converter?.nome} entra no cadastro de clientes. Se o telefone ou o CPF/CNPJ já
              existirem, o cliente é reaproveitado em vez de duplicado.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={comOrcamento}
              onCheckedChange={(c) => setComOrcamento(c === true)}
              className="mt-0.5"
            />
            <span>
              Já abrir o orçamento
              {converter?.valor_potencial ? ` de ${brl(converter.valor_potencial)}` : ""}
              <span className="block text-xs text-muted-foreground">
                O orçamento nasce amarrado a este lead — é assim que a origem chega até a OS.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConverter(null)}>
              Cancelar
            </Button>
            <Button onClick={() => converterLead.mutate()} disabled={converterLead.isPending}>
              {converterLead.isPending ? "Convertendo…" : "Converter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!perder} onOpenChange={(o) => !o && setPerder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como perdido</DialogTitle>
            <DialogDescription>
              Por que {perder?.nome} não fechou? É esse registro que evita perder o próximo pelo
              mesmo motivo.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Achou caro · prazo longo · fechou com concorrente · sumiu"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPerder(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => perderLead.mutate()}
              disabled={!motivo.trim() || perderLead.isPending}
            >
              {perderLead.isPending ? "Salvando…" : "Marcar perdido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
