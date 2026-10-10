import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { useAuth } from "@/lib/auth-context";
import { ROTULO_DA_CATEGORIA, type Categoria } from "@/domain/catalogo/categorias-da-loja";
import {
  lerPainelDePrecos,
  type CatalogoNoPainel,
} from "@/domain/catalogo/painel-de-precos";

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const porcento = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

function rotuloDaCategoria(c: string): string {
  return ROTULO_DA_CATEGORIA[c as Categoria] ?? c;
}

/**
 * Como ficou o preço de venda do catálogo de brindes — o painel que o dono
 * pediu em 10/10/2026 ao fixar a margem em 85% ("mostra pro Admin e Gerente
 * também um painel"). Só para quem gerencia o catálogo E vê o financeiro: o
 * cartão mostra custo ao lado do preço, e margem com preço é custo disfarçado.
 * O banco confere as mesmas duas portas (catalogo_painel_de_precos).
 */
export function PrecoDoCatalogo() {
  const { hasPermission, canSeeFinancials } = useAuth();
  const pode = hasPermission("catalogo.manage") && canSeeFinancials;

  const consulta = useQuery({
    queryKey: ["catalogo-painel-de-precos"],
    enabled: pode,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("catalogo_painel_de_precos");
      if (error) throw error;
      return lerPainelDePrecos(data);
    },
  });

  if (!pode) return null;

  if (consulta.isError) {
    return (
      <FalhaDeConsulta
        titulo="Não deu para carregar o preço do catálogo"
        erro={consulta.error}
        onTentarDeNovo={() => void consulta.refetch()}
      />
    );
  }

  if (!consulta.data) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (consulta.data.length === 0) return null;
  return (
    <>
      {consulta.data.map((c) => (
        <CartaoDoCatalogo key={c.catalogo_id} catalogo={c} />
      ))}
    </>
  );
}

function CartaoDoCatalogo({ catalogo }: { catalogo: CatalogoNoPainel }) {
  const { regra, totais, categorias } = catalogo;
  const semRegra = regra?.margem_pct == null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" /> Catálogo de brindes · preço de venda
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {catalogo.titulo}. Custo e margem só aparecem para a gerência; o cliente e o vendedor veem só o
            preço.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-10">
            <Link to="/catalogos">
              Ver a loja <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="sm" className="min-h-10">
            <Link to="/catalogos/$id" params={{ id: catalogo.catalogo_id }} search={{ aba: "regra" }}>
              <Settings2 className="mr-1 h-4 w-4" /> Ajustar a margem
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Margem sobre o custo</p>
            <p className="text-2xl font-bold">{semRegra ? "sem regra" : porcento(regra?.margem_pct)}</p>
            <p className="text-xs text-muted-foreground">
              {semRegra
                ? "Tudo fica sob consulta até a margem ser gravada."
                : `Preço = custo × ${(1 + Number(regra?.margem_pct ?? 0) / 100).toLocaleString("pt-BR", {
                    maximumFractionDigits: 4,
                  })}${regra?.frete_por_peca ? ` + ${brl(regra.frete_por_peca)} de frete por peça` : ""}.`}
              {catalogo.excecoes > 0 ? ` ${catalogo.excecoes} exceção(ões) por seção ou item.` : ""}
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Itens com preço</p>
            <p className="text-2xl font-bold">
              {totais.itens_com_preco.toLocaleString("pt-BR")}
              <span className="text-base font-medium text-muted-foreground">
                {" "}
                de {totais.itens.toLocaleString("pt-BR")}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {totais.opcoes_sob_consulta > 0
                ? `${totais.opcoes_sob_consulta} opção(ões) sem custo na tabela ficam "sob consulta".`
                : "Nenhuma opção ficou sob consulta."}
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Regra gravada</p>
            <p className="text-base font-semibold">{regra?.atualizado_por ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {regra?.atualizado_em
                ? new Date(regra.atualizado_em).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "America/Belem",
                  })
                : "ainda não gravada"}
            </p>
          </div>
        </div>

        {categorias.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Categoria</th>
                  <th className="py-2 pr-3 font-medium">Itens</th>
                  <th className="py-2 pr-3 font-medium">Preços de</th>
                  <th className="py-2 font-medium">Exemplo: custo → venda (ganho por peça)</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.categoria} className="border-b border-border/60 last:border-0 align-top">
                    <td className="py-2 pr-3 font-medium">{rotuloDaCategoria(c.categoria)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {c.itens_com_preco === c.itens ? c.itens : `${c.itens_com_preco} de ${c.itens}`}
                    </td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                      {brl(c.menor_preco)} a {brl(c.maior_preco)}
                    </td>
                    <td className="py-2">
                      {c.exemplo ? (
                        <span>
                          <span className="font-mono text-xs text-muted-foreground">{c.exemplo.codigo_bex}</span>{" "}
                          {c.exemplo.nome}:{" "}
                          <span className="tabular-nums whitespace-nowrap">
                            {brl(c.exemplo.custo)} → <strong>{brl(c.exemplo.preco)}</strong> (
                            {brl(c.exemplo.ganho)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">sem preço</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
