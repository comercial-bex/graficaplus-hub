import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type CSSProperties } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Dica } from "@/components/bex/Dica";
import { ThemeToggle } from "@/components/bex/ThemeToggle";
import { brl } from "@/domain/parceiros/preco";
import type { PainelDoParceiro } from "@/domain/parceiros/painel";
import { cn } from "@/lib/utils";
import { OfertaAviso } from "./oferta-aviso";
import { HelpCircle } from "lucide-react";
import { TourGuiado, EVENTO_REVER_TOUR } from "./tour-guiado";
import {
  estaNaTela,
  LARGURA_DO_MENU_DO_PARCEIRO,
  MenuDoParceiro,
  NAVEGACAO_DO_PARCEIRO,
} from "./menu-do-parceiro";

/**
 * A moldura do painel do parceiro, no mesmo desenho do sistema da equipe:
 * menu lateral escuro à esquerda (no celular abre pelo botão do topo), barra
 * de topo com o nome da tela, crédito e o botão de tema, e o conteúdo num fundo
 * que respeita claro/escuro. No celular a barra de baixo continua, porque é
 * onde o polegar do parceiro alcança na hora de orçar na frente do cliente.
 */
export function Casca({
  painel,
  onSair,
  children,
}: {
  painel: PainelDoParceiro;
  onSair: () => void;
  children: React.ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Primeira visita, sem escolha de tema guardada: abre no claro. O parceiro
  // reclamou que o painel inteiro era escuro demais (24/10/2026); quem prefere
  // o escuro troca no botão do topo e a escolha fica guardada.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("bexprint:tema")) return;
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
      window.localStorage.setItem("bexprint:tema", "light");
    } catch {
      /* sem armazenamento: fica no tema do aparelho */
    }
  }, []);

  const atual = NAVEGACAO_DO_PARCEIRO.find((i) => estaNaTela(pathname, i.to, i.exato));

  return (
    <SidebarProvider style={{ "--sidebar-width": LARGURA_DO_MENU_DO_PARCEIRO } as CSSProperties}>
      <TourGuiado />
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <MenuDoParceiro painel={painel} onSair={onSair} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* sticky já posiciona a faixa absoluta de baixo; "relative" junto disputava o position */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card/90 px-2 shadow-sm backdrop-blur-xl md:gap-3 md:px-4">
            <SidebarTrigger className="h-11 w-11 md:h-7 md:w-7" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{atual?.rotulo ?? "Painel do parceiro"}</p>
              <p className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground md:block">
                Painel do parceiro · Bex Print
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Seu crédito</p>
              <p className="text-sm font-semibold tabular-nums">{brl(painel.saldo_credito)}</p>
            </div>
            <Dica texto="Rever a apresentação do painel" lado="bottom">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event(EVENTO_REVER_TOUR))}
                aria-label="Rever a apresentação do painel"
                className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <HelpCircle className="h-5 w-5" />
              </button>
            </Dica>
            <ThemeToggle />
            <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: "var(--gradient-cmyk)" }} />
          </header>

          <main className="w-full flex-1 px-4 pb-28 pt-5 md:px-7 2xl:px-10 md:pb-12 md:pt-8">{children}</main>
        </div>
      </div>

      {/* No celular a navegação fica no polegar */}
      <nav
        data-tour="menu"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        aria-label="Painel do parceiro"
      >
        {NAVEGACAO_DO_PARCEIRO.map((item) => {
          const selecionado = estaNaTela(pathname, item.to, item.exato);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-xs font-medium",
                selecionado ? "text-status-cyan" : "text-muted-foreground",
              )}
            >
              <item.icone className="h-5 w-5" aria-hidden="true" />
              {item.curto}
            </Link>
          );
        })}
      </nav>

      <OfertaAviso painel={painel} />
    </SidebarProvider>
  );
}
