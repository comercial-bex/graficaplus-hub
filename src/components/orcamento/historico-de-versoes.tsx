import { useQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { funcaoAusente } from "@/domain/orcamentos/acoes-do-orcamento";
import {
  TEXTO_HISTORICO_FALHOU,
  TEXTO_HISTORICO_INDISPONIVEL,
  TEXTO_SEM_VERSOES,
  autorDaVersao,
  frasesDoQueMudou,
  lerHistorico,
  rotuloDaVersao,
  type VersaoDoHistorico,
} from "@/domain/orcamentos/historico-de-versoes";

/**
 * Quadro "Histórico de versões" do orçamento (17/11/2026). Cada envio e a aprovação congelam uma versão no
 * banco; aqui a equipe vê o que o cliente recebeu e o que mudou de uma versão para outra.
 * Os três estados (carregando, vazio e erro) aparecem escritos: falha nunca se passa por "sem versões".
 */

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : null;

class HistoricoIndisponivel extends Error {}

export function HistoricoDeVersoes({ orcamentoId }: { orcamentoId: string }) {
  const consulta = useQuery({
    queryKey: ["orcamento", orcamentoId, "historico-de-versoes"],
    retry: false,
    queryFn: async (): Promise<VersaoDoHistorico[]> => {
      const { data, error } = await (supabase.rpc as any)("orcamento_historico_de_versoes", { p_orcamento: orcamentoId });
      if (error) {
        if (funcaoAusente(error)) throw new HistoricoIndisponivel();
        throw error;
      }
      const lido = lerHistorico(data);
      if (!lido) throw new Error("Resposta inesperada do histórico");
      return lido;
    },
  });

  return (
    <Card data-testid="historico-de-versoes">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5" aria-hidden="true" /> Histórico de versões
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-base">
        {consulta.isPending && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carregando o histórico...
          </p>
        )}

        {consulta.isError && (
          <div role="alert" data-estado="erro" className="space-y-2">
            <p className="text-foreground">
              {consulta.error instanceof HistoricoIndisponivel ? TEXTO_HISTORICO_INDISPONIVEL : TEXTO_HISTORICO_FALHOU}
            </p>
            {!(consulta.error instanceof HistoricoIndisponivel) && (
              <Button variant="outline" className="h-11 text-base" onClick={() => void consulta.refetch()}>
                Tentar de novo
              </Button>
            )}
          </div>
        )}

        {consulta.isSuccess && consulta.data.length === 0 && (
          <p data-estado="vazio" className="text-muted-foreground">
            {TEXTO_SEM_VERSOES}
          </p>
        )}

        {consulta.isSuccess && consulta.data.length > 0 && (
          <ol className="space-y-3" data-estado="lista">
            {consulta.data.map((v) => (
              <li key={v.id} className="rounded-md border border-border p-3 space-y-1" data-versao={v.numero}>
                <p className="font-semibold text-foreground">
                  Versão {v.numero} · {rotuloDaVersao(v)}
                  {v.retroativa ? " · Registrada depois" : ""}
                </p>
                <p className="text-foreground">
                  {brl(v.valor_total)}
                  {v.valor_anterior != null && v.valor_anterior !== v.valor_total ? `, antes ${brl(v.valor_anterior)}` : ""}
                  {v.retroativa ? "" : `, ${v.qtd_itens} ${v.qtd_itens === 1 ? "item" : "itens"}`}
                </p>
                <p className="text-muted-foreground">
                  {[
                    quando(v.enviada_em) ? `Enviada em ${quando(v.enviada_em)}` : null,
                    quando(v.aprovada_em) ? `Aprovada em ${quando(v.aprovada_em)}` : null,
                    autorDaVersao(v),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {frasesDoQueMudou(v).map((f) => (
                  <p key={f} className="text-foreground">
                    {f}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
