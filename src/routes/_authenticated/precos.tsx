import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { lerPrecosPorProduto, proporPreco } from "@/lib/api/precos-por-produto.functions";
import {
  contar,
  familiasDe,
  filtrar,
  ordenar,
  ROTULO_DO_PROBLEMA,
  type FiltroDeProblema,
  type Ordem,
  type Problema,
} from "@/domain/precos/painel-de-precos";
import {
  LEGENDA_DA_REGRA,
  LEGENDA_DAS_SITUACOES,
  ListaDePrecos,
  type PedirPreco,
} from "@/components/precos/painel-de-precos";
import { MapaDeMargem } from "@/components/precos/mapa-de-margem";
import {
  ROTULO_DA_COLUNA_DO_MAPA,
  ROTULO_DA_LINHA_DO_MAPA,
  type CelulaDoMapa,
} from "@/domain/precos/custo-real";
import { TEXTO_DA_VELOCIDADE_DA_PLOTTER } from "@/domain/maquinas/velocidade-de-calculo";
import { LEGENDA_DO_MINIMO, textosDoPrecoMinimo } from "@/domain/precos/preco-minimo";

export const Route = createFileRoute("/_authenticated/precos")({
  head: () => ({ meta: [{ title: "Preços por produto — BEX PRINT OS" }] }),
  component: PrecosPage,
});

const CHAVE_DOS_PRECOS = ["precos-por-produto"];

const NUMEROS: Problema[] = [
  "abaixo",
  "abaixo_do_minimo",
  "sem_custo",
  "sem_preco",
  "parceiro_acima",
];
const ORDENS: Array<{ valor: Ordem; rotulo: string }> = [
  { valor: "problema", rotulo: "Problemas primeiro" },
  { valor: "nome", rotulo: "Nome" },
  { valor: "preco", rotulo: "Preço, do menor ao maior" },
  { valor: "margem", rotulo: "Margem, da menor à maior" },
];

