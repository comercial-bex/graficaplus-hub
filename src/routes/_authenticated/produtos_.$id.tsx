/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useId, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { BotaoAtivarProduto } from "@/components/produtos/botao-ativar-produto";
import { CustoDaPeca } from "@/components/produtos/custo-da-peca";
import { FotoDoProduto } from "@/components/produtos/foto-do-produto";
import { ProdutoMateriaisEditor } from "@/components/produto-materiais-editor";
import {
  CATEGORIAS,
  FAMILIAS,
  TIPOS,
  UNIDADES,
  calcMargem,
  calcMarkup,
  margemStatus,
} from "@/lib/produtos-catalogo";
import { percentual } from "@/lib/percentual";
import { ehUnidadeDeArea } from "@/domain/orcamentos/area";
import { baseDeCalculo, rotuloDaUnidade } from "@/domain/catalogo/familias-da-lista";
import { entradaDaNota, fraseDaNota, notaDaPasta } from "@/domain/catalogo/pronto-para-ia";
import { BASES_DO_TERCEIRIZADO, pendenciaDoTerceirizado, rotuloDaBase } from "@/domain/orcamentos/terceirizados";
import { pendenciaDoPrecoEspecial } from "@/domain/precos/preco-especial-do-cliente";
import { NotaProntoParaIa } from "@/components/produtos/nota-pronto-para-ia";
import { lerParametros, type LinhaDeParametro } from "@/domain/precificacao/parametros";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import {
  abasDaPasta,
  avaliarFormula,
  frasesDoHistorico,
  payloadDoCadastro,
  pendenciaDaPergunta,
  respostasDoTexto,
  tempoDoProcesso,
  CADASTRO_VAZIO,
  ROTULO_DO_TIPO,
  VARIAVEIS_DA_FORMULA,
  type AbaDaPasta,
  type Cadastro,
  type AcaoDaResposta,
  type TempoDoProcesso,
  type TipoDeResposta,
} from "@/domain/catalogo/pasta-do-produto";
import { ROTULO_DO_MODO_DA_IA, type ModoDaIa } from "@/domain/orcamentos/perguntas-do-item";

