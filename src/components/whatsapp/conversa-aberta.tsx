import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCheck,
  Loader2,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusChip } from "@/components/bex/StatusChip";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import {
  conteudoDaMensagem,
  desfechoDoEnvio,
  diaEHora,
  estaAberta,
  nomeDaConversa,
  podeResponder,
  quandoFoi,
  rotuloDoTipo,
  seloDoStatus,
  telefoneLegivel,
  type ConversaDaCaixa,
  type Desfecho,
  type Liberacao,
  type MensagemDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";
import {
  CHAVES,
  LIMITE_MENSAGENS,
  acionarEnvio,
  concluirAtendimento,
  enfileirarResposta,
  linkDaMidia,
  marcarComoLida,
  reabrirAtendimento,
  useMensagens,
  type InstanciaDaCaixa,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { RespostasRapidasMenu } from "@/components/whatsapp/respostas-rapidas-menu";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

function avisar(d: Desfecho) {
  if (d.tom === "sucesso") toast.success(d.texto);
  else if (d.tom === "erro") toast.error(d.texto);
  else toast.warning(d.texto);
}

/**
 * A conversa aberta: o histórico que o webhook gravou e a resposta.
 *
 * A resposta segue o caminho de envio que já existia: `whatsapp_responder`
 * grava a mensagem como PENDENTE e a linha de `whatsapp_fila_envio` numa
 * transação, e em seguida o POST /api/whatsapp/enviar tenta mandar. A tela só
 * diz "enviada" quando o consumidor diz que aquela linha saiu.
 */
export function ConversaAberta({
  conversa,
  instancia,
  conexaoComFalha,
  temPermissaoDeResponder,
  onVoltar,
  className,
}: {
  conversa: ConversaDaCaixa;
  instancia: InstanciaDaCaixa | null;
  /** A leitura das instâncias caiu: sem ela, "não configurado" seria mentira. */
  conexaoComFalha: boolean;
  temPermissaoDeResponder: boolean;
  onVoltar: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const mensagens = useMensagens(conversa.id);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tentando, setTentando] = useState(false);
  const [mudandoStatus, setMudandoStatus] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

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
  const aberta = estaAberta(conversa);

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) });
    void qc.invalidateQueries({ queryKey: CHAVES.conversas });
  };

  // Abrir a conversa é ler. Só quem pode responder grava (o RLS recusaria os
  // outros), e só quando há o que marcar.
  useEffect(() => {
    if (!temPermissaoDeResponder || (conversa.nao_lidas ?? 0) === 0) return;
    marcarComoLida(conversa.id)
      .then(() => qc.invalidateQueries({ queryKey: CHAVES.conversas }))
      .catch((e) => toast.error(`Não foi possível marcar como lida: ${mensagemErro(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversa.id, conversa.nao_lidas, temPermissaoDeResponder]);

  // A conversa lê de cima para baixo e abre no fim, como no celular.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens.data?.length, conversa.id]);

  async function enviar() {
    const limpo = texto.trim();
    if (!limpo || !liberacao.liberado || enviando) return;
    setEnviando(true);
    try {
      let enfileirada: { mensagem_id: string; fila_id: string };
      try {
        enfileirada = await enfileirarResposta(conversa.id, limpo);
      } catch (e) {
        // Recusada pelo banco (desconectado, sem permissão, número fixo):
        // nada foi gravado e o texto fica na caixa para não se perder.
        toast.error(mensagemErro(e));
        return;
      }
      setTexto("");
      recarregar();
      const http = await acionarEnvio();
      avisar(desfechoDoEnvio(http, enfileirada.fila_id, enfileirada.mensagem_id));
      recarregar();
    } finally {
      setEnviando(false);
    }
  }

  /** Aciona o consumidor de novo e lê no banco o que aconteceu com ESTA mensagem. */
  async function tentarDeNovo(m: MensagemDaCaixa) {
    setTentando(true);
    try {
      const http = await acionarEnvio();
      const atual = await mensagens.refetch();
      const depois = (atual.data ?? []).find((x) => x.id === m.id);
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

  async function mudarStatus(concluir: boolean) {
    setMudandoStatus(true);
    try {
      if (concluir) await concluirAtendimento(conversa.id);
      else await reabrirAtendimento(conversa.id);
      toast.success(concluir ? "Atendimento concluído" : "Atendimento reaberto");
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setMudandoStatus(false);
    }
  }

  async function abrirMidia(m: MensagemDaCaixa) {
    // A janela abre no clique (antes do await): aberta depois, o navegador
    // trataria como pop-up e bloquearia.
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

  const lista = mensagens.data ?? [];

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <div className="flex items-center gap-3 border-b p-3">
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
          <AvatarFallback>{nome.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{nome}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{telefoneLegivel(conversa.telefone)}</span>
            {conversa.cliente && (
              <Link
                to="/clientes/$id"
                params={{ id: conversa.cliente.id }}
                className="text-primary underline underline-offset-2"
              >
                ver cliente
              </Link>
            )}
          </div>
        </div>
        {!aberta && <StatusChip label="concluída" tone="muted" />}
        {temPermissaoDeResponder &&
          (aberta ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => mudarStatus(true)}
              disabled={mudandoStatus}
            >
              <CheckCheck className="mr-1 h-4 w-4" /> Concluir atendimento
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => mudarStatus(false)}
              disabled={mudandoStatus}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> Reabrir
            </Button>
          ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-muted/20 p-4">
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
        ) : lista.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma mensagem gravada nesta conversa.
          </p>
        ) : (
          <>
            {lista.length >= LIMITE_MENSAGENS && (
              <p className="text-center text-[11px] text-muted-foreground">
                Mostrando as {LIMITE_MENSAGENS} mensagens mais recentes.
              </p>
            )}
            {lista.map((m) => {
              const nossa = m.direcao === "saida";
              const selo = seloDoStatus(m);
              const temMidia = !!m.storage_path || !!m.media_url;
              return (
                <div key={m.id} className={cn("flex", nossa ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg p-2.5 text-sm",
                      nossa ? "bg-emerald-600 text-white" : "border bg-card",
                    )}
                  >
                    <div className="whitespace-pre-wrap break-words">{conteudoDaMensagem(m)}</div>
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
                        // Sem a cópia no nosso armazenamento, só o link do Z-API
                        // (vale por 30 dias) — e a tela diz isso.
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
                    <div
                      className={cn(
                        "mt-1 flex flex-wrap items-center gap-2 text-[10px]",
                        nossa ? "text-emerald-50" : "text-muted-foreground",
                      )}
                    >
                      <span>{diaEHora(quandoFoi(m))}</span>
                      {selo && (
                        <span className="font-semibold uppercase tracking-wide">{selo.texto}</span>
                      )}
                    </div>
                    {nossa && m.erro && m.status !== "enviada" && (
                      <div className="mt-1 rounded bg-black/20 px-1.5 py-1 text-[11px]">
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
                      // A linha da fila já é falha definitiva — o consumidor não
                      // pega de novo. O caminho honesto é mandar outra mensagem.
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
        <div ref={fimRef} />
      </div>

      <div className="space-y-2 border-t p-3">
        <div className="flex items-end gap-2">
          <RespostasRapidasMenu
            desabilitado={!temPermissaoDeResponder}
            onEscolher={(t) => setTexto((atual) => (atual.trim() ? `${atual.trimEnd()}\n${t}` : t))}
          />
          <Textarea
            rows={2}
            className="min-h-[44px] flex-1 resize-none"
            placeholder={
              temPermissaoDeResponder
                ? "Escreva a resposta… (Ctrl+Enter envia)"
                : "Seu perfil só lê as conversas"
            }
            value={texto}
            disabled={!temPermissaoDeResponder || enviando}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter sozinho quebra a linha: mensagem que sai pela metade para
              // um cliente real não tem volta. Ctrl/⌘+Enter envia.
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void enviar();
              }
            }}
            aria-label="Resposta"
          />
          {liberacao.liberado && (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => void enviar()}
              disabled={enviando || !texto.trim()}
            >
              {enviando ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Enviar
            </Button>
          )}
        </div>
        {!liberacao.liberado && (
          // O botão desabilitado diz o motivo no próprio rótulo — nunca um
          // "Enviar" cinza sem explicação, e nunca um "enviado" que não saiu.
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
