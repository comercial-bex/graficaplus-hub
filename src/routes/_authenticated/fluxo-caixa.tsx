import { hojeBr } from "@/lib/hoje-br";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  History,
  Paperclip,
  Plus,
  Undo2,
  Wallet,
  TrendingUp,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { NeonButton } from "@/components/bex/NeonButton";
import { KpiCard } from "@/components/bex/KpiCard";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo, dicaTela } from "@/lib/dicas";
import { Carregando } from "@/components/bex/Carregando";
import {
  AvisoDeFiltro,
  CampoDeBusca,
  GrupoDeChips,
  RodapeDeTotais,
} from "@/components/financeiro/lista-financeira";
import {
  BarraDaSelecao,
  BarraDeVisoes,
  CabecalhoDaSelecao,
  CaixaDeSelecao,
} from "@/components/financeiro/selecao-de-contas";
import { useSelecaoDeContas, useVisoesSalvas } from "@/components/financeiro/use-selecao-e-visoes";
import {
  CHIPS_DE_SITUACAO,
  FILTRO_VAZIO,
  contarPorSituacao,
  filtrarPorPeriodoEBusca,
  filtrarPorSituacao,
  periodosDaLista,
  situacaoDaConta,
  totaisDaLista,
  type FiltroDaLista,
} from "@/domain/financeiro/lista-de-contas";
import { csvDeLinhas, dataBr, nomeDoArquivoCsv, resumoDaSelecao } from "@/domain/financeiro/selecao-de-contas";
import { validarFiltroAPagar, visaoAtiva } from "@/domain/financeiro/visoes-salvas";
import { baixarTexto, copiarTexto } from "@/lib/arquivos-no-navegador";
import {
  anexosPorConta,
  pagaSemComprovante,
  quantidadeDeArquivos,
  recursoAusente,
  type AnexoDaConta,
} from "@/domain/financeiro/contas-a-pagar-anexos";
import { CampoDeAnexos } from "@/components/financeiro/contas-a-pagar/campo-de-anexos";
import { PagarContaDialog, type ContaBancariaDaLista } from "@/components/financeiro/contas-a-pagar/pagar-conta-dialog";
import { EstornarContaDialog } from "@/components/financeiro/contas-a-pagar/estornar-conta-dialog";
import {
  AnexosDaContaDialog,
  type AbaDosAnexos,
} from "@/components/financeiro/contas-a-pagar/anexos-da-conta-dialog";
import {
  useEnviarAnexos,
  usePodeNaContaAPagar,
  type ArquivoParaEnviar,
} from "@/components/financeiro/contas-a-pagar/use-conta-a-pagar";

type ContaDaTela = Tables<"contas_pagar">;

/**
 * Situação do pacote de 16/11 (migração 20261116160000) neste banco. "ausente" = a tabela de
 * anexos não existe ainda: a tela esconde clipe, histórico e estorno, e "Pagar" usa o caminho de
 * antes (sempre depois da confirmação). "erro" = não deu para saber: tenta a função nova.
 */
type EstadoDoPacote = "carregando" | "ativo" | "ausente" | "erro";
type ErroDoBanco = { code?: string | null; message?: string | null };

