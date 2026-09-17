/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
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
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { SeletorDeProduto } from "./seletor-de-produto";
import { PedidoDialog } from "./pedido-dialog";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { baixarArquivo, renderPDFBlob } from "@/lib/pdf/generate";
import {
  carregarCatalogo,
  carregarPainel,
  CHAVE_CATALOGO,
  CHAVE_PAINEL,
  urlDoLogo,
} from "@/lib/parceiro-api";
import {
  brl,
  custoDoItem,
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
  const { data: catalogo = [] } = useQuery({ queryKey: CHAVE_CATALOGO, queryFn: carregarCatalogo, staleTime: 5 * 60_000 });
  const servidor = useQuery({
    queryKey: ["parceiro-orcamento", id],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [cab, its] = await Promise.all([
        (supabase as any)
          .from("parceiro_orcamentos")
          .select(
            "id, numero, titulo, cliente_nome, cliente_telefone, cliente_email, cliente_documento, observacoes, validade_dias, status, pedido_orcamento_id, created_at",
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
  const [salvoComo, setSalvoComo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [pedidoAberto, setPedidoAberto] = useState(false);

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
  const resumo = useMemo(() => resumoDoOrcamento(itens, porProduto), [itens, porProduto]);

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

  return (
    <div className="space-y-5 pb-16">
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5">
            <h2 className="font-semibold">Cliente e orçamento</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <Campo rotulo="Nome do cliente" id="cli-nome">
                <Input id="cli-nome" value={cab.cliente_nome} disabled={somenteLeitura} onChange={(e) => mudarCab({ cliente_nome: e.target.value })} />
              </Campo>
              <Campo rotulo="Do que se trata" id="orc-titulo">
                <Input id="orc-titulo" value={cab.titulo} disabled={somenteLeitura} onChange={(e) => mudarCab({ titulo: e.target.value })} />
              </Campo>
              <Campo rotulo="Telefone do cliente" id="cli-tel">
                <Input id="cli-tel" inputMode="tel" value={cab.cliente_telefone} disabled={somenteLeitura} onChange={(e) => mudarCab({ cliente_telefone: e.target.value })} />
              </Campo>
              <Campo rotulo="E-mail do cliente" id="cli-email">
                <Input id="cli-email" type="email" value={cab.cliente_email} disabled={somenteLeitura} onChange={(e) => mudarCab({ cliente_email: e.target.value })} />
              </Campo>
              <Campo rotulo="CPF ou CNPJ do cliente" id="cli-doc">
                <Input id="cli-doc" inputMode="numeric" value={cab.cliente_documento} disabled={somenteLeitura} onChange={(e) => mudarCab({ cliente_documento: e.target.value })} />
              </Campo>
              <Campo rotulo="Validade (dias)" id="orc-validade" ajuda={dicaCampo("/parceiro", "validade")}>
                <Input
                  id="orc-validade"
                  type="number"
                  min={1}
                  max={90}
                  value={cab.validade_dias}
                  disabled={somenteLeitura}
                  onChange={(e) => mudarCab({ validade_dias: Number(e.target.value) })}
                />
              </Campo>
            </div>
            <Campo rotulo="Observações para o cliente" id="orc-obs">
              <Textarea
                id="orc-obs"
                rows={3}
                value={cab.observacoes}
                disabled={somenteLeitura}
                placeholder="Prazo, forma de pagamento, o que está incluso… Sai no PDF."
                onChange={(e) => mudarCab({ observacoes: e.target.value })}
              />
            </Campo>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Itens</h2>
              <span className="text-sm text-muted-foreground">
                {itens.length} {itens.length === 1 ? "item" : "itens"}
                {resumo.area > 0 ? ` · ${resumo.area.toLocaleString("pt-BR")} m²` : ""}
              </span>
            </div>

            {itens.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Adicione o primeiro item. Escolha da sua tabela para ver quanto você paga e quanto ganha.
              </div>
            )}

            {itens.map((item, indice) => (
              <ItemCard
                key={item.id}
                indice={indice}
                item={item}
                produto={item.produto_id ? porProduto.get(item.produto_id) : undefined}
                catalogo={catalogo}
                somenteLeitura={somenteLeitura}
                onMudar={(parcial) => mudarItem(item.id, parcial)}
                onEscolherProduto={(p) => escolherProduto(item, p)}
                onRemover={() => setItens((lista) => lista.filter((i) => i.id !== item.id))}
              />
            ))}

            {!somenteLeitura && (
              <Button variant="outline" className="w-full" onClick={() => setItens((lista) => [...lista, itemVazio()])}>
                <Plus className="mr-1 h-4 w-4" /> Adicionar item
              </Button>
            )}
          </section>
        </div>

        <aside className="h-fit space-y-3 lg:sticky lg:top-28">
          <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <h2 className="font-semibold">Resumo</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Linha rotulo="Cliente paga" valor={brl(resumo.venda)} forte />
              <Linha rotulo="Você paga à gráfica" valor={brl(resumo.custo)} />
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
            <p className="mt-3 text-[11px] text-muted-foreground">
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
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-border bg-card/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur md:bottom-6">
          <span className="text-sm">Alterações não salvas</span>
          <Button size="sm" className="rounded-full" onClick={() => void salvar()} disabled={salvando}>
            <Save className="mr-1 h-4 w-4" />
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      )}

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

function ItemCard({
  indice,
  item,
  produto,
  catalogo,
  somenteLeitura,
  onMudar,
  onEscolherProduto,
  onRemover,
}: {
  indice: number;
  item: ItemEditavel;
  produto: ItemDoCatalogo | undefined;
  catalogo: ItemDoCatalogo[];
  somenteLeitura: boolean;
  onMudar: (parcial: Partial<ItemEditavel>) => void;
  onEscolherProduto: (p: ItemDoCatalogo) => void;
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

  return (
    <article className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <span className="mt-2.5 w-6 shrink-0 text-center text-xs font-semibold text-muted-foreground">{indice + 1}</span>
        <div className="min-w-0 flex-1">
          <SeletorDeProduto
            catalogo={catalogo}
            produtoId={item.produto_id}
            desabilitado={somenteLeitura}
            onEscolher={onEscolherProduto}
            onItemLivre={() => onMudar({ produto_id: null })}
          />
        </div>
        {!somenteLeitura && (
          <Button variant="ghost" size="icon" onClick={onRemover} aria-label={`Remover item ${indice + 1}`} title="Remover item">
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </div>

      <div className="grid gap-3 pl-8 md:grid-cols-2">
        <Campo rotulo="Descrição no PDF" id={`desc-${item.id}`} className="md:col-span-2">
          <Input
            id={`desc-${item.id}`}
            value={item.descricao}
            disabled={somenteLeitura}
            placeholder={item.produto_id ? "" : "Ex.: Instalação na fachada"}
            onChange={(e) => onMudar({ descricao: e.target.value })}
          />
        </Campo>

        {!item.produto_id && (
          <Campo rotulo="Cobrar por" id={`un-${item.id}`} ajuda={dicaCampo("/parceiro", "cobrar por")}>
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
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <Campo rotulo="Largura (m)" id={`larg-${item.id}`}>
                <Input
                  id={`larg-${item.id}`}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={item.largura ?? ""}
                  disabled={somenteLeitura}
                  onChange={(e) => onMudar({ largura: numeroOuNulo(e.target.value) })}
                />
              </Campo>
              <span className="pb-2.5 text-muted-foreground">×</span>
              <Campo rotulo="Altura (m)" id={`alt-${item.id}`}>
                <Input
                  id={`alt-${item.id}`}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={item.altura ?? ""}
                  disabled={somenteLeitura}
                  onChange={(e) => onMudar({ altura: numeroOuNulo(e.target.value) })}
                />
              </Campo>
            </div>
            {tamanhos.length > 0 && !somenteLeitura && (
              <div className="flex flex-wrap gap-1.5">
                {tamanhos.map((t) => (
                  <button
                    key={t.nome}
                    type="button"
                    onClick={() => onMudar({ largura: t.largura, altura: t.altura })}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  >
                    {t.nome}
                  </button>
                ))}
              </div>
            )}
            {produto?.area_minima && cobradoPorArea ? (
              <p className="text-xs text-muted-foreground">
                Peças menores que {Number(produto.area_minima).toLocaleString("pt-BR")} m² são cobradas como{" "}
                {Number(produto.area_minima).toLocaleString("pt-BR")} m².
              </p>
            ) : null}
          </div>
        )}

        <Campo rotulo={porArea ? "Quantidade de peças" : `Quantidade (${un})`} id={`qtd-${item.id}`}>
          <Input
            id={`qtd-${item.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={item.quantidade}
            disabled={somenteLeitura}
            onChange={(e) => onMudar({ quantidade: Number(e.target.value) })}
          />
        </Campo>
        <Campo rotulo="Acabamento" id={`acab-${item.id}`}>
          <Input
            id={`acab-${item.id}`}
            value={item.acabamento ?? ""}
            disabled={somenteLeitura}
            placeholder="Ex.: ilhós, refile, bastão"
            onChange={(e) => onMudar({ acabamento: e.target.value })}
          />
        </Campo>
        <Campo rotulo={`Seu preço para o cliente (por ${un})`} id={`preco-${item.id}`} ajuda={dicaCampo("/parceiro", "seu preco")} className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`preco-${item.id}`}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="w-40"
              value={item.preco_venda_unidade}
              disabled={somenteLeitura}
              onChange={(e) => onMudar({ preco_venda_unidade: Number(e.target.value) })}
            />
            {sugestao !== null && !somenteLeitura && Number(item.preco_venda_unidade) !== sugestao && (
              <button
                type="button"
                onClick={() => onMudar({ preco_venda_unidade: sugestao })}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                usar preço de balcão ({brl(sugestao)})
              </button>
            )}
          </div>
        </Campo>
      </div>

      <div className="ml-8 grid grid-cols-3 gap-2 rounded-xl bg-foreground/5 p-3 text-center text-xs">
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
        <p className="ml-8 flex items-center gap-1.5 text-xs text-[color:var(--bex-amber)]">
          <AlertTriangle className="h-3.5 w-3.5" /> {custo.motivo}
        </p>
      )}
      {custo.tipo === "ok" && custo.proxima && (
        <p className="ml-8 text-xs text-muted-foreground">
          A partir de {custo.proxima.quantidade_minima} {un} você paga {brl(custo.proxima.preco_parceiro)} por {un}.
        </p>
      )}
      {custo.tipo === "livre" && (
        <p className="ml-8 flex items-center gap-1.5 text-xs text-muted-foreground">
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
