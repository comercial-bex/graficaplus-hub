import { Link } from "@tanstack/react-router";
import { Ban, ClipboardCheck, PackageCheck, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  acoesDoPedido,
  faltaReceber,
  ROTULO_STATUS,
  totalDoPedido,
  type PedidoDeCompra,
  type PermissoesDeCompra,
  type StatusDoPedido,
} from "@/components/compras/pedido";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtd = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

const TOM: Record<StatusDoPedido, string> = {
  rascunho: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  enviado: "border-sky-500/50 text-sky-700 dark:text-sky-400",
  recebido_parcial: "border-violet-500/50 text-violet-700 dark:text-violet-400",
  recebido: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  cancelado: "border-border text-muted-foreground",
};

/** Data sem hora lida como dia local — `new Date("2026-10-09")` cairia no dia 8 em Macapá. */
function dia(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR");
}

/**
 * Um pedido de compra: cabeçalho, itens com o que chegou e o que falta, e só
 * os botões que este pedido e esta pessoa podem usar (`acoesDoPedido`).
 */
export function PedidoCard({
  pedido,
  numeroDaOs,
  permissoes,
  podeVerCusto,
  onRevisar,
  onReceber,
  onCancelar,
}: {
  pedido: PedidoDeCompra;
  /** número da OS de origem, quando o pedido nasceu do "Comprar o que falta" */
  numeroDaOs: number | null;
  permissoes: PermissoesDeCompra;
  podeVerCusto: boolean;
  onRevisar: (p: PedidoDeCompra) => void;
  onReceber: (p: PedidoDeCompra) => void;
  onCancelar: (p: PedidoDeCompra) => void;
}) {
  const itens = pedido.pedido_compra_itens ?? [];
  const acoes = acoesDoPedido({ status: pedido.status, itens }, permissoes);
  const total = totalDoPedido(itens);
  const historico = pedido.status === "recebido" || pedido.status === "cancelado";

  return (
    <Card className={historico ? "opacity-80" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold">#{pedido.numero}</span>
              <span className="truncate font-medium">{pedido.fornecedor}</span>
              <Badge variant="outline" className={`font-normal ${TOM[pedido.status] ?? ""}`}>
                {ROTULO_STATUS[pedido.status] ?? pedido.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>feito em {new Date(pedido.created_at).toLocaleDateString("pt-BR")}</span>
              {pedido.previsao_entrega && <span>previsão {dia(pedido.previsao_entrega)}</span>}
              {pedido.os_id && (
                <Link
                  to="/os/$id"
                  params={{ id: pedido.os_id }}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  nasceu da falta de material da OS{numeroDaOs ? ` #${numeroDaOs}` : ""}
                </Link>
              )}
            </div>
          </div>
          {podeVerCusto && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
              <div className="font-mono text-lg font-bold tabular-nums">{brl(total)}</div>
            </div>
          )}
        </div>

        {itens.length === 0 ? (
          // Pedido sem item só existia pelo formulário antigo, que gravava o
          // cabeçalho e o item em duas chamadas. Dito, em vez de um total zero mudo.
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Este pedido não tem nenhum material. Corrija pelo botão de revisar ou cancele.
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {itens.map((i) => {
              const falta = faltaReceber(i);
              const unidade = i.material?.unidade ?? "un";
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                  <span className="min-w-0 font-medium">{i.material?.nome ?? "Material"}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                    <span>
                      chegou {qtd(i.quantidade_recebida)} de {qtd(i.quantidade)} {unidade}
                    </span>
                    {podeVerCusto && (
                      <span>
                        {brl(Number(i.custo_unitario))}/{unidade} ·{" "}
                        {brl(Number(i.quantidade) * Number(i.custo_unitario))}
                      </span>
                    )}
                    {falta > 0 && pedido.status !== "cancelado" ? (
                      <Badge variant="outline" className="font-normal">
                        falta {qtd(falta)}
                      </Badge>
                    ) : falta === 0 ? (
                      <Badge variant="secondary" className="font-normal">
                        completo
                      </Badge>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {pedido.observacoes && (
          <p className="whitespace-pre-line text-xs text-muted-foreground">{pedido.observacoes}</p>
        )}

        {acoes.receberBloqueado && (
          <p className="text-xs text-muted-foreground">{acoes.receberBloqueado}</p>
        )}

        {(acoes.revisar || acoes.editar || acoes.receber || acoes.cancelar) && (
          <div className="flex flex-wrap gap-2">
            {acoes.revisar && (
              <Button size="sm" className="h-11 md:h-8" onClick={() => onRevisar(pedido)}>
                <ClipboardCheck className="mr-1 h-4 w-4" /> Revisar e registrar
              </Button>
            )}
            {acoes.receber && (
              <Button size="sm" className="h-11 md:h-8" onClick={() => onReceber(pedido)}>
                <PackageCheck className="mr-1 h-4 w-4" /> Receber
              </Button>
            )}
            {acoes.editar && (
              <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => onRevisar(pedido)}>
                <Pencil className="mr-1 h-4 w-4" /> Corrigir
              </Button>
            )}
            {acoes.cancelar && (
              <Button
                size="sm"
                variant="ghost"
                className="h-11 text-muted-foreground md:h-8"
                onClick={() => onCancelar(pedido)}
              >
                <Ban className="mr-1 h-4 w-4" /> Cancelar
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
