/* eslint-disable @typescript-eslint/no-explicit-any */
import { EscolhaDeMaterial } from "@/components/orcamento/escolha-de-material";
// As mesmas peças do item do orçamento da equipe (02/11/2026, pedido do dono: o
// item do parceiro herda a estrutura do oficial; só o bloco de ganho é dele).
import { MedidasDaPeca } from "@/components/orcamento/medidas-da-peca";
import { QuantidadeDoItem } from "@/components/orcamento/quantidade-do-item";
import { AcabamentoDoItem } from "@/components/orcamento/acabamento-do-item";
import {
  camposDaUnidade,
  tipoDoProduto,
  unidadeAoEscolherTipo,
  type ChaveDoTipo,
  type TamanhoComum,
  type TipoDeProduto,
} from "@/domain/orcamentos/tipos-de-produto";
// A escolha do produto em cartões (tipo → produto com foto), como a equipe.
import { DialogoDeEscolhaDoProduto, LinhaDoProduto } from "./escolha-de-produto-do-parceiro";
import { produtoDaEscolhaDoParceiro, unidadeDoParceiroParaOTipo } from "@/domain/parceiros/escolha";
import type { ExtrasDoProduto } from "@/domain/parceiros/vitrine";
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
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Download,
  Lock,
  PenLine,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/bex/StatusChip";
import { Dica, DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { PedidoDialog } from "./pedido-dialog";
import { BarraDePassosDoOrcamento, PerguntaDoPasso } from "./barra-de-passos";
import { TabelaDeDegraus } from "./tabela-de-degraus";
import { EscolhaDoPrazo } from "@/components/orcamento/escolha-do-prazo";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { baixarArquivo, renderPDFBlob } from "@/lib/pdf/generate";
import {
  carregarCatalogo,
  carregarExtrasDoCatalogo,
  CHAVE_EXTRAS,
  carregarPrazos,
  carregarPainel,
  CHAVE_CATALOGO,
  CHAVE_PRAZOS,
  CHAVE_PAINEL,
  urlDoLogo,
} from "@/lib/parceiro-api";
import {
  brl,
  custoDoItem,
  precoDaGrafica,
  precoSugerido,
  resumoDoOrcamento,
  unidadeLegivel,
  vendaDoItem,
  vendidoPorArea,
  type ItemDoCatalogo,
  type ItemDoOrcamento,
} from "@/domain/parceiros/preco";
import {
  STATUS_DO_ORCAMENTO,
  STATUS_ESCOLHIVEIS,
  validadeDoOrcamento,
  type StatusDoOrcamento,
} from "@/domain/parceiros/painel";
import { nomeDoArquivo, propsDoOrcamentoDoParceiro } from "@/domain/parceiros/pdf";
import { degrausDoProduto } from "@/domain/parceiros/degraus";
import {
  PRAZO_NORMAL,
  aplicarTaxaDePrazo,
  prazoEscolhido,
  rotuloDaPorcentagem,
  taxaDoPrazo,
} from "@/domain/parceiros/prazo";
import {
  ehUltimo,
  estadoDosPassos,
  passoAnterior,
  passoInicial,
  passoSeguinte,
  rotuloDoAvancar,
  type PassoDoOrcamento,
} from "@/domain/parceiros/passos-do-orcamento";

/**
 * O orçamento do parceiro para o cliente dele: itens, preço, ganho, PDF e pedido.
 *
 * Fica fora do arquivo de rota para a rota só ler o parâmetro — e para a tela
 * poder ser montada com dados de exemplo na conferência visual.
 */

type Registro = {
  id: string;
  numero: number;
  titulo: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  cliente_email: string | null;
  cliente_documento: string | null;
  observacoes: string | null;
  validade_dias: number;
  prazo: string | null;
  status: StatusDoOrcamento;
  pedido_orcamento_id: string | null;
  created_at: string;
};

type Cabecalho = {
  titulo: string;
  cliente_nome: string;
  cliente_telefone: string;
  cliente_email: string;
  cliente_documento: string;
  observacoes: string;
  validade_dias: number;
  prazo: string;
  status: StatusDoOrcamento;
};

type ItemEditavel = ItemDoOrcamento & { id: string; acabamento: string | null };

const numeroOuNulo = (v: unknown) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};
const vazioParaNulo = (v: string | null | undefined) => (v ?? "").trim() || null;

function cabecalhoDe(o: Registro): Cabecalho {
  return {
    titulo: o.titulo ?? "",
    cliente_nome: o.cliente_nome ?? "",
    cliente_telefone: o.cliente_telefone ?? "",
    cliente_email: o.cliente_email ?? "",
    cliente_documento: o.cliente_documento ?? "",
    observacoes: o.observacoes ?? "",
    validade_dias: Number(o.validade_dias) || 7,
    prazo: o.prazo || PRAZO_NORMAL,
    status: o.status,
  };
}

function itemDe(l: Record<string, unknown>): ItemEditavel {
  return {
    id: String(l.id),
    produto_id: (l.produto_id as string | null) ?? null,
    descricao: String(l.descricao ?? ""),
    unidade: String(l.unidade ?? "un"),
    largura: numeroOuNulo(l.largura),
    altura: numeroOuNulo(l.altura),
    quantidade: Number(l.quantidade) || 1,
    preco_venda_unidade: Number(l.preco_venda_unidade) || 0,
    acabamento: (l.acabamento as string | null) ?? null,
  };
}

const itemVazio = (): ItemEditavel => ({
  id: crypto.randomUUID(),
  produto_id: null,
  descricao: "",
  unidade: "un",
  largura: null,
  altura: null,
  quantidade: 1,
  preco_venda_unidade: 0,
  acabamento: null,
});

