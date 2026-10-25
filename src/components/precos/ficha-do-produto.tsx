import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dica } from "@/components/bex/Dica";
import { FotoDoProduto } from "@/components/produtos/foto-do-produto";
import { categoriaLabel } from "@/lib/produtos-catalogo";
import {
  fatiasDoCusto,
  fichaDoProduto,
  lucroPorUnidade,
  margemSobreVenda,
  PARTES_DO_CUSTO,
  posicaoNoMercado,
  sugestoesDePreco,
  type Marcador,
  type Sugestao,
} from "@/domain/precos/tabela-de-precos";
import { BarraDeComparacao, LegendaDaBarra } from "./barra-de-comparacao";
import { ConcorrentesDoProduto } from "./concorrentes-do-produto";
import { IconeDoProduto } from "./icone-do-produto";
import { useAcabamentos } from "@/components/acabamentos/gerenciador-de-acabamentos";
import { margemDoAcabamento, rotuloDaBase, rotuloDoProcesso, unidadeDaBase } from "@/domain/acabamentos/acabamentos";
import { brl, pct, sinal, type Linha, type TipoDePreco } from "./tipos";

const COR_DA_FATIA = { material: "bg-primary", maquina: "bg-chart-2", maoDeObra: "bg-chart-4", indireto: "bg-muted-foreground" } as const;

export function marcadoresDaLinha(l: Linha, piso: number | null): Marcador[] {
  const m: Marcador[] = [];
  if (l.custoBase != null) m.push({ chave: "custo", rotulo: "Custo", valor: l.custoBase, tipo: "custo" });
  if (piso != null) m.push({ chave: "piso", rotulo: "Piso da margem", valor: piso, tipo: "piso" });
  if (l.venda != null) m.push({ chave: "nos", rotulo: "Venda final", valor: l.venda, tipo: "nos" });
  if (l.parceiro) m.push({ chave: "parceiro", rotulo: "Parceiro", valor: l.parceiro.valor, tipo: "parceiro" });
  for (const c of l.concorrentes) m.push({ chave: c.id, rotulo: `${c.concorrente} (${c.tipo_preco === "final" ? "final" : "terceirizado"})`, valor: c.preco, tipo: "concorrente" });
  return m;
}

export function pisoDaMargem(custo: number | null, margemMinima: number | null): number | null {
  if (custo == null || custo <= 0 || margemMinima == null || margemMinima <= 0 || margemMinima >= 100) return null;
  return Math.round((custo / (1 - margemMinima / 100)) * 100) / 100;
}

