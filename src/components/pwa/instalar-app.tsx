import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

/**
 * Registra o service worker e oferece instalar o Bex Print como app.
 *
 * O objetivo é cognitivo: quem está no balcão ou na máquina precisa abrir o
 * sistema com UM toque, sem digitar endereço nem procurar aba. No Android e
 * no Chrome o navegador dispara `beforeinstallprompt` e a instalação é um
 * botão. No iPhone não existe esse evento — o caminho é Compartilhar →
 * "Adicionar à Tela de Início", e a faixa explica isso com as palavras que
 * aparecem no Safari.
 *
 * A faixa some quando: já está instalado (modo standalone), a pessoa fechou
 * (lembrado por 14 dias) ou o navegador não permite instalar.
 */

type PromptInstalacao = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const CHAVE_DISPENSA = "bexprint:instalar:dispensado_em";
const DIAS_DISPENSA = 14;

function emStandalone() {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function dispensadoRecentemente() {
  try {
    const v = localStorage.getItem(CHAVE_DISPENSA);
    return !!v && Date.now() - Number(v) < DIAS_DISPENSA * 86400000;
  } catch {
    return false;
  }
}

function ehIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}

export function InstalarApp() {
  const [prompt, setPrompt] = useState<PromptInstalacao | null>(null);
  const [mostrarIOS, setMostrarIOS] = useState(false);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sem SW o app continua funcionando; só perde o "offline" */
      });
    }

    if (emStandalone() || dispensadoRecentemente()) return;

    const aoPoderInstalar = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptInstalacao);
      setVisivel(true);
    };
    window.addEventListener("beforeinstallprompt", aoPoderInstalar);

    // iPhone: Safari não avisa; oferecemos o caminho depois de um uso mínimo.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (ehIOS()) {
      t = setTimeout(() => {
        setMostrarIOS(true);
        setVisivel(true);
      }, 20000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", aoPoderInstalar);
      if (t) clearTimeout(t);
    };
  }, []);

  function dispensar() {
    try {
      localStorage.setItem(CHAVE_DISPENSA, String(Date.now()));
    } catch {
      /* navegador sem storage: só fecha */
    }
    setVisivel(false);
  }

  async function instalar() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setVisivel(false);
    setPrompt(null);
  }

  if (!visivel) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar o Bex Print"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">Abra o Bex Print com um toque</p>
          {mostrarIOS ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No Safari, toque em <Share className="inline h-4 w-4 align-text-bottom" /> <strong>Compartilhar</strong> e
              depois em <strong>Adicionar à Tela de Início</strong>. O ícone fica junto dos seus outros apps.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Instale na tela inicial do celular: abre direto, sem digitar endereço, e funciona como app.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {!mostrarIOS && (
              <button
                type="button"
                onClick={instalar}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                <Download className="h-4 w-4" /> Instalar
              </button>
            )}
            <button
              type="button"
              onClick={dispensar}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              Agora não
            </button>
          </div>
        </div>
        <button type="button" onClick={dispensar} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
