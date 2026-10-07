import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, ListChecks, Loader2, MessageCircle, QrCode } from "lucide-react";
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
  instanciaPrincipal,
  vazioDaCaixa,
  type AbaStatus,
  type Fila,
} from "@/domain/whatsapp/caixa-de-entrada";
import {
  useContadores,
  useContagemPorFila,
  useConversa,
  useConversasPaginadas,
  useEquipe,
  useInstancias,
  useMinhasFilas,
  useNaoLidasPorMim,
  useTempoRealDaCaixa,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { filtroDaUrl, setoresDoFiltro, type FiltroDeSetor } from "@/domain/whatsapp/filas";
import { ListaDeConversas } from "@/components/whatsapp/lista-de-conversas";
import { ConversaAberta } from "@/components/whatsapp/conversa-aberta";
import { PainelDaConversa } from "@/components/whatsapp/painel-da-conversa";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Busca = { fila?: string; conversa?: string };

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — BEX PRINT OS" }] }),
  // `?fila=producao` abre na fila do setor; `?conversa=<id>` já com a conversa
  // aberta (é o "Abrir" da fila humana). As duas são opcionais.
  validateSearch: (busca: Record<string, unknown>): Busca => ({
    fila: typeof busca.fila === "string" ? busca.fila : undefined,
    conversa: typeof busca.conversa === "string" && UUID.test(busca.conversa) ? busca.conversa : undefined,
  }),
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
  const { hasPermission, user } = useAuth();
  const temPermissaoDeResponder = hasPermission("whatsapp.reply");
  const abre = (rota: string) => (getRoutePermissions(rota) ?? []).some(hasPermission);
  const meuId = user?.id ?? null;

  useTempoRealDaCaixa();
  const daUrl = Route.useSearch();
  const instancias = useInstancias();
  const equipe = useEquipe();
  const minhasFilas = useMinhasFilas();
  const contagemPorFila = useContagemPorFila();
  const naoLidasPorMim = useNaoLidasPorMim();
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [fila, setFila] = useState<Fila>("todas");
  const [setor, setSetor] = useState<FiltroDeSetor>(() => filtroDaUrl(daUrl.fila));
  const [status, setStatus] = useState<AbaStatus>("aberta");
  const [selecionadaId, setSelecionadaId] = useState<string | null>(daUrl.conversa ?? null);
  const [painelAberto, setPainelAberto] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  // O link do menu ou da fila humana pode trocar a URL com a tela aberta.
  useEffect(() => {
    if (daUrl.fila) setSetor(filtroDaUrl(daUrl.fila));
    if (daUrl.conversa) setSelecionadaId(daUrl.conversa);
  }, [daUrl.fila, daUrl.conversa]);

  // "Minhas filas" espera as filas da pessoa chegarem; se a leitura falhar,
  // mostra todas (esconder tudo pareceria caixa vazia).
  const setores = setoresDoFiltro(setor, minhasFilas.isError ? null : minhasFilas.data);
  const conversas = useConversasPaginadas({ fila, status, busca: buscaAtiva, userId: meuId, setores });
  const contadores = useContadores(status, meuId, setores);
  const lista = (conversas.data?.pages ?? []).flat();
  const daLista = lista.find((c) => c.id === selecionadaId) ?? null;
  const umaSo = useConversa(selecionadaId);
  const selecionada = umaSo.data ?? daLista;

  const listaInstancias = instancias.data ?? [];
  const principal = instanciaPrincipal(listaInstancias);
  const situacao = situacaoDaConexao(principal);
  const instanciaDaConversa = selecionada
    ? (listaInstancias.find((i) => i.id === selecionada.instancia_id) ?? null)
    : null;
  // "Caixa vazia" só sem filtro de setor: fila vazia não é "ninguém escreveu"
  // (a lista diz isso no lugar dela).
  const nenhumaNunca =
    !setores &&
    !conversas.isPending &&
    (contadores.data?.aberta ?? 0) +
      (contadores.data?.pendente ?? 0) +
      (contadores.data?.resolvida ?? 0) ===
      0 &&
    !buscaAtiva;

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/whatsapp")}
        breadcrumb="Atendimento · Caixa de entrada"
        title="WhatsApp"
        description="As conversas que chegam no número da empresa. Assuma, responda, anote e transforme o pedido em orçamento."
        className="mb-2"
        actions={
          <>
            {!instancias.isPending && !instancias.isError && (
              <StatusChip label={situacao.rotulo} tone={situacao.tom} />
            )}
            {/* No celular os botões ficam só com o ícone (o rótulo vai no
                aria-label); a partir de sm o texto volta. */}
            {abre("/whatsapp-monitor") && principal && principal.conectado !== true && (
              <Button asChild size="sm">
                <Link to="/whatsapp-monitor" aria-label="Conectar o WhatsApp">
                  <QrCode className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Conectar</span>
                </Link>
              </Button>
            )}
            {abre("/respostas-rapidas") && (
              <Button asChild variant="outline" size="sm">
                <Link to="/respostas-rapidas" aria-label="Respostas rápidas">
                  <ListChecks className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Respostas rápidas</span>
                </Link>
              </Button>
            )}
            {abre("/whatsapp-monitor") && (
              <Button asChild variant="outline" size="sm">
                <Link to="/whatsapp-monitor" aria-label="Monitor do WhatsApp">
                  <Activity className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Monitor</span>
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
      ) : instancias.isPending ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando as conversas…
        </div>
      ) : nenhumaNunca ? (
        <CaixaVazia
          titulo={vazioDaCaixa(principal).titulo}
          detalhe={vazioDaCaixa(principal).detalhe}
          abreMonitor={abre("/whatsapp-monitor")}
        />
      ) : (
        <div
          className={cn(
            "grid gap-3 lg:h-[calc(100vh-13rem)] lg:grid-cols-[320px_minmax(0,1fr)]",
            selecionada && painelAberto && "xl:grid-cols-[320px_minmax(0,1fr)_300px]",
          )}
        >
          {/* No celular a conversa ocupa a tela toda (dvh: a barra do navegador
              não come o rodapé de resposta); o painel da conversa vira uma
              gaveta aberta pelo botão "Ações" do cabeçalho. */}
          <ListaDeConversas
            className={cn(
              "h-[calc(100dvh-8rem)] lg:h-auto lg:min-h-0",
              selecionada && "hidden lg:flex",
            )}
            conversas={lista}
            carregando={conversas.isPending}
            temMais={!!conversas.hasNextPage}
            carregandoMais={conversas.isFetchingNextPage}
            onCarregarMais={() => void conversas.fetchNextPage()}
            contadores={contadores.data}
            equipe={equipe.data ?? []}
            selecionadaId={selecionadaId}
            onSelecionar={setSelecionadaId}
            busca={busca}
            onBusca={setBusca}
            fila={fila}
            onFila={setFila}
            status={status}
            onStatus={setStatus}
            setor={setor}
            onSetor={setSetor}
            contagemPorFila={contagemPorFila.data}
            naoLidasPorMim={naoLidasPorMim.data}
          />
          {selecionada ? (
            <>
              <ConversaAberta
                key={selecionada.id}
                className="h-[calc(100dvh-8rem)] lg:h-auto lg:min-h-0"
                conversa={selecionada}
                instancia={instanciaDaConversa}
                conexaoComFalha={instancias.isError}
                temPermissaoDeResponder={temPermissaoDeResponder}
                onVoltar={() => setSelecionadaId(null)}
                painelAberto={painelAberto}
                onAlternarPainel={() => setPainelAberto((v) => !v)}
                acoes={<PainelDaConversa conversa={selecionada} className="border-0 shadow-none" />}
              />
              {painelAberto && (
                <PainelDaConversa
                  className="hidden lg:flex lg:col-span-2 xl:col-span-1 xl:h-auto xl:min-h-0"
                  conversa={selecionada}
                />
              )}
            </>
          ) : (
            <Card className="hidden items-center justify-center p-8 text-sm text-muted-foreground lg:flex">
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
