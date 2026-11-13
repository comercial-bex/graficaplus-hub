import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Dica } from "@/components/bex/Dica";
import { DICAS_WA_MIDIA } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import {
  aparelhoNaoTocaOgg,
  aplicarVelocidade,
  formatarDuracao,
  fracaoDoClique,
  fracaoTocada,
  proximaVelocidade,
  registroDeAudio,
  rotuloDaVelocidade,
} from "@/domain/whatsapp/voz";

/**
 * O tocador de voz da bolha (onda 1, 12/11/2026). Substitui o `<audio
 * controls>` do navegador, que muda de cara em cada aparelho e tem alvos
 * pequenos: aqui o botão de tocar tem 44 px, a barra é clicável (e anda com as
 * setas), mostra o tempo e tem a velocidade 1x, 1,5x e 2x num botão de 44 px.
 *
 * - A velocidade mantém o tom da voz (`preservesPitch`).
 * - Um áudio por vez: ao tocar este, o que tocava pausa (`registroDeAudio`).
 * - Voz do WhatsApp é Ogg Opus, que o Safari antigo não toca: o aviso e o
 *   Baixar ficam por conta de quem desenha a bolha (`aoFalhar`).
 * - `segundos` (a duração que o Z-API manda) ainda não é gravada; quando for,
 *   a duração aparece antes de o arquivo carregar.
 */

const PASSO_DAS_SETAS_S = 5;

export function TocadorDeVoz({
  origem,
  nome,
  segundos,
  aoMudarAltura,
  aoFalhar,
}: {
  origem: string;
  nome: string;
  /** A duração que o Z-API informou, se houver. */
  segundos?: number;
  aoMudarAltura?: () => void;
  /** O arquivo não carrega ou o aparelho não toca o formato. `formato` é o segundo caso. */
  aoFalhar: (formato: boolean) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(segundos && segundos > 0 ? segundos : 0);
  const [velocidade, setVelocidade] = useState(1);

  // O aparelho que não toca Ogg avisa logo, sem esperar o toque.
  useEffect(() => {
    const el = audio.current;
    if (el && aparelhoNaoTocaOgg(nome, (mime) => el.canPlayType(mime))) aoFalhar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nome]);

  // Saiu da tela: para e solta a vez.
  useEffect(() => {
    const el = audio.current;
    return () => {
      if (el) {
        el.pause();
        registroDeAudio.soltar(el);
      }
    };
  }, []);

  const lerDuracao = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuracao(el.duration);
      aoMudarAltura?.();
      return;
    }
    // Chrome devolve duração infinita para Ogg sem cabeçalho de tamanho: ir
    // ao fim e voltar faz o navegador medir o arquivo.
    if (el.duration === Infinity) {
      const medir = () => {
        el.removeEventListener("timeupdate", medir);
        el.currentTime = 0;
        if (Number.isFinite(el.duration)) setDuracao(el.duration);
      };
      el.addEventListener("timeupdate", medir);
      el.currentTime = 1e101;
    }
  }, [aoMudarAltura]);

  async function alternar() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    registroDeAudio.tocar(el);
    aplicarVelocidade(el, velocidade);
    try {
      await el.play();
    } catch {
      // O navegador recusou (formato ou permissão): vira o aviso com Baixar.
      registroDeAudio.soltar(el);
      aoFalhar(false);
    }
  }

  function trocarVelocidade() {
    const proxima = proximaVelocidade(velocidade);
    setVelocidade(proxima);
    if (audio.current) aplicarVelocidade(audio.current, proxima);
  }

  function irPara(fracao: number) {
    const el = audio.current;
    if (!el || !(duracao > 0)) return;
    el.currentTime = fracao * duracao;
    setAtual(el.currentTime);
  }

  function aoClicarNaBarra(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    irPara(fracaoDoClique(e.clientX, r.left, r.width));
  }

  function aoTeclarNaBarra(e: KeyboardEvent<HTMLDivElement>) {
    const el = audio.current;
    if (!el || !(duracao > 0)) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      irPara(Math.min(1, (el.currentTime + PASSO_DAS_SETAS_S) / duracao));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      irPara(Math.max(0, (el.currentTime - PASSO_DAS_SETAS_S) / duracao));
    }
  }

  const fracao = fracaoTocada(atual, duracao);
  const tempo = tocando || atual > 0 ? formatarDuracao(atual) : formatarDuracao(duracao);

  return (
    <div
      data-voz
      className="flex w-72 max-w-full items-center gap-2 rounded-xl border border-(--midia-borda) bg-(--midia-cartao) p-1.5 text-(--midia-cartao-texto)"
    >
      <audio
        ref={audio}
        src={origem}
        preload="metadata"
        onLoadedMetadata={lerDuracao}
        onDurationChange={() => {
          const el = audio.current;
          if (el && Number.isFinite(el.duration) && el.duration > 0) setDuracao(el.duration);
        }}
        onTimeUpdate={() => audio.current && setAtual(audio.current.currentTime)}
        onWaiting={() => setCarregando(true)}
        onCanPlay={() => setCarregando(false)}
        onPlay={() => setTocando(true)}
        onPause={() => {
          setTocando(false);
          if (audio.current) registroDeAudio.soltar(audio.current);
        }}
        onEnded={() => {
          setTocando(false);
          setAtual(0);
          if (audio.current) registroDeAudio.soltar(audio.current);
        }}
        onError={() => aoFalhar(false)}
      />
      <button
        type="button"
        onClick={alternar}
        aria-label={tocando ? "Pausar a mensagem de voz" : "Tocar a mensagem de voz"}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--midia-botao) text-(--midia-botao-texto) hover:bg-(--midia-botao-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {carregando && tocando ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : tocando ? (
          <Pause className="size-5" aria-hidden />
        ) : (
          <Play className="size-5" aria-hidden />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {/* A área de toque da barra tem 44 px de altura; o traço visível é fino. */}
        <Dica texto={DICAS_WA_MIDIA.posicao} className="flex w-full">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Posição da mensagem de voz"
            aria-valuemin={0}
            aria-valuemax={Math.round(duracao)}
            aria-valuenow={Math.round(atual)}
            aria-valuetext={`${formatarDuracao(atual)} de ${formatarDuracao(duracao)}`}
            onClick={aoClicarNaBarra}
            onKeyDown={aoTeclarNaBarra}
            className="relative flex h-11 cursor-pointer items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative h-1.5 w-full rounded-full bg-(--midia-trilho)">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-(--midia-ponteiro)"
                style={{ width: `${fracao * 100}%` }}
              />
              <div
                className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--midia-ponteiro)"
                style={{ left: `${fracao * 100}%` }}
              />
            </div>
          </div>
        </Dica>
        <p className="-mt-2 pb-1 text-xs text-(--midia-cartao-apoio)">{tempo}</p>
      </div>

      <Dica texto={DICAS_WA_MIDIA.velocidade}>
        <button
          type="button"
          onClick={trocarVelocidade}
          aria-label={`Velocidade ${rotuloDaVelocidade(velocidade)}. Toque para mudar.`}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full border border-(--midia-borda) text-sm font-semibold",
            "text-(--midia-cartao-texto) hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {rotuloDaVelocidade(velocidade)}
        </button>
      </Dica>
    </div>
  );
}
