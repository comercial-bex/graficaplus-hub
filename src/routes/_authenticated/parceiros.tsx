/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Coins,
  ExternalLink,
  Handshake,
  KeyRound,
  MoreHorizontal,
  Plus,
  Settings2,
  ShoppingBag,
  Trophy,
  UserX,
} from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { NovoParceiroDialog } from "@/components/parceiros/novo-parceiro-dialog";
import { AcessoDialog } from "@/components/parceiros/acesso-dialog";
import { CadastroDialog, CreditoDialog } from "@/components/parceiros/ajustes-dialogs";
import { MetasTab } from "@/components/parceiros/metas-tab";
import { OfertasTab } from "@/components/parceiros/ofertas-tab";
import { NiveisTab } from "@/components/parceiros/niveis-tab";
import { RecompensasTab } from "@/components/parceiros/recompensas-tab";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { resumoDosParceiros, type ResumoDoParceiro } from "@/lib/parceiro-api";
import { brl } from "@/domain/parceiros/preco";
import { sinalDeRetencao } from "@/domain/parceiros/retencao";

export const Route = createFileRoute("/_authenticated/parceiros")({
  head: () => ({ meta: [{ title: "Parceiros — BEX PRINT OS" }] }),
  component: ParceirosPage,
});

type PedidoParaOs = {
  id: string;
  numero: number;
  titulo: string;
  cliente_id: string;
  created_at: string;
  valor_total?: number | null;
};

