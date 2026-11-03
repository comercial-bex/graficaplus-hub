import type { LinhaDeMetragem } from "@/domain/orcamentos/metragem-por-material";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { descreverLinhaDeMetragem } from "@/domain/orcamentos/metragem-por-material";
import { brl, m2 } from "@/domain/orcamentos/acordo";
import { rotuloDaPorcentagem } from "@/domain/parceiros/prazo";
import { percentual } from "@/lib/percentual";
import type { PassoDoOrcamento } from "@/domain/parceiros/passos-do-orcamento";

export function ResumoLateral({
  canSeeFinancials,
  canSeePrices,
  descontoGravado,
  fechado,
  irParaPasso,
  itensDeProduto,
  linhaDaTaxa,
  linhasDeMetragem,
  margem,
  orc,
  pendencias,
  subtotalGravado,
  taxaDoPrazoDoOrcamento,
  totaisDeMetragem,
}: {
  canSeeFinancials: boolean;
  canSeePrices: boolean;
  descontoGravado: number;
  fechado: boolean;
  irParaPasso: (p: PassoDoOrcamento, alvo?: string) => void;
  itensDeProduto: any[];
  linhaDaTaxa: any;
  linhasDeMetragem: LinhaDeMetragem[];
  margem: number | null;
  orc: any;
  pendencias: string[];
  subtotalGravado: number;
  taxaDoPrazoDoOrcamento: number;
  totaisDeMetragem: { m2: number; gramas: number; };
}) {
  return (
    <aside className="min-w-0 space-y-4 lg:sticky lg:top-44 lg:self-start" data-testid="resumo-do-orcamento">
      <Card>
        <CardHeader className="px-4 pb-1 pt-3">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 px-4 pb-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Itens</span>
            <span className="font-medium">{itensDeProduto.length}</span>
          </div>
          {linhasDeMetragem.length > 0 && (
            <div className="space-y-1 border-t pt-2" data-testid="metragem-por-material">
              <p className="text-xs font-medium text-muted-foreground">Metragem por material</p>
              {linhasDeMetragem.map((l) => (
                <div key={l.material} className="flex justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate">{l.material}</span>
                  <span className="shrink-0 tabular-nums">{descreverLinhaDeMetragem(l)}</span>
                </div>
              ))}
              {linhasDeMetragem.length > 1 && (totaisDeMetragem.m2 > 0 || totaisDeMetragem.gramas > 0) && (
                <div className="flex justify-between gap-3 text-xs font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {[
                      totaisDeMetragem.m2 > 0 ? m2(totaisDeMetragem.m2) : null,
                      totaisDeMetragem.gramas > 0 ? `${Math.round(totaisDeMetragem.gramas)} g` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              )}
            </div>
          )}
          {canSeePrices && linhaDaTaxa && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                Expresso (+{rotuloDaPorcentagem(taxaDoPrazoDoOrcamento)})
              </span>
              <span className="tabular-nums">{brl(linhaDaTaxa.valor_total)}</span>
            </div>
          )}
          {canSeePrices && descontoGravado > 0 && (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Soma dos itens</span>
                <span className="tabular-nums">{brl(subtotalGravado)}</span>
              </div>
              <div className="flex justify-between gap-3">
                {/* Leva ao passo 3, onde o desconto é acertado e aprovado — não só rola a página.
                    O rodapé da tabela de itens, que tinha este atalho, saiu a pedido do dono (27/10):
                    o atalho continua aqui, no resumo que fica ao lado em todos os passos. */}
                <button
                  type="button"
                  className="text-left text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => irParaPasso(3, "acordo-desconto")}
                >
                  Desconto
                </button>
                <span className="tabular-nums">− {brl(descontoGravado)}</span>
              </div>
            </>
          )}
          {canSeePrices && (
            <div className="flex justify-between gap-3 border-t pt-2">
              <span className="text-muted-foreground">Total</span>
              <strong className="tabular-nums">{brl(orc.valor_total)}</strong>
            </div>
          )}
          {canSeeFinancials && (
            <>
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  Custo <span className="tabular-nums text-foreground">{brl(orc.custo_estimado)}</span>
                </span>
                {margem !== null && (
                  <span className="text-muted-foreground">
                    Margem{" "}
                    <strong className={margem < 20 ? "text-destructive" : "text-success"}>{percentual(margem)}</strong>
                  </span>
                )}
              </div>
            </>
          )}
          {!fechado && (
            <button
              type="button"
              className="w-full border-t pt-2 text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => irParaPasso(4)}
            >
              {pendencias.length === 0
                ? "Nada falta para enviar"
                : `${pendencias.length} ${pendencias.length === 1 ? "pendência" : "pendências"} · ver na revisão`}
            </button>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}
