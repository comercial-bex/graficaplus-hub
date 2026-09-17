import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, Tags, Zap } from "lucide-react";
import { carregarCatalogo, carregarPainel, CHAVE_CATALOGO, CHAVE_PAINEL } from "@/lib/parceiro-api";
import { brl, unidadeLegivel, type ItemDoCatalogo } from "@/domain/parceiros/preco";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/parceiro/tabela")({
  component: TabelaDoParceiro,
});

/**
 * A tabela de parceiro: o que ele paga, ao lado do preço de balcão.
 *
 * O preço de balcão fica visível de propósito. É o argumento de venda dele ("a
 * gráfica cobra R$ 70 o m²; eu faço por esse preço e ainda te atendo") e é a
 * medida do ganho — sem a referência, o desconto é um número solto.
 */
function TabelaDoParceiro() {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  const { data: catalogo = [], isLoading } = useQuery({
    queryKey: CHAVE_CATALOGO,
    queryFn: carregarCatalogo,
    staleTime: 5 * 60_000,
  });

  const categorias = useMemo(
    () => [...new Set(catalogo.map((p) => p.categoria || "Outros"))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [catalogo],
  );

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return catalogo.filter(
      (p) =>
        (!categoria || (p.categoria || "Outros") === categoria) &&
        (!termo || `${p.nome} ${p.categoria ?? ""}`.toLowerCase().includes(termo)),
    );
  }, [catalogo, busca, categoria]);

  const emOferta = catalogo.filter((p) => p.origem === "oferta" || hasOfertaNaFaixa(p));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Tags className="h-6 w-6 text-[color:var(--bex-cyan)]" />
          Sua tabela
        </h1>
        <p className="text-sm text-muted-foreground">
          Preços de parceiro {painel?.nivel.nome ? `${painel.nivel.nome} ` : ""}para pedidos feitos à gráfica. Ofertas
          ativas já estão aplicadas.
        </p>
      </div>

      {emOferta.length > 0 && (
        <div className="flex gap-3 rounded-2xl border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-4 text-sm">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
          <p>
            Em oferta agora: {emOferta.map((p) => p.nome).join(", ")}.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto"
            className="pl-9"
            aria-label="Buscar produto"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Filtro ativo={categoria === null} onClick={() => setCategoria(null)}>
            Todos
          </Filtro>
          {categorias.map((c) => (
            <Filtro key={c} ativo={categoria === c} onClick={() => setCategoria(c)}>
              {c}
            </Filtro>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : visiveis.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhum produto encontrado.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {visiveis.map((p) => (
            <li key={p.produto_id} className="p-4">
              <Produto produto={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hasOfertaNaFaixa(p: ItemDoCatalogo) {
  return !!p.oferta_id && !!p.faixas;
}

function Produto({ produto: p }: { produto: ItemDoCatalogo }) {
  const un = unidadeLegivel(p.unidade);
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="font-medium">
          {p.nome}
          {p.oferta_id && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--bex-amber)]/15 px-2 py-0.5 align-middle text-[11px] font-medium text-[color:var(--bex-amber)]">
              <Zap className="h-3 w-3" /> {p.oferta_titulo ?? "Oferta"}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {p.categoria || "Outros"}
          {p.por_area && p.area_minima ? ` · peça mínima cobrada ${Number(p.area_minima).toLocaleString("pt-BR")} m²` : ""}
        </p>
      </div>

      {p.faixas ? (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pr-4 text-left font-medium">A partir de</th>
                <th className="pr-4 text-right font-medium">Você paga</th>
                <th className="text-right font-medium">Balcão</th>
              </tr>
            </thead>
            <tbody>
              {p.faixas.map((f) => (
                <tr key={f.quantidade_minima}>
                  <td className="pr-4 tabular-nums">
                    {f.quantidade_minima} {un}
                  </td>
                  <td className="pr-4 text-right font-semibold tabular-nums">{brl(f.preco_parceiro)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{brl(f.preco_referencia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex items-baseline gap-3 md:justify-end">
          <span className="text-lg font-semibold tabular-nums">
            {p.preco_parceiro === null ? "—" : brl(p.preco_parceiro)}
            <span className="text-xs font-normal text-muted-foreground">/{un}</span>
          </span>
          {p.preco_referencia !== null && p.preco_parceiro !== null && p.preco_referencia > p.preco_parceiro && (
            <span className="text-sm text-muted-foreground">
              balcão <span className="line-through">{brl(p.preco_referencia)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Filtro({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors",
        ativo
          ? "border-[color:var(--bex-cyan)] bg-[color:var(--bex-cyan)]/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
