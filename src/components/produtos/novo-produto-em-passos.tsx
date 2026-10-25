/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda fora de types.ts */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Droplets,
  Flag,
  Gem,
  Gift,
  Layers,
  Package,
  Square,
  Sticker,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { Carregando } from "@/components/bex/Carregando";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { registrarUso, useUsoDoAssistente } from "@/lib/uso-de-telas";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { FAMILIAS } from "@/lib/produtos-catalogo";
import {
  custoDoMaterial,
  materiaisDaVariante,
  maquinasSugeridas,
  passosDoTipo,
  pendenciaDoPasso,
  PASSOS_DO_PRODUTO,
  precoQueCumpreAMargem,
  produtoDasRespostas,
  RESPOSTAS_VAZIAS,
  skuSugerido,
  TIPOS_DE_BASE,
  type MaterialDoEstoque,
  type NumeroDoPasso,
  type RespostasDoProduto,
  type TipoDeBase,
  type VarianteDeProduto,
} from "@/domain/catalogo/novo-produto-em-passos";

const ICONES: Record<string, LucideIcon> = {
  Sticker,
  Layers,
  Flag,
  Square,
  Gem,
  Gift,
  Wrench,
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const UNIDADES_DE_VENDA = [
  { chave: "m2", titulo: "Por m²", detalhe: "cobra pela área" },
  { chave: "un", titulo: "Por peça", detalhe: "preço fechado" },
  { chave: "m", titulo: "Por metro", detalhe: "linear" },
  { chave: "hora", titulo: "Por hora", detalhe: "serviço" },
] as const;

/**
 * Novo produto em passos. Cada passo é uma pergunta com a resposta em cartões; escolher avança
 * sozinho nos passos de um clique só. O fim cria o produto e a ficha do material principal.
 */
export function NovoProdutoEmPassos({
  aberto,
  onFechar,
  onAbrirCadastroCompleto,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAbrirCadastroCompleto: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [r, setR] = useState<RespostasDoProduto>(RESPOSTAS_VAZIAS);
  const [passo, setPasso] = useState<NumeroDoPasso>(1);
  const [criando, setCriando] = useState(false);
  useUsoDoAssistente("novo-produto", aberto, passo);

  useEffect(() => {
    if (aberto) {
      setR(RESPOSTAS_VAZIAS);
      setPasso(1);
    }
  }, [aberto]);

  const maquinas = useQuery({
    queryKey: ["maquinas-para-produto"],
    enabled: aberto,
    queryFn: async () => {
      const { data } = await supabase
        .from("maquinas")
        .select("id, nome")
        .eq("ativa", true)
        .order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const { nivelDeVisao } = useAuth();
  const materiais = useQuery({
    queryKey: ["materiais-do-novo-produto", nivelDeVisao],
    enabled: aberto,
    queryFn: async () => {
      // O custo do material só se lê pela view do nível de quem olha: a tabela crua recusa a consulta.
      const { data, error } = await fromFinancialView("materiais", nivelDeVisao)
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as MaterialDoEstoque[];
    },
  });
  const skus = useQuery({
    queryKey: ["skus-existentes"],
    enabled: aberto,
    queryFn: async () => {
      const { data } = await supabase.from("produtos").select("sku");
      return ((data ?? []) as { sku: string | null }[]).map((p) => p.sku);
    },
  });

  const passos = passosDoTipo(r.tipo);
  const indice = passos.indexOf(passo);
  const ultimo = passo === 6;
  const pendencia = pendenciaDoPasso(passo, r);

  const doMaterial = useMemo(
    () => (r.tipo ? materiaisDaVariante(materiais.data ?? [], r.tipo, r.variante) : []),
    [materiais.data, r.tipo, r.variante],
  );
  const maquinasDoTipo = useMemo(
    () => (r.tipo ? maquinasSugeridas(maquinas.data ?? [], r.tipo, r.variante) : []),
    [maquinas.data, r.tipo, r.variante],
  );

  function seguir() {
    const prox = passos[indice + 1];
    if (prox) setPasso(prox);
  }
  function voltar() {
    const ant = passos[indice - 1];
    if (ant) setPasso(ant);
  }

  function escolherTipo(t: TipoDeBase) {
    setR({ ...RESPOSTAS_VAZIAS, tipo: t, unidade: t.unidade });
    setPasso(2);
  }

  function escolherVariante(v: VarianteDeProduto) {
    if (!r.tipo) return;
    const maq = maquinasSugeridas(maquinas.data ?? [], r.tipo, v)[0];
    setR({
      ...r,
      variante: v,
      material: null,
      nome: v.nome,
      familia: v.familia,
      sku: skuSugerido(r.tipo, v, skus.data ?? []),
      areaMinima: v.areaMinimaM2 ? String(v.areaMinimaM2) : "",
      maquinaId: maq?.id ?? "",
      custo: "",
      preco: "",
    });
    setPasso(r.tipo.usaMaterial ? 3 : 4);
  }

  function escolherMaterial(m: MaterialDoEstoque | null) {
    const custo = custoDoMaterial(m);
    const margem = Number(r.margemMinima) || 0;
    setR({
      ...r,
      material: m,
      custo: custo > 0 ? String(custo) : "",
      preco: custo > 0 ? String(precoQueCumpreAMargem(custo, margem)) : "",
    });
    setPasso(4);
  }

  function mudarCusto(custo: string) {
    const c = Number(custo.replace(",", "."));
    const sugerido = c > 0 ? precoQueCumpreAMargem(c, Number(r.margemMinima) || 0) : 0;
    setR({ ...r, custo, preco: sugerido > 0 ? String(sugerido) : r.preco });
  }

  async function criar() {
    if (!r.tipo) return;
    setCriando(true);
    try {
      const { data, error } = await (supabase as any)
        .from("produtos")
        .insert(produtoDasRespostas(r))
        .select("id")
        .single();
      if (error) throw error;
      if (r.material) {
        const { error: erroFicha } = await (supabase as any)
          .from("produto_materiais")
          .insert({ produto_id: data.id, material_id: r.material.id, quantidade_por_unidade: 1 });
        if (erroFicha) {
          toast.error(
            `O produto foi criado, mas a ficha do material não entrou (${mensagemErro(erroFicha)}). Abra o produto e ligue o material.`,
          );
        }
      }
      toast.success(`${r.nome.trim()} cadastrado`);
      registrarUso("novo-produto", "concluiu");
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setCriando(false);
    }
  }

  const custoNum = Number(r.custo.replace(",", ".")) || 0;
  const precoNum = Number(r.preco.replace(",", ".")) || 0;
  const margem = precoNum > 0 ? ((precoNum - custoNum) / precoNum) * 100 : null;
  const piso = precoQueCumpreAMargem(custoNum, Number(r.margemMinima) || 0);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent
        className="max-h-[92vh] max-w-3xl overflow-y-auto"
        data-testid="novo-produto-em-passos"
      >
        <DialogHeader>
          <DialogTitle>Novo produto em passos</DialogTitle>
          <DialogDescription>
            {PASSOS_DO_PRODUTO[passo - 1].pergunta} Escolher um cartão já leva ao próximo passo.
          </DialogDescription>
        </DialogHeader>

        <Stepper value={indice + 1} onValueChange={(n) => setPasso(passos[n - 1] ?? passo)}>
          <StepperNav>
            {passos.map((n, i) => (
              <StepperItem
                key={n}
                step={i + 1}
                className="relative flex-1 items-start"
                disabled={i > indice}
              >
                <StepperTrigger className="flex flex-col items-start gap-1">
                  <StepperIndicator>{i + 1}</StepperIndicator>
                  <StepperTitle className="text-xs">{PASSOS_DO_PRODUTO[n - 1].titulo}</StepperTitle>
                </StepperTrigger>
                {i < passos.length - 1 && (
                  <StepperSeparator className="absolute inset-x-0 left-[calc(50%+0.875rem)] top-3 m-0 group-data-[orientation=horizontal]/stepper-nav:w-[calc(100%-2rem+0.225rem)] group-data-[orientation=horizontal]/stepper-nav:flex-none group-data-[state=completed]/step:bg-primary" />
                )}
              </StepperItem>
            ))}
          </StepperNav>
        </Stepper>

        <div className="min-h-56 space-y-3 pt-2">
          {passo === 1 && (
            <GradeDeCartoes rotulo="Tipo de produto">
              {TIPOS_DE_BASE.map((t) => {
                const Icone = ICONES[t.icone] ?? Package;
                return (
                  <CartaoDeEscolha
                    key={t.chave}
                    ativo={r.tipo?.chave === t.chave}
                    titulo={t.titulo}
                    detalhe={t.detalhe}
                    icone={<Icone className="h-8 w-8 text-muted-foreground" />}
                    onEscolher={() => escolherTipo(t)}
                  />
                );
              })}
              <CartaoDeEscolha
                ativo={false}
                titulo="Insumo"
                detalhe="tinta, bobina, filamento: vai em Materiais"
                icone={<Droplets className="h-8 w-8 text-muted-foreground" />}
                onEscolher={() => {
                  onFechar();
                  navigate({ to: "/materiais", search: { novo: 1 } });
                }}
              />
              <CartaoDeEscolha
                ativo={false}
                titulo="Outro"
                detalhe="cadastro completo, campo a campo"
                icone={<Package className="h-8 w-8 text-muted-foreground" />}
                onEscolher={() => {
                  onFechar();
                  onAbrirCadastroCompleto();
                }}
              />
            </GradeDeCartoes>
          )}

          {passo === 2 && r.tipo && (
            <GradeDeCartoes rotulo={`Tipo de ${r.tipo.titulo.toLowerCase()}`}>
              {r.tipo.variantes.map((v) => (
                <CartaoDeEscolha
                  key={v.chave}
                  ativo={r.variante?.chave === v.chave}
                  titulo={v.titulo}
                  detalhe={v.detalhe}
                  onEscolher={() => escolherVariante(v)}
                />
              ))}
            </GradeDeCartoes>
          )}

          {passo === 3 && (
            <div className="space-y-3">
              {materiais.isLoading && <Carregando linhas={2} />}
              {doMaterial.length > 0 ? (
                <GradeDeCartoes rotulo="Material do estoque">
                  {doMaterial.map((m) => (
                    <CartaoDeEscolha
                      key={m.id}
                      ativo={r.material?.id === m.id}
                      titulo={m.nome}
                      detalhe={[
                        custoDoMaterial(m) > 0
                          ? `${brl(custoDoMaterial(m))}/${m.unidade}`
                          : "sem custo",
                        m.fornecedor,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      destaque={`${Number(m.estoque ?? 0).toLocaleString("pt-BR")} em estoque`}
                      onEscolher={() => escolherMaterial(m)}
                    />
                  ))}
                </GradeDeCartoes>
              ) : (
                !materiais.isLoading && (
                  <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    Nenhum material do estoque combina com essa escolha. Dá para seguir sem
                    material: o produto nasce sem ficha e o painel avisa para ligar depois.
                  </p>
                )
              )}
              <div className="space-y-1.5">
                <Label htmlFor="np-marca">Marca (opcional)</Label>
                <Input
                  id="np-marca"
                  value={r.marca}
                  placeholder="Ex.: Avery, 3M, fornecedor da bobina"
                  onChange={(e) => setR({ ...r, marca: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => escolherMaterial(null)}
              >
                Seguir sem escolher material
              </Button>
            </div>
          )}

          {passo === 4 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Máquina</Label>
                {maquinas.isLoading ? (
                  <Carregando linhas={1} />
                ) : (
                  <GradeDeCartoes rotulo="Máquina">
                    {(maquinasDoTipo.length > 0 ? maquinasDoTipo : (maquinas.data ?? [])).map(
                      (m) => (
                        <CartaoDeEscolha
                          key={m.id}
                          ativo={r.maquinaId === m.id}
                          titulo={m.nome}
                          onEscolher={() =>
                            setR({ ...r, maquinaId: r.maquinaId === m.id ? "" : m.id })
                          }
                        />
                      ),
                    )}
                  </GradeDeCartoes>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Como é cobrado</Label>
                <GradeDeCartoes rotulo="Unidade de venda">
                  {UNIDADES_DE_VENDA.map((u) => (
                    <CartaoDeEscolha
                      key={u.chave}
                      ativo={r.unidade === u.chave}
                      titulo={u.titulo}
                      detalhe={u.detalhe}
                      onEscolher={() => setR({ ...r, unidade: u.chave })}
                    />
                  ))}
                </GradeDeCartoes>
              </div>
              {r.unidade === "m2" && (
                <div className="max-w-xs space-y-1.5">
                  <Label htmlFor="np-area">Área mínima cobrada, em m² (opcional)</Label>
                  <Input
                    id="np-area"
                    inputMode="decimal"
                    value={r.areaMinima}
                    placeholder="Ex.: 1"
                    onChange={(e) => setR({ ...r, areaMinima: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {passo === 5 && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="np-custo">
                    Custo por {r.unidade === "m2" ? "m²" : r.unidade}
                  </Label>
                  <Input
                    id="np-custo"
                    inputMode="decimal"
                    value={r.custo}
                    onChange={(e) => mudarCusto(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-margem">Margem mínima (%)</Label>
                  <Input
                    id="np-margem"
                    inputMode="decimal"
                    value={r.margemMinima}
                    onChange={(e) => setR({ ...r, margemMinima: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-preco">Preço de balcão</Label>
                  <Input
                    id="np-preco"
                    inputMode="decimal"
                    value={r.preco}
                    onChange={(e) => setR({ ...r, preco: e.target.value })}
                  />
                </div>
              </div>
              {custoNum > 0 && (
                <p className="text-sm text-muted-foreground">
                  Para cumprir a margem de {Number(r.margemMinima) || 0}% o preço mínimo é{" "}
                  {brl(piso)}.{" "}
                  {piso > 0 && precoNum !== piso && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setR({ ...r, preco: String(piso) })}
                    >
                      Usar {brl(piso)}
                    </button>
                  )}
                </p>
              )}
              {margem !== null && (
                <p
                  className={
                    margem < (Number(r.margemMinima) || 0) ? "text-sm text-destructive" : "text-sm"
                  }
                >
                  Margem do preço: {margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                  {margem < (Number(r.margemMinima) || 0) && " — abaixo do mínimo"}
                </p>
              )}
              {custoNum <= 0 && (
                <p className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Sem custo o produto entra, mas o painel cobra o número até alguém preencher.
                </p>
              )}
            </div>
          )}

          {passo === 6 && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="np-nome">Nome *</Label>
                  <Input
                    id="np-nome"
                    value={r.nome}
                    onChange={(e) => setR({ ...r, nome: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-sku">Código (SKU) *</Label>
                  <Input
                    id="np-sku"
                    className="font-mono"
                    value={r.sku}
                    onChange={(e) => setR({ ...r, sku: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-familia">Família</Label>
                <Input
                  id="np-familia"
                  list="np-familias"
                  value={r.familia}
                  onChange={(e) => setR({ ...r, familia: e.target.value })}
                />
                <datalist id="np-familias">
                  {FAMILIAS.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <dl className="grid gap-x-4 gap-y-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
                <Linha rotulo="Tipo" valor={`${r.tipo?.titulo} · ${r.variante?.titulo}`} />
                <Linha rotulo="Material" valor={r.material?.nome ?? "sem material (sem ficha)"} />
                <Linha
                  rotulo="Máquina"
                  valor={
                    (maquinas.data ?? []).find((m) => m.id === r.maquinaId)?.nome ?? "não definida"
                  }
                />
                <Linha
                  rotulo="Cobrado"
                  valor={UNIDADES_DE_VENDA.find((u) => u.chave === r.unidade)?.titulo ?? r.unidade}
                />
                <Linha rotulo="Custo" valor={custoNum > 0 ? brl(custoNum) : "não informado"} />
                <Linha
                  rotulo="Preço de balcão"
                  valor={precoNum > 0 ? brl(precoNum) : "não informado"}
                />
              </dl>
            </div>
          )}
        </div>

        {pendencia && passo !== 1 && passo !== 2 && (
          <p className="text-sm text-destructive">{pendencia}</p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={voltar} disabled={indice <= 0 || criando}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          {ultimo ? (
            <Button type="button" onClick={criar} disabled={!!pendencia || criando}>
              <Check className="h-4 w-4" /> {criando ? "Criando…" : "Criar produto"}
            </Button>
          ) : (
            passo !== 1 &&
            passo !== 2 &&
            passo !== 3 && (
              <Button type="button" onClick={seguir} disabled={!!pendencia}>
                Avançar <ArrowRight className="h-4 w-4" />
              </Button>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right font-medium">{valor}</dd>
    </div>
  );
}
