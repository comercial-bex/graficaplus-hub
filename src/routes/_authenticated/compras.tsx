import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, PackagePlus, RefreshCw, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { PedidoCard } from "@/components/compras/pedido-card";
import { PedidoDialog } from "@/components/compras/pedido-dialog";
import { ReceberPedidoDialog } from "@/components/compras/receber-dialog";
import { CancelarPedidoDialog } from "@/components/compras/cancelar-dialog";
import {
  emAberto,
  SELECT_DO_PEDIDO,
  type PedidoDeCompra,
  type PermissoesDeCompra,
} from "@/components/compras/pedido";

export const Route = createFileRoute("/_authenticated/compras")({
  head: () => ({ meta: [{ title: "Compras — BEX PRINT OS" }] }),
  component: ComprasPage,
});

const CHAVE = ["pedidos-compra"] as const;

/**
 * Compras: o material que falta vira pedido, e o pedido recebido vira estoque.
 *
 * O pedido tem VÁRIOS materiais — a tabela sempre teve (`pedido_compra_itens`),
 * a tela é que gravava um só. Criar, revisar e corrigir passam por
 * `salvar_pedido_compra` (tudo numa transação); receber passa por
 * `receber_pedido_compra`, que leva cada item pela entrada oficial
 * (`receber_item_compra` → `registrar_entrada_material`: lote, movimentação e
 * custo médio num lugar só); cancelar, por `cancelar_pedido_compra`, com motivo.
 *
 * O "Comprar o que falta" da OS cria o pedido como rascunho, com o fornecedor
 * como palpite. É aqui que ele é revisado e registrado.
 */
