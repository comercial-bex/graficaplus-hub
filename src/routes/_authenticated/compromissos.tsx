/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { AlertTriangle, CalendarClock, CheckCheck, Plus, Repeat, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  custoMensal,
  parcelaAtual,
  progresso,
  saldoDevedorTotal,
  situacao,
  terminaEm,
  totalAtrasado,
  type Compromisso,
} from "@/domain/financeiro/compromissos";

export const Route = createFileRoute("/_authenticated/compromissos")({
  head: () => ({ meta: [{ title: "Compromissos e despesas fixas — BEX PRINT OS" }] }),
  component: CompromissosPage,
});

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dia = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—";

const hoje = () => new Date().toISOString().slice(0, 10);

const TIPOS = [
  ["financiamento", "Financiamento"],
  ["locacao", "Locação"],
  ["aluguel", "Aluguel"],
  ["assinatura", "Assinatura / software"],
  ["emprestimo", "Empréstimo"],
  ["imposto", "Imposto parcelado"],
  ["consorcio", "Consórcio"],
  ["outro", "Outro"],
] as const;

const PERIODICIDADES = [
  ["mensal", "Mensal"],
  ["semanal", "Semanal"],
  ["quinzenal", "Quinzenal"],
  ["bimestral", "Bimestral"],
  ["trimestral", "Trimestral"],
  ["semestral", "Semestral"],
  ["anual", "Anual"],
] as const;

const vazio = {
  descricao: "",
  credor: "",
  credor_documento: "",
  tipo: "financiamento",
  categoria: "",
  numero_contrato: "",
  valor_parcela: "",
  total_parcelas: "",
  primeira_parcela: hoje(),
  periodicidade: "mensal",
  valor_entrada: "0",
  maquina_id: "",
  observacoes: "",
};

/**
 * Compromissos e despesas fixas.
 *
 * O que existia era `contas_pagar` com uma caixinha "recorrente" e um campo
 * "periodicidade" que NADA lia: nem função, nem cron, nem gatilho. Marcar a
 * caixinha dava a sensação de que o sistema ia lembrar da próxima parcela, e a
 * próxima parcela nunca aparecia.
 *
 * Aqui a obrigação (o contrato) é separada da parcela (a conta do mês). Um
 * financiamento de 36 meses deixa de ser 36 linhas soltas e vira uma coisa só,
 * que sabe responder quanto ainda se deve, em que parcela se está e quando
 * acaba.
 */
