/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carregarCatalogo, carregarPainel, CHAVE_CATALOGO, CHAVE_PAINEL } from "@/lib/parceiro-api";
import { brl, resumoDoOrcamento, type ItemDoOrcamento } from "@/domain/parceiros/preco";
import { STATUS_DO_ORCAMENTO, type StatusDoOrcamento } from "@/domain/parceiros/painel";
import { NovoOrcamento } from "@/components/parceiro/novo-orcamento";
import { StatusChip } from "@/components/bex/StatusChip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/parceiro/orcamentos/")({
  component: OrcamentosDoParceiro,
});

type Linha = {
  id: string;
  numero: number;
  titulo: string;
  cliente_nome: string;
  status: StatusDoOrcamento;
  created_at: string;
  updated_at: string;
  itens: ItemDoOrcamento[];
};

const FILTROS = [
  { chave: "abertos", rotulo: "Em aberto", status: ["rascunho", "enviado", "aprovado"] },
  { chave: "pedidos", rotulo: "Viraram pedido", status: ["pedido_feito"] },
  { chave: "perdidos", rotulo: "Perdidos", status: ["perdido"] },
  { chave: "todos", rotulo: "Todos", status: null },
] as const;

function OrcamentosDoParceiro() {
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["chave"]>("abertos");
  const [busca, setBusca] = useState("");

  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  const { data: catalogo = [] } = useQuery({ queryKey: CHAVE_CATALOGO, queryFn: carregarCatalogo, staleTime: 5 * 60_000 });
  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["parceiro-orcamentos"],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase as any)
        .from("parceiro_orcamentos")
        .select(
          "id, numero, titulo, cliente_nome, status, created_at, updated_at, " +
            "itens:parceiro_orcamento_itens(produto_id, descricao, unidade, largura, altura, quantidade, preco_venda_unidade)",
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  const porProduto = useMemo(() => new Map(catalogo.map((p) => [p.produto_id, p])), [catalogo]);

  const visiveis = useMemo(() => {
    const f = FILTROS.find((x) => x.chave === filtro);
    const termo = busca.trim().toLowerCase();
    return linhas.filter(
      (l) =>
        (!f?.status || (f.status as readonly string[]).includes(l.status)) &&
        (!termo || `${l.titulo} ${l.cliente_nome} ${l.numero}`.toLowerCase().includes(termo)),
    );
  }, [linhas, filtro, busca]);

  if (!painel) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Orçamentos</h1>
          <p className="text-sm text-muted-foreground">
            Seus orçamentos, com a sua marca. O cliente é seu: a gráfica não vê estes dados.
          </p>
        </div>
        <NovoOrcamento parceiroId={painel.parceiro.id} className="w-full sm:w-auto" />
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1" role="tablist">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              role="tab"
              aria-selected={filtro === f.chave}
              onClick={() => setFiltro(f.chave)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                filtro === f.chave ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Cliente, título ou número"
            className="pl-9"
            aria-label="Buscar orçamento"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">
            {linhas.length === 0 ? "Nenhum orçamento ainda" : "Nada neste filtro"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {linhas.length === 0
              ? "Crie o primeiro: coloque os itens, confira o seu ganho e baixe o PDF com a sua marca."
              : "Troque o filtro ou a busca."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((l) => {
            const resumo = resumoDoOrcamento(l.itens ?? [], porProduto);
            const st = STATUS_DO_ORCAMENTO[l.status] ?? STATUS_DO_ORCAMENTO.rascunho;
            return (
              <li key={l.id}>
                <Link
                  to="/parceiro/orcamentos/$id"
                  params={{ id: l.id }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-foreground/5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span className="text-muted-foreground">nº {l.numero} · </span>
                      {l.titulo}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {l.cliente_nome} · {(l.itens ?? []).length}{" "}
                      {(l.itens ?? []).length === 1 ? "item" : "itens"} · atualizado{" "}
                      {new Date(l.updated_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-semibold tabular-nums">{brl(resumo.venda)}</span>
                    <StatusChip label={st.rotulo} tone={st.tom} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
