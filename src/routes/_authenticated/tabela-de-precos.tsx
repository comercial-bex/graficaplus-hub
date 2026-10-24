import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { mensagemErro } from "@/lib/erros";
import { dicaCampo, dicaTela } from "@/lib/dicas";
import { Dica, DicaIcone } from "@/components/bex/Dica";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  lucroPorUnidade,
  margemSobreVenda,
  MAX_CONCORRENTES,
  posicaoNoMercado,
  precoDoParceiro,
  sugestoesDePreco,
  type Sugestao,
} from "@/domain/precos/tabela-de-precos";

export const Route = createFileRoute("/_authenticated/tabela-de-precos")({
  head: () => ({ meta: [{ title: "Tabela de preços — BEX PRINT OS" }] }),
  component: TabelaDePrecosPage,
});

type Produto = {
  id: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  custo_medio: number | null;
  preco_base: number | null;
  preco_parceiro: number | null;
  ativo: boolean;
  margem_minima: number | null;
};
type TipoDePreco = "final" | "parceiro";
type Concorrente = {
  id: string;
  produto_id: string;
  concorrente: string;
  preco: number;
  tipo_preco: TipoDePreco;
  fonte: string | null;
  coletado_em: string;
};
const ROTULO_DO_TIPO: Record<TipoDePreco, string> = { final: "venda final", parceiro: "terceirizado" };

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const sinal = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function TabelaDePrecosPage() {
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Produto | null>(null);

  const produtos = useQuery({
    queryKey: ["tabela-precos", "produtos"],
    queryFn: async (): Promise<Produto[]> => {
      const { data, error } = await fromFinancialView("produtos", "financeiro")
        .select("id, nome, categoria, unidade, ativo, custo_medio, margem_minima, preco_base, preco_parceiro")
        .order("ativo", { ascending: false })
        .order("categoria")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Produto[];
    },
  });
  const niveis = useQuery({
    queryKey: ["tabela-precos", "nivel-de-entrada"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("parceiro_niveis")
        .select("nome, desconto_pct, ordem")
        .order("ordem");
      if (error) throw error;
      // O nível de entrada é o de menor ordem (são 4 linhas; não precisa de limit).
      return ((data ?? [])[0] ?? null) as { nome: string; desconto_pct: number } | null;
    },
  });
  const concorrentes = useQuery({
    queryKey: ["tabela-precos", "concorrentes"],
    queryFn: async (): Promise<Concorrente[]> => {
      const { data, error } = await (supabase as any)
        .from("produto_concorrentes")
        .select("id, produto_id, concorrente, preco, tipo_preco, fonte, coletado_em")
        .order("concorrente");
      if (error) throw error;
      return (data ?? []).map((c: Concorrente) => ({ ...c, preco: Number(c.preco) }));
    },
  });

  const porProduto = useMemo(() => {
    const mapa = new Map<string, Concorrente[]>();
    for (const c of concorrentes.data ?? []) mapa.set(c.produto_id, [...(mapa.get(c.produto_id) ?? []), c]);
    return mapa;
  }, [concorrentes.data]);

  const descontoDoNivel = niveis.data ? Number(niveis.data.desconto_pct) : null;
  const termo = busca.trim().toLowerCase();
  const linhas = (produtos.data ?? []).filter((p) => !termo || `${p.nome} ${p.categoria ?? ""}`.toLowerCase().includes(termo));
  const erro = produtos.error ?? niveis.error ?? concorrentes.error;

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/tabela-de-precos")}
        breadcrumb="Preço e custo"
        title="Tabela de preços"
        description="Custo, venda final, venda para parceiro, lucro e o preço de 2 a 3 concorrentes, produto a produto. Tudo por unidade de venda (m², unidade…)."
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou categoria" className="pl-9" />
      </div>

      {erro && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          Não consegui carregar a tabela: {mensagemErro(erro)}
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <Cab campo="custo" className="text-right">Custo</Cab>
                <Cab campo="venda_final" className="text-right">Venda final</Cab>
                <Cab campo="lucro" className="text-right">Lucro (final)</Cab>
                <Cab campo="venda_parceiro" className="text-right">
                  Venda parceiro{niveis.data ? ` (${niveis.data.nome})` : ""}
                </Cab>
                <Cab campo="lucro" className="text-right">Lucro (parceiro)</Cab>
                <Cab campo="concorrentes">Concorrentes</Cab>
                <Cab campo="nos_x_mercado" className="text-right">Nós × mercado</Cab>
                <Cab campo="sugestao">Sugestão</Cab>
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtos.isLoading && (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Carregando…</TableCell></TableRow>
              )}
              {!produtos.isLoading && !erro && linhas.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Nenhum produto encontrado.</TableCell></TableRow>
              )}
              {linhas.map((p) => {
                const custo = p.custo_medio != null ? Number(p.custo_medio) : null;
                const venda = p.preco_base != null ? Number(p.preco_base) : null;
                const parceiro = precoDoParceiro({
                  precoParceiro: p.preco_parceiro != null ? Number(p.preco_parceiro) : null,
                  precoBase: venda,
                  descontoDoNivelPct: descontoDoNivel,
                });
                const lucroF = lucroPorUnidade(venda, custo);
                const lucroP = lucroPorUnidade(parceiro?.valor ?? null, custo);
                const margemF = margemSobreVenda(venda, custo);
                const margemP = margemSobreVenda(parceiro?.valor ?? null, custo);
                const lista = porProduto.get(p.id) ?? [];
                // Compara só o que é do mesmo tipo: terceirizado deles × parceiro nosso; final × final.
                const mercadoFinal = posicaoNoMercado(venda, lista.filter((c) => c.tipo_preco === "final").map((c) => c.preco));
                const mercadoParceiro = posicaoNoMercado(
                  parceiro?.valor ?? null,
                  lista.filter((c) => c.tipo_preco === "parceiro").map((c) => c.preco),
                );
                const margemMinima = p.margem_minima != null ? Number(p.margem_minima) : null;
                const menorDoTipo = (t: TipoDePreco) => {
                  const v = lista.filter((c) => c.tipo_preco === t).map((c) => c.preco);
                  return v.length ? Math.min(...v) : null;
                };
                const sugParceiro = sugestoesDePreco({ custo, margemMinimaPct: margemMinima, menorConcorrente: menorDoTipo("parceiro") });
                const sugFinal = menorDoTipo("final") != null
                  ? sugestoesDePreco({ custo, margemMinimaPct: margemMinima, menorConcorrente: menorDoTipo("final") })
                  : [];
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.categoria ?? "sem categoria"} · por {p.unidade}
                        {!p.ativo && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">só comparação</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{brl(custo)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {venda != null ? brl(venda) : <span className="text-xs text-muted-foreground">por faixa</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      <Lucro valor={lucroF} margem={margemF} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {parceiro ? (
                        <>
                          {brl(parceiro.valor)}
                          {parceiro.origem === "nivel" && <div className="text-[10px] text-muted-foreground">pelo nível</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      <Lucro valor={lucroP} margem={margemP} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {lista.map((c) => (
                          <Badge key={c.id} variant="outline" className="font-normal">
                            {c.concorrente} ({ROTULO_DO_TIPO[c.tipo_preco]}): <span className="ml-1 font-mono">{brl(c.preco)}</span>
                          </Badge>
                        ))}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditando(p)}>
                          <Pencil className="mr-1 h-3 w-3" aria-hidden />
                          {lista.length ? "Editar" : "Anotar"}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {!mercadoFinal && !mercadoParceiro && <span className="text-muted-foreground">sem concorrente</span>}
                      {mercadoParceiro && (
                        <div>
                          <span className="text-muted-foreground">parceiro: </span>
                          <strong>{sinal(mercadoParceiro.contraOMenorPct)}</strong>
                          <span className="text-muted-foreground"> vs menor · {sinal(mercadoParceiro.contraAMediaPct)} vs média</span>
                        </div>
                      )}
                      {mercadoFinal && (
                        <div>
                          <span className="text-muted-foreground">final: </span>
                          <strong>{sinal(mercadoFinal.contraOMenorPct)}</strong>
                          <span className="text-muted-foreground"> vs menor · {sinal(mercadoFinal.contraAMediaPct)} vs média</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="min-w-44 text-xs">
                      <Sugestoes titulo="parceiro" itens={sugParceiro} />
                      <Sugestoes titulo="final" itens={sugFinal} />
                      {sugParceiro.length === 0 && sugFinal.length === 0 && <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Cada preço de concorrente é marcado como "venda final" ou "terceirizado" e só se compara com o nosso do mesmo tipo (a tabela do Concorrente 1 é de terceirizados). Margem é sobre a venda (lucro ÷ preço). Venda parceiro é o preço do cadastro do produto; sem ele, o do nível de
        entrada do programa. Produto vendido por faixa de quantidade mostra "por faixa" — o preço de cada faixa está em
        Produtos.
      </p>

      <ConcorrentesDialog produto={editando} atuais={editando ? porProduto.get(editando.id) ?? [] : []} onClose={() => setEditando(null)} />
    </div>
  );
}

function Cab({ campo, className, children }: { campo: string; className?: string; children: React.ReactNode }) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        {children}
        <DicaIcone texto={dicaCampo("/tabela-de-precos", campo)} rotulo={campo.replace(/_/g, " ")} className="h-4 w-4" />
      </span>
    </TableHead>
  );
}

/** Os caminhos de preço, cada um com a conta na dica; vermelho quando fura a margem mínima. */
function Sugestoes({ titulo, itens }: { titulo: string; itens: Sugestao[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <ul className="space-y-0.5">
        {itens.map((s) => (
          <li key={s.chave}>
            <Dica texto={s.conta + (s.abaixoDoMinimo ? " ATENÇÃO: abaixo da margem mínima do produto." : "")} lado="left">
              <span className={s.abaixoDoMinimo ? "text-destructive" : undefined}>
                {s.rotulo}: <strong className="font-mono">{brl(s.preco)}</strong>{" "}
                <span className="text-muted-foreground">({pct(s.margem)})</span>
              </span>
            </Dica>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Lucro({ valor, margem }: { valor: number | null; margem: number | null }) {
  if (valor == null) return <>—</>;
  const ruim = valor < 0;
  return (
    <span className={ruim ? "text-destructive" : undefined}>
      {brl(valor)}
      <div className="text-[10px] text-muted-foreground">{pct(margem)}</div>
    </span>
  );
}

function ConcorrentesDialog({ produto, atuais, onClose }: { produto: Produto | null; atuais: Concorrente[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState("");
  const [fonte, setFonte] = useState("");
  const [tipo, setTipo] = useState<TipoDePreco>("parceiro");

  const invalidar = () => qc.invalidateQueries({ queryKey: ["tabela-precos", "concorrentes"] });

  const adicionar = useMutation({
    mutationFn: async () => {
      if (!produto) return;
      const valor = Number(preco.replace(",", "."));
      if (!nome.trim()) throw new Error("Diga o nome do concorrente.");
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe o preço do concorrente.");
      const { error } = await (supabase as any).from("produto_concorrentes").insert({
        produto_id: produto.id,
        concorrente: nome.trim(),
        preco: valor,
        tipo_preco: tipo,
        fonte: fonte.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNome("");
      setPreco("");
      setFonte("");
      void invalidar();
      toast.success("Concorrente anotado");
    },
    onError: (e) => toast.error(/duplicate|unique/i.test(String((e as Error).message)) ? "Esse concorrente já está anotado neste produto." : mensagemErro(e)),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("produto_concorrentes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void invalidar();
      toast.success("Removido");
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const cheio = atuais.filter((c) => c.tipo_preco === tipo).length >= MAX_CONCORRENTES;

  return (
    <Dialog open={!!produto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Concorrentes — {produto?.nome}</DialogTitle>
          <DialogDescription>
            Preço praticado por unidade ({produto?.unidade}). Até {MAX_CONCORRENTES} de cada tipo (venda final ou terceirizado). Anote onde viu (site,
            orçamento, loja) para saber a data e a origem depois.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5">
          {atuais.length === 0 && <li className="text-sm text-muted-foreground">Nenhum concorrente anotado.</li>}
          {atuais.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <div className="min-w-0">
                <strong>{c.concorrente}</strong> <span className="font-mono">{brl(c.preco)}</span>{" "}
                <span className="text-xs text-muted-foreground">({ROTULO_DO_TIPO[c.tipo_preco]})</span>
                <div className="truncate text-xs text-muted-foreground">
                  {[c.fonte, new Date(c.coletado_em + "T12:00:00").toLocaleDateString("pt-BR")].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remover ${c.concorrente}`}
                onClick={() => remover.mutate(c.id)}
                disabled={remover.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>

        {cheio ? (
          <p className="text-xs text-muted-foreground">Já são {MAX_CONCORRENTES} de {ROTULO_DO_TIPO[tipo]}. Remova um para anotar outro.</p>
        ) : (
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              adicionar.mutate();
            }}
          >
            <div className="col-span-2 inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Tipo do preço">
              {(["parceiro", "final"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tipo === t}
                  onClick={() => setTipo(t)}
                  className={`flex-1 px-3 py-1.5 text-xs ${tipo === t ? "bg-primary/15 font-semibold" : "text-muted-foreground hover:bg-muted"}`}
                >
                  Preço de {ROTULO_DO_TIPO[t]}
                </button>
              ))}
            </div>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Concorrente" aria-label="Nome do concorrente" />
            <Input value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="Preço (R$)" inputMode="decimal" aria-label="Preço do concorrente" />
            <Input className="col-span-2" value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="Onde viu (opcional)" aria-label="Fonte do preço" />
            <Button type="submit" className="col-span-2" disabled={adicionar.isPending}>
              Anotar concorrente
            </Button>
          </form>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
