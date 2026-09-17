import { Link } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/bex/StatusChip";
import { brl } from "@/domain/parceiros/preco";
import {
  PASSOS_DO_PEDIDO,
  situacaoDoPedido,
  type PainelDoParceiro,
  type PedidoDoParceiro,
} from "@/domain/parceiros/painel";

/** Os pedidos feitos à gráfica e onde cada um está na produção. */
export function Pedidos({ painel }: { painel: PainelDoParceiro }) {
  const { pedidos, contato } = painel;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Package className="h-5 w-5 text-[color:var(--bex-cyan)]" />
        Seus pedidos
      </h2>
      {pedidos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          Quando o cliente aprovar um orçamento, abra o orçamento e toque em{" "}
          <span className="font-medium text-foreground">Fazer pedido</span>. Ele aparece aqui com o
          andamento da produção.
        </div>
      ) : (
        <ul className="space-y-2">
          {pedidos.map((p) => (
            <PedidoLinha key={p.orcamento_parceiro_id} pedido={p} />
          ))}
        </ul>
      )}
      {pedidos.length > 0 && contato.telefones && (
        <p className="text-xs text-muted-foreground">
          Arte e dúvidas do pedido: fale com {contato.atendente ?? "a gráfica"} pelo{" "}
          {contato.telefones}
          {contato.email ? ` ou ${contato.email}` : ""}, sempre citando o número do pedido.
        </p>
      )}
    </section>
  );
}

function PedidoLinha({ pedido }: { pedido: PedidoDoParceiro }) {
  const s = situacaoDoPedido(pedido);
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/parceiro/orcamentos/$id"
            params={{ id: pedido.orcamento_parceiro_id }}
            className="block truncate font-medium hover:underline"
          >
            {pedido.titulo}
          </Link>
          <p className="text-xs text-muted-foreground">
            Pedido nº {pedido.pedido_numero} · {new Date(pedido.enviado_em).toLocaleDateString("pt-BR")} ·{" "}
            {brl(pedido.valor)}
          </p>
        </div>
        <StatusChip label={s.rotulo} tone={s.tom} />
      </div>
      {s.passo !== null && (
        <ol className="mt-3 grid grid-cols-5 gap-1" aria-label="Andamento do pedido">
          {PASSOS_DO_PEDIDO.map((passo, i) => (
            <li key={passo} className="space-y-1">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  i <= (s.passo ?? -1) ? "bg-[color:var(--bex-cyan)]" : "bg-foreground/10",
                )}
              />
              <p
                className={cn(
                  "truncate text-[10px]",
                  i === s.passo ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {passo}
              </p>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
