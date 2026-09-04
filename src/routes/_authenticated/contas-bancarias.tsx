/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { lerExtrato, somarExtrato } from "@/domain/financeiro/extrato";
import { AlertTriangle, Upload, Landmark } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contas-bancarias")({
  head: () => ({ meta: [{ title: "Contas bancárias — BEX PRINT OS" }] }),
  component: ContasPage,
});

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dia = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—";

const contaVazia = {
  nome: "",
  banco: "",
  agencia: "",
  conta: "",
  tipo: "corrente",
  saldo_inicial: "",
  saldo_inicial_data: new Date().toISOString().slice(0, 10),
};

/**
 * Contas bancárias e extrato.
 *
 * As tabelas `contas_bancarias` e `banco_transacoes` já existiam, bem modeladas
 * — a segunda com índice único em (conta_id, fitid), a trava certa contra
 * importar o mesmo lançamento duas vezes. E nenhuma tela lia ou escrevia nelas.
 *
 * Enquanto isso o "saldo real" do Fluxo de Caixa era entradas menos saídas de
 * `caixa_movimentos`: ignora o saldo inicial e ignora tudo que passou pelo banco
 * sem alguém lançar. Movimento líquido registrado com nome de saldo.
 */
function ContasPage() {
  const qc = useQueryClient();
  const { canSeeFinancials, hasPermission } = useAuth();
  const podeGerenciar = hasPermission("financeiro.read");
  const [form, setForm] = useState({ ...contaVazia });
  const [contaSelecionada, setContaSelecionada] = useState<string>("");
  const [importando, setImportando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const { data: contas = [] } = useQuery({
    queryKey: ["saldo-contas"],
    enabled: canSeeFinancials,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("saldo_contas_bancarias");
      if (error) throw error;
      return data ?? [];
    },
  });

  const contaAtiva = contaSelecionada || contas[0]?.conta_id || "";

  const { data: lancamentos = [] } = useQuery({
    queryKey: ["banco-transacoes", contaAtiva],
    enabled: !!contaAtiva && canSeeFinancials,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("banco_transacoes")
        .select("id, data, descricao, valor, tipo, documento, conciliado, origem")
        .eq("conta_id", contaAtiva)
        .order("data", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const criarConta = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Dê um nome à conta.");
      const { data, error } = await (supabase as any)
        .from("contas_bancarias")
        .insert({
          nome: form.nome.trim(),
          banco: form.banco.trim() || null,
          agencia: form.agencia.trim() || null,
          conta: form.conta.trim() || null,
          tipo: form.tipo,
          saldo_inicial: form.saldo_inicial ? Number(form.saldo_inicial) : 0,
          saldo_inicial_data: form.saldo_inicial_data || null,
          ativo: true,
        })
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Seu perfil não pode cadastrar conta bancária.");
    },
    onSuccess: () => {
      toast.success("Conta cadastrada");
      setForm({ ...contaVazia });
      qc.invalidateQueries({ queryKey: ["saldo-contas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function importarArquivo(f: File) {
    if (!contaAtiva) {
      toast.error("Escolha a conta antes de importar.");
      return;
    }
    setImportando(true);
    try {
      // Banco costuma entregar OFX em Latin-1; ler como UTF-8 estraga acento.
      // Tenta UTF-8 e cai para windows-1252 quando aparece o caractere de
      // substituição, que é o sinal de que a leitura errou.
      const bytes = new Uint8Array(await f.arrayBuffer());
      let texto = new TextDecoder("utf-8").decode(bytes);
      if (texto.includes("�")) {
        texto = new TextDecoder("windows-1252").decode(bytes);
      }

      const r = lerExtrato(texto);
      if (r.lancamentos.length === 0) {
        toast.error(
          r.ignoradas.length > 0
            ? `Nenhum lançamento aproveitável. ${r.ignoradas.length} linha(s) sem data ou sem valor.`
            : "Não reconheci lançamentos neste arquivo (esperado OFX ou CSV de extrato).",
        );
        return;
      }

      // Aviso, não bloqueio: a conta do arquivo pode estar escrita de outro
      // jeito. Quem decide é quem está olhando.
      const daTela = contas.find((c: any) => c.conta_id === contaAtiva);
      if (r.conta?.numero && daTela?.conta && !String(daTela.conta).includes(r.conta.numero)) {
        toast.warning(
          `O arquivo é da conta ${r.conta.numero} e você está importando em ${daTela.conta}. Confira.`,
        );
      }

      const { data, error } = await (supabase.rpc as any)("importar_extrato", {
        p_conta_id: contaAtiva,
        p_lancamentos: r.lancamentos,
      });
      if (error) throw error;

      const res = data as { recebidos: number; novos: number; ja_existiam: number };
      const soma = somarExtrato(r.lancamentos);
      toast.success(
        `${res.novos} lançamento(s) novo(s)` +
          (res.ja_existiam > 0 ? `, ${res.ja_existiam} já importado(s) antes` : "") +
          `. Líquido do arquivo: ${brl(soma.liquido)}.`,
      );
      qc.invalidateQueries({ queryKey: ["saldo-contas"] });
      qc.invalidateQueries({ queryKey: ["banco-transacoes", contaAtiva] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar extrato");
    } finally {
      setImportando(false);
    }
  }

  if (!canSeeFinancials) {
    return (
      <div>
        <SectionHeader breadcrumb="Financeiro" title="Contas bancárias" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Seu perfil não tem acesso a valores financeiros.
          </CardContent>
        </Card>
      </div>
    );
  }

  const saldoTotal = contas.reduce((s: number, c: any) => s + Number(c.saldo_atual ?? 0), 0);
  const naoConciliados = contas.reduce((s: number, c: any) => s + Number(c.nao_conciliados ?? 0), 0);

  return (
    <div>
      <SectionHeader
        breadcrumb="Financeiro"
        title="Contas bancárias"
        description="Saldo real de cada conta, a partir do saldo inicial e do extrato importado."
      />

      {contas.length > 0 && (
        <div className="mb-4 grid overflow-hidden rounded-md border sm:grid-cols-3">
          <div className="border-r bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Saldo somado
            </div>
            <div className={`mt-1 text-2xl font-semibold ${saldoTotal < 0 ? "text-destructive" : ""}`}>
              {brl(saldoTotal)}
            </div>
            <div className="text-xs text-muted-foreground">{contas.length} conta(s) ativa(s)</div>
          </div>
          <div className="border-r bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              A conciliar
            </div>
            <div className="mt-1 text-2xl font-semibold">{naoConciliados}</div>
            <div className="text-xs text-muted-foreground">
              lançamentos sem par no caixa
            </div>
          </div>
          <div className="bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Último extrato
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {dia(
                contas
                  .map((c: any) => c.ultimo_lancamento)
                  .filter(Boolean)
                  .sort()
                  .pop() ?? null,
              )}
            </div>
            <div className="text-xs text-muted-foreground">data do lançamento mais recente</div>
          </div>
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead className="text-right">Saldo inicial</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Saídas</TableHead>
                <TableHead className="text-right">Saldo atual</TableHead>
                <TableHead className="text-right">A conciliar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-6 text-sm text-muted-foreground">
                    Nenhuma conta cadastrada. Cadastre abaixo com o saldo do dia em que começar a
                    usar — o saldo inicial é o ponto de partida da conta.
                  </TableCell>
                </TableRow>
              ) : (
                contas.map((c: any) => (
                  <TableRow key={c.conta_id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <Landmark className="h-4 w-4 text-muted-foreground" />
                        {c.nome}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[c.banco, c.agencia, c.conta].filter(Boolean).join(" · ") || "sem dados bancários"}
                        {c.saldo_inicial_data && ` · desde ${dia(c.saldo_inicial_data)}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{brl(c.saldo_inicial)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-600">
                      {Number(c.entradas) > 0 ? brl(c.entradas) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-destructive">
                      {Number(c.saidas) < 0 ? brl(c.saidas) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-semibold ${Number(c.saldo_atual) < 0 ? "text-destructive" : ""}`}
                    >
                      {brl(c.saldo_atual)}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(c.nao_conciliados) > 0 ? (
                        <Badge variant="outline" className="font-normal text-amber-600">
                          {c.nao_conciliados}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {contas.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="conta" className="text-xs">Conta</Label>
                <Select value={contaAtiva} onValueChange={setContaSelecionada}>
                  <SelectTrigger id="conta" className="w-[16rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {contas.map((c: any) => (
                      <SelectItem key={c.conta_id} value={c.conta_id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {podeGerenciar && (
                <>
                  <input
                    ref={arquivo}
                    type="file"
                    accept=".ofx,.csv,.txt,text/csv,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importarArquivo(f);
                      e.target.value = "";
                    }}
                  />
                  <Button variant="outline" disabled={importando} onClick={() => arquivo.current?.click()}>
                    <Upload className="mr-1 h-4 w-4" />
                    {importando ? "Importando…" : "Importar extrato (OFX ou CSV)"}
                  </Button>
                </>
              )}
            </div>
            <CardTitle className="text-sm font-medium">
              Lançamentos ({lancamentos.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0">
            {lancamentos.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                Nenhum lançamento importado nesta conta. Baixe o extrato no site do banco em OFX
                (“Money 2000”) ou CSV e importe aqui — reimportar o mesmo período é seguro, o
                sistema descarta o que já entrou.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Conciliado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lancamentos.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap text-sm">{dia(l.data)}</TableCell>
                        <TableCell className="max-w-[24rem] text-sm">{l.descricao}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {l.documento || "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-sm ${Number(l.valor) < 0 ? "text-destructive" : "text-emerald-600"}`}
                        >
                          {brl(l.valor)}
                        </TableCell>
                        <TableCell>
                          {l.conciliado ? (
                            <Badge variant="secondary" className="font-normal">sim</Badge>
                          ) : (
                            <span className="text-xs text-amber-600">pendente</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {podeGerenciar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Nova conta</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Label htmlFor="nome" className="text-xs">Nome *</Label>
              <Input id="nome" value={form.nome} placeholder="Conta corrente Banco do Brasil"
                     onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="banco" className="text-xs">Banco</Label>
              <Input id="banco" value={form.banco} placeholder="001"
                     onChange={(e) => setForm({ ...form, banco: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tipo" className="text-xs">Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger id="tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrente">Corrente</SelectItem>
                  <SelectItem value="poupanca">Poupança</SelectItem>
                  <SelectItem value="caixa">Caixa (dinheiro)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="agencia" className="text-xs">Agência</Label>
              <Input id="agencia" value={form.agencia}
                     onChange={(e) => setForm({ ...form, agencia: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="numero" className="text-xs">Conta</Label>
              <Input id="numero" value={form.conta}
                     onChange={(e) => setForm({ ...form, conta: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="saldo" className="text-xs">Saldo inicial (R$)</Label>
              <Input id="saldo" type="number" step="0.01" value={form.saldo_inicial}
                     onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="desde" className="text-xs">Saldo na data de</Label>
              <Input id="desde" type="date" value={form.saldo_inicial_data}
                     onChange={(e) => setForm({ ...form, saldo_inicial_data: e.target.value })} />
            </div>
            <div className="lg:col-span-4">
              <Button onClick={() => criarConta.mutate()} disabled={!form.nome.trim() || criarConta.isPending}>
                {criarConta.isPending ? "Cadastrando…" : "Cadastrar conta"}
              </Button>
              <p className="mt-2 flex gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                A data do saldo inicial importa: só o extrato a partir dela entra na conta. Sem
                isso, um extrato antigo importado depois somaria movimento que o saldo já continha.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
