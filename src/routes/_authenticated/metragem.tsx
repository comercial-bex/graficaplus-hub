import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Ruler, Factory, Hourglass, FileCheck2 } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { DataPanel } from "@/components/bex/DataPanel";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";

export const Route = createFileRoute("/_authenticated/metragem")({
  head: () => ({
    meta: [
      { title: "Metragem por cliente — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Quantos metros quadrados cada cliente já orçou, aprovou, colocou em ordem de serviço e quanto ainda falta produzir.",
      },
      { property: "og:title", content: "Metragem por cliente — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Metragem orçada, aprovada, em produção e em aberto por cliente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MetragemPage,
});

const brl = (n: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const m2 = (n: number) => `${(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`;

type Linha = {
  cliente_id: string;
  cliente_nome: string;
  m2_orcado: number;
  m2_aprovado: number;
  m2_em_os: number;
  m2_produzido: number;
  m2_em_aberto: number;
  m2_aprovado_sem_os: number;
  valor_orcado: number;
  valor_os: number;
};

/**
 * Metragem é a moeda da gráfica: o cliente pergunta "quanto já rodei com
 * vocês?" e "quanto ainda falta?". As duas respostas vêm de lugares
 * diferentes — orçamento e ordem de serviço — e por isso ficam lado a lado
 * aqui, com a diferença entre elas explícita.
 */
function MetragemPage() {
  const [busca, setBusca] = useState("");

  const consulta = useQuery({
    queryKey: ["vw-metragem-cliente"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => Promise<{ data: Linha[] | null; error: unknown }>;
          };
        };
      })
        .from("vw_metragem_cliente")
        .select("*")
        .order("m2_orcado", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const dados = consulta.data ?? [];

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return dados;
    return dados.filter((l) => l.cliente_nome.toLowerCase().includes(t));
  }, [dados, busca]);

  const total = useMemo(
    () =>
      filtradas.reduce(
        (acc, l) => ({
          orcado: acc.orcado + l.m2_orcado,
          aprovado: acc.aprovado + l.m2_aprovado,
          em_os: acc.em_os + l.m2_em_os,
          produzido: acc.produzido + l.m2_produzido,
          aberto: acc.aberto + l.m2_em_aberto,
          sem_os: acc.sem_os + l.m2_aprovado_sem_os,
          valor: acc.valor + l.valor_os,
        }),
        { orcado: 0, aprovado: 0, em_os: 0, produzido: 0, aberto: 0, sem_os: 0, valor: 0 },
      ),
    [filtradas],
  );

  return (
    <div className="p-6">
      <SectionHeader
        breadcrumb="Comercial"
        title="Metragem por cliente"
        description="Quanto já foi orçado, aprovado, virou ordem de serviço e quanto ainda falta produzir."
        ajuda={dicaTela("/metragem")}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Orçado" value={m2(total.orcado)} hint="Soma da área de todos os itens orçados" icon={Ruler} />
        <KpiCard
          label="Aprovado sem OS"
          value={m2(total.sem_os)}
          hint="Cliente já disse sim e ainda não virou produção"
          icon={FileCheck2}
          tone="amber"
        />
        <KpiCard
          label="Em produção"
          value={m2(total.aberto)}
          hint="Já está em ordem de serviço e ainda não foi concluído"
          icon={Hourglass}
          tone="magenta"
        />
        <KpiCard
          label="Produzido"
          value={m2(total.produzido)}
          hint={`${brl(total.valor)} em ordens de serviço`}
          icon={Factory}
        />
      </div>

      <DataPanel
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar cliente..."
        rodape={`${filtradas.length} cliente(s) · ${m2(total.em_os)} em ordens de serviço`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="text-right">Orçado</TableHead>
              <TableHead className="text-right">Aprovado</TableHead>
              <TableHead className="text-right">Aprovado sem OS</TableHead>
              <TableHead className="text-right">Em ordem de serviço</TableHead>
              <TableHead className="text-right">Produzido</TableHead>
              <TableHead className="text-right">Falta produzir</TableHead>
              <TableHead className="text-right">Valor em OS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {consulta.isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {consulta.error && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-destructive">
                  {mensagemErro(consulta.error)}
                </TableCell>
              </TableRow>
            )}
            {!consulta.isLoading && !consulta.error && filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Nenhuma metragem lançada ainda.
                </TableCell>
              </TableRow>
            )}
            {filtradas.map((l) => (
              <TableRow key={l.cliente_id}>
                <TableCell>
                  <Link
                    to="/clientes/$id"
                    params={{ id: l.cliente_id }}
                    className="font-medium text-foreground hover:text-[color:var(--bex-cyan)]"
                  >
                    {l.cliente_nome}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{m2(l.m2_orcado)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{m2(l.m2_aprovado)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-[color:var(--bex-amber)]">
                  {l.m2_aprovado_sem_os > 0 ? m2(l.m2_aprovado_sem_os) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{m2(l.m2_em_os)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{m2(l.m2_produzido)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-[color:var(--bex-magenta)]">
                  {l.m2_em_aberto > 0 ? m2(l.m2_em_aberto) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{brl(l.valor_os)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataPanel>
    </div>
  );
}
