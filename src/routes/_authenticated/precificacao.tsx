import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Calculator, ChevronsUpDown, Lock, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { BarraDeComposicao } from "@/components/orcamento/barra-de-composicao";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { custoMaterial } from "@/domain/orcamentos/cost-engine";
import type { FaixaPreco } from "@/domain/orcamentos/faixas";
import {
  alterados,
  comZeroNoQueFalta,
  lerParametros,
  PARAMETROS,
  rotuloDoParametro,
  unidadeDoParametro,
  type CodigoParametro,
  type LinhaDeParametro,
} from "@/domain/precificacao/parametros";
import {
  custoDoMaterial,
  margemNoPreco,
  maquinaEscolhida,
  materiaisDoProduto,
  precoDaMargemMinima,
  precoDeTabela,
  ROTULO_PAGAMENTO,
  simular,
  type LinhaDeMaterial,
  type MaquinaDoCatalogo,
  type OrigemDoMaterial,
  type Pagamento,
  type Tabela,
} from "@/domain/precificacao/simulador";

type Busca = { produto?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/precificacao")({
  head: () => ({ meta: [{ title: "Simulador de preço — BEX PRINT OS" }] }),
  // `?produto=<id>` abre o simulador já com o produto — é o que o botão da
  // ficha do produto precisa para não cair numa tela em branco. A chave vai
  // sempre, mesmo vazia: o roteador junta o valor cru da URL com o validado.
  validateSearch: (busca: Record<string, unknown>): Busca => ({
    produto: typeof busca.produto === "string" && UUID.test(busca.produto) ? busca.produto : undefined,
  }),
  component: PrecificacaoPage,
});

/**
 * /precificacao — simulador de preço ligado à realidade.
 *
 * Antes era uma calculadora solta: 45, 8, 25, 35, 12, 5 e margem 50 escritos
 * no código, nenhuma leitura do banco, nada gravado. Agora:
 *
 *   - começa dos parâmetros da casa (`custos_tabela`), lidos ao abrir e de novo
 *     ao voltar para a aba;
 *   - parte de um produto real (ficha técnica, máquina padrão, tempo) e/ou de
 *     materiais reais, com o custo médio de cada um;
 *   - a conta é a do motor do orçamento (`domain/precificacao/simulador`, que
 *     usa `cost-engine`, `encargos` e `faixas` — nenhuma fórmula nova);
 *   - mudar um número aqui NÃO grava. "Salvar na casa" é do admin e usa o
 *     mesmo caminho da tela de parâmetros (UPDATE em `custos_tabela`, com
 *     histórico pelo gatilho);
 *   - custo, margem e markup são do financeiro: quem não vê financeiro é
 *     barrado com o motivo, e as views `_financeiro` não devolveriam nada.
 */
function PrecificacaoPage() {
  const { canSeeFinancials } = useAuth();
  if (!canSeeFinancials) return <Barrado />;
  return <Simulador />;
}

function Barrado() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <h1 className="text-2xl font-semibold tracking-tight">Simulador de preço</h1>
      <p className="text-muted-foreground">
        O simulador mostra o custo de material, de máquina e de gente, e a margem da casa — são números do
        financeiro, e o seu perfil não vê financeiro. Para o preço de um trabalho, o orçamento já mostra o preço
        de venda; para mudar a regra de preço, fale com a gerência.
      </p>
      <Link
        to="/dashboard"
        className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto"
      >
        Ir para o início
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ tipos lidos

type ProdutoFinanceiro = {
  id: string;
  nome: string;
  sku: string | null;
  unidade: string | null;
  categoria: string | null;
  tempo_producao_min: number | null;
  maquina_padrao_id: string | null;
  preco_base: number | string | null;
  custo_medio: number | string | null;
  margem_minima: number | string | null;
};

type MaterialFinanceiro = {
  id: string;
  nome: string;
  unidade: string | null;
  custo_medio: number | string | null;
  custo_unitario: number | string | null;
  status: string | null;
};

type LinhaDeParametroLida = LinhaDeParametro & { updated_at: string | null };

const CHAVE_PARAMETROS = ["precificacao-parametros"] as const;

