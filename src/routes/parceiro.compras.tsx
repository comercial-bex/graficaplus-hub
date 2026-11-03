/* eslint-disable @typescript-eslint/no-explicit-any */
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CheckCircle2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { carregarCatalogo, carregarPainel, CHAVE_CATALOGO, CHAVE_PAINEL } from "@/lib/parceiro-api";
import { brl, custoDoItem, type ItemDoCatalogo, type ItemDoOrcamento } from "@/domain/parceiros/preco";
import {
  PAGAMENTOS_DA_VENDA_DIRETA,
  situacaoDoPagamento,
  valoresDoPagamento,
  type PagamentoDaVendaDireta,
} from "@/domain/parceiros/venda-direta";
import { DialogoDeEscolhaDoProduto, LinhaDoProduto } from "@/components/parceiro/escolha-de-produto-do-parceiro";
import { StatusChip } from "@/components/bex/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/parceiro/compras")({
  head: () => ({
    meta: [
      { title: "Compras diretas — Bex Print Parceiro" },
      { name: "description", content: "Compre direto da Bex Print com o seu preço de parceiro." },
      { property: "og:title", content: "Compras diretas — Bex Print Parceiro" },
      { property: "og:description", content: "Compre direto da Bex Print com o seu preço de parceiro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComprasDoParceiro,
});

type Linha = ItemDoOrcamento & { chave: string };

type Compra = {
  id: string;
  numero: number;
  created_at: string;
  pagamento_modelo: string | null;
  os_id: string | null;
  status: string;
  itens: { quantidade: number }[];
  total_pedido: number | null;
};

function ComprasDoParceiro() {
  const qc = useQueryClient();
  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  const { data: catalogo = [], isLoading: carregandoCatalogo } = useQuery({
    queryKey: CHAVE_CATALOGO,
    queryFn: carregarCatalogo,
    staleTime: 5 * 60_000,
  });
  const porId = useMemo(() => new Map(catalogo.map((p) => [p.produto_id, p])), [catalogo]);

  const [itens, setItens] = useState<Linha[]>([]);
  const [escolhendo, setEscolhendo] = useState(false);
  const [pagamento, setPagamento] = useState<PagamentoDaVendaDireta | null>(null);
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<{ numero: number; total: number; agora: number; os: boolean } | null>(null);

  const { data: compras = [] } = useQuery({
    queryKey: ["parceiro-compras"],
    queryFn: async (): Promise<Compra[]> => {
      const { data, error } = await (supabase as any)
        .from("parceiro_orcamentos")
        .select(
          "id, numero, created_at, pagamento_modelo, os_id, status, itens:parceiro_orcamento_itens(quantidade), total_pedido",
        )
        .eq("venda_direta", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Compra[];
    },
  });

  const custos = itens.map((i) => custoDoItem(i, porId.get(i.produto_id ?? "")));
  const pendente = custos.find((c) => c.tipo !== "ok");
  const total = custos.reduce((s, c) => s + (c.tipo === "ok" ? c.total : 0), 0);
  const valores = pagamento ? valoresDoPagamento(total, pagamento) : null;
  const semAtendente = painel ? !painel.parceiro.tem_atendente : false;

  function adicionar(p: ItemDoCatalogo) {
    setItens((v) => [
      ...v,
      {
        chave: crypto.randomUUID(),
        produto_id: p.produto_id,
        descricao: p.nome,
        unidade: p.unidade,
        largura: p.por_area ? 1 : null,
        altura: p.por_area ? 1 : null,
        quantidade: 1,
        preco_venda_unidade: 0,
      },
    ]);
    setEscolhendo(false);
  }

  function mudar(chave: string, campo: keyof ItemDoOrcamento, valor: number | null) {
    setItens((v) => v.map((i) => (i.chave === chave ? { ...i, [campo]: valor } : i)));
  }

  async function confirmar() {
    if (!pagamento) return;
    setEnviando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("parceiro_venda_direta", {
        p_itens: itens.map(({ produto_id, descricao, unidade, largura, altura, quantidade }) => ({
          produto_id,
          descricao,
          unidade,
          largura,
          altura,
          quantidade,
        })),
        p_pagamento: pagamento,
        p_observacao: observacao,
      });
      if (error) throw error;
      setFeito({ numero: data.numero, total: Number(data.total), agora: Number(data.sinal), os: !!data.os_id });
      setItens([]);
      setPagamento(null);
      setObservacao("");
      qc.invalidateQueries({ queryKey: ["parceiro-compras"] });
      qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
    } catch (e) {
      toast.error(mensagemErro(e, "A compra não foi registrada. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  if (!painel) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">Comprar <DicaIcone texto={dicaCampo("/parceiro", "comprar_da_grafica")} rotulo="Comprar" /></h1>
        <p className="text-sm text-muted-foreground">
          Compra direta com a Bex Print, pelo seu preço de parceiro. Sem cliente e sem PDF: vai direto para a produção.
        </p>
      </div>

      {feito && (
        <div className="flex items-start gap-3 rounded-2xl border border-status-cyan/40 bg-status-cyan/10 p-4" data-testid="compra-feita">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-cyan" />
          <div className="text-sm">
            <p className="font-semibold">Compra nº {feito.numero} registrada · {brl(feito.total)}</p>
            <p className="text-muted-foreground">
              Pague agora {brl(feito.agora)}.{" "}
              {feito.os ? "A ordem de produção já foi aberta." : "A gráfica vai abrir a ordem de produção assim que conferir."}
            </p>
          </div>
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Nova compra</h2>
          <Button onClick={() => setEscolhendo(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" /> Novo item
          </Button>
        </div>

        {itens.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Toque em “Novo item” e escolha o produto.
          </p>
        ) : (
          <ul className="space-y-3">
            {itens.map((i, idx) => {
              const produto = porId.get(i.produto_id ?? "");
              const c = custos[idx];
              return (
                <li key={i.chave} className="space-y-2 rounded-xl border border-border p-3">
                  <LinhaDoProduto produto={produto} produtoId={i.produto_id} descricao={i.descricao} onTrocar={() => setEscolhendo(true)} />
                  <div className="flex flex-wrap items-end gap-3">
                    {produto?.por_area && (
                      <>
                        <Campo rotulo="Largura (m)" valor={i.largura} onChange={(v) => mudar(i.chave, "largura", v)} />
                        <Campo rotulo="Altura (m)" valor={i.altura} onChange={(v) => mudar(i.chave, "altura", v)} />
                      </>
                    )}
                    <Campo rotulo="Quantidade" valor={i.quantidade} onChange={(v) => mudar(i.chave, "quantidade", v ?? 1)} />
                    <div className="ml-auto text-right">
                      {c.tipo === "ok" ? (
                        <p className="font-semibold tabular-nums">{brl(c.total)}</p>
                      ) : (
                        <p className="text-sm text-[color:var(--bex-amber)]">{c.tipo === "pendente" ? c.motivo : ""}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover item"
                      onClick={() => setItens((v) => v.filter((x) => x.chave !== i.chave))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {itens.length > 0 && (
          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <p className="mb-2 flex items-center gap-1 text-sm font-medium">Forma de pagamento <DicaIcone texto={dicaCampo("/parceiro", "pagamento")} rotulo="Forma de pagamento" /></p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Forma de pagamento">
                {PAGAMENTOS_DA_VENDA_DIRETA.map((p) => {
                  const v = valoresDoPagamento(total, p.chave);
                  return (
                    <button
                      key={p.chave}
                      type="button"
                      role="radio"
                      aria-checked={pagamento === p.chave}
                      onClick={() => setPagamento(p.chave)}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-colors",
                        pagamento === p.chave ? "border-primary bg-primary/10" : "border-border hover:bg-foreground/5",
                      )}
                    >
                      <p className="font-semibold">{p.rotulo}</p>
                      <p className="text-xs text-muted-foreground">{p.detalhe}</p>
                      <p className="mt-1 text-sm tabular-nums">
                        Agora {brl(v.agora)}
                        {v.restante > 0 && <span className="text-muted-foreground"> · na entrega {brl(v.restante)}</span>}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obs-compra" className="flex items-center gap-1">Observação (opcional) <DicaIcone texto={dicaCampo("/parceiro", "observacao_compra")} rotulo="Observação" /></Label>
              <Textarea id="obs-compra" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
            </div>
            {semAtendente && (
              <p className="text-sm text-[color:var(--bex-amber)]">
                Seu cadastro ainda não tem atendente na gráfica. Peça para a equipe indicar quem vai te atender.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-xl font-bold tabular-nums">{brl(total)}</p>
                {valores && <p className="text-sm">Pagar agora: <strong className="tabular-nums">{brl(valores.agora)}</strong></p>}
              </div>
              <Button onClick={confirmar} disabled={!pagamento || !!pendente || enviando || semAtendente}>
                <ShoppingCart className="mr-1 h-4 w-4" />
                {enviando ? "Enviando…" : "Confirmar compra"}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Minhas compras</h2>
        {compras.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma compra direta ainda.</p>
        ) : (
          <ul className="space-y-2">
            {compras.map((c) => (
              <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    Compra nº {c.numero}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("pt-BR")} · {c.itens.length} {c.itens.length === 1 ? "item" : "itens"} ·{" "}
                    {c.os_id ? "Em produção" : "Aguardando a gráfica"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="font-semibold tabular-nums">{brl(c.total_pedido ?? 0)}</span>
                  <StatusChip
                    label={situacaoDoPagamento(c.pagamento_modelo)}
                    tone={c.pagamento_modelo === "a_vista" ? "cyan" : "amber"}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DialogoDeEscolhaDoProduto
        aberto={escolhendo}
        titulo="Novo item"
        catalogo={catalogo}
        carregando={carregandoCatalogo}
        onFechar={() => setEscolhendo(false)}
        onEscolherProduto={adicionar}
        onItemLivre={() => toast.info("Na compra direta, escolha um produto da tabela.")}
      />
    </div>
  );
}

function Campo({ rotulo, valor, onChange }: { rotulo: string; valor: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        className="w-28"
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </div>
  );
}
