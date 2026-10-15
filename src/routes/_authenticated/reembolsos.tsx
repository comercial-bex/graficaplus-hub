import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCheck, HandCoins, Hourglass, Plus, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { PedirReembolso } from "@/components/reembolsos/pedir-reembolso";
import {
  brl,
  CartaoDoReembolso,
  DecidirReembolso,
  dia,
  EstadoDaLista,
} from "@/components/reembolsos/lista";
import { buscarReembolsos, CHAVE_DOS_REEMBOLSOS, type Reembolso } from "@/components/reembolsos/dados";
import {
  hojeNaCasa,
  motivoParaNaoDecidir,
  rotuloDaCategoria,
  sextaDoPagamento,
} from "@/domain/financeiro/reembolsos";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";

export const Route = createFileRoute("/_authenticated/reembolsos")({
  head: () => ({ meta: [{ title: "Reembolsos — BEX PRINT OS" }] }),
  component: ReembolsosPage,
});

type PorProduto = {
  produto: string;
  categoria: string;
  reembolsos: number;
  os: number;
  total: number;
  media: number;
};

/**
 * A mesa de quem decide reembolso (15/10/2026): o financeiro aprova o verde e
 * a despesa da empresa; a gerência decide o que aperta a margem da OS, a deixa
 * no prejuízo ou cai em OS sem custo. O aprovado vira custo real da OS e soma
 * na conta a pagar da sexta de quem pediu — pagar a conta em Caixa e contas a
 * pagar marca os reembolsos como pagos.
 *
 * "Por produto" é o que o dono pediu para não ter surpresa: quanto cada
 * produto gera de compra por fora, que a ficha técnica e o preço ainda não
 * carregam.
 */
