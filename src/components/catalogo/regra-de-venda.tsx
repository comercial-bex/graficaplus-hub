import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DicaIcone } from "@/components/bex/Dica";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { dicaCampo } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { ROTULO_DA_MODALIDADE, type Modalidade } from "@/domain/catalogo/modalidades";
import {
  ARREDONDAMENTOS,
  ROTULO_DO_ARREDONDAMENTO,
  calcularPreco,
  emReais,
  type Arredondamento,
  type RegrasDeVenda,
} from "@/domain/catalogo/preco-de-venda";
import { lerNumeroBR } from "@/domain/catalogo/importacao";
import { filtrarItens, type ItemDoCatalogo, type PrecosDoCatalogo, type SecaoDoCatalogo } from "@/domain/catalogo/itens";
import {
  lerRegras,
  previaDasRegras,
  salvarRegras,
  type PreviaDasRegras,
} from "@/components/catalogo/consultas";

type FormDaSecao = { margem: string; frete: string };
type FormDoItem = { margem: string; frete: string; fixos: Partial<Record<Modalidade, string>> };
type Form = {
  margem: string;
  frete: string;
  arredondamento: Arredondamento;
  secoes: Record<string, FormDaSecao>;
  itens: Record<string, FormDoItem>;
};

const ROTA = "/catalogos";

function paraTexto(n: number | undefined): string {
  return n == null ? "" : String(n).replace(".", ",");
}

function formDasRegras(r: RegrasDeVenda): Form {
  return {
    margem: paraTexto(r.catalogo.margem_pct),
    frete: paraTexto(r.catalogo.frete_por_peca),
    arredondamento: (ARREDONDAMENTOS as readonly number[]).includes(r.catalogo.arredondamento ?? 0)
      ? ((r.catalogo.arredondamento ?? 0) as Arredondamento)
      : 0,
    secoes: Object.fromEntries(
      Object.entries(r.secoes).map(([id, s]) => [id, { margem: paraTexto(s.margem_pct), frete: paraTexto(s.frete_por_peca) }]),
    ),
    itens: Object.fromEntries(
      Object.entries(r.itens).map(([id, i]) => [
        id,
        {
          margem: paraTexto(i.margem_pct),
          frete: paraTexto(i.frete_por_peca),
          fixos: Object.fromEntries(
            Object.entries(i.precos_fixos ?? {}).map(([m, v]) => [m, paraTexto(v as number)]),
          ) as Partial<Record<Modalidade, string>>,
        },
      ]),
    ),
  };
}

/** O formulário → a regra que vai ao banco. Campo vazio = herda; ilegível = erro com o nome do campo. */
function regrasDoForm(f: Form): { regras: RegrasDeVenda; erros: string[] } {
  const erros: string[] = [];
  const ler = (texto: string, rotulo: string, max: number): number | undefined => {
    if (!texto.trim()) return undefined;
    const v = lerNumeroBR(texto);
    if (v === "ilegivel" || v == null || v < 0 || v > max) {
      erros.push(`${rotulo}: "${texto}" não é um número válido (de 0 a ${max}).`);
      return undefined;
    }
    return v;
  };
  const regras: RegrasDeVenda = {
    catalogo: {
      margem_pct: ler(f.margem, "Margem do catálogo", 1000),
      frete_por_peca: ler(f.frete, "Frete por peça", 9999),
      arredondamento: f.arredondamento,
    },
    secoes: {},
    itens: {},
  };
  for (const [id, s] of Object.entries(f.secoes)) {
    const margem_pct = ler(s.margem, "Margem de seção", 1000);
    const frete_por_peca = ler(s.frete, "Frete de seção", 9999);
    if (margem_pct != null || frete_por_peca != null) regras.secoes[id] = { margem_pct, frete_por_peca };
  }
  for (const [id, i] of Object.entries(f.itens)) {
    const margem_pct = ler(i.margem, "Margem de item", 1000);
    const frete_por_peca = ler(i.frete, "Frete de item", 9999);
    const precos_fixos: Partial<Record<Modalidade, number>> = {};
    for (const [m, texto] of Object.entries(i.fixos) as [Modalidade, string][]) {
      const v = ler(texto ?? "", "Preço fixo", 999999);
      if (v != null && v > 0) precos_fixos[m] = v;
    }
    if (margem_pct != null || frete_por_peca != null || Object.keys(precos_fixos).length > 0) {
      regras.itens[id] = {
        margem_pct,
        frete_por_peca,
        ...(Object.keys(precos_fixos).length > 0 ? { precos_fixos } : {}),
      };
    }
  }
  // JSON sem undefined: o banco recebe só o que foi preenchido.
  return { regras: JSON.parse(JSON.stringify(regras)) as RegrasDeVenda, erros };
}

