import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dicaTela } from "@/lib/dicas";
import { Carregando } from "@/components/bex/Carregando";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { lerPainelDaTriagem } from "@/lib/api/whatsapp-triagem.functions";
import { Aviso, ErroDaTela } from "@/components/triagem/comum";
import { HorariosEFeriados } from "@/components/triagem/horarios-e-feriados";
import { PainelDeLiga } from "@/components/triagem/painel-de-liga";
import { QuadroDeRespostas } from "@/components/triagem/quadro-de-respostas";
import { Simulador } from "@/components/triagem/simulador";
import { TextosDasEtapas } from "@/components/triagem/textos-das-etapas";

/**
 * Robô de boas-vindas do WhatsApp (13/11/2026): onde o dono liga, sobe, desce e
 * desliga o robô, edita o que ele diz e testa uma conversa sem mandar nada.
 *
 * Nasce DESLIGADO e esta tela não liga nada sozinha: cada botão chama uma função
 * do servidor que confere a permissão (whatsapp.manage para ligar, subir, descer,
 * porcentagem, números de teste e freios; configuracoes.manage para textos,
 * quadro, link e horário; as duas podem desligar tudo). A rota abre com qualquer
 * uma das duas. Os tempos e os freios têm padrão no banco e o servidor sabe
 * salvá-los (`salvarConfigDaTriagem`), mas esta tela ainda NÃO tem campo para
 * eles: ficam para uma próxima etapa.
 *
 * Letra de 16 px, contraste de 4,5 para 1 e alvos de 44 px: o dono enxerga mal.
 * Fica fora do menu e abre por Dados da empresa, como a Origem dos contatos.
 */
export const Route = createFileRoute("/_authenticated/configuracoes-triagem")({
  head: () => ({ meta: [{ title: "Robô de boas-vindas — BEX PRINT OS" }] }),
  component: ConfiguracoesTriagemPage,
});

const CHAVE_PAINEL = ["triagem-painel"] as const;

function ConfiguracoesTriagemPage() {
  const qc = useQueryClient();
  const ler = useServerFn(lerPainelDaTriagem);
  const painel = useQuery({ queryKey: CHAVE_PAINEL, queryFn: () => ler() });
  const recarregar = () => qc.invalidateQueries({ queryKey: CHAVE_PAINEL });

  return (
    <div className="max-w-5xl space-y-6 text-base">
      {/* sem o "?" do cabeçalho: o ícone de dica tem alvo de 20 px e abre em texto pequeno. A mesma explicação, da
          central de dicas, fica escrita aqui embaixo, em 16 px */}
      <SectionHeader
        legivel
        breadcrumb="Configurações"
        title="Robô de boas-vindas"
        description="Liga e desliga o robô que recebe quem escreve primeiro, e edita o que ele diz."
      />

      <Aviso>
        <p>{dicaTela("/configuracoes-triagem")}</p>
        <p className="mt-2">
          Quem já é cliente cadastrado, quem a equipe já atendeu e as empresas que mandam mensagem
          automática ficam de fora.
        </p>
      </Aviso>

      {painel.isLoading ? (
        <Carregando />
      ) : painel.error || !painel.data ? (
        <ErroDaTela
          erro={painel.error}
          aoTentar={() => painel.refetch()}
          titulo="Não consegui carregar o robô de boas-vindas"
        />
      ) : (
        <>
          <PainelDeLiga painel={painel.data} aoMudar={recarregar} />
          <Simulador painel={painel.data} />
          <TextosDasEtapas painel={painel.data} aoMudar={recarregar} />
          <QuadroDeRespostas painel={painel.data} aoMudar={recarregar} />
          <HorariosEFeriados painel={painel.data} aoMudar={recarregar} />
        </>
      )}
    </div>
  );
}
