import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Banknote,
  Landmark,
  Plus,
  Upload,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { DataPanel } from "@/components/bex/DataPanel";
import { NeonButton } from "@/components/bex/NeonButton";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { chaveLinha, lerExtrato, type LinhaExtrato } from "@/lib/extrato";

export const Route = createFileRoute("/_authenticated/contas-bancarias")({
  head: () => ({
    meta: [
      { title: "Contas bancárias — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Saldo real das contas da gráfica, importação de extrato OFX/CSV com validação de duplicidade e integração com o fluxo de caixa.",
      },
      { property: "og:title", content: "Contas bancárias — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Importe o extrato do banco e veja o saldo real do caixa atualizar sozinho.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContasBancariasPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");
const hoje = () => new Date().toISOString().slice(0, 10);

type ContaForm = {
  nome: string;
  banco: string;
  agencia: string;
  conta: string;
  tipo: string;
  saldo_inicial: string;
  saldo_inicial_data: string;
};

const contaVazia: ContaForm = {
  nome: "",
  banco: "",
  agencia: "",
  conta: "",
  tipo: "corrente",
  saldo_inicial: "0",
  saldo_inicial_data: hoje(),
};

type SaldoConta = {
  conta_id: string;
  nome: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  tipo: string | null;
  ativo: boolean;
  saldo_inicial: number;
  saldo_atual: number;
  movimento: number;
  lancamentos: number;
  nao_conciliados: number;
  ultimo_lancamento: string | null;
};

type Transacao = {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: string;
  documento: string | null;
  origem: string;
  conciliado: boolean;
};

function ContasBancariasPage() {
  const qc = useQueryClient();
  const [contaOpen, setContaOpen] = useState(false);
  const [form, setForm] = useState<ContaForm>(contaVazia);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [arquivoNome, setArquivoNome] = useState("");
  const [linhas, setLinhas] = useState<LinhaExtrato[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ["saldo-contas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vw_saldo_conta")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as SaldoConta[];
    },
  });

  const contaAtiva = selecionada ?? contas[0]?.conta_id ?? null;

  const { data: transacoes = [] } = useQuery({
    queryKey: ["banco-transacoes", contaAtiva],
    enabled: !!contaAtiva,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("banco_transacoes")
        .select("id, data, descricao, valor, tipo, documento, origem, conciliado")
        .eq("conta_id", contaAtiva!)
        .order("data", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Transacao[];
    },
  });

  const criarConta = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contas_bancarias").insert({
        nome: form.nome,
        banco: form.banco || null,
        agencia: form.agencia || null,
        conta: form.conta || null,
        tipo: form.tipo,
        saldo_inicial: Number(form.saldo_inicial) || 0,
        saldo_inicial_data: form.saldo_inicial_data || hoje(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta cadastrada");
      qc.invalidateQueries({ queryKey: ["saldo-contas"] });
      setContaOpen(false);
      setForm(contaVazia);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const importar = useMutation({
    mutationFn: async () => {
      if (!contaAtiva) throw new Error("Selecione a conta bancária antes de importar.");
      const { data, error } = await (supabase as any).rpc("importar_extrato", {
        p_conta_id: contaAtiva,
        p_linhas: linhas,
      });
      if (error) throw error;
      return data as { importadas: number; duplicadas: number; saldo_atual: number };
    },
    onSuccess: (r) => {
      toast.success(
        `${r.importadas} lançamento(s) importado(s)` +
          (r.duplicadas > 0 ? ` · ${r.duplicadas} já existiam e foram ignorados` : ""),
      );
      qc.invalidateQueries({ queryKey: ["saldo-contas"] });
      qc.invalidateQueries({ queryKey: ["banco-transacoes"] });
      qc.invalidateQueries({ queryKey: ["vw-fluxo-caixa"] });
      qc.invalidateQueries({ queryKey: ["caixa-movimentos"] });
      setImportOpen(false);
      setLinhas([]);
      setArquivoNome("");
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  async function escolherArquivo(file: File | undefined) {
    if (!file) return;
    const texto = await file.text();
    const lidas = lerExtrato(file.name, texto);
    if (lidas.length === 0) {
      toast.error(
        "Não encontramos lançamentos nesse arquivo. Use OFX do banco ou CSV com data, descrição e valor.",
      );
      return;
    }
    setArquivoNome(file.name);
    setLinhas(lidas);
  }

  const repetidasNoArquivo = useMemo(() => {
    const vistos = new Set<string>();
    const dup = new Set<number>();
    linhas.forEach((l, i) => {
      const k = chaveLinha(l);
      if (vistos.has(k)) dup.add(i);
      vistos.add(k);
    });
    return dup;
  }, [linhas]);

  const kpis = useMemo(() => {
    const saldo = contas.reduce((a, c) => a + Number(c.saldo_atual ?? 0), 0);
    const naoConc = contas.reduce((a, c) => a + Number(c.nao_conciliados ?? 0), 0);
    const limite = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const recentes = transacoes.filter((t) => t.data >= limite);
    const entradas = recentes
      .filter((t) => t.tipo === "credito")
      .reduce((a, t) => a + Number(t.valor), 0);
    const saidas = recentes
      .filter((t) => t.tipo !== "credito")
      .reduce((a, t) => a + Number(t.valor), 0);
    return { saldo, naoConc, entradas, saidas };
  }, [contas, transacoes]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return transacoes;
    return transacoes.filter(
      (t) => t.descricao.toLowerCase().includes(q) || (t.documento ?? "").toLowerCase().includes(q),
    );
  }, [transacoes, busca]);

  const previaValor = linhas.reduce((a, l) => a + (l.tipo === "credito" ? l.valor : -l.valor), 0);

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/contas-bancarias")}
        breadcrumb="Financeiro"
        title="Contas bancárias"
        description="Saldo real de cada conta. Importe o extrato do banco (OFX ou CSV) e cada lançamento novo entra no caixa automaticamente — os repetidos são ignorados."
        actions={
          <>
            <Button variant="outline" onClick={() => setContaOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nova conta
            </Button>
            <NeonButton onClick={() => setImportOpen(true)} disabled={!contaAtiva}>
              <Upload className="h-4 w-4" />
              Importar extrato
            </NeonButton>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Saldo real das contas"
          value={brl(kpis.saldo)}
          icon={Wallet}
          tone={kpis.saldo >= 0 ? "cyan" : "magenta"}
        />
        <KpiCard
          label="Entradas (30 dias)"
          value={brl(kpis.entradas)}
          icon={ArrowUpCircle}
          tone="lime"
          hint="Conta selecionada"
        />
        <KpiCard
          label="Saídas (30 dias)"
          value={brl(kpis.saidas)}
          icon={ArrowDownCircle}
          tone="magenta"
          hint="Conta selecionada"
        />
        <KpiCard
          label="A conciliar"
          value={kpis.naoConc}
          icon={Banknote}
          tone={kpis.naoConc > 0 ? "amber" : "muted"}
          hint="Lançamentos sem par no caixa"
        />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading && <div className="text-sm text-muted-foreground">Carregando contas...</div>}
        {!isLoading && contas.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
            Nenhuma conta cadastrada. Comece cadastrando a conta usada pela gráfica e informe o
            saldo do dia — a partir daí o extrato mantém o saldo em dia.
          </div>
        )}
        {contas.map((c) => {
          const ativa = c.conta_id === contaAtiva;
          return (
            <button
              key={c.conta_id}
              type="button"
              onClick={() => setSelecionada(c.conta_id)}
              className={`rounded-xl border p-5 text-left transition ${
                ativa
                  ? "border-[color:var(--bex-cyan)] bg-card shadow-lg"
                  : "border-border bg-card/60 hover:border-muted-foreground/40"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-[color:var(--bex-cyan)]" />
                    <span className="truncate font-semibold">{c.nome}</span>
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                    {[c.banco, c.agencia && `Ag. ${c.agencia}`, c.conta && `C/C ${c.conta}`]
                      .filter(Boolean)
                      .join(" · ") || "sem dados bancários"}
                  </div>
                </div>
                <StatusChip
                  label={c.nao_conciliados > 0 ? `${c.nao_conciliados} a conciliar` : "Conciliada"}
                  tone={c.nao_conciliados > 0 ? "amber" : "lime"}
                />
              </div>
              <div className="mt-4 text-2xl font-bold tabular-nums">
                {brl(Number(c.saldo_atual ?? 0))}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {c.lancamentos} lançamento(s)
                {c.ultimo_lancamento ? ` · último em ${dataBR(c.ultimo_lancamento)}` : ""}
              </div>
            </button>
          );
        })}
      </div>

      <DataPanel
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar lançamento..."
        rodape={<span>{filtradas.length} lançamento(s) no extrato desta conta</span>}
      >
        {filtradas.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nenhum lançamento importado nesta conta ainda.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{dataBR(t.data)}</TableCell>
                  <TableCell className="max-w-[380px] truncate">{t.descricao}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.documento || "—"}
                  </TableCell>
                  <TableCell className="text-xs uppercase text-muted-foreground">
                    {t.origem}
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold tabular-nums ${
                      t.tipo === "credito"
                        ? "text-[color:var(--bex-amber)]"
                        : "text-[color:var(--bex-magenta)]"
                    }`}
                  >
                    {t.tipo === "credito" ? "+" : "−"} {brl(Number(t.valor))}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={t.conciliado ? "No caixa" : "Pendente"}
                      tone={t.conciliado ? "lime" : "amber"}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataPanel>

      {/* Nova conta */}
      <Dialog open={contaOpen} onOpenChange={setContaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova conta bancária</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label className="flex items-center gap-1.5">
                Nome da conta *
                <DicaIcone
                  texto="Como você chama essa conta no dia a dia, ex.: Itaú Movimento."
                  rotulo="Nome da conta"
                />
              </Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Itaú movimento"
              />
            </div>
            <div className="space-y-2">
              <Label>Banco</Label>
              <Input
                value={form.banco}
                onChange={(e) => setForm({ ...form, banco: e.target.value })}
                placeholder="Itaú"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrente">Conta corrente</SelectItem>
                  <SelectItem value="poupanca">Poupança</SelectItem>
                  <SelectItem value="pagamento">Conta de pagamento</SelectItem>
                  <SelectItem value="caixa">Caixa interno</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Agência</Label>
              <Input
                value={form.agencia}
                onChange={(e) => setForm({ ...form, agencia: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Conta</Label>
              <Input
                value={form.conta}
                onChange={(e) => setForm({ ...form, conta: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Saldo de partida (R$)
                <DicaIcone
                  texto="Saldo que a conta tinha na data abaixo. O extrato importado soma a partir daqui."
                  rotulo="Saldo de partida"
                />
              </Label>
              <Input
                type="number"
                step="0.01"
                value={form.saldo_inicial}
                onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Data do saldo</Label>
              <Input
                type="date"
                value={form.saldo_inicial_data}
                onChange={(e) => setForm({ ...form, saldo_inicial_data: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => criarConta.mutate()}
              disabled={!form.nome || criarConta.isPending}
            >
              Salvar conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Importar extrato */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Importar extrato bancário</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <input
                ref={inputRef}
                type="file"
                accept=".ofx,.csv,.txt"
                className="hidden"
                onChange={(e) => void escolherArquivo(e.target.files?.[0])}
              />
              <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Envie o arquivo OFX do banco ou uma planilha CSV com data, descrição e valor.
              </p>
              <Button variant="outline" className="mt-3" onClick={() => inputRef.current?.click()}>
                Escolher arquivo
              </Button>
              {arquivoNome && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {arquivoNome} · {linhas.length} lançamento(s) lido(s) · resultado{" "}
                  <strong className="text-foreground">{brl(previaValor)}</strong>
                </p>
              )}
            </div>

            {linhas.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map((l, i) => (
                      <TableRow
                        key={`${chaveLinha(l)}-${i}`}
                        className={repetidasNoArquivo.has(i) ? "opacity-50" : ""}
                      >
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {dataBR(l.data)}
                        </TableCell>
                        <TableCell className="max-w-[420px] truncate">
                          {l.descricao}
                          {repetidasNoArquivo.has(i) && (
                            <span className="ml-2 text-[10px] uppercase text-[color:var(--bex-amber)]">
                              repetido no arquivo
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            l.tipo === "credito"
                              ? "text-[color:var(--bex-amber)]"
                              : "text-[color:var(--bex-magenta)]"
                          }`}
                        >
                          {l.tipo === "credito" ? "+" : "−"} {brl(l.valor)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Lançamentos que já existem nesta conta são ignorados automaticamente — pode reenviar o
              mesmo extrato sem medo de duplicar o saldo.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => importar.mutate()}
              disabled={linhas.length === 0 || importar.isPending}
            >
              {importar.isPending ? "Importando..." : `Importar ${linhas.length} lançamento(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