/**
 * A regra de venda do catálogo (DECISÃO DO DONO, 05/10/2026): margem sobre o
 * custo, frete por peça e arredondamento para cima, com exceção por seção e
 * por item. Só quem vê o financeiro edita — a regra É margem sobre custo.
 *
 * O preço da coluna "Nova regra" é calculado aqui, enquanto a pessoa digita
 * (espelho da conta do banco). Gravar exige ter visto a PRÉVIA do banco para
 * exatamente esta regra: quantos itens ganham preço, quantos sobem, quantos
 * descem — antes de qualquer link de cliente mudar de preço.
 */
export function RegraDeVendaPainel({
  catalogoId,
  secoes,
  itens,
  precos,
}: {
  catalogoId: string;
  secoes: SecaoDoCatalogo[];
  itens: ItemDoCatalogo[];
  precos: PrecosDoCatalogo | null;
}) {
  const qc = useQueryClient();
  const gravada = useQuery({ queryKey: ["catalogo-regras", catalogoId], queryFn: () => lerRegras(catalogoId) });
  const [form, setForm] = useState<Form | null>(null);
  const [previa, setPrevia] = useState<{ chave: string; dados: PreviaDasRegras } | null>(null);
  const [ocupado, setOcupado] = useState<"previa" | "salvar" | null>(null);
  const [buscaItem, setBuscaItem] = useState("");

  useEffect(() => {
    if (gravada.data && !form) setForm(formDasRegras(gravada.data));
  }, [gravada.data, form]);

  const { regras, erros } = useMemo(
    () => (form ? regrasDoForm(form) : { regras: null, erros: [] as string[] }),
    [form],
  );
  const chave = regras ? JSON.stringify(regras) : "";
  const previaEmDia = previa?.chave === chave;

  const secaoPorId = useMemo(() => new Map(secoes.map((s) => [s.id, s])), [secoes]);
  const itemPorId = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens]);

  // Exemplos vivos: o primeiro item com custo de cada seção (até 10).
  const exemplos = useMemo(() => {
    if (!regras || !precos) return [];
    const vistos = new Set<string>();
    const lista: { item: ItemDoCatalogo; modalidade: Modalidade; custo: number; atual: number | null; nova: number | null }[] = [];
    for (const item of itens) {
      if (lista.length >= 10) break;
      if (!item.secao_id || vistos.has(item.secao_id) || item.situacao !== "ativo" || item.em_duvida) continue;
      const p = precos.precos[item.id]?.find((x) => x.custo != null);
      if (!p || p.custo == null) continue;
      vistos.add(item.secao_id);
      const nova = calcularPreco(
        {
          itemId: item.id,
          secaoId: item.secao_id,
          situacao: item.situacao,
          emDuvida: item.em_duvida,
          unidade: item.unidade_preco,
          modalidade: p.modalidade,
          custo: p.custo,
        },
        regras,
      ).preco;
      lista.push({ item, modalidade: p.modalidade, custo: p.custo, atual: p.preco, nova });
    }
    return lista;
  }, [regras, precos, itens]);

  const candidatosItem = useMemo(
    () =>
      buscaItem.trim().length < 2 || !form
        ? []
        : filtrarItens(itens, { busca: buscaItem, secaoId: null, filtro: "todos" })
            .filter((i) => !form.itens[i.id])
            .slice(0, 8),
    [buscaItem, itens, form],
  );

  if (gravada.isLoading || (!form && !gravada.isError)) {
    return <p className="text-sm text-muted-foreground">Carregando a regra de venda…</p>;
  }
  if (gravada.isError) {
    return (
      <FalhaDeConsulta
        titulo="Não deu para carregar a regra de venda"
        erro={gravada.error}
        onTentarDeNovo={() => void gravada.refetch()}
      />
    );
  }
  if (!form || !regras) return null;

  const mudar = (parcial: Partial<Form>) => setForm({ ...form, ...parcial });

  async function verPrevia() {
    if (!regras || erros.length > 0) return;
    setOcupado("previa");
    try {
      const dados = await previaDasRegras(catalogoId, regras);
      setPrevia({ chave, dados });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function salvar() {
    if (!regras || !previaEmDia) return;
    setOcupado("salvar");
    try {
      const r = await salvarRegras(catalogoId, regras);
      toast.success(`Regra gravada: ${r.itens_com_preco} itens com preço de venda.`);
      setPrevia(null);
      qc.invalidateQueries({ queryKey: ["catalogo-precos", catalogoId] });
      qc.invalidateQueries({ queryKey: ["catalogo-regras", catalogoId] });
      qc.invalidateQueries({ queryKey: ["catalogo-resumo"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regra do catálogo</CardTitle>
          <CardDescription>
            Vale para todo item sem exceção. Sem margem, o catálogo inteiro fica "sob consulta" — nunca R$ 0,00 e
            nunca o custo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Margem sobre o custo (%)" dica={dicaCampo(ROTA, "margem")}>
            <Input
              inputMode="decimal"
              value={form.margem}
              placeholder="ex.: 60"
              onChange={(e) => mudar({ margem: e.target.value })}
              className="h-11"
            />
          </Campo>
          <Campo rotulo="Frete por peça (R$)" dica={dicaCampo(ROTA, "frete")}>
            <Input
              inputMode="decimal"
              value={form.frete}
              placeholder="ex.: 0,10"
              onChange={(e) => mudar({ frete: e.target.value })}
              className="h-11"
            />
          </Campo>
          <Campo rotulo="Arredondamento" dica={dicaCampo(ROTA, "arredondamento")}>
            <Select
              value={String(form.arredondamento)}
              onValueChange={(v) => mudar({ arredondamento: Number(v) as Arredondamento })}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ARREDONDAMENTOS.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {ROTULO_DO_ARREDONDAMENTO[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exceções por seção</CardTitle>
          <CardDescription>
            Margem ou frete diferente para uma família inteira (ex.: canetas com margem maior). Vazio = segue o
            catálogo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.keys(form.secoes).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma exceção de seção.</p>
          )}
          {Object.entries(form.secoes).map(([id, s]) => (
            <div key={id} className="grid items-end gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_9rem_9rem_auto]">
              <p className="text-sm font-medium">{secaoPorId.get(id)?.titulo ?? "Seção"}</p>
              <Campo rotulo="Margem (%)">
                <Input
                  inputMode="decimal"
                  value={s.margem}
                  onChange={(e) => mudar({ secoes: { ...form.secoes, [id]: { ...s, margem: e.target.value } } })}
                  className="h-11"
                />
              </Campo>
              <Campo rotulo="Frete por peça (R$)">
                <Input
                  inputMode="decimal"
                  value={s.frete}
                  onChange={(e) => mudar({ secoes: { ...form.secoes, [id]: { ...s, frete: e.target.value } } })}
                  className="h-11"
                />
              </Campo>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label="Tirar a exceção da seção"
                onClick={() => {
                  const { [id]: _, ...resto } = form.secoes;
                  mudar({ secoes: resto });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Select
            value=""
            onValueChange={(id) => mudar({ secoes: { ...form.secoes, [id]: { margem: "", frete: "" } } })}
          >
            <SelectTrigger className="h-11 sm:w-96">
              <SelectValue placeholder="+ Exceção para uma seção" />
            </SelectTrigger>
            <SelectContent>
              {secoes
                .filter((s) => !form.secoes[s.id])
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.titulo}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exceções por item</CardTitle>
          <CardDescription>
            Margem, frete ou preço fixo de uma opção (o preço fixo ignora custo e margem). Vale mais que a seção e
            o catálogo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(form.itens).map(([id, i]) => {
            const item = itemPorId.get(id);
            return (
              <div key={id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    <span className="font-mono">{item?.codigo_bex}</span> · {item?.nome ?? "Item"}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label="Tirar a exceção do item"
                    onClick={() => {
                      const { [id]: _, ...resto } = form.itens;
                      mudar({ itens: resto });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Campo rotulo="Margem (%)">
                    <Input
                      inputMode="decimal"
                      value={i.margem}
                      onChange={(e) => mudar({ itens: { ...form.itens, [id]: { ...i, margem: e.target.value } } })}
                      className="h-11"
                    />
                  </Campo>
                  <Campo rotulo="Frete por peça (R$)">
                    <Input
                      inputMode="decimal"
                      value={i.frete}
                      onChange={(e) => mudar({ itens: { ...form.itens, [id]: { ...i, frete: e.target.value } } })}
                      className="h-11"
                    />
                  </Campo>
                  {(item?.modalidades ?? []).map((m) => (
                    <Campo key={m.modalidade} rotulo={`Preço fixo · ${ROTULO_DA_MODALIDADE[m.modalidade]}`}>
                      <Input
                        inputMode="decimal"
                        value={i.fixos[m.modalidade] ?? ""}
                        onChange={(e) =>
                          mudar({
                            itens: {
                              ...form.itens,
                              [id]: { ...i, fixos: { ...i.fixos, [m.modalidade]: e.target.value } },
                            },
                          })
                        }
                        className="h-11"
                      />
                    </Campo>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="space-y-2">
            <Input
              value={buscaItem}
              onChange={(e) => setBuscaItem(e.target.value)}
              placeholder="+ Exceção para um item: digite o código BX, o código do fornecedor ou o nome"
              className="h-11"
            />
            {candidatosItem.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border">
                {candidatosItem.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      mudar({ itens: { ...form.itens, [i.id]: { margem: "", frete: "", fixos: {} } } });
                      setBuscaItem("");
                    }}
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    <span className="font-mono">{i.codigo_bex}</span>
                    <span className="truncate">{i.nome}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {exemplos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Como fica (um item por seção)</CardTitle>
            <CardDescription>Calculado enquanto você digita. A conta que vale é a da prévia do banco.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Opção</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Preço hoje</TableHead>
                  <TableHead className="text-right">Nova regra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exemplos.map((e) => (
                  <TableRow key={e.item.id}>
                    <TableCell className="max-w-[16rem]">
                      <span className="font-mono text-xs">{e.item.codigo_bex}</span>{" "}
                      <span className="text-xs">{e.item.nome}</span>
                    </TableCell>
                    <TableCell className="text-xs">{ROTULO_DA_MODALIDADE[e.modalidade]}</TableCell>
                    <TableCell className="text-right text-xs">{emReais(e.custo)}</TableCell>
                    <TableCell className="text-right text-xs">{e.atual != null ? emReais(e.atual) : "sob consulta"}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      {e.nova != null ? emReais(e.nova) : "sob consulta"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {erros.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {erros.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {previa && (
        <Card className={previaEmDia ? "" : "opacity-60"}>
          <CardHeader>
            <CardTitle className="text-base">Prévia do banco</CardTitle>
            <CardDescription>
              {previaEmDia
                ? "Isto é o que muda ao gravar."
                : "A regra mudou depois desta prévia: veja a prévia de novo antes de gravar."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Itens com preço de venda: <strong>{previa.dados.itens_com_preco_antes}</strong> hoje →{" "}
              <strong>{previa.dados.itens_com_preco_depois}</strong> com a nova regra.
            </p>
            <p className="text-muted-foreground">
              Opções que mudam: {previa.dados.mudam} (sobem {previa.dados.sobem}, descem {previa.dados.descem},
              passam a ter preço {previa.dados.passam_a_ter_preco}, ficam sob consulta {previa.dados.ficam_sob_consulta}
              ).
            </p>
            {previa.dados.exemplos.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Opção</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead className="text-right">Antes</TableHead>
                      <TableHead className="text-right">Depois</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previa.dados.exemplos.map((e) => (
                      <TableRow key={`${e.item_id}-${e.modalidade}`}>
                        <TableCell className="text-xs">
                          <span className="font-mono">{e.codigo_bex}</span> {e.nome}
                        </TableCell>
                        <TableCell className="text-xs">{ROTULO_DA_MODALIDADE[e.modalidade] ?? e.modalidade}</TableCell>
                        <TableCell className="text-right text-xs">{emReais(e.custo)}</TableCell>
                        <TableCell className="text-right text-xs">{e.antes != null ? emReais(e.antes) : "sob consulta"}</TableCell>
                        <TableCell className="text-right text-xs font-semibold">
                          {e.depois != null ? emReais(e.depois) : "sob consulta"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-11 md:h-9"
          disabled={ocupado !== null || erros.length > 0}
          onClick={() => void verPrevia()}
        >
          {ocupado === "previa" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-4 w-4" />}
          Ver prévia
        </Button>
        <Button className="h-11 md:h-9" disabled={ocupado !== null || !previaEmDia} onClick={() => void salvar()}>
          {ocupado === "salvar" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Gravar regra
        </Button>
        {!previaEmDia && <p className="self-center text-xs text-muted-foreground">Gravar pede a prévia desta regra.</p>}
      </div>
    </div>
  );
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label className="text-xs">{rotulo}</Label>
        <DicaIcone texto={dica} rotulo={rotulo} className="h-4 w-4" />
      </div>
      {children}
    </div>
  );
}
