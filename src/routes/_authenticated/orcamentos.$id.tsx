import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { DetalhesOpcionais } from "@/components/orcamento/detalhes-opcionais";
import { UnidadeDoItem } from "@/components/orcamento/unidade-do-item";
import { QuantidadeDoItem } from "@/components/orcamento/quantidade-do-item";
import { AcabamentoDoItem } from "@/components/orcamento/acabamento-do-item";
import { EscolhaDeMaterial } from "@/components/orcamento/escolha-de-material";
import {
  CobrancaDoAcabamento,
  inserirLinhaDeAcabamento,
  useAcabamentosDoProduto,
  type CobrancaPronta,
} from "@/components/orcamento/cobranca-do-acabamento";
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
import { PrecoDoOrcamento } from "@/components/orcamento/preco-do-orcamento";
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
  custoDaPecaPorArea,
  custoM2Implicito,
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
import { brl, dataBR, m2, pendenciasParaEnviar } from "@/domain/orcamentos/acordo";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";

import { Dica, DicaIcone } from "@/components/bex/Dica";
import { dicaAcao, dicaCampo, dicaTela } from "@/lib/dicas";
import { percentual } from "@/lib/percentual";
import { BarraDePassosDoOrcamento } from "@/components/parceiro/barra-de-passos";
import {
  PASSOS_DA_EQUIPE,
  ehUltimo,
  estadoDosPassosDaEquipe,
  passoAnterior,
  passoDaPendencia,
  passoInicialDaEquipe,
  passoSeguinte,
  rotuloDoAvancar,
} from "@/domain/orcamentos/passos-da-equipe";
import type { PassoDoOrcamento } from "@/domain/parceiros/passos-do-orcamento";
import { PrazoDeProducao } from "@/components/orcamento/prazo-de-producao";
import { TabelaDeDegraus } from "@/components/parceiro/tabela-de-degraus";
import { degrausDeFaixasDeBalcao } from "@/domain/parceiros/degraus";
import { PRAZO_NORMAL, prazoEscolhido, rotuloDaPorcentagem } from "@/domain/parceiros/prazo";
import { CHAVE_PRAZOS, carregarPrazos } from "@/lib/parceiro-api";
import { Carregando } from "@/components/bex/Carregando";

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
  // Item com medida: o custo é digitado por m², como o preço, e o da peça sai
  // da área cobrada. Vazio = o custo da peça vale como está (custo_unitario).
  custo_m2: "",
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
  const navigate = useNavigate();
  // canSeePrices/nivelDeVisao: preço de venda (vendedor vê). canSeeFinancials:
  // custo e margem (só financeiro/gestão). Nunca misturar os dois gates.
  const { canSeeFinancials, canSeePrices, nivelDeVisao, hasPermission } = useAuth();
  // Converter em OS é `orcamentos.convert`: admin, gestor e o atendimento (vendedor, desde
  // 25/10/2026: quem fecha com o cliente também solta a OS para a produção). Editar o
  // orçamento é `orcamentos.update`.
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
  // Os detalhes opcionais do item (tipo, especificações, artes): fechados até a
  // pessoa abrir, e abertos sozinhos quando já há conteúdo ou o item está em edição.
  // Uma vez aberta a seção, não fecha sozinha — ela sumiria debaixo do cursor.
  const [detalhesManual, setDetalhesManual] = useState<boolean | null>(null);
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
  // Os quatro passos do orçamento (os mesmos do parceiro). Nulo até a pessoa
  // escolher: aí vale o passo inicial, calculado UMA vez quando a tela carrega.
  const [passoEscolhido, setPassoEscolhido] = useState<PassoDoOrcamento | null>(null);
  const passoInicialRef = useRef<PassoDoOrcamento | null>(null);
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

  // Cliente revendedor: o seletor de preço avisa quando o orçamento ainda está
  // no preço de tabela.
  const { data: clienteRevendedor = false } = useQuery({
    queryKey: ["cliente-revendedor", (orc as any)?.cliente_id ?? null],
    enabled: !!(orc as any)?.cliente_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clientes")
        .select("revendedor")
        .eq("id", (orc as any).cliente_id)
        .maybeSingle();
      return data?.revendedor === true;
    },
  });

  // Tabela de parceiro do cliente deste orçamento (23/10/2026): preço do produto,
  // nível e faixas. Só existe quando o cliente tem cadastro de parceiro ativo —
  // e então o orçamento já nasce no modo parceiro, sem senha.
  const { data: tabelaDoParceiro } = useQuery({
    queryKey: ["orcamento", id, "precos-parceiro", (orc as any)?.cliente_id ?? null],
    enabled: !!(orc as any)?.cliente_id && canSeePrices,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("orcamento_precos_parceiro", { p_orcamento: id });
      if (error) throw error;
      const linhas = (data ?? []) as Array<{
        produto_id: string;
        preco_referencia: number | null;
        preco_parceiro: number | null;
        faixas: Array<{ quantidade_minima: number; preco_parceiro: number }> | null;
        nivel_nome: string | null;
        desconto_pct: number | null;
      }>;
      return {
        porProduto: new Map(linhas.map((l) => [l.produto_id, l])),
        nivel: linhas[0]?.nivel_nome ?? null,
        descontoPct: linhas[0]?.desconto_pct ?? null,
      };
    },
  });

  // O que o cliente recebeu e aprovou (22/10/2026): a versão congelada pelo
  // banco ao enviar e ao aprovar, comparada com o orçamento de hoje.
  const { data: versao } = useQuery({
    queryKey: ["orcamento", id, "versao", nivelDeVisao],
    enabled: canSeePrices,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("orcamento_diferenca_da_versao", { p_orcamento: id });
      if (error) throw error;
      return data as {
        tem_versao: boolean;
        numero?: number;
        status?: string;
        retroativa?: boolean;
        valor_da_versao?: number;
        valor_atual?: number;
        mudou?: boolean;
        valor_mudou?: boolean;
      };
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
  const { data: prazosDaCasa = [] } = useQuery({
    queryKey: CHAVE_PRAZOS,
    queryFn: carregarPrazos,
    staleTime: 5 * 60_000,
  });
  const itens = consultaItens.data ?? [];
  // A linha "Taxa de expresso" é do banco (recalcular_taxa_prazo): fica nos itens para o
  // total, o PDF e a OS, mas não é um item que se edita, move, nem que pede arte e produto.
  const itensDeProduto = itens.filter((i) => i.tipo_produto !== "taxa_prazo");
  const linhaDaTaxa = itens.find((i) => i.tipo_produto === "taxa_prazo") ?? null;
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

  // O que já está preenchido nos detalhes opcionais aparece no título, mesmo fechado.
  const resumoDosDetalhes = [
    form.especificacao.trim() ? "especificação" : null,
    layoutsRascunho.length > 0 ? (layoutsRascunho.length === 1 ? "1 arte" : `${layoutsRascunho.length} artes`) : null,
  ].filter((t): t is string => t !== null);
  const detalhesPedemAbrir = !!editando || resumoDosDetalhes.length > 0;
  const detalhesAbertos = detalhesManual ?? detalhesPedemAbrir;
  useEffect(() => {
    if (detalhesPedemAbrir) setDetalhesManual((atual) => atual ?? true);
  }, [detalhesPedemAbrir]);

  // O que o formulário pergunta depende da unidade: m² pede medida; os outros,
  // só quantidade. Medida já preenchida (tamanho fixo do produto) aparece sempre.
  const camposDoItem = camposDaUnidade(form.unidade);
  const mostrarMedidas = camposDoItem.medidas || vendidoPorArea || medidasAbertas;
  const produtoDoForm: ProdutoDaEscolha | null = form.produto_id
    ? (catalogo.produtos.find((p) => p.id === form.produto_id) ?? null)
    : null;
  // Item livre com o nome de um produto do catálogo (22/10/2026): 8 dos 16
  // itens livres dos orçamentos enviados e aprovados eram "Banner com bastão e
  // corda" digitado à mão — sem ficha, entram com custo zero e não baixam
  // estoque. O aviso oferece o produto; a escolha continua de quem orça.
  const nomeNormalizado = (t: string) => t.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  const produtoComOMesmoNome: ProdutoDaEscolha | null =
    !form.produto_id && form.descricao.trim()
      ? (catalogo.produtos.find((p) => nomeNormalizado(p.nome) === nomeNormalizado(form.descricao)) ?? null)
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
  // Com medida, o custo da peça sai do custo/m² × a área cobrada (a mesma do
  // preço). Era o custo/m² do produto comparado ao preço da PEÇA: placa de
  // R$ 11,25 com "custo" de R$ 78,00 e margem de −593%.
  const custoPorArea = vendidoPorArea;
  const custoUnitarioForm =
    custoPorArea && form.custo_m2.trim() !== ""
      ? custoDaPecaPorArea(dimensoesForm, paraNumero(form.custo_m2), form.area_minima)
      : paraNumero(form.custo_unitario);
  const custoM2NoCampo =
    form.custo_m2.trim() !== ""
      ? form.custo_m2
      : String(custoM2Implicito(dimensoesForm, paraNumero(form.custo_unitario), form.area_minima) ?? "");
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
    // No modo parceiro o item entra com o preço de parceiro do produto; sem ele,
    // entra o de tabela e a pessoa é avisada (22/10/2026).
    const emParceiro = acordo.data?.preco_modo === "parceiro";
    // Cliente parceiro cadastrado: vale a tabela do programa (nível, faixa, oferta);
    // senão, a coluna "preço de parceiro" do produto, se preenchida.
    const daTabela = tabelaDoParceiro?.porProduto.get(p.id);
    const qtd = Math.max(1, Math.ceil(Number(form.quantidade) || 1));
    const faixa = daTabela?.faixas
      ? [...daTabela.faixas].sort((a, b) => b.quantidade_minima - a.quantidade_minima).find((f) => f.quantidade_minima <= qtd)
      : null;
    const parceiroDoProduto = faixa?.preco_parceiro ?? daTabela?.preco_parceiro ?? p.preco_parceiro ?? null;
    const precoDoProduto =
      emParceiro && parceiroDoProduto != null ? Number(parceiroDoProduto) : Number(p.preco_base ?? 0);
    if (emParceiro && parceiroDoProduto == null && canSeePrices) {
      toast.warning(`“${p.nome}” não tem preço de parceiro: entrou com o preço de tabela.`);
    }
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
      preco_m2: ehUnidadeDeArea(p.unidade) ? String(precoDoProduto || "") : "",
      valor_unitario: String(precoDoProduto),
      // Produto por área: o custo do cadastro é por m². Até a medida chegar, o
      // custo un. fica por m² também — igual ao preço, a margem confere.
      custo_unitario: String(p.custo_medio ?? 0),
      custo_m2: ehUnidadeDeArea(p.unidade) ? String(p.custo_medio ?? "") : "",
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
      custo_m2: atual.produto_id ? "" : atual.custo_m2,
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
    setDetalhesManual(null);
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
    const areaMinima = i.area_minima != null ? Number(i.area_minima) : null;
    const precoM2 = porArea ? precoM2Implicito(dims, Number(i.valor_unitario ?? 0), areaMinima) : null;
    // O custo gravado é da peça; com medida, volta como custo/m² para escalar
    // com a medida, como o preço.
    const custoM2 = temDimensoes(dims) ? custoM2Implicito(dims, Number(i.custo_unitario ?? 0), areaMinima) : null;
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
      custo_m2: custoM2 && custoM2 > 0 ? String(custoM2) : "",
      produto_id: (i.produto_id as string | null) ?? null,
      area_minima: areaMinima,
    });
    // A escolha visual abre encolhida, com o produto e o tipo do item.
    setTipoEscolhido(tipoDoItemGravado(i, catalogo.produtos));
    setItemLivre(!i.produto_id);
    setMedidasAbertas(false);
    setEditando({ id: i.id as string, numero });
    formulario.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const acabamentosDoProduto = useAcabamentosDoProduto(form.produto_id);
  const produtosJaNoOrcamento = new Set<string>();
  for (const i of itens as { produto_id?: string | null }[]) {
    if (i.produto_id) produtosJaNoOrcamento.add(i.produto_id);
  }

  /** Acrescenta o serviço de acabamento como uma linha comum do orçamento. */
  async function adicionarCobrancaDeAcabamento(c: CobrancaPronta) {
    setSalvandoItem(true);
    try {
      await inserirLinhaDeAcabamento(id, c, itens.length);
      toast.success(
        `${c.acabamento.acabamento} entrou no orçamento (${c.quantidade.toLocaleString("pt-BR")})`,
      );
      await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
      await qc.invalidateQueries({ queryKey: ["orc-capas", id] });
      await recalcular();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvandoItem(false);
    }
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
    const nova = reordenar(itensDeProduto, indice, indice + passo);
    if (nova === itensDeProduto) return;
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

  // A resposta era "OS criada (787db567-840d-…)" e a tela ficava no
  // orçamento: o código interno não diz nada, e a OS precisava ser procurada.
  // Agora trava durante a chamada e leva direto à OS.
  const [convertendo, setConvertendo] = useState(false);
  async function converterEmOS() {
    if (convertendo) return;
    setConvertendo(true);
    try {
      const { data, error } = await (supabase.rpc as any)("converter_orcamento_em_os", {
        p_orcamento_id: id,
        p_opcoes: {},
      });
      if (error) return toast.error(mensagemErro(error));
      const osId = typeof data === "object" && data && "os_id" in data ? String((data as any).os_id) : "";
      qc.invalidateQueries({ queryKey: ["orcamento", id] });
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
      qc.invalidateQueries({ queryKey: ["kanban-os"] });
      toast.success("OS criada", { description: "Abrindo a ordem de serviço." });
      if (osId) navigate({ to: "/os/$id", params: { id: osId } });
    } finally {
      setConvertendo(false);
    }
  }

  if (isLoading) return <Carregando tela />;
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
    itens: itensDeProduto as { arquivo_id: string | null }[],
    descontoPendente,
  });
  const subtotalGravado = Number(orc.valor_subtotal ?? 0);
  const descontoGravado = Math.max(
    0,
    Math.round((subtotalGravado - Number(orc.valor_total ?? 0)) * 100) / 100,
  );
  const brlVersao = (v?: number | null) =>
    Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const semArte = (itensDeProduto as any[]).filter((i) => !i.arquivo_id).length;
  // Item em texto livre, sem produto: o banco não tem de onde tirar o custo, e a OS
  // nasce sem custo previsto (19/10/2026: as OS #163 e #166). Com produto, o custo
  // vem do cadastro mesmo quando quem monta o orçamento não vê custo.
  const semProduto = (itensDeProduto as any[]).filter((i) => !i.produto_id).length;
  const somaArea = somaAreaTotal(itens);

  const estados = estadoDosPassosDaEquipe({
    clienteNome: orc.cliente_nome ?? null,
    itens: itensDeProduto.length,
    total: canSeePrices ? Number(orc.valor_total ?? 0) : null,
    pendencias,
    fechado,
  });
  // O passo inicial espera o que o calcula (itens, acordo e desconto): decidir antes
  // abriria sempre nos itens, porque `pendencias` ainda diria que falta tudo.
  const dadosProntos = !consultaItens.isPending && !acordo.isPending && !(canSeePrices && desconto.isPending);
  if (passoInicialRef.current === null && dadosProntos) {
    passoInicialRef.current = passoInicialDaEquipe({ fechado, itens: itensDeProduto.length, pendencias });
  }
  const passo: PassoDoOrcamento = passoEscolhido ?? passoInicialRef.current ?? 2;
  const irParaPasso = (p: PassoDoOrcamento, alvo?: string) => {
    setPassoEscolhido(p);
    if (typeof window === "undefined") return;
    // O alvo só existe depois que o passo aparece: espera o próximo quadro.
    window.setTimeout(() => {
      if (alvo) document.getElementById(alvo)?.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 60);
  };
  const taxaDoPrazoDoOrcamento =
    prazoEscolhido(prazosDaCasa, dadosDoAcordo?.prazo_tipo ?? PRAZO_NORMAL)?.taxa_percentual ?? 0;
  const aprovadoParaConverter = !fechado && orc.status === "aprovado" && podeConverter;
  // Colunas da tabela base que a view financeira não tipa; lidas aqui sem `any`.
  const extra = orc as typeof orc & {
    cliente_id?: string | null;
    contato_nome?: string | null;
    contato_telefone?: string | null;
    contato_email?: string | null;
    vendedor_id?: string | null;
  };
  const condicao = (dadosDoAcordo?.condicao_pagamento ?? null) as {
    forma?: string | null;
    parcelas?: number | null;
  } | null;

  return (
    <div className="space-y-6 pb-28 lg:pb-0">
      <header className="sticky top-0 z-20 -mx-2 px-2 pt-2 space-y-3 border-b border-border pb-4 mb-2 bg-background/95 backdrop-blur">
        {/* Linha 1 — identificação */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <Dica texto="Voltar para orçamentos">
              <Button asChild variant="ghost" size="icon" className="mt-1 shrink-0">
                <Link to="/orcamentos" aria-label="Voltar para orçamentos">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
            </Dica>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                <span>Orçamento #{orc.numero}</span>
                <StatusChip label={ROTULO_DO_STATUS[orc.status] ?? orc.status} tone={statusTone[orc.status] ?? "muted"} />
                {linhaDaTaxa && <StatusChip label="Expresso" tone="amber" />}
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
            </div>
          </div>

          {/* Converter exige `orcamentos.convert`, que só admin e gestor têm.
              Sem a permissão, no lugar do botão fica a explicação de quem
              converte e por onde essa pessoa é avisada. */}
          {/* Só aprovado vira OS: em rascunho, enviado, rejeitado ou expirado o
              banco recusa ("Orçamento sem versão aprovada") — o botão não
              promete o que não entrega. Com OS, o lugar dele leva até ela. */}
          {orc.os_id && (
            <Button asChild variant="outline" className="shrink-0 h-11 md:h-10">
              <Link to="/os/$id" params={{ id: orc.os_id }}>
                Ver a OS <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          )}
          {!fechado && orc.status === "aprovado" && (
            podeConverter ? (
              // Desconto que passou da alçada sem aprovação: o banco recusa a
              // conversão (converter_orcamento_em_os), então o botão já trava
              // aqui com o motivo.
              <Dica texto={descontoPendente ? dicaCampo("/orcamentos", "desconto_pendente") : null}>
                <Button
                  onClick={converterEmOS}
                  disabled={descontoPendente || convertendo}
                  className="shrink-0 h-11 md:h-10"
                >
                  {descontoPendente ? <Lock className="h-4 w-4 mr-1" /> : null}
                  {convertendo ? "Criando a OS..." : "Converter em OS"} <ArrowRight className="h-4 w-4 ml-1" />
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

        {/* Linha 3 — ações secundárias */}
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
        </div>
        {versao?.tem_versao && versao.mudou && (
          <p
            role="status"
            className="md:pl-12 text-xs text-warning"
          >
            Mudou depois de {versao.status === "aprovada" ? "aprovado" : "enviado"}: a versão {versao.numero}
            {versao.retroativa ? " (retrato de 22/10, quando o controle começou)" : ""} tinha{" "}
            {brlVersao(versao.valor_da_versao)}
            {versao.valor_mudou ? <>, hoje está {brlVersao(versao.valor_atual)}</> : ", e os itens mudaram sem mudar o total"}.
            {" "}
            {versao.status === "aprovada"
              ? "Para converter em OS o valor precisa voltar ao aprovado, ou o cliente aprovar de novo."
              : "Envie de novo para registrar a nova versão."}
          </p>
        )}
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
                      onClick={() => irParaPasso(passoDaPendencia(p), alvo)}
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

      <BarraDePassosDoOrcamento atual={passo} estados={estados} onIr={(p) => irParaPasso(p)} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {passo === 1 && (
            <Card id="passo-cliente" className="scroll-mt-48">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">{PASSOS_DA_EQUIPE[0].pergunta}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Cliente</p>
                  {extra.cliente_id && orc.cliente_nome ? (
                    <Link
                      to="/clientes/$id"
                      params={{ id: extra.cliente_id }}
                      className="text-base font-medium underline-offset-4 hover:underline"
                    >
                      {orc.cliente_nome}
                    </Link>
                  ) : (
                    <p className="text-base font-medium">{orc.cliente_nome || "Sem cliente vinculado"}</p>
                  )}
                  {[extra.contato_nome, extra.contato_telefone, extra.contato_email].some(Boolean) && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[extra.contato_nome, extra.contato_telefone, extra.contato_email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Quem trouxe a venda
                  </p>
                  <QuemTrouxeAVenda alvo="orcamento" id={id} vendedorId={extra.vendedor_id ?? null} invalidar={[["orcamento", id]]} compacto />
                </div>
                {canSeePrices && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                      Preço para
                    </p>
                    <PrecoDoOrcamento
                      orcamentoId={id}
                      modo={acordo.data?.preco_modo ?? "cliente_final"}
                      confirmadoPor={acordo.data?.preco_parceiro_confirmado_por ?? null}
                      confirmadoEm={acordo.data?.preco_parceiro_confirmado_em ?? null}
                      clienteRevendedor={clienteRevendedor}
                      parceiroCadastrado={!!tabelaDoParceiro && tabelaDoParceiro.nivel != null}
                      nivelDoParceiro={tabelaDoParceiro?.nivel ?? null}
                      descontoDoParceiro={tabelaDoParceiro?.descontoPct ?? null}
                      podeEditar={podeEditarItens}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {passo === 2 && (
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

                    <div>
                      <Label htmlFor="item-descricao">Descrição</Label>
                      <Input
                        id="item-descricao"
                        placeholder="Ex.: Adesivo vinil fosco"
                        value={form.descricao}
                        onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                      />
                      {produtoComOMesmoNome && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs">
                          <span className="min-w-0 flex-1">
                            “{produtoComOMesmoNome.nome}” é um produto do catálogo. Como item livre ele entra sem ficha:
                            sem custo e sem baixa de estoque.
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => aplicarProduto(produtoComOMesmoNome)}
                          >
                            Usar o produto
                          </Button>
                        </div>
                      )}
                    </div>

                    <EscolhaDeMaterial
                      nomeAtual={produtoDoForm?.nome}
                      catalogo={catalogo.produtos}
                      desabilitado={salvandoItem}
                      preco={(p) =>
                        canSeePrices && p.preco_base != null
                          ? `${brl(Number(p.preco_base))}/${p.unidade?.toLowerCase().replace("²", "2") === "m2" ? "m²" : p.unidade}`
                          : undefined
                      }
                      onEscolher={aplicarProduto}
                    />

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
                      <div className="col-span-4 md:col-span-3">
                        <UnidadeDoItem
                          valor={form.unidade}
                          onMudar={(unidade) => setForm({ ...form, unidade })}
                          desabilitado={salvandoItem}
                        />
                      </div>
                      <div className="col-span-12 md:col-span-5">
                        <AcabamentoDoItem
                          valor={form.acabamento}
                          opcoes={tipoDoItem?.acabamentos ?? []}
                          onMudar={(valor) => setForm({ ...form, acabamento: valor })}
                          desabilitado={salvandoItem}
                        />
                      </div>
                    </div>

                    {canSeePrices && vendidoPorArea && (
                      <CobrancaDoAcabamento
                        acabamentos={acabamentosDoProduto.data ?? []}
                        servicos={catalogo.produtos}
                        peca={dimensoesForm}
                        nomeDoProduto={produtoDoForm?.nome}
                        jaNoOrcamento={produtosJaNoOrcamento}
                        desabilitado={salvandoItem}
                        onAdicionar={adicionarCobrancaDeAcabamento}
                      />
                    )}

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

                    <OrcamentoMaterialCheck produtoId={form.produto_id} baseDeConsumo={baseConsumo} pecas={quantidadeForm} />

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
                                // Dica no próprio campo: o "title" não aparece no celular, e um
                                // texto embaixo desalinharia a linha de preços.
                                placeholder={vendidoPorArea ? undefined : "informe a medida"}
                                value={form.preco_m2}
                                onChange={(e) => setForm({ ...form, preco_m2: e.target.value })}
                              />
                            </div>
                            <div className="col-span-6 md:col-span-3">
                              <Label htmlFor="item-valor-un" className="flex items-center gap-1">
                                Valor un.
                                {valorUnitarioDerivado !== null && (
                                  <DicaIcone texto="Calculado a partir da área e do preço/m²" rotulo="Valor un." />
                                )}
                              </Label>
                              <Input
                                id="item-valor-un"
                                type="number"
                                step="0.01"
                                inputMode="decimal"
                                readOnly={valorUnitarioDerivado !== null}
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
                              <Label htmlFor="item-custo-un">{custoPorArea ? "Custo/m²" : "Custo un."}</Label>
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
                              value={custoPorArea ? custoM2NoCampo : form.custo_unitario}
                              onChange={(e) =>
                                // Digitou à mão: o custo deixa de ser "calculado".
                                setForm(
                                  custoPorArea
                                    ? { ...form, custo_m2: e.target.value, origem_calculo: "manual" }
                                    : { ...form, custo_unitario: e.target.value, origem_calculo: "manual" },
                                )
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
                          <span className="text-link">
                            {descreverFaixa(faixaSeguinte, form.unidade)} — vale sugerir ao cliente.
                          </span>
                        )}
                      </div>
                    )}

                    {/* Os degraus em tabela, como no orçamento do parceiro: clicar numa linha põe
                        aquela quantidade. O preço do item só muda em "Usar este preço". */}
                    {canSeePrices && (
                      <TabelaDeDegraus
                        degraus={degrausDeFaixasDeBalcao(faixas, quantidadeForm)}
                        unidade={form.unidade}
                        titulo="Quanto mais, menor o preço por unidade"
                        desabilitado={salvandoItem}
                        onEscolher={(q) => setForm((atual) => ({ ...atual, quantidade: String(q) }))}
                      />
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
                                : "text-success"
                          }
                        >
                          {percentual(margemItem)}
                        </strong>
                        {margemMinimaItem !== null && (
                          <span className="text-muted-foreground">
                            (mínima do produto: {percentual(margemMinimaItem)})
                          </span>
                        )}
                        {/* Com medida, a conta da margem à vista: preço e custo da MESMA peça. */}
                        {custoPorArea && (
                          <span className="text-muted-foreground" data-custo-da-peca="">
                            · peça: {brl(valorUnitarioEfetivo)} de preço, {brl(custoUnitarioForm)} de custo
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
                          const daPeca = resultado.custoTotal / qtd;
                          // Com medida, o custo/m² acompanha o da peça (quatro casas: a
                          // volta × área dá o mesmo valor de centavo).
                          const m2DaPeca = custoPorArea ? custoM2Implicito(dimensoesForm, daPeca, form.area_minima) : null;
                          setForm((atual) => ({
                            ...atual,
                            custo_unitario: daPeca.toFixed(2),
                            custo_m2: m2DaPeca !== null ? String(m2DaPeca) : "",
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
                            `Custo calculado: ${brl(resultado.custoTotal)} · margem ${percentual(resultado.margemPct * 100)}`,
                          );
                        }}
                      />
                    )}

                    {/* O que é opcional fica recolhido (20/10/2026): o tipo vem do produto, e
                        a maioria dos itens não tem especificação nem arte na hora de orçar.
                        O resumo ao lado do título mostra o que já está preenchido. */}
                    <DetalhesOpcionais
                      aberto={detalhesAbertos}
                      onMudar={setDetalhesManual}
                      preenchido={resumoDosDetalhes}
                    >
                      <div>
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
                      <div>
                        <Label htmlFor="item-especificacao" className="flex flex-wrap items-center gap-1">
                          Especificações para a produção
                          <span className="text-muted-foreground">(sai no PDF embaixo da descrição)</span>
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
                    </DetalhesOpcionais>

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
                        {!consultaItens.isPending && itensDeProduto.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={canSeePrices ? 9 : 7} className="text-center text-muted-foreground">
                              Nenhum item ainda — busque um produto do catálogo acima para começar.
                            </TableCell>
                          </TableRow>
                        )}
                        {itens.map((i: any, indice: number) => {
                          if (i.tipo_produto === "taxa_prazo") {
                            return (
                              <TableRow key={i.id} className="bg-muted/30" data-taxa-prazo="">
                                <TableCell />
                                <TableCell colSpan={4}>
                                  <p className="font-medium">{i.descricao}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Calculada sozinha sobre os itens acima; acompanha o prazo escolhido nas condições.
                                  </p>
                                </TableCell>
                                <TableCell />
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
                                <TableCell />
                              </TableRow>
                            );
                          }
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
                                {!i.produto_id && (
                                  <p className="mt-0.5 text-xs text-amber-600" data-sem-produto="">
                                    Sem produto ligado: o custo e a margem deste item não são calculados.
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {/* Item com medida conta PEÇAS: "25 m2" lia-se como 25 m² quando eram
                                    25 placas de 0,30 × 0,15 (a metragem está na coluna ao lado). */}
                                {Number(i.quantidade).toLocaleString("pt-BR")}{" "}
                                {temDimensoes(i) ? (Number(i.quantidade) === 1 ? "peça" : "peças") : i.unidade}
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
                                    <Dica texto="Subir na lista">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Subir o item ${numero}`}
                                        disabled={indice === 0}
                                        onClick={() => void moverItem(indice, -1)}
                                      >
                                        <ArrowUp className="h-4 w-4" />
                                      </Button>
                                    </Dica>
                                    <Dica texto="Descer na lista">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Descer o item ${numero}`}
                                        disabled={indice === itensDeProduto.length - 1}
                                        onClick={() => void moverItem(indice, 1)}
                                      >
                                        <ArrowDown className="h-4 w-4" />
                                      </Button>
                                    </Dica>
                                    <Dica texto="Editar item">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Editar o item ${numero}`}
                                        onClick={() => editarItem(i, numero)}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    </Dica>
                                    <Dica texto="Duplicar item">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Duplicar o item ${numero}`}
                                        onClick={() => void duplicarItem(i)}
                                      >
                                        <Copy className="h-4 w-4" />
                                      </Button>
                                    </Dica>
                                    <Dica texto="Tirar o item">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Tirar o item ${numero}`}
                                        onClick={() => setARemover({ id: i.id, descricao: i.descricao, numero })}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </Dica>
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
                    <span className="text-muted-foreground">Itens:</span> <strong>{itensDeProduto.length}</strong>
                  </div>
                  {semArte > 0 && (
                    <div className="text-amber-500">
                      {semArte === 1 ? "1 item sem arte" : `${semArte} itens sem arte`}
                    </div>
                  )}
                  {semProduto > 0 && (
                    <div className="flex items-center gap-1 text-amber-500">
                      {semProduto === 1 ? "1 item sem produto" : `${semProduto} itens sem produto`}
                      <DicaIcone texto="Escolha o produto do catálogo para o custo entrar sozinho." rotulo="Item sem produto" />
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
                          onClick={() => irParaPasso(3, "acordo-desconto")}
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
                          <strong className={margem < 20 ? "text-destructive" : "text-success"}>
                            {percentual(margem)}
                          </strong>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {passo === 3 && (
            <div className="space-y-4">
              <PrazoDeProducao
                orcamentoId={id}
                prazoTipo={dadosDoAcordo?.prazo_tipo ?? null}
                baseDaTaxa={
                  canSeePrices
                    ? itensDeProduto.reduce((soma: number, i) => soma + Number(i.valor_total ?? 0), 0)
                    : null
                }
                podeEditar={podeMexer}
              />
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
                      numero={Number((orc as any).numero ?? 0) || null}
                      clienteNome={orc.cliente_nome ?? (orc as any).contato_nome ?? null}
                      clienteTelefone={
                        ((orc as any).cliente_whatsapp ?? (orc as any).cliente_telefone ?? (orc as any).contato_telefone ?? null) as string | null
                      }
                    />
                  )}
                  <Observacoes acordo={dadosDoAcordo} podeEditar={podeMexer} />
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando prazos e pagamento…
                </p>
              )}
            </div>
          )}

          {passo === 4 && (
            <>
              <Card id="passo-revisao" className="scroll-mt-48">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{PASSOS_DA_EQUIPE[3].pergunta}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {fechado ? (
                    <p className="text-sm text-muted-foreground">
                      Este orçamento já virou OS: o que foi vendido fica como foi combinado.
                    </p>
                  ) : pendencias.length === 0 ? (
                    <p className="text-sm">Nada falta para mandar ao cliente.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium">Antes de mandar ao cliente, falta:</p>
                      <ul className="space-y-1 text-sm">
                        {pendencias.map((p) => (
                          <li key={p}>
                            <button
                              type="button"
                              className="text-amber-600 underline underline-offset-2 hover:text-amber-500"
                              onClick={() => irParaPasso(passoDaPendencia(p), ONDE_RESOLVER[p])}
                            >
                              {p}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Cliente</dt>
                      <dd className="font-medium">{orc.cliente_nome || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Itens</dt>
                      <dd className="font-medium">
                        {itensDeProduto.length}
                        {somaArea > 0 ? ` · ${m2(somaArea)}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Prazo de produção</dt>
                      <dd className="font-medium">
                        {linhaDaTaxa
                          ? `Expresso (+${rotuloDaPorcentagem(taxaDoPrazoDoOrcamento)} sobre os produtos)`
                          : "Normal"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Entrega</dt>
                      <dd className="font-medium">
                        {dadosDoAcordo?.data_entrega_prometida ?? dadosDoAcordo?.prazo
                          ? dataBR((dadosDoAcordo?.data_entrega_prometida ?? dadosDoAcordo?.prazo) as string)
                          : "sem data"}
                      </dd>
                    </div>
                    {canSeePrices && (
                      <div>
                        <dt className="text-muted-foreground">Pagamento</dt>
                        <dd className="font-medium">
                          {condicao?.forma ?? "forma não escolhida"}
                          {Number(condicao?.parcelas) > 1
                            ? ` · ${condicao?.parcelas}×`
                            : ""}
                        </dd>
                      </div>
                    )}
                    {canSeePrices && (
                      <div>
                        <dt className="text-muted-foreground">Total</dt>
                        <dd className="font-semibold tabular-nums">{brl(orc.valor_total)}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="flex flex-wrap items-center gap-2 border-t pt-4">
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
                </CardContent>
              </Card>

              <PDFHistoryCard tipo="orcamento" referencia_id={id} />
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => irParaPasso(passoAnterior(passo))} disabled={passo === 1}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
            {!ehUltimo(passo) && (
              // No celular quem avança é a barra fixa do rodapé; aqui só no computador.
              <Button className="hidden lg:inline-flex" onClick={() => irParaPasso(passoSeguinte(passo))}>
                {rotuloDoAvancar(passo)} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* O resumo fica ao lado em todos os passos, como no orçamento do parceiro. */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-44 lg:self-start" data-testid="resumo-do-orcamento">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Resumo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Itens</span>
                <span className="font-medium">{itensDeProduto.length}</span>
              </div>
              {canSeePrices && linhaDaTaxa && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    Expresso (+{rotuloDaPorcentagem(taxaDoPrazoDoOrcamento)})
                  </span>
                  <span className="tabular-nums">{brl(linhaDaTaxa.valor_total)}</span>
                </div>
              )}
              {canSeePrices && descontoGravado > 0 && (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Soma dos itens</span>
                    <span className="tabular-nums">{brl(subtotalGravado)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Desconto</span>
                    <span className="tabular-nums">− {brl(descontoGravado)}</span>
                  </div>
                </>
              )}
              {canSeePrices && (
                <div className="flex justify-between gap-3 border-t pt-2">
                  <span className="text-muted-foreground">Total</span>
                  <strong className="tabular-nums">{brl(orc.valor_total)}</strong>
                </div>
              )}
              {canSeeFinancials && (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Custo</span>
                    <span className="tabular-nums">{brl(orc.custo_estimado)}</span>
                  </div>
                  {margem !== null && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Margem</span>
                      <strong className={margem < 20 ? "text-destructive" : "text-success"}>{percentual(margem)}</strong>
                    </div>
                  )}
                </>
              )}
              {!fechado && (
                <button
                  type="button"
                  className="w-full border-t pt-2 text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => irParaPasso(4)}
                >
                  {pendencias.length === 0
                    ? "Nada falta para enviar"
                    : `${pendencias.length} ${pendencias.length === 1 ? "pendência" : "pendências"} · ver na revisão`}
                </button>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <div
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 p-2 pl-4 shadow-2xl backdrop-blur md:bottom-6 lg:hidden"
        data-testid="barra-fixa-do-orcamento"
      >
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{canSeePrices ? "Total" : "Itens"}</p>
          <p className="truncate text-base font-semibold tabular-nums">
            {canSeePrices ? brl(orc.valor_total) : itensDeProduto.length}
          </p>
        </div>
        {orc.os_id ? (
          <Button asChild>
            <Link to="/os/$id" params={{ id: orc.os_id }}>
              Ver a OS <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        ) : passo === 4 && aprovadoParaConverter ? (
          <Button onClick={converterEmOS} disabled={descontoPendente || convertendo}>
            {convertendo ? "Criando a OS..." : "Converter em OS"} <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : !ehUltimo(passo) ? (
          <Button onClick={() => irParaPasso(passoSeguinte(passo))}>
            {rotuloDoAvancar(passo)} <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : null}
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