export function FichaDoProduto({
  linha,
  nomeDoNivel,
  podeEditarFoto,
  maoDeObraEstimada = false,
  aoFechar,
}: {
  linha: Linha | null;
  /** a mão de obra do custo cheio ainda é estimativa (média nacional), não o salário real */
  maoDeObraEstimada?: boolean;
  nomeDoNivel: string | null;
  podeEditarFoto: boolean;
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const acabamentos = useAcabamentos();
  const [foto, setFoto] = useState("");
  useEffect(() => setFoto(linha?.produto.imagem_url ?? ""), [linha?.produto.id, linha?.produto.imagem_url]);

  const salvarFoto = useMutation({
    mutationFn: async () => {
      if (!linha) return;
      const { error } = await (supabase as any).from("produtos").update({ imagem_url: foto.trim() || null }).eq("id", linha.produto.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tabela-precos", "produtos"] });
      toast.success("Foto do produto salva");
    },
    onError: (e) => toast.error(mensagemErro(e, "Só administrador e gerência trocam a foto do produto.")),
  });

  if (!linha) return <Sheet open={false} onOpenChange={aoFechar}><SheetContent /></Sheet>;
  const { produto: p } = linha;
  const ficha = fichaDoProduto({
    tipo: p.tipo,
    categoria: p.categoria,
    temReceita: linha.receita.length > 0,
    minutos: p.tempo_producao_min,
    temMaquina: !!p.maquina_padrao_id,
    composicao: linha.composicao,
  });
  const fatias = fatiasDoCusto(linha.composicao);
  const margemMin = p.margem_minima;
  const piso = pisoDaMargem(linha.custoBase, margemMin);
  const custoCad = linha.custo;
  const menorDoTipo = (t: TipoDePreco) => {
    const v = linha.concorrentes.filter((c) => c.tipo_preco === t).map((c) => c.preco);
    return v.length ? Math.min(...v) : null;
  };
  const sugParceiro = sugestoesDePreco({ custo: linha.custoBase, margemMinimaPct: margemMin, menorConcorrente: menorDoTipo("parceiro") });
  const sugFinal = menorDoTipo("final") != null ? sugestoesDePreco({ custo: linha.custoBase, margemMinimaPct: margemMin, menorConcorrente: menorDoTipo("final") }) : [];
  const mercadoFinal = posicaoNoMercado(linha.venda, linha.concorrentes.filter((c) => c.tipo_preco === "final").map((c) => c.preco));
  const mercadoParceiro = posicaoNoMercado(linha.parceiro?.valor ?? null, linha.concorrentes.filter((c) => c.tipo_preco === "parceiro").map((c) => c.preco));

  return (
    <Sheet open onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="text-left">
          <div className="flex items-start gap-3">
            <IconeDoProduto imagem={foto || null} categoria={p.categoria} nome={p.nome} tamanho="lg" />
            <div className="min-w-0">
              <SheetTitle className="leading-tight">{p.nome}</SheetTitle>
              <SheetDescription>
                {p.categoria ? categoriaLabel(p.categoria) : "Sem categoria"} · vendido por {p.unidade}
              </SheetDescription>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <SeloDaFicha nivel={ficha.nivel} />
                {!p.ativo && <Badge variant="outline">só comparação</Badge>}
              </div>
            </div>
          </div>
        </SheetHeader>

        <Tabs defaultValue="custo" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="custo">Custo</TabsTrigger>
            <TabsTrigger value="preco">Preço</TabsTrigger>
            <TabsTrigger value="mercado">Mercado</TabsTrigger>
            <TabsTrigger value="foto">Foto</TabsTrigger>
          </TabsList>

          <TabsContent value="custo" className="space-y-4">
            {linha.provisorio && (
              <p className="rounded-md border border-warning/50 bg-warning/15 p-2 text-xs" role="note">
                Custo provisório: o custo e o preço de balcão deste produto foram copiados de um produto parecido até o custo real por {p.unidade} ser informado. Para fechar: receita (matéria-prima), tempo e máquina no cadastro do produto.
              </p>
            )}
            <section className="rounded-lg border border-border bg-card p-3">
              <h3 className="text-sm font-semibold">Do que o produto é feito</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Todo produto precisa de <strong>matéria-prima</strong> (a receita), <strong>máquina</strong>, <strong>mão de obra</strong> e o <strong>rateio indireto</strong>.
                O custo cheio é a soma das quatro.
              </p>
              {fatias.length > 0 ? (
                <>
                  <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Composição do custo">
                    {fatias.map((f) => (
                      <div key={f.chave} className={COR_DA_FATIA[f.chave]} style={{ width: `${f.pct}%` }} />
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {PARTES_DO_CUSTO.map((parte) => {
                      const f = fatias.find((x) => x.chave === parte.chave);
                      return (
                        <li key={parte.chave} className="flex items-center justify-between gap-2">
                          <Dica texto={parte.ajuda} lado="left">
                            <span className="inline-flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${COR_DA_FATIA[parte.chave]}`} /> {parte.rotulo}
                            </span>
                          </Dica>
                          <span className="font-mono">
                            {brl(linha.composicao?.[parte.chave] ?? 0)}
                            <span className="ml-2 text-xs text-muted-foreground">{f ? pct(f.pct) : "—"}</span>
                          </span>
                        </li>
                      );
                    })}
                    <li className="flex items-center justify-between gap-2 border-t border-border pt-1.5 font-semibold">
                      <span>Custo cheio</span>
                      <span className="font-mono">{brl(linha.cheio)}</span>
                    </li>
                  </ul>
                </>
              ) : (
                <p className="mt-3 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Sem composição calculada. O custo desta tabela é o digitado no cadastro ({brl(custoCad)}).
                </p>
              )}
            </section>

            {linha.receita.length > 0 && (
              <section className="rounded-lg border border-border bg-card p-3">
                <h3 className="text-sm font-semibold">Matéria-prima da receita (por {p.unidade})</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {linha.receita.map((r) => (
                    <li key={r.material} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{r.material}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {r.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} {r.unidade} × {brl(r.custoUnitario)} ={" "}
                        <strong className="text-foreground">{brl(r.quantidade * r.custoUnitario)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(() => {
              const ids = new Set((acabamentos.data?.links ?? []).filter((l) => l.produto_id === p.id).map((l) => l.acabamento_id));
              const aceitos = (acabamentos.data?.lista ?? []).filter((a) => ids.has(a.id));
              return (
                <section className="rounded-lg border border-border bg-card p-3">
                  <h3 className="text-sm font-semibold">Acabamentos que este produto aceita</h3>
                  {aceitos.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">Nenhum ligado. Em Produtos › Acabamentos dá para ligar (laser, CNC, recorte, manual).</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {aceitos.map((a) => {
                        const c = acabamentos.data?.custos.get(a.id);
                        const m = margemDoAcabamento(a.preco_venda, c?.custo_total ?? null);
                        return (
                          <li key={a.id} className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              {a.nome}
                              <span className="block text-xs text-muted-foreground">
                                {rotuloDoProcesso(a.processo)} · {rotuloDaBase(a.base).toLowerCase()}
                                {c && c.faltas.length > 0 ? ` · falta: ${c.faltas.join("; ")}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-right font-mono text-xs">
                              custo {brl(c?.custo_total ?? null)}/{unidadeDaBase(a.base)}
                              <span className="block">preço {a.preco_venda != null ? brl(a.preco_venda) : "—"}{m != null ? ` · ${pct(m)}` : ""}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })()}

            <section className="rounded-lg border border-border bg-card p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                {ficha.faltas.length === 0 ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />}
                Regra do negócio
              </h3>
              {ficha.faltas.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Ficha completa: matéria-prima, tempo, máquina e mão de obra definidos.</p>
              ) : (
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                  {ficha.faltas.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {maoDeObraEstimada && linha.cheio != null && (
                <p className="mt-2 rounded-md bg-warning/15 p-2 text-xs">
                  A mão de obra deste custo é uma estimativa (R$ 10,65/h, média nacional de impressor), não o salário real. Troque em Custos de produção.
                </p>
              )}
              {custoCad != null && linha.cheio != null && Math.abs(linha.cheio - custoCad) > 0.05 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  O cadastro guarda {brl(custoCad)} de custo, mas o custo cheio é {brl(linha.cheio)} ({sinal(((linha.cheio - custoCad) / custoCad) * 100)}). A margem real sai pelo cheio.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Para corrigir: cadastro do produto → receita (materiais), tempo e máquina padrão.</p>
            </section>
          </TabsContent>

          <TabsContent value="preco" className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <CaixaDePreco titulo="Venda final" preco={linha.venda} custoCadastro={custoCad} custoCheio={linha.cheio} minimo={margemMin} />
              <CaixaDePreco
                titulo={`Parceiro${nomeDoNivel ? ` (${nomeDoNivel})` : ""}`}
                preco={linha.parceiro?.valor ?? null}
                nota={linha.parceiro?.origem === "nivel" ? "pelo nível" : linha.parceiro ? "preço do cadastro" : undefined}
                custoCadastro={custoCad}
                custoCheio={linha.cheio}
                minimo={margemMin}
              />
            </div>
            {linha.promocao && <p className="rounded-md bg-primary/10 p-2 text-xs">Promoção do programa de parceiros: {linha.promocao.titulo} — {brl(linha.promocao.preco)}.</p>}
            <section className="rounded-lg border border-border bg-card p-3">
              <h3 className="text-sm font-semibold">Régua de preços</h3>
              <BarraDeComparacao marcadores={marcadoresDaLinha(linha, piso)} className="mt-2" />
              <LegendaDaBarra />
            </section>
          </TabsContent>

          <TabsContent value="mercado" className="space-y-4">
            <section className="rounded-lg border border-border bg-card p-3 text-sm">
              <h3 className="font-semibold">Nós × mercado</h3>
              {!mercadoFinal && !mercadoParceiro && <p className="mt-1 text-muted-foreground">Sem concorrente anotado.</p>}
              {mercadoParceiro && <p className="mt-1">Parceiro: <strong>{sinal(mercadoParceiro.contraOMenorPct)}</strong> vs menor · {sinal(mercadoParceiro.contraAMediaPct)} vs média</p>}
              {mercadoFinal && <p className="mt-1">Final: <strong>{sinal(mercadoFinal.contraOMenorPct)}</strong> vs menor · {sinal(mercadoFinal.contraAMediaPct)} vs média</p>}
            </section>
            <SugestoesDoProduto titulo="Para o parceiro" itens={sugParceiro} />
            <SugestoesDoProduto titulo="Para o cliente final" itens={sugFinal} />
            <ConcorrentesDoProduto produto={p} atuais={linha.concorrentes} />
          </TabsContent>

          <TabsContent value="foto" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sem foto, a tabela mostra o ícone da categoria. Com a foto anexada ela aparece aqui, na tabela e no painel do parceiro.
            </p>
            {podeEditarFoto ? (
              <>
                <FotoDoProduto valor={foto} onChange={setFoto} />
                <Button onClick={() => salvarFoto.mutate()} disabled={salvarFoto.isPending || foto === (p.imagem_url ?? "")}>
                  <Save className="mr-1.5 h-4 w-4" /> Salvar foto
                </Button>
              </>
            ) : (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">Só administrador e gerência trocam a foto do produto.</p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

export function SeloDaFicha({ nivel }: { nivel: "completa" | "parcial" | "sem_ficha" }) {
  const dados = {
    completa: { texto: "Ficha completa", classe: "border-success/40 bg-success/10 text-success" },
    parcial: { texto: "Ficha incompleta", classe: "border-warning/50 bg-warning/15 text-foreground" },
    sem_ficha: { texto: "Sem ficha técnica", classe: "border-destructive/40 bg-destructive/10 text-destructive" },
  }[nivel];
  return <Badge variant="outline" className={`h-5 px-1.5 text-[11px] font-medium ${dados.classe}`}>{dados.texto}</Badge>;
}

function CaixaDePreco({
  titulo,
  preco,
  nota,
  custoCadastro,
  custoCheio,
  minimo,
}: {
  titulo: string;
  preco: number | null;
  nota?: string;
  custoCadastro: number | null;
  custoCheio: number | null;
  minimo: number | null;
}) {
  const mCad = margemSobreVenda(preco, custoCadastro);
  const mCheio = margemSobreVenda(preco, custoCheio);
  const ruim = (m: number | null) => m != null && minimo != null && m < minimo;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="font-mono text-xl font-semibold">{preco != null ? brl(preco) : <span className="text-sm text-muted-foreground">por faixa</span>}</div>
      {nota && <div className="text-[11px] text-muted-foreground">{nota}</div>}
      <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">Lucro · margem</div>
      <dl className="mt-0.5 space-y-0.5 text-xs">
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Custo cadastro</dt><dd className="font-mono">{brl(lucroPorUnidade(preco, custoCadastro))} · <span className={ruim(mCad) ? "text-destructive" : ""}>{pct(mCad)}</span></dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Custo cheio</dt><dd className="font-mono">{brl(lucroPorUnidade(preco, custoCheio))} · <span className={ruim(mCheio) ? "text-destructive" : ""}>{pct(mCheio)}</span></dd></div>
        {minimo != null && <div className="flex justify-between gap-2 text-muted-foreground"><dt>Margem mínima</dt><dd>{pct(minimo)}</dd></div>}
      </dl>
    </div>
  );
}

function SugestoesDoProduto({ titulo, itens }: { titulo: string; itens: Sugestao[] }) {
  if (itens.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="text-sm font-semibold">Sugestões — {titulo}</h3>
      <ul className="mt-1.5 space-y-2 text-sm">
        {itens.map((s) => (
          <li key={s.chave}>
            <span className={s.abaixoDoMinimo ? "text-destructive" : undefined}>
              {s.rotulo}: <strong className="font-mono">{brl(s.preco)}</strong> <span className="text-muted-foreground">({pct(s.margem)})</span>
            </span>
            <div className="text-xs text-muted-foreground">{s.conta}{s.abaixoDoMinimo ? " ATENÇÃO: abaixo da margem mínima." : ""}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