export function EditorDeOrcamento({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  const catalogoQuery = useQuery({ queryKey: CHAVE_CATALOGO, queryFn: carregarCatalogo, staleTime: 5 * 60_000 });
  const catalogo = catalogoQuery.data ?? [];
  // Foto e descrição dos produtos para os cartões; sem elas o cartão mostra o desenho do tipo.
  const { data: extras = [] } = useQuery({ queryKey: CHAVE_EXTRAS, queryFn: carregarExtrasDoCatalogo, staleTime: 5 * 60_000 });
  const { data: prazos = [] } = useQuery({ queryKey: CHAVE_PRAZOS, queryFn: carregarPrazos, staleTime: 5 * 60_000 });
  const servidor = useQuery({
    queryKey: ["parceiro-orcamento", id],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [cab, its] = await Promise.all([
        (supabase as any)
          .from("parceiro_orcamentos")
          .select(
            "id, numero, titulo, cliente_nome, cliente_telefone, cliente_email, cliente_documento, observacoes, validade_dias, prazo, status, pedido_orcamento_id, created_at",
          )
          .eq("id", id)
          .maybeSingle(),
        (supabase as any)
          .from("parceiro_orcamento_itens")
          .select("id, produto_id, descricao, unidade, largura, altura, quantidade, preco_venda_unidade, acabamento, ordem, created_at")
          .eq("orcamento_id", id)
          .order("ordem")
          .order("created_at"),
      ]);
      if (cab.error) throw cab.error;
      if (its.error) throw its.error;
      if (!cab.data) return null;
      return {
        orcamento: cab.data as Registro,
        itens: ((its.data ?? []) as Record<string, unknown>[]).map(itemDe),
      };
    },
  });

  const [cab, setCab] = useState<Cabecalho | null>(null);
  const [itens, setItens] = useState<ItemEditavel[]>([]);
  // "Tirar o item" pede confirmação, como na tela da equipe.
  const [aRemover, setARemover] = useState<{ id: string; numero: number; descricao: string } | null>(null);
  // O diálogo de escolha em cartões: "novo" cria o item ao escolher; um id troca o produto daquele item.
  const [escolhendo, setEscolhendo] = useState<{ alvo: "novo" | string } | null>(null);
  const [salvoComo, setSalvoComo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [pedidoAberto, setPedidoAberto] = useState(false);
  // Nulo até a pessoa escolher: aí vale o passo inicial, que depende do que já existe.
  const [passoEscolhido, setPassoEscolhido] = useState<PassoDoOrcamento | null>(null);

  const retrato = cab ? JSON.stringify({ c: cab, i: itens }) : "";
  const sujo = !!cab && retrato !== salvoComo;

  // Recarrega do banco só quando não há edição pendente: um refetch não pode
  // apagar o que a pessoa digitou.
  useEffect(() => {
    const dados = servidor.data;
    if (!dados || sujo) return;
    const c = cabecalhoDe(dados.orcamento);
    setCab(c);
    setItens(dados.itens);
    setSalvoComo(JSON.stringify({ c, i: dados.itens }));
    // O passo inicial vale só na primeira carga: depois de salvar o primeiro item o
    // banco devolve itens e a tela não pode pular de passo sozinha.
    setPassoEscolhido(
      (atual) =>
        atual ??
        passoInicial({
          itens: dados.itens.length,
          somenteLeitura: dados.orcamento.status === "pedido_feito",
          clientePreenchido: c.cliente_nome.trim() !== "" && c.titulo.trim() !== "",
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servidor.data]);

  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  const porProduto = useMemo(() => new Map(catalogo.map((p) => [p.produto_id, p])), [catalogo]);
  const extraPorProduto = useMemo(() => new Map(extras.map((e) => [e.produto_id, e])), [extras]);
  const resumoBase = useMemo(() => resumoDoOrcamento(itens, porProduto), [itens, porProduto]);

  if (servidor.isLoading || !painel) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }
  if (servidor.error || !servidor.data || !cab) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="font-medium">{servidor.error ? mensagemErro(servidor.error) : "Orçamento não encontrado."}</p>
        <Link to="/parceiro/orcamentos" className="mt-3 inline-block text-sm underline underline-offset-4">
          Voltar para os orçamentos
        </Link>
      </div>
    );
  }

  const registro = servidor.data.orcamento;
  const somenteLeitura = registro.status === "pedido_feito";
  const pedido = painel.pedidos.find((p) => p.orcamento_parceiro_id === id);
  const status = STATUS_DO_ORCAMENTO[cab.status] ?? STATUS_DO_ORCAMENTO.rascunho;
  const validade = validadeDoOrcamento(registro.created_at, cab.validade_dias);
  // A taxa do prazo é o que o parceiro paga À GRÁFICA: sobe o custo e desce o ganho; a venda não muda.
  const prazoAtual = prazoEscolhido(prazos, cab.prazo);
  const taxaDoPrazoReais = taxaDoPrazo(resumoBase.custo, prazoAtual?.taxa_percentual ?? 0);
  const resumo = aplicarTaxaDePrazo(resumoBase, taxaDoPrazoReais);
  const passo: PassoDoOrcamento = passoEscolhido ?? 2;
  const estados = estadoDosPassos({
    clienteNome: cab.cliente_nome,
    titulo: cab.titulo,
    itens: itens.length,
    itensSemDescricao: itens.filter((i) => !i.descricao.trim()).length,
    pendencias: resumo.pendencias.length,
    vendaTotal: resumo.venda,
    validadeDias: cab.validade_dias,
    observacoes: cab.observacoes,
    prazoNome: prazoAtual && prazoAtual.taxa_percentual > 0 ? prazoAtual.nome.toLowerCase() : null,
  });
  const irParaPasso = (p: PassoDoOrcamento) => {
    setPassoEscolhido(p);
    // Quem troca de passo no celular volta ao topo do passo, não ao meio da página.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const mudarCab = (parcial: Partial<Cabecalho>) => setCab((atual) => (atual ? { ...atual, ...parcial } : atual));
  const mudarItem = (itemId: string, parcial: Partial<ItemEditavel>) =>
    setItens((lista) => lista.map((i) => (i.id === itemId ? { ...i, ...parcial } : i)));

  async function salvar(novoStatus?: StatusDoOrcamento): Promise<boolean> {
    if (!cab || somenteLeitura) return false;
    const c = novoStatus ? { ...cab, status: novoStatus } : cab;
    if (!c.titulo.trim() || !c.cliente_nome.trim()) {
      toast.error("Preencha o nome do cliente e do que se trata.");
      return false;
    }
    const semDescricao = itens.findIndex((i) => !i.descricao.trim());
    if (semDescricao >= 0) {
      toast.error(`O item ${semDescricao + 1} está sem descrição.`);
      return false;
    }
    setSalvando(true);
    try {
      const { data: atualizado, error: erroCab } = await (supabase as any)
        .from("parceiro_orcamentos")
        .update({
          titulo: c.titulo.trim(),
          cliente_nome: c.cliente_nome.trim(),
          cliente_telefone: vazioParaNulo(c.cliente_telefone),
          cliente_email: vazioParaNulo(c.cliente_email),
          cliente_documento: vazioParaNulo(c.cliente_documento),
          observacoes: vazioParaNulo(c.observacoes),
          validade_dias: Math.min(Math.max(Math.round(Number(c.validade_dias) || 7), 1), 90),
          prazo: c.prazo || PRAZO_NORMAL,
          status: c.status,
        })
        .eq("id", id)
        .select("id");
      if (erroCab) throw erroCab;
      // escrita barrada por RLS volta sem erro e sem linha
      if (!atualizado?.length) throw new Error("O orçamento não pôde ser salvo. Recarregue a página.");

      const locais = new Set(itens.map((i) => i.id));
      const removidos = (servidor.data?.itens ?? []).map((i) => i.id).filter((x) => !locais.has(x));
      if (removidos.length > 0) {
        const { error } = await (supabase as any).from("parceiro_orcamento_itens").delete().in("id", removidos);
        if (error) throw error;
      }
      if (itens.length > 0) {
        const { error } = await (supabase as any).from("parceiro_orcamento_itens").upsert(
          itens.map((i, ordem) => ({
            id: i.id,
            orcamento_id: id,
            produto_id: i.produto_id,
            descricao: i.descricao.trim(),
            unidade: i.unidade || "un",
            largura: i.largura && i.largura > 0 ? i.largura : null,
            altura: i.altura && i.altura > 0 ? i.altura : null,
            quantidade: Number(i.quantidade) > 0 ? Number(i.quantidade) : 1,
            preco_venda_unidade: Math.max(Number(i.preco_venda_unidade) || 0, 0),
            acabamento: vazioParaNulo(i.acabamento),
            ordem,
          })),
          { onConflict: "id" },
        );
        if (error) throw error;
      }

      setCab(c);
      setSalvoComo(JSON.stringify({ c, i: itens }));
      qc.invalidateQueries({ queryKey: ["parceiro-orcamento", id] });
      qc.invalidateQueries({ queryKey: ["parceiro-orcamentos"] });
      if (novoStatus && novoStatus !== registro.status) qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
      return true;
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível salvar."));
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function baixarPdf() {
    if (!cab || !painel) return;
    if (sujo && !somenteLeitura && !(await salvar())) return;
    setGerandoPdf(true);
    try {
      const logoUrl = await urlDoLogo(painel.marca.logo_path);
      const props = propsDoOrcamentoDoParceiro({
        orcamento: {
          numero: registro.numero,
          titulo: cab.titulo,
          cliente_nome: cab.cliente_nome,
          cliente_telefone: vazioParaNulo(cab.cliente_telefone),
          cliente_email: vazioParaNulo(cab.cliente_email),
          cliente_documento: vazioParaNulo(cab.cliente_documento),
          observacoes: vazioParaNulo(cab.observacoes),
          validade_dias: cab.validade_dias,
          created_at: registro.created_at,
        },
        itens,
        catalogo: porProduto,
        marca: painel.marca,
        nomeDoParceiro: painel.parceiro.nome,
        logoUrl,
      });
      const blob = await renderPDFBlob(props);
      baixarArquivo(blob, nomeDoArquivo({ numero: registro.numero, cliente_nome: cab.cliente_nome }));
      if (cab.status === "rascunho") {
        toast.success("PDF baixado", {
          description: "Mandou para o cliente? Marque para acompanhar.",
          action: { label: "Marcar como enviado", onClick: () => void salvar("enviado") },
        });
      } else {
        toast.success("PDF baixado");
      }
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível gerar o PDF."));
    } finally {
      setGerandoPdf(false);
    }
  }

  async function abrirPedido() {
    if (sujo && !(await salvar())) return;
    setPedidoAberto(true);
  }

  async function duplicar() {
    if (!cab || !painel) return;
    const { data: novo, error } = await (supabase as any)
      .from("parceiro_orcamentos")
      .insert({
        parceiro_id: painel.parceiro.id,
        titulo: cab.titulo,
        cliente_nome: cab.cliente_nome,
        cliente_telefone: vazioParaNulo(cab.cliente_telefone),
        cliente_email: vazioParaNulo(cab.cliente_email),
        cliente_documento: vazioParaNulo(cab.cliente_documento),
        observacoes: vazioParaNulo(cab.observacoes),
        validade_dias: cab.validade_dias,
        prazo: cab.prazo || PRAZO_NORMAL,
      })
      .select("id")
      .single();
    if (error || !novo) return toast.error(mensagemErro(error, "Não foi possível duplicar."));
    if (itens.length > 0) {
      const { error: erroItens } = await (supabase as any).from("parceiro_orcamento_itens").insert(
        itens.map((i, ordem) => ({
          orcamento_id: novo.id,
          produto_id: i.produto_id,
          descricao: i.descricao,
          unidade: i.unidade,
          largura: i.largura,
          altura: i.altura,
          quantidade: i.quantidade,
          preco_venda_unidade: i.preco_venda_unidade,
          acabamento: i.acabamento,
          ordem,
        })),
      );
      if (erroItens) toast.error(mensagemErro(erroItens, "A cópia foi criada sem os itens."));
    }
    qc.invalidateQueries({ queryKey: ["parceiro-orcamentos"] });
    qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
    toast.success("Cópia criada — edite à vontade");
    navigate({ to: "/parceiro/orcamentos/$id", params: { id: novo.id } });
  }

  // Subir, descer e duplicar: as mesmas ações da tabela de itens da equipe.
  // A ordem é gravada (coluna `ordem` = posição no array) no próximo salvar.
  const moverItem = (indice: number, passo: 1 | -1) =>
    setItens((lista) => {
      const destino = indice + passo;
      if (destino < 0 || destino >= lista.length) return lista;
      const nova = [...lista];
      [nova[indice], nova[destino]] = [nova[destino], nova[indice]];
      return nova;
    });
  const duplicarItem = (indice: number) =>
    setItens((lista) => {
      const copia: ItemEditavel = { ...lista[indice], id: crypto.randomUUID() };
      return [...lista.slice(0, indice + 1), copia, ...lista.slice(indice + 1)];
    });

  function escolherProduto(item: ItemEditavel, produto: ItemDoCatalogo) {
    const anterior = item.produto_id ? porProduto.get(item.produto_id) : undefined;
    const sugestaoAnterior = anterior ? precoSugerido(anterior, item.quantidade) : null;
    const precoIntocado = !item.preco_venda_unidade || item.preco_venda_unidade === sugestaoAnterior;
    const descricaoIntocada = !item.descricao.trim() || item.descricao === anterior?.nome;
    const padrao = produto.tamanhos.find((t) => t.padrao && t.largura && t.altura);
    const quantidade = produto.faixas && item.quantidade < produto.faixas[0].quantidade_minima
      ? produto.faixas[0].quantidade_minima
      : item.quantidade;
    mudarItem(item.id, {
      produto_id: produto.produto_id,
      unidade: produto.unidade,
      descricao: descricaoIntocada ? produto.nome : item.descricao,
      quantidade,
      preco_venda_unidade: precoIntocado ? (precoSugerido(produto, quantidade) ?? 0) : item.preco_venda_unidade,
      largura: produto.por_area ? (item.largura ?? padrao?.largura ?? null) : null,
      altura: produto.por_area ? (item.altura ?? padrao?.altura ?? null) : null,
    });
  }

  // O item escolhido no diálogo: um novo entra no fim da lista já com o produto;
  // um existente só troca o produto (ou vira item livre do tipo escolhido).
  const itemEmEscolha = escolhendo && escolhendo.alvo !== "novo" ? itens.find((i) => i.id === escolhendo.alvo) : undefined;
  const tipoDoItemEmEscolha: ChaveDoTipo | null = (() => {
    const p = itemEmEscolha?.produto_id ? porProduto.get(itemEmEscolha.produto_id) : undefined;
    return p ? tipoDoProduto(produtoDaEscolhaDoParceiro(p)).chave : null;
  })();
  function produtoEscolhidoNoDialogo(produto: ItemDoCatalogo) {
    if (!escolhendo) return;
    if (escolhendo.alvo === "novo") {
      const novo = itemVazio();
      setItens((lista) => [...lista, novo]);
      escolherProduto(novo, produto);
    } else if (itemEmEscolha) {
      escolherProduto(itemEmEscolha, produto);
    }
    setEscolhendo(null);
  }
  function itemLivreEscolhidoNoDialogo(tipo: TipoDeProduto) {
    if (!escolhendo) return;
    if (escolhendo.alvo === "novo") {
      setItens((lista) => [...lista, { ...itemVazio(), unidade: unidadeDoParceiroParaOTipo(tipo) }]);
    } else if (itemEmEscolha) {
      // Como na equipe: a unidade que um item livre já tinha fica; vindo de um produto, vale a do tipo.
      const unidade = unidadeDoParceiroParaOTipo({
        unidadePadrao: unidadeAoEscolherTipo(tipo, {
          unidade: itemEmEscolha.unidade,
          tinhaProduto: !!itemEmEscolha.produto_id,
          editando: true,
        }),
      });
      mudarItem(itemEmEscolha.id, {
        produto_id: null,
        unidade,
        ...(unidade === "un" ? { largura: null, altura: null } : {}),
      });
    }
    setEscolhendo(null);
  }

  return (
    <div className="space-y-5 pb-36 lg:pb-16">
      <Link to="/parceiro/orcamentos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Orçamentos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Orçamento nº {registro.numero}</p>
          <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">{cab.titulo || "Sem título"}</h1>
          <p className="text-sm text-muted-foreground">
            Para {cab.cliente_nome || "—"}
            {validade ? ` · vale até ${validade.toLocaleDateString("pt-BR")}` : ""}
          </p>
        </div>
        {somenteLeitura ? (
          <StatusChip label={status.rotulo} tone={status.tom} />
        ) : (
          <Select value={cab.status} onValueChange={(v) => void salvar(v as StatusDoOrcamento)} disabled={salvando}>
            <SelectTrigger className="w-full sm:w-52" aria-label="Situação do orçamento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ESCOLHIVEIS.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_DO_ORCAMENTO[s].rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {somenteLeitura && (
        <div className="flex gap-3 rounded-2xl border border-border bg-foreground/5 p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            Este orçamento virou o pedido{pedido ? ` nº ${pedido.pedido_numero}` : ""} e não muda mais. Precisa de outro
            igual? Use <span className="font-medium">Duplicar</span>.
          </p>
        </div>
      )}

      {/* min-w-0 nos dois filhos: sem isso a barra de passos (4 botões sem quebra) alargava a coluna
          para 428 px num celular de 390 e cortava o resumo e o botão de pedido à direita (02/11/2026). */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <BarraDePassosDoOrcamento atual={passo} estados={estados} onIr={irParaPasso} />

          {passo === 1 && (
            <section className="space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5">
              <PerguntaDoPasso passo={1} />
              <div className="grid gap-3 md:grid-cols-2">
                <Campo rotulo="Nome do cliente" id="cli-nome">
                  <Input
                    id="cli-nome"
                    value={cab.cliente_nome}
                    disabled={somenteLeitura}
                    onChange={(e) => mudarCab({ cliente_nome: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Do que se trata" id="orc-titulo">
                  <Input
                    id="orc-titulo"
                    value={cab.titulo}
                    disabled={somenteLeitura}
                    onChange={(e) => mudarCab({ titulo: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Telefone do cliente" id="cli-tel">
                  <Input
                    id="cli-tel"
                    inputMode="tel"
                    value={cab.cliente_telefone}
                    disabled={somenteLeitura}
                    onChange={(e) => mudarCab({ cliente_telefone: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="E-mail do cliente" id="cli-email">
                  <Input
                    id="cli-email"
                    type="email"
                    value={cab.cliente_email}
                    disabled={somenteLeitura}
                    onChange={(e) => mudarCab({ cliente_email: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="CPF ou CNPJ do cliente" id="cli-doc">
                  <Input
                    id="cli-doc"
                    inputMode="numeric"
                    value={cab.cliente_documento}
                    disabled={somenteLeitura}
                    onChange={(e) => mudarCab({ cliente_documento: e.target.value })}
                  />
                </Campo>
              </div>
            </section>
          )}

          {passo === 2 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <PerguntaDoPasso passo={2} />
                <span className="shrink-0 text-sm text-muted-foreground">
                  {itens.length} {itens.length === 1 ? "item" : "itens"}
                  {resumo.area > 0 ? ` · ${resumo.area.toLocaleString("pt-BR")} m²` : ""}
                </span>
              </div>

              {itens.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Adicione o primeiro item. Escolha da sua tabela para ver quanto você paga e quanto
                  ganha.
                </div>
              )}

              {itens.map((item, indice) => (
                <ItemCard
                  key={item.id}
                  indice={indice}
                  item={item}
                  produto={item.produto_id ? porProduto.get(item.produto_id) : undefined}
                  extra={item.produto_id ? extraPorProduto.get(item.produto_id) : undefined}
                  catalogo={catalogo}
                  somenteLeitura={somenteLeitura}
                  onMudar={(parcial) => mudarItem(item.id, parcial)}
                  onEscolherProduto={(p) => escolherProduto(item, p)}
                  onTrocarProduto={() => setEscolhendo({ alvo: item.id })}
                  podeSubir={indice > 0}
                  podeDescer={indice < itens.length - 1}
                  onSubir={() => moverItem(indice, -1)}
                  onDescer={() => moverItem(indice, 1)}
                  onDuplicar={() => duplicarItem(indice)}
                  onRemover={() => setARemover({ id: item.id, numero: indice + 1, descricao: item.descricao })}
                />
              ))}

              {!somenteLeitura && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setEscolhendo({ alvo: "novo" })}
                >
                  <Plus className="mr-1 h-4 w-4" /> Adicionar item
                </Button>
              )}
            </section>
          )}

          {passo === 3 && (
            <section className="space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5">
              <PerguntaDoPasso passo={3} />
              <Campo
                rotulo="Validade (dias)"
                id="orc-validade"
                ajuda={dicaCampo("/parceiro", "validade")}
              >
                <Input
                  id="orc-validade"
                  type="number"
                  min={1}
                  max={90}
                  value={cab.validade_dias}
                  disabled={somenteLeitura}
                  className="max-w-32"
                  onChange={(e) => mudarCab({ validade_dias: Number(e.target.value) })}
                />
              </Campo>
              <EscolhaDoPrazo
                prazos={prazos}
                escolhido={prazoAtual ? cab.prazo : PRAZO_NORMAL}
                baseDaTaxa={resumoBase.custo}
                desabilitado={somenteLeitura}
                onEscolher={(chave) => mudarCab({ prazo: chave })}
                ajuda="A taxa é o que você paga à gráfica, calculada sobre o valor dos produtos. O preço que você cobra do seu cliente continua sendo seu."
              />
              <Campo rotulo="Observações para o cliente" id="orc-obs">
                <Textarea
                  id="orc-obs"
                  rows={4}
                  value={cab.observacoes}
                  disabled={somenteLeitura}
                  placeholder="Prazo, forma de pagamento, o que está incluso… Sai no PDF."
                  onChange={(e) => mudarCab({ observacoes: e.target.value })}
                />
              </Campo>
            </section>
          )}

          {passo === 4 && (
            <RevisaoDoOrcamento
              cab={cab}
              itens={itens}
              porProduto={porProduto}
              pendencias={resumo.pendencias}
              validade={validade}
              prazoTexto={
                prazoAtual && prazoAtual.taxa_percentual > 0
                  ? `${prazoAtual.nome}: +${rotuloDaPorcentagem(prazoAtual.taxa_percentual)} sobre os produtos (${brl(taxaDoPrazoReais)}), pagos à gráfica`
                  : null
              }
              onEditar={irParaPasso}
              somenteLeitura={somenteLeitura}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => irParaPasso(passoAnterior(passo))}
              disabled={passo === 1}
            >
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

        <aside className="h-fit min-w-0 space-y-3 lg:sticky lg:top-28">
          <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <h2 className="font-semibold">Resumo</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Linha rotulo="Cliente paga" valor={brl(resumo.venda)} forte />
              <Linha rotulo="Você paga à gráfica" valor={brl(resumo.custo)} />
              {taxaDoPrazoReais > 0 && prazoAtual && (
                <Linha
                  rotulo={`Inclui ${prazoAtual.nome.toLowerCase()} (+${rotuloDaPorcentagem(prazoAtual.taxa_percentual)})`}
                  valor={brl(taxaDoPrazoReais)}
                />
              )}
              <div className="border-t border-border pt-2">
                <Linha
                  rotulo={resumo.lucroParcial ? "Seu ganho (parcial)" : "Seu ganho"}
                  valor={
                    resumo.lucro === null
                      ? "—"
                      : `${brl(resumo.lucro)}${resumo.margemPct !== null ? ` · ${resumo.margemPct.toLocaleString("pt-BR")}%` : ""}`
                  }
                  destaque={resumo.lucro !== null && resumo.lucro < 0 ? "negativo" : "positivo"}
                />
              </div>
            </dl>
            {resumo.lucro !== null && resumo.lucro < 0 && (
              <p className="mt-2 text-xs text-[color:var(--bex-magenta)]">
                Você está vendendo abaixo do que paga. Confira o preço dos itens.
              </p>
            )}
            {resumo.itensLivres > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {resumo.itensLivres} item(ns) livre(s) entram no PDF e não no pedido.
              </p>
            )}
            {resumo.pendencias.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-[color:var(--bex-amber)]">
                {resumo.pendencias.map((p) => (
                  <li key={p.indice} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Item {p.indice + 1}: {p.motivo}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              O que você paga é a sua tabela de parceiro. A gráfica confirma o preço no envio do pedido.
            </p>
          </section>

          <div className="grid gap-2">
            <Button onClick={baixarPdf} disabled={gerandoPdf || itens.length === 0} variant="outline">
              <Download className="mr-1 h-4 w-4" />
              {gerandoPdf ? "Gerando PDF…" : "Baixar PDF com a minha marca"}
            </Button>
            {somenteLeitura ? (
              <Button onClick={duplicar} variant="outline">
                <Copy className="mr-1 h-4 w-4" /> Duplicar
              </Button>
            ) : (
              <>
                <Button onClick={abrirPedido} disabled={salvando || resumo.itensDaGrafica === 0}>
                  <Send className="mr-1 h-4 w-4" /> Fazer pedido à gráfica
                </Button>
                <Button onClick={duplicar} variant="ghost" size="sm">
                  <Copy className="mr-1 h-4 w-4" /> Duplicar
                </Button>
              </>
            )}
          </div>
        </aside>
      </div>

      {sujo && !somenteLeitura && (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 mx-auto hidden max-w-md items-center justify-between gap-3 rounded-full border border-border bg-card/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur md:bottom-6 lg:flex">
          <span className="text-sm">Alterações não salvas</span>
          <Button size="sm" className="rounded-full" onClick={() => void salvar()} disabled={salvando}>
            <Save className="mr-1 h-4 w-4" />
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      )}

      <div
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 p-2 pl-4 shadow-2xl backdrop-blur md:bottom-6 lg:hidden"
        data-testid="barra-fixa-do-resumo"
      >
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Cliente paga</p>
          <p className="truncate text-base font-semibold tabular-nums">{brl(resumo.venda)}</p>
          {resumo.lucro !== null && (
            <p className="truncate text-xs text-muted-foreground">
              Seu ganho {brl(resumo.lucro)}
              {resumo.lucroParcial ? " (parcial)" : ""}
            </p>
          )}
        </div>
        {sujo && !somenteLeitura ? (
          <Button onClick={() => void salvar()} disabled={salvando}>
            <Save className="mr-1 h-4 w-4" />
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        ) : !ehUltimo(passo) ? (
          <Button onClick={() => irParaPasso(passoSeguinte(passo))}>
            {rotuloDoAvancar(passo)} <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : !somenteLeitura ? (
          <Button onClick={abrirPedido} disabled={salvando || resumo.itensDaGrafica === 0}>
            <Send className="mr-1 h-4 w-4" /> Fazer pedido
          </Button>
        ) : null}
      </div>

      <AlertDialog open={aRemover !== null} onOpenChange={(aberto) => !aberto && setARemover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar o item {aRemover?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              {aRemover?.descricao ? `"${aRemover.descricao}" sai do orçamento.` : "O item sai do orçamento."} Isso vale
              quando você salvar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (aRemover) setItens((lista) => lista.filter((i) => i.id !== aRemover.id));
                setARemover(null);
              }}
            >
              Tirar o item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* A escolha em passos da equipe: tipo em cartões, depois o produto com foto e o preço do parceiro. */}
      <DialogoDeEscolhaDoProduto
        aberto={escolhendo !== null}
        titulo={
          escolhendo?.alvo === "novo" || !itemEmEscolha
            ? "Novo item"
            : `Trocar o produto do item ${itens.indexOf(itemEmEscolha) + 1}`
        }
        catalogo={catalogo}
        extras={extras}
        carregando={catalogoQuery.isLoading}
        tipoInicial={tipoDoItemEmEscolha}
        onFechar={() => setEscolhendo(null)}
        onEscolherProduto={produtoEscolhidoNoDialogo}
        onItemLivre={itemLivreEscolhidoNoDialogo}
      />

      <PedidoDialog
        aberto={pedidoAberto}
        onOpenChange={setPedidoAberto}
        orcamentoId={id}
        resumo={resumo}
        painel={painel}
      />
    </div>
  );
}

function RevisaoDoOrcamento({
  cab,
  itens,
  porProduto,
  pendencias,
  validade,
  prazoTexto,
  onEditar,
  somenteLeitura,
}: {
  cab: Cabecalho;
  itens: ItemEditavel[];
  porProduto: Map<string, ItemDoCatalogo>;
  pendencias: { indice: number; descricao: string; motivo: string }[];
  validade: Date | null;
  prazoTexto: string | null;
  onEditar: (p: PassoDoOrcamento) => void;
  somenteLeitura: boolean;
}) {
  const semDescricao = itens
    .map((i, indice) => ({ i, indice }))
    .filter(({ i }) => !i.descricao.trim());
  const editar = (p: PassoDoOrcamento, rotulo: string) =>
    somenteLeitura ? null : (
      <Button variant="ghost" size="sm" onClick={() => onEditar(p)} aria-label={`Editar ${rotulo}`}>
        <PenLine className="mr-1 h-3.5 w-3.5" /> Editar
      </Button>
    );

  return (
    <section className="space-y-4" data-testid="revisao-do-orcamento">
      <PerguntaDoPasso passo={4} />

      {(pendencias.length > 0 || semDescricao.length > 0) && (
        <ul className="space-y-1 rounded-2xl border border-border bg-card p-4 text-sm text-[color:var(--bex-amber)]">
          {semDescricao.map(({ indice }) => (
            <li key={`sd-${indice}`} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Item {indice + 1}: falta a
              descrição.
            </li>
          ))}
          {pendencias.map((p) => (
            <li key={p.indice} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Item {p.indice + 1}: {p.motivo}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Cliente</h3>
          {editar(1, "o cliente")}
        </div>
        <p className="mt-1 font-medium">{cab.cliente_nome || "—"}</p>
        <p className="text-sm text-muted-foreground">{cab.titulo || "Sem assunto"}</p>
        <p className="text-sm text-muted-foreground">
          {[cab.cliente_telefone, cab.cliente_email, cab.cliente_documento]
            .filter((x) => x.trim())
            .join(" · ") || "Sem telefone, e-mail ou documento"}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Itens</h3>
          {editar(2, "os itens")}
        </div>
        {itens.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nenhum item ainda.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {itens.map((item, indice) => {
              const venda = vendaDoItem(
                item,
                item.produto_id ? porProduto.get(item.produto_id) : undefined,
              );
              const medida =
                item.largura && item.altura ? ` · ${item.largura} × ${item.altura} m` : "";
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {indice + 1}. {item.descricao || "(sem descrição)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantidade} {unidadeLegivel(item.unidade)}
                      {medida}
                      {item.acabamento ? ` · ${item.acabamento}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums">{brl(venda.total)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Condições</h3>
          {editar(3, "as condições")}
        </div>
        <p className="mt-1 text-sm">
          Vale {cab.validade_dias} {cab.validade_dias === 1 ? "dia" : "dias"}
          {validade ? ` (até ${validade.toLocaleDateString("pt-BR")})` : ""}.
        </p>
        {prazoTexto && <p className="mt-1 text-sm font-medium">{prazoTexto}.</p>}
        {cab.observacoes.trim() ? (
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {cab.observacoes}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Sem observações para o cliente.</p>
        )}
      </div>

      {!somenteLeitura && (
        <p className="text-sm text-muted-foreground">
          Tudo certo? Baixe o PDF para o cliente ou faça o pedido à gráfica nos botões do resumo.
        </p>
      )}
    </section>
  );
}

function ItemCard({
  indice,
  item,
  produto,
  extra,
  catalogo,
  somenteLeitura,
  onMudar,
  onEscolherProduto,
  onTrocarProduto,
  podeSubir,
  podeDescer,
  onSubir,
  onDescer,
  onDuplicar,
  onRemover,
}: {
  indice: number;
  item: ItemEditavel;
  produto: ItemDoCatalogo | undefined;
  /** Foto e descrição do produto, para a linha encolhida. */
  extra: ExtrasDoProduto | undefined;
  catalogo: ItemDoCatalogo[];
  somenteLeitura: boolean;
  onMudar: (parcial: Partial<ItemEditavel>) => void;
  onEscolherProduto: (p: ItemDoCatalogo) => void;
  /** Abre a escolha em cartões para este item ("Trocar produto"). */
  onTrocarProduto: () => void;
  podeSubir: boolean;
  podeDescer: boolean;
  onSubir: () => void;
  onDescer: () => void;
  onDuplicar: () => void;
  onRemover: () => void;
}) {
  const porArea = item.produto_id ? !!produto?.por_area : item.unidade === "m²" || item.unidade === "m2";
  const venda = vendaDoItem(item, produto);
  const custo = custoDoItem(item, produto);
  const ganho = custo.tipo === "ok" ? Math.round((venda.total - custo.total) * 100) / 100 : null;
  const un = porArea ? "m²" : unidadeLegivel(item.unidade);
  const sugestao = produto ? precoSugerido(produto, item.quantidade) : null;
  const tamanhos = (produto?.tamanhos ?? []).filter((t) => t.largura && t.altura);
  const cobradoPorArea = vendidoPorArea(item, produto);
  const numero = indice + 1;
  // As mesmas peças do item da equipe: a quantidade com o rótulo da unidade e
  // os tamanhos prontos no formato que MedidasDaPeca espera.
  const campos = camposDaUnidade(porArea ? "m2" : item.unidade);
  const tamanhosProntos: TamanhoComum[] = tamanhos.map((t) => ({
    nome: t.nome,
    largura: Number(t.largura),
    altura: Number(t.altura),
  }));

  return (
    <article className="space-y-3 rounded-2xl border border-border bg-card p-4" data-testid="item-do-parceiro">
      {/* Cabeçalho = a linha da tabela de itens da equipe: número, produto e as
          mesmas ações com os mesmos ícones (subir, descer, duplicar, tirar). */}
      <div className="flex items-start gap-2">
        <span className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold tabular-nums">
          {numero}
        </span>
        <div className="min-w-0 flex-1">
          {/* A linha encolhida da equipe: foto ou desenho do tipo, nome, "tipo · por m² · preço"
              e "Trocar produto", que reabre a escolha em cartões. */}
          <LinhaDoProduto
            produto={produto}
            produtoId={item.produto_id}
            extra={extra}
            descricao={item.descricao}
            desabilitado={somenteLeitura}
            onTrocar={onTrocarProduto}
          />
        </div>
      </div>
      {!somenteLeitura && (
        <div className="-mt-1 flex items-center justify-end gap-0.5 pl-9">
          <Dica texto="Subir na lista">
            <Button variant="ghost" size="icon" aria-label={`Subir o item ${numero}`} disabled={!podeSubir} onClick={onSubir}>
              <ArrowUp className="h-4 w-4" />
            </Button>
          </Dica>
          <Dica texto="Descer na lista">
            <Button variant="ghost" size="icon" aria-label={`Descer o item ${numero}`} disabled={!podeDescer} onClick={onDescer}>
              <ArrowDown className="h-4 w-4" />
            </Button>
          </Dica>
          <Dica texto="Duplicar item">
            <Button variant="ghost" size="icon" aria-label={`Duplicar o item ${numero}`} onClick={onDuplicar}>
              <Copy className="h-4 w-4" />
            </Button>
          </Dica>
          <Dica texto="Tirar o item">
            <Button variant="ghost" size="icon" aria-label={`Tirar o item ${numero}`} onClick={onRemover}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </Dica>
        </div>
      )}

      <div className="grid gap-3 pl-9 md:grid-cols-2">
        <div className="md:col-span-2 empty:hidden">
          <EscolhaDeMaterial
            nomeAtual={produto?.nome}
            catalogo={catalogo}
            desabilitado={somenteLeitura}
            preco={(p) => {
              const g = precoDaGrafica(p, item.quantidade);
              return g.tipo === "ok"
                ? `${brl(g.preco)}/${p.por_area ? "m²" : unidadeLegivel(p.unidade)}`
                : undefined;
            }}
            onEscolher={onEscolherProduto}
          />
        </div>
        <Campo rotulo="Descrição" id={`desc-${item.id}`} className="md:col-span-2">
          <Input
            id={`desc-${item.id}`}
            value={item.descricao}
            disabled={somenteLeitura}
            placeholder={item.produto_id ? "Ex.: Adesivo vinil fosco" : "Ex.: Instalação na fachada"}
            onChange={(e) => onMudar({ descricao: e.target.value })}
          />
        </Campo>

        {!item.produto_id && (
          <Campo rotulo="Vendido por" id={`un-${item.id}`} ajuda={dicaCampo("/parceiro", "cobrar por")}>
            <Select value={porArea ? "m²" : "un"} disabled={somenteLeitura} onValueChange={(v) => onMudar({ unidade: v, ...(v === "un" ? { largura: null, altura: null } : {}) })}>
              <SelectTrigger id={`un-${item.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="un">Unidade</SelectItem>
                <SelectItem value="m²">Metro quadrado (m²)</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        )}

        {porArea && (
          <div className="space-y-2 md:col-span-2">
            {/* O mesmo bloco de medidas da equipe: desenho da peça, largura (X) ×
                altura (Y) na unidade escolhida (mm, cm, m), a conta de área e os
                tamanhos prontos do produto. O pedido segue em metros. */}
            <MedidasDaPeca
              idPrefixo={`item-${item.id}`}
              largura={item.largura != null ? String(item.largura) : ""}
              altura={item.altura != null ? String(item.altura) : ""}
              quantidade={Number(item.quantidade) || 1}
              areaMinima={cobradoPorArea && produto?.area_minima ? Number(produto.area_minima) : null}
              tamanhos={tamanhosProntos}
              origemDosTamanhos="produto"
              desabilitado={somenteLeitura}
              onMudar={(campo, m) => onMudar({ [campo]: numeroOuNulo(m) } as Partial<ItemEditavel>)}
              onAplicarTamanho={(t) => onMudar({ largura: t.largura, altura: t.altura })}
            />
            {produto?.faixa_por_area && cobradoPorArea ? (
              <p className="text-xs text-muted-foreground">
                Do que passar de {produto.faixa_por_area.acimaDeM2.toLocaleString("pt-BR")} m² na
                linha, o m² sai por {brl(produto.faixa_por_area.precoAcima)}.
              </p>
            ) : null}
          </div>
        )}

        {/* Quantidade com − e + e o rótulo da unidade, como no item da equipe. */}
        <QuantidadeDoItem
          id={`item-${item.id}-qtd`}
          valor={String(item.quantidade)}
          campos={campos}
          desabilitado={somenteLeitura}
          onMudar={(v) => onMudar({ quantidade: Number(String(v).replace(",", ".")) || 0 })}
        />
        <TabelaDeDegraus
          degraus={degrausDoProduto(produto, item.quantidade)}
          unidade={un}
          desabilitado={somenteLeitura}
          onEscolher={(q) => onMudar({ quantidade: q })}
        />
        {/* Acabamento: o mesmo campo da equipe (cartões quando houver opções, texto livre sempre). */}
        <AcabamentoDoItem
          id={`item-${item.id}-acabamento`}
          valor={item.acabamento ?? ""}
          opcoes={[]}
          desabilitado={somenteLeitura}
          onMudar={(v) => onMudar({ acabamento: v })}
        />
        {/* Preço na mesma grade da equipe: Preço/m² ou Valor un., e o Total do item só de leitura.
            A diferença do parceiro é o bloco de ganho logo abaixo. */}
        <Campo rotulo={porArea ? "Preço/m²" : "Valor un."} id={`preco-${item.id}`} ajuda={dicaCampo("/parceiro", "seu preco")}>
          <Input
            id={`preco-${item.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="tabular-nums"
            value={item.preco_venda_unidade}
            disabled={somenteLeitura}
            onChange={(e) => onMudar({ preco_venda_unidade: Number(e.target.value) })}
          />
          {sugestao !== null && !somenteLeitura && Number(item.preco_venda_unidade) !== sugestao && (
            <button
              type="button"
              onClick={() => onMudar({ preco_venda_unidade: sugestao })}
              className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              usar preço de balcão ({brl(sugestao)})
            </button>
          )}
        </Campo>
        <Campo rotulo="Total do item" id={`total-${item.id}`}>
          <Input id={`total-${item.id}`} readOnly value={brl(venda.total)} className="bg-muted/40 font-semibold tabular-nums" />
        </Campo>
      </div>

      <div className="ml-9 grid grid-cols-3 gap-2 rounded-xl bg-foreground/5 p-3 text-center text-xs">
        <div>
          <p className="flex items-center justify-center gap-1 text-muted-foreground">
            Cliente paga
            <DicaIcone texto={dicaCampo("/parceiro", "seu preco")} rotulo="Cliente paga" />
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{brl(venda.total)}</p>
        </div>
        <div>
          <p className="flex items-center justify-center gap-1 text-muted-foreground">
            Você paga
            <DicaIcone texto={dicaCampo("/parceiro", "voce paga")} rotulo="Você paga" />
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {custo.tipo === "ok" ? brl(custo.total) : custo.tipo === "livre" ? "—" : "?"}
          </p>
        </div>
        <div>
          <p className="flex items-center justify-center gap-1 text-muted-foreground">
            Seu ganho
            <DicaIcone texto={dicaCampo("/parceiro", "seu ganho")} rotulo="Seu ganho" />
          </p>
          <p
            className={cn(
              "mt-0.5 text-sm font-semibold tabular-nums",
              ganho !== null && ganho < 0 ? "text-[color:var(--bex-magenta)]" : "text-[color:var(--bex-cyan)]",
            )}
          >
            {ganho !== null ? brl(ganho) : custo.tipo === "livre" ? brl(venda.total) : "?"}
          </p>
        </div>
      </div>

      {custo.tipo === "pendente" && (
        <p className="ml-9 flex items-center gap-1.5 text-xs text-[color:var(--bex-amber)]">
          <AlertTriangle className="h-3.5 w-3.5" /> {custo.motivo}
        </p>
      )}
      {custo.tipo === "ok" && custo.proxima && (
        <p className="ml-9 text-xs text-muted-foreground">
          A partir de {custo.proxima.quantidade_minima} {un} você paga {brl(custo.proxima.preco_parceiro)} por {un}.
        </p>
      )}
      {custo.tipo === "livre" && (
        <p className="ml-9 flex items-center gap-1.5 text-xs text-muted-foreground">
          <PenLine className="h-3.5 w-3.5" /> Serviço seu: entra no PDF e não vira pedido.
        </p>
      )}
    </article>
  );
}

function Campo({
  rotulo,
  id,
  className,
  ajuda,
  children,
}: {
  rotulo: string;
  id: string;
  className?: string;
  /** quando não vier, procura pelo próprio rótulo no dicionário de dicas */
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1 text-xs text-muted-foreground">
        {rotulo}
        <DicaIcone texto={ajuda ?? dicaCampo("/parceiro", rotulo)} rotulo={rotulo} />
      </Label>
      {children}
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  forte,
  destaque,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
  destaque?: "positivo" | "negativo";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          forte && "text-lg font-bold",
          destaque === "positivo" && "font-semibold text-[color:var(--bex-cyan)]",
          destaque === "negativo" && "font-semibold text-[color:var(--bex-magenta)]",
        )}
      >
        {valor}
      </dd>
    </div>
  );
}