const BOTAO_FILTRO =
  "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PrecosPage() {
  const qc = useQueryClient();
  const ler = useServerFn(lerPrecosPorProduto);
  const pedir = useServerFn(proporPreco);
  const painel = useQuery({ queryKey: CHAVE_DOS_PRECOS, queryFn: () => ler() });
  const [familia, setFamilia] = useState<string | null>(null);
  const [problema, setProblema] = useState<FiltroDeProblema>("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("problema");
  const [visao, setVisao] = useState<"lista" | "mapa">("lista");
  const [celula, setCelula] = useState<CelulaDoMapa | null>(null);

  const criando = useMutation({
    mutationFn: (v: { produtoId: string; preco: number; motivo: string }) => pedir({ data: v }),
    onSuccess: () => {
      toast.success("Proposta criada. Ela espera aprovação em preços pendentes.");
      void qc.invalidateQueries({ queryKey: ["precos-pendentes"] });
    },
  });
  const propor: PedirPreco = async (v) => {
    try {
      await criando.mutateAsync(v);
    } catch (e) {
      throw new Error(mensagemErro(e));
    }
  };

  const linhas = painel.data?.linhas;
  const contagem = useMemo(() => contar(linhas ?? []), [linhas]);
  // O preço de parceiro baixo é problema de preço e não deixa o custo real otimista: fica fora da conta de custo faltando.
  const pendenciasDoBanco = painel.data?.pendencias ?? [];
  const faltasDeCusto = pendenciasDoBanco.filter((p) => p.tipo !== "parceiro");
  const parceirosAbaixoDoPiso = pendenciasDoBanco.filter((p) => p.tipo === "parceiro");
  const textos = textosDoPrecoMinimo(painel.data?.parametrosDoMinimo ?? null);
  const familias = useMemo(() => familiasDe(linhas ?? []), [linhas]);
  const visiveis = useMemo(
    () => ordenar(filtrar(linhas ?? [], { familia, problema, busca, celula }), ordem),
    [linhas, familia, problema, busca, ordem, celula],
  );
  // O mapa conta o que a família e a busca deixam, mas não o próprio toque na célula.
  const doMapa = useMemo(
    () => filtrar(linhas ?? [], { familia, problema, busca }),
    [linhas, familia, problema, busca],
  );

  return (
    <div className="space-y-4 text-base">
      <SectionHeader
        breadcrumb="Custeio"
        title="Preços por produto"
        description="Veja o custo real, a margem líquida, a regra de três e o preço mínimo recomendado de cada produto e peça a mudança de preço. O preço só muda depois que alguém aprova em preços pendentes."
        ajuda={dicaTela("/precos")}
        legivel
      />

      {painel.isLoading ? (
        <Carregando />
      ) : painel.isError ? (
        <Card>
          <CardContent className="p-4 text-base text-destructive" role="alert">
            Não deu para carregar os preços. {mensagemErro(painel.error)}
          </CardContent>
        </Card>
      ) : painel.data ? (
        <>
          <div
            className="grid grid-cols-2 gap-3 lg:grid-cols-5"
            role="group"
            aria-label="Problemas encontrados, toque para filtrar"
          >
            {NUMEROS.filter((p) => p !== "abaixo_do_minimo" || !painel.data.avisoDoMinimo).map((p) => {
              const ativo = problema === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setProblema(ativo ? "todos" : p)}
                  className={cn(
                    "min-h-11 rounded-xl border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ativo ? "border-primary ring-2 ring-primary" : "border-border",
                  )}
                  data-testid={`numero-${p}`}
                >
                  <span className="block text-3xl font-bold">{contagem[p]}</span>
                  <span className="block text-base">{ROTULO_DO_PROBLEMA[p]}</span>
                </button>
              );
            })}
          </div>

          {painel.data.avisoDoCustoReal ? (
            <p
              className="rounded-xl border border-[#8a5a00] bg-card p-4 font-semibold dark:border-[#f5b942]"
              role="status"
              data-testid="aviso-do-custo-real"
            >
              {painel.data.avisoDoCustoReal}
            </p>
          ) : null}

          {painel.data.avisoDoMinimo ? (
            <p
              className="rounded-xl border border-[#8a5a00] bg-card p-4 font-semibold dark:border-[#f5b942]"
              role="status"
              data-testid="aviso-do-minimo"
            >
              {painel.data.avisoDoMinimo}
            </p>
          ) : null}

          {faltasDeCusto.length > 0 ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#8a5a00] bg-card p-4 dark:border-[#f5b942]"
              role="status"
              data-testid="aviso-de-pendencias-de-custo"
            >
              <p className="min-w-0 flex-1 basis-64">
                <span className="font-semibold">
                  {faltasDeCusto.length === 1
                    ? "Falta 1 item de custo para fechar."
                    : `Faltam ${faltasDeCusto.length} itens de custo para fechar.`}
                </span>{" "}
                Custo fixo se preenche em Custos fixos e mão de obra. Material sem custo se corrige
                no cadastro do material. Enquanto faltarem, o custo real é um piso otimista e a
                margem mostrada é maior que a verdadeira.
              </p>
              <Button asChild variant="outline" className="h-11 min-h-11 text-base">
                <Link to="/custos-producao">Preencher custos fixos</Link>
              </Button>
            </div>
          ) : null}

          {parceirosAbaixoDoPiso.length > 0 ? (
            <p
              className="rounded-xl border border-[#8a5a00] bg-card p-4 dark:border-[#f5b942]"
              role="status"
              data-testid="aviso-de-parceiro-abaixo-do-piso"
            >
              <span className="font-semibold">
                {parceirosAbaixoDoPiso.length === 1
                  ? "1 preço de parceiro está abaixo do piso líquido."
                  : `${parceirosAbaixoDoPiso.length} preços de parceiro estão abaixo do piso líquido.`}
              </span>{" "}
              Isso é problema de preço, não de custo faltando. Corrija no preço do produto.
            </p>
          ) : null}

          {contagem.abaixo > 0 ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#b42318] bg-card p-4 dark:border-[#ff8a80]"
              role="status"
              data-testid="aviso-abaixo-do-piso"
            >
              <p className="min-w-0 flex-1 basis-64 font-semibold">
                {contagem.abaixo === 1
                  ? "Este produto vende abaixo do piso."
                  : `Estes ${contagem.abaixo} produtos vendem abaixo do piso.`}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 text-base"
                onClick={() => setProblema("abaixo")}
              >
                Ver só {contagem.abaixo === 1 ? "este" : "estes"}
              </Button>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por família">
              <button
                type="button"
                aria-pressed={familia === null}
                onClick={() => setFamilia(null)}
                className={cn(
                  BOTAO_FILTRO,
                  familia === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card",
                )}
              >
                Todas as famílias
              </button>
              {familias.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={familia === f}
                  onClick={() => setFamilia(familia === f ? null : f)}
                  className={cn(
                    BOTAO_FILTRO,
                    familia === f
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-56 flex-1">
                <span className="font-medium">Buscar produto</span>
                <Input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Digite parte do nome"
                  className="mt-1 h-11 text-base md:text-base"
                />
              </label>
              <label className="block">
                <span className="font-medium">Ordem</span>
                <select
                  value={ordem}
                  onChange={(e) => setOrdem(e.target.value as Ordem)}
                  className="mt-1 block h-11 w-full min-w-56 rounded-md border border-input bg-card px-3 text-base"
                >
                  {ORDENS.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              {problema !== "todos" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-h-11 text-base"
                  onClick={() => setProblema("todos")}
                >
                  Limpar filtro: {ROTULO_DO_PROBLEMA[problema]}
                </Button>
              ) : null}
            </div>
          </div>

          {celula ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="filtro-do-mapa">
              <p className="font-semibold">
                Filtro do mapa: {ROTULO_DA_LINHA_DO_MAPA[celula.margem]}, {ROTULO_DA_COLUNA_DO_MAPA[celula.vezes]}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 text-base"
                onClick={() => setCelula(null)}
              >
                Limpar filtro do mapa
              </Button>
            </div>
          ) : null}

          <Tabs value={visao} onValueChange={(v) => setVisao(v === "mapa" ? "mapa" : "lista")}>
            <TabsList className="h-auto p-1">
              <TabsTrigger value="lista" className="min-h-11 px-4 text-base">
                Lista
              </TabsTrigger>
              <TabsTrigger value="mapa" className="min-h-11 px-4 text-base">
                Mapa de margem
              </TabsTrigger>
            </TabsList>
            <TabsContent value="mapa" className="mt-3">
              <MapaDeMargem linhas={doMapa} celula={celula} aoEscolher={setCelula} />
            </TabsContent>
          </Tabs>

          <section
            className="space-y-2 rounded-xl border border-border bg-card p-4"
            data-testid="texto-do-preco-minimo"
            aria-label="Como sai o preço mínimo recomendado"
          >
            <h2 className="text-base font-bold">Como sai o preço mínimo recomendado</h2>
            <p>{textos.formula}</p>
            <p data-testid="texto-da-ocupacao">{textos.ocupacao}</p>
            <p>{textos.nomes}</p>
            <Button asChild variant="outline" className="h-11 min-h-11 text-base">
              <Link to="/custos-producao">Ajustar ocupação e multiplicador</Link>
            </Button>
          </section>

          <div className="space-y-2" data-testid="legendas">
            <ul className="space-y-1" aria-label="Legenda da margem líquida">
              {LEGENDA_DAS_SITUACOES.map((l) => (
                <li key={l.faixa}>{l.texto}</li>
              ))}
            </ul>
            <ul className="space-y-1" aria-label="Legenda da diferença contra a regra de três">
              {LEGENDA_DA_REGRA.map((l) => (
                <li key={l.faixa}>{l.texto}</li>
              ))}
            </ul>
            <ul className="space-y-1" aria-label="Legenda do preço mínimo recomendado">
              {LEGENDA_DO_MINIMO.map((l) => (
                <li key={l.faixa}>{l.texto}</li>
              ))}
            </ul>
            <p data-testid="texto-da-velocidade">
              Plotter i1600. {TEXTO_DA_VELOCIDADE_DA_PLOTTER}
            </p>
            <p data-testid="texto-da-regra-de-tres">
              A referência de três vezes o custo real serve só para comparar. Ela não manda subir o preço. O preço mínimo recomendado é outra conta, feita sobre o material com perda e falha.
            </p>
          </div>

          {!painel.data.podePropor ? (
            <p className="rounded-xl border border-border bg-card p-4" data-testid="so-leitura">
              Só administrador ou gerente pede mudança de preço. Você pode ver o piso e a margem.
            </p>
          ) : null}

          <p aria-live="polite" data-testid="contagem-da-lista">
            {visiveis.length === 1
              ? "1 produto na lista."
              : `${visiveis.length} produtos na lista.`}
          </p>

          {visiveis.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-base" data-testid="estado-vazio">
                <p className="font-semibold">Nenhum produto com esse filtro.</p>
                <p className="mt-1">Limpe o filtro ou mude a busca.</p>
              </CardContent>
            </Card>
          ) : (
            <ListaDePrecos linhas={visiveis} propor={propor} podePropor={painel.data.podePropor} />
          )}
        </>
      ) : null}
    </div>
  );
}