function ComprasPage() {
  const qc = useQueryClient();
  const { hasPermission, canSeeFinancials } = useAuth();
  const permissoes: PermissoesDeCompra = {
    criar: hasPermission("compras.create"),
    receber: hasPermission("compras.receive"),
    darEntrada: hasPermission("estoque.entry"),
    cancelar: hasPermission("compras.cancel"),
  };
  // Custo de compra é de quem cuida do estoque ou vê o financeiro — os quatro
  // papéis que leem compras hoje têm um dos dois. O filtro fica para o dia em
  // que alguém der compras.read a outro papel.
  const podeVerCusto = canSeeFinancials || hasPermission("estoque.cost.read");

  const [filtro, setFiltro] = useState<"abertos" | "todos">("abertos");
  const [editando, setEditando] = useState<PedidoDeCompra | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [recebendo, setRecebendo] = useState<PedidoDeCompra | null>(null);
  const [cancelando, setCancelando] = useState<PedidoDeCompra | null>(null);

  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async (): Promise<PedidoDeCompra[]> => {
      const { data, error } = await (supabase as any)
        .from("pedidos_compra")
        .select(SELECT_DO_PEDIDO)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PedidoDeCompra[];
    },
  });

  const pedidos = lista.data ?? [];

  // Número da OS de origem. Falhar aqui não derruba a lista: o link para a OS
  // continua, só sem o número.
  const idsDeOs = [...new Set(pedidos.map((p) => p.os_id).filter((id): id is string => !!id))];
  const numerosDeOs = useQuery({
    queryKey: ["pedidos-compra-os", idsDeOs.join(",")],
    enabled: idsDeOs.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select("id, numero")
        .in("id", idsDeOs);
      if (error) throw error;
      return new Map(((data ?? []) as { id: string; numero: number }[]).map((o) => [o.id, o.numero]));
    },
  });

  const rascunhos = pedidos.filter((p) => p.status === "rascunho");
  const aguardando = pedidos.filter((p) => p.status === "enviado" || p.status === "recebido_parcial");
  const abertos = pedidos.filter((p) => emAberto(p.status));
  const visiveis = filtro === "abertos" ? abertos : pedidos;

  function recarregar() {
    qc.invalidateQueries({ queryKey: CHAVE });
  }
  function depoisDeReceber() {
    recarregar();
    // O recebimento mexe no saldo e no custo médio: as telas que leem material
    // e a falta de material da OS precisam ler de novo.
    qc.invalidateQueries({ queryKey: ["materiais"] });
    qc.invalidateQueries({ queryKey: ["os-materiais"] });
  }

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/compras")}
        breadcrumb="Suprimentos"
        title="Compras"
        description="O material que falta vira pedido — com quantos materiais precisar —, e o pedido recebido entra no estoque com lote e custo."
        actions={
          permissoes.criar ? (
            <Button className="h-11 md:h-9" onClick={() => setNovoAberto(true)}>
              <PackagePlus className="mr-1 h-4 w-4" /> Novo pedido
            </Button>
          ) : undefined
        }
      />

      {rascunhos.length > 0 && (
        <div className="mb-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <ClipboardList className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div>
            {rascunhos.length === 1 ? "Um rascunho espera" : `${rascunhos.length} rascunhos esperam`} revisão.
            Rascunho ainda não foi pedido ao fornecedor: confira o fornecedor e os custos e registre.
          </div>
        </div>
      )}

      {aguardando.length > 0 && (
        <div className="mb-3 flex gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          <Truck className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600" />
          <div>
            {aguardando.length === 1 ? "Um pedido aguarda" : `${aguardando.length} pedidos aguardam`} entrega.
            Enquanto não chega, o material continua faltando para a produção.
          </div>
        </div>
      )}

      {lista.isSuccess && pedidos.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Quais pedidos mostrar">
          <Button
            size="sm"
            variant={filtro === "abertos" ? "default" : "outline"}
            className="h-11 md:h-8"
            aria-pressed={filtro === "abertos"}
            onClick={() => setFiltro("abertos")}
          >
            Em aberto ({abertos.length})
          </Button>
          <Button
            size="sm"
            variant={filtro === "todos" ? "default" : "outline"}
            className="h-11 md:h-8"
            aria-pressed={filtro === "todos"}
            onClick={() => setFiltro("todos")}
          >
            Todos ({pedidos.length})
          </Button>
        </div>
      )}

      {lista.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Carregando os pedidos…</CardContent>
        </Card>
      ) : lista.isError ? (
        // Falha não é "nenhum pedido": a tela antiga mostrava o mesmo texto
        // para as duas coisas.
        <Card>
          <CardContent role="alert" className="space-y-2 p-6 text-sm">
            <p className="font-medium">Não deu para carregar os pedidos de compra.</p>
            <p className="text-muted-foreground">{mensagemErro(lista.error)}</p>
            <Button variant="outline" className="h-11 md:h-9" disabled={lista.isFetching} onClick={() => lista.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> {lista.isFetching ? "Tentando…" : "Tentar de novo"}
            </Button>
          </CardContent>
        </Card>
      ) : pedidos.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhum pedido de compra ainda.{" "}
            {permissoes.criar
              ? "Use “Novo pedido” para registrar uma compra com quantos materiais precisar — ou, na OS, o botão “Comprar o que falta” cria o rascunho já preenchido."
              : "Quem cria pedido é quem cuida do estoque ou da gestão; na OS, o botão “Comprar o que falta” cria o rascunho já preenchido."}
          </CardContent>
        </Card>
      ) : visiveis.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhum pedido em aberto: tudo o que foi pedido já chegou ou foi cancelado. Veja em “Todos”.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visiveis.map((p) => (
            <PedidoCard
              key={p.id}
              pedido={p}
              numeroDaOs={p.os_id ? (numerosDeOs.data?.get(p.os_id) ?? null) : null}
              permissoes={permissoes}
              podeVerCusto={podeVerCusto}
              onRevisar={setEditando}
              onReceber={setRecebendo}
              onCancelar={setCancelando}
            />
          ))}
        </div>
      )}

      <PedidoDialog
        open={novoAberto || !!editando}
        pedido={editando}
        onOpenChange={(v) => {
          if (!v) {
            setNovoAberto(false);
            setEditando(null);
          }
        }}
        onSalvo={recarregar}
      />

      <ReceberPedidoDialog
        pedido={recebendo}
        podeVerCusto={podeVerCusto}
        onOpenChange={(v) => !v && setRecebendo(null)}
        onRecebido={depoisDeReceber}
      />

      <CancelarPedidoDialog
        pedido={cancelando}
        onOpenChange={(v) => !v && setCancelando(null)}
        onCancelado={recarregar}
      />
    </div>
  );
}
