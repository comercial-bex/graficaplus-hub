import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dicaTela } from "@/lib/dicas";
import { Carregando } from "@/components/bex/Carregando";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { lerPainelDoAgente } from "@/lib/api/agente-escolhe.functions";
import { Aviso, ErroDaTela } from "@/components/triagem/comum";
import { MetricasDoAgente, CHAVE_METRICAS_DO_AGENTE } from "@/components/agente/metricas-do-agente";
import { PainelDeLigaDoAgente } from "@/components/agente/painel-de-liga";
import { SimuladorDoAgente } from "@/components/agente/simulador-do-agente";

/**
 * O agente que responde com as respostas aprovadas (C4): onde o dono liga, sobe, desce e desliga o agente, simula uma
 * pergunta sem mandar nada e acompanha as métricas.
 *
 * Nasce DESLIGADO e esta tela não liga nada sozinha: cada botão chama uma função do servidor que confere a permissão
 * (whatsapp.manage para ligar, subir, descer, porcentagem e números de teste; as duas permissões podem desligar tudo e ler).
 * O agente nunca escreve texto livre e nunca diz preço, prazo, desconto nem orçamento: ele só escolhe uma resposta que o dono
 * aprovou, ou passa a conversa para a equipe.
 *
 * Letra de 16 px, contraste de 4,5 para 1 e alvos de 44 px: o dono enxerga mal. Fica fora do menu e abre por Dados da
 * empresa, como o Robô de boas-vindas e as Respostas do agente.
 */
export const Route = createFileRoute("/_authenticated/configuracoes-agente")({
  head: () => ({ meta: [{ title: "Agente de respostas — BEX PRINT OS" }] }),
  component: ConfiguracoesAgentePage,
});

const CHAVE_PAINEL = ["agente-painel"] as const;

function ConfiguracoesAgentePage() {
  const qc = useQueryClient();
  const ler = useServerFn(lerPainelDoAgente);
  const painel = useQuery({ queryKey: CHAVE_PAINEL, queryFn: () => ler() });
  const recarregar = () => {
    qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
    qc.invalidateQueries({ queryKey: CHAVE_METRICAS_DO_AGENTE });
  };

  return (
    <div className="max-w-5xl space-y-6 text-base">
      {/* sem o "?" do cabeçalho: o ícone de dica tem alvo de 20 px e abre em texto pequeno. A mesma explicação, da
          central de dicas, fica escrita aqui embaixo, em 16 px */}
      <SectionHeader
        legivel
        breadcrumb="Configurações"
        title="Agente de respostas"
        description="Liga e desliga o agente que responde com as respostas que você aprovou, simula uma pergunta e mostra como ele está indo."
      />

      <Aviso>
        <p>{dicaTela("/configuracoes-agente")}</p>
        <p className="mt-2">
          Quem a equipe já atendeu, as empresas que mandam mensagem automática e quem pediu para
          parar ficam de fora.
        </p>
      </Aviso>

      {painel.isLoading ? (
        <Carregando />
      ) : painel.error || !painel.data ? (
        <ErroDaTela
          erro={painel.error}
          aoTentar={() => painel.refetch()}
          titulo="Não consegui carregar o agente"
        />
      ) : !painel.data.instalada || !painel.data.config ? (
        <Aviso tom="atencao">
          <p className="font-semibold">O agente ainda não foi instalado no banco.</p>
          <p className="mt-1">
            A tela está pronta, mas a parte do banco ainda não foi aplicada. Avise quem cuida do
            sistema. Até lá o agente não existe e nenhuma conversa é afetada.
          </p>
        </Aviso>
      ) : (
        <>
          <PainelDeLigaDoAgente
            painel={{ ...painel.data, config: painel.data.config }}
            aoMudar={recarregar}
          />
          <SimuladorDoAgente painel={painel.data} />
          <MetricasDoAgente />
        </>
      )}
    </div>
  );
}
