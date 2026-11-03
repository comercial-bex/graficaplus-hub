import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Apresentação do painel na primeira entrada do parceiro. O "visto" fica na
 * conta (user_metadata), para não reaparecer em outro aparelho; o localStorage
 * só evita que pisque antes da sessão carregar.
 */
const CHAVE_LOCAL = "bexprint:tour-parceiro";
export const EVENTO_REVER_TOUR = "bexprint:rever-tour";

type Passo = { alvo?: string; titulo: string; texto: string };
const PASSOS: Passo[] = [
  {
    titulo: "Bem-vindo ao seu painel",
    texto: "Aqui você compra da gráfica com preço de parceiro e faz orçamentos com a sua marca. Vamos ver em 1 minuto.",
  },
  {
    alvo: "comprar",
    titulo: "Comprar da gráfica",
    texto: "Compra direta para você: escolhe os produtos, paga sinal de 50% ou à vista, e vira produção.",
  },
  {
    alvo: "orcar",
    titulo: "Orçar com a sua marca",
    texto: "Monte o orçamento do seu cliente e baixe o PDF com a sua logo. A gráfica não vê quem é o seu cliente.",
  },
  {
    alvo: "nivel",
    titulo: "Nível e crédito",
    texto: "Quanto mais você compra, maior o nível e menor o preço. O crédito abate no próximo pedido.",
  },
  {
    alvo: "menu",
    titulo: "Menu",
    texto: "Tabela de preços, orçamentos, compras e a sua marca ficam aqui. Toque no ? de qualquer tela para tirar dúvidas.",
  },
  {
    titulo: "Pronto para começar",
    texto: "O primeiro passo é colocar a sua logo e telefone: é o que o seu cliente vê no PDF.",
  },
];

function visivel(el: Element) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function TourGuiado() {
  const [concluido, setConcluido] = useState<boolean | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setConcluido(!!data.user?.user_metadata?.tour_parceiro_visto));
  }, []);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [aberto, setAberto] = useState(false);
  const [i, setI] = useState(0);
  const [ret, setRet] = useState<DOMRect | null>(null);

  useEffect(() => {
    let local = false;
    try {
      local = !!window.localStorage.getItem(CHAVE_LOCAL);
    } catch {
      /* sem armazenamento */
    }
    if (concluido === false && !local && pathname === "/parceiro") setAberto(true);
    const rever = () => {
      setI(0);
      if (pathname !== "/parceiro") navigate({ to: "/parceiro" });
      setAberto(true);
    };
    window.addEventListener(EVENTO_REVER_TOUR, rever);
    return () => window.removeEventListener(EVENTO_REVER_TOUR, rever);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concluido, pathname]);

  const passo = PASSOS[i];

  const medir = useCallback(() => {
    if (!passo?.alvo) return setRet(null);
    const el = [...document.querySelectorAll(`[data-tour="${passo.alvo}"]`)].find(visivel);
    setRet(el ? el.getBoundingClientRect() : null);
  }, [passo]);

  useLayoutEffect(() => {
    if (!aberto) return;
    const el = passo?.alvo && [...document.querySelectorAll(`[data-tour="${passo.alvo}"]`)].find(visivel);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = window.setTimeout(medir, 350);
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [aberto, i, medir, passo]);

  const fechar = useCallback(() => {
    setAberto(false);
    try {
      window.localStorage.setItem(CHAVE_LOCAL, "1");
    } catch {
      /* sem armazenamento */
    }
    if (concluido === false) {
      setConcluido(true);
      void supabase.auth.updateUser({ data: { tour_parceiro_visto: new Date().toISOString() } });
    }
  }, [concluido]);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowRight") setI((v) => Math.min(PASSOS.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, fechar]);

  if (!aberto || !passo) return null;
  const ultimo = i === PASSOS.length - 1;
  const pad = 8;
  const abaixo = ret ? ret.top + ret.height / 2 < window.innerHeight / 2 : true;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={passo.titulo}>
      {ret ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-[color:var(--bex-cyan)] transition-all duration-300 motion-reduce:transition-none"
          style={{
            top: ret.top - pad,
            left: ret.left - pad,
            width: ret.width + pad * 2,
            height: ret.height + pad * 2,
            boxShadow: "0 0 0 9999px color-mix(in oklab, black 62%, transparent)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}
      <div
        key={i}
        className="bloco-entra absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+1rem)] mx-auto max-w-md rounded-3xl border border-border bg-card p-5 text-card-foreground shadow-2xl md:inset-x-auto md:left-1/2 md:w-[420px] md:-translate-x-1/2"
        style={
          ret && window.innerWidth >= 768
            ? abaixo
              ? { top: Math.min(ret.bottom + 20, window.innerHeight - 240), bottom: "auto" }
              : { top: Math.max(16, ret.top - 240), bottom: "auto" }
            : !ret
              ? { top: "50%", bottom: "auto", transform: "translate(-50%, -50%)", left: "50%", right: "auto" }
              : undefined
        }
      >
        <button
          type="button"
          onClick={fechar}
          aria-label="Pular apresentação"
          className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-foreground/5"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-3 flex gap-1">
          {PASSOS.map((_, n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: n <= i ? "var(--bex-cyan)" : "var(--border)" }}
            />
          ))}
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          {i + 1} de {PASSOS.length}
        </p>
        <h2 className="mt-1 text-lg font-bold">{passo.titulo}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{passo.texto}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={fechar}>
            Pular
          </Button>
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="outline" size="sm" onClick={() => setI(i - 1)}>
                Voltar
              </Button>
            )}
            {ultimo ? (
              <Button
                size="sm"
                onClick={() => {
                  fechar();
                  navigate({ to: "/parceiro/marca" });
                }}
              >
                Colocar minha marca
              </Button>
            ) : (
              <Button size="sm" onClick={() => setI(i + 1)}>
                Próximo
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