export const Route = createFileRoute("/_authenticated/produtos_/$id")({
  head: () => ({ meta: [{ title: "Pasta do produto — BEX PRINT OS" }] }),
  component: PastaDoProduto,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Erro: {(error as Error).message}</div>
  ),
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numeroOuNulo = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/** A política de escrita barra em silêncio (0 linhas, sem erro): a gravação pede as linhas de volta. */
function confereGravou(data: unknown[] | null) {
  if (!data || data.length === 0)
    throw new Error("Nada foi gravado: seu perfil não pode alterar a pasta do produto.");
}

type Ficha = {
  subfamilia: string;
  largura_padrao_m: string;
  altura_padrao_m: string;
  copias_padrao: string;
  ncm: string;
  cst_ipi: string;
  ipi_percentual: string;
  gera_comissao: boolean;
  disponivel_pdv: boolean;
  prazo_producao_dias: string;
  ia_habilitado: boolean;
  ia_personalidade: string;
  ia_como_medir: string;
  ia_perguntas: string;
  apelidos: string;
};

const FICHA_VAZIA: Ficha = {
  subfamilia: "",
  largura_padrao_m: "",
  altura_padrao_m: "",
  copias_padrao: "",
  ncm: "",
  cst_ipi: "",
  ipi_percentual: "",
  gera_comissao: true,
  disponivel_pdv: false,
  prazo_producao_dias: "",
  ia_habilitado: false,
  ia_personalidade: "",
  ia_como_medir: "",
  ia_perguntas: "",
  apelidos: "",
};

function PastaDoProduto() {
  const { id } = Route.useParams();
  const { canSeePrices, canSeeFinancials, nivelDeVisao, hasRole } = useAuth();
  const podeEditar = hasRole("admin") || hasRole("gestor");
  const qc = useQueryClient();
  const [aba, setAba] = useState<AbaDaPasta>("descricao");
  const [form, setForm] = useState<Ficha>(FICHA_VAZIA);
  const [cadastro, setCadastro] = useState<Cadastro>(CADASTRO_VAZIO);

  const produto = useQuery({
    queryKey: ["pasta-produto", id, nivelDeVisao],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("produtos", nivelDeVisao)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const extras = useQuery({
    queryKey: ["pasta-produto-extras", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produtos")
        .select(
          "id, familia, maquina_padrao_id, material_principal_id, maquinas:maquina_padrao_id(nome), materiais:material_principal_id(nome)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Máquinas, materiais e famílias para os seletores da pasta. Falha aqui só deixa a lista vazia.
  const maquinas = useQuery({
    queryKey: ["maquinas-para-produto"],
    queryFn: async () => {
      const { data } = await supabase.from("maquinas").select("id, nome").eq("ativa", true).order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const materiaisDaCasa = useQuery({
    queryKey: ["materiais-para-produto"],
    queryFn: async () => {
      const { data } = await supabase.from("materiais").select("id, nome, unidade").order("nome");
      return (data ?? []) as { id: string; nome: string; unidade: string }[];
    },
  });
  const familiasEmUso = useQuery({
    queryKey: ["produtos", "familias"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("produtos").select("id, familia");
      if (error) throw error;
      return new Map<string, string>(
        ((data ?? []) as Array<{ id: string; familia: string | null }>)
          .filter((r) => r.familia)
          .map((r) => [r.id, r.familia as string]),
      );
    },
  });
  // As contagens para a nota "Pronto para a IA" deste produto (fase 6 do plano de 02/11).
  const satelites = useQuery({
    queryKey: ["pasta-satelites", id],
    queryFn: async () => {
      const [processos, perguntas] = await Promise.all([
        (supabase as any).from("produto_processos").select("produto_id").eq("produto_id", id),
        (supabase as any).from("produto_perguntas").select("produto_id, finalidade").eq("produto_id", id),
      ]);
      return {
        processos: (processos.data ?? []) as { produto_id: string }[],
        perguntas: (perguntas.data ?? []) as { produto_id: string; finalidade?: string | null }[],
      };
    },
  });

  // O método de cálculo da casa (markup e taxas), como o "Preço" do Holdprint mostra. Só o nível financeiro.
  const parametros = useQuery({
    queryKey: ["parametros-da-casa"],
    enabled: nivelDeVisao === "financeiro",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_tabela")
        .select("id, codigo, descricao, unidade, valor")
        .eq("ativo", true);
      if (error) throw error;
      return lerParametros((data ?? []) as unknown as LinhaDeParametro[]);
    },
  });

  useEffect(() => {
    const p = produto.data;
    const e = extras.data;
    if (!p) return;
    const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setCadastro({
      nome: txt(p.nome),
      descricao: txt(p.descricao),
      familia: txt(e?.familia),
      categoria: txt(p.categoria) || "outros",
      tipo: p.tipo === "servico" ? "servico" : "produto",
      unidade: txt(p.unidade) || "un",
      imagem_url: txt(p.imagem_url),
      custo_medio: txt(p.custo_medio),
      preco_base: txt(p.preco_base),
      margem_minima: txt(p.margem_minima),
      area_minima_cobrada: txt(p.area_minima_cobrada),
      tempo_producao_min: txt(p.tempo_producao_min),
      maquina_padrao_id: txt(e?.maquina_padrao_id ?? p.maquina_padrao_id),
      material_principal_id: txt(e?.material_principal_id ?? p.material_principal_id),
      observacoes_internas: txt(p.observacoes_internas),
    });
  }, [produto.data, extras.data]);

  const salvarCadastro = useMutation({
    mutationFn: async () => {
      if (!cadastro.nome.trim()) throw new Error("O produto precisa de um nome.");
      const { data, error } = await (supabase as any)
        .from("produtos")
        .update(payloadDoCadastro(cadastro, { canSeePrices, canSeeFinancials }))
        .eq("id", id)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      toast.success("Cadastro do produto salvo.");
      void qc.invalidateQueries({ queryKey: ["pasta-produto", id] });
      void qc.invalidateQueries({ queryKey: ["pasta-produto-extras", id] });
      void qc.invalidateQueries({ queryKey: ["produtos"] });
      void qc.invalidateQueries({ queryKey: ["pasta-historico", id] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const ficha = useQuery({
    queryKey: ["pasta-ficha", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_ficha")
        .select("*")
        .eq("produto_id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    const f = ficha.data;
    if (!f) return;
    const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setForm({
      subfamilia: txt(f.subfamilia),
      largura_padrao_m: txt(f.largura_padrao_m),
      altura_padrao_m: txt(f.altura_padrao_m),
      copias_padrao: txt(f.copias_padrao),
      ncm: txt(f.ncm),
      cst_ipi: txt(f.cst_ipi),
      ipi_percentual: txt(f.ipi_percentual),
      gera_comissao: !!f.gera_comissao,
      disponivel_pdv: !!f.disponivel_pdv,
      prazo_producao_dias: txt(f.prazo_producao_dias),
      ia_habilitado: !!f.ia_habilitado,
      ia_personalidade: txt(f.ia_personalidade),
      ia_como_medir: txt(f.ia_como_medir),
      ia_perguntas: txt(f.ia_perguntas),
      apelidos: ((f.apelidos ?? []) as string[]).join(", "),
    });
  }, [ficha.data]);

  const salvarFicha = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_ficha")
        .upsert({
          produto_id: id,
          subfamilia: form.subfamilia.trim() || null,
          largura_padrao_m: numeroOuNulo(form.largura_padrao_m),
          altura_padrao_m: numeroOuNulo(form.altura_padrao_m),
          copias_padrao: numeroOuNulo(form.copias_padrao),
          ncm: form.ncm.trim() || null,
          cst_ipi: form.cst_ipi.trim() || null,
          ipi_percentual: numeroOuNulo(form.ipi_percentual),
          gera_comissao: form.gera_comissao,
          disponivel_pdv: form.disponivel_pdv,
          prazo_producao_dias: numeroOuNulo(form.prazo_producao_dias),
          ia_habilitado: form.ia_habilitado,
          ia_personalidade: form.ia_personalidade.trim() || null,
          ia_como_medir: form.ia_como_medir.trim() || null,
          ia_perguntas: form.ia_perguntas.trim() || null,
          apelidos: respostasDoTexto(form.apelidos),
        })
        .select("produto_id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      toast.success("Pasta do produto salva.");
      void qc.invalidateQueries({ queryKey: ["pasta-ficha", id] });
      void qc.invalidateQueries({ queryKey: ["pasta-historico", id] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const abas = abasDaPasta({ canSeePrices });

  if (produto.isLoading) return <Carregando />;
  if (!produto.data) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">Produto não encontrado.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/produtos">Voltar para a lista</Link>
        </Button>
      </div>
    );
  }
  const p = produto.data;
  const set = (parte: Partial<Ficha>) => setForm((f) => ({ ...f, ...parte }));
  const setC = (parte: Partial<Cadastro>) => setCadastro((c) => ({ ...c, ...parte }));
  const salvando = salvarFicha.isPending || salvarCadastro.isPending;
  // Um "Salvar" só: o cadastro (`produtos`) e a pasta (`produto_ficha`) gravam juntos.
  const salvarTudo = async () => {
    await salvarCadastro.mutateAsync();
    await salvarFicha.mutateAsync();
  };
  const botaoSalvar = podeEditar ? (
    <div className="flex justify-end">
      <Button disabled={salvando || !cadastro.nome.trim()} onClick={() => void salvarTudo()}>
        {salvando ? "Salvando..." : "Salvar"}
      </Button>
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">
      Só administrador e gestor alteram a pasta do produto.
    </p>
  );
  const nota = notaDaPasta(
    entradaDaNota(
      {
        id,
        tipo: cadastro.tipo,
        unidade: cadastro.unidade,
        imagem_url: cadastro.imagem_url,
        descricao: cadastro.descricao,
        material_principal_id: cadastro.material_principal_id,
      },
      cadastro.familia,
      {
        fichas: ficha.data
          ? [
              {
                produto_id: id,
                largura_padrao_m: form.largura_padrao_m,
                altura_padrao_m: form.altura_padrao_m,
                ia_como_medir: form.ia_como_medir,
                ia_revisado_em: ficha.data.ia_revisado_em ?? null,
              },
            ]
          : [],
        processos: satelites.data?.processos ?? [],
        perguntas: satelites.data?.perguntas ?? [],
      },
    ),
  );
  const margem = calcMargem(Number(cadastro.custo_medio) || 0, Number(cadastro.preco_base) || 0);
  const markup = calcMarkup(Number(cadastro.custo_medio) || 0, Number(cadastro.preco_base) || 0);
  const situacao = margemStatus(margem, Number(cadastro.margem_minima) || 0);
  const casa = parametros.data?.valores;

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/produtos")}
        breadcrumb="Custeio · Produtos e serviços"
        title={p.nome}
        description="A pasta do produto: como se faz, o que perguntar ao orçar e o roteiro da IA."
        actions={
          <>
            <Badge variant={p.ativo ? "default" : "secondary"}>{p.ativo ? "Ativo" : "Inativo"}</Badge>
            {podeEditar && <BotaoAtivarProduto produto={p} rotuloCompleto />}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/produtos">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar para a lista
          </Link>
        </Button>
        {/* A nota diz o que ainda falta para a IA orçar este produto sozinha. */}
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="pronto-para-ia">
          <NotaProntoParaIa nota={nota} compacta />
          <span className="text-muted-foreground">{fraseDaNota(nota)}</span>
        </p>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as AbaDaPasta)}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto w-max">
            {abas.map((a) => (
              <TabsTrigger key={a.id} value={a.id} className="min-h-11 md:min-h-8">
                {a.titulo}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="descricao" className="space-y-4 pt-2">
          {/* Como a Descrição do Holdprint: nome, descrição, família, o modelo da conta e a unidade na proposta. */}
          <Card>
            <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="pasta-nome">Nome</Label>
                <Input
                  id="pasta-nome"
                  value={cadastro.nome}
                  disabled={!podeEditar}
                  onChange={(e) => setC({ nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pasta-familia">Família</Label>
                <Input
                  id="pasta-familia"
                  value={cadastro.familia}
                  disabled={!podeEditar}
                  list="pasta-familias-do-catalogo"
                  placeholder="Ex.: Lonas frontlight"
                  onChange={(e) => setC({ familia: e.target.value })}
                />
                <datalist id="pasta-familias-do-catalogo">
                  {[...new Set([...FAMILIAS, ...(familiasEmUso.data?.values() ?? [])])].map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <Label htmlFor="pasta-descricao">Descrição</Label>
                <Textarea
                  id="pasta-descricao"
                  rows={3}
                  value={cadastro.descricao}
                  disabled={!podeEditar}
                  placeholder="O que o cliente lê no orçamento"
                  onChange={(e) => setC({ descricao: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pasta-subfamilia">Subfamília</Label>
                <Input
                  id="pasta-subfamilia"
                  value={form.subfamilia}
                  disabled={!podeEditar}
                  placeholder="Ex.: Em lona, Em papel"
                  onChange={(e) => set({ subfamilia: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pasta-categoria">Categoria</Label>
                <Select value={cadastro.categoria} disabled={!podeEditar} onValueChange={(v) => setC({ categoria: v })}>
                  <SelectTrigger id="pasta-categoria">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pasta-tipo">Tipo</Label>
                <Select
                  value={cadastro.tipo}
                  disabled={!podeEditar}
                  onValueChange={(v) => setC({ tipo: v === "servico" ? "servico" : "produto" })}
                >
                  <SelectTrigger id="pasta-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pasta-unidade">Unidade na proposta</Label>
                <Select value={cadastro.unidade} disabled={!podeEditar} onValueChange={(v) => setC({ unidade: v })}>
                  <SelectTrigger id="pasta-unidade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([...UNIDADES, cadastro.unidade])].filter(Boolean).map((u) => (
                      <SelectItem key={u} value={u}>
                        {rotuloDaUnidade(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Dado rotulo="Como se calcula" valor={baseDeCalculo(cadastro.unidade)} />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <p className="text-sm font-medium">Foto</p>
                <FotoDoProduto
                  valor={cadastro.imagem_url}
                  onChange={(url) => setC({ imagem_url: url })}
                  produto={{
                    id,
                    nome: cadastro.nome,
                    descricao: cadastro.descricao,
                    familia: cadastro.familia,
                    categoria: cadastro.categoria,
                  }}
                />
              </div>
            </CardContent>
          </Card>
          {botaoSalvar}
        </TabsContent>

        {canSeePrices && (
          <TabsContent value="preco" className="space-y-4 pt-2">
            <Card>
              <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
                {canSeeFinancials ? (
                  <>
                    <Campo
                      rotulo={`Preço de venda (R$/${rotuloDaUnidade(cadastro.unidade)})`}
                      valor={cadastro.preco_base}
                      desativado={!podeEditar}
                      aoMudar={(v) => setC({ preco_base: v })}
                    />
                    <Campo
                      rotulo="Custo do cadastro"
                      valor={cadastro.custo_medio}
                      desativado={!podeEditar}
                      aoMudar={(v) => setC({ custo_medio: v })}
                    />
                    <Campo
                      rotulo="Margem mínima (%)"
                      valor={cadastro.margem_minima}
                      desativado={!podeEditar}
                      aoMudar={(v) => setC({ margem_minima: v })}
                    />
                    {ehUnidadeDeArea(cadastro.unidade) && (
                      <Campo
                        rotulo="Área mínima cobrada (m²), vazio cobra a área real"
                        valor={cadastro.area_minima_cobrada}
                        desativado={!podeEditar}
                        aoMudar={(v) => setC({ area_minima_cobrada: v })}
                      />
                    )}
                    <Dado
                      rotulo="Margem com este preço"
                      valor={
                        margem === null
                          ? null
                          : `${percentual(margem)}${situacao === "ruim" ? " (abaixo do mínimo)" : situacao === "alerta" ? " (perto do mínimo)" : ""}`
                      }
                    />
                    <Dado rotulo="Markup" valor={markup ? `${markup.toFixed(2)}x` : null} />
                  </>
                ) : (
                  <>
                    <Dado
                      rotulo="Preço de venda"
                      valor={p.preco_base != null ? brl(Number(p.preco_base)) : null}
                    />
                    {p.margem_minima != null && (
                      <Dado rotulo="Margem mínima" valor={`${Number(p.margem_minima)}%`} />
                    )}
                    {p.custo_medio != null && (
                      <Dado rotulo="Custo do cadastro" valor={brl(Number(p.custo_medio))} />
                    )}
                  </>
                )}
                <Dado
                  rotulo="Preço sugerido"
                  valor={p.preco_sugerido != null ? brl(Number(p.preco_sugerido)) : null}
                />
                <Dado
                  rotulo="Preço público"
                  valor={p.preco_publico != null ? brl(Number(p.preco_publico)) : null}
                />
                <p className="text-xs text-muted-foreground md:col-span-3">
                  As faixas por quantidade ficam na{" "}
                  <Link to="/tabela-de-precos" className="underline">
                    tabela de preços
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
            {canSeeFinancials && botaoSalvar}
            {/* "Preço especial para clientes" do Holdprint: um preço combinado com um cliente. */}
            <PrecosEspeciaisDoProduto
              produtoId={id}
              podeEditar={podeEditar}
              precoTabela={p.preco_base == null ? null : Number(p.preco_base)}
            />
            {nivelDeVisao === "financeiro" && casa && (
              // O "Método de cálculo" e os "Impostos" do Holdprint: os números da casa, lidos da Planilha de custos.
              <Card data-testid="metodo-de-calculo-da-casa">
                <CardHeader>
                  <CardTitle className="text-base">Método de cálculo da casa</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <Dado rotulo="Markup de varejo" valor={casa.markup_padrao != null ? `${casa.markup_padrao}%` : null} />
                  <Dado rotulo="Markup de atacado" valor={casa.markup_atacado != null ? `${casa.markup_atacado}%` : null} />
                  <Dado rotulo="Impostos sobre a venda" valor={casa.impostos_venda != null ? `${casa.impostos_venda}%` : null} />
                  <Dado rotulo="Taxa do cartão" valor={casa.taxa_cartao != null ? `${casa.taxa_cartao}%` : null} />
                  <p className="text-xs text-muted-foreground sm:col-span-2 md:col-span-4">
                    Valem para todos os produtos e se mudam na{" "}
                    <Link to="/planilha-custos" className="underline">
                      planilha de custos
                    </Link>
                    .
                  </p>
                </CardContent>
              </Card>
            )}
            {nivelDeVisao === "financeiro" && (
              <CustoDaPeca
                produtoId={id}
                unidade={p.unidade}
                tipo={p.tipo}
                categoria={p.categoria}
                familia={extras.data?.familia ?? null}
                preco={p.preco_base == null ? null : Number(p.preco_base)}
                margemMinima={p.margem_minima == null ? null : Number(p.margem_minima)}
                minutos={p.tempo_producao_min == null ? null : Number(p.tempo_producao_min)}
                temMaquina={!!p.maquina_padrao_id}
                largura={Number(form.largura_padrao_m) || 1}
                altura={Number(form.altura_padrao_m) || 1}
              />
            )}
          </TabsContent>
        )}

        <TabsContent value="parametros" className="space-y-4 pt-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Medida padrão do trabalho</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Campo
                rotulo="Largura (m)"
                valor={form.largura_padrao_m}
                desativado={!podeEditar}
                aoMudar={(v) => set({ largura_padrao_m: v })}
              />
              <Campo
                rotulo="Altura (m)"
                valor={form.altura_padrao_m}
                desativado={!podeEditar}
                aoMudar={(v) => set({ altura_padrao_m: v })}
              />
              <Campo
                rotulo="Cópias"
                valor={form.copias_padrao}
                desativado={!podeEditar}
                aoMudar={(v) => set({ copias_padrao: v })}
              />
            </CardContent>
          </Card>
          {/* "Mídia de impressão" e a máquina, como nos Parâmetros do Holdprint; antes eram só leitura aqui. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Máquina e material principal</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pasta-maquina">Máquina padrão</Label>
                <Select
                  value={cadastro.maquina_padrao_id || "nenhuma"}
                  disabled={!podeEditar}
                  onValueChange={(v) => setC({ maquina_padrao_id: v === "nenhuma" ? "" : v })}
                >
                  <SelectTrigger id="pasta-maquina">
                    <SelectValue placeholder="Nenhuma" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhuma">Nenhuma</SelectItem>
                    {(maquinas.data ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Onde a peça é feita: é daqui que sai a largura da bobina no orçamento.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pasta-material">Material principal (mídia)</Label>
                <Select
                  value={cadastro.material_principal_id || "nenhum"}
                  disabled={!podeEditar}
                  onValueChange={(v) => setC({ material_principal_id: v === "nenhum" ? "" : v })}
                >
                  <SelectTrigger id="pasta-material">
                    <SelectValue placeholder="Nenhum" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Nenhum</SelectItem>
                    {(materiaisDaCasa.data ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.nome} ({m.unidade})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  O insumo que domina o custo. Os materiais abaixo dão o consumo exato.
                </p>
              </div>
              <Campo
                rotulo={`Tempo estimado (min por ${rotuloDaUnidade(cadastro.unidade)})`}
                valor={cadastro.tempo_producao_min}
                desativado={!podeEditar}
                aoMudar={(v) => setC({ tempo_producao_min: v })}
              />
              <TextoLongo
                rotulo="Observações internas (não aparecem para o cliente)"
                valor={cadastro.observacoes_internas}
                desativado={!podeEditar}
                aoMudar={(v) => setC({ observacoes_internas: v })}
              />
            </CardContent>
          </Card>
          {botaoSalvar}
          <AbaTamanhos produtoId={id} podeEditar={podeEditar} />
          {/* "Insira os terceirizados deste produto": o que a gráfica paga a terceiros por este produto. */}
          {nivelDeVisao === "financeiro" && <AbaTerceirizados produtoId={id} podeEditar={podeEditar} />}
          {/* "Insira os materiais deste produto": a ficha de materiais, que morava só na janela da lista. */}
          {cadastro.tipo === "produto" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Materiais deste produto</CardTitle>
              </CardHeader>
              <CardContent>
                <ProdutoMateriaisEditor produtoId={id} produtoUnidade={cadastro.unidade} />
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Serviço não consome material.</p>
          )}
        </TabsContent>

        <TabsContent value="processos" className="pt-2">
          <AbaProcessos
            produtoId={id}
            familia={extras.data?.familia ?? null}
            podeEditar={podeEditar}
            largura={Number(form.largura_padrao_m) || 1}
            altura={Number(form.altura_padrao_m) || 1}
            tempoDoProduto={p.tempo_producao_min == null ? null : Number(p.tempo_producao_min)}
          />
        </TabsContent>

        <TabsContent value="formulas" className="pt-2">
          <AbaFormulas produtoId={id} podeEditar={podeEditar} />
        </TabsContent>

        <TabsContent value="checklist" className="pt-2">
          <AbaChecklist produtoId={id} podeEditar={podeEditar} />
        </TabsContent>

        <TabsContent value="ia" className="space-y-4 pt-2">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <Campo
                rotulo="Também conhecido como (separe com vírgula)"
                valor={form.apelidos}
                desativado={!podeEditar}
                aoMudar={(v) => set({ apelidos: v })}
              />
              <TextoLongo
                rotulo="Personalidade e regras"
                valor={form.ia_personalidade}
                desativado={!podeEditar}
                aoMudar={(v) => set({ ia_personalidade: v })}
              />
              <TextoLongo
                rotulo="Como descobrir as medidas"
                valor={form.ia_como_medir}
                desativado={!podeEditar}
                aoMudar={(v) => set({ ia_como_medir: v })}
              />
              <TextoLongo
                rotulo="Perguntas obrigatórias"
                valor={form.ia_perguntas}
                desativado={!podeEditar}
                aoMudar={(v) => set({ ia_perguntas: v })}
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.ia_habilitado}
                  disabled={!podeEditar}
                  onCheckedChange={(v) => set({ ia_habilitado: v })}
                />
                Liberado para o orçamento com IA
              </label>
              <p className="text-xs text-muted-foreground">
                {ficha.data?.ia_revisado_em
                  ? `Revisado por quem atende em ${new Date(ficha.data.ia_revisado_em).toLocaleDateString("pt-BR")}.`
                  : "Ainda sem revisão de quem atende. A revisão se marca em Preencher as pastas."}{" "}
                O orçamento com IA, na tela de orçamentos, lê este roteiro.
              </p>
            </CardContent>
          </Card>
          {botaoSalvar}
        </TabsContent>

        <TabsContent value="info" className="space-y-4 pt-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identificação e fiscal</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <Dado rotulo="SKU" valor={p.sku} />
              <Campo
                rotulo="NCM/SH"
                valor={form.ncm}
                desativado={!podeEditar}
                aoMudar={(v) => set({ ncm: v })}
              />
              <Campo
                rotulo="CST IPI"
                valor={form.cst_ipi}
                desativado={!podeEditar}
                aoMudar={(v) => set({ cst_ipi: v })}
              />
              <Campo
                rotulo="IPI (%)"
                valor={form.ipi_percentual}
                desativado={!podeEditar}
                aoMudar={(v) => set({ ipi_percentual: v })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configurações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.gera_comissao}
                  disabled={!podeEditar}
                  onCheckedChange={(v) => set({ gera_comissao: v })}
                />
                Gera comissão
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.disponivel_pdv}
                  disabled={!podeEditar}
                  onCheckedChange={(v) => set({ disponivel_pdv: v })}
                />
                Disponível no balcão
              </label>
              <div className="max-w-xs">
                <Campo
                  rotulo="Prazo de produção (dias)"
                  valor={form.prazo_producao_dias}
                  desativado={!podeEditar}
                  aoMudar={(v) => set({ prazo_producao_dias: v })}
                />
              </div>
            </CardContent>
          </Card>
          {botaoSalvar}
        </TabsContent>

        <TabsContent value="campos" className="pt-2">
          <AbaChecklist produtoId={id} podeEditar={podeEditar} finalidade="informacao" />
        </TabsContent>

        <TabsContent value="historico" className="pt-2">
          <AbaHistorico produtoId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="whitespace-pre-wrap text-sm">{valor || "—"}</div>
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  desativado,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  desativado: boolean;
  aoMudar: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input id={id} value={valor} disabled={desativado} onChange={(e) => aoMudar(e.target.value)} />
    </div>
  );
}

function TextoLongo({
  rotulo,
  valor,
  desativado,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  desativado: boolean;
  aoMudar: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Textarea
        id={id}
        rows={6}
        value={valor}
        disabled={desativado}
        onChange={(e) => aoMudar(e.target.value)}
      />
    </div>
  );
}

function fraseDoTempo(t: TempoDoProcesso, largura: number, altura: number): string {
  const peca = `${largura.toLocaleString("pt-BR")} × ${altura.toLocaleString("pt-BR")} m`;
  if (t.tipo === "falta") return "Falta a produtividade deste processo";
  if (t.tipo === "minutos") return `${t.minutos.toLocaleString("pt-BR")} min numa peça de ${peca}`;
  return t.minutos === null
    ? "O tempo vem do produto: falta preencher o tempo de produção na lista de produtos"
    : `${t.minutos.toLocaleString("pt-BR")} min, do tempo de produção do produto`;
}

function useProcessos() {
  return useQuery({
    queryKey: ["processos-ativos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("processos")
        .select(
          "id, nome, etapa, base_produtividade, setup_min, produtividade_m2_h, produtividade_m_h, produtividade_por_familia",
        )
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function AbaProcessos({
  produtoId,
  familia,
  podeEditar,
  largura,
  altura,
  tempoDoProduto,
}: {
  produtoId: string;
  familia: string | null;
  podeEditar: boolean;
  largura: number;
  altura: number;
  tempoDoProduto: number | null;
}) {
  const qc = useQueryClient();
  const catalogo = useProcessos();
  const [novo, setNovo] = useState("");
  const chave = ["pasta-processos", produtoId];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_processos")
        .select(
          "id, ordem, processo_id, processos(id, nome, etapa, base_produtividade, setup_min, produtividade_m2_h, produtividade_m_h, produtividade_por_familia)",
        )
        .eq("produto_id", produtoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: ["pasta-historico", produtoId] });
  };
  const adicionar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_processos")
        .insert({ produto_id: produtoId, processo_id: novo, ordem: (lista.data ?? []).length })
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      setNovo("");
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: async (linhaId: string) => {
      const { data, error } = await (supabase as any)
        .from("produto_processos")
        .delete()
        .eq("id", linhaId)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const mover = useMutation({
    mutationFn: async ({ de, para }: { de: number; para: number }) => {
      const itens = lista.data ?? [];
      for (const [linha, ordem] of [
        [itens[de], para],
        [itens[para], de],
      ] as const) {
        const { data, error } = await (supabase as any)
          .from("produto_processos")
          .update({ ordem })
          .eq("id", linha.id)
          .select("id");
        if (error) throw error;
        confereGravou(data);
      }
    },
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const itens = lista.data ?? [];
  const usados = new Set(itens.map((l) => l.processo_id));
  const tempos = itens.map((l) =>
    tempoDoProcesso(l.processos, { largura, altura }, { familia, tempoDoProduto }),
  );
  const semNumero = tempos.some(
    (t) => t.tipo === "falta" || (t.tipo === "do_produto" && t.minutos === null),
  );
  const total = tempos.reduce<number>((s, t) => s + (t.tipo === "falta" ? 0 : (t.minutos ?? 0)), 0);

  return (
    <div className="space-y-4">
      {podeEditar && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 pt-6">
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label>Acrescentar processo</Label>
              <Select value={novo} onValueChange={setNovo}>
                <SelectTrigger aria-label="Escolha o processo">
                  <SelectValue placeholder="Escolha o processo" />
                </SelectTrigger>
                <SelectContent>
                  {(catalogo.data ?? [])
                    .filter((c) => !usados.has(c.id))
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!novo || adicionar.isPending} onClick={() => adicionar.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" /> Acrescentar
            </Button>
            <Button asChild variant="outline">
              <Link to="/processos">Catálogo de processos</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="space-y-2 pt-6">
          {lista.isLoading && <Carregando />}
          {!lista.isLoading && itens.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum processo neste produto.
            </p>
          )}
          {itens.map((l, i) => (
            <div
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{l.processos?.nome}</div>
                <div className="text-xs text-muted-foreground">
                  {fraseDoTempo(tempos[i], largura, altura)}
                </div>
              </div>
              {podeEditar && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === 0 || mover.isPending}
                    aria-label={`Subir ${l.processos?.nome}`}
                    onClick={() => mover.mutate({ de: i, para: i - 1 })}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === itens.length - 1 || mover.isPending}
                    aria-label={`Descer ${l.processos?.nome}`}
                    onClick={() => mover.mutate({ de: i, para: i + 1 })}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={remover.isPending}
                    aria-label={`Tirar ${l.processos?.nome}`}
                    onClick={() => remover.mutate(l.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
          {itens.length > 0 && (
            <p className="pt-1 text-sm text-muted-foreground">
              {semNumero
                ? "O tempo total só aparece quando todos os processos tiverem tempo."
                : `Tempo total: ${total.toLocaleString("pt-BR")} min, com a preparação, para uma peça de ${largura.toLocaleString("pt-BR")} × ${altura.toLocaleString("pt-BR")} m.`}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Preço especial para clientes (aba Preço do Holdprint, 02/11/2026): um preço
 * de venda do produto combinado com um cliente. O item do orçamento desse
 * cliente entra com ele no lugar da tabela, fora do modo parceiro.
 */
function PrecosEspeciaisDoProduto({
  produtoId,
  podeEditar,
  precoTabela,
}: {
  produtoId: string;
  podeEditar: boolean;
  precoTabela: number | null;
}) {
  const qc = useQueryClient();
  const [clienteId, setClienteId] = useState("");
  const [preco, setPreco] = useState("");
  const [observacao, setObservacao] = useState("");
  const chave = ["pasta-precos-especiais", produtoId];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_precos_cliente")
        .select("id, cliente_id, preco, observacao, cliente:cliente_id(nome)")
        .eq("produto_id", produtoId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const clientes = useQuery({
    queryKey: ["clientes-para-preco-especial"],
    enabled: podeEditar,
    queryFn: async () => {
      const { data } = await (supabase as any).from("clientes").select("id, nome").order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const pendencia = pendenciaDoPrecoEspecial({ cliente_id: clienteId, preco }, lista.data ?? []);
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: ["pasta-historico", produtoId] });
  };
  const adicionar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_precos_cliente")
        .insert({
          produto_id: produtoId,
          cliente_id: clienteId,
          preco: Number(preco.replace(",", ".")),
          observacao: observacao.trim() || null,
        })
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      setClienteId("");
      setPreco("");
      setObservacao("");
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: async (linhaId: string) => {
      const { data, error } = await (supabase as any)
        .from("produto_precos_cliente")
        .delete()
        .eq("id", linhaId)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Card data-testid="precos-especiais-do-produto">
      <CardHeader>
        <CardTitle className="text-base">Preço especial para clientes</CardTitle>
        <p className="text-sm text-muted-foreground">
          O orçamento deste cliente entra com o preço combinado no lugar da tabela
          {precoTabela != null && precoTabela > 0 ? ` (${brl(precoTabela)})` : ""}. Fora do modo parceiro, que tem a própria tabela.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {podeEditar && (
          <div className="grid items-end gap-3 md:grid-cols-[1fr_140px_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="pasta-preco-especial-cliente">Cliente</Label>
              <Select value={clienteId || "nenhum"} onValueChange={(v) => setClienteId(v === "nenhum" ? "" : v)}>
                <SelectTrigger id="pasta-preco-especial-cliente">
                  <SelectValue placeholder="Escolha o cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Escolha o cliente</SelectItem>
                  {(clientes.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Campo rotulo="Preço combinado (R$)" valor={preco} desativado={false} aoMudar={setPreco} />
            <Campo rotulo="Observação (opcional)" valor={observacao} desativado={false} aoMudar={setObservacao} />
            <Button disabled={!!pendencia || adicionar.isPending} onClick={() => adicionar.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" /> Acrescentar
            </Button>
            {pendencia && (clienteId || preco) && (
              <p className="text-xs text-destructive md:col-span-4">{pendencia}</p>
            )}
          </div>
        )}
        {lista.isLoading && <Carregando />}
        {!lista.isLoading && (lista.data ?? []).length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Nenhum cliente com preço especial neste produto.
          </p>
        )}
        {(lista.data ?? []).map((l) => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
            <div className="min-w-0">
              <div className="font-medium">{l.cliente?.nome ?? "Cliente"}</div>
              <div className="text-xs text-muted-foreground">
                {brl(Number(l.preco))}
                {l.observacao ? ` · ${l.observacao}` : ""}
              </div>
            </div>
            {podeEditar && (
              <Button
                variant="ghost"
                size="icon"
                disabled={remover.isPending}
                aria-label={`Tirar o preço especial de ${l.cliente?.nome ?? "cliente"}`}
                onClick={() => remover.mutate(l.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Terceirizados do produto ("Insira os terceirizados deste produto" do Holdprint,
 * fase 3 de 02/11): o que a gráfica paga a um terceiro por este produto, com a
 * base por peça, por m² ou por pedido. Entra no custo de cada item pelo gatilho.
 */
function AbaTerceirizados({ produtoId, podeEditar }: { produtoId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [descricao, setDescricao] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [valor, setValor] = useState("");
  const [base, setBase] = useState("peca");
  const chave = ["pasta-terceirizados", produtoId];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_terceirizados")
        .select("id, descricao, valor, base, fornecedor_id, fornecedor:fornecedor_id(nome)")
        .eq("produto_id", produtoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const fornecedores = useQuery({
    queryKey: ["fornecedores-para-produto"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("fornecedores").select("id, nome").eq("ativo", true).order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const pendencia = pendenciaDoTerceirizado({ descricao, valor, base });
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: ["pasta-custo", produtoId] });
    void qc.invalidateQueries({ queryKey: ["produto-terceirizados", produtoId] });
  };
  const adicionar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_terceirizados")
        .insert({
          produto_id: produtoId,
          descricao: descricao.trim(),
          fornecedor_id: fornecedorId || null,
          valor: Number(valor.replace(",", ".")),
          base,
          ordem: (lista.data ?? []).length,
        })
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      setDescricao("");
      setFornecedorId("");
      setValor("");
      setBase("peca");
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: async (linhaId: string) => {
      const { data, error } = await (supabase as any)
        .from("produto_terceirizados")
        .delete()
        .eq("id", linhaId)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Card data-testid="terceirizados-do-produto">
      <CardHeader>
        <CardTitle className="text-base">Terceirizados deste produto</CardTitle>
        <p className="text-sm text-muted-foreground">
          O que a gráfica paga a um terceiro para fazer este produto. Entra no custo de cada item
          do orçamento, na medida e na quantidade do item.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {podeEditar && (
          <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_120px_1fr_auto]">
            <Campo rotulo="O que é terceirizado" valor={descricao} desativado={false} aoMudar={setDescricao} />
            <div className="space-y-1.5">
              <Label htmlFor="pasta-terceirizado-fornecedor">Fornecedor (opcional)</Label>
              <Select value={fornecedorId || "nenhum"} onValueChange={(v) => setFornecedorId(v === "nenhum" ? "" : v)}>
                <SelectTrigger id="pasta-terceirizado-fornecedor">
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Nenhum</SelectItem>
                  {(fornecedores.data ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Campo rotulo="Valor (R$)" valor={valor} desativado={false} aoMudar={setValor} />
            <div className="space-y-1.5">
              <Label htmlFor="pasta-terceirizado-base">Cobrado</Label>
              <Select value={base} onValueChange={setBase}>
                <SelectTrigger id="pasta-terceirizado-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BASES_DO_TERCEIRIZADO.map((b) => (
                    <SelectItem key={b.valor} value={b.valor}>
                      {b.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!!pendencia || adicionar.isPending} onClick={() => adicionar.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" /> Acrescentar
            </Button>
            {pendencia && (descricao || valor) && (
              <p className="text-xs text-destructive md:col-span-5">{pendencia}</p>
            )}
          </div>
        )}
        {lista.isLoading && <Carregando />}
        {!lista.isLoading && (lista.data ?? []).length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Nenhum terceirizado: tudo deste produto é feito na casa.
          </p>
        )}
        {(lista.data ?? []).map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
            <div className="min-w-0">
              <div className="font-medium">
                {t.descricao}
                {t.fornecedor?.nome && <span className="ml-1.5 text-xs text-muted-foreground">{t.fornecedor.nome}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {brl(Number(t.valor))} {rotuloDaBase(t.base)}
              </div>
            </div>
            {podeEditar && (
              <Button
                variant="ghost"
                size="icon"
                disabled={remover.isPending}
                aria-label={`Tirar o terceirizado ${t.descricao}`}
                onClick={() => remover.mutate(t.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Tamanhos prontos ("Medidas do trabalho" do Holdprint): os tamanhos que o
 * orçamento oferece de atalho para este produto, com "quando usar" para quem atende.
 */
function AbaTamanhos({ produtoId, podeEditar }: { produtoId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [largura, setLargura] = useState("");
  const [altura, setAltura] = useState("");
  const [quandoUsar, setQuandoUsar] = useState("");
  const chave = ["pasta-tamanhos", produtoId];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_tamanhos")
        .select("id, nome, largura, altura, padrao, quando_usar, ordem")
        .eq("produto_id", produtoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: ["pasta-historico", produtoId] });
  };
  const l = Number(largura.replace(",", "."));
  const a = Number(altura.replace(",", "."));
  const pendencia = !nome.trim()
    ? "Dê um nome ao tamanho."
    : !(l > 0) || !(a > 0)
      ? "Largura e altura em metros, maiores que zero."
      : null;
  const adicionar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_tamanhos")
        .insert({
          produto_id: produtoId,
          nome: nome.trim(),
          largura: l,
          altura: a,
          quando_usar: quandoUsar.trim() || null,
          ordem: (lista.data ?? []).length,
        })
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      setNome("");
      setLargura("");
      setAltura("");
      setQuandoUsar("");
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: async (linhaId: string) => {
      const { data, error } = await (supabase as any)
        .from("produto_tamanhos")
        .delete()
        .eq("id", linhaId)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const metros = (n: unknown) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return (
    <Card data-testid="tamanhos-prontos">
      <CardHeader>
        <CardTitle className="text-base">Tamanhos prontos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {podeEditar && (
          <div className="grid items-end gap-3 md:grid-cols-[1fr_120px_120px_1fr_auto]">
            <Campo rotulo="Nome" valor={nome} desativado={false} aoMudar={setNome} />
            <Campo rotulo="Largura (m)" valor={largura} desativado={false} aoMudar={setLargura} />
            <Campo rotulo="Altura (m)" valor={altura} desativado={false} aoMudar={setAltura} />
            <Campo rotulo="Quando usar (opcional)" valor={quandoUsar} desativado={false} aoMudar={setQuandoUsar} />
            <Button disabled={!!pendencia || adicionar.isPending} onClick={() => adicionar.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" /> Acrescentar
            </Button>
            {pendencia && (nome || largura || altura) && (
              <p className="text-xs text-destructive md:col-span-5">{pendencia}</p>
            )}
          </div>
        )}
        {lista.isLoading && <Carregando />}
        {!lista.isLoading && (lista.data ?? []).length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Nenhum tamanho pronto: o orçamento pede a medida a cada item.
          </p>
        )}
        {(lista.data ?? []).map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
            <div className="min-w-0">
              <div className="font-medium">
                {t.nome}: {metros(t.largura)} × {metros(t.altura)} m{t.padrao ? " (padrão)" : ""}
              </div>
              {t.quando_usar && <div className="text-xs text-muted-foreground">{t.quando_usar}</div>}
            </div>
            {podeEditar && (
              <Button
                variant="ghost"
                size="icon"
                disabled={remover.isPending}
                aria-label={`Tirar o tamanho ${t.nome}`}
                onClick={() => remover.mutate(t.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AbaFormulas({ produtoId, podeEditar }: { produtoId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [material, setMaterial] = useState("");
  const [script, setScript] = useState("");
  const [descricao, setDescricao] = useState("");
  const chave = ["pasta-formulas", produtoId];
  const materiais = useQuery({
    queryKey: ["materiais-para-produto"],
    queryFn: async () => {
      const { data } = await supabase.from("materiais").select("id, nome, unidade").order("nome");
      return data ?? [];
    },
  });
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_formulas")
        .select("id, descricao, script, material_id")
        .eq("produto_id", produtoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const nomeDoMaterial = useMemo(
    () => new Map((materiais.data ?? []).map((m: any) => [m.id, m.nome])),
    [materiais.data],
  );
  const exemplo = { largura: 2, altura: 1, copias: 1, quantidade: 1 };
  const previa = script.trim() ? avaliarFormula(script, exemplo) : null;

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: ["pasta-historico", produtoId] });
  };
  const adicionar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_formulas")
        .insert({
          produto_id: produtoId,
          material_id: material,
          script: script.trim(),
          descricao: descricao.trim() || null,
          ordem: (lista.data ?? []).length,
        })
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      setMaterial("");
      setScript("");
      setDescricao("");
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: async (linhaId: string) => {
      const { data, error } = await (supabase as any)
        .from("produto_formulas")
        .delete()
        .eq("id", linhaId)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <div className="space-y-4">
      {podeEditar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Material calculado por conta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Material</Label>
                <Select value={material} onValueChange={setMaterial}>
                  <SelectTrigger aria-label="Escolha o material">
                    <SelectValue placeholder="Escolha o material" />
                  </SelectTrigger>
                  <SelectContent>
                    {(materiais.data ?? []).map((m: any) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Campo
                rotulo="Para que serve (opcional)"
                valor={descricao}
                desativado={false}
                aoMudar={setDescricao}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pasta-script">Fórmula</Label>
              <Input
                id="pasta-script"
                className="font-mono"
                placeholder="teto(perimetro / 0,5)"
                value={script}
                onChange={(e) => setScript(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Pode usar {VARIAVEIS_DA_FORMULA.join(", ")}; as contas + - * / e as funções teto,
                piso, arred, min e max (separe com ponto e vírgula).
              </p>
              {previa && (
                <p
                  className={`text-xs ${previa.ok ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {previa.ok
                    ? `Numa peça de 2 × 1 m dá ${previa.valor.toLocaleString("pt-BR")}.`
                    : previa.erro}
                </p>
              )}
            </div>
            <Button
              disabled={!material || !previa?.ok || adicionar.isPending}
              onClick={() => adicionar.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Acrescentar
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="space-y-2 pt-6">
          {(lista.data ?? []).length === 0 && !lista.isLoading && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma fórmula neste produto.
            </p>
          )}
          {(lista.data ?? []).map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded border p-3">
              <div className="min-w-0">
                <div className="font-medium">{nomeDoMaterial.get(f.material_id) ?? "Material"}</div>
                <div className="font-mono text-xs text-muted-foreground">{f.script}</div>
                {f.descricao && <div className="text-xs text-muted-foreground">{f.descricao}</div>}
              </div>
              {podeEditar && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={remover.isPending}
                  aria-label="Tirar a fórmula"
                  onClick={() => remover.mutate(f.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground" data-testid="formulas-entram-no-custo">
            As fórmulas entram no custo do item do orçamento: a quantidade sai da medida do item e o
            banco multiplica pelo custo de compra do material.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Como a IA trata esta pergunta. Só a IA: quem atende continua vendo a pergunta no item. */
function InstrucaoDaIa({
  pergunta,
  podeEditar,
  aoSalvar,
}: {
  pergunta: any;
  podeEditar: boolean;
  aoSalvar: () => void;
}) {
  const [modo, setModo] = useState<ModoDaIa>((pergunta.ia_modo as ModoDaIa) ?? "perguntar");
  const [resposta, setResposta] = useState<string>(pergunta.ia_resposta ?? "");
  const [instrucao, setInstrucao] = useState<string>(pergunta.ia_instrucao ?? "");
  const opcoes = (pergunta.respostas ?? []) as string[];
  const falta = modo === "definir" && !resposta.trim() ? "Diga qual resposta a IA marca." : null;
  const mudou =
    modo !== (pergunta.ia_modo ?? "perguntar") ||
    resposta !== (pergunta.ia_resposta ?? "") ||
    instrucao !== (pergunta.ia_instrucao ?? "");
  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_perguntas")
        .update({
          ia_modo: modo,
          ia_resposta: modo === "definir" ? resposta.trim() || null : null,
          ia_instrucao: instrucao.trim() || null,
        })
        .eq("id", pergunta.id)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      toast.success("Instrução da IA salva.");
      aoSalvar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <div className="mt-2 space-y-2 rounded border border-dashed p-2" data-testid="instrucao-da-ia">
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Na IA</Label>
          <Select value={modo} disabled={!podeEditar} onValueChange={(v) => setModo(v as ModoDaIa)}>
            <SelectTrigger aria-label="Como a IA trata esta pergunta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULO_DO_MODO_DA_IA) as ModoDaIa[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {ROTULO_DO_MODO_DA_IA[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {modo === "definir" &&
          (opcoes.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs">Resposta que a IA marca</Label>
              <Select value={resposta} disabled={!podeEditar} onValueChange={setResposta}>
                <SelectTrigger aria-label="Resposta que a IA marca">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {opcoes.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Campo
              rotulo="Resposta que a IA marca"
              valor={resposta}
              desativado={!podeEditar}
              aoMudar={setResposta}
            />
          ))}
      </div>
      <Campo
        rotulo="Instrução para a IA (opcional)"
        valor={instrucao}
        desativado={!podeEditar}
        aoMudar={setInstrucao}
      />
      {falta && <p className="text-xs text-destructive">{falta}</p>}
      {podeEditar && mudou && (
        <Button size="sm" variant="outline" disabled={!!falta || salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending ? "Salvando..." : "Salvar instrução"}
        </Button>
      )}
    </div>
  );
}

/**
 * A aba Checklist (perguntas que guiam o orçamento e podem cobrar) e a aba
 * Campos (o que a produção e a arte precisam saber, sem mexer no preço) são a
 * mesma tela com finalidades diferentes: a mesma tabela, o mesmo item do
 * orçamento, a mesma gravação em `orcamento_itens.respostas`.
 */
function AbaChecklist({
  produtoId,
  podeEditar,
  finalidade = "cobranca",
}: {
  produtoId: string;
  podeEditar: boolean;
  finalidade?: "cobranca" | "informacao";
}) {
  const qc = useQueryClient();
  const catalogo = useProcessos();
  const ehCampo = finalidade === "informacao";
  const [pergunta, setPergunta] = useState("");
  const [descricao, setDescricao] = useState("");
  const [obrigatoria, setObrigatoria] = useState(true);
  const [tipo, setTipo] = useState<TipoDeResposta>("unica");
  const [respostasTexto, setRespostasTexto] = useState("Sim, Não");
  const [acoes, setAcoes] = useState<AcaoDaResposta[]>([]);
  const [respostaPadrao, setRespostaPadrao] = useState("");
  const [naoPerguntar, setNaoPerguntar] = useState(false);
  const chave = ["pasta-perguntas", produtoId, finalidade];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_perguntas")
        .select(
          "id, pergunta, descricao, obrigatoria, tipo_resposta, respostas, acoes, resposta_padrao, nao_perguntar, ia_modo, ia_resposta, ia_instrucao, finalidade",
        )
        .eq("produto_id", produtoId)
        .eq("finalidade", finalidade)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const comLista = tipo === "unica" || tipo === "multipla";
  const respostas = comLista ? respostasDoTexto(respostasTexto) : [];
  const pendencia = pendenciaDaPergunta({
    pergunta,
    tipo_resposta: tipo,
    respostas,
    acoes,
    resposta_padrao: respostaPadrao,
    nao_perguntar: naoPerguntar,
    finalidade,
  });
  const nomeDoProcesso = useMemo(
    () => new Map((catalogo.data ?? []).map((c) => [c.id, c.nome])),
    [catalogo.data],
  );

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: ["pasta-historico", produtoId] });
  };
  const adicionar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_perguntas")
        .insert({
          produto_id: produtoId,
          pergunta: pergunta.trim(),
          descricao: descricao.trim() || null,
          obrigatoria,
          tipo_resposta: tipo,
          respostas,
          acoes,
          ordem: (lista.data ?? []).length,
          resposta_padrao: respostaPadrao.trim() || null,
          nao_perguntar: naoPerguntar,
          finalidade,
        })
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: () => {
      setPergunta("");
      setDescricao("");
      setAcoes([]);
      setRespostasTexto("Sim, Não");
      setRespostaPadrao("");
      setNaoPerguntar(false);
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const remover = useMutation({
    mutationFn: async (linhaId: string) => {
      const { data, error } = await (supabase as any)
        .from("produto_perguntas")
        .delete()
        .eq("id", linhaId)
        .select("id");
      if (error) throw error;
      confereGravou(data);
    },
    onSuccess: atualizar,
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <div className="space-y-4">
      {podeEditar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {ehCampo ? "Novo campo para a produção e a arte" : "Nova pergunta para guiar o orçamento"}
            </CardTitle>
            {ehCampo && (
              <p className="text-sm text-muted-foreground">
                O item do orçamento pergunta e a resposta vai para a produção: texto da placa, cor,
                nome no brinde. Não mexe no preço.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <Campo
              rotulo={ehCampo ? "Nome do campo" : "Pergunta"}
              valor={pergunta}
              desativado={false}
              aoMudar={setPergunta}
            />
            <Campo
              rotulo="Explicação (opcional)"
              valor={descricao}
              desativado={false}
              aoMudar={setDescricao}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo de resposta</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDeResposta)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROTULO_DO_TIPO) as TipoDeResposta[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {ROTULO_DO_TIPO[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {comLista && (
                <Campo
                  rotulo="Respostas (separe com vírgula)"
                  valor={respostasTexto}
                  desativado={false}
                  aoMudar={setRespostasTexto}
                />
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={obrigatoria} onCheckedChange={setObrigatoria} /> Obrigatória
            </label>
            <div className="grid items-end gap-3 md:grid-cols-2">
              <Campo
                rotulo="Resposta já marcada (opcional)"
                valor={respostaPadrao}
                desativado={false}
                aoMudar={setRespostaPadrao}
              />
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Switch checked={naoPerguntar} onCheckedChange={setNaoPerguntar} /> Não perguntar: a casa
                já decidiu
              </label>
            </div>
            {comLista && !ehCampo && (
              <div className="space-y-2 rounded border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">O que cada resposta acrescenta</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={respostas.length === 0}
                    onClick={() =>
                      setAcoes((a) => [...a, { resposta: respostas[0], processo_id: "" }])
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" /> Ação
                  </Button>
                </div>
                {acoes.map((a, i) => (
                  <div key={i} className="grid items-center gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <Select
                      value={a.resposta}
                      onValueChange={(v) =>
                        setAcoes((l) => l.map((x, j) => (j === i ? { ...x, resposta: v } : x)))
                      }
                    >
                      <SelectTrigger aria-label="Se a resposta for">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {respostas.map((r) => (
                          <SelectItem key={r} value={r}>
                            Se for: {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={a.processo_id}
                      onValueChange={(v) =>
                        setAcoes((l) => l.map((x, j) => (j === i ? { ...x, processo_id: v } : x)))
                      }
                    >
                      <SelectTrigger aria-label="Acrescenta o processo">
                        <SelectValue placeholder="Acrescenta o processo" />
                      </SelectTrigger>
                      <SelectContent>
                        {(catalogo.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Tirar a ação"
                      onClick={() => setAcoes((l) => l.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {pendencia && pergunta.trim() && (
              <p className="text-xs text-destructive">{pendencia}</p>
            )}
            <Button
              disabled={!!pendencia || adicionar.isPending}
              onClick={() => adicionar.mutate()}
            >
              <Plus className="mr-1.5 h-4 w-4" /> {ehCampo ? "Acrescentar campo" : "Acrescentar pergunta"}
            </Button>
          </CardContent>
        </Card>
      )}
      <Card data-testid={ehCampo ? "campos-do-produto" : "checklist-do-produto"}>
        <CardContent className="space-y-2 pt-6">
          {(lista.data ?? []).length === 0 && !lista.isLoading && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {ehCampo
                ? "Nenhum campo neste produto: a produção recebe só o acabamento e a descrição do item."
                : "Nenhuma pergunta neste produto."}
            </p>
          )}
          {(lista.data ?? []).map((q) => (
            <div key={q.id} className="flex items-start justify-between gap-2 rounded border p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {q.pergunta}
                  {q.obrigatoria && <Badge variant="outline">Obrigatória</Badge>}
                  {q.nao_perguntar && <Badge variant="outline">Não pergunta</Badge>}
                </div>
                {q.descricao && <div className="text-xs text-muted-foreground">{q.descricao}</div>}
                <div className="text-xs text-muted-foreground">
                  {ROTULO_DO_TIPO[q.tipo_resposta as TipoDeResposta]}
                  {(q.respostas ?? []).length > 0 && `: ${(q.respostas as string[]).join(", ")}`}
                  {q.resposta_padrao && `. Já vem marcada: ${q.resposta_padrao}`}
                </div>
                {(q.acoes as AcaoDaResposta[]).map((a, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    Se for {a.resposta}, acrescenta{" "}
                    {nomeDoProcesso.get(a.processo_id) ?? "processo removido"}.
                  </div>
                ))}
                <InstrucaoDaIa pergunta={q} podeEditar={podeEditar} aoSalvar={atualizar} />
              </div>
              {podeEditar && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={remover.isPending}
                  aria-label={`Tirar a pergunta ${q.pergunta}`}
                  onClick={() => remover.mutate(q.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AbaHistorico({ produtoId }: { produtoId: string }) {
  const { hasRole } = useAuth();
  const pode = hasRole("admin") || hasRole("gestor");
  const lista = useQuery({
    queryKey: ["pasta-historico", produtoId],
    enabled: pode,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("logs_auditoria")
        .select("id, acao, detalhes, created_at")
        .eq("entidade", "produtos")
        .eq("entidade_id", produtoId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  if (!pode)
    return (
      <p className="text-sm text-muted-foreground">
        O histórico é visto por administrador e gestor.
      </p>
    );
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {lista.isLoading && <Carregando />}
        {!lista.isLoading && (lista.data ?? []).length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhuma alteração registrada desde 01/11/2026.
          </p>
        )}
        {(lista.data ?? []).map((l) => (
          <div
            key={l.id}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2 text-sm last:border-0"
          >
            <span>{frasesDoHistorico(l.acao, l.detalhes)}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {new Date(l.created_at).toLocaleString("pt-BR")}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
