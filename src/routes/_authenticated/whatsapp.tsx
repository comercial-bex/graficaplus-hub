import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { getRoutePermissions } from "@/lib/permissions";
import { definirAbasEscondidas } from "@/lib/tela-cheia";
import { cn } from "@/lib/utils";
import { situacaoDaConexao } from "@/domain/whatsapp/situacao-conexao";
import { instanciaPrincipal, vazioDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { TITULO_DA_CAIXA, CHAVE_DOS_DADOS_DO_CONTATO } from "@/domain/whatsapp/moldura";
import {
  contarNaoLidas,
  filtroDoChip,
  idsNaoLidos,
  type ChipDaLista,
} from "@/domain/whatsapp/filtros-da-lista";
import { escFechaAConversa } from "@/domain/whatsapp/teclado";
import type { DialogoDaConversa } from "@/domain/whatsapp/acoes-de-trabalho";
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
  useUltimaMensagemDasConversas,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { filtroDaUrl, setoresDoFiltro, type FiltroDeSetor } from "@/domain/whatsapp/filas";
import { ListaDeConversas } from "@/components/whatsapp/lista-de-conversas";
import { ConversaAberta } from "@/components/whatsapp/conversa-aberta";
import { GavetaDoContato } from "@/components/whatsapp/gaveta-do-contato";
import { DialogosDaConversa } from "@/components/whatsapp/dialogos-da-conversa";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { NovaConversa } from "@/components/whatsapp/nova-conversa";
import { useModoDaCaixa } from "@/components/whatsapp/usar-modo-da-caixa";
import { useTituloDaAba } from "@/components/whatsapp/usar-titulo-da-aba";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Busca = { fila?: string; conversa?: string };

export const Route = createFileRoute("/_authenticated/whatsapp")({
  // Ponto médio e não travessão (decisão 12 do dono, 12/11/2026).
  head: () => ({ meta: [{ title: TITULO_DA_CAIXA }] }),
  // `?fila=producao` abre na fila do setor; `?conversa=<id>` já com a conversa
  // aberta (é o "Abrir" da fila humana). As duas são opcionais.
  validateSearch: (busca: Record<string, unknown>): Busca => ({
    fila: typeof busca.fila === "string" ? busca.fila : undefined,
    conversa: typeof busca.conversa === "string" && UUID.test(busca.conversa) ? busca.conversa : undefined,
  }),
  component: CaixaDeEntradaPage,
});

/** Os dados do contato encaixados (modo largo) lembram se estavam abertos; sem armazenamento, fechados. */
function lerDadosLembrados(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHAVE_DOS_DADOS_DO_CONTATO) === "1";
  } catch {
    return false;
  }
}

function lembrarDados(aberto: boolean): void {
  try {
    globalThis.localStorage?.setItem(CHAVE_DOS_DADOS_DO_CONTATO, aberto ? "1" : "0");
  } catch {
    // Armazenamento bloqueado: a escolha vale só até recarregar.
  }
}

