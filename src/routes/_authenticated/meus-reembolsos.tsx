import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCheck, Hourglass, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { PedirReembolso } from "@/components/reembolsos/pedir-reembolso";
import { brl, CartaoDoReembolso, EstadoDaLista } from "@/components/reembolsos/lista";
import { buscarReembolsos, CHAVE_DOS_REEMBOLSOS } from "@/components/reembolsos/dados";

export const Route = createFileRoute("/_authenticated/meus-reembolsos")({
  head: () => ({ meta: [{ title: "Meus reembolsos — BEX PRINT OS" }] }),
  // ?os=<id> abre o pedido com a OS escolhida (botão "Pedir reembolso" da OS).
  validateSearch: (busca: Record<string, unknown>): { os?: string } =>
    typeof busca.os === "string" && /^[0-9a-f-]{36}$/i.test(busca.os) ? { os: busca.os } : {},
  component: MeusReembolsosPage,
});

/**
 * Os reembolsos da própria pessoa (15/10/2026): pedir, acompanhar e cancelar
 * enquanto ninguém decidiu. Mora no rodapé do menu, ao lado de Meu perfil —
 * é de cada um, como o perfil — e no botão "Pedir reembolso" de cada OS.
 */
function MeusReembolsosPage() {
  const { user, hasPermission } = useAuth();
  const qc = useQueryClient();
  const { os: osDaUrl } = Route.useSearch();
  const navigate = useNavigate();
  const [pedindo, setPedindo] = useState(!!osDaUrl);
  const decide = hasPermission("reembolsos.pay") || hasPermission("reembolsos.approve");

  const meus = useQuery({
    queryKey: [CHAVE_DOS_REEMBOLSOS, "meus", user?.id],
    enabled: !!user?.id,
    queryFn: () => buscarReembolsos({ solicitanteId: user!.id }),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("reembolso_cancelar", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido cancelado.");
      qc.invalidateQueries({ queryKey: [CHAVE_DOS_REEMBOLSOS] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const lista = meus.data ?? [];
  const soma = (st: string) => lista.filter((r) => r.status === st).reduce((n, r) => n + r.valor, 0);
  const qtd = (st: string) => lista.filter((r) => r.status === st).length;

  function fecharPedido() {
    setPedindo(false);
    if (osDaUrl) navigate({ to: "/meus-reembolsos", search: {}, replace: true });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/meus-reembolsos")}
        breadcrumb="Reembolso"
        title="Meus reembolsos"
        description="Comprou algo para a gráfica com o seu dinheiro? Peça aqui, com a foto do cupom e a OS para a qual foi. O aprovado é pago na sexta."
        actions={
          <>
            {decide && (
              <Button variant="outline" asChild>
                <Link to="/reembolsos">Decidir reembolsos da equipe</Link>
              </Button>
            )}
            <Button onClick={() => setPedindo(true)} className="h-11 md:h-10">
              <Plus className="mr-1 h-4 w-4" /> Pedir reembolso
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Esperando decisão"
          value={`${qtd("aguardando")} · ${brl(soma("aguardando"))}`}
          icon={Hourglass}
          tone="amber"
        />
        <KpiCard label="Aprovado, paga na sexta" value={brl(soma("aprovado"))} icon={Wallet} tone="cyan" />
        <KpiCard label="Já recebido" value={brl(soma("pago"))} icon={CheckCheck} tone="lime" />
      </div>

      <EstadoDaLista
        carregando={meus.isPending}
        erro={meus.isError ? meus.error : null}
        vazio={lista.length === 0}
        textoVazio="Você ainda não pediu reembolso. Comprou algo para uma OS? Toque em Pedir reembolso."
      >
        <ul className="space-y-2">
          {lista.map((r) => (
            <CartaoDoReembolso
              key={r.id}
              r={r}
              mostrarQuemPediu={false}
              acoes={
                r.status === "aguardando" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={cancelar.isPending}
                    onClick={() => cancelar.mutate(r.id)}
                  >
                    Cancelar pedido
                  </Button>
                ) : null
              }
            />
          ))}
        </ul>
      </EstadoDaLista>

      <PedirReembolso aberto={pedindo} aoFechar={fecharPedido} osInicial={osDaUrl ?? null} />
    </div>
  );
}
