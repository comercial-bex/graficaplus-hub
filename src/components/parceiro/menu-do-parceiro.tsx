import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Crown, FileText, Home, LogOut, Palette, Tags, Wallet, X } from "lucide-react";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { chaveDoLogo, urlDoLogo } from "@/lib/parceiro-api";
import { brl } from "@/domain/parceiros/preco";
import type { PainelDoParceiro } from "@/domain/parceiros/painel";
import { LOGO_FUNDO_ESCURO } from "@/lib/marca";
import { cn } from "@/lib/utils";

/**
 * O menu lateral do parceiro: o mesmo desenho do menu da equipe (painel escuro
 * de marca, logo da Bex Print, avatar, lista de telas com a ativa em destaque,
 * rodapé com Sair) — só que com as quatro telas dele. Antes o parceiro tinha
 * abas no topo, uma interface diferente da que a equipe usa (pedido do dono,
 * 24/10/2026: "usar a mesma interface do sistema, com sidebar do lado").
 */

export const LARGURA_DO_MENU_DO_PARCEIRO = "17rem";

export const NAVEGACAO_DO_PARCEIRO = [
  { to: "/parceiro", rotulo: "Início", icone: Home, exato: true },
  { to: "/parceiro/orcamentos", rotulo: "Orçamentos", icone: FileText, exato: false },
  { to: "/parceiro/tabela", rotulo: "Tabela de preços", icone: Tags, exato: false },
  { to: "/parceiro/marca", rotulo: "Minha marca", icone: Palette, exato: false },
] as const;

export function estaNaTela(pathname: string, to: string, exato: boolean) {
  return exato ? pathname === to || pathname === `${to}/` : pathname === to || pathname.startsWith(`${to}/`);
}

export function MenuDoParceiro({ painel, onSair }: { painel: PainelDoParceiro; onSair: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const fecharNoCelular = () => {
    if (isMobile) setOpenMobile(false);
  };

  const { data: logoUrl } = useQuery({
    queryKey: chaveDoLogo(painel.marca.logo_path),
    queryFn: () => urlDoLogo(painel.marca.logo_path),
    enabled: !!painel.marca.logo_path,
    staleTime: 50 * 60_000,
  });

  const nivel = painel.nivel;
  const corDoNivel = nivel.cor ?? "var(--sidebar-marca)";
  const linhaDoRodape =
    "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:h-9";

  return (
    <Sidebar collapsible="offcanvas" larguraNoCelular={LARGURA_DO_MENU_DO_PARCEIRO}>
      <div className="flex h-full w-full flex-col bg-sidebar">
        <div className="relative flex flex-col items-center gap-2.5 border-b border-sidebar-border px-4 pb-4 pt-4">
          {isMobile && (
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setOpenMobile(false)}
              className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          <img
            src={LOGO_FUNDO_ESCURO}
            alt="Bex Print"
            width={1165}
            height={532}
            draggable={false}
            className="h-auto w-32 max-w-[calc(100%-3rem)] select-none object-contain"
          />
          <Link
            to="/parceiro/marca"
            onClick={fecharNoCelular}
            aria-label="Minha marca"
            className="mt-1 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-white ring-[3px] ring-[var(--sidebar-marca)]/70 ring-offset-2 ring-offset-sidebar focus-visible:outline-none focus-visible:ring-sidebar-ring"
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-base font-bold" style={{ color: painel.marca.cor }}>
                {iniciais(painel.parceiro.nome)}
              </span>
            )}
          </Link>
          <div className="w-full min-w-0 text-center">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">
              Olá, <span className="text-[var(--sidebar-marca)]">{painel.parceiro.nome}</span>
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-sidebar-foreground/70">
              <Crown className="h-3 w-3" style={{ color: corDoNivel }} aria-hidden />
              Parceiro {nivel.nome ?? ""}
              {nivel.desconto_pct != null && <span>· {Number(nivel.desconto_pct).toLocaleString("pt-BR")}% de desconto</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--sidebar-marca)]/40 bg-[var(--sidebar-marca)]/10">
            <Wallet className="h-4 w-4 text-[var(--sidebar-marca)]" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-sidebar-foreground/55">Seu crédito</p>
            <p className="truncate text-sm font-bold tabular-nums text-sidebar-accent-foreground">{brl(painel.saldo_credito)}</p>
          </div>
        </div>

        <nav aria-label="Painel do parceiro" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {NAVEGACAO_DO_PARCEIRO.map((item) => {
            const ativo = estaNaTela(pathname, item.to, item.exato);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={fecharNoCelular}
                data-active={ativo}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "group/item flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:h-9",
                  "data-[active=true]:bg-[var(--sidebar-trilho)] data-[active=true]:font-bold data-[active=true]:text-[var(--sidebar-trilho-foreground)]",
                )}
              >
                <item.icone className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item.rotulo}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-0.5 border-t border-sidebar-border p-3">
          <button type="button" className={linhaDoRodape} onClick={onSair}>
            <LogOut className="h-4 w-4" aria-hidden />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </Sidebar>
  );
}

function iniciais(nome: string) {
  return (
    nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "P"
  );
}