/** Estável (fora do componente): a seleção poda e conta por este id. */
const idDaContaAPagar = (c: { id: string }) => c.id;
const TELA_A_PAGAR = { singular: "conta a pagar", plural: "contas a pagar", rotuloPagas: "Pagas" };
const ROTULO_DA_SITUACAO: Record<string, string> = { a_vencer: "A vencer", vencida: "Vencida", paga: "Paga", cancelada: "Cancelada" };
export const Route = createFileRoute("/_authenticated/fluxo-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de caixa — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Entradas e saídas previstas e realizadas, contas a pagar e projeção de saldo da gráfica.",
      },
      { property: "og:title", content: "Fluxo de caixa — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Contas a pagar, recebimentos e projeção de saldo em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FluxoCaixaPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => hojeBr();

const categorias = [
  "materia_prima",
  "energia",
  // Contas de consumo (16/11/2026): as faturas de água, internet, telefone e gás.
  "agua",
  "internet",
  "telefone",
  "gas",
  "aluguel",
  "salarios",
  "impostos",
  "manutencao",
  "software",
  "marketing",
  "terceiros",
  "geral",
];

type ContaForm = {
  id?: string;
  descricao: string;
  fornecedor: string;
  categoria: string;
  valor: string;
  vencimento: string;
  recorrente: boolean;
  periodicidade: string;
};

const emptyConta: ContaForm = {
  descricao: "",
  fornecedor: "",
  categoria: "geral",
  valor: "0",
  vencimento: hoje(),
  recorrente: false,
  periodicidade: "mensal",
};

type MovForm = {
  tipo: string;
  descricao: string;
  categoria: string;
  valor: string;
  data: string;
};

const emptyMov: MovForm = {
  tipo: "entrada",
  descricao: "",
  categoria: "geral",
  valor: "0",
  data: hoje(),
};

function FluxoCaixaPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  // Ver o caixa não é lançar nele. Conta a pagar e movimento pedem
  // pagamentos.create; "Pagar" dá baixa (pagamentos.confirm) E lança a saída no
  // caixa (pagamentos.create) — as mesmas chaves que o banco cobra desde a
  // migração 20261005100000. Quem só vê enxerga tudo, sem os botões.
  const podeLancar = hasPermission("pagamentos.create");
  const podeDarBaixa = podeLancar && hasPermission("pagamentos.confirm");
  // Anexar: admin ou qualquer chave de pagamento. Estornar e remover anexo: só admin
  // (decisão de 16/11/2026). O banco cobra o mesmo (migração 20261116160000).
  const { podeAnexar, podeEstornar } = usePodeNaContaAPagar();
  const enviarAnexos = useEnviarAnexos();
  const [contaOpen, setContaOpen] = useState(false);
  const [movOpen, setMovOpen] = useState(false);
  const [conta, setConta] = useState<ContaForm>(emptyConta);
  const [anexosDaNovaConta, setAnexosDaNovaConta] = useState<ArquivoParaEnviar[]>([]);
  const [mov, setMov] = useState<MovForm>(emptyMov);
  // "Pagar" só abre o diálogo de confirmação; quem grava é a confirmação lá dentro.
  const [pagando, setPagando] = useState<ContaDaTela | null>(null);
  const [estornando, setEstornando] = useState<ContaDaTela | null>(null);
  const [vendoAnexos, setVendoAnexos] = useState<{ conta: ContaDaTela; aba: AbaDosAnexos } | null>(null);

  const { data: fluxo = [] } = useQuery({
    queryKey: ["vw-fluxo-caixa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vw_fluxo_caixa")
        .select("*")
        .order("data", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ["contas-pagar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_pagar")
        .select("*")
        .order("vencimento", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Anexos de todas as contas numa leitura só (são poucos): a linha mostra o clipe com a
  // contagem e o aviso de paga sem comprovante sem uma consulta por conta.
  const anexosQuery = useQuery({
    queryKey: ["contas-pagar-anexos"],
    retry: (falhas, erro) => !recursoAusente(erro as ErroDoBanco) && falhas < 2,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contas_pagar_anexos")
        .select("id, conta_pagar_id, tipo, caminho, nome_arquivo, mime, tamanho_bytes, enviado_por_nome, enviado_em")
        .order("enviado_em", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AnexoDaConta[];
    },
  });
  const estadoDoPacote: EstadoDoPacote = anexosQuery.isPending
    ? "carregando"
    : anexosQuery.isError
      ? recursoAusente(anexosQuery.error as ErroDoBanco)
        ? "ausente"
        : "erro"
      : "ativo";
  const pacoteAtivo = estadoDoPacote === "ativo";
  const anexosDe = useMemo(() => anexosPorConta(anexosQuery.data ?? []), [anexosQuery.data]);
  const semAnexos: AnexoDaConta[] = [];

  function recarregarContas() {
    qc.invalidateQueries({ queryKey: ["contas-pagar"] });
    qc.invalidateQueries({ queryKey: ["caixa-movimentos"] });
    qc.invalidateQueries({ queryKey: ["vw-fluxo-caixa"] });
    qc.invalidateQueries({ queryKey: ["contas-pagar-anexos"] });
    qc.invalidateQueries({ queryKey: ["contas-pagar-historico"] });
  }

  // Lista de contas a pagar: busca, situação e período (Onda 3). O recorte nasce em
  // "Todos"; as contagens dos chips e os totais acompanham o que está na tela.
  const [filtro, setFiltro] = useState<FiltroDaLista>(FILTRO_VAZIO);
  const hojeDaLista = hoje();
  const periodos = useMemo(() => periodosDaLista(hojeDaLista), [hojeDaLista]);
  const doPeriodo = useMemo(
    () => filtrarPorPeriodoEBusca(contas, filtro, hojeDaLista),
    [contas, filtro, hojeDaLista],
  );
  const contagens = useMemo(() => contarPorSituacao(doPeriodo, hojeDaLista), [doPeriodo, hojeDaLista]);
  const visiveis = useMemo(
    () => filtrarPorSituacao(doPeriodo, filtro.situacao, hojeDaLista),
    [doPeriodo, filtro.situacao, hojeDaLista],
  );
  const totaisDaTela = useMemo(() => totaisDaLista(visiveis, hojeDaLista), [visiveis, hojeDaLista]);
  const filtrando =
    filtro.situacao !== "tudo" || filtro.periodo !== "todos" || filtro.busca.trim() !== "";

  // Seleção e visões (02/11): total dos marcados, resumo para copiar, CSV e filtros guardados.
  // Nada aqui mexe em dinheiro: dar baixa em lote fica para quando o dono decidir.
  const marcacao = useSelecaoDeContas(contas, visiveis, idDaContaAPagar);
  const totaisDaSelecao = useMemo(
    () => totaisDaLista(marcacao.selecionadas, hojeDaLista),
    [marcacao.selecionadas, hojeDaLista],
  );
  const visoes = useVisoesSalvas<FiltroDaLista>("contas-a-pagar", validarFiltroAPagar);
  const visaoDeAgora = visaoAtiva(visoes.visoes, filtro);

  async function copiarResumoDaSelecao() {
    const ok = await copiarTexto(resumoDaSelecao(TELA_A_PAGAR, totaisDaSelecao));
    if (ok) toast.success("Resumo copiado. Cole no WhatsApp ou no e-mail.");
    else toast.error("Não consegui copiar. Baixe o CSV ou selecione o texto à mão.");
  }

  function baixarCsvDaSelecao() {
    const linhas = marcacao.selecionadas.map((c) => [
      c.descricao,
      c.fornecedor,
      c.categoria,
      dataBr(c.vencimento),
      ROTULO_DA_SITUACAO[situacaoDaConta(c, hojeDaLista)] ?? "",
      Number(c.valor ?? 0),
    ]);
    const csv = csvDeLinhas(["Descrição", "Fornecedor", "Categoria", "Vencimento", "Situação", "Valor"], linhas);
    if (baixarTexto(nomeDoArquivoCsv("contas a pagar selecionadas", hojeDaLista), csv)) {
      toast.success(`${linhas.length} ${linhas.length === 1 ? "conta baixada" : "contas baixadas"} em CSV.`);
    }
  }

  const { data: movimentos = [] } = useQuery({
    queryKey: ["caixa-movimentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixa_movimentos")
        .select("*")
        .order("data", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const salvarConta = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("contas_pagar")
        .insert({
          descricao: conta.descricao,
          fornecedor: conta.fornecedor || null,
          categoria: conta.categoria,
          valor: Number(conta.valor) || 0,
          vencimento: conta.vencimento,
          recorrente: conta.recorrente,
          periodicidade: conta.recorrente ? conta.periodicidade : null,
        })
        .select("id")
        .single();
      if (error) throw error;
      // A conta já existe. Arquivo que não subir não desfaz o lançamento: vira aviso e pode ser
      // anexado depois pelo clipe da linha.
      if (anexosDaNovaConta.length === 0) return { enviados: 0, falhas: [] as string[] };
      return enviarAnexos(data.id, anexosDaNovaConta);
    },
    onSuccess: (envio) => {
      if (envio.falhas.length > 0) {
        toast.warning(`Conta lançada, mas nem todo arquivo foi anexado: ${envio.falhas.join(" ")}`);
      } else if (envio.enviados > 0) {
        toast.success(`Conta lançada com ${envio.enviados} ${envio.enviados === 1 ? "anexo" : "anexos"}`);
      } else {
        toast.success("Conta lançada");
      }
      recarregarContas();
      setContaOpen(false);
      setConta(emptyConta);
      setAnexosDaNovaConta([]);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const salvarMov = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("caixa_movimentos").insert({
        tipo: mov.tipo,
        origem: "manual",
        descricao: mov.descricao,
        categoria: mov.categoria,
        valor: Number(mov.valor) || 0,
        data: mov.data,
        realizado: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimento lançado");
      qc.invalidateQueries({ queryKey: ["caixa-movimentos"] });
      qc.invalidateQueries({ queryKey: ["vw-fluxo-caixa"] });
      setMovOpen(false);
      setMov(emptyMov);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const kpis = useMemo(() => {
    let entradaPrev = 0,
      entradaReal = 0,
      saidaPrev = 0,
      saidaReal = 0;
    for (const f of fluxo) {
      const valor = Number(f.valor ?? 0);
      if (f.tipo === "entrada") {
        entradaPrev += valor;
        if (f.realizado) entradaReal += valor;
      } else {
        saidaPrev += valor;
        if (f.realizado) saidaReal += valor;
      }
    }
    return {
      entradaPrev,
      entradaReal,
      saidaPrev,
      saidaReal,
      saldoReal: entradaReal - saidaReal,
      saldoPrev: entradaPrev - saidaPrev,
    };
  }, [fluxo]);

  /**
   * Saldo REAL das contas, do extrato bancário.
   *
   * O "saldo realizado" abaixo é entradas menos saídas de `caixa_movimentos` —
   * movimento líquido do que foi LANÇADO no sistema. Não é o saldo da conta:
   * ignora o saldo inicial e ignora tudo que passou pelo banco sem ninguém
   * lançar. Os dois números são úteis, mas confundir um com o outro é decidir
   * pagamento olhando dinheiro que não está lá.
   */
  const { data: contasBancarias = [] } = useQuery({
    queryKey: ["saldo-contas"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("saldo_contas_bancarias");
      if (error) throw error;
      return data ?? [];
    },
  });

  // As mesmas contas ativas do card "Saldo em conta": a origem do dinheiro no diálogo de pagar.
  const contasParaPagar = useMemo<ContaBancariaDaLista[]>(
    () =>
      (contasBancarias as ContaBancariaDaLista[]).map((c) => ({
        conta_id: String(c.conta_id),
        nome: String(c.nome),
        banco: c.banco ?? null,
      })),
    [contasBancarias],
  );

  const saldoBancario = contasBancarias.reduce(
    (soma: number, c: any) => soma + Number(c.saldo_atual ?? 0),
    0,
  );
  const temExtrato = contasBancarias.some((c: any) => Number(c.lancamentos ?? 0) > 0);

  const serie = useMemo(() => {
    const mapa = new Map<string, { data: string; entradas: number; saidas: number; saldo: number }>();
    for (const f of fluxo) {
      const dia = String(f.data);
      const atual = mapa.get(dia) ?? { data: dia, entradas: 0, saidas: 0, saldo: 0 };
      const valor = Number(f.valor ?? 0);
      if (f.tipo === "entrada") atual.entradas += valor;
      else atual.saidas += valor;
      mapa.set(dia, atual);
    }
    const ordenado = [...mapa.values()].sort((a, b) => a.data.localeCompare(b.data));
    let acumulado = 0;
    return ordenado.map((d) => {
      acumulado += d.entradas - d.saidas;
      return {
        ...d,
        saldo: acumulado,
        label: new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
      };
    });
  }, [fluxo]);

  const atrasadas = contas.filter(
    (c) => c.status !== "paga" && c.status !== "cancelada" && c.vencimento < hoje(),
  );

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/fluxo-caixa")}
        breadcrumb="Financeiro"
        title="Fluxo de caixa"
        description="Entradas dos recebimentos, saídas das contas a pagar e lançamentos manuais — previsto e realizado."
        actions={
          podeLancar && (
            <>
              <Button variant="outline" onClick={() => setMovOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Movimento
              </Button>
              <NeonButton onClick={() => setContaOpen(true)}>
                <Plus className="h-4 w-4" />
                Conta a pagar
              </NeonButton>
            </>
          )
        }
      />

      {/* Sem pagamentos.create não há baixa aqui: "Pagar" também lança no caixa. */}
      {!podeLancar && (
        <p className="mb-4 text-sm text-muted-foreground">Lançar e dar baixa é com o financeiro.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <KpiCard
          label="Entradas realizadas"
          value={brl(kpis.entradaReal)}
          icon={ArrowUpCircle}
          tone="lime"
          hint={`Previsto ${brl(kpis.entradaPrev)}`}
        />
        <KpiCard
          label="Saídas realizadas"
          value={brl(kpis.saidaReal)}
          icon={ArrowDownCircle}
          tone="magenta"
          hint={`Previsto ${brl(kpis.saidaPrev)}`}
        />
        <KpiCard
          label="Movimento lançado"
          value={brl(kpis.saldoReal)}
          icon={Wallet}
          tone={kpis.saldoReal >= 0 ? "cyan" : "magenta"}
          hint="entradas menos saídas do caixa"
        />
        <KpiCard
          label="Saldo em conta"
          value={contasBancarias.length === 0 ? "sem conta" : brl(saldoBancario)}
          icon={Landmark}
          tone={saldoBancario >= 0 ? "cyan" : "magenta"}
          hint={
            contasBancarias.length === 0
              ? "cadastre em Contas bancárias"
              : temExtrato
                ? `${contasBancarias.length} conta(s), com extrato`
                : "só saldo inicial — importe o extrato"
          }
        />
        <KpiCard
          label="Saldo projetado"
          value={brl(kpis.saldoPrev)}
          icon={TrendingUp}
          tone={kpis.saldoPrev >= 0 ? "cyan" : "magenta"}
          hint={atrasadas.length > 0 ? `${atrasadas.length} conta(s) atrasada(s)` : undefined}
        />
      </div>

      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
            Projeção de saldo
          </div>
          {serie.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Sem lançamentos ainda. Cadastre contas a pagar e registre recebimentos para ver a
              curva de caixa.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serie}>
                  <defs>
                    <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--bex-cyan)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--bex-cyan)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                  <RTooltip
                    formatter={(v) => brl(Number(v))}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="saldo"
                    stroke="var(--bex-cyan)"
                    fill="url(#gSaldo)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="pagar">
        <TabsList>
          <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
          <TabsTrigger value="movimentos">Movimentos</TabsTrigger>
        </TabsList>

        <TabsContent value="pagar" className="mt-4">
          <Card>
            {contas.length > 0 && (
              <div className="space-y-3 border-b border-border p-4">
                <CampoDeBusca
                  rotulo="Buscar conta a pagar"
                  placeholder="Buscar por descrição, fornecedor ou categoria"
                  valor={filtro.busca}
                  onChange={(busca) => setFiltro((f) => ({ ...f, busca }))}
                />
                <GrupoDeChips
                  rotulo="Situação"
                  opcoes={CHIPS_DE_SITUACAO.map((c) => ({ ...c, quantidade: contagens[c.id] }))}
                  valor={filtro.situacao}
                  onChange={(situacao) => setFiltro((f) => ({ ...f, situacao }))}
                />
                <GrupoDeChips
                  rotulo="Período do vencimento"
                  opcoes={periodos.map((p) => ({ id: p.id, rotulo: p.rotulo }))}
                  valor={filtro.periodo}
                  onChange={(periodo) => setFiltro((f) => ({ ...f, periodo }))}
                />
                <BarraDeVisoes
                  visoes={visoes.visoes}
                  ativaId={visaoDeAgora?.id ?? null}
                  podeGuardar={filtrando}
                  onAplicar={(v) => setFiltro(v.filtro)}
                  onGuardar={(nome) => visoes.guardar(nome, filtro)}
                  onRemover={visoes.remover}
                />
                {filtrando && (
                  <AvisoDeFiltro
                    mostrando={visiveis.length}
                    total={contas.length}
                    onLimpar={() => setFiltro(FILTRO_VAZIO)}
                  />
                )}
              </div>
            )}
            {marcacao.selecionadas.length > 0 && (
              <BarraDaSelecao
                totais={totaisDaSelecao}
                tela={TELA_A_PAGAR}
                rotuloPagas={TELA_A_PAGAR.rotuloPagas}
                foraDoFiltro={marcacao.fora}
                onCopiar={() => void copiarResumoDaSelecao()}
                onBaixarCsv={baixarCsvDaSelecao}
                onLimpar={marcacao.limpar}
              />
            )}
            {!isLoading && visiveis.length > 0 && (
              <CabecalhoDaSelecao estado={marcacao.estado} aparecem={visiveis.length} onAlternar={marcacao.alternarCabecalho} />
            )}
            <CardContent className="p-0">
              {isLoading ? (
                <Carregando />
              ) : contas.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Nenhuma conta a pagar lançada
                </div>
              ) : visiveis.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Nenhuma conta com esses filtros
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visiveis.map((c) => {
                    const atrasada =
                      c.status !== "paga" && c.status !== "cancelada" && c.vencimento < hoje();
                    const anexosDaConta = anexosDe.get(c.id) ?? semAnexos;
                    const arquivos = quantidadeDeArquivos(c, anexosDaConta);
                    const semComprovante = pacoteAtivo && pagaSemComprovante(c, anexosDaConta);
                    return (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-4 pl-2"
                      >
                        <CaixaDeSelecao
                          marcada={marcacao.selecao.has(c.id)}
                          onChange={() => marcacao.alternarConta(c.id)}
                          rotulo={`Selecionar ${c.descricao}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{c.descricao}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.fornecedor || "sem fornecedor"} · {c.categoria} · vence{" "}
                            {new Date(`${c.vencimento}T12:00:00`).toLocaleDateString("pt-BR")}
                            {c.status === "paga" && c.data_pagamento && (
                              <>
                                {" "}
                                · paga em{" "}
                                {new Date(`${c.data_pagamento}T12:00:00`).toLocaleDateString("pt-BR")}
                              </>
                            )}
                          </div>
                          {/* Paga e sem prova: o mesmo aviso das parcelas de Despesas fixas e contratos. */}
                          {semComprovante && (
                            <div className="text-xs text-status-amber">sem comprovante</div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                          <StatusChip
                            label={atrasada ? "Atrasada" : c.status}
                            tone={
                              c.status === "paga" ? "lime" : atrasada ? "magenta" : "amber"
                            }
                          />
                          <span className="font-bold tabular-nums">{brl(Number(c.valor))}</span>
                          {pacoteAtivo && (arquivos > 0 || podeAnexar) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-11 min-w-11 gap-1 px-2"
                              aria-label={`${arquivos === 1 ? "1 anexo" : `${arquivos} anexos`} de ${c.descricao}`}
                              onClick={() => setVendoAnexos({ conta: c, aba: "anexos" })}
                            >
                              <Paperclip className="h-4 w-4" />
                              <span className="tabular-nums">{arquivos}</span>
                            </Button>
                          )}
                          {pacoteAtivo && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11"
                              aria-label={`Histórico de ${c.descricao}`}
                              onClick={() => setVendoAnexos({ conta: c, aba: "historico" })}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          )}
                          {c.status !== "paga" && c.status !== "cancelada" && podeDarBaixa && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={estadoDoPacote === "carregando"}
                              onClick={() => setPagando(c)}
                            >
                              Pagar
                            </Button>
                          )}
                          {c.status === "paga" && pacoteAtivo && podeEstornar && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setEstornando(c)}
                            >
                              <Undo2 className="mr-1 h-4 w-4" />
                              Estornar
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
            {contas.length > 0 && <RodapeDeTotais totais={totaisDaTela} />}
          </Card>
        </TabsContent>

        <TabsContent value="movimentos" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {movimentos.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Nenhum movimento registrado
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {movimentos.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{m.descricao}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(`${m.data}T12:00:00`).toLocaleDateString("pt-BR")} ·{" "}
                          {m.categoria || "geral"} · {m.origem}
                        </div>
                      </div>
                      <span
                        className={
                          m.tipo === "entrada"
                            ? "font-bold tabular-nums text-[color:var(--bex-lime)]"
                            : "font-bold tabular-nums text-[color:var(--bex-magenta)]"
                        }
                      >
                        {m.tipo === "entrada" ? "+" : "−"} {brl(Number(m.valor))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={contaOpen} onOpenChange={setContaOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Nova conta a pagar</DialogTitle>
            {/* Este diálogo lança UMA conta. Quem cai aqui para lançar a
                parcela do financiamento vai voltar todo mês para lançar a
                próxima — e é isso que Compromissos existe para evitar. */}
            <DialogDescription>
              Conta avulsa. Se for parcela de financiamento, locação, aluguel ou
              assinatura, cadastre em{" "}
              <Link to="/compromissos" className="underline font-medium">
                Compromissos
              </Link>{" "}
              — lá o contrato gera as parcelas de uma vez, com saldo devedor e
              data de término.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="fluxo-10-descricao" className="flex items-center gap-1.5">Descrição *<DicaIcone texto={dicaCampo("/fluxo-caixa", "Descrição *")} rotulo="Descrição *" /></Label>
              <Input id="fluxo-10-descricao"
                value={conta.descricao}
                onChange={(e) => setConta((c) => ({ ...c, descricao: e.target.value }))}
                placeholder="Bobina de lona 440g"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fluxo-9-fornecedor" className="flex items-center gap-1.5">Fornecedor<DicaIcone texto={dicaCampo("/fluxo-caixa", "Fornecedor")} rotulo="Fornecedor" /></Label>
              <Input id="fluxo-9-fornecedor"
                value={conta.fornecedor}
                onChange={(e) => setConta((c) => ({ ...c, fornecedor: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fluxo-8-categoria" className="flex items-center gap-1.5">Categoria<DicaIcone texto={dicaCampo("/fluxo-caixa", "Categoria")} rotulo="Categoria" /></Label>
              <Select
                value={conta.categoria}
                onValueChange={(v) => setConta((c) => ({ ...c, categoria: v }))}
              >
                <SelectTrigger id="fluxo-8-categoria">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fluxo-7-valor-r" className="flex items-center gap-1.5">Valor (R$)<DicaIcone texto={dicaCampo("/fluxo-caixa", "Valor (R$)")} rotulo="Valor (R$)" /></Label>
              <Input id="fluxo-7-valor-r"
                type="number"
                value={conta.valor}
                onChange={(e) => setConta((c) => ({ ...c, valor: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fluxo-6-vencimento" className="flex items-center gap-1.5">Vencimento<DicaIcone texto={dicaCampo("/fluxo-caixa", "Vencimento")} rotulo="Vencimento" /></Label>
              <Input id="fluxo-6-vencimento"
                type="date"
                value={conta.vencimento}
                onChange={(e) => setConta((c) => ({ ...c, vencimento: e.target.value }))}
              />
            </div>
            {pacoteAtivo && podeAnexar && (
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="fluxo-anexos-nova-conta">Anexos (fatura, boleto ou comprovante)</Label>
                <CampoDeAnexos
                  id="fluxo-anexos-nova-conta"
                  itens={anexosDaNovaConta}
                  onChange={setAnexosDaNovaConta}
                  disabled={salvarConta.isPending}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => salvarConta.mutate()}
              disabled={!conta.descricao || salvarConta.isPending}
            >
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Movimento de caixa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fluxo-5-tipo" className="flex items-center gap-1.5">Tipo<DicaIcone texto={dicaCampo("/fluxo-caixa", "Tipo")} rotulo="Tipo" /></Label>
              <Select value={mov.tipo} onValueChange={(v) => setMov((m) => ({ ...m, tipo: v }))}>
                <SelectTrigger id="fluxo-5-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fluxo-4-data" className="flex items-center gap-1.5">Data<DicaIcone texto={dicaCampo("/fluxo-caixa", "Data")} rotulo="Data" /></Label>
              <Input id="fluxo-4-data"
                type="date"
                value={mov.data}
                onChange={(e) => setMov((m) => ({ ...m, data: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="fluxo-3-descricao" className="flex items-center gap-1.5">Descrição *<DicaIcone texto={dicaCampo("/fluxo-caixa", "Descrição *")} rotulo="Descrição *" /></Label>
              <Input id="fluxo-3-descricao"
                value={mov.descricao}
                onChange={(e) => setMov((m) => ({ ...m, descricao: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fluxo-2-categoria" className="flex items-center gap-1.5">Categoria<DicaIcone texto={dicaCampo("/fluxo-caixa", "Categoria")} rotulo="Categoria" /></Label>
              <Input id="fluxo-2-categoria"
                value={mov.categoria}
                onChange={(e) => setMov((m) => ({ ...m, categoria: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fluxo-1-valor-r" className="flex items-center gap-1.5">Valor (R$)<DicaIcone texto={dicaCampo("/fluxo-caixa", "Valor (R$)")} rotulo="Valor (R$)" /></Label>
              <Input id="fluxo-1-valor-r"
                type="number"
                value={mov.valor}
                onChange={(e) => setMov((m) => ({ ...m, valor: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => salvarMov.mutate()}
              disabled={!mov.descricao || salvarMov.isPending}
            >
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pagando && (
        <PagarContaDialog
          key={pagando.id}
          conta={{
            id: pagando.id,
            descricao: pagando.descricao,
            fornecedor: pagando.fornecedor,
            valor: Number(pagando.valor),
            vencimento: pagando.vencimento,
          }}
          contasBancarias={contasParaPagar}
          hoje={hojeDaLista}
          pacoteAtivo={estadoDoPacote !== "ausente"}
          onFechar={() => setPagando(null)}
          onPago={() => {
            setPagando(null);
            recarregarContas();
          }}
        />
      )}

      {estornando && (
        <EstornarContaDialog
          key={estornando.id}
          conta={{
            id: estornando.id,
            descricao: estornando.descricao,
            fornecedor: estornando.fornecedor,
            valor: Number(estornando.valor),
            data_pagamento: estornando.data_pagamento,
          }}
          onFechar={() => setEstornando(null)}
          onEstornado={() => {
            setEstornando(null);
            recarregarContas();
          }}
        />
      )}

      {vendoAnexos && (
        <AnexosDaContaDialog
          key={`${vendoAnexos.conta.id}-${vendoAnexos.aba}`}
          conta={vendoAnexos.conta}
          anexos={anexosDe.get(vendoAnexos.conta.id) ?? semAnexos}
          abaInicial={vendoAnexos.aba}
          onFechar={() => setVendoAnexos(null)}
          onMudou={recarregarContas}
        />
      )}
    </div>
  );
}
