import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
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
 * Dois caminhos:
 * - Automático: só em /dashboard e a partir da 2ª carga do app; some quando
 *   já está instalado (standalone), a pessoa fechou (14 dias) ou o navegador
 *   não permite instalar.
 * - Manual: o item "Instalar no celular" do menu dispara o evento
 *   `bexprint:instalar` no window. Aqui a dispensa e a regra da 2ª visita não
 *   valem — a pessoa pediu.
 *
 * Fica só no layout autenticado: link público do cliente não convida a instalar
 * um sistema interno nem registra o SW.
 */

type PromptInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const CHAVE_DISPENSA = "bexprint:instalar:dispensado_em";
const CHAVE_VISITAS = "bexprint:instalar:visitas";
const DIAS_DISPENSA = 14;
export const EVENTO_INSTALAR = "bexprint:instalar";

// O que a faixa explica: botão do navegador, passo a passo do iPhone, ou o
// navegador não ofereceu instalar (caminho manual sem prompt).
type ModoFaixa = "prompt" | "ios" | "sem-prompt";

function emStandalone() {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function dispensadoRecentemente() {
  try {
    const v = localStorage.getItem(CHAVE_DISPENSA);
    return !!v && Date.now() - Number(v) < DIAS_DISPENSA * 86400000;
  } catch {
    return false;
  }
}

// +1 por montagem; devolve o total. Sem storage conta como 1ª visita (não incomoda).
function contarVisita() {
  try {
    const total = Number(localStorage.getItem(CHAVE_VISITAS) ?? 0) + 1;
    localStorage.setItem(CHAVE_VISITAS, String(total));
    return total;
  } catch {
    return 1;
  }
}

function ehIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}

export function InstalarApp() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [prompt, setPrompt] = useState<PromptInstalacao | null>(null);
  const [modo, setModo] = useState<ModoFaixa>("prompt");
  const [visivel, setVisivel] = useState(false);
  // Aberta pelo menu: fechar não grava a dispensa de 14 dias (a pessoa pediu para ver).
  const [manual, setManual] = useState(false);
  // Faixa automática liberada nesta carga (2ª visita+, não instalado, não dispensado).
  const [autoLiberado, setAutoLiberado] = useState(false);
  // Refs para os handlers do window lerem o estado atual sem re-registrar.
  const promptRef = useRef<PromptInstalacao | null>(null);
  const pathnameRef = useRef(pathname);
  const autoRef = useRef(false);
  pathnameRef.current = pathname;
  autoRef.current = autoLiberado;

  const noInicio = () => /^\/dashboard\/?$/.test(pathnameRef.current);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sem SW o app continua funcionando; só perde o "offline" */
      });
    }

    const visitas = contarVisita();
    const liberado = !emStandalone() && !dispensadoRecentemente() && visitas >= 2;
    setAutoLiberado(liberado);
    autoRef.current = liberado;

    // Sempre captura o prompt (mesmo já instalado ou dispensado): o caminho
    // manual precisa dele. Só a exibição automática obedece às regras.
    const aoPoderInstalar = (e: Event) => {
      e.preventDefault();
      const p = e as PromptInstalacao;
      promptRef.current = p;
      setPrompt(p);
      if (autoRef.current && noInicio()) {
        setModo("prompt");
        setVisivel(true);
      }
    };
    window.addEventListener("beforeinstallprompt", aoPoderInstalar);

    // Caminho manual (item "Instalar no celular" do menu).
    const aoPedirInstalar = () => {
      const p = promptRef.current;
      if (p) {
        void p
          .prompt()
          .then(() => p.userChoice)
          .then(() => {
            // O prompt só serve uma vez: fecha a faixa (se aberta) para não sobrar botão morto.
            setVisivel(false);
            promptRef.current = null;
            setPrompt(null);
          });
        return;
      }
      setModo(ehIOS() ? "ios" : "sem-prompt");
      setManual(true);
      setVisivel(true);
    };
    window.addEventListener(EVENTO_INSTALAR, aoPedirInstalar);

    // iPhone: Safari não avisa; oferecemos o caminho depois de um uso mínimo,
    // e só se nesse momento a pessoa estiver no Início.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (liberado && ehIOS()) {
      t = setTimeout(() => {
        if (!noInicio()) return;
        setModo("ios");
        setVisivel(true);
      }, 20000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", aoPoderInstalar);
      window.removeEventListener(EVENTO_INSTALAR, aoPedirInstalar);
      if (t) clearTimeout(t);
    };
  }, []);

  // Prompt capturado fora do Início: mostra quando a pessoa chegar ao /dashboard.
  useEffect(() => {
    if (autoLiberado && prompt && !visivel && /^\/dashboard\/?$/.test(pathname)) {
      setModo("prompt");
      setVisivel(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, prompt, autoLiberado]);

  function dispensar() {
    if (!manual) {
      try {
        localStorage.setItem(CHAVE_DISPENSA, String(Date.now()));
      } catch {
        /* navegador sem storage: só fecha */
      }
      // Dispensou: nesta carga a faixa automática não volta ao passar de novo pelo Início.
      setAutoLiberado(false);
      autoRef.current = false;
    }
    setManual(false);
    setVisivel(false);
  }

  async function instalar() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setVisivel(false);
    promptRef.current = null;
    setPrompt(null);
  }

  if (!visivel) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar o Bex Print"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">Abra o Bex Print com um toque</p>
          {modo === "ios" && (
            <p className="mt-1 text-sm text-muted-foreground">
              No Safari, toque em <Share className="inline h-4 w-4 align-text-bottom" />{" "}
              <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
              O ícone fica junto dos seus outros apps.
            </p>
          )}
          {modo === "sem-prompt" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Seu navegador não ofereceu instalar. No computador, use o ícone de instalar na barra
              de endereço do Chrome; no celular, menu do navegador → Instalar app.
            </p>
          )}
          {modo === "prompt" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Instale na tela inicial do celular: abre direto, sem digitar endereço, e funciona como
              app.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {modo === "prompt" && (
              <button
                type="button"
                onClick={instalar}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Download className="h-4 w-4" /> Instalar
              </button>
            )}
            <button
              type="button"
              onClick={dispensar}
              className="inline-flex min-h-11 items-center rounded-lg px-4 py-3 text-sm text-muted-foreground hover:bg-muted"
            >
              {modo === "prompt" ? "Agora não" : "Entendi"}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dispensar}
          aria-label="Fechar"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