// ------------------------------------------------------------------ formatação

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (fracao: number) =>
  `${(fracao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const n3 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function formatarParametro(valor: number, unidade: string): string {
  if (unidade === "%") return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (unidade.startsWith("R$")) {
    const casas = unidade === "R$/kWh" ? 4 : 2;
    return `${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas })}${unidade.slice(2)}`;
  }
  return `${valor.toLocaleString("pt-BR")} ${unidade}`.trim();
}

function formatarHoras(horas: number): string {
  const minutos = Math.round(horas * 60);
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Campo numérico: vazio é zero na conta — o que está na caixa é o que vale. */
const doCampo = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return String(v ?? "").trim() === "" || !Number.isFinite(n) ? 0 : n;
};

let sequencia = 0;
const novaChave = () => `mat-${Date.now()}-${++sequencia}`;

// ------------------------------------------------------------------ a tela

function Simulador() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  // "Salvar na casa" é do admin. A RLS de custos_tabela aceita admin ou quem
  // tem custos.update; a tela segue o pedido do dono: só admin.
  const ehAdmin = hasRole("admin");

  // ---------------------------------------------------------------- leituras
  const parametros = useQuery({
    queryKey: CHAVE_PARAMETROS,
    queryFn: async (): Promise<LinhaDeParametroLida[]> => {
      const { data, error } = await supabase
        .from("custos_tabela")
        .select("id, codigo, descricao, unidade, valor, updated_at")
        .eq("ativo", true);
      if (error) throw error;
      return (data ?? []) as unknown as LinhaDeParametroLida[];
    },
  });

  const produtos = useQuery({
    queryKey: ["precificacao-produtos"],
    queryFn: async (): Promise<ProdutoFinanceiro[]> => {
      const { data, error } = await fromFinancialView("produtos", "financeiro")
        .select(
          "id, nome, sku, unidade, categoria, tempo_producao_min, maquina_padrao_id, preco_base, custo_medio, margem_minima",
        )
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ProdutoFinanceiro[];
    },
  });

  const materiais = useQuery({
    queryKey: ["precificacao-materiais"],
    queryFn: async (): Promise<MaterialFinanceiro[]> => {
      const { data, error } = await fromFinancialView("materiais", "financeiro")
        .select("id, nome, unidade, custo_medio, custo_unitario, status")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as MaterialFinanceiro[];
    },
  });

  const maquinas = useQuery({
    queryKey: ["precificacao-maquinas"],
    queryFn: async (): Promise<MaquinaDoCatalogo[]> => {
      const { data, error } = await supabase
        .from("maquinas")
        .select("id, nome, custo_hora, potencia_kw, setup_min")
        .eq("ativa", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as MaquinaDoCatalogo[];
    },
  });

  // ---------------------------------------------------------------- estado
  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState("1");
  const [tabela, setTabela] = useState<Tabela>("varejo");
  const [pagamento, setPagamento] = useState<Pagamento>("media");
  const [linhas, setLinhas] = useState<LinhaDeMaterial[]>([]);
  const [origem, setOrigem] = useState<OrigemDoMaterial | null>(null);
  const [maquinaId, setMaquinaId] = useState<string>("nenhuma");
  const [minutos, setMinutos] = useState("");
  const [outros, setOutros] = useState("");
  // null = a pessoa ainda não mexeu: a simulação usa exatamente os números da casa.
  const [simulados, setSimulados] = useState<Partial<Record<CodigoParametro, string>> | null>(null);
  const [aGravar, setAGravar] = useState<{ codigo: CodigoParametro; valor: number } | null>(null);

  const produto = (produtos.data ?? []).find((p) => p.id === produtoId) ?? null;
  const unidade = produto?.unidade ?? "un";

  const ficha = useQuery({
    queryKey: ["precificacao-ficha", produtoId],
    enabled: !!produtoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produto_materiais")
        .select("material_id, quantidade_por_unidade")
        .eq("produto_id", produtoId as string);
      if (error) throw error;
      return (data ?? []) as unknown as { material_id: string; quantidade_por_unidade: number }[];
    },
  });

  const faixas = useQuery({
    queryKey: ["precificacao-faixas", produtoId],
    enabled: !!produtoId,
    queryFn: async (): Promise<FaixaPreco[]> => {
      const { data, error } = await (supabase as any)
        .from("produto_faixas_preco")
        .select("id, quantidade_minima, preco_unitario, vigencia_inicio, vigencia_fim")
        .eq("produto_id", produtoId);
      if (error) throw error;
      return ((data ?? []) as FaixaPreco[]).map((f) => ({
        ...f,
        quantidade_minima: Number(f.quantidade_minima),
        preco_unitario: Number(f.preco_unitario),
      }));
    },
  });

  // ---------------------------------------------------------- parâmetros da casa
  const leitura = useMemo(() => lerParametros(parametros.data ?? []), [parametros.data]);

  // As caixas começam com o número da casa. Quando a pessoa mexe na primeira,
  // a simulação ganha cópia própria de todas — e a partir daí uma nova leitura
  // da casa (outra aba, outra pessoa) não apaga o que ela está testando.
  const textoDaCasa = (c: CodigoParametro) =>
    leitura.valores[c] === undefined ? "" : String(leitura.valores[c]);
  const textoDoParametro = (c: CodigoParametro) => (simulados ? (simulados[c] ?? "") : textoDaCasa(c));
  function mudarParametro(c: CodigoParametro, texto: string) {
    setSimulados((atual) => ({
      ...(atual ??
        (Object.fromEntries(PARAMETROS.map((p) => [p.codigo, textoDaCasa(p.codigo)])) as Partial<
          Record<CodigoParametro, string>
        >)),
      [c]: texto,
    }));
  }

  const valoresSimulados = useMemo(
    () =>
      simulados === null
        ? comZeroNoQueFalta(leitura.valores)
        : (Object.fromEntries(PARAMETROS.map((p) => [p.codigo, doCampo(simulados[p.codigo])])) as Record<
            CodigoParametro,
            number
          >),
    [simulados, leitura],
  );
  // Compara o que entra na CONTA dos dois lados: parâmetro que a casa não tem
  // vale zero, e caixa vazia também — os dois iguais não são "mudança".
  const mudados =
    parametros.isSuccess && simulados !== null
      ? alterados(comZeroNoQueFalta(leitura.valores), valoresSimulados)
      : [];

  // ---------------------------------------------------------- produto escolhido
  // A ficha entra uma vez por produto escolhido; depois as linhas são da
  // pessoa (ela pode trocar consumo e custo para testar).
  const fichaAplicadaPara = useRef<string | null>(null);
  useEffect(() => {
    if (!produto || !ficha.isSuccess || !materiais.isSuccess) return;
    if (fichaAplicadaPara.current === produto.id) return;
    fichaAplicadaPara.current = produto.id;
    const r = materiaisDoProduto(produto, ficha.data ?? [], materiais.data ?? [], novaChave);
    setLinhas(r.linhas);
    setOrigem(r.origem);
  }, [produto, ficha.isSuccess, ficha.data, materiais.isSuccess, materiais.data]);

  function escolherProduto(p: ProdutoFinanceiro | null) {
    fichaAplicadaPara.current = null;
    setProdutoId(p?.id ?? null);
    setLinhas([]);
    setOrigem(null);
    if (!p) {
      setMinutos("");
      setMaquinaId("nenhuma");
      return;
    }
    setMinutos(p.tempo_producao_min != null ? String(p.tempo_producao_min) : "");
    const padrao = (maquinas.data ?? []).find((m) => m.id === p.maquina_padrao_id);
    setMaquinaId(padrao ? padrao.id : "nenhuma");
  }

  // Produto vindo da URL entra uma vez, quando a lista de produtos e as
  // máquinas (para a máquina padrão) já chegaram.
  const produtoDaUrl = Route.useSearch().produto;
  const urlAplicada = useRef(false);
  useEffect(() => {
    if (urlAplicada.current || !produtoDaUrl || !produtos.isSuccess || !maquinas.isSuccess) return;
    urlAplicada.current = true;
    const p = (produtos.data ?? []).find((x) => x.id === produtoDaUrl);
    if (p) escolherProduto(p);
    else toast.error("O produto do link não está entre os ativos do catálogo.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoDaUrl, produtos.isSuccess, produtos.data, maquinas.isSuccess]);

  function adicionarMaterial() {
    setLinhas((a) => [
      ...a,
      { chave: novaChave(), material_id: null, nome: "", unidade: "un", porUnidade: 1, custoUnitario: 0 },
    ]);
  }

  function trocarMaterial(chave: string, materialId: string) {
    const m = (materiais.data ?? []).find((x) => x.id === materialId);
    if (!m) return;
    setLinhas((a) =>
      a.map((l) =>
        l.chave === chave
          ? { ...l, material_id: m.id, nome: m.nome, unidade: m.unidade ?? "un", custoUnitario: custoDoMaterial(m), semFicha: false }
          : l,
      ),
    );
  }

  function alterarLinha(chave: string, patch: Partial<LinhaDeMaterial>) {
    setLinhas((a) => a.map((l) => (l.chave === chave ? { ...l, ...patch } : l)));
  }

  // ---------------------------------------------------------------- a conta
  const maquina = maquinaEscolhida((maquinas.data ?? []).find((m) => m.id === maquinaId));
  const q = doCampo(quantidade);
  const r = simular({
    quantidade: q,
    materiais: linhas.filter((l) => l.nome),
    maquina,
    minutosPorUnidade: doCampo(minutos),
    outrosPorUnidade: doCampo(outros),
    tabela,
    pagamento,
    parametros: comZeroNoQueFalta(valoresSimulados),
  });
  const tabelaHoje = precoDeTabela(produto, faixas.data ?? [], q);
  const naTabela =
    tabelaHoje.tem && q > 0 ? margemNoPreco(tabelaHoje.unitario * q, r.calculo.custoTotal, r.taxasVendaPct) : null;
  const margemMinima = produto?.margem_minima != null ? Number(produto.margem_minima) : null;
  const precoMinimo =
    margemMinima != null && r.calculo.custoTotal > 0
      ? precoDaMargemMinima(r.calculo.custoTotal, margemMinima, r.taxasVendaPct)
      : null;

  // ---------------------------------------------------------------- gravar
  const gravar = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: number }) => {
      // O mesmo caminho da tela de parâmetros: UPDATE em custos_tabela. O
      // gatilho custos_tabela_log grava o histórico (de → para, quem, quando) e
      // tg_custos_tabela_recompoe_custos recompõe o custo cheio dos produtos.
      // O .select() separa "gravou" de "a RLS recusou em silêncio".
      const { data, error } = await supabase
        .from("custos_tabela")
        .update({ valor })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar os parâmetros da casa.");
    },
    onSuccess: () => {
      toast.success("Parâmetro gravado na casa. Os próximos orçamentos e a Meta do mês já usam o valor novo.");
      setAGravar(null);
      qc.invalidateQueries({ queryKey: CHAVE_PARAMETROS });
      qc.invalidateQueries({ queryKey: ["parametros-da-casa"] });
      qc.invalidateQueries({ queryKey: ["parametros-da-casa-historico"] });
      qc.invalidateQueries({ queryKey: ["ponto-de-equilibrio"] });
      qc.invalidateQueries({ queryKey: ["meta-do-mes"] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  const carregando = parametros.isLoading || produtos.isLoading || materiais.isLoading || maquinas.isLoading;
  const falhas = [
    parametros.isError && { oQue: "os parâmetros da casa", erro: parametros.error, tentar: parametros.refetch },
    produtos.isError && { oQue: "os produtos", erro: produtos.error, tentar: produtos.refetch },
    materiais.isError && { oQue: "os materiais", erro: materiais.error, tentar: materiais.refetch },
    maquinas.isError && { oQue: "as máquinas", erro: maquinas.error, tentar: maquinas.refetch },
    ficha.isError && { oQue: "a ficha técnica do produto", erro: ficha.error, tentar: ficha.refetch },
    faixas.isError && { oQue: "as faixas de preço do produto", erro: faixas.error, tentar: faixas.refetch },
  ].filter(Boolean) as { oQue: string; erro: unknown; tentar: () => void }[];

  const linhaAGravar = aGravar ? leitura.linhas[aGravar.codigo] : undefined;

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/precificacao")}
        breadcrumb="Catálogo & Estoque"
        title="Simulador de preço"
        description="Custo, preço sugerido pelo markup da casa e margem de uma peça real, com os parâmetros da casa lidos agora. Mudar um número aqui não grava nada."
      />

      {falhas.map((f) => (
        <div key={f.oQue} role="alert" className="mb-3 space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
          <p>
            Não deu para carregar {f.oQue}: {mensagemErro(f.erro)}
          </p>
          <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => f.tentar()}>
            Tentar de novo
          </Button>
        </div>
      ))}

      {parametros.isSuccess && leitura.faltando.length > 0 && (
        <div className="mb-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <span>
            A casa não tem {leitura.faltando.length === 1 ? "o parâmetro" : "os parâmetros"}{" "}
            {leitura.faltando.map((c) => rotuloDoParametro(c)).join(", ")}. A conta usa zero ali até alguém cadastrar.
          </span>
        </div>
      )}

      {mudados.length > 0 && (
        <div className="mb-3 flex gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          <Calculator className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600" />
          <span>
            Simulação com {mudados.length === 1 ? "um parâmetro diferente" : `${mudados.length} parâmetros diferentes`} da
            casa ({mudados.map((c) => rotuloDoParametro(c, leitura.linhas[c]).toLowerCase()).join(", ")}). Nada foi gravado.
          </span>
        </div>
      )}

      {carregando ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Carregando os números da casa…</CardContent>
        </Card>
      ) : !parametros.isSuccess ? (
        // Sem os parâmetros da casa a simulação não tem base: mostrar um preço
        // calculado com markup e imposto zerados seria número com cara de medido.
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            O simulador começa dos parâmetros da casa e eles não carregaram — veja o motivo acima.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Produto e quantidade */}
          <Card className="lg:col-start-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">O que simular</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Produto do catálogo</Label>
                <div className="flex gap-2">
                  <EscolherProduto produtos={produtos.data ?? []} produto={produto} onEscolher={escolherProduto} />
                  {produto && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 md:h-9 md:w-9"
                      aria-label="Simular sem produto"
                      onClick={() => escolherProduto(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {produto ? (
                  <div className="flex flex-wrap gap-1.5 pt-1 text-xs">
                    <Badge variant="outline" className="font-normal">vendido por {unidade}</Badge>
                    <Badge variant="outline" className="font-normal">
                      {produto.tempo_producao_min ? `${produto.tempo_producao_min} min por ${unidade}` : "sem tempo de produção"}
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      {origem === "ficha"
                        ? `ficha com ${ficha.data?.length ?? linhas.length} material(is)`
                        : origem === "custo_do_produto"
                          ? "sem ficha: usa o custo digitado no produto"
                          : origem === "nenhuma"
                            ? "sem ficha e sem custo de material"
                            : "lendo a ficha…"}
                    </Badge>
                    {margemMinima != null && (
                      <Badge variant="outline" className="font-normal">margem mínima {margemMinima}%</Badge>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sem produto, monte a peça com os materiais e a máquina abaixo.
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sim-qtd">Quantidade ({unidade})</Label>
                  <Input
                    id="sim-qtd"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={quantidade}
                    onChange={(e) => setQuantidade(e.target.value)}
                    className="h-11 md:h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tabela</Label>
                  <Select value={tabela} onValueChange={(v) => setTabela(v as Tabela)}>
                    <SelectTrigger className="h-11 md:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="varejo">Varejo ({formatarParametro(valoresSimulados.markup_padrao, "%")} de markup)</SelectItem>
                      <SelectItem value="atacado">Atacado ({formatarParametro(valoresSimulados.markup_atacado, "%")} de markup)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Como o cliente paga</Label>
                  <Select value={pagamento} onValueChange={(v) => setPagamento(v as Pagamento)}>
                    <SelectTrigger className="h-11 md:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROTULO_PAGAMENTO) as Pagamento[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {ROTULO_PAGAMENTO[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resultado: no celular logo depois do produto; no computador, ao lado. */}
          <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="space-y-4 lg:sticky lg:top-20">
              <Resultado
                r={r}
                unidade={unidade}
                tabelaHoje={tabelaHoje}
                naTabela={naTabela}
                margemMinima={margemMinima}
                precoMinimo={precoMinimo}
                temProduto={!!produto}
                perdaNaFicha={r.perdaPct > 0 && linhas.some((l) => l.nome && !l.semFicha)}
              />
            </div>
          </aside>

          <div className="space-y-6 lg:col-start-1">
            {/* Materiais */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Materiais por {unidade}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {linhas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {produto && origem === "nenhuma"
                      ? "Este produto não tem ficha técnica nem custo de material cadastrado. Acrescente o que ele consome."
                      : "Nenhum material ainda. Escolha um produto ou acrescente os materiais."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {linhas.map((l) => {
                      const custoLinha = custoMaterial({
                        descricao: l.nome,
                        quantidade: l.porUnidade * q,
                        custoUnitario: l.custoUnitario,
                        perdaPct: l.semFicha ? 0 : r.perdaPct,
                      });
                      return (
                        <li
                          key={l.chave}
                          className="grid grid-cols-2 gap-2 rounded-md border border-border/60 p-2 sm:grid-cols-[minmax(0,1fr)_110px_120px_100px_36px] sm:items-end"
                        >
                          <div className="col-span-2 space-y-1 sm:col-span-1">
                            <Label className="text-xs text-muted-foreground">Material</Label>
                            {l.semFicha ? (
                              <div className="flex h-11 items-center text-sm md:h-9">{l.nome}</div>
                            ) : (
                              <Select value={l.material_id ?? ""} onValueChange={(v) => trocarMaterial(l.chave, v)}>
                                <SelectTrigger className="h-11 md:h-9">
                                  <SelectValue placeholder="Escolha o material" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(materiais.data ?? []).map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                      {m.nome} ({m.unidade ?? "un"}) · {brl(custoDoMaterial(m))}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`cons-${l.chave}`} className="text-xs text-muted-foreground">
                              {l.unidade} por {unidade}
                            </Label>
                            <Input
                              id={`cons-${l.chave}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.001"
                              value={String(l.porUnidade)}
                              onChange={(e) => alterarLinha(l.chave, { porUnidade: doCampo(e.target.value) })}
                              className="h-11 md:h-9"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`custo-${l.chave}`} className="text-xs text-muted-foreground">
                              Custo por {l.unidade}
                            </Label>
                            <Input
                              id={`custo-${l.chave}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={String(l.custoUnitario)}
                              onChange={(e) => alterarLinha(l.chave, { custoUnitario: doCampo(e.target.value) })}
                              className="h-11 md:h-9"
                            />
                          </div>
                          <div className="text-right font-mono text-sm tabular-nums sm:pb-2">{brl(custoLinha)}</div>
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11 md:h-9 md:w-9"
                              aria-label={`Tirar ${l.nome || "esta linha"} da simulação`}
                              onClick={() => setLinhas((a) => a.filter((x) => x.chave !== l.chave))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={adicionarMaterial}>
                    <Plus className="mr-1 h-4 w-4" /> Acrescentar material
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Perda e falha da casa ({pct(r.perdaPct)}) entram em cada material da ficha, como na Meta do mês.
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Máquina e tempo */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Máquina e tempo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_150px]">
                  <div className="space-y-1.5">
                    <Label>Máquina</Label>
                    <Select value={maquinaId} onValueChange={setMaquinaId}>
                      <SelectTrigger className="h-11 md:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhuma">Sem máquina (só gente)</SelectItem>
                        {(maquinas.data ?? []).map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.nome} · {Number(m.custo_hora) > 0 ? `${brl(Number(m.custo_hora))}/h` : "sem custo/hora"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sim-min">Minutos por {unidade}</Label>
                    <Input
                      id="sim-min"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      value={minutos}
                      onChange={(e) => setMinutos(e.target.value)}
                      className="h-11 md:h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sim-outros">Outros por {unidade} (R$)</Label>
                    <Input
                      id="sim-outros"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={outros}
                      onChange={(e) => setOutros(e.target.value)}
                      placeholder="frete, terceiros"
                      className="h-11 md:h-9"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.horas > 0
                    ? `${formatarHoras(r.horas)} de produção para ${n3(q)} ${unidade}. As mesmas horas pagam a máquina, a mão de obra (${brl(r.maoDeObraHora)}/h já com encargos) e o rateio administrativo — a regra do custo cheio do produto.`
                    : "Sem tempo informado, só o material entra na conta."}
                </p>
              </CardContent>
            </Card>

            {/* Parâmetros da casa */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Parâmetros da casa</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Lidos agora de Custos de mão de obra → Parâmetros da casa. Mude à vontade para testar: só o admin grava
                  na casa, e cada gravação fica no histórico.
                </p>
              </CardHeader>
              <CardContent>
                {parametros.isSuccess ? (
                  <ul className="divide-y">
                    {PARAMETROS.map((p) => {
                      const linha = leitura.linhas[p.codigo];
                      const casa = leitura.valores[p.codigo];
                      const un = unidadeDoParametro(p.codigo, linha);
                      const mudou = mudados.includes(p.codigo);
                      return (
                        <li key={p.codigo} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                          <div className="min-w-0 flex-1">
                            <Label htmlFor={`par-${p.codigo}`} className="font-medium">
                              {rotuloDoParametro(p.codigo, linha)}
                            </Label>
                            {mudou && (
                              <p className="text-xs text-sky-700 dark:text-sky-400">
                                na casa: {casa === undefined ? "não cadastrado" : formatarParametro(casa, un)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Input
                              id={`par-${p.codigo}`}
                              type="number"
                              inputMode="decimal"
                              step={p.codigo === "energia_tarifa_kwh" ? "0.0001" : "0.01"}
                              value={textoDoParametro(p.codigo)}
                              onChange={(e) => mudarParametro(p.codigo, e.target.value)}
                              className={`h-11 w-28 text-right md:h-9 ${mudou ? "border-sky-500" : ""}`}
                            />
                            <span className="w-14 text-xs text-muted-foreground">{un}</span>
                            {mudou && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 md:h-9 md:w-9"
                                aria-label={`Voltar ${rotuloDoParametro(p.codigo, linha)} ao valor da casa`}
                                onClick={() => mudarParametro(p.codigo, textoDaCasa(p.codigo))}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                            {mudou && ehAdmin && linha && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-11 md:h-9"
                                onClick={() => setAGravar({ codigo: p.codigo, valor: valoresSimulados[p.codigo] })}
                              >
                                <Save className="mr-1 h-3.5 w-3.5" /> Salvar na casa
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sem os parâmetros da casa a simulação não começa: veja o aviso no topo.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <AlertDialog open={!!aGravar} onOpenChange={(v) => !v && !gravar.isPending && setAGravar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gravar na casa?</AlertDialogTitle>
            <AlertDialogDescription>
              {aGravar && (
                <>
                  {rotuloDoParametro(aGravar.codigo, linhaAGravar)} passa de{" "}
                  <strong>
                    {leitura.valores[aGravar.codigo] === undefined
                      ? "não cadastrado"
                      : formatarParametro(leitura.valores[aGravar.codigo] as number, unidadeDoParametro(aGravar.codigo, linhaAGravar))}
                  </strong>{" "}
                  para{" "}
                  <strong>{formatarParametro(aGravar.valor, unidadeDoParametro(aGravar.codigo, linhaAGravar))}</strong>{" "}
                  para toda a casa: os próximos orçamentos, o custo cheio dos produtos e a Meta do mês passam a usar o
                  valor novo. Orçamento já enviado não muda. Fica no histórico de parâmetros.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9" disabled={gravar.isPending}>
              Voltar
            </AlertDialogCancel>
            {/* Botão comum: a ação do AlertDialog fecharia antes do banco responder. */}
            <Button
              className="h-11 md:h-9"
              disabled={gravar.isPending || !linhaAGravar}
              onClick={() => aGravar && linhaAGravar && gravar.mutate({ id: linhaAGravar.id, valor: aGravar.valor })}
            >
              {gravar.isPending ? "Gravando…" : "Gravar na casa"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ------------------------------------------------------------------ peças

function EscolherProduto({
  produtos,
  produto,
  onEscolher,
}: {
  produtos: ProdutoFinanceiro[];
  produto: ProdutoFinanceiro | null;
  onEscolher: (p: ProdutoFinanceiro) => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={aberto} className="h-11 w-full justify-between md:h-9">
          <span className="truncate">{produto ? produto.nome : `Escolher entre ${produtos.length} produtos ativos…`}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,420px)] p-0" align="start">
        <Command filter={(valor, busca) => (valor.toLowerCase().includes(busca.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Buscar por nome ou código…" />
          <CommandList>
            <CommandEmpty>Nenhum produto com esse nome.</CommandEmpty>
            <CommandGroup>
              {produtos.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.nome} ${p.sku ?? ""}`}
                  onSelect={() => {
                    onEscolher(p);
                    setAberto(false);
                  }}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{p.nome}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {Number(p.preco_base) > 0 ? `${brl(Number(p.preco_base))}/${p.unidade ?? "un"}` : `por faixa · ${p.unidade ?? "un"}`}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LinhaDoResultado({ rotulo, detalhe, valor }: { rotulo: string; detalhe?: string; valor: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="text-sm">{rotulo}</span>
        {detalhe && <span className="block text-xs text-muted-foreground">{detalhe}</span>}
      </span>
      <span className="font-mono text-sm tabular-nums">{brl(valor)}</span>
    </li>
  );
}

