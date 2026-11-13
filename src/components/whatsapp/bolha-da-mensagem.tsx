import { memo } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConteudoDaBolha } from "@/components/whatsapp/conteudo-da-bolha";
import { TiqueDaMensagem } from "@/components/whatsapp/tique-da-mensagem";
import type { MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { horaDaMensagem, rotuloDoTique, tiqueDaMensagem } from "@/domain/whatsapp/linha-do-tempo";
import { bolhaSemFundo } from "@/domain/whatsapp/midia";
import { cn } from "@/lib/utils";

/**
 * A bolha da mensagem: cor, lado, nome de quem mandou, hora e tique DENTRO,
 * motivo da falha, "Tentar de novo" e "Reescrever". Dono: CONVERSA (onda 1,
 * 12/11/2026). O miolo (texto e mídia) é do `ConteudoDaBolha`, da MIDIA.
 *
 * Cores: tokens --chat-* (claro e escuro, contraste conferido no bloco da
 * CONVERSA de src/styles.css). Texto da bolha em 16 px. A figurinha não tem
 * bolha: hora e tique vão numa pílula pequena embaixo dela.
 */
export type PropsDaBolha = {
  m: MensagemDaCaixa;
  /** Nome de quem mandou: só na primeira bolha da sequência e só quando não é a própria pessoa. */
  autor: string | null;
  primeiraDoGrupo: boolean;
  ultimaDoGrupo: boolean;
  podeResponder: boolean;
  /** O envio está liberado (instância conectada): "Tentar de novo" só então. */
  liberado: boolean;
  tentando: boolean;
  /** Esta é a ocorrência da busca na conversa que está marcada. */
  ocorrenciaAtual: boolean;
  realce: string | null;
  fotos: readonly MensagemDaCaixa[];
  aoMudarAltura: () => void;
  aoArquivar: () => void;
  onTentarDeNovo: (m: MensagemDaCaixa) => void;
  onReescrever: (texto: string) => void;
  /** A hora de quando a mensagem foi (já no fuso de Belém). */
  quando: string;
};

function BolhaDaMensagemSemMemo({
  m,
  autor,
  primeiraDoGrupo,
  ultimaDoGrupo,
  podeResponder,
  liberado,
  tentando,
  ocorrenciaAtual,
  realce,
  fotos,
  aoMudarAltura,
  aoArquivar,
  onTentarDeNovo,
  onReescrever,
  quando,
}: PropsDaBolha) {
  const nossa = m.direcao === "saida";
  const semFundo = bolhaSemFundo(m);
  const tique = tiqueDaMensagem(m);
  const hora = horaDaMensagem(quando);
  // Na fila e falha dizem a situação por extenso: um relógio sozinho não explica.
  const situacaoVisivel = tique === "relogio" || tique === "falha" ? rotuloDoTique(tique) : null;

  const rodape = (
    <span className="flex items-center justify-end gap-1">
      {situacaoVisivel && <span aria-hidden="true">{situacaoVisivel}</span>}
      <span>{hora}</span>
      <TiqueDaMensagem m={m} />
    </span>
  );

  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        "flex px-3",
        nossa ? "justify-end" : "justify-start",
        primeiraDoGrupo ? "mt-2.5" : "mt-0.5",
        ultimaDoGrupo && "mb-0.5",
      )}
    >
      <div
        className={cn(
          "min-w-0 max-w-[88%] @min-[600px]/conversa:max-w-[72%]",
          semFundo
            ? "flex flex-col items-end gap-1"
            : cn(
                "rounded-lg px-2 pb-1 pt-1.5 text-base leading-6 text-chat-texto shadow-sm",
                nossa ? "bg-chat-saida" : "bg-chat-entrada",
                primeiraDoGrupo && (nossa ? "rounded-tr-sm" : "rounded-tl-sm"),
                ocorrenciaAtual && "ring-2 ring-(--chat-verde-texto)",
              ),
        )}
      >
        {autor && !semFundo && (
          <div
            className={cn(
              "mb-0.5 flex items-center gap-1 text-sm font-semibold",
              nossa ? "text-chat-hora-saida" : "text-chat-hora",
            )}
          >
            {m.origem === "ia" && <Bot className="h-3.5 w-3.5" aria-hidden />}
            {autor}
          </div>
        )}

        {/* O miolo (mídia em cima, legenda embaixo) é da MIDIA; a bolha em volta é desta tela. */}
        <ConteudoDaBolha
          m={m}
          aoMudarAltura={aoMudarAltura}
          aoArquivar={aoArquivar}
          fotos={fotos}
          realce={realce}
        />

        {semFundo ? (
          <div className="rounded-full bg-chat-pilula px-2 py-0.5 text-xs leading-4 text-chat-pilula-texto">
            {rodape}
          </div>
        ) : (
          <div
            className={cn(
              "mt-0.5 text-xs leading-4",
              nossa ? "text-chat-hora-saida" : "text-chat-hora",
            )}
          >
            {rodape}
          </div>
        )}

        {nossa && m.erro && m.status !== "enviada" && (
          <div className="mt-1 break-words text-sm font-medium text-chat-falha">Motivo: {m.erro}</div>
        )}
        {nossa && podeResponder && m.status === "pendente" && (
          <Button
            type="button"
            variant="secondary"
            className="mt-1.5 h-11 text-sm"
            onClick={() => onTentarDeNovo(m)}
            // Bloqueado, o motivo já está à vista no rodapé da conversa.
            disabled={tentando || !liberado}
          >
            <RefreshCw className={cn("h-4 w-4", tentando && "animate-spin")} aria-hidden />
            Tentar de novo
          </Button>
        )}
        {nossa && podeResponder && m.status === "falha" && (
          <Button
            type="button"
            variant="secondary"
            className="mt-1.5 h-11 text-sm"
            onClick={() => onReescrever(m.texto ?? "")}
          >
            Reescrever na caixa de resposta
          </Button>
        )}
      </div>
    </div>
  );
}

/** Memorizada: a conversa tem centenas de bolhas e a tela re-renderiza a cada mensagem nova. */
export const BolhaDaMensagem = memo(BolhaDaMensagemSemMemo);
