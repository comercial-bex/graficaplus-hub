import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { Card, CardContent } from "@/components/ui/card";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import {
  aprovarPrecoProposto,
  lerPrecosPendentes,
  recusarPrecoProposto,
} from "@/lib/api/precos-pendentes.functions";
import { LEGENDA_DAS_FAIXAS, PropostaDePrecoCartao } from "@/components/precos/proposta-de-preco";
import { brl } from "@/components/precos/tipos";

export const Route = createFileRoute("/_authenticated/precos-pendentes")({
  head: () => ({ meta: [{ title: "Preços pendentes de aprovação — BEX PRINT OS" }] }),
  component: PrecosPendentesPage,
});

const CHAVE = ["precos-pendentes"];

function PrecosPendentesPage() {
  const qc = useQueryClient();
  const ler = useServerFn(lerPrecosPendentes);
  const aprovar = useServerFn(aprovarPrecoProposto);
  const recusar = useServerFn(recusarPrecoProposto);
  const painel = useQuery({ queryKey: CHAVE, queryFn: () => ler() });

  const depois = () => qc.invalidateQueries({ queryKey: CHAVE });
  const aprovando = useMutation({
    mutationFn: (id: string) => aprovar({ data: { id } }),
    onSuccess: () => {
      toast.success("Preço aprovado e gravado no produto.");
      void depois();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const recusando = useMutation({
    mutationFn: (v: { id: string; nota: string }) => recusar({ data: v }),
    onSuccess: () => {
      toast.success("Proposta recusada. O preço continua como estava.");
      void depois();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const ocupado = aprovando.isPending || recusando.isPending;

  return (
    <div className="space-y-4 text-base">
      <SectionHeader
        breadcrumb="Financeiro"
        title="Preços pendentes de aprovação"
        description="Aqui estão os preços que o sistema acha errados. Cada um mostra o piso, a margem de hoje e a margem se você aprovar o preço novo. O preço nunca é consertado baixando a margem mínima."
        ajuda={dicaTela("/precos-pendentes")}
        legivel
      />

      {painel.isLoading ? (
        <Carregando />
      ) : painel.isError ? (
        <Card>
          <CardContent className="p-4 text-base text-destructive" role="alert">
            Não deu para carregar os preços. {mensagemErro(painel.error)}
          </CardContent>
        </Card>
      ) : painel.data ? (
        <>
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2" data-testid="media-m2">
              <div>
                <div className="text-muted-foreground">Média atual do metro quadrado impresso</div>
                <div className="text-xl font-semibold">
                  {painel.data.mediaM2 ? brl(painel.data.mediaM2.media) : "Sem dado"}
                </div>
                {painel.data.mediaM2 ? (
                  <div className="text-muted-foreground">Média de {painel.data.mediaM2.quantidade} produtos de impressão em grande formato.</div>
                ) : null}
              </div>
              <div>
                <div className="text-muted-foreground">Referência da casa</div>
                <div className="text-xl font-semibold">{brl(painel.data.referencia)} por metro quadrado</div>
              </div>
            </CardContent>
          </Card>

          <ul className="space-y-1" aria-label="Legenda das cores">
            {LEGENDA_DAS_FAIXAS.map((l) => (
              <li key={l.faixa}>{l.texto}</li>
            ))}
          </ul>

          {painel.data.propostas.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-base" data-testid="estado-vazio">
                <p className="font-semibold">Nenhum preço esperando aprovação.</p>
                <p className="mt-1">Quando o sistema achar um preço abaixo do piso ou longe da referência, ele aparece aqui.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {painel.data.propostas.map((p) => (
                <PropostaDePrecoCartao
                  key={p.id}
                  proposta={p}
                  podeDecidir={painel.data.podeDecidir}
                  ocupado={ocupado}
                  aoAprovar={(id) => aprovando.mutate(id)}
                  aoRecusar={(id, nota) => recusando.mutate({ id, nota })}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
