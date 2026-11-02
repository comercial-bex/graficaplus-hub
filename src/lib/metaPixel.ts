/**
 * Meta Pixel — somente nas páginas públicas de marketing.
 * Nunca carregar nas telas internas do ERP (equipe logada).
 */
export const META_PIXEL_ID = "2215494762718272";

/** Rotas públicas de marketing onde o pixel pode rodar. */
const ROTAS_PUBLICAS = [/^\/convite(\/|$)/, /^\/seja-parceiro(\/|$)/];

export function rotaPublicaDeMarketing(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((r) => r.test(pathname));
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let iniciado = false;
let ultimoPageView = "";

function chamar(...args: unknown[]) {
  const f = window.fbq;
  if (!f) return;
  if (f.callMethod) f.callMethod.apply(f, args);
  else f.queue.push(args);
}

export function iniciarMetaPixel() {
  if (typeof window === "undefined" || iniciado) return;
  iniciado = true;
  if (!window.fbq) {
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod.apply(n, args);
      else n.queue.push(args);
    } as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    window.fbq = n;
    if (!window._fbq) window._fbq = n;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  }
  chamar("init", META_PIXEL_ID, {}, { agent: "lovable" });
}

function novoEventId(nome: string) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${nome}-${id}`;
}

/** PageView uma vez por endereço (evita duplicar em re-render). */
export function pageViewMeta(pathname: string) {
  if (!rotaPublicaDeMarketing(pathname)) return;
  iniciarMetaPixel();
  if (ultimoPageView === pathname) return;
  ultimoPageView = pathname;
  chamar("track", "PageView", {}, { eventID: novoEventId("pv") });
}

/** Cadastro de parceiro concluído (só após sucesso do backend). Sem dados pessoais. */
export function cadastroParceiroConcluidoMeta() {
  if (typeof window === "undefined" || !rotaPublicaDeMarketing(window.location.pathname)) return;
  iniciarMetaPixel();
  chamar("track", "CompleteRegistration", { content_name: "parceiro_revendedor", status: true }, { eventID: novoEventId("cr") });
  chamar("track", "Lead", { content_name: "parceiro_revendedor" }, { eventID: novoEventId("lead") });
}

const CHAVES_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid"] as const;

/** Lê UTMs/fbclid da URL atual (só os conhecidos, com limite de tamanho). */
export function lerOrigemDaUrl(search: string): Record<string, string> | null {
  const p = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const k of CHAVES_UTM) {
    const v = p.get(k)?.trim();
    if (v) out[k] = v.slice(0, 300);
  }
  return Object.keys(out).length ? out : null;
}
