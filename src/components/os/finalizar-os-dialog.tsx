import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, PackageCheck, Store, Truck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { rotuloBloqueio } from "@/domain/os/etapas";
import { bloqueiosSemDinheiro } from "@/domain/os/bloqueio-sem-dinheiro";
import { avisoDoStatus, ROTULO_DO_AVISO } from "@/domain/os/movimentos";
import type { BloqueioOs } from "@/components/kanban/cartao-os";
import { cn } from "@/lib/utils";

/**
 * Finalizar o pedido, guiado (24/10/2026).
 *
 * Antes: escolher "Concluído" numa lista de 26 status, sem confirmação; se algo
 * faltasse, um aviso que sumia em segundos; nada dizia se o dinheiro tinha
 * entrado nem se o cliente seria avisado. Aqui a pessoa vê, antes de decidir:
 *   1. o que o banco ainda exige (as mesmas travas do `fechar_os`);
 *   2. quanto já foi recebido e quanto falta (para quem vê dinheiro);
 *   3. o caminho — o cliente retira, nós entregamos, ou já foi entregue — e o
 *      aviso que o cliente recebe em cada um.
 * Retirada e entrega não concluem: deixam o pedido pronto e avisam o cliente.
 * Só "já foi entregue" fecha a OS.
 */

type Caminho = "retirada" | "entrega" | "concluir";

const CAMINHOS: { chave: Caminho; titulo: string; texto: string; status: string; Icone: typeof Store }[] = [
  { chave: "retirada", titulo: "O cliente vai retirar", texto: "Fica pronto no balcão.", status: "aguardando_retirada", Icone: Store },
  { chave: "entrega", titulo: "Nós vamos entregar", texto: "Fica pronto para entrega.", status: "aguardando_entrega", Icone: Truck },
  { chave: "concluir", titulo: "Já foi entregue", texto: "Conclui e encerra a OS.", status: "concluido", Icone: PackageCheck },
];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function FinalizarOsDialog({
  osId,
  numero,
  valorTotal,
  aberto,
  onFechar,
}: {
  osId: string;
  numero: number | string;
  valorTotal: number | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { canSeeFinancials, canSeePrices } = useAuth();
  const [caminho, setCaminho] = useState<Caminho>("retirada");
  const [trabalhando, setTrabalhando] = useState(false);

  const travas = useQuery({
    queryKey: ["finalizar-travas", osId],
    enabled: aberto,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("os_bloqueios_para", { os_id: osId, novo_status: "concluido" });
      if (error) throw error;
      return bloqueiosSemDinheiro((data ?? []) as BloqueioOs[], canSeeFinancials, canSeePrices);
    },
  });

  const recebido = useQuery({
    queryKey: ["finalizar-recebido", osId],
    enabled: aberto && canSeePrices,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("pagamentos").select("valor, status").eq("os_id", osId);
      if (error) throw error;
      return (data ?? []).filter((p: any) => p.status === "pago").reduce((s: number, p: any) => s + Number(p.valor), 0);
    },
  });

  const escolhido = CAMINHOS.find((c) => c.chave === caminho)!;
  const aviso = avisoDoStatus(escolhido.status);
  const bloqueado = caminho === "concluir" && (travas.data?.length ?? 0) > 0;
  const falta = valorTotal != null && recebido.data != null ? Math.max(valorTotal - recebido.data, 0) : null;

  async function confirmar() {
    setTrabalhando(true);
    try {
      if (caminho === "concluir") {
        const { data, error } = await (supabase.rpc as any)("fechar_os", { os_id: osId });
        if (error) throw error;
        const res = data as { fechada?: boolean; bloqueios?: string[] } | null;
        if (res && res.fechada === false) {
          const motivos = (res.bloqueios ?? []).map((b) => `• ${rotuloBloqueio(b)}`).join("\n");
          toast.error("A OS ainda não pode ser fechada", { description: motivos });
          void travas.refetch();
          return;
        }
      } else {
        const { error } = await (supabase.rpc as any)("avancar_os_status", { os_id: osId, novo_status: escolhido.status });
        if (error) throw error;
      }
      toast.success(`Pedido #${numero}: ${escolhido.titulo.toLowerCase()}`, {
        description: aviso
          ? `O cliente recebe "${ROTULO_DO_AVISO[aviso] ?? "aviso"}" no WhatsApp em até 2 minutos.`
          : "Esta etapa não avisa o cliente.",
      });
      for (const chave of [["os", osId], ["resultado-os", osId], ["snapshot-os", osId], ["pag-os", osId], ["kanban-bloqueios"]]) {
        void qc.invalidateQueries({ queryKey: chave });
      }
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setTrabalhando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !trabalhando && onFechar()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Finalizar o pedido #{numero}</DialogTitle>
          <DialogDescription>Confira o que falta, escolha como o cliente recebe e confirme. Ele é avisado pelo WhatsApp.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="fin-faltas" className="space-y-1.5">
          <h3 id="fin-faltas" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            O que o sistema exige para concluir
          </h3>
          {travas.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Conferindo…</p>
          ) : travas.error ? (
            <p className="text-sm text-destructive" role="alert">Não consegui conferir agora: {mensagemErro(travas.error)}</p>
          ) : (travas.data ?? []).length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-[color:var(--bex-lime)]"><CheckCircle2 className="h-4 w-4" /> Nada pendente: pode concluir.</p>
          ) : (
            <ul className="space-y-1.5">
              {(travas.data ?? []).map((b) => (
                <li key={b.codigo} className="flex gap-2 rounded-md border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-2 text-sm">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" aria-hidden />
                  <span>
                    <strong>{b.titulo}</strong>
                    {b.resolver && <span className="block text-xs text-muted-foreground">{b.resolver}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {caminho !== "concluir" && (travas.data?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">Isso só impede <em>concluir</em>. Deixar pronto para retirada ou entrega segue liberado.</p>
          )}
        </section>

        {canSeePrices && valorTotal != null && (
          <section aria-label="Dinheiro do pedido" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>Valor do pedido <strong className="tabular-nums">{brl(valorTotal)}</strong></span>
              <span>Recebido <strong className="tabular-nums">{recebido.data != null ? brl(recebido.data) : "…"}</strong></span>
              {falta != null && (
                <span className={cn(falta > 0 ? "text-[color:var(--bex-amber)]" : "text-[color:var(--bex-lime)]")}>
                  {falta > 0 ? `Falta receber ${brl(falta)}` : "Totalmente recebido"}
                </span>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="fin-caminho" className="space-y-2">
          <h3 id="fin-caminho" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Como o cliente recebe?</h3>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="fin-caminho">
            {CAMINHOS.map(({ chave, titulo, texto, Icone }) => (
              <button
                key={chave}
                type="button"
                role="radio"
                aria-checked={caminho === chave}
                onClick={() => setCaminho(chave)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors",
                  caminho === chave ? "border-[color:var(--bex-cyan)] bg-[color:var(--bex-cyan)]/10" : "border-border hover:bg-muted",
                )}
              >
                <Icone className="h-4 w-4" aria-hidden />
                <span className="font-medium">{titulo}</span>
                <span className="text-xs text-muted-foreground">{texto}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {aviso ? <>Aviso ao cliente: <strong>{ROTULO_DO_AVISO[aviso]}</strong>, pelo WhatsApp, em até 2 minutos.</> : "Esta etapa não avisa o cliente."}
          </p>
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={trabalhando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={trabalhando || bloqueado || travas.isLoading}>
            {trabalhando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {bloqueado ? "Resolva o que falta para concluir" : `Confirmar: ${escolhido.titulo.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
