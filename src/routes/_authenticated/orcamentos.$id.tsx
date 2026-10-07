import { createFileRoute, Link } from "@tanstack/react-router";
import { QuemTrouxeAVenda } from "@/components/os/quem-trouxe-a-venda";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  FileDown,
  Link as LinkIcon,
  Loader2,
  Lock,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Save,
  Trash2,
  TrendingDown,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { PDFPreviewDialog } from "@/lib/pdf/PDFPreviewDialog";
import { PDFHistoryCard } from "@/lib/pdf/PDFHistoryCard";
import {
  EscolhaDeProduto,
  tipoDoItemGravado,
  type ProdutoDaEscolha,
} from "@/components/orcamento/escolha-de-produto";
import { useProdutosParaEscolha } from "@/components/orcamento/use-produtos-para-escolha";
import { MedidasDaPeca } from "@/components/orcamento/medidas-da-peca";
import { QuantidadeDoItem } from "@/components/orcamento/quantidade-do-item";
import { AcabamentoDoItem } from "@/components/orcamento/acabamento-do-item";
import { ResumoDoItem } from "@/components/orcamento/resumo-do-item";
import {
  camposDaUnidade,
  tipoDoProduto,
  tipoPelaChave,
  tipoPeloRotulo,
  unidadeAoEscolherTipo,
  type ChaveDoTipo,
  type TipoDeProduto,
} from "@/domain/orcamentos/tipos-de-produto";
import { CalculadoraCusto } from "@/components/orcamento/calculadora-custo";
import {
  RestricaoDoProduto,
  useRestricaoProduto,
} from "@/components/orcamento/restricao-do-produto";
import {
  AproveitamentoDeBobina,
  useContextoDeBobina,
} from "@/components/orcamento/aproveitamento-card";
import { OrcamentoMaterialCheck } from "@/components/orcamento-material-check";
import {
  DialogoDeLayouts,
  LayoutsDoItem,
  LayoutsDoRascunho,
  MiniaturaDoItem,
  reordenar,
  useCapasDosItens,
  vincularLayouts,
  type LayoutRascunho,
} from "@/components/orcamento/layouts-do-item";
import {
  COLUNAS_DO_ACORDO,
  EntregaEPrazos,
  Observacoes,
  Pagamento,
  type AcordoDoOrcamento,
} from "@/components/orcamento/acordo-do-orcamento";
import {
  DescontoDoOrcamento,
  useDescontoDoOrcamento,
} from "@/components/orcamento/desconto-do-orcamento";
import { gerarLinkPublicoOrcamento } from "@/lib/api/orcamento-publico.functions";
import { StatusChip } from "@/components/bex/StatusChip";
import {
  areaCobrada,
  areaUnitaria,
  descreverMetragem,
  ehUnidadeDeArea,
  precoM2Implicito,
  somaAreaTotal,
  temDimensoes,
  valorUnitarioComMinimo,
} from "@/domain/orcamentos/area";
import {
  descreverFaixa,
  faixaAplicada,
  proximaFaixa,
  type FaixaPreco,
} from "@/domain/orcamentos/faixas";
import { brl, m2, pendenciasParaEnviar } from "@/domain/orcamentos/acordo";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";

import { Dica, DicaIcone } from "@/components/bex/Dica";
import { dicaAcao, dicaCampo, dicaTela } from "@/lib/dicas";

const itemVazio = {
  descricao: "",
  quantidade: "1",
  unidade: "un",
  largura: "",
  altura: "",
  acabamento: "",
  tipo_produto: "",
  especificacao: "",
  preco_m2: "",
  valor_unitario: "0",
  custo_unitario: "0",
  produto_id: null as string | null,
  area_minima: null as number | null,
  margem_minima: null as number | null,
  tempo_producao_min: null as number | null,
  // De onde saiu o custo. 'manual' é o padrão porque o campo é digitável;
  // a calculadora troca para 'motor' e guarda a memória do cálculo.
  origem_calculo: "manual" as string,
  custo_previsto: null as number | null,
  margem_prevista: null as number | null,
  parametros: null as Record<string, unknown> | null,
};

