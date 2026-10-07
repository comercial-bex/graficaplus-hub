import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  CheckCheck,
  Clock,
  Hand,
  Loader2,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  StickyNote,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StatusChip } from "@/components/bex/StatusChip";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import {
  ANEXO_TIPOS,
  autorDoBalao,
  conteudoDaMensagem,
  desfechoDoEnvio,
  diaEHora,
  fraseDoEvento,
  iniciais,
  nomeDaConversa,
  podeResponder,
  quandoFoi,
  rotuloDoTipo,
  seloDoStatus,
  telefoneLegivel,
  validarAnexo,
  type ConversaDaCaixa,
  type Desfecho,
  type EventoDaConversa,
  type Liberacao,
  type MensagemDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";
import {
  CHAVES,
  acionarEnvio,
  enfileirarResposta,
  linkDaMidia,
  mapaDeNomes,
  subirAnexo,
  useAtendimentos,
  useConfiguracoesWhatsapp,
  useEquipe,
  useEventosDaConversa,
  useMensagensPaginadas,
  useRespostasRapidas,
  useTempoRealDaConversa,
  type InstanciaDaCaixa,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import {
  acaoNaConversa,
  enfileirarArquivo,
  marcarLidaPorMim,
  type AcaoNaConversa,
} from "@/lib/api/whatsapp-caixa.functions";
import { atendidoPermitido, infoDoSetor, type MotivoResolucao } from "@/domain/whatsapp/filas";
import {
  DialogoResolver,
  DialogoTransferir,
  FaixaDoModo,
  useAtalhosDaConversa,
} from "@/components/whatsapp/acoes-da-conversa";
import { semAssinatura } from "@/domain/whatsapp/assistente";
import { RespostasRapidasMenu } from "@/components/whatsapp/respostas-rapidas-menu";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

function avisar(d: Desfecho) {
  if (d.tom === "sucesso") toast.success(d.texto);
  else if (d.tom === "erro") toast.error(d.texto);
  else toast.warning(d.texto);
}

type ItemDaLinha =
  | { tipo: "msg"; quando: string; m: MensagemDaCaixa }
  | { tipo: "evento"; quando: string; e: EventoDaConversa };

/**
 * A conversa aberta: histórico (mensagens + eventos da equipe), responsável,
 * situação, resposta, nota interna e anexo.
 */
export function ConversaAberta({
  conversa,
  instancia,
  conexaoComFalha,
  temPermissaoDeResponder,
  onVoltar,
  painelAberto,
  onAlternarPainel,
  acoes,
  className,
}: {
  conversa: ConversaDaCaixa;
  instancia: InstanciaDaCaixa | null;
  conexaoComFalha: boolean;
  temPermissaoDeResponder: boolean;
  onVoltar: () => void;
  painelAberto: boolean;
  onAlternarPainel: () => void;
  /** O painel da conversa (cliente, etiquetas, orçamento): no celular abre numa gaveta. */
  acoes?: React.ReactNode;
  className?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const acao = useServerFn(acaoNaConversa);
  const enviarArquivo = useServerFn(enfileirarArquivo);
  const marcarLida = useServerFn(marcarLidaPorMim);
  const mensagens = useMensagensPaginadas(conversa.id);
  const eventos = useEventosDaConversa(conversa.id);
  const equipe = useEquipe();
  const respostas = useRespostasRapidas();
  const config = useConfiguracoesWhatsapp();
  const atendimentos = useAtendimentos(conversa.id);
  useTempoRealDaConversa(conversa.id);
  const [transferirAberto, setTransferirAberto] = useState(false);
  const [resolverAberto, setResolverAberto] = useState(false);

  const [modo, setModo] = useState<"mensagem" | "nota">("mensagem");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tentando, setTentando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const rolagemRef = useRef<HTMLDivElement>(null);
  const noFimRef = useRef(true);
  const alturaAntesRef = useRef<number | null>(null);
  const anexoRef = useRef<HTMLInputElement>(null);

  const nomes = useMemo(() => mapaDeNomes(equipe.data), [equipe.data]);
  const liberacao: Liberacao =
    conexaoComFalha && temPermissaoDeResponder
      ? {
          liberado: false,
          rotulo: "Não foi possível conferir a conexão do WhatsApp",
          motivo:
            "A leitura da conexão falhou (o erro está no topo da tela). Recarregue antes de responder.",
        }
      : podeResponder(instancia, temPermissaoDeResponder);
  const nome = nomeDaConversa(conversa);
  const responsavel = conversa.responsavel_id
    ? (nomes.get(conversa.responsavel_id) ?? "Equipe")
    : null;

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) });
    void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    void qc.invalidateQueries({ queryKey: ["wa-caixa-eventos", conversa.id] });
  };

  // Abrir marca como lida PARA QUEM ABRIU (cada um tem a sua leitura) — e,
  // para quem responde, zera o contador geral, como antes. De novo quando
  // chega mensagem com a conversa aberta.
  const qtdMensagens = (mensagens.data?.pages ?? []).reduce((n, p) => n + p.length, 0);
  useEffect(() => {
    marcarLida({ data: { conversaId: conversa.id } })
      .then(() => qc.invalidateQueries({ queryKey: CHAVES.naoLidas }))
      .then(() => {
        if ((conversa.nao_lidas ?? 0) > 0) void qc.invalidateQueries({ queryKey: CHAVES.conversas });
      })
      .catch((e: unknown) => toast.error(`Não foi possível marcar como lida: ${mensagemErro(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversa.id, qtdMensagens]);

  const linha: ItemDaLinha[] = useMemo(() => {
    const msgs = (mensagens.data?.pages ?? []).flat();
    const maisAntiga = msgs.length ? msgs[msgs.length - 1].created_at : null;
    const itens: ItemDaLinha[] = msgs.map((m) => ({ tipo: "msg", quando: quandoFoi(m), m }));
    for (const e of eventos.data ?? []) {
      // Eventos mais antigos que a mensagem mais antiga carregada esperam o
      // "mensagens anteriores" — senão apareceriam soltos no topo.
      if (mensagens.hasNextPage && maisAntiga && e.created_at < maisAntiga) continue;
      itens.push({ tipo: "evento", quando: e.created_at, e });
    }
    return itens.sort((a, b) => a.quando.localeCompare(b.quando));
  }, [mensagens.data, eventos.data, mensagens.hasNextPage]);

  // Rola para o fim só se a pessoa já estava no fim; ao carregar anteriores,
  // mantém a posição de leitura.
  useLayoutEffect(() => {
    const el = rolagemRef.current;
    if (!el) return;
    if (alturaAntesRef.current != null) {
      el.scrollTop = el.scrollHeight - alturaAntesRef.current;
      alturaAntesRef.current = null;
      return;
    }
    if (noFimRef.current) el.scrollTop = el.scrollHeight;
  }, [linha.length]);

  useEffect(() => {
    noFimRef.current = true;
  }, [conversa.id]);

  function aoRolar() {
    const el = rolagemRef.current;
    if (!el) return;
    noFimRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function carregarAnteriores() {
    alturaAntesRef.current = rolagemRef.current?.scrollHeight ?? null;
    void mensagens.fetchNextPage();
  }

  async function executar(dados: AcaoNaConversa, sucesso: string): Promise<boolean> {
    setOcupado(true);
    try {
      await acao({ data: dados });
      toast.success(sucesso);
      recarregar();
      void qc.invalidateQueries({ queryKey: CHAVES.atendimentos(conversa.id) });
      return true;
    } catch (e) {
      toast.error(mensagemErro(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function enviar() {
    const limpo = texto.trim();
    if (!limpo || enviando) return;
    if (modo === "nota") {
      setEnviando(true);
      try {
        await acao({ data: { acao: "nota", conversaId: conversa.id, texto: limpo } });
        setTexto("");
        noFimRef.current = true;
        recarregar();
      } catch (e) {
        toast.error(mensagemErro(e));
      } finally {
        setEnviando(false);
      }
      return;
    }
    if (!liberacao.liberado) return;
    setEnviando(true);
    try {
      let enfileirada: { mensagem_id: string; fila_id: string };
      try {
        enfileirada = await enfileirarResposta(conversa.id, limpo);
      } catch (e) {
        toast.error(mensagemErro(e));
        return;
      }
      setTexto("");
      noFimRef.current = true;
      recarregar();
      const http = await acionarEnvio();
      avisar(desfechoDoEnvio(http, enfileirada.fila_id, enfileirada.mensagem_id));
      recarregar();
    } finally {
      setEnviando(false);
    }
  }

  async function anexar(arquivo: File) {
    const erro = validarAnexo(arquivo);
    if (erro) {
      toast.error(erro);
      return;
    }
    setEnviando(true);
    try {
      const caminho = await subirAnexo(conversa.id, arquivo, arquivo.name);
      const r = await enviarArquivo({
        data: {
          conversaId: conversa.id,
          tipo: ANEXO_TIPOS[arquivo.type],
          caminho,
          nomeArquivo: arquivo.name,
          legenda: texto.trim() || undefined,
        },
      });
      setTexto("");
      noFimRef.current = true;
      recarregar();
      const http = await acionarEnvio();
      avisar(desfechoDoEnvio(http, r.fila_id, r.mensagem_id));
      recarregar();
    } catch (e) {
      toast.error(`O arquivo não foi enviado: ${mensagemErro(e)}`);
    } finally {
      setEnviando(false);
      if (anexoRef.current) anexoRef.current.value = "";
    }
  }

  async function tentarDeNovo(m: MensagemDaCaixa) {
    setTentando(true);
    try {
      const http = await acionarEnvio();
      const atual = await mensagens.refetch();
      const depois = (atual.data?.pages ?? []).flat().find((x) => x.id === m.id);
      if (
        depois?.status === "enviada" ||
        depois?.status === "entregue" ||
        depois?.status === "lida"
      ) {
        toast.success("Mensagem enviada.");
      } else if (depois?.status === "falha") {
        toast.error(`A mensagem não saiu: ${depois.erro ?? "o Z-API recusou"}.`);
      } else {
        const motivo =
          depois?.erro ??
          ("falhaDeRede" in http
            ? http.falhaDeRede
            : (http.corpo?.erro ?? "o envio vai ser tentado de novo"));
        toast.warning(`Ainda na fila: ${motivo}.`);
      }
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    } finally {
      setTentando(false);
    }
  }

  async function abrirMidia(m: MensagemDaCaixa) {
    const janela = window.open("", "_blank");
    try {
      const url = await linkDaMidia(m.storage_bucket as string, m.storage_path as string);
      if (janela) {
        janela.opener = null;
        janela.location.href = url;
      }
    } catch (e) {
      janela?.close();
      toast.error(`Não foi possível abrir o arquivo: ${mensagemErro(e)}`);
    }
  }

  // Atalho "/": digitar "/" no começo abre as respostas rápidas filtradas.
  const atalho = modo === "mensagem" && texto.startsWith("/") ? texto.slice(1).toLowerCase() : null;
  const sugestoes =
    atalho === null
      ? []
      : (respostas.data ?? [])
          .filter((r) => `${r.titulo} ${r.categoria}`.toLowerCase().includes(atalho))
          .slice(0, 6);

  const resolver = (motivo: MotivoResolucao, nota?: string) =>
    executar({ acao: "resolver", conversaId: conversa.id, motivo, nota }, "Atendimento resolvido");

  const acaoStatus = (status: "aberta" | "pendente" | "arquivada", rotulo: string) =>
    void executar({ acao: "status", conversaId: conversa.id, status }, rotulo);

  const aberta = conversa.status === "aberta" || conversa.status === "pendente";
  const atendimentoAtual = (atendimentos.data ?? []).find((a) => !a.fechado_em) ?? null;
  const podeAtendido = atendidoPermitido((mensagens.data?.pages ?? []).flat());
  const setorAtual = conversa.fila ? infoDoSetor(conversa.fila) : null;

  const assumir = () =>
    void executar({ acao: "assumir", conversaId: conversa.id }, "Você assumiu o atendimento");

  useAtalhosDaConversa(temPermissaoDeResponder, {
    assumir: conversa.responsavel_id !== meuId ? assumir : undefined,
    transferir: () => setTransferirAberto(true),
    resolver: aberta ? () => setResolverAberto(true) : undefined,
  });

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onVoltar}
            aria-label="Voltar às conversas"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar>
            <AvatarFallback>{iniciais(nome)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {/* Sem `truncate`: a 375 px o nome ficava cortado atrás dos botões.
                Quebra em até duas linhas e o cabeçalho se acomoda. */}
            <div className="line-clamp-2 break-words font-medium leading-tight">{nome}</div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>{telefoneLegivel(conversa.telefone)}</span>
              {conversa.cliente && (
                <Link
                  to="/clientes/$id"
                  params={{ id: conversa.cliente.id }}
                  className="underline underline-offset-2"
                >
                  ver cliente
                </Link>
              )}
              <span>· {responsavel ? `com ${responsavel}` : "sem responsável"}</span>
              {setorAtual && (
                <span className="inline-flex items-center gap-1" title={`Fila ${setorAtual.rotulo}`}>
                  · <span className={cn("h-1.5 w-1.5 rounded-full", setorAtual.ponto)} aria-hidden />
                  {setorAtual.rotulo}
                </span>
              )}
              {atendimentoAtual && <span className="font-mono">· {atendimentoAtual.numero}</span>}
            </div>
          </div>
          {conversa.status !== "aberta" && (
            <StatusChip
              label={conversa.status}
              tone={conversa.status === "pendente" ? "amber" : "muted"}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden xl:inline-flex"
            onClick={onAlternarPainel}
            aria-label={painelAberto ? "Recolher painel lateral" : "Abrir painel lateral"}
            title={painelAberto ? "Recolher painel" : "Abrir painel"}
          >
            {painelAberto ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
          {acoes && (
            // No celular o painel da conversa (cliente, etiquetas, orçamento,
            // histórico) não cabe embaixo do chat: abre numa gaveta.
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="lg:hidden"
                  aria-label="Ações da conversa"
                >
                  <PanelRightOpen className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Ações</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[92vw] max-w-md overflow-y-auto p-0 sm:max-w-md"
              >
                <SheetHeader className="p-4 pb-0 text-left">
                  <SheetTitle>Ações da conversa</SheetTitle>
                </SheetHeader>
                {acoes}
              </SheetContent>
            </Sheet>
          )}
        </div>
        {temPermissaoDeResponder && (
          <div className="flex flex-wrap items-center gap-1.5">
            {conversa.responsavel_id !== meuId && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={ocupado}
                onClick={assumir}
                title="Assumir (tecla R)"
                aria-keyshortcuts="R"
              >
                <Hand className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Assumir</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={ocupado}
              onClick={() => setTransferirAberto(true)}
              title="Transferir para uma pessoa ou outra fila (tecla T)"
              aria-keyshortcuts="T"
            >
              <ArrowRightLeft className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Transferir</span>
            </Button>
            <span className="ml-auto" />
            {conversa.status === "aberta" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={ocupado}
                aria-label="Marcar pendente"
                onClick={() => acaoStatus("pendente", "Marcada como pendente")}
              >
                <Clock className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Marcar pendente</span>
              </Button>
            )}
            {aberta && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={ocupado}
                onClick={() => setResolverAberto(true)}
                title="Resolver com o motivo (tecla E)"
                aria-keyshortcuts="E"
              >
                <CheckCheck className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Resolver</span>
              </Button>
            )}
            {conversa.status !== "arquivada" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={ocupado}
                aria-label="Arquivar conversa"
                onClick={() => acaoStatus("arquivada", "Conversa arquivada")}
              >
                <Archive className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Arquivar</span>
              </Button>
            )}
            {conversa.status !== "aberta" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={ocupado}
                aria-label="Reabrir conversa"
                onClick={() => acaoStatus("aberta", "Conversa reaberta")}
              >
                <RotateCcw className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Reabrir</span>
              </Button>
            )}
          </div>
        )}
      </div>

      <FaixaDoModo
        iaLigada={config.data?.ia_ativa === true}
        modo={conversa.modo}
        temResponsavel={!!conversa.responsavel_id}
        aberta={aberta}
        podeDevolver={temPermissaoDeResponder}
        ocupado={ocupado}
        onDevolver={() =>
          void executar({ acao: "devolver_ia", conversaId: conversa.id }, "Conversa devolvida à assistente")
        }
      />

      {temPermissaoDeResponder && (
        <>
          <DialogoTransferir
            aberto={transferirAberto}
            onAberto={setTransferirAberto}
            equipe={equipe.data ?? []}
            responsavelAtual={conversa.responsavel_id}
            filaAtual={conversa.fila}
            ocupado={ocupado}
            onPessoa={(para) =>
              executar({ acao: "transferir", conversaId: conversa.id, para }, "Conversa transferida")
            }
            onFila={(fila, motivo) =>
              executar(
                { acao: "transferir_fila", conversaId: conversa.id, fila, motivo },
                `Conversa passada para a fila ${infoDoSetor(fila).rotulo}`,
              )
            }
          />
          <DialogoResolver
            aberto={resolverAberto}
            onAberto={setResolverAberto}
            atendidoPermitido={podeAtendido}
            numeroDoAtendimento={atendimentoAtual?.numero ?? null}
            ocupado={ocupado}
            onResolver={resolver}
          />
        </>
      )}

      <div
        ref={rolagemRef}
        onScroll={aoRolar}
        className="min-h-0 flex-1 space-y-2.5 overflow-auto bg-muted/30 p-4"
      >
        {mensagens.isError ? (
          <FalhaDeConsulta
            titulo="Não foi possível carregar as mensagens"
            erro={mensagens.error}
            onTentarDeNovo={() => void mensagens.refetch()}
          />
        ) : mensagens.isPending ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando as mensagens…
          </div>
        ) : linha.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma mensagem gravada nesta conversa.
          </p>
        ) : (
          <>
            {mensagens.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={carregarAnteriores}
                  disabled={mensagens.isFetchingNextPage}
                >
                  {mensagens.isFetchingNextPage && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  Mensagens anteriores
                </Button>
              </div>
            )}
            {linha.map((item) => {
              if (item.tipo === "evento") {
                const e = item.e;
                if (e.tipo === "nota") {
                  return (
                    <div
                      key={e.id}
                      className="mx-auto max-w-[85%] rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm text-foreground"
                    >
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                        <Lock className="h-3 w-3" /> Nota de{" "}
                        {(e.de_usuario && nomes.get(e.de_usuario)) || "Equipe"} · visível só para a
                        equipe
                      </div>
                      <div className="whitespace-pre-wrap break-words">
                        {fraseDoEvento(e, nomes)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {diaEHora(e.created_at)}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={e.id} className="py-0.5 text-center text-[11px] text-muted-foreground">
                    {fraseDoEvento(e, nomes)} · {diaEHora(e.created_at)}
                  </div>
                );
              }
              const m = item.m;
              const nossa = m.direcao === "saida";
              const selo = seloDoStatus(m);
              const temMidia = !!m.storage_path || !!m.media_url;
              const autor = autorDoBalao(m, nomes);
              const naoSuportada = m.tipo === "sistema" && !m.texto;
              return (
                <div key={m.id} className={cn("flex", nossa ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg border p-2.5 text-sm text-foreground",
                      !nossa
                        ? "bg-card"
                        : m.origem === "ia"
                          ? "border-status-cyan/25 bg-status-cyan/5"
                          : "border-positive/25 bg-positive/10",
                    )}
                  >
                    {autor && (
                      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                        {m.origem === "ia" && <Bot className="h-3 w-3" aria-hidden />}
                        {autor}
                      </div>
                    )}
                    <div
                      className={cn(
                        "whitespace-pre-wrap break-words",
                        naoSuportada && "italic text-muted-foreground",
                      )}
                    >
                      {m.origem === "ia" ? semAssinatura(conteudoDaMensagem(m)) : conteudoDaMensagem(m)}
                    </div>
                    {temMidia &&
                      (m.storage_path && m.storage_bucket ? (
                        <button
                          type="button"
                          onClick={() => abrirMidia(m)}
                          className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2"
                        >
                          <Paperclip className="h-3 w-3" /> Abrir{" "}
                          {rotuloDoTipo(m.tipo).toLowerCase()}
                        </button>
                      ) : m.media_url ? (
                        <a
                          href={m.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2"
                        >
                          <Paperclip className="h-3 w-3" /> Abrir{" "}
                          {rotuloDoTipo(m.tipo).toLowerCase()} (link do Z-API, vale 30 dias)
                        </a>
                      ) : null)}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{diaEHora(quandoFoi(m))}</span>
                      {selo && (
                        <span className="font-semibold uppercase tracking-wide">{selo.texto}</span>
                      )}
                    </div>
                    {nossa && m.erro && m.status !== "enviada" && (
                      <div className="mt-1 rounded bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive">
                        Motivo: {m.erro}
                      </div>
                    )}
                    {nossa && temPermissaoDeResponder && m.status === "pendente" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2 h-7 text-xs"
                        onClick={() => tentarDeNovo(m)}
                        disabled={tentando || !liberacao.liberado}
                        title={liberacao.liberado ? undefined : liberacao.rotulo}
                      >
                        <RefreshCw className={cn("mr-1 h-3 w-3", tentando && "animate-spin")} />{" "}
                        Tentar de novo
                      </Button>
                    )}
                    {nossa && temPermissaoDeResponder && m.status === "falha" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2 h-7 text-xs"
                        onClick={() => setTexto(m.texto ?? "")}
                      >
                        Reescrever na caixa de resposta
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        {temPermissaoDeResponder && (
          <div className="flex gap-1 text-xs" role="tablist" aria-label="Tipo de escrita">
            <button
              type="button"
              role="tab"
              aria-selected={modo === "mensagem"}
              onClick={() => setModo("mensagem")}
              className={cn(
                "rounded px-2 py-1",
                modo === "mensagem"
                  ? "bg-muted font-semibold"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              Mensagem
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modo === "nota"}
              onClick={() => setModo("nota")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1",
                modo === "nota"
                  ? "bg-warning/15 font-semibold"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <StickyNote className="h-3 w-3" /> Nota
            </button>
            {modo === "nota" && (
              <span className="ml-2 self-center text-[11px] text-muted-foreground">
                <Lock className="mr-0.5 inline h-3 w-3" />A nota fica só na equipe — nunca vai para
                o cliente.
              </span>
            )}
          </div>
        )}
        {sugestoes.length > 0 && (
          <div className="rounded-md border bg-popover p-1 shadow-sm">
            {sugestoes.map((r) => (
              <button
                key={r.id}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => setTexto(r.texto)}
              >
                <span className="font-medium">{r.titulo}</span>{" "}
                <span className="text-muted-foreground">— {r.texto.slice(0, 70)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          {modo === "mensagem" && (
            <>
              <RespostasRapidasMenu
                desabilitado={!temPermissaoDeResponder}
                onEscolher={(t) =>
                  setTexto((atual) => (atual.trim() ? `${atual.trimEnd()}\n${t}` : t))
                }
              />
              <input
                ref={anexoRef}
                type="file"
                className="hidden"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void anexar(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={!liberacao.liberado || enviando}
                onClick={() => anexoRef.current?.click()}
                title="Anexar PDF ou imagem (até 10 MB) — o texto escrito vira legenda"
                aria-label="Anexar arquivo"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </>
          )}
          <Textarea
            rows={2}
            className={cn(
              "min-h-[44px] flex-1 resize-none",
              modo === "nota" && "border-warning/50 bg-warning/5",
            )}
            placeholder={
              !temPermissaoDeResponder
                ? "Seu perfil só lê as conversas"
                : modo === "nota"
                  ? "Nota interna para a equipe… (Ctrl+Enter grava)"
                  : "Escreva a resposta… “/” abre respostas rápidas · Ctrl+Enter envia"
            }
            value={texto}
            disabled={!temPermissaoDeResponder || enviando}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void enviar();
              }
            }}
            aria-label={modo === "nota" ? "Nota interna" : "Resposta"}
          />
          {(modo === "nota" ? temPermissaoDeResponder : liberacao.liberado) && (
            <Button
              onClick={() => void enviar()}
              disabled={enviando || !texto.trim()}
              variant={modo === "nota" ? "outline" : "default"}
            >
              {enviando ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : modo === "nota" ? (
                <StickyNote className="mr-1 h-4 w-4" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              {modo === "nota" ? "Gravar nota" : "Enviar"}
            </Button>
          )}
        </div>
        {modo === "mensagem" && !liberacao.liberado && (
          <div className="space-y-1">
            <Button disabled className="h-auto w-full whitespace-normal py-2">
              {liberacao.rotulo}
            </Button>
            <p className="text-xs text-muted-foreground">{liberacao.motivo}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