function ParceirosPage() {
  const { hasPermission, canSeeFinancials } = useAuth();
  const qc = useQueryClient();
  const podeEditar = hasPermission("parceiros.manage");
  const [novo, setNovo] = useState(false);
  const [acesso, setAcesso] = useState<ResumoDoParceiro | null>(null);
  const [credito, setCredito] = useState<ResumoDoParceiro | null>(null);
  const [cadastro, setCadastro] = useState<ResumoDoParceiro | null>(null);

  const { data: parceiros = [], isLoading, error } = useQuery({
    queryKey: ["parceiros-resumo"],
    queryFn: resumoDosParceiros,
  });

  const comSinal = useMemo(
    () =>
      parceiros
        .map((p) => ({ parceiro: p, sinal: sinalDeRetencao(p) }))
        .sort((a, b) => b.sinal.urgencia - a.sinal.urgencia || a.parceiro.nome.localeCompare(b.parceiro.nome, "pt-BR")),
    [parceiros],
  );

  // Pedido de parceiro nasce como orçamento aprovado; alguém precisa gerar a OS.
  const clientes = parceiros.map((p) => p.cliente_id);
  const { data: pedidosParaOs = [] } = useQuery({
    queryKey: ["parceiros-pedidos-sem-os", clientes, canSeeFinancials],
    enabled: clientes.length > 0 && hasPermission("orcamentos.read"),
    queryFn: async (): Promise<PedidoParaOs[]> => {
      const { data, error: erro } = await fromFinancialView("orcamentos", canSeeFinancials)
        .select(canSeeFinancials ? "id, numero, titulo, cliente_id, created_at, valor_total" : "id, numero, titulo, cliente_id, created_at")
        .in("cliente_id", clientes)
        .eq("status", "aprovado")
        .is("os_id", null)
        .order("created_at");
      if (erro) throw erro;
      return (data ?? []) as PedidoParaOs[];
    },
  });

  const ativos = parceiros.filter((p) => p.status === "ativo");
  const semLogin = ativos.filter((p) => !p.usuario_email).length;
  const emRisco = comSinal.filter((x) => ["esfriando", "parado", "sem_compra"].includes(x.sinal.chave)).length;
  const aEntregar = parceiros.reduce((s, p) => s + Number(p.conquistas_a_entregar || 0), 0);
  const compras30 = parceiros.reduce((s, p) => s + Number(p.compras_30d || 0), 0);
  const nomePorCliente = new Map(parceiros.map((p) => [p.cliente_id, p.nome]));

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb="Comercial"
        title="Parceiros"
        description="Revendedores que compram da gráfica e vendem com a própria marca."
        ajuda={dicaTela("/parceiros")}
        actions={
          podeEditar ? (
            <Button onClick={() => setNovo(true)}>
              <Plus className="mr-1 h-4 w-4" /> Novo parceiro
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="rede">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="rede">Rede</TabsTrigger>
            <TabsTrigger value="metas">Metas</TabsTrigger>
            <TabsTrigger value="ofertas">Ofertas</TabsTrigger>
            <TabsTrigger value="niveis">Níveis</TabsTrigger>
            <TabsTrigger value="recompensas">
              Recompensas{aEntregar > 0 ? ` (${aEntregar})` : ""}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="rede" className="space-y-6 pt-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Parceiros ativos"
              value={ativos.length}
              hint={semLogin > 0 ? `${semLogin} sem login` : undefined}
              icon={Handshake}
            />
            <KpiCard
              label="Compraram em 30 dias"
              value={canSeeFinancials ? brl(compras30) : "—"}
              hint={canSeeFinancials ? undefined : "visível para o financeiro"}
              icon={ShoppingBag}
              tone="magenta"
            />
            <KpiCard label="Esfriando ou parados" value={emRisco} icon={AlertTriangle} tone={emRisco > 0 ? "amber" : "muted"} />
            <KpiCard label="Recompensas a entregar" value={aEntregar} icon={Trophy} tone={aEntregar > 0 ? "amber" : "muted"} />
          </div>

          {pedidosParaOs.length > 0 && (
            <section className="rounded-xl border border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/5 p-4">
              <p className="font-semibold">
                {pedidosParaOs.length} {pedidosParaOs.length === 1 ? "pedido de parceiro espera" : "pedidos de parceiros esperam"} virar OS
              </p>
              <ul className="mt-2 divide-y divide-border text-sm">
                {pedidosParaOs.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      nº {o.numero} · {nomePorCliente.get(o.cliente_id) ?? "Parceiro"} · {o.titulo}
                      {o.valor_total != null ? ` · ${brl(Number(o.valor_total))}` : ""}
                    </span>
                    <Link
                      to="/orcamentos/$id"
                      params={{ id: o.id }}
                      className="inline-flex shrink-0 items-center gap-1 text-[color:var(--bex-cyan)] hover:underline"
                    >
                      Abrir <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : error ? (
            <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">{mensagemErro(error)}</p>
          ) : parceiros.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Handshake className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 font-semibold">Nenhum parceiro ainda</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Antes do primeiro: revise a aba Níveis. Depois cadastre o parceiro a partir de um cliente e crie o
                login dele — o painel já abre com a tabela do nível.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {comSinal.map(({ parceiro: p, sinal }) => (
                <li key={p.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold">{p.nome}</p>
                        {p.nivel?.nome && (
                          <span
                            className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                            style={{ borderColor: p.nivel.cor ?? undefined, color: p.nivel.cor ?? undefined }}
                          >
                            {p.nivel.nome}
                            {p.nivel.fixado ? " · garantido" : ""}
                          </span>
                        )}
                        <StatusChip label={sinal.rotulo} tone={sinal.tom} />
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{sinal.detalhe}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Cliente {p.cliente_nome}
                        {p.responsavel_nome ? ` · atende ${p.responsavel_nome}` : " · sem atendente"}
                        {p.usuario_email ? ` · login ${p.usuario_email}` : " · sem login"}
                      </p>
                    </div>
                    {podeEditar ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" aria-label={`Ações de ${p.nome}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setAcesso(p)}>
                            <KeyRound className="mr-2 h-4 w-4" /> {p.usuario_email ? "Trocar login" : "Dar acesso ao painel"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setCredito(p)}>
                            <Coins className="mr-2 h-4 w-4" /> Ajustar crédito
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setCadastro(p)}>
                            {p.status === "ativo" ? <Settings2 className="mr-2 h-4 w-4" /> : <UserX className="mr-2 h-4 w-4" />}
                            Atendente, nível e situação
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/clientes/$id" params={{ id: p.cliente_id }}>
                              <ExternalLink className="mr-2 h-4 w-4" /> Abrir cliente
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                    <Metrica rotulo="Compras 30 dias" valor={p.compras_30d == null ? "—" : brl(p.compras_30d)} />
                    <Metrica rotulo="Orçamentos 30 dias" valor={String(p.orcamentos_30d)} />
                    <Metrica
                      rotulo="m² orçados 30 dias"
                      valor={Number(p.metragem_orcada_30d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                    />
                    <Metrica rotulo="Pedidos 30 dias" valor={String(p.pedidos_30d)} />
                    <Metrica rotulo="Crédito" valor={brl(p.saldo_credito)} />
                    <Metrica
                      rotulo="Último acesso"
                      valor={p.ultimo_acesso_em ? new Date(p.ultimo_acesso_em).toLocaleDateString("pt-BR") : "nunca"}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Orçamentos e m² contam o que o parceiro orçou no painel dele — quanto trabalho ele está fazendo. Quem são os
            clientes dele não aparece aqui: a carteira é do parceiro.
          </p>
        </TabsContent>

        <TabsContent value="metas" className="pt-4">
          <MetasTab podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="ofertas" className="pt-4">
          <OfertasTab podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="niveis" className="pt-4">
          <NiveisTab podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="recompensas" className="pt-4">
          <RecompensasTab podeEditar={podeEditar} />
        </TabsContent>
      </Tabs>

      <NovoParceiroDialog
        aberto={novo}
        onOpenChange={setNovo}
        onCriado={async (id) => {
          // o passo seguinte natural é o login: abre direto, sem caçar na lista
          const lista = await qc.fetchQuery({ queryKey: ["parceiros-resumo"], queryFn: resumoDosParceiros });
          const criado = lista.find((x) => x.id === id);
          if (criado) setAcesso(criado);
        }}
      />
      <AcessoDialog parceiro={acesso} onOpenChange={(v) => !v && setAcesso(null)} />
      <CreditoDialog parceiro={credito} onOpenChange={(v) => !v && setCredito(null)} />
      <CadastroDialog parceiro={cadastro} onOpenChange={(v) => !v && setCadastro(null)} />
    </div>
  );
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</dt>
      <dd className="truncate font-medium tabular-nums">{valor}</dd>
    </div>
  );
}
