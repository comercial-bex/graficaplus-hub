import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { PrazoDeProducao } from "@/components/orcamento/prazo-de-producao";
import { AlertTriangle, Loader2 } from "lucide-react";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { EntregaEPrazos, Observacoes, Pagamento } from "@/components/orcamento/acordo-do-orcamento";
import { DescontoDoOrcamento } from "@/components/orcamento/desconto-do-orcamento";
import type { AcordoDoOrcamento } from "@/components/orcamento/acordo-do-orcamento";

export function PassoPrazoEEntrega({
  acordo,
  canSeeFinancials,
  canSeePrices,
  dadosDoAcordo,
  fechado,
  id,
  itensDeProduto,
  orc,
  podeConverter,
  podeMexer,
  setConferindo,
  setTotalPrevisto,
  totalPrevisto,
}: {
  acordo: UseQueryResult<AcordoDoOrcamento | null, Error>;
  canSeeFinancials: boolean;
  canSeePrices: boolean;
  dadosDoAcordo: AcordoDoOrcamento | null;
  fechado: boolean;
  id: any;
  itensDeProduto: any[];
  orc: any;
  podeConverter: boolean;
  podeMexer: boolean;
  setConferindo: Dispatch<SetStateAction<"aprovado" | "enviado" | null>>;
  setTotalPrevisto: Dispatch<SetStateAction<number | null>>;
  totalPrevisto: number | null;
}) {
  return (
    <div className="space-y-4">
      <PrazoDeProducao
        orcamentoId={id}
        prazoTipo={dadosDoAcordo?.prazo_tipo ?? null}
        baseDaTaxa={
          canSeePrices
            ? itensDeProduto.reduce((soma: number, i) => soma + Number(i.valor_total ?? 0), 0)
            : null
        }
        podeEditar={podeMexer}
      />
      {acordo.isError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-2">
            <p>Não foi possível carregar prazos e pagamento: {mensagemErro(acordo.error)}</p>
            <Button size="sm" variant="outline" onClick={() => void acordo.refetch()}>
              Tentar de novo
            </Button>
          </div>
        </div>
      ) : dadosDoAcordo ? (
        <>
          <EntregaEPrazos acordo={dadosDoAcordo} podeEditar={podeMexer} jaVirouOs={!!(orc as any).os_id || orc.status === "convertido"} />
          {/* Desconto e parcelamento são preço: quem não vê preço não vê
              estes blocos (mostrariam "1× de R$ 0,00", que é mentira). O
              desconto vem antes porque é ele que muda o total das parcelas. */}
          {canSeePrices && (
            <DescontoDoOrcamento
              orcamentoId={id}
              podeEditar={podeMexer}
              verCusto={canSeeFinancials}
              onPrevia={setTotalPrevisto}
            />
          )}
          {canSeePrices && (
            <Pagamento
              orcamentoId={id}
              total={totalPrevisto ?? Number(orc.valor_total ?? 0)}
              previa={totalPrevisto != null}
              condicao={dadosDoAcordo.condicao_pagamento}
              podeEditar={podeMexer}
              prazo={dadosDoAcordo.prazo ?? dadosDoAcordo.data_entrega_prometida}
              numero={Number((orc as any).numero ?? 0) || null}
              clienteId={(dadosDoAcordo as any).cliente_id ?? null}
              aoMarcarPixRecebido={() => {
                // Aprovado + sinal recebido = pode virar OS agora: abre a conferência.
                if (orc.status === "aprovado" && !fechado && podeConverter) setConferindo("aprovado");
              }}
              clienteNome={orc.cliente_nome ?? (orc as any).contato_nome ?? null}
              clienteTelefone={
                ((orc as any).cliente_whatsapp ?? (orc as any).cliente_telefone ?? (orc as any).contato_telefone ?? null) as string | null
              }
            />
          )}
          <Observacoes acordo={dadosDoAcordo} podeEditar={podeMexer} />
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando prazos e pagamento…
        </p>
      )}
    </div>
  );
}
