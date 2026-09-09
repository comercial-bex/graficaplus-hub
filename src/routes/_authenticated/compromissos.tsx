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
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  ExternalLink,
  FileCheck2,
  Paperclip,
  Landmark,
  Plus,
  Repeat,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { pagoDoBem, resumoPatrimonio, type MaquinaPatrimonio } from "@/domain/financeiro/patrimonio";
import {
  custoMensal,
  parcelaAtual,
  pendencias,
  progresso,
  saldoDevedorTotal,
  situacao,
  terminaEm,
  totalAtrasado,
  totalPresumido,
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
  financeira: "",
  portal_url: "",
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
  const [baixa, setBaixa] = useState<any | null>(null);
  const [baixaData, setBaixaData] = useState(hoje());
  const [baixaCaixa, setBaixaCaixa] = useState(true);
  const [enviando, setEnviando] = useState(false);

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
      const { data } = await supabase.from("maquinas").select("id, nome, custo_hora").eq("ativa", true).order("nome");
      return data ?? [];
    },
  });

  /**
   * A negociação de cada máquina, quando existe.
   *
   * É o número que leva ao portal do fornecedor, onde estão as parcelas. Sem
   * ele o aviso de "falta cadastrar" mandaria alguém procurar sem pista.
   */
  const { data: patrimonio = [] } = useQuery({
    queryKey: ["patrimonio-maquinas"],
    queryFn: async (): Promise<MaquinaPatrimonio[]> => {
      const { data, error } = await (supabase as any)
        .from("vw_patrimonio_maquinas")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []).map((m: any) => ({
        ...m,
        valor_aquisicao: m.valor_aquisicao == null ? null : Number(m.valor_aquisicao),
        patrimonio: Number(m.patrimonio ?? 0),
        divida: Number(m.divida ?? 0),
      }));
    },
  });

  const { data: negociacoes = [] } = useQuery({
    queryKey: ["compromissos-negociacoes"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas_contrato")
        .select("maquina_id, numero_negociacao, numero_contrato, condicao_comercial");
      return (data ?? []) as any[];
    },
  });

  const { data: parcelas = [] } = useQuery({
    queryKey: ["compromisso-parcelas", detalhe],
    enabled: !!detalhe,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_pagar")
        .select("id, parcela_numero, descricao, valor, vencimento, status, data_pagamento, comprovante_url, nosso_numero, forma_pagamento")
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
        financeira: form.financeira || null,
        portal_url: form.portal_url || null,
        observacoes: form.observacoes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Compromisso cadastrado — agora lance o cronograma");
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

  /**
   * O comprovante é o ponto do módulo.
   *
   * O sistema não emite boleto — quem emite é a financeira. O que ele guarda é
   * a PROVA de que a parcela foi paga, ligada ao título pelo nosso número. Por
   * isso o arquivo sobe antes de a baixa acontecer: baixa sem comprovante é
   * afirmação sem prova, e é o estado que o painel mais esconde.
   */
  async function subirComprovante(parcelaId: string, arquivo: File): Promise<string> {
    const ext = arquivo.name.split(".").pop() ?? "pdf";
    // Caminho com carimbo de tempo: o bucket não tem policy de UPDATE, então
    // reenviar cria um arquivo novo em vez de falhar silenciosamente.
    const caminho = `compromissos/${parcelaId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("comprovantes").upload(caminho, arquivo);
    if (error) throw error;
    return caminho;
  }

  const darBaixa = useMutation({
    mutationFn: async (v: { id: string; data: string; caixa: boolean; arquivo: File | null }) => {
      const url = v.arquivo ? await subirComprovante(v.id, v.arquivo) : null;
      const { data, error } = await (supabase.rpc as any)("baixar_parcela_compromisso", {
        p_conta_id: v.id,
        p_data_pagamento: v.data,
        p_comprovante_url: url,
        p_forma_pagamento: null,
        p_lancar_caixa: v.caixa,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (r: any) => {
      toast.success(
        r?.com_comprovante ? "Baixa registrada com comprovante" : "Baixa registrada — sem comprovante anexado",
      );
      recarregar();
      setBaixa(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const anexar = useMutation({
    mutationFn: async (v: { id: string; arquivo: File }) => {
      const url = await subirComprovante(v.id, v.arquivo);
      const { error } = await (supabase.rpc as any)("anexar_comprovante_parcela", {
        p_conta_id: v.id,
        p_comprovante_url: url,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Comprovante anexado");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * O bucket é privado: o caminho guardado não é um endereço público. Precisa
   * de URL assinada na hora de abrir — link direto devolveria 400 e pareceria
   * comprovante perdido.
   */
  async function abrirComprovante(caminho: string) {
    const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(caminho, 60);
    if (error || !data?.signedUrl) {
      toast.error("Não deu para abrir o comprovante");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

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
  const presumido = totalPresumido(compromissos);
  const semParcelas = compromissos.filter((c) => c.ativo && situacao(c) === "sem_parcelas");
  const comCompromisso = new Set(compromissos.filter((c) => c.ativo).map((c) => c.maquina_id));
  const semCompromisso = maquinas.filter((m: any) => !comCompromisso.has(m.id));

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
        description="Quem emite o boleto é a financeira. Aqui a casa espelha o cronograma, guarda o comprovante de cada parcela e acompanha o saldo devedor até quitar."
        actions={
          <Button onClick={() => setAberto(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo compromisso
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Sai por mês" value={brl(mensal)} icon={Repeat} />
        <KpiCard label="Saldo devedor" value={brl(devedor)} icon={Wallet} />
        {/* Só entra aqui o que veio de cronograma conferido no boleto. Data que
            eu presumi não pinta número vermelho — ela tem aviso próprio. */}
        <KpiCard label="Vencido em aberto" value={brl(atrasado)} icon={AlertTriangle} />
        <KpiCard label="Compromissos ativos" value={String(compromissos.filter((c) => c.ativo).length)} icon={CalendarClock} />
      </div>

      {/* Patrimônio e dívida na mesma tela, porque a pergunta é uma só: o que
          a casa tem em máquina e o que ela ainda deve por elas. */}
      {patrimonio.length > 0 && (() => {
        const r = resumoPatrimonio(patrimonio);
        const proprias = patrimonio.filter((m) => m.ativa && m.forma_aquisicao !== "locada");
        const alugadas = patrimonio.filter((m) => m.ativa && m.forma_aquisicao === "locada");
        return (
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Patrimônio em máquinas</h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-4 text-sm">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Bens da casa
                  </div>
                  <div className="font-bold font-mono">{brl(r.patrimonioBruto)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.quitadas} quitada(s) · {r.financiadas} financiada(s)
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Dívida sobre eles
                  </div>
                  <div className="font-bold font-mono">{brl(r.dividaSobreBens)}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Patrimônio líquido
                  </div>
                  <div className="font-bold font-mono text-emerald-600">{brl(r.patrimonioLiquido)}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Locação a pagar
                  </div>
                  <div className="font-bold font-mono">{brl(r.compromissoLocacao)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.locadas} alugada(s) — não é patrimônio
                  </div>
                </div>
              </div>

              <ul className="space-y-2">
                {proprias.map((mq) => {
                  const p = pagoDoBem(mq);
                  return (
                    <li key={mq.id} className="space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-medium">{mq.nome}</span>
                        <Badge variant="outline" className="font-normal text-[10px] capitalize">
                          {mq.forma_aquisicao}
                        </Badge>
                        <span className="ml-auto font-mono text-xs">
                          {mq.patrimonio > 0 ? brl(mq.patrimonio) : "—"}
                          {mq.divida > 0 && (
                            <span className="text-muted-foreground"> · devo {brl(mq.divida)}</span>
                          )}
                        </span>
                      </div>
                      {p != null && (
                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${p * 100}%` }} />
                        </div>
                      )}
                      {(mq.pendencia_patrimonio || mq.pendencia_divida) && (
                        <p className="text-[11px] text-amber-600">
                          {[mq.pendencia_patrimonio, mq.pendencia_divida].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {alugadas.length > 0 && (
                <p className="text-xs text-muted-foreground border-t pt-3">
                  <strong>Fora do patrimônio:</strong>{" "}
                  {alugadas.map((mq) => mq.nome).join(", ")} — o bem é do locador e volta
                  para ele no fim do contrato. A parcela é despesa, não compra de ativo.
                </p>
              )}

              {r.incompletas.length > 0 && (
                <p className="text-xs text-amber-600 border-t pt-3">
                  Este total está incompleto para menos: {r.incompletas.length} máquina(s)
                  sem valor do bem ou sem contrato cadastrado.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

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
            existe. Clique em <em>Lançar cronograma</em> em {semParcelas.map((c) => c.descricao).join(", ")}.
          </div>
        </div>
      )}

      {atrasado > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            Há <strong>{brl(atrasado)}</strong> em parcelas vencidas e ainda em aberto. Se
            elas já foram pagas antes de o sistema existir, use{" "}
            <em>Quitar vencidas</em> — isso marca a obrigação como cumprida e{" "}
            <strong>não</strong> lança movimento de caixa, porque aquele dinheiro saiu de
            uma conta que este sistema não acompanhava. Elas ficam <strong>sem
            comprovante</strong>, e o próprio card vai cobrar o anexo de cada uma.
          </div>
        </div>
      )}

      {/* Aviso separado, e de propósito: misturar isto com o vencido de verdade
          transformaria uma data que eu presumi em cobrança. */}
      {presumido > 0 && (
        <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm flex gap-2">
          <CalendarClock className="h-4 w-4 text-sky-600 flex-shrink-0 mt-0.5" />
          <div>
            <strong>{brl(presumido)}</strong> apareceriam como vencidos em cronograma que
            ainda não foi conferido no boleto da financeira — por isso ficam fora do
            vencido acima. No CNC o contrato assinado errou a 1ª parcela em dois meses e o
            valor em R$ 23,64; abra o portal do fornecedor, corrija a 1ª parcela e o valor
            no compromisso, e clique em <em>Realinhar cronograma</em>.
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
                        {s === "cronograma_presumido" && (
                          <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/15">
                            cronograma presumido
                          </Badge>
                        )}
                        {s === "sem_parcelas" && (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-500 hover:bg-amber-500/15">
                            sem parcelas
                          </Badge>
                        )}
                        {s === "quitado" && <Badge variant="secondary">quitado</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {c.credor}
                        {/* Quem vende e quem cobra podem ser empresas diferentes:
                            o CNC é da Ideal Commerce e o boleto é do Bradesco. */}
                        {c.financeira && ` · boleto ${c.financeira}`}
                        {c.numero_contrato && ` · contrato ${c.numero_contrato}`}
                        {c.maquina_nome && ` · ${c.maquina_nome}`}
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

                  {/* O que falta para este contrato estar em ordem, dito por
                      extenso. Painel verde com parcela paga sem comprovante é
                      exatamente o que este bloco existe para não deixar passar. */}
                  {pendencias(c).length > 0 && (
                    <ul className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs space-y-1">
                      {pendencias(c).map((t) => (
                        <li key={t} className="flex gap-1.5">
                          <span className="text-amber-600">•</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {c.total_parcelas != null && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct * 100}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(pct * 100).toFixed(0)}% pago · {c.parcelas_pagas} de {c.total_parcelas} parcelas
                        {c.com_comprovante > 0 && ` · ${c.com_comprovante} com comprovante`}
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
                    {/* "Lançar cronograma" e não "gerar parcelas": quem gera
                        boleto é a financeira. Aqui só se espelha o que o portal
                        do fornecedor mostra, para ter onde guardar a prova. */}
                    <Button size="sm" variant="outline" disabled={gerar.isPending} onClick={() => gerar.mutate(c.id)}>
                      <Repeat className="h-3.5 w-3.5 mr-1" />
                      {c.parcelas_geradas === 0 ? "Lançar cronograma" : "Realinhar cronograma"}
                    </Button>
                    {c.portal_url && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={c.portal_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" /> Portal do fornecedor
                        </a>
                      </Button>
                    )}
                    {/* Quitar em lote em cima de data presumida marcaria como
                        pagas parcelas cujo vencimento talvez nem exista. Confira
                        o cronograma no portal primeiro. */}
                    {c.parcelas_atrasadas > 0 && c.cronograma_confirmado && (
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
                            <TableHead>Nosso número</TableHead>
                            <TableHead>Comprovante</TableHead>
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
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {p.nosso_numero ?? "—"}
                                </TableCell>
                                <TableCell>
                                  {p.comprovante_url ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => abrirComprovante(p.comprovante_url)}
                                    >
                                      <FileCheck2 className="h-3.5 w-3.5 mr-1 text-emerald-600" /> ver
                                    </Button>
                                  ) : p.status === "paga" ? (
                                    // Paga e sem prova: o estado que o painel
                                    // esconde, porque some do saldo e do atraso.
                                    <label className="inline-flex items-center gap-1 text-xs text-amber-600 cursor-pointer">
                                      <Paperclip className="h-3.5 w-3.5" />
                                      anexar
                                      <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*,application/pdf"
                                        disabled={anexar.isPending}
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) anexar.mutate({ id: p.id, arquivo: f });
                                          e.target.value = "";
                                        }}
                                      />
                                    </label>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => {
                                        setBaixa(p);
                                        setBaixaData(p.vencimento);
                                        setBaixaCaixa(true);
                                      }}
                                    >
                                      <CheckCheck className="h-3.5 w-3.5 mr-1" /> dar baixa
                                    </Button>
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
            );
          })}
        </div>
      )}

      {/* Máquina financiada sem compromisso cadastrado é dívida que o sistema
          não enxerga — e é também por que a hora-máquina dela sai R$ 0,00 no
          orçamento. As duas coisas se resolvem com o mesmo cadastro. */}
      {semCompromisso.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold text-sm">
                {semCompromisso.length === 1
                  ? "1 máquina ativa sem compromisso cadastrado"
                  : `${semCompromisso.length} máquinas ativas sem compromisso cadastrado`}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Enquanto o compromisso não existe, a dívida fica fora do saldo devedor e do
              fluxo de caixa. E quando a máquina também está sem custo/hora, o processo
              dela entra no orçamento a R$ 0,00 — as duas coisas se resolvem com o mesmo
              cadastro.
            </p>
            <ul className="space-y-1.5 text-sm">
              {semCompromisso.map((m: any) => {
                const n = negociacoes.find((x: any) => x.maquina_id === m.id);
                return (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{m.nome}</span>
                    {n?.numero_negociacao && (
                      <span className="font-mono text-xs text-muted-foreground">
                        negociação {n.numero_negociacao}
                      </span>
                    )}
                    {n?.condicao_comercial && (
                      <span className="text-xs text-muted-foreground">· {n.condicao_comercial}</span>
                    )}
                    {Number(m.custo_hora ?? 0) <= 0 && (
                      <span className="text-xs text-amber-600">· sem custo/hora</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!baixa} onOpenChange={(v) => !v && setBaixa(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Baixa da parcela {baixa?.parcela_numero} — {brl(Number(baixa?.valor ?? 0))}
            </DialogTitle>
            <DialogDescription>
              Vencimento {dia(baixa?.vencimento)}
              {baixa?.nosso_numero && ` · nosso número ${baixa.nosso_numero}`}. Anexe o
              comprovante: é ele que transforma "está pago" em prova.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Data em que foi pago</Label>
              <Input type="date" value={baixaData} onChange={(e) => setBaixaData(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                A data real do pagamento, não a de hoje — é ela que vai para o caixa.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Comprovante</Label>
              <Input
                id="comprovante-baixa"
                type="file"
                accept="image/*,application/pdf"
                onChange={() => setEnviando(false)}
              />
            </div>

            {/* Parcela paga antes de o sistema existir não pode virar lançamento
                de caixa: o dinheiro saiu de uma conta que ele não acompanhava, e
                o saldo e a conciliação passariam a mentir. */}
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={baixaCaixa}
                onChange={(e) => setBaixaCaixa(e.target.checked)}
              />
              <span>
                Lançar a saída no fluxo de caixa
                <span className="block text-[11px] text-muted-foreground">
                  Desmarque se esta parcela foi paga antes de o sistema existir — aí a
                  obrigação fica quitada sem inventar movimento no caixa.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBaixa(null)}>Cancelar</Button>
            <Button
              disabled={darBaixa.isPending || enviando || !baixaData}
              onClick={() => {
                const input = document.getElementById("comprovante-baixa") as HTMLInputElement | null;
                darBaixa.mutate({
                  id: baixa.id,
                  data: baixaData,
                  caixa: baixaCaixa,
                  arquivo: input?.files?.[0] ?? null,
                });
              }}
            >
              {darBaixa.isPending ? "Salvando…" : "Dar baixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

            {campo("financeira", "Financeira (quem emite o boleto)", "Bradesco")}
            {campo("portal_url", "Portal do fornecedor", "https://...")}
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
