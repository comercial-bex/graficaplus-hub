import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  marcarComoLida,
  subirAnexo,
  useEquipe,
  useEventosDaConversa,
  useMensagensPaginadas,
  useRespostasRapidas,
  useTempoRealDaConversa,
  type InstanciaDaCaixa,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { acaoNaConversa, enfileirarArquivo, type AcaoNaConversa } from "@/lib/api/whatsapp-caixa.functions";
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
  className,
}: {
  conversa: ConversaDaCaixa;
  instancia: InstanciaDaCaixa | null;
  conexaoComFalha: boolean;
  temPermissaoDeResponder: boolean;
  onVoltar: () => void;
  painelAberto: boolean;
  onAlternarPainel: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const acao = useServerFn(acaoNaConversa);
  const enviarArquivo = useServerFn(enfileirarArquivo);
  const mensagens = useMensagensPaginadas(conversa.id);
  const eventos = useEventosDaConversa(conversa.id);
  const equipe = useEquipe();
  const respostas = useRespostasRapidas();
  useTempoRealDaConversa(conversa.id);

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
          motivo: "A leitura da conexão falhou (o erro está no topo da tela). Recarregue antes de responder.",
        }
      : podeResponder(instancia, temPermissaoDeResponder);
  const nome = nomeDaConversa(conversa);
  const responsavel = conversa.responsavel_id ? (nomes.get(conversa.responsavel_id) ?? "Equipe") : null;

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) });
    void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    void qc.invalidateQueries({ queryKey: ["wa-caixa-eventos", conversa.id] });
  };

  useEffect(() => {
    if (!temPermissaoDeResponder || (conversa.nao_lidas ?? 0) === 0) return;
    marcarComoLida(conversa.id)
      .then(() => qc.invalidateQueries({ queryKey: CHAVES.conversas }))
      .catch((e) => toast.error(`Não foi possível marcar como lida: ${mensagemErro(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversa.id, conversa.nao_lidas, temPermissaoDeResponder]);

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

  async function executar(dados: AcaoNaConversa, sucesso: string) {
    setOcupado(true);
    try {
      await acao({ data: dados });
      toast.success(sucesso);
      recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
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
      if (depois?.status === "enviada" || depois?.status === "entregue" || depois?.status === "lida") {
        toast.success("Mensagem enviada.");
      } else if (depois?.status === "falha") {
        toast.error(`A mensagem não saiu: ${depois.erro ?? "o Z-API recusou"}.`);
      } else {
        const motivo =
          depois?.erro ??
          ("falhaDeRede" in http ? http.falhaDeRede : (http.corpo?.erro ?? "o envio vai ser tentado de novo"));
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

  const resolver = (motivo: "atendido" | "sem_resposta_necessaria" | "spam" | "duplicado" | "outro") => {
    let nota: string | undefined;
    if (motivo === "outro") {
      nota = window.prompt("Descreva o motivo da resolução:")?.trim() || undefined;
      if (!nota) return;
    }
    void executar({ acao: "resolver", conversaId: conversa.id, motivo, nota }, "Atendimento resolvido");
  };

  const acaoStatus = (status: "aberta" | "pendente" | "arquivada", rotulo: string) =>
    void executar({ acao: "status", conversaId: conversa.id, status }, rotulo);

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onVoltar} aria-label="Voltar às conversas">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar>
            <AvatarFallback>{iniciais(nome)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{nome}</div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>{telefoneLegivel(conversa.telefone)}</span>
              {conversa.cliente && (
                <Link to="/clientes/$id" params={{ id: conversa.cliente.id }} className="underline underline-offset-2">
                  ver cliente
                </Link>
              )}
              <span>· {responsavel ? `com ${responsavel}` : "sem responsável"}</span>
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
            {painelAberto ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
        {temPermissaoDeResponder && (
          <div className="flex flex-wrap items-center gap-1.5">
            {conversa.responsavel_id !== meuId && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={ocupado}
                onClick={() => void executar({ acao: "assumir", conversaId: conversa.id }, "Você assumiu o atendimento")}
              >
                <Hand className="mr-1 h-3.5 w-3.5" /> Assumir
              </Button>
            )}
            <Select
              value=""
              onValueChange={(para) =>
                void executar({ acao: "transferir", conversaId: conversa.id, para }, "Conversa transferida")
              }
              disabled={ocupado}
            >
              <SelectTrigger className="h-7 w-[170px] text-xs" aria-label="Transferir para">
                <SelectValue placeholder="Transferir para…" />
              </SelectTrigger>
              <SelectContent>
                {(equipe.data ?? [])
                  .filter((p) => p.id !== conversa.responsavel_id)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome ?? "Sem nome"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <span className="ml-auto" />
            {conversa.status === "aberta" && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={ocupado} onClick={() => acaoStatus("pendente", "Marcada como pendente")}>
                <Clock className="mr-1 h-3.5 w-3.5" /> Marcar pendente
              </Button>
            )}
            {(conversa.status === "aberta" || conversa.status === "pendente") && (
              <Select value="" onValueChange={(v) => resolver(v as Parameters<typeof resolver>[0])} disabled={ocupado}>
                <SelectTrigger className="h-7 w-[130px] text-xs" aria-label="Resolver">
                  <CheckCheck className="mr-1 h-3.5 w-3.5" />
                  <SelectValue placeholder="Resolver…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="atendido">Atendido</SelectItem>
                  <SelectItem value="sem_resposta_necessaria">Sem resposta necessária</SelectItem>
                  <SelectItem value="spam">Spam</SelectItem>
                  <SelectItem value="duplicado">Duplicado</SelectItem>
                  <SelectItem value="outro">Outro (com nota)</SelectItem>
                </SelectContent>
              </Select>
            )}
            {conversa.status !== "arquivada" && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={ocupado} onClick={() => acaoStatus("arquivada", "Conversa arquivada")}>
                <Archive className="mr-1 h-3.5 w-3.5" /> Arquivar
              </Button>
            )}
            {conversa.status !== "aberta" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ocupado} onClick={() => acaoStatus("aberta", "Conversa reaberta")}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reabrir
              </Button>
            )}
          </div>
        )}
      </div>

      <div ref={rolagemRef} onScroll={aoRolar} className="min-h-0 flex-1 space-y-2.5 overflow-auto bg-muted/30 p-4">
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
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem gravada nesta conversa.</p>
        ) : (
          <>
            {mensagens.hasNextPage && (
              <div className="flex justify-center">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={carregarAnteriores} disabled={mensagens.isFetchingNextPage}>
                  {mensagens.isFetchingNextPage && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Mensagens anteriores
                </Button>
              </div>
            )}
            {linha.map((item) => {
              if (item.tipo === "evento") {
                const e = item.e;
                if (e.tipo === "nota") {
                  return (
                    <div key={e.id} className="mx-auto max-w-[85%] rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm text-foreground">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                        <Lock className="h-3 w-3" /> Nota de {(e.de_usuario && nomes.get(e.de_usuario)) || "Equipe"} · visível só para a equipe
                      </div>
                      <div className="whitespace-pre-wrap break-words">{fraseDoEvento(e, nomes)}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{diaEHora(e.created_at)}</div>
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
                      nossa ? "border-positive/25 bg-positive/10" : "bg-card",
                    )}
                  >
                    {autor && <div className="mb-0.5 text-[10px] font-semibold text-muted-foreground">{autor}</div>}
                    <div className={cn("whitespace-pre-wrap break-words", naoSuportada && "italic text-muted-foreground")}>
                      {conteudoDaMensagem(m)}
                    </div>
                    {temMidia &&
                      (m.storage_path && m.storage_bucket ? (
                        <button type="button" onClick={() => abrirMidia(m)} className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2">
                          <Paperclip className="h-3 w-3" /> Abrir {rotuloDoTipo(m.tipo).toLowerCase()}
                        </button>
                      ) : m.media_url ? (
                        <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2">
                          <Paperclip className="h-3 w-3" /> Abrir {rotuloDoTipo(m.tipo).toLowerCase()} (link do Z-API, vale 30 dias)
                        </a>
                      ) : null)}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{diaEHora(quandoFoi(m))}</span>
                      {selo && <span className="font-semibold uppercase tracking-wide">{selo.texto}</span>}
                    </div>
                    {nossa && m.erro && m.status !== "enviada" && (
                      <div className="mt-1 rounded bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive">Motivo: {m.erro}</div>
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
                        <RefreshCw className={cn("mr-1 h-3 w-3", tentando && "animate-spin")} /> Tentar de novo
                      </Button>
                    )}
                    {nossa && temPermissaoDeResponder && m.status === "falha" && (
                      <Button size="sm" variant="secondary" className="mt-2 h-7 text-xs" onClick={() => setTexto(m.texto ?? "")}>
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
              className={cn("rounded px-2 py-1", modo === "mensagem" ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/60")}
            >
              Mensagem
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modo === "nota"}
              onClick={() => setModo("nota")}
              className={cn("inline-flex items-center gap-1 rounded px-2 py-1", modo === "nota" ? "bg-warning/15 font-semibold" : "text-muted-foreground hover:bg-muted/60")}
            >
              <StickyNote className="h-3 w-3" /> Nota
            </button>
            {modo === "nota" && (
              <span className="ml-2 self-center text-[11px] text-muted-foreground">
                <Lock className="mr-0.5 inline h-3 w-3" />A nota fica só na equipe — nunca vai para o cliente.
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
                onEscolher={(t) => setTexto((atual) => (atual.trim() ? `${atual.trimEnd()}\n${t}` : t))}
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
            className={cn("min-h-[44px] flex-1 resize-none", modo === "nota" && "border-warning/50 bg-warning/5")}
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
            <Button onClick={() => void enviar()} disabled={enviando || !texto.trim()} variant={modo === "nota" ? "outline" : "default"}>
              {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : modo === "nota" ? <StickyNote className="mr-1 h-4 w-4" /> : <Send className="mr-1 h-4 w-4" />}
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
