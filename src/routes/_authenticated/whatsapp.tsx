import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, ListChecks, Loader2, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { useAuth } from "@/lib/auth-context";
import { getRoutePermissions } from "@/lib/permissions";
import { dicaTela } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { situacaoDaConexao } from "@/domain/whatsapp/situacao-conexao";
import {
  contarPorAba,
  filtrarConversas,
  instanciaPrincipal,
  vazioDaCaixa,
  type Aba,
} from "@/domain/whatsapp/caixa-de-entrada";
import {
  LIMITE_CONVERSAS,
  useConversas,
  useInstancias,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { ListaDeConversas } from "@/components/whatsapp/lista-de-conversas";
import { ConversaAberta } from "@/components/whatsapp/conversa-aberta";
import { PainelDaConversa } from "@/components/whatsapp/painel-da-conversa";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — BEX PRINT OS" }] }),
  component: CaixaDeEntradaPage,
});

/**
 * Caixa de entrada do WhatsApp.
 *
 * Até 02/10/2026 esta rota era uma demonstração: conversas e mensagens fixas
 * no código, sem nenhuma leitura do banco, e sete botões sem ação — enquanto
 * estava no menu como se fosse o atendimento de verdade. Agora ela lê as
 * tabelas que o webhook do Z-API escreve (`whatsapp_conversas` e
 * `whatsapp_mensagens`, por `whatsapp_registrar_mensagem`), responde pela fila
 * que já existia (`whatsapp_responder` + POST /api/whatsapp/enviar) e grava no
 * banco tudo o que a tela antiga só fingia: concluir, etiquetar, ligar ao
 * cliente, abrir orçamento e OS.
 *
 * O simulador do "Bot WhatsApp" saiu: nenhum robô responde mensagem neste
 * sistema (o webhook não chama `whatsapp-bot.ts`), e mostrar "Estados
 * configurados" fazia parecer que havia um no ar.
 */
function CaixaDeEntradaPage() {
  const { hasPermission } = useAuth();
  const temPermissaoDeResponder = hasPermission("whatsapp.reply");
  // A mesma régua do menu: link só para quem a rota deixa entrar.
  const abre = (rota: string) => (getRoutePermissions(rota) ?? []).some(hasPermission);

  const instancias = useInstancias();
  const conversas = useConversas(true);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<Aba>("abertas");
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);

  const listaInstancias = instancias.data ?? [];
  const principal = instanciaPrincipal(listaInstancias);
  const situacao = situacaoDaConexao(principal);
  const lista = conversas.data ?? [];
  const filtradas = filtrarConversas(lista, { busca, aba });
  const selecionada = lista.find((c) => c.id === selecionadaId) ?? null;
  // A resposta sai pela instância DA CONVERSA, não pela do topo da tela.
  const instanciaDaConversa = selecionada
    ? (listaInstancias.find((i) => i.id === selecionada.instancia_id) ?? null)
    : null;

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/whatsapp")}
        breadcrumb="Atendimento · Caixa de entrada"
        title="WhatsApp"
        description="As conversas que chegam no número da empresa. Responda, ligue ao cliente e transforme o pedido em orçamento."
        className="mb-2"
        actions={
          <>
            {!instancias.isPending && !instancias.isError && (
              <StatusChip label={situacao.rotulo} tone={situacao.tom} />
            )}
            {abre("/respostas-rapidas") && (
              <Button asChild variant="outline" size="sm">
                <Link to="/respostas-rapidas">
                  <ListChecks className="mr-1 h-4 w-4" /> Respostas rápidas
                </Link>
              </Button>
            )}
            {abre("/whatsapp-monitor") && (
              <Button asChild variant="outline" size="sm">
                <Link to="/whatsapp-monitor">
                  <Activity className="mr-1 h-4 w-4" /> Monitor
                </Link>
              </Button>
            )}
          </>
        }
      />

      {instancias.isError && (
        <FalhaDeConsulta
          titulo="Não foi possível conferir a conexão do WhatsApp"
          erro={instancias.error}
          onTentarDeNovo={() => void instancias.refetch()}
        />
      )}

      {conversas.isError ? (
        <FalhaDeConsulta
          titulo="Não foi possível carregar as conversas"
          erro={conversas.error}
          onTentarDeNovo={() => void conversas.refetch()}
        />
      ) : conversas.isPending || instancias.isPending ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando as conversas…
        </div>
      ) : lista.length === 0 ? (
        <CaixaVazia
          titulo={instancias.isError ? "Nenhuma conversa ainda" : vazioDaCaixa(principal).titulo}
          detalhe={
            instancias.isError
              ? "A conexão do WhatsApp não pôde ser conferida agora — veja o erro acima."
              : vazioDaCaixa(principal).detalhe
          }
          abreMonitor={abre("/whatsapp-monitor")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-12 xl:h-[calc(100vh-13rem)]">
          <ListaDeConversas
            className={cn(
              "h-[70vh] lg:col-span-4 xl:col-span-3 xl:h-auto xl:min-h-0",
              selecionada && "hidden lg:flex",
            )}
            conversas={filtradas}
            totalCarregado={lista.length}
            limiteAtingido={lista.length >= LIMITE_CONVERSAS}
            contagem={contarPorAba(lista)}
            selecionadaId={selecionadaId}
            onSelecionar={setSelecionadaId}
            busca={busca}
            onBusca={setBusca}
            aba={aba}
            onAba={setAba}
          />
          {selecionada ? (
            <>
              <ConversaAberta
                key={selecionada.id}
                className="h-[75vh] lg:col-span-8 xl:col-span-6 xl:h-auto xl:min-h-0"
                conversa={selecionada}
                instancia={instanciaDaConversa}
                conexaoComFalha={instancias.isError}
                temPermissaoDeResponder={temPermissaoDeResponder}
                onVoltar={() => setSelecionadaId(null)}
              />
              <PainelDaConversa
                className="lg:col-span-12 xl:col-span-3 xl:h-auto xl:min-h-0"
                conversa={selecionada}
              />
            </>
          ) : (
            <Card className="hidden items-center justify-center p-8 text-sm text-muted-foreground lg:col-span-8 lg:flex xl:col-span-9">
              Escolha uma conversa à esquerda.
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Caixa vazia que diz o motivo: QR Code não escaneado, conexão caída ou só
 * "ninguém escreveu ainda" — três situações que a tela antiga não separava.
 */
function CaixaVazia({
  titulo,
  detalhe,
  abreMonitor,
}: {
  titulo: string;
  detalhe: string;
  abreMonitor: boolean;
}) {
  return (
    <Card className="mx-auto max-w-2xl space-y-3 p-8 text-center">
      <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {detalhe && <p className="text-sm text-muted-foreground">{detalhe}</p>}
      {abreMonitor ? (
        <Button asChild variant="outline">
          <Link to="/whatsapp-monitor">Abrir o Monitor do WhatsApp</Link>
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Quem administra o WhatsApp resolve isso no Monitor do WhatsApp.
        </p>
      )}
    </Card>
  );
}
