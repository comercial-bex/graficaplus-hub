import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dicaTela } from "@/lib/dicas";
import { Carregando } from "@/components/bex/Carregando";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { lerPainelDaBase } from "@/lib/api/agente-base.functions";
import { AVISO_BASE_NAO_INSTALADA } from "@/domain/agente-base/fila";
import { Aviso, ErroDaTela } from "@/components/triagem/comum";
import { EnsaioDaPergunta } from "@/components/agente-base/ensaio-da-pergunta";
import { FilaDeAprovacao } from "@/components/agente-base/fila-de-aprovacao";

/**
 * Base de respostas do agente (14/11/2026): onde o dono lê e aprova, uma de cada
 * vez, as respostas que o agente poderá usar depois. O agente e os assistentes de
 * texto livre estão DESLIGADOS e nada lê esta base ainda: aprovar não muda o que
 * nenhum contato recebe. As respostas nunca citam preço, prazo em número,
 * desconto nem orçamento; o que a casa não sabe vira "a equipe confirma".
 *
 * Quem aprova é só quem tem a permissão de gerenciar o WhatsApp (hoje, o dono).
 * Quem gerencia as configurações edita e deixa o rascunho pronto. A rota abre com
 * qualquer uma das duas. Fica fora do menu e abre por Dados da empresa, como o
 * Robô de boas-vindas.
 *
 * Letra de 16 px, contraste de 4,5 para 1 e alvos de 44 px: o dono enxerga mal.
 */
export const Route = createFileRoute("/_authenticated/configuracoes-agente-base")({
  head: () => ({ meta: [{ title: "Respostas do agente — BEX PRINT OS" }] }),
  component: ConfiguracoesAgenteBasePage,
});

const CHAVE_PAINEL = ["agente-base-painel"] as const;

function ConfiguracoesAgenteBasePage() {
  const qc = useQueryClient();
  const ler = useServerFn(lerPainelDaBase);
  const painel = useQuery({ queryKey: CHAVE_PAINEL, queryFn: () => ler() });
  const recarregar = () => qc.invalidateQueries({ queryKey: CHAVE_PAINEL });

  return (
    <div className="max-w-5xl space-y-6 text-base">
      <SectionHeader
        legivel
        breadcrumb="Configurações"
        title="Respostas do agente"
        description="Leia e aprove, uma por vez, as respostas que o agente poderá usar depois."
      />

      <Aviso>
        <p>{dicaTela("/configuracoes-agente-base")}</p>
        <p className="mt-2">
          As respostas nunca falam preço, prazo em número, desconto nem orçamento. Quando a casa
          não sabe, a resposta diz que a equipe confirma.
        </p>
      </Aviso>

      {painel.isLoading ? (
        <Carregando />
      ) : painel.error || !painel.data ? (
        <ErroDaTela
          erro={painel.error}
          aoTentar={() => painel.refetch()}
          titulo="Não consegui carregar as respostas do agente"
        />
      ) : !painel.data.instalada ? (
        <Aviso tom="atencao">
          <p>{AVISO_BASE_NAO_INSTALADA}</p>
        </Aviso>
      ) : (
        <>
          <FilaDeAprovacao painel={painel.data} aoMudar={recarregar} />
          <EnsaioDaPergunta painel={painel.data} />
        </>
      )}
    </div>
  );
}