const paraNumero = (texto: string) => {
  const n = Number(String(texto).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

type TamanhoProduto = {
  id: string;
  produto_id: string;
  nome: string;
  largura: number;
  altura: number;
  padrao: boolean;
};

const statusTone: Record<string, "cyan" | "magenta" | "lime" | "amber" | "muted"> = {
  rascunho: "muted",
  enviado: "cyan",
  aprovado: "lime",
  rejeitado: "magenta",
  expirado: "amber",
  convertido: "lime",
};

/** O status como se fala na gráfica (o valor gravado continua o do enum). */
const ROTULO_DO_STATUS: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado ao cliente",
  aprovado: "Aprovado",
  rejeitado: "Recusado",
  expirado: "Expirado",
  convertido: "Virou OS",
};

/** Onde cada pendência se resolve: o aviso do topo leva até o campo. */
const ONDE_RESOLVER: Record<string, string> = {
  "data de entrega": "acordo-entrega",
  "condição de pagamento": "acordo-pagamento",
  "aprovação do desconto": "acordo-desconto",
  itens: "itens-do-orcamento",
};

export const Route = createFileRoute("/_authenticated/orcamentos/$id")({
  head: () => ({ meta: [{ title: "Orçamento — BEX PRINT OS" }] }),
  component: OrcamentoDetailPage,
});

function OrcamentoDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  // canSeePrices/nivelDeVisao: preço de venda (vendedor vê). canSeeFinancials:
  // custo e margem (só financeiro/gestão). Nunca misturar os dois gates.
  const { canSeeFinancials, canSeePrices, nivelDeVisao, hasPermission } = useAuth();
  // Converter em OS é `orcamentos.convert` (só admin e gestor). Editar o
  // orçamento é `orcamentos.update` (o vendedor também tem).
  const podeConverter = hasPermission("orcamentos.convert");
  const podeEditar = hasPermission("orcamentos.update");
  // Mandar ao cliente (link e WhatsApp) é `orcamentos.send`: o banco recusa a
  // geração do link para quem não tem (`orcamento_link_publico`), então o
  // botão nem aparece — antes ele estourava "Orçamento não encontrado".
  const podeMandar = hasPermission("orcamentos.send");
  const [form, setForm] = useState({ ...itemVazio });
  // A escolha visual: o tipo confirmado (lona, adesivo…) e se o item é fora
  // do catálogo. O rótulo curto do tipo é o que vai em `tipo_produto`.
  const [tipoEscolhido, setTipoEscolhido] = useState<ChaveDoTipo | null>(null);
  const [itemLivre, setItemLivre] = useState(false);
  // Produto por unidade pode ganhar medida se o vendedor quiser (era assim).
  const [medidasAbertas, setMedidasAbertas] = useState(false);
  // Artes do item ainda não gravado: já estão no Storage, esperando o item.
  const [layoutsRascunho, setLayoutsRascunho] = useState<LayoutRascunho[]>([]);
  // Item em edição: o mesmo formulário, preenchido, com "Salvar alterações".
  const [editando, setEditando] = useState<{ id: string; numero: number } | null>(null);
  const [salvandoItem, setSalvandoItem] = useState(false);
  const [aRemover, setARemover] = useState<{ id: string; descricao: string; numero: number } | null>(null);
  const [artesDe, setArtesDe] = useState<{ id: string; descricao: string; numero: number } | null>(null);
  const formulario = useRef<HTMLDivElement>(null);
  const [calculadoraAberta, setCalculadoraAberta] = useState(false);
  // Exigência legal do produto (limite eleitoral, por exemplo). Sem gate de
  // financeiro: é informação de venda e de produção, não de dinheiro.
  const { data: restricao } = useRestricaoProduto(form.produto_id);
  // Bobina e boca da máquina do produto: quantas peças saem e quanto material
  // vai embora. Produção, não dinheiro — o cartão não tem valor nenhum.
  const bobina = useContextoDeBobina(form.produto_id);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProducaoOpen, setPreviewProducaoOpen] = useState(false);
  const [gerandoLink, setGerandoLink] = useState(false);
  // Total com o desconto DIGITADO e ainda não aplicado: o Pagamento mostra as
  // parcelas com ele enquanto a pessoa negocia. Nulo = vale o total gravado.
  const [totalPrevisto, setTotalPrevisto] = useState<number | null>(null);
  // Desconto é preço: quem não vê preço nem pergunta (o banco recusaria).
  const desconto = useDescontoDoOrcamento(id, canSeePrices);
  const descontoPendente = desconto.data?.pendente === true;

  const { data: orc, isLoading } = useQuery({
    queryKey: ["orcamento", id, nivelDeVisao],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("orcamentos", nivelDeVisao)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Prazos, entrega, condição de pagamento e observações NÃO existem nas views
  // orcamentos_* — pedir essas colunas lá derrubaria a consulta inteira. Não
  // são dinheiro, então vêm da tabela base com as colunas listadas na mão, sem
  // `select("*")` para não trazer custo junto por acidente. A chave começa com
  // ["orcamento", id]: é o prefixo que o quadro lateral invalida ao gravar.
  const acordo = useQuery({
    queryKey: ["orcamento", id, "acordo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orcamentos")
        .select(COLUNAS_DO_ACORDO)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as AcordoDoOrcamento | null;
    },
  });

  // Falha na lista não pode virar "Sem itens": o vendedor adicionaria de novo.
  const consultaItens = useQuery({
    queryKey: ["orc-itens", id, nivelDeVisao],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("orcamento_itens", nivelDeVisao)
        .select("*")
        .eq("orcamento_id", id)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const itens = consultaItens.data ?? [];
  const capas = useCapasDosItens(
    id,
    itens.map((i) => i.id as string),
  );

  // O catálogo para a escolha visual, com os atalhos. Só consulta quando o
  // formulário está na tela (quem não edita não precisa do catálogo).
  const podeEditarItens = podeEditar && !(orc?.status === "convertido" || !!orc?.os_id);
  const catalogo = useProdutosParaEscolha({
    ativo: !!orc && podeEditarItens,
    clienteId: (orc as any)?.cliente_id ?? null,
  });

  // Tamanhos do produto escolhido no catálogo. Só busca quando há produto: item
  // digitado à mão não tem preset para oferecer.
  const { data: tamanhos = [] } = useQuery({
    queryKey: ["produto-tamanhos", form.produto_id],
    enabled: !!form.produto_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_tamanhos")
        .select("id, produto_id, nome, largura, altura, padrao")
        .eq("produto_id", form.produto_id)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as TamanhoProduto[];
    },
  });

  // Tabela de preço por quantidade do produto — o degrau muda o preço unitário
  // sugerido conforme o vendedor mexe na quantidade.
  const { data: faixas = [] } = useQuery({
    queryKey: ["produto-faixas-preco", form.produto_id],
    enabled: !!form.produto_id && canSeePrices,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_faixas_preco")
        .select(
          "id, quantidade_minima, preco_unitario, preco_m2_referencia, observacao, vigencia_inicio, vigencia_fim",
        )
        .eq("produto_id", form.produto_id);
      if (error) throw error;
      return (data ?? []) as FaixaPreco[];
    },
  });

  function aplicarTamanho(t: TamanhoProduto) {
    setForm((atual) => ({
      ...atual,
      largura: String(t.largura),
      altura: String(t.altura),
    }));
  }

  // Tamanho marcado como padrão entra sozinho: é a medida que a gráfica mais
  // vende daquele produto, e medida redigitada é onde nasce erro de produção.
  useEffect(() => {
    if (!form.produto_id || form.largura || form.altura || editando) return;
    const padrao = tamanhos.find((t) => t.padrao);
    if (padrao) aplicarTamanho(padrao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tamanhos, form.produto_id]);

  async function recalcular() {
    if (!canSeePrices) return;
    // Relê os itens do banco em vez de somar o estado da tela: recalcular é
    // chamado logo depois de inserir/remover, quando `itens` ainda é a lista
    // anterior. Somando o estado velho, o total do orçamento ficava zerado após
    // adicionar o primeiro item — e era esse zero que ia para o PDF e para a
    // conta a receber criada na conversão em OS.
    //
    // A lista de colunas depende do nível: `custo_unitario` só existe na view
    // financeira. Pedir a coluna à view comercial faz o PostgREST devolver erro
    // e `atuais` vem vazio — o total voltaria a zero em silêncio.
    const { data: atuais, error } = await fromFinancialView("orcamento_itens", nivelDeVisao)
      .select(canSeeFinancials ? "valor_total, custo_unitario, quantidade" : "valor_total, quantidade")
      .eq("orcamento_id", id);
    if (error) {
      toast.error(mensagemErro(error, "Não foi possível recalcular o total"));
      return;
    }
    const lista = (atuais ?? []) as {
      valor_total: number | null;
      custo_unitario?: number | null;
      quantidade: number | null;
    }[];
    const subtotal = lista.reduce((s, i) => s + Number(i.valor_total ?? 0), 0);
    const custo = lista.reduce(
      (s, i) => s + Number(i.custo_unitario ?? 0) * Number(i.quantidade ?? 0),
      0,
    );
    // Quem só vê preço não enxerga custo nenhum: gravar custo_estimado aqui
    // seria escrever 0 por cima do custo que o financeiro já calculou. O
    // vendedor atualiza só os totais de venda; o custo fica como estava.
    const totais: any = { valor_subtotal: subtotal, valor_total: subtotal };
    if (canSeeFinancials) totais.custo_estimado = custo;
    const { error: erroTotais } = await supabase.from("orcamentos").update(totais).eq("id", id);
    if (erroTotais) toast.error(mensagemErro(erroTotais, "Não foi possível gravar o total"));
    await qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  // Dimensões do item em edição, para mostrar a área antes de gravar.
  const dimensoesForm = {
    largura: paraNumero(form.largura),
    altura: paraNumero(form.altura),
    quantidade: paraNumero(form.quantidade),
  };
  const precoM2Form = paraNumero(form.preco_m2);
  const vendidoPorArea = temDimensoes(dimensoesForm);
  // Com preço/m² informado, o valor unitário é derivado — o trigger no banco
  // aplica a mesma regra, então o campo fica só como leitura. Com área mínima
  // cadastrada, a peça pequena paga o mínimo (setup e refile não encolhem).
  const valorUnitarioDerivado =
    vendidoPorArea && precoM2Form > 0
      ? valorUnitarioComMinimo(dimensoesForm, precoM2Form, form.area_minima)
      : null;
  const areaFaturada = vendidoPorArea ? areaCobrada(dimensoesForm, form.area_minima) : 0;

  // O que o formulário pergunta depende da unidade: m² pede medida; os outros,
  // só quantidade. Medida já preenchida (tamanho fixo do produto) aparece sempre.
  const camposDoItem = camposDaUnidade(form.unidade);
  const mostrarMedidas = camposDoItem.medidas || vendidoPorArea || medidasAbertas;
  const produtoDoForm: ProdutoDaEscolha | null = form.produto_id
    ? (catalogo.produtos.find((p) => p.id === form.produto_id) ?? null)
    : null;
  const tipoDoItem: TipoDeProduto | null = tipoEscolhido
    ? tipoPelaChave(tipoEscolhido)
    : produtoDoForm
      ? tipoDoProduto(produtoDoForm)
      : tipoPeloRotulo(form.tipo_produto);
  // Tamanhos prontos: os do produto; sem eles, os comuns do tipo.
  const tamanhosParaOferecer =
    tamanhos.length > 0
      ? tamanhos.map((t) => ({ nome: t.nome, largura: Number(t.largura), altura: Number(t.altura) }))
      : (tipoDoItem?.tamanhosComuns ?? tipoPelaChave("outros").tamanhosComuns);

  // Faixa de preço por quantidade e o próximo degrau (argumento de venda).
  const quantidadeForm = paraNumero(form.quantidade) || 1;
  const faixaAtual = faixaAplicada(faixas, quantidadeForm);
  const faixaSeguinte = proximaFaixa(faixas, quantidadeForm);

  // Preço unitário efetivo do item em edição, para conferir a margem na hora.
  const valorUnitarioEfetivo =
    valorUnitarioDerivado !== null ? valorUnitarioDerivado : paraNumero(form.valor_unitario);
  const custoUnitarioForm = paraNumero(form.custo_unitario);
  const margemItem =
    valorUnitarioEfetivo > 0
      ? ((valorUnitarioEfetivo - custoUnitarioForm) / valorUnitarioEfetivo) * 100
      : null;
  const margemMinimaItem = form.margem_minima ?? null;
  const margemAbaixoDoMinimo =
    margemItem !== null && margemMinimaItem !== null && margemItem < margemMinimaItem;

  // Base que multiplica o consumo de material: m² cobrados quando vendido por
  // área, senão a quantidade de peças.
  const baseConsumo = vendidoPorArea ? areaFaturada : quantidadeForm;

  /**
   * Aplica o produto do catálogo ao formulário, já com preço, custo e limites.
   * O tipo (lona, adesivo…) vai junto, no texto curto de `tipo_produto` — é
   * o que sai na coluna "Tipo Produto" do PDF. Na edição,
   * trocar o produto preserva o que é do pedido — quantidade, acabamento e
   * especificação — e troca só o que é do produto.
   */
  function aplicarProduto(p: ProdutoDaEscolha) {
    const tipo = tipoDoProduto(p);
    setTipoEscolhido(tipo.chave);
    setItemLivre(false);
    setMedidasAbertas(false);
    setForm({
      ...itemVazio,
      descricao: p.nome,
      quantidade: form.quantidade || "1",
      acabamento: editando ? form.acabamento : "",
      especificacao: editando ? form.especificacao : "",
      tipo_produto: tipo.rotuloCurto,
      unidade: p.unidade,
      preco_m2: ehUnidadeDeArea(p.unidade) ? String(p.preco_base ?? "") : "",
      valor_unitario: String(p.preco_base ?? 0),
      custo_unitario: String(p.custo_medio ?? 0),
      produto_id: p.id,
      area_minima: p.area_minima_cobrada ?? null,
      margem_minima: Number(p.margem_minima ?? 0) || null,
      tempo_producao_min: p.tempo_producao_min ?? null,
    });
  }

  /** Item fora do catálogo, mas de um tipo: a descrição e o preço são digitados. */
  function aplicarItemLivre(tipo: TipoDeProduto) {
    setTipoEscolhido(tipo.chave);
    setItemLivre(true);
    setForm((atual) => ({
      ...atual,
      tipo_produto: tipo.rotuloCurto,
      // Trocou de produto do catálogo para item livre: o que era do produto sai.
      produto_id: null,
      area_minima: null,
      margem_minima: null,
      tempo_producao_min: null,
      // Item novo pega a unidade do tipo (lona → m², e a medida aparece);
      // item livre em edição fica com a unidade que já tinha.
      unidade: unidadeAoEscolherTipo(tipo, {
        unidade: atual.unidade,
        tinhaProduto: !!atual.produto_id,
        editando: !!editando,
      }),
      preco_m2: atual.produto_id ? "" : atual.preco_m2,
      valor_unitario: atual.produto_id ? "0" : atual.valor_unitario,
      custo_unitario: atual.produto_id ? "0" : atual.custo_unitario,
    }));
  }

  /** Usa o preço da faixa atingida no item em edição. */
  function aplicarFaixa(faixa: FaixaPreco) {
    setForm((atual) => ({
      ...atual,
      valor_unitario: String(faixa.preco_unitario),
      preco_m2:
        ehUnidadeDeArea(atual.unidade) && faixa.preco_m2_referencia
          ? String(faixa.preco_m2_referencia)
          : atual.preco_m2,
    }));
  }

  function limparFormulario() {
    for (const l of layoutsRascunho) if (l.previa) URL.revokeObjectURL(l.previa);
    setForm({ ...itemVazio });
    setLayoutsRascunho([]);
    setEditando(null);
    setTipoEscolhido(null);
    setItemLivre(false);
    setMedidasAbertas(false);
  }

  /**
   * Carrega um item gravado no formulário para corrigir. Antes só dava para
   * apagar e digitar de novo — e perder as artes junto.
   *
   * O preço/m² não é legível (fica fora das views), então volta como o preço
   * por m² EMBUTIDO no valor unitário: mexer na medida continua escalando o
   * preço como antes.
   */
  function editarItem(i: any, numero: number) {
    const dims = { largura: Number(i.largura ?? 0), altura: Number(i.altura ?? 0), quantidade: Number(i.quantidade ?? 1) };
    const porArea = temDimensoes(dims) && ehUnidadeDeArea(i.unidade);
    const precoM2 = porArea ? precoM2Implicito(dims, Number(i.valor_unitario ?? 0)) : null;
    for (const l of layoutsRascunho) if (l.previa) URL.revokeObjectURL(l.previa);
    setLayoutsRascunho([]);
    setForm({
      ...itemVazio,
      descricao: String(i.descricao ?? ""),
      quantidade: String(i.quantidade ?? 1),
      unidade: String(i.unidade ?? "un"),
      largura: i.largura != null ? String(i.largura) : "",
      altura: i.altura != null ? String(i.altura) : "",
      acabamento: String(i.acabamento ?? ""),
      tipo_produto: String(i.tipo_produto ?? ""),
      especificacao: String(i.especificacao ?? ""),
      preco_m2: precoM2 && precoM2 > 0 ? String(precoM2) : "",
      valor_unitario: String(i.valor_unitario ?? 0),
      custo_unitario: String(i.custo_unitario ?? 0),
      produto_id: (i.produto_id as string | null) ?? null,
      area_minima: i.area_minima != null ? Number(i.area_minima) : null,
    });
    // A escolha visual abre encolhida, com o produto e o tipo do item.
    setTipoEscolhido(tipoDoItemGravado(i, catalogo.produtos));
    setItemLivre(!i.produto_id);
    setMedidasAbertas(false);
    setEditando({ id: i.id as string, numero });
    formulario.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function salvarItem() {
    if (!form.descricao.trim()) return toast.error("Escreva a descrição do item.");
    if (vendidoPorArea && areaUnitaria(dimensoesForm) <= 0) {
      return toast.error("Largura e altura devem ser maiores que zero.");
    }
    const qtd = paraNumero(form.quantidade) || 1;
    // valor_total e (quando há preço/m²) valor_unitario são derivados pelo
    // trigger tg_orcamento_itens_precificar, no INSERT e no UPDATE.
    const campos: Record<string, unknown> = {
      descricao: form.descricao.trim(),
      quantidade: qtd,
      unidade: form.unidade,
      largura: vendidoPorArea ? dimensoesForm.largura : null,
      altura: vendidoPorArea ? dimensoesForm.altura : null,
      acabamento: form.acabamento.trim() || null,
      tipo_produto: form.tipo_produto.trim() || null,
      especificacao: form.especificacao.trim() || null,
      produto_id: form.produto_id,
      origem_calculo: form.origem_calculo,
    };
    if (canSeePrices) {
      campos.preco_m2 = precoM2Form > 0 ? precoM2Form : null;
      campos.valor_unitario = valorUnitarioEfetivo;
    }

    setSalvandoItem(true);
    try {
      if (editando) {
        // Na edição, custo só vai quando quem edita enxerga custo: o vendedor
        // gravaria 0 por cima do custo que o financeiro calculou.
        if (canSeeFinancials) {
          campos.custo_unitario = custoUnitarioForm;
          campos.custo_previsto = form.custo_previsto ?? 0;
          campos.margem_prevista = form.margem_prevista;
          campos.parametros = form.parametros ?? {};
        }
        const { data, error } = await (supabase as any)
          .from("orcamento_itens")
          .update(campos)
          .eq("id", editando.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar este item.");
        toast.success(`Item ${editando.numero} atualizado`);
      } else {
        const { data: novo, error } = await (supabase as any)
          .from("orcamento_itens")
          .insert({
            ...campos,
            orcamento_id: id,
            ordem: itens.length,
            valor_unitario: canSeePrices ? valorUnitarioEfetivo : 0,
            custo_unitario: custoUnitarioForm,
            arquivo_id: layoutsRascunho[0]?.arquivo_id ?? null,
            // `custo_previsto` e `parametros` são NOT NULL com padrão no banco,
            // e o formulário começa os dois em null (só o motor de custo os
            // preenche). Mandar null EXPLÍCITO anula o padrão e o insert morre.
            custo_previsto: form.custo_previsto ?? 0,
            margem_prevista: form.margem_prevista,
            parametros: form.parametros ?? {},
          })
          .select("id")
          .single();
        if (error) throw error;
        try {
          await vincularLayouts((novo as { id: string }).id, layoutsRascunho);
        } catch (e) {
          toast.error(mensagemErro(e, "O item entrou, mas as artes não foram ligadas a ele. Anexe de novo pela linha do item."));
        }
        toast.success("Item adicionado");
      }
      limparFormulario();
      await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
      await qc.invalidateQueries({ queryKey: ["orc-capas", id] });
      await recalcular();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvandoItem(false);
    }
  }

  async function removerItem(itemId: string) {
    const { data, error } = await supabase.from("orcamento_itens").delete().eq("id", itemId).select("id");
    if (error) return toast.error(mensagemErro(error));
    if (!data || data.length === 0) return toast.error("Seu perfil não pode tirar itens deste orçamento.");
    toast.success("Item tirado do orçamento");
    if (editando?.id === itemId) limparFormulario();
    await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
    await recalcular();
  }

  /** Muda a posição do item: é a numeração do PDF e da OS. */
  async function moverItem(indice: number, passo: -1 | 1) {
    const nova = reordenar(itens, indice, indice + passo);
    if (nova === itens) return;
    try {
      for (const [ordem, item] of nova.entries()) {
        if (Number(item.ordem) === ordem) continue;
        const { error } = await supabase
          .from("orcamento_itens")
          .update({ ordem } as never)
          .eq("id", item.id);
        if (error) throw error;
      }
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível mudar a ordem"));
    } finally {
      await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
    }
  }

  /** Copia o item: mesma descrição, preço e TODAS as artes, medida ajustável. */
  async function duplicarItem(item: any) {
    const copia: Record<string, unknown> = {
      orcamento_id: id,
      descricao: item.descricao,
      quantidade: item.quantidade,
      unidade: item.unidade,
      largura: item.largura,
      altura: item.altura,
      acabamento: item.acabamento,
      tipo_produto: item.tipo_produto ?? null,
      especificacao: item.especificacao ?? null,
      valor_unitario: canSeePrices ? item.valor_unitario : 0,
      ordem: itens.length,
      produto_id: item.produto_id,
      arquivo_id: item.arquivo_id,
    };
    // custo só existe na view financeira; sem ele, o banco usa o padrão
    if (item.custo_unitario != null) copia.custo_unitario = item.custo_unitario;
    const { data: novo, error } = await (supabase as any)
      .from("orcamento_itens")
      .insert(copia)
      .select("id")
      .single();
    if (error) return toast.error(mensagemErro(error));
    const { data: vinculos, error: erroVinculos } = await (supabase as any)
      .from("orcamento_item_arquivos")
      .select("arquivo_id, capa, ordem")
      .eq("item_id", item.id)
      .order("capa", { ascending: false })
      .order("ordem");
    if (!erroVinculos && vinculos?.length) {
      try {
        await vincularLayouts(novo.id, vinculos as { arquivo_id: string }[]);
      } catch (e) {
        toast.error(mensagemErro(e, "O item foi copiado sem as artes"));
      }
    }
    toast.success("Item duplicado");
    await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
    await qc.invalidateQueries({ queryKey: ["orc-capas", id] });
    await recalcular();
  }

  /** Link de aprovação do cliente: mesma URL sempre, gerada uma única vez. */
  async function obterLinkCliente() {
    const { token } = await gerarLinkPublicoOrcamento({ data: { orcamentoId: id } });
    return `${window.location.origin}/orcamento-publico/${token}`;
  }

  async function copiarLinkCliente() {
    setGerandoLink(true);
    try {
      const url = await obterLinkCliente();
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado. É só colar para o cliente.");
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível gerar o link"));
    } finally {
      setGerandoLink(false);
    }
  }

  async function enviarWhatsApp() {
    // A janela abre NO CLIQUE: aberta depois de um await, o Safari trata como
    // pop-up e bloqueia sem avisar. Depois o endereço é trocado pelo do WhatsApp.
    const janela = window.open("", "_blank");
    if (janela) janela.opener = null;
    setGerandoLink(true);
    try {
      const url = await obterLinkCliente();
      const telefone = String(
        (orc as any)?.cliente_whatsapp ??
          (orc as any)?.cliente_telefone ??
          (orc as any)?.contato_telefone ??
          "",
      ).replace(/\D/g, "");
      const destino = telefone ? (telefone.length > 11 ? telefone : `55${telefone}`) : "";
      const texto = `Olá! Segue o orçamento nº ${(orc as any).numero} — ${(orc as any).titulo}.\nVocê pode conferir e aprovar por aqui: ${url}`;
      const endereco = `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
      if (janela) janela.location.href = endereco;
      else window.location.href = endereco;
    } catch (e) {
      janela?.close();
      toast.error(mensagemErro(e, "Não foi possível abrir o WhatsApp"));
    } finally {
      setGerandoLink(false);
    }
  }

  async function setStatus(novoStatus: string) {
    const update: any = { status: novoStatus };
    if (novoStatus === "enviado") update.enviado_em = new Date().toISOString();
    if (novoStatus === "aprovado") update.aprovado_em = new Date().toISOString();
    const { data, error } = await supabase
      .from("orcamentos")
      .update(update)
      .eq("id", id)
      .select("id");
    if (error) return toast.error(mensagemErro(error));
    // Escrita barrada pela RLS devolve 0 linhas e NENHUM erro. Sem esta
    // conferência a tela dizia "Status atualizado" sem ter gravado nada — é o
    // que acontece com o perfil financeiro, que lê o orçamento e não pode
    // alterá-lo (a policy de update exige `orcamentos.create`).
    if (!data || data.length === 0) {
      return toast.error("Seu perfil não pode alterar o status deste orçamento.");
    }
    toast.success("Status atualizado");
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  async function converterEmOS() {
    const { data, error } = await (supabase.rpc as any)("converter_orcamento_em_os", {
      p_orcamento_id: id,
      p_opcoes: {},
    });
    if (error) return toast.error(mensagemErro(error));
    const osId = typeof data === "object" && data && "os_id" in data ? String((data as any).os_id) : "";
    toast.success(`OS criada${osId ? ` (${osId})` : ""}`);
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (!orc) return <div className="p-6">Orçamento não encontrado</div>;

  const margem =
    canSeeFinancials && Number(orc.valor_total) > 0
      ? ((Number(orc.valor_total) - Number(orc.custo_estimado)) / Number(orc.valor_total)) * 100
      : null;
  const fechado = orc.status === "convertido" || !!orc.os_id;
  const podeMexer = podeEditar && !fechado;
  const dadosDoAcordo = acordo.data ?? null;
  const pendencias = pendenciasParaEnviar({
    temClienteOuContato: !!(orc.cliente_nome || (orc as any).contato_nome),
    dataEntrega: dadosDoAcordo ? (dadosDoAcordo.data_entrega_prometida ?? dadosDoAcordo.prazo) : "?",
    verPreco: canSeePrices,
    temCondicao: dadosDoAcordo ? !!dadosDoAcordo.condicao_pagamento : true,
    itens: itens as { arquivo_id: string | null }[],
    descontoPendente,
  });
  const subtotalGravado = Number(orc.valor_subtotal ?? 0);
  const descontoGravado = Math.max(
    0,
    Math.round((subtotalGravado - Number(orc.valor_total ?? 0)) * 100) / 100,
  );
  const semArte = (itens as any[]).filter((i) => !i.arquivo_id).length;
  const somaArea = somaAreaTotal(itens);

  return (
    <div className="space-y-6">
      <header className="sticky top-0 z-20 -mx-2 px-2 pt-2 space-y-3 border-b border-border pb-4 mb-2 bg-background/95 backdrop-blur">
        {/* Linha 1 — identificação */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <Button asChild variant="ghost" size="icon" className="mt-1 shrink-0" title="Voltar para orçamentos">
              <Link to="/orcamentos">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <span>Orçamento #{orc.numero}</span>
                <StatusChip label={ROTULO_DO_STATUS[orc.status] ?? orc.status} tone={statusTone[orc.status] ?? "muted"} />
              </div>
              <div className="mt-1 flex items-center gap-2 min-w-0">
                <h1 className="truncate text-xl font-bold tracking-tight text-foreground">{orc.titulo}</h1>
                <DicaIcone texto={dicaTela("/orcamentos")} rotulo="Orçamento" lado="bottom" className="h-5 w-5" />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {orc.cliente_nome ? (
                  <>Cliente: <span className="text-foreground font-medium">{orc.cliente_nome}</span></>
                ) : (
                  "Sem cliente vinculado"
                )}
              </p>
              <div className="mt-2">
                <QuemTrouxeAVenda alvo="orcamento" id={id} vendedorId={(orc as any).vendedor_id ?? null} invalidar={[["orcamento", id]]} compacto />
              </div>
            </div>
          </div>

          {/* Converter exige `orcamentos.convert`, que só admin e gestor têm.
              Sem a permissão, no lugar do botão fica a explicação de quem
              converte e por onde essa pessoa é avisada. */}
          {!fechado && (
            podeConverter ? (
              // Desconto que passou da alçada sem aprovação: o banco recusa a
              // conversão (converter_orcamento_em_os), então o botão já trava
              // aqui com o motivo.
              <Dica texto={descontoPendente ? dicaCampo("/orcamentos", "desconto_pendente") : null}>
                <Button
                  onClick={converterEmOS}
                  disabled={descontoPendente}
                  className="shrink-0 h-11 md:h-10"
                >
                  {descontoPendente ? <Lock className="h-4 w-4 mr-1" /> : null}
                  Converter em OS <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Dica>
            ) : (
              <div className="shrink-0 max-w-xs rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <Lock className="h-3.5 w-3.5" /> Converter em OS é do gerente ou do admin
                </p>
                <p className="mt-1">
                  {orc.status === "aprovado" ? (
                    <>
                      Este orçamento já está aprovado, então já aparece na lista de pendências
                      deles no{" "}
                      <Link to="/dashboard" className="underline underline-offset-2">
                        painel
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      Marque o status como <strong>aprovado</strong> assim que o cliente fechar: é
                      isso que coloca o orçamento na lista de pendências deles no{" "}
                      <Link to="/dashboard" className="underline underline-offset-2">
                        painel
                      </Link>
                      .
                    </>
                  )}
                </p>
              </div>
            )
          )}
        </div>

        {/* Linha 2 — ações secundárias */}
        <div className="flex items-center gap-2 flex-wrap md:pl-12">
          <Select value={orc.status} onValueChange={setStatus} disabled={fechado}>
            <SelectTrigger className="w-48 h-9" aria-label="Status do orçamento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["rascunho", "enviado", "aprovado", "rejeitado", "expirado"].map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_DO_STATUS[s]}
                </SelectItem>
              ))}
              {orc.status === "convertido" && (
                <SelectItem value="convertido" disabled>
                  {ROTULO_DO_STATUS.convertido}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <div className="h-6 w-px bg-border mx-1 hidden sm:block" />
          <Dica texto={dicaAcao("/orcamentos", "pdf")}><Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <FileDown className="h-4 w-4 mr-1" /> PDF
          </Button></Dica>
          <Dica texto={dicaAcao("/orcamentos", "producao")}><Button variant="outline" size="sm" onClick={() => setPreviewProducaoOpen(true)}>
            <Printer className="h-4 w-4 mr-1" /> Via de produção
          </Button></Dica>
          {podeMandar && (
            <>
              <Dica texto={dicaAcao("/orcamentos", "link")}><Button variant="outline" size="sm" onClick={copiarLinkCliente} disabled={gerandoLink}>
                {gerandoLink ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <LinkIcon className="h-4 w-4 mr-1" />
                )}
                Link do cliente
              </Button></Dica>
              <Dica texto={dicaAcao("/orcamentos", "whatsapp")}><Button variant="outline" size="sm" onClick={enviarWhatsApp} disabled={gerandoLink}>
                <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
              </Button></Dica>
            </>
          )}
        </div>
        {!fechado && pendencias.length > 0 && (
          <p className="md:pl-12 text-xs text-amber-500">
            Antes de enviar ao cliente, falta:{" "}
            {pendencias.map((p, n) => {
              const alvo = ONDE_RESOLVER[p] ?? (p.startsWith("layout") ? "itens-do-orcamento" : null);
              return (
                <span key={p}>
                  {n > 0 && ", "}
                  {alvo ? (
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-amber-400"
                      onClick={() => document.getElementById(alvo)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      {p}
                    </button>
                  ) : (
                    p
                  )}
                </span>
              );
            })}
            .
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card id="itens-do-orcamento" className="scroll-mt-48">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                <span>{editando ? `Editando o item ${editando.numero}` : "Itens do orçamento"}</span>
                {editando && (
                  <Button variant="ghost" size="sm" onClick={limparFormulario}>
                    <X className="mr-1 h-4 w-4" /> Cancelar edição
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {podeMexer ? (
                <div ref={formulario} className="scroll-mt-48 space-y-4 rounded-lg border border-dashed p-3 sm:p-4">
                  {/* Passo 1 — o tipo e o produto, em cartões. Escolher do
                      catálogo traz medida, preço, custo e material certos; o
                      item fora do catálogo continua liberado. Na edição abre
                      encolhido, com o produto do item, e "Trocar" reabre. */}
                  <EscolhaDeProduto
                    produtos={catalogo.produtos}
                    carregando={catalogo.carregando}
                    erro={catalogo.erro}
                    onTentarDeNovo={catalogo.tentarDeNovo}
                    verPreco={canSeePrices}
                    produtoId={form.produto_id}
                    itemLivre={itemLivre}
                    tipo={tipoEscolhido}
                    descricaoAtual={form.descricao}
                    onEscolherProduto={aplicarProduto}
                    onItemLivre={aplicarItemLivre}
                    desabilitado={salvandoItem}
                    atalhos={[
                      {
                        titulo: "Neste orçamento",
                        icone: "Repeat",
                        ids: [
                          ...new Set(
                            (itens as any[]).map((i) => i.produto_id).filter(Boolean) as string[],
                          ),
                        ],
                      },
                      { titulo: "Este cliente já comprou", icone: "History", ids: catalogo.doCliente },
                      { titulo: "Mais vendidos", icone: "Star", ids: catalogo.maisUsados },
                    ]}
                  />

                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-12 md:col-span-8">
                      <Label htmlFor="item-descricao">Descrição</Label>
                      <Input
                        id="item-descricao"
                        placeholder="Ex.: Adesivo vinil fosco"
                        value={form.descricao}
                        onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-4">
                      <Label htmlFor="item-tipo" className="flex items-center gap-1">
                        Tipo de produto
                        <DicaIcone texto={dicaCampo("/orcamentos", "tipo_de_produto")} rotulo="Tipo de produto" className="h-5 w-5" />
                      </Label>
                      <Input
                        id="item-tipo"
                        placeholder="Adesivo, lona, placa…"
                        value={form.tipo_produto}
                        onChange={(e) => setForm({ ...form, tipo_produto: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Passo 2 — a medida, desenhada, para o que vende por m²
                      (ou já tem medida). Preencher as duas liga a venda por m². */}
                  {mostrarMedidas ? (
                    <MedidasDaPeca
                      largura={form.largura}
                      altura={form.altura}
                      quantidade={paraNumero(form.quantidade)}
                      areaMinima={form.area_minima}
                      tamanhos={tamanhosParaOferecer}
                      origemDosTamanhos={tamanhos.length > 0 ? "produto" : "tipo"}
                      onMudar={(campo, valor) => setForm({ ...form, [campo]: valor })}
                      onAplicarTamanho={(t) =>
                        setForm((atual) => ({ ...atual, largura: String(t.largura), altura: String(t.altura) }))
                      }
                      desabilitado={salvandoItem}
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => setMedidasAbertas(true)}
                    >
                      Este item tem medida? Informar largura × altura
                    </button>
                  )}

                  <div className="grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-8 md:col-span-4">
                      <QuantidadeDoItem
                        valor={form.quantidade}
                        campos={camposDoItem}
                        onMudar={(valor) => setForm({ ...form, quantidade: valor })}
                        desabilitado={salvandoItem}
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <Label htmlFor="item-unidade">Unidade</Label>
                      <Input
                        id="item-unidade"
                        className="h-11 sm:h-9"
                        value={form.unidade}
                        onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-6">
                      <AcabamentoDoItem
                        valor={form.acabamento}
                        opcoes={tipoDoItem?.acabamentos ?? []}
                        onMudar={(valor) => setForm({ ...form, acabamento: valor })}
                        desabilitado={salvandoItem}
                      />
                    </div>
                    <div className="col-span-12">
                      <Label htmlFor="item-especificacao" className="flex flex-wrap items-center gap-1">
                        Especificações para a produção
                        <span className="text-muted-foreground">(opcional — sai no PDF embaixo da descrição)</span>
                        <DicaIcone texto={dicaCampo("/orcamentos", "especificacao")} rotulo="Especificações" className="h-5 w-5" />
                      </Label>
                      <Textarea
                        id="item-especificacao"
                        rows={2}
                        placeholder="Material, cores, frente e verso, ilhós a cada 50 cm, bastão em cima…"
                        value={form.especificacao}
                        onChange={(e) => setForm({ ...form, especificacao: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Conferência de material e estoque, só aviso. */}
                  {form.produto_id && <RestricaoDoProduto restricao={restricao} />}

                  {/* Some sozinho para produto que não sai de bobina. */}
                  {form.produto_id && (
                    <AproveitamentoDeBobina
                      contexto={bobina.data}
                      erro={bobina.error}
                      largura={dimensoesForm.largura || restricao?.largura || 0}
                      altura={dimensoesForm.altura || restricao?.altura || 0}
                      quantidade={paraNumero(form.quantidade)}
                    />
                  )}

                  <OrcamentoMaterialCheck produtoId={form.produto_id} baseDeConsumo={baseConsumo} />

                  {/* Preço de venda: o vendedor digita. Custo fica atrás de canSeeFinancials. */}
                  {(canSeePrices || canSeeFinancials) && (
                    <div className="grid grid-cols-12 gap-2 items-end">
                      {canSeePrices && (
                        <>
                          <div className="col-span-6 md:col-span-3">
                            <Label htmlFor="item-preco-m2">Preço/m²</Label>
                            <Input
                              id="item-preco-m2"
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              disabled={!vendidoPorArea}
                              title={vendidoPorArea ? undefined : "Informe largura e altura para vender por m²"}
                              value={form.preco_m2}
                              onChange={(e) => setForm({ ...form, preco_m2: e.target.value })}
                            />
                          </div>
                          <div className="col-span-6 md:col-span-3">
                            <Label htmlFor="item-valor-un">Valor un.</Label>
                            <Input
                              id="item-valor-un"
                              type="number"
                              step="0.01"
                              inputMode="decimal"
                              readOnly={valorUnitarioDerivado !== null}
                              title={
                                valorUnitarioDerivado !== null
                                  ? "Calculado a partir da área e do preço/m²"
                                  : undefined
                              }
                              className={valorUnitarioDerivado !== null ? "bg-muted/40" : undefined}
                              value={
                                valorUnitarioDerivado !== null
                                  ? valorUnitarioDerivado.toFixed(2)
                                  : form.valor_unitario
                              }
                              onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })}
                            />
                          </div>
                        </>
                      )}
                      {canSeeFinancials && (
                        <div className="col-span-6 md:col-span-3">
                          <div className="flex items-center justify-between gap-1">
                            <Label htmlFor="item-custo-un">Custo un.</Label>
                            {/* Material, máquina e mão de obra viram custo com a conta à vista. */}
                            <button
                              type="button"
                              className="text-[11px] text-primary hover:underline"
                              onClick={() => setCalculadoraAberta(true)}
                            >
                              calcular
                            </button>
                          </div>
                          <Input
                            id="item-custo-un"
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            value={form.custo_unitario}
                            onChange={(e) =>
                              // Digitou à mão: o custo deixa de ser "calculado".
                              setForm({ ...form, custo_unitario: e.target.value, origem_calculo: "manual" })
                            }
                          />
                        </div>
                      )}
                      {canSeePrices && (
                        <div className="col-span-6 md:col-span-3">
                          <Label>Total do item</Label>
                          <div className="h-10 flex items-center px-3 rounded-md border bg-muted/40 text-sm font-medium tabular-nums">
                            {brl(valorUnitarioEfetivo * quantidadeForm)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Preço por quantidade: mostra o degrau atingido e o próximo. */}
                  {canSeePrices && faixas.length > 0 && (
                    <div className="flex items-center gap-3 flex-wrap text-xs">
                      {faixaAtual ? (
                        <>
                          <span className="text-muted-foreground">
                            Faixa aplicada: <strong className="text-foreground">{descreverFaixa(faixaAtual, form.unidade)}</strong>
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs font-normal"
                            onClick={() => aplicarFaixa(faixaAtual)}
                          >
                            Usar este preço
                          </Button>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Quantidade abaixo da primeira faixa de preço.
                        </span>
                      )}
                      {faixaSeguinte && (
                        <span className="text-accent">
                          {descreverFaixa(faixaSeguinte, form.unidade)} — vale sugerir ao cliente.
                        </span>
                      )}
                    </div>
                  )}

                  {/* Margem do item comparada à mínima do produto. */}
                  {canSeeFinancials && margemItem !== null && (
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="text-muted-foreground">Margem do item:</span>
                      <strong
                        className={
                          margemAbaixoDoMinimo
                            ? "text-destructive"
                            : margemMinimaItem !== null && margemItem < margemMinimaItem + 5
                              ? "text-amber-500"
                              : "text-accent"
                        }
                      >
                        {margemItem.toFixed(1)}%
                      </strong>
                      {margemMinimaItem !== null && (
                        <span className="text-muted-foreground">
                          (mínima do produto: {margemMinimaItem.toFixed(1)}%)
                        </span>
                      )}
                      {margemAbaixoDoMinimo && (
                        <span className="flex items-center gap-1 text-destructive">
                          <TrendingDown className="h-3 w-3" /> abaixo do mínimo
                        </span>
                      )}
                      {form.origem_calculo === "motor" && form.margem_prevista != null && (
                        <span className="text-muted-foreground">· custo calculado</span>
                      )}
                      {form.tempo_producao_min && (
                        <span className="text-muted-foreground">
                          · produção estimada: {Math.round((form.tempo_producao_min * quantidadeForm) / 60 * 10) / 10}h
                        </span>
                      )}
                    </div>
                  )}

                  {/* A calculadora é diálogo: não ocupa espaço até ser aberta. */}
                  {canSeeFinancials && (
                    <CalculadoraCusto
                      open={calculadoraAberta}
                      onOpenChange={setCalculadoraAberta}
                      produtoId={form.produto_id}
                      quantidade={paraNumero(form.quantidade) || 1}
                      // A ficha técnica dá consumo por unidade de venda: em produto
                      // medido em m², a base é a metragem cobrada, não o nº de peças.
                      baseConsumo={baseConsumo}
                      unidadeBase={vendidoPorArea ? "m²" : form.unidade || "un"}
                      onAplicar={({ resultado, parametros }) => {
                        const qtd = paraNumero(form.quantidade) || 1;
                        setForm((atual) => ({
                          ...atual,
                          custo_unitario: (resultado.custoTotal / qtd).toFixed(2),
                          custo_previsto: resultado.custoTotal,
                          margem_prevista: resultado.margemPct,
                          parametros: parametros as unknown as Record<string, unknown>,
                          origem_calculo: "motor",
                          // Só sugere preço em campo ainda no zero: sobrescrever preço
                          // já negociado com o cliente é pior que não sugerir nada.
                          valor_unitario:
                            paraNumero(atual.valor_unitario) > 0
                              ? atual.valor_unitario
                              : resultado.precoUnitario.toFixed(2),
                        }));
                        toast.success(
                          `Custo calculado: ${brl(resultado.custoTotal)} · margem ${(resultado.margemPct * 100).toFixed(1)}%`,
                        );
                      }}
                    />
                  )}

                  <div className="space-y-2">
                    <Label>Layouts (artes a imprimir)</Label>
                    {editando ? (
                      <LayoutsDoItem
                        itemId={editando.id}
                        orcamentoId={id}
                        clienteId={(orc as any)?.cliente_id ?? null}
                        podeEditar={podeMexer}
                      />
                    ) : (
                      <LayoutsDoRascunho
                        orcamentoId={id}
                        clienteId={(orc as any)?.cliente_id ?? null}
                        layouts={layoutsRascunho}
                        setLayouts={setLayoutsRascunho}
                        desabilitado={salvandoItem}
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      A primeira arte é a capa: sai no bloco LAYOUT do PDF com o número do item. As
                      outras vão juntas para a produção.
                    </p>
                  </div>

                  {/* A conferência em uma frase, antes de gravar. */}
                  <ResumoDoItem
                    descricao={form.descricao}
                    quantidade={quantidadeForm}
                    unidade={form.unidade}
                    largura={vendidoPorArea ? dimensoesForm.largura : null}
                    altura={vendidoPorArea ? dimensoesForm.altura : null}
                    areaMinima={form.area_minima}
                    valorTotal={canSeePrices ? valorUnitarioEfetivo * quantidadeForm : null}
                  />

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {editando && (
                      <Button variant="outline" onClick={limparFormulario} disabled={salvandoItem}>
                        Cancelar
                      </Button>
                    )}
                    <Button onClick={() => void salvarItem()} disabled={salvandoItem}>
                      {salvandoItem ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : editando ? (
                        <Save className="h-4 w-4 mr-1" />
                      ) : (
                        <Plus className="h-4 w-4 mr-1" />
                      )}
                      {editando ? "Salvar alterações" : "Adicionar item"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {fechado
                    ? "Este orçamento já virou OS: os itens ficam como foram vendidos."
                    : "Seu perfil vê o orçamento, mas não altera os itens."}
                </p>
              )}

              {consultaItens.isError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="space-y-2">
                    <p>Não foi possível carregar os itens: {mensagemErro(consultaItens.error)}</p>
                    <p className="text-xs text-muted-foreground">
                      Isto é falha de consulta, não orçamento vazio — não adicione os itens de novo.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => void consultaItens.refetch()}>
                      Tentar de novo
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Qtd</TableHead>
                        <TableHead>Metragem</TableHead>
                        <TableHead>Acabamento</TableHead>
                        <TableHead>Layout</TableHead>
                        {canSeePrices && (
                          <>
                            <TableHead className="text-right">Valor un.</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </>
                        )}
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consultaItens.isPending && (
                        <TableRow>
                          <TableCell colSpan={canSeePrices ? 9 : 7} className="text-center text-muted-foreground">
                            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando os itens…
                          </TableCell>
                        </TableRow>
                      )}
                      {!consultaItens.isPending && itens.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={canSeePrices ? 9 : 7} className="text-center text-muted-foreground">
                            Nenhum item ainda — busque um produto do catálogo acima para começar.
                          </TableCell>
                        </TableRow>
                      )}
                      {itens.map((i: any, indice: number) => {
                        const numero = indice + 1;
                        const emEdicao = editando?.id === i.id;
                        return (
                          <TableRow key={i.id} className={cn(emEdicao && "bg-primary/5")}>
                            <TableCell>
                              <span className="grid h-6 w-6 place-items-center rounded-full border text-xs font-medium">
                                {numero}
                              </span>
                            </TableCell>
                            <TableCell className="min-w-[180px]">
                              <p className="font-medium">{i.descricao}</p>
                              {i.tipo_produto && (
                                <p className="text-xs text-muted-foreground">{i.tipo_produto}</p>
                              )}
                              {i.especificacao && (
                                <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                                  {i.especificacao}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {Number(i.quantidade).toLocaleString("pt-BR")} {i.unidade}
                            </TableCell>
                            <TableCell className="text-xs">
                              {descreverMetragem(i) ?? <span className="text-muted-foreground">—</span>}
                              {/* Mínimo aplicado precisa aparecer: o vendedor tem de saber
                                  por que a conta deu mais que a área da peça. */}
                              {Number(i.area_cobrada ?? 0) > Number(i.area_total ?? 0) && (
                                <span className="block text-amber-600">
                                  cobrado {m2(Number(i.area_cobrada))} (mínimo)
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {i.acabamento || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <MiniaturaDoItem
                                capa={capas.data?.[i.id]}
                                onAbrir={() => setArtesDe({ id: i.id, descricao: i.descricao, numero })}
                              />
                            </TableCell>
                            {canSeePrices && (
                              <>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">
                                  {brl(i.valor_unitario)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                                  {brl(i.valor_total)}
                                </TableCell>
                              </>
                            )}
                            <TableCell className="whitespace-nowrap text-right">
                              {podeMexer && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Subir na lista"
                                    aria-label={`Subir o item ${numero}`}
                                    disabled={indice === 0}
                                    onClick={() => void moverItem(indice, -1)}
                                  >
                                    <ArrowUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Descer na lista"
                                    aria-label={`Descer o item ${numero}`}
                                    disabled={indice === itens.length - 1}
                                    onClick={() => void moverItem(indice, 1)}
                                  >
                                    <ArrowDown className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Editar item"
                                    aria-label={`Editar o item ${numero}`}
                                    onClick={() => editarItem(i, numero)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Duplicar item"
                                    aria-label={`Duplicar o item ${numero}`}
                                    onClick={() => void duplicarItem(i)}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Tirar o item"
                                    aria-label={`Tirar o item ${numero}`}
                                    onClick={() => setARemover({ id: i.id, descricao: i.descricao, numero })}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Itens:</span> <strong>{itens.length}</strong>
                </div>
                {semArte > 0 && (
                  <div className="text-amber-500">
                    {semArte === 1 ? "1 item sem arte" : `${semArte} itens sem arte`}
                  </div>
                )}
                {somaArea > 0 && (
                  <div>
                    <span className="text-muted-foreground">Soma área:</span> <strong>{m2(somaArea)}</strong>
                  </div>
                )}
                {/* Total é preço: o vendedor vê. Custo e margem seguem só para o financeiro.
                    Com desconto (ou crédito de parceiro), mostra de onde o total saiu —
                    é a mesma conta do PDF: Total Produtos − Valor Desconto. */}
                {canSeePrices && descontoGravado > 0 && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Itens:</span>{" "}
                      <span className="tabular-nums">{brl(subtotalGravado)}</span>
                    </div>
                    <div>
                      <button
                        type="button"
                        className="text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() =>
                          document
                            .getElementById("acordo-desconto")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" })
                        }
                      >
                        Desconto:
                      </button>{" "}
                      <span className="tabular-nums">− {brl(descontoGravado)}</span>
                    </div>
                  </>
                )}
                {canSeePrices && (
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <strong className="tabular-nums">{brl(orc.valor_total)}</strong>
                  </div>
                )}
                {canSeeFinancials && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Custo:</span>{" "}
                      <span className="tabular-nums">{brl(orc.custo_estimado)}</span>
                    </div>
                    {margem !== null && (
                      <div>
                        <span className="text-muted-foreground">Margem:</span>{" "}
                        <strong className={margem < 20 ? "text-destructive" : "text-accent"}>
                          {margem.toFixed(1)}%
                        </strong>
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <PDFHistoryCard tipo="orcamento" referencia_id={id} />
        </div>

        {/* O combinado com o cliente fica ao lado dos itens, compacto — antes
            eram dois cartões largos que empurravam os itens para baixo. */}
        <aside className="min-w-0 space-y-4">
          {acordo.isError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-2">
                <p>Não foi possível carregar prazos e pagamento: {mensagemErro(acordo.error)}</p>
                <Button size="sm" variant="outline" onClick={() => void acordo.refetch()}>
                  Tentar de novo
                </Button>
              </div>
            </div>
          ) : dadosDoAcordo ? (
            <>
              <EntregaEPrazos acordo={dadosDoAcordo} podeEditar={podeMexer} />
              {/* Desconto e parcelamento são preço: quem não vê preço não vê
                  estes blocos (mostrariam "1× de R$ 0,00", que é mentira). O
                  desconto vem antes porque é ele que muda o total das parcelas. */}
              {canSeePrices && (
                <DescontoDoOrcamento
                  orcamentoId={id}
                  podeEditar={podeMexer}
                  verCusto={canSeeFinancials}
                  onPrevia={setTotalPrevisto}
                />
              )}
              {canSeePrices && (
                <Pagamento
                  orcamentoId={id}
                  total={totalPrevisto ?? Number(orc.valor_total ?? 0)}
                  previa={totalPrevisto != null}
                  condicao={dadosDoAcordo.condicao_pagamento}
                  podeEditar={podeMexer}
                />
              )}
              <Observacoes acordo={dadosDoAcordo} podeEditar={podeMexer} />
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando prazos e pagamento…
            </p>
          )}
        </aside>
      </div>

      <DialogoDeLayouts
        item={artesDe}
        orcamentoId={id}
        clienteId={(orc as any)?.cliente_id ?? null}
        podeEditar={podeMexer}
        onFechar={() => setArtesDe(null)}
      />

      <AlertDialog open={aRemover !== null} onOpenChange={(aberto) => !aberto && setARemover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Tirar o item {aRemover?.numero} · {aRemover?.descricao}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O item sai do orçamento e o total é recalculado. As artes que estavam nele continuam
              guardadas no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (aRemover) void removerItem(aRemover.id);
                setARemover(null);
              }}
            >
              Tirar o item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PDFPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        tipo="orcamento"
        referencia_id={id}
      />

      <PDFPreviewDialog
        open={previewProducaoOpen}
        onOpenChange={setPreviewProducaoOpen}
        tipo="orcamento"
        referencia_id={id}
        mostrarValores={false}
      />
    </div>
  );
}
