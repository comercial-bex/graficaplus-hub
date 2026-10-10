import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ChevronLeft, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { dataCurta } from "@/domain/portal/link-do-portal";
import { semPrecoDeVenda, type FiltroDoCatalogo } from "@/domain/catalogo/itens";
import { lerCatalogo, lerFotos, lerItens, lerPrecos, lerSecoes } from "@/components/catalogo/consultas";
import { ItensDoCatalogo } from "@/components/catalogo/itens-do-catalogo";
import { RegraDeVendaPainel } from "@/components/catalogo/regra-de-venda";
import { SincronizarPlanilha } from "@/components/catalogo/sincronizar-planilha";
import { FotosEmLote } from "@/components/catalogo/fotos-em-lote";
import { LinksDoCatalogo } from "@/components/catalogo/links-do-catalogo";
import type { PermissoesDoCatalogo } from "@/components/catalogo/cartao-do-item";

type Aba = "itens" | "regra" | "planilha" | "fotos" | "links";
const ABAS: readonly Aba[] = ["itens", "regra", "planilha", "fotos", "links"];

export const Route = createFileRoute("/_authenticated/catalogos/$id")({
  head: () => ({ meta: [{ title: "Catálogo do fornecedor — BEX PRINT OS" }] }),
  // ?aba=regra abre direto na regra de venda (o painel de preço do Início leva para lá).
  validateSearch: (busca: Record<string, unknown>): { aba?: Aba } =>
    typeof busca.aba === "string" && (ABAS as readonly string[]).includes(busca.aba)
      ? { aba: busca.aba as Aba }
      : {},
  component: CatalogoPage,
});

/**
 * Um catálogo de fornecedor por dentro.
 *
 *   Itens     todos com catalogo.read; preço para quem vê preço, custo para o
 *             financeiro; "Adicionar ao orçamento"; escolher itens para o link
 *   Regra     margem/frete/arredondamento, com prévia (gestão que vê financeiro)
 *   Planilha  sincronizar com a tabela nova do fornecedor (idem)
 *   Fotos     fotos em lote pelo código (catalogo.manage)
 *   Links     links de vitrine gerados, com cancelamento (catalogo.manage)
 *
 * As abas seguem as mesmas permissões que o banco confere em cada função: a
 * aba que não abre para a pessoa nem aparece.
 */
function CatalogoPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { hasPermission, canSeePrices, canSeeFinancials } = useAuth();
  const gerenciar = hasPermission("catalogo.manage");
  const { aba: abaPedida } = Route.useSearch();
  const [aba, setAba] = useState<Aba>(abaPedida ?? "itens");
  const [filtroInicial, setFiltroInicial] = useState<FiltroDoCatalogo>("todos");

  const catalogo = useQuery({ queryKey: ["catalogo", id], queryFn: () => lerCatalogo(id) });
  const secoes = useQuery({ queryKey: ["catalogo-secoes", id], queryFn: () => lerSecoes(id) });
  const itens = useQuery({ queryKey: ["catalogo-itens", id], queryFn: () => lerItens(id) });
  const fotos = useQuery({ queryKey: ["catalogo-fotos", id], queryFn: () => lerFotos(id) });
  const precos = useQuery({
    queryKey: ["catalogo-precos", id],
    enabled: canSeePrices,
    queryFn: () => lerPrecos(id),
  });

  const permissoes: PermissoesDoCatalogo = {
    gerenciar,
    // Preço que não carregou NÃO vira "sob consulta" em todos os itens: o cartão
    // esconde o preço e o aviso abaixo diz que a consulta caiu.
    vePreco: canSeePrices && precos.isSuccess,
    veCusto: canSeeFinancials && precos.data?.nivel === "financeiro",
    orcar: canSeePrices && precos.isSuccess && hasPermission("orcamentos.update"),
  };
  const editaDinheiro = gerenciar && canSeeFinancials;

  function recarregarItens() {
    qc.invalidateQueries({ queryKey: ["catalogo-itens", id] });
    qc.invalidateQueries({ queryKey: ["catalogo-fotos", id] });
    qc.invalidateQueries({ queryKey: ["catalogo-precos", id] });
    qc.invalidateQueries({ queryKey: ["catalogo-resumo"] });
  }

  if (catalogo.isLoading || secoes.isLoading || itens.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Carregando o catálogo…</CardContent>
      </Card>
    );
  }

  const falha = catalogo.error ?? secoes.error ?? itens.error;
  if (falha || !catalogo.data || !secoes.data || !itens.data) {
    return (
      <Card>
        <CardContent role="alert" className="space-y-2 p-6 text-sm">
          <p className="font-medium">Não deu para abrir o catálogo.</p>
          <p className="text-muted-foreground">{mensagemErro(falha)}</p>
          <p className="text-muted-foreground">Isto é uma falha de consulta, não um catálogo vazio.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => {
                void catalogo.refetch();
                void secoes.refetch();
                void itens.refetch();
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
            <Button asChild variant="ghost" className="h-11 md:h-9">
              <Link to="/catalogos/gerenciar">
                <ChevronLeft className="mr-1 h-4 w-4" /> Catálogos
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const c = catalogo.data;
  const lista = itens.data;
  const tudoSobConsulta =
    precos.isSuccess && lista.length > 0 && lista.every((i) => semPrecoDeVenda(i, precos.data));
  const semFoto = lista.filter((i) => !i.tem_foto).length;
  const aConferir = lista.filter((i) => i.foto_conferir).length;

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/catalogos")}
        breadcrumb={`Catálogos · ${c.fornecedor}`}
        title={c.titulo}
        description={[
          c.edicao ? `Tabela ${c.edicao}` : null,
          c.sincronizado_em
            ? `sincronizado em ${dataCurta(c.sincronizado_em)}`
            : c.importado_em
              ? `carregado em ${dataCurta(c.importado_em)}`
              : "ainda sem planilha",
          `${lista.length} itens`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Button asChild variant="outline" className="h-11 md:h-9">
            <Link to="/catalogos/gerenciar">
              <ChevronLeft className="mr-1 h-4 w-4" /> Catálogos
            </Link>
          </Button>
        }
      />

      {canSeePrices && precos.isError && (
        <FalhaDeConsulta
          titulo="Os preços de venda não carregaram"
          erro={precos.error}
          onTentarDeNovo={() => void precos.refetch()}
        />
      )}
      {fotos.isError && (
        <FalhaDeConsulta
          titulo="As fotos não carregaram"
          erro={fotos.error}
          onTentarDeNovo={() => void fotos.refetch()}
        />
      )}
      {tudoSobConsulta && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            Este catálogo ainda não tem regra de venda: todos os itens estão "sob consulta" — no sistema e no link
            do cliente.{" "}
            {editaDinheiro ? (
              <button type="button" className="underline underline-offset-2" onClick={() => setAba("regra")}>
                Definir a margem
              </button>
            ) : (
              "Quem define a margem é a gestão."
            )}
          </div>
        </div>
      )}

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="itens" className="min-h-10">
            Itens
          </TabsTrigger>
          {editaDinheiro && (
            <TabsTrigger value="regra" className="min-h-10">
              Regra de venda
            </TabsTrigger>
          )}
          {editaDinheiro && (
            <TabsTrigger value="planilha" className="min-h-10">
              Planilha
            </TabsTrigger>
          )}
          {gerenciar && (
            <TabsTrigger value="fotos" className="min-h-10">
              Fotos
            </TabsTrigger>
          )}
          {gerenciar && (
            <TabsTrigger value="links" className="min-h-10">
              Links para clientes
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="itens" className="mt-4">
          <ItensDoCatalogo
            catalogoId={id}
            itens={lista}
            secoes={secoes.data}
            fotos={fotos.data ?? []}
            precos={precos.isSuccess ? precos.data : null}
            permissoes={permissoes}
            filtroInicial={filtroInicial}
            onMudou={recarregarItens}
          />
        </TabsContent>

        {editaDinheiro && (
          <TabsContent value="regra" className="mt-4">
            {precos.isSuccess ? (
              <RegraDeVendaPainel catalogoId={id} secoes={secoes.data} itens={lista} precos={precos.data} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {precos.isError ? "A regra precisa dos custos, que não carregaram (veja o aviso acima)." : "Carregando os custos…"}
              </p>
            )}
          </TabsContent>
        )}

        {editaDinheiro && (
          <TabsContent value="planilha" className="mt-4">
            <SincronizarPlanilha
              catalogoId={id}
              fornecedor={c.fornecedor}
              secoes={secoes.data}
              itens={lista}
              precos={precos.isSuccess ? precos.data : null}
            />
          </TabsContent>
        )}

        {gerenciar && (
          <TabsContent value="fotos" className="mt-4 space-y-3">
            <FotosEmLote catalogoId={id} semFoto={semFoto} aConferir={aConferir} onRegistradas={recarregarItens} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => {
                  setFiltroInicial("foto_a_conferir");
                  setAba("itens");
                }}
              >
                Ver os {aConferir} itens com foto a conferir
              </Button>
              <Button
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => {
                  setFiltroInicial("sem_foto");
                  setAba("itens");
                }}
              >
                Ver os {semFoto} itens sem foto
              </Button>
            </div>
          </TabsContent>
        )}

        {gerenciar && (
          <TabsContent value="links" className="mt-4">
            <LinksDoCatalogo catalogoId={id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