function CompromissosPage() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(vazio);
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const { data: compromissos = [], isLoading } = useQuery({
    queryKey: ["compromissos"],
    queryFn: async (): Promise<Compromisso[]> => {
      const { data, error } = await (supabase as any)
        .from("vw_compromissos")
        .select("*")
        .order("ativo", { ascending: false })
        .order("proximo_vencimento", { nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        ...c,
        valor_parcela: Number(c.valor_parcela ?? 0),
        valor_entrada: Number(c.valor_entrada ?? 0),
        valor_total: c.valor_total == null ? null : Number(c.valor_total),
        valor_pago: Number(c.valor_pago ?? 0),
        valor_aberto: Number(c.valor_aberto ?? 0),
        valor_atrasado: Number(c.valor_atrasado ?? 0),
        saldo_devedor: c.saldo_devedor == null ? null : Number(c.saldo_devedor),
      }));
    },
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ["compromissos-maquinas"],
    queryFn: async () => {
      const { data } = await supabase.from("maquinas").select("id, nome").eq("ativa", true).order("nome");
      return data ?? [];
    },
  });

  const { data: parcelas = [] } = useQuery({
    queryKey: ["compromisso-parcelas", detalhe],
    enabled: !!detalhe,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_pagar")
        .select("id, parcela_numero, descricao, valor, vencimento, status, data_pagamento")
        .eq("compromisso_id", detalhe!)
        .order("parcela_numero");
      if (error) throw error;
      return data ?? [];
    },
  });

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["compromissos"] });
    qc.invalidateQueries({ queryKey: ["compromisso-parcelas"] });
    qc.invalidateQueries({ queryKey: ["contas-pagar"] });
    qc.invalidateQueries({ queryKey: ["vw-fluxo-caixa"] });
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("compromissos_financeiros").insert({
        descricao: form.descricao,
        credor: form.credor,
        credor_documento: form.credor_documento || null,
        tipo: form.tipo,
        categoria: form.categoria || null,
        numero_contrato: form.numero_contrato || null,
        valor_parcela: Number(form.valor_parcela.replace(",", ".")) || 0,
        // Vazio quer dizer SEM FIM (aluguel, assinatura), não zero parcelas.
        total_parcelas: form.total_parcelas ? Number(form.total_parcelas) : null,
        primeira_parcela: form.primeira_parcela,
        periodicidade: form.periodicidade,
        valor_entrada: Number(form.valor_entrada.replace(",", ".")) || 0,
        maquina_id: form.maquina_id || null,
        observacoes: form.observacoes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Compromisso cadastrado — agora gere as parcelas");
      recarregar();
      setAberto(false);
      setForm(vazio);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const gerar = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase.rpc as any)("gerar_parcelas_compromisso", {
        p_compromisso_id: id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (r: any) => {
      const criadas = Number(r?.parcelas_criadas ?? 0);
      const ajustadas = Number(r?.parcelas_ajustadas ?? 0);
      // Contar o que a escrita fez, não supor que fez: "gerou" sem número
      // esconde o caso em que nada foi criado porque já estava tudo lá.
      if (criadas === 0 && ajustadas === 0) toast.info("Nada a fazer — as parcelas já estão todas lançadas");
      else
        toast.success(
          [criadas > 0 && `${criadas} parcela(s) lançada(s)`, ajustadas > 0 && `${ajustadas} realinhada(s)`]
            .filter(Boolean)
            .join(" · "),
        );
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase.rpc as any)("quitar_parcelas_ate", {
        p_compromisso_id: id,
        p_ate: hoje(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (r: any) => {
      const n = Number(r?.parcelas_quitadas ?? 0);
      if (n === 0) toast.info("Nenhuma parcela vencida em aberto");
      else toast.success(`${n} parcela(s) marcada(s) como paga(s)`);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mensal = custoMensal(compromissos);
  const devedor = saldoDevedorTotal(compromissos);
  const atrasado = totalAtrasado(compromissos);
  const semParcelas = compromissos.filter((c) => c.ativo && situacao(c) === "sem_parcelas");

  const campo = (
    chave: keyof typeof vazio,
    rotulo: string,
    placeholder = "",
    tipo = "text",
  ) => (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      <Input
        type={tipo}
        className={tipo === "number" ? "font-mono" : ""}
        placeholder={placeholder}
        value={form[chave]}
        onChange={(e) => setForm((f) => ({ ...f, [chave]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Compromissos e despesas fixas"
        description="Financiamentos, locações, aluguéis e assinaturas — o que sai todo mês e por quanto tempo ainda"
        actions={
          <Button onClick={() => setAberto(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo compromisso
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Sai por mês" value={brl(mensal)} icon={Repeat} />
        <KpiCard label="Saldo devedor" value={brl(devedor)} icon={Wallet} />
        <KpiCard label="Vencido em aberto" value={brl(atrasado)} icon={AlertTriangle} />
        <KpiCard label="Compromissos ativos" value={String(compromissos.filter((c) => c.ativo).length)} icon={CalendarClock} />
      </div>

      {/* Diagnóstico só no banco não muda comportamento: o aviso diz o que
          fazer e some sozinho quando está resolvido. */}
      {semParcelas.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <strong>
              {semParcelas.length === 1
                ? "1 compromisso está cadastrado e não gerou nenhuma parcela"
                : `${semParcelas.length} compromissos estão cadastrados e não geraram nenhuma parcela`}
              .
            </strong>{" "}
            Sem parcela nada vence, nada atrasa e o fluxo de caixa não sabe que
            existe. Clique em <em>Gerar parcelas</em> em {semParcelas.map((c) => c.descricao).join(", ")}.
          </div>
        </div>
      )}

      {atrasado > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            Há <strong>{brl(atrasado)}</strong> em parcelas vencidas e ainda em aberto. Se
            elas já foram pagas antes de o sistema existir, use{" "}
            <em>Quitar vencidas</em> no compromisso — isso marca a obrigação como
            cumprida e <strong>não</strong> lança movimento de caixa, porque aquele
            dinheiro saiu de uma conta que este sistema não acompanhava.
          </div>
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Carregando…</CardContent>
        </Card>
      ) : compromissos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum compromisso cadastrado. Financiamento de máquina, locação, aluguel da
            loja e assinatura de software entram aqui — cada um gera as suas contas a pagar.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {compromissos.map((c) => {
            const s = situacao(c);
            const atual = parcelaAtual(c);
            const fim = terminaEm(c);
            const pct = progresso(c);
            return (
              <Card key={c.id} className={c.ativo ? "" : "opacity-60"}>
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{c.descricao}</h3>
                        <Badge variant="outline" className="font-normal capitalize">{c.tipo}</Badge>
                        {s === "atrasado" && <Badge variant="destructive">{c.parcelas_atrasadas} vencida(s)</Badge>}
                        {s === "sem_parcelas" && (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-500 hover:bg-amber-500/15">
                            sem parcelas
                          </Badge>
                        )}
                        {s === "quitado" && <Badge variant="secondary">quitado</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {c.credor}
                        {c.numero_contrato && ` · contrato ${c.numero_contrato}`}
                        {(c as any).maquina_nome && ` · ${(c as any).maquina_nome}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-lg">{brl(c.valor_parcela)}</div>
                      <div className="text-xs text-muted-foreground">
                        por {c.periodicidade === "mensal" ? "mês" : c.periodicidade}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4 text-sm">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Parcela</div>
                      <div className="font-bold font-mono">
                        {atual ? `${atual.numero} de ${atual.de}` : "sem fim"}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Já pago</div>
                      <div className="font-bold font-mono">{brl(c.valor_pago)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Ainda devo</div>
                      <div className="font-bold font-mono">{c.saldo_devedor == null ? "—" : brl(c.saldo_devedor)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Próxima</div>
                      <div className="font-bold font-mono">{dia(c.proximo_vencimento)}</div>
                    </div>
                  </div>

                  {c.total_parcelas != null && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct * 100}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(pct * 100).toFixed(0)}% pago
                        {fim && ` · termina em ${fim.toLocaleDateString("pt-BR")}`}
                      </div>
                    </div>
                  )}

                  {c.observacoes && (
                    <details className="rounded-md border bg-muted/30 p-2">
                      <summary className="cursor-pointer text-xs font-medium">Detalhes do contrato</summary>
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{c.observacoes}</p>
                    </details>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={gerar.isPending} onClick={() => gerar.mutate(c.id)}>
                      <Repeat className="h-3.5 w-3.5 mr-1" /> Gerar parcelas
                    </Button>
                    {c.parcelas_atrasadas > 0 && (
                      <Button size="sm" variant="outline" disabled={quitar.isPending} onClick={() => quitar.mutate(c.id)}>
                        <CheckCheck className="h-3.5 w-3.5 mr-1" /> Quitar vencidas
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDetalhe(detalhe === c.id ? null : c.id)}>
                      {detalhe === c.id ? "Fechar parcelas" : `Ver as ${c.parcelas_geradas} parcelas`}
                    </Button>
                  </div>

                  {detalhe === c.id && (
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Vencimento</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Pago em</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parcelas.map((p: any) => {
                            const vencida = p.status !== "paga" && p.status !== "cancelada" && p.vencimento < hoje();
                            return (
                              <TableRow key={p.id}>
                                <TableCell className="font-mono">{p.parcela_numero}</TableCell>
                                <TableCell className={`font-mono ${vencida ? "text-destructive" : ""}`}>
                                  {dia(p.vencimento)}
                                </TableCell>
                                <TableCell className="font-mono text-right">{brl(Number(p.valor))}</TableCell>
                                <TableCell>
                                  <Badge variant={p.status === "paga" ? "secondary" : vencida ? "destructive" : "outline"}>
                                    {vencida && p.status !== "paga" ? "vencida" : p.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono">{dia(p.data_pagamento)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Novo compromisso</DialogTitle>
            <DialogDescription>
              O compromisso é o contrato; as contas a pagar saem dele. Depois de
              salvar, clique em <em>Gerar parcelas</em> — sem isso nada vence e o
              fluxo de caixa não enxerga o compromisso.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{campo("descricao", "Descrição", "Financiamento da CNC")}</div>
            {campo("credor", "Quem recebe", "IDEAL COMMERCE LTDA")}
            {campo("credor_documento", "CNPJ / CPF", "00.000.000/0001-00")}

            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {campo("numero_contrato", "Número do contrato", "12608350")}

            {campo("valor_parcela", "Valor da parcela", "1750.38", "number")}
            <div className="space-y-1">
              <Label className="text-xs">Total de parcelas</Label>
              <Input
                type="number"
                className="font-mono"
                placeholder="36 — deixe vazio se não tem fim"
                value={form.total_parcelas}
                onChange={(e) => setForm((f) => ({ ...f, total_parcelas: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Vazio = sem fim (aluguel, assinatura). Aí as parcelas são geradas
                12 meses à frente.
              </p>
            </div>

            {campo("primeira_parcela", "Vencimento da 1ª parcela", "", "date")}
            <div className="space-y-1">
              <Label className="text-xs">Periodicidade</Label>
              <Select value={form.periodicidade} onValueChange={(v) => setForm((f) => ({ ...f, periodicidade: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODICIDADES.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {campo("valor_entrada", "Entrada / sinal já pago", "0", "number")}
            <div className="space-y-1">
              <Label className="text-xs">Máquina (se paga um equipamento)</Label>
              <Select value={form.maquina_id} onValueChange={(v) => setForm((f) => ({ ...f, maquina_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  {maquinas.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-2">{campo("observacoes", "Observações", "Garantias, fiador, condições")}</div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              disabled={!form.descricao.trim() || !form.credor.trim() || !form.valor_parcela || salvar.isPending}
              onClick={() => salvar.mutate()}
            >
              Salvar compromisso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