function ReembolsosPage() {
  const { user, hasPermission, hasRole } = useAuth();
  const [pedindo, setPedindo] = useState(false);
  const [decidindo, setDecidindo] = useState<Reembolso | null>(null);
  const quem = {
    uid: user?.id,
    aprovaTudo: hasPermission("reembolsos.approve"),
    aprovaVerde: hasPermission("reembolsos.pay"),
    ehAdmin: hasRole("admin"),
  };

  const todos = useQuery({
    queryKey: [CHAVE_DOS_REEMBOLSOS, "todos"],
    queryFn: () => buscarReembolsos({ limite: 500 }),
  });
  const porProduto = useQuery({
    queryKey: [CHAVE_DOS_REEMBOLSOS, "por-produto"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vw_reembolsos_por_produto")
        .select("produto, categoria, reembolsos, os, total, media")
        .order("total", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PorProduto[];
    },
  });

  const lista = todos.data ?? [];
  const deStatus = (...st: Reembolso["status"][]) => lista.filter((r) => st.includes(r.status));
  const somar = (rs: Reembolso[]) => rs.reduce((n, r) => n + r.valor, 0);
  const paraDecidir = deStatus("aguardando").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const aPagar = deStatus("aprovado");
  const pagos = deStatus("pago");
  const recusados = deStatus("recusado", "cancelado");
  const meusParaDecidir = paraDecidir.filter(
    (r) => !motivoParaNaoDecidir({ status: r.status, cor: r.cor, solicitante_id: r.solicitante_id }, quem),
  );

  // A pagar, por conta da sexta de cada pessoa (uma conta por pessoa e sexta).
  const contas = new Map<string, { quem: string; sexta: string; itens: Reembolso[] }>();
  for (const r of aPagar) {
    const chave = r.conta_pagar_id ?? r.id;
    const sexta = r.decidido_em ? sextaDoPagamento(hojeNaCasa(new Date(r.decidido_em))) : "";
    const c = contas.get(chave) ?? { quem: r.solicitante, sexta, itens: [] };
    c.itens.push(r);
    contas.set(chave, c);
  }

  const estado = {
    carregando: todos.isPending,
    erro: todos.isError ? todos.error : null,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/reembolsos")}
        breadcrumb="Financeiro · Pagar e caixa"
        title="Reembolsos"
        description="Compras da equipe com o próprio dinheiro, cada uma com a foto do cupom e a OS para a qual foi. Verde o financeiro aprova; amarelo e vermelho a gerência decide."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/meus-reembolsos">Meus reembolsos</Link>
            </Button>
            {hasPermission("reembolsos.request") && (
              <Button onClick={() => setPedindo(true)} className="h-11 md:h-10">
                <Plus className="mr-1 h-4 w-4" /> Pedir reembolso
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Esperando decisão"
          value={`${paraDecidir.length} · ${brl(somar(paraDecidir))}`}
          hint={`${meusParaDecidir.length} ${meusParaDecidir.length === 1 ? "cabe" : "cabem"} a você decidir.`}
          icon={Hourglass}
          tone="amber"
        />
        <KpiCard label="Aprovado, a pagar" value={brl(somar(aPagar))} icon={Wallet} tone="cyan" />
        <KpiCard label="Pago" value={brl(somar(pagos))} icon={CheckCheck} tone="lime" />
        <KpiCard
          label="Por fora nas OS"
          value={brl(somar([...aPagar, ...pagos].filter((r) => r.destino === "os")))}
          hint="Reembolsos aprovados que viraram custo de OS: o gasto que o preço do produto ainda não carrega."
          icon={HandCoins}
          tone="magenta"
        />
      </div>

      <Tabs defaultValue="decidir">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="decidir">Para decidir ({paraDecidir.length})</TabsTrigger>
          <TabsTrigger value="pagar">A pagar ({aPagar.length})</TabsTrigger>
          <TabsTrigger value="pagos">Pagos</TabsTrigger>
          <TabsTrigger value="recusados">Recusados</TabsTrigger>
          <TabsTrigger value="produto">Por produto</TabsTrigger>
        </TabsList>

        <TabsContent value="decidir">
          <EstadoDaLista {...estado} vazio={paraDecidir.length === 0} textoVazio="Nenhum reembolso esperando decisão.">
            <ul className="space-y-2">
              {paraDecidir.map((r) => {
                const bloqueio = motivoParaNaoDecidir(
                  { status: r.status, cor: r.cor, solicitante_id: r.solicitante_id },
                  quem,
                );
                return (
                  <CartaoDoReembolso
                    key={r.id}
                    r={r}
                    acoes={
                      <>
                        <Button size="sm" variant={bloqueio ? "outline" : "default"} onClick={() => setDecidindo(r)}>
                          {bloqueio ? "Ver" : "Decidir"}
                        </Button>
                        {bloqueio && <span className="text-xs text-muted-foreground">{bloqueio}</span>}
                      </>
                    }
                  />
                );
              })}
            </ul>
          </EstadoDaLista>
        </TabsContent>

        <TabsContent value="pagar">
          <EstadoDaLista {...estado} vazio={aPagar.length === 0} textoVazio="Nenhum reembolso aprovado esperando pagamento.">
            <p className="mb-3 text-sm text-muted-foreground">
              Cada pessoa tem uma conta a pagar por sexta com a soma dos aprovados. Pague a conta em{" "}
              <Link to="/fluxo-caixa" className="font-medium underline underline-offset-2">
                Caixa e contas a pagar
              </Link>
              : os reembolsos dela viram pagos sozinhos.
            </p>
            <div className="space-y-4">
              {[...contas.entries()].map(([chave, c]) => (
                <section key={chave} className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    {c.quem} · {brl(somar(c.itens))}
                    {c.sexta && <span className="font-normal text-muted-foreground"> · sexta {dia(c.sexta).slice(0, 5)}</span>}
                  </h3>
                  <ul className="space-y-2">
                    {c.itens.map((r) => (
                      <CartaoDoReembolso key={r.id} r={r} mostrarQuemPediu={false} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </EstadoDaLista>
        </TabsContent>

        <TabsContent value="pagos">
          <EstadoDaLista {...estado} vazio={pagos.length === 0} textoVazio="Nenhum reembolso pago ainda.">
            <ul className="space-y-2">
              {pagos.map((r) => (
                <CartaoDoReembolso key={r.id} r={r} />
              ))}
            </ul>
          </EstadoDaLista>
        </TabsContent>

        <TabsContent value="recusados">
          <EstadoDaLista {...estado} vazio={recusados.length === 0} textoVazio="Nenhum reembolso recusado ou cancelado.">
            <ul className="space-y-2">
              {recusados.map((r) => (
                <CartaoDoReembolso key={r.id} r={r} />
              ))}
            </ul>
          </EstadoDaLista>
        </TabsContent>

        <TabsContent value="produto">
          <p className="mb-3 text-sm text-muted-foreground">
            Quanto cada produto gerou de compra por fora (reembolsos aprovados e pagos). Se um produto aparece sempre
            aqui, o custo dele está faltando na ficha técnica — e o preço não cobre.
          </p>
          {porProduto.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : porProduto.isError ? (
            <p role="alert" className="py-6 text-center text-sm text-destructive">
              Não foi possível ler o resumo por produto: {mensagemErro(porProduto.error)}
            </p>
          ) : (porProduto.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum reembolso aprovado em OS ainda.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Compra</TableHead>
                    <TableHead className="text-right">Reembolsos</TableHead>
                    <TableHead className="text-right">OS</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(porProduto.data ?? []).map((p) => (
                    <TableRow key={`${p.produto}-${p.categoria}`}>
                      <TableCell className="font-medium">{p.produto}</TableCell>
                      <TableCell>{rotuloDaCategoria(p.categoria)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.reembolsos}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.os}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(Number(p.total))}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(Number(p.media))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <PedirReembolso aberto={pedindo} aoFechar={() => setPedindo(false)} />
      <DecidirReembolso r={decidindo} aoFechar={() => setDecidindo(null)} />
    </div>
  );
}