function Resultado({
  r,
  unidade,
  tabelaHoje,
  naTabela,
  margemMinima,
  precoMinimo,
  temProduto,
  perdaNaFicha,
}: {
  r: ReturnType<typeof simular>;
  unidade: string;
  tabelaHoje: ReturnType<typeof precoDeTabela>;
  naTabela: ReturnType<typeof margemNoPreco> | null;
  margemMinima: number | null;
  precoMinimo: number | null;
  temProduto: boolean;
  /** alguma linha da ficha levou perda e falha (o custo digitado no produto não leva) */
  perdaNaFicha: boolean;
}) {
  const c = r.calculo;
  const energia =
    c.processos.length > 0 ? `${formatarHoras(r.horas)} de máquina, com a energia na tarifa da casa` : undefined;
  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resultado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">Custo</div>
              <div className="font-mono text-xl font-bold tabular-nums">{brl(c.custoTotal)}</div>
              {r.quantidade > 0 && (
                <div className="text-xs text-muted-foreground">
                  {brl(r.custoUnitario)} por {unidade}
                </div>
              )}
            </div>
            <div className="rounded-lg bg-[color:var(--bex-cyan)]/10 p-3">
              <div className="text-xs text-muted-foreground">Preço sugerido (markup {pct(r.markupPct)})</div>
              <div className="font-mono text-xl font-bold tabular-nums">{brl(c.precoFinal)}</div>
              {r.quantidade > 0 && (
                <div className="text-xs text-muted-foreground">
                  {brl(r.precoSugeridoUnitario)} por {unidade}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span>Lucro no preço sugerido</span>
              <span className={`font-mono font-bold tabular-nums ${c.lucro < 0 ? "text-destructive" : ""}`}>
                {brl(c.lucro)} · {pct(c.margemPct)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Depois de {brl(c.taxasVenda)} de impostos e cartão ({pct(r.taxasVendaPct)} do preço).
            </p>
          </div>

          <ul className="divide-y">
            <LinhaDoResultado
              rotulo="Material"
              detalhe={
                c.materiais.length > 0
                  ? `${c.materiais.length} linha(s)${perdaNaFicha ? `, com ${pct(r.perdaPct)} de perda e falha` : ""}`
                  : undefined
              }
              valor={c.custoMateriais}
            />
            <LinhaDoResultado rotulo="Máquina" detalhe={energia} valor={c.custoProcessos} />
            <LinhaDoResultado
              rotulo="Mão de obra"
              detalhe={r.horas > 0 ? `${formatarHoras(r.horas)} × ${brl(r.maoDeObraHora)}/h com encargos` : undefined}
              valor={c.custoMaoDeObra}
            />
            <LinhaDoResultado rotulo="Rateio administrativo" valor={r.rateioAdministrativo} />
            {r.outros > 0 && <LinhaDoResultado rotulo="Outros" valor={r.outros} />}
          </ul>

          {r.avisos.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              {r.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {temProduto && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">E o preço de tabela de hoje?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {tabelaHoje.tem ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    {brl(tabelaHoje.unitario)} por {unidade}
                    {tabelaHoje.origem === "faixa" && tabelaHoje.aPartirDe != null && (
                      <span className="text-muted-foreground"> (faixa a partir de {n3(tabelaHoje.aPartirDe)})</span>
                    )}
                  </span>
                  {naTabela && (
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        naTabela.lucro < 0
                          ? "text-destructive"
                          : margemMinima != null && naTabela.margemPct * 100 < margemMinima
                            ? "text-amber-600"
                            : ""
                      }`}
                    >
                      margem {pct(naTabela.margemPct)}
                    </span>
                  )}
                </div>
                {naTabela && (
                  <p className="text-xs text-muted-foreground">
                    Com o custo acima, o preço de tabela deixa {brl(naTabela.lucro)} de lucro depois de {brl(naTabela.taxas)} de
                    impostos e cartão.
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{tabelaHoje.motivo}</p>
            )}
            {margemMinima != null && (
              <p className="text-xs text-muted-foreground">
                {precoMinimo != null
                  ? `Para a margem mínima do produto (${margemMinima}%): ${brl(precoMinimo)} no total${
                      r.quantidade > 0 ? `, ${brl(precoMinimo / r.quantidade)} por ${unidade}` : ""
                    }.`
                  : `A margem mínima do produto (${margemMinima}%) somada às taxas passa de 100%: não há preço que a entregue.`}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {c.precoFinal > 0 && (
        <Card>
          <CardContent className="p-4">
            <BarraDeComposicao
              resultado={c}
              taxasVendaPct={r.taxasVendaPct}
              margemMinima={margemMinima != null ? margemMinima / 100 : undefined}
              quantidade={r.quantidade > 0 ? r.quantidade : 1}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