/**
 * Caixa de entrada do WhatsApp.
 *
 * Até 02/10/2026 esta rota era uma demonstração: conversas e mensagens fixas
 * no código, sem nenhuma leitura do banco, e sete botões sem ação, enquanto
 * estava no menu como se fosse o atendimento de verdade. Agora ela lê as
 * tabelas que o webhook do Z-API escreve (`whatsapp_conversas` e
 * `whatsapp_mensagens`, por `whatsapp_registrar_mensagem`), responde pela fila
 * que já existia (`whatsapp_responder` + POST /api/whatsapp/enviar) e grava no
 * banco tudo o que a tela antiga só fingia: concluir, etiquetar, ligar ao
 * cliente, abrir orçamento e OS.
 *
 * A MOLDURA (onda 1, 12/11/2026, pedido do dono: "no jeito da tela do
 * WhatsApp"): a tela ocupa a janela inteira abaixo do topo do sistema e a
 * página NÃO rola; quem rola é a lista, as mensagens e a coluna dos dados. A
 * altura vem da cadeia (route.tsx dá `h-dvh` à casca nesta tela), sem
 * `calc(100vh-...)`. Os três modos vêm da LARGURA ÚTIL da área, não da janela
 * (`@container/caixa`): com o menu lateral aberto, a janela de 1280 px deixava a
 * conversa com 244 px; agora ela nunca fica com menos de 520 px.
 *
 *   estreito (menos de 840 px): uma peça por vez, lista OU conversa;
 *   médio (840 a 1279 px): lista de 320 px e conversa; dados por cima, à direita;
 *   largo (1280 px ou mais): lista de 360 px, conversa e dados encaixados (360 px).
 *
 * Os números 840 e 1280 moram em `LIMITES_DA_CAIXA` (moldura.ts) e nas classes
 * `@min-[840px]/caixa:` e `@min-[1280px]/caixa:` abaixo; tests/whatsapp-moldura
 * confere que batem. O CSS escolhe as colunas (sem piscar); o JS sabe o modo
 * só para o que o CSS não decide (Sheet ou coluna, botão Voltar).
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
  const raizRef = useRef<HTMLDivElement>(null);
  const modo = useModoDaCaixa(raizRef);

  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [chip, setChip] = useState<ChipDaLista>("abertas");
  const filtro = filtroDoChip(chip);
  const [setor, setSetor] = useState<FiltroDeSetor>(() => filtroDaUrl(daUrl.fila));
  const [selecionadaId, setSelecionadaId] = useState<string | null>(daUrl.conversa ?? null);
  // Dados do contato: começam FECHADOS. No modo largo a escolha fica lembrada
  // (localStorage); nos outros a gaveta por cima vale só para a conversa aberta.
  const [dadosLargo, setDadosLargo] = useState<boolean>(() =>
    typeof window === "undefined" ? false : lerDadosLembrados(),
  );
  const [dadosPorCima, setDadosPorCima] = useState(false);
  const [dialogo, setDialogo] = useState<DialogoDaConversa | null>(null);
  // Nova conversa pelo número (21/10/2026): o botão Nova conversa e o "Chamar"
  // da busca vazia (a tecla N saiu em 12/11/2026). A conversa aberta por ela já
  // vem com o cursor na resposta.
  const [novaAberta, setNovaAberta] = useState(false);
  const [numeroDaNova, setNumeroDaNova] = useState<string | undefined>(undefined);
  const [focarRespostaEm, setFocarRespostaEm] = useState<string | null>(null);
  const abrirNova = (numero?: string) => {
    setNumeroDaNova(numero);
    setNovaAberta(true);
  };

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

  // Chip "Não lidas": as conversas com mensagem não lida por quem olha. Os ids
  // se ACUMULAM enquanto o chip está ativo: a conversa que acabou de ser aberta
  // (e lida) continua na lista até a pessoa trocar de chip, como no WhatsApp,
  // em vez de sumir debaixo do dedo.
  const acumuladas = useRef<Set<string>>(new Set());
  const naoLidasIds = useMemo(() => {
    if (!filtro.naoLidas) {
      acumuladas.current = new Set();
      return undefined;
    }
    for (const id of idsNaoLidos(naoLidasPorMim.data)) acumuladas.current.add(id);
    return [...acumuladas.current];
  }, [filtro.naoLidas, naoLidasPorMim.data]);

  // Em "Minhas filas" a lista espera as filas chegarem: antes disparava com
  // setor nulo e de novo com o certo (19 consultas na abertura, 13/10/2026).
  // No chip "Não lidas" espera também as não lidas: sem elas a lista pediria
  // "nenhuma" e piscaria vazia.
  const filasProntas = setor !== "minhas_filas" || minhasFilas.isSuccess || minhasFilas.isError;
  const naoLidasProntas = !filtro.naoLidas || !naoLidasPorMim.isPending;
  const conversas = useConversasPaginadas({
    fila: filtro.fila,
    status: filtro.status,
    busca: buscaAtiva,
    userId: meuId,
    setores,
    pronto: filasProntas && naoLidasProntas,
    naoLidasIds,
  });
  const contadores = useContadores(filtro.status, meuId, setores, filasProntas);
  const lista = (conversas.data?.pages ?? []).flat();
  const ultimasMensagens = useUltimaMensagemDasConversas(lista.map((c) => c.id));
  const daLista = lista.find((c) => c.id === selecionadaId) ?? null;
  const umaSo = useConversa(selecionadaId);
  const selecionada = umaSo.data ?? daLista;
  const haConversa = !!selecionada;

  // Conversas com mensagem não lida no título da aba: "(3) WhatsApp · BEX PRINT OS".
  useTituloDaAba(contarNaoLidas(naoLidasPorMim.data));

  // No celular, com a conversa aberta, a barra de abas some e a conversa ocupa
  // tudo abaixo do topo; ao fechar (ou sair da tela), volta.
  useEffect(() => {
    definirAbasEscondidas(modo === "estreito" && haConversa);
    return () => definirAbasEscondidas(false);
  }, [modo, haConversa]);

  // Trocou de conversa: a gaveta por cima e o diálogo aberto eram da anterior.
  useEffect(() => {
    setDadosPorCima(false);
    setDialogo(null);
  }, [selecionadaId]);

  const dadosAbertos = modo === "largo" ? dadosLargo : dadosPorCima;
  const alterarDados = useCallback(
    (aberto: boolean) => {
      if (modo === "largo") {
        setDadosLargo(aberto);
        lembrarDados(aberto);
      } else {
        setDadosPorCima(aberto);
      }
    },
    [modo],
  );

  // Fechar a conversa (Voltar do modo estreito e Esc): o foco volta à linha dela.
  const focoDaLinhaRef = useRef<string | null>(null);
  const fecharConversa = useCallback(() => {
    focoDaLinhaRef.current = selecionadaId;
    setFocarRespostaEm(null);
    setSelecionadaId(null);
  }, [selecionadaId]);
  useEffect(() => {
    if (selecionadaId || !focoDaLinhaRef.current) return;
    const id = focoDaLinhaRef.current;
    focoDaLinhaRef.current = null;
    raizRef.current?.querySelector<HTMLElement>(`[data-conversa-id="${id}"]`)?.focus();
  }, [selecionadaId]);

  // Esc fecha a camada de cima; sem nada por cima, fecha a conversa. Quem consome
  // o Esc antes chama preventDefault (o Radix ao fechar menu, gaveta e diálogo;
  // a lista do "/" e a busca). A coluna ENCAIXADA de dados do modo largo não é
  // camada: o primeiro Esc a fecha e o segundo fecha a conversa.
  useEffect(() => {
    if (!selecionadaId) return;
    function aoTeclar(e: KeyboardEvent) {
      if (!escFechaAConversa(e, document)) return;
      e.preventDefault();
      if (modo === "largo" && dadosLargo) {
        setDadosLargo(false);
        lembrarDados(false);
        return;
      }
      fecharConversa();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [selecionadaId, modo, dadosLargo, fecharConversa]);

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

  const colunasDoLargo =
    haConversa && dadosLargo
      ? "@min-[1280px]/caixa:grid-cols-[360px_minmax(0,1fr)_360px]"
      : "@min-[1280px]/caixa:grid-cols-[360px_minmax(0,1fr)]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {instancias.isError && (
        <div className="shrink-0 p-3">
          <FalhaDeConsulta
            titulo="Não foi possível conferir a conexão do WhatsApp"
            erro={instancias.error}
            onTentarDeNovo={() => void instancias.refetch()}
          />
        </div>
      )}

      {/* O contêiner da caixa fica montado em todos os estados: o modo é medido
          nele, e a largura útil é a dele (a janela menos o menu lateral). Nada
          `fixed` aqui dentro: contêiner de consulta prende o `fixed` filho. */}
      <div ref={raizRef} className="@container/caixa flex min-h-0 min-w-0 flex-1 flex-col">
        {conversas.isError ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <FalhaDeConsulta
              titulo="Não foi possível carregar as conversas"
              erro={conversas.error}
              onTentarDeNovo={() => void conversas.refetch()}
            />
          </div>
        ) : instancias.isPending ? (
          <div className="flex items-center gap-2 p-6 text-base text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden /> Carregando as conversas…
          </div>
        ) : nenhumaNunca ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <CaixaVazia
              titulo={vazioDaCaixa(principal).titulo}
              detalhe={vazioDaCaixa(principal).detalhe}
              abreMonitor={abre("/whatsapp-monitor")}
            />
          </div>
        ) : (
          <div
            className={cn(
              // Uma linha explícita: a causa do defeito de 11/11/2026 era a
              // segunda linha implícita dividindo a altura ao meio.
              "grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)]",
              "@min-[840px]/caixa:grid-cols-[320px_minmax(0,1fr)]",
              colunasDoLargo,
            )}
          >
            <ListaDeConversas
              className={cn("h-full", haConversa ? "hidden @min-[840px]/caixa:flex" : "flex")}
              conversas={lista}
              carregando={conversas.isPending}
              temMais={!!conversas.hasNextPage}
              carregandoMais={conversas.isFetchingNextPage}
              onCarregarMais={() => void conversas.fetchNextPage()}
              contadores={contadores.data}
              equipe={equipe.data ?? []}
              selecionadaId={selecionadaId}
              onSelecionar={(id) => {
                setFocarRespostaEm(null);
                setSelecionadaId(id);
              }}
              busca={busca}
              onBusca={setBusca}
              chip={chip}
              onChip={setChip}
              setor={setor}
              onSetor={setSetor}
              contagemPorFila={contagemPorFila.data}
              naoLidasPorMim={naoLidasPorMim.data}
              ultimasMensagens={ultimasMensagens.data}
              onNovaConversa={temPermissaoDeResponder ? abrirNova : undefined}
              conexao={instancias.isPending || instancias.isError ? null : situacao}
              podeConectar={abre("/whatsapp-monitor") && !!principal && principal.conectado !== true}
              podeAbrirRespostasRapidas={abre("/respostas-rapidas")}
              podeAbrirMonitor={abre("/whatsapp-monitor")}
            />
            {selecionada ? (
              <>
                <ConversaAberta
                  key={selecionada.id}
                  className="h-full min-h-0"
                  conversa={selecionada}
                  instancia={instanciaDaConversa}
                  conexaoComFalha={instancias.isError}
                  temPermissaoDeResponder={temPermissaoDeResponder}
                  onVoltar={fecharConversa}
                  focarResposta={focarRespostaEm === selecionada.id}
                  modo={modo}
                  dadosAbertos={dadosAbertos}
                  onAlternarDados={() => alterarDados(!dadosAbertos)}
                  onAbrirDialogo={setDialogo}
                />
                {/* Largo: coluna encaixada de 360 px; médio e estreito: por
                    cima (Sheet). Nunca vira segunda linha da grade. */}
                <GavetaDoContato
                  conversa={selecionada}
                  modo={modo}
                  aberta={dadosAbertos}
                  onAberta={alterarDados}
                  onAbrirDialogo={setDialogo}
                  className="h-full min-h-0"
                />
              </>
            ) : (
              <div className="hidden items-center justify-center bg-chat-fundo p-8 text-base text-muted-foreground @min-[840px]/caixa:flex">
                Escolha uma conversa à esquerda.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Os diálogos de trabalho (orçamento, OS, vincular cliente) ficam montados
          com a conversa: a lista de rascunhos chega antes do primeiro clique. */}
      {selecionada && (
        <DialogosDaConversa
          key={selecionada.id}
          conversa={selecionada}
          qual={dialogo}
          onQual={setDialogo}
        />
      )}

      {temPermissaoDeResponder && (
        <NovaConversa
          aberto={novaAberta}
          onAberto={setNovaAberta}
          numeroInicial={numeroDaNova}
          onAberta={setSelecionadaId}
          onFechouNaConversa={setFocarRespostaEm}
        />
      )}
    </div>
  );
}

/**
 * Caixa vazia que diz o motivo: QR Code não escaneado, conexão caída ou só
 * "ninguém escreveu ainda", três situações que a tela antiga não separava.
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
      <MessageCircle className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {detalhe && <p className="text-base text-muted-foreground">{detalhe}</p>}
      {abreMonitor ? (
        <Button asChild variant="outline" className="h-11 text-base">
          <Link to="/whatsapp-monitor">Abrir o Monitor do WhatsApp</Link>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Quem administra o WhatsApp resolve isso no Monitor do WhatsApp.
        </p>
      )}
    </Card>
  );
}
