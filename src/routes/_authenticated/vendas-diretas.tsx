/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { DataPanel } from "@/components/bex/DataPanel";
import { StatusChip } from "@/components/bex/StatusChip";
import { Carregando } from "@/components/bex/Carregando";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { situacaoDoPagamento, valoresDoPagamento } from "@/domain/parceiros/venda-direta";

export const Route = createFileRoute("/_authenticated/vendas-diretas")({
  head: () => ({
    meta: [
      { title: "Vendas diretas — BEX PRINT OS" },
      { name: "description", content: "Compras feitas pelos parceiros direto com a gráfica." },
      { property: "og:title", content: "Vendas diretas — BEX PRINT OS" },
      { property: "og:description", content: "Compras diretas dos parceiros, com pagamento e ordem de serviço." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VendasDiretas,
});

const brl = (n: number | null) => Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Linha = {
  id: string;
  numero: number;
  created_at: string;
  pagamento_modelo: string | null;
  total_pedido: number | null;
  os_id: string | null;
  observacoes: string | null;
  parceiro: { nome: string | null } | null;
};

function VendasDiretas() {
  const [busca, setBusca] = useState("");
  const consulta = useQuery({
    queryKey: ["vendas-diretas"],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase as any)
        .from("parceiro_orcamentos")
        .select("id, numero, created_at, pagamento_modelo, total_pedido, os_id, observacoes, parceiro:parceiros(nome)")
        .eq("venda_direta", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (consulta.data ?? []).filter((l) => !t || `${l.parceiro?.nome ?? ""} ${l.numero}`.toLowerCase().includes(t));
  }, [consulta.data, busca]);

  return (
    <div className="p-6">
      <SectionHeader
        breadcrumb="Comercial"
        title="Vendas diretas"
        description="Compras dos parceiros direto com a gráfica, com a forma de pagamento escolhida."
        ajuda={dicaTela("/vendas-diretas")}
      />
      <DataPanel busca={busca} onBusca={setBusca} placeholder="Parceiro ou número">
        {consulta.isLoading ? (
          <Carregando />
        ) : consulta.error ? (
          <p className="p-4 text-sm text-destructive">{mensagemErro(consulta.error, "Não foi possível carregar as vendas diretas.")}</p>
        ) : linhas.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma venda direta ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Parceiro</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="text-right">Receber agora</TableHead>
                <TableHead>Produção</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const modelo = l.pagamento_modelo === "a_vista" ? "a_vista" : "metade_metade";
                const v = valoresDoPagamento(Number(l.total_pedido ?? 0), modelo);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">{l.numero}</TableCell>
                    <TableCell>
                      {l.parceiro?.nome ?? "—"}
                      {l.observacoes && <p className="text-xs text-muted-foreground">{l.observacoes}</p>}
                    </TableCell>
                    <TableCell>{new Date(l.created_at).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(l.total_pedido)}</TableCell>
                    <TableCell>
                      <StatusChip
                        label={`${modelo === "a_vista" ? "À vista" : "Sinal 50%"} · ${situacaoDoPagamento(modelo)}`}
                        tone={modelo === "a_vista" ? "cyan" : "amber"}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(v.agora)}</TableCell>
                    <TableCell>
                      {l.os_id ? (
                        <Link to="/os/$id" params={{ id: l.os_id }} className="text-link underline">
                          Ver OS
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">Converter em Orçamentos</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DataPanel>
    </div>
  );
}
