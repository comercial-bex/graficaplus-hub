import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Home, LogOut, Palette, Tags } from "lucide-react";
import { chaveDoLogo, urlDoLogo } from "@/lib/parceiro-api";
import { brl } from "@/domain/parceiros/preco";
import type { PainelDoParceiro } from "@/domain/parceiros/painel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OfertaAviso } from "./oferta-aviso";

/**
 * A moldura do painel do parceiro: marca dele no topo, crédito à vista e a
 * navegação — em abas no computador, na barra de baixo no celular, onde ele vai
 * orçar na frente do cliente.
 */

const NAVEGACAO = [
  { to: "/parceiro", rotulo: "Início", icone: Home, exato: true },
  { to: "/parceiro/orcamentos", rotulo: "Orçamentos", icone: FileText, exato: false },
  { to: "/parceiro/tabela", rotulo: "Tabela", icone: Tags, exato: false },
  { to: "/parceiro/marca", rotulo: "Minha marca", icone: Palette, exato: false },
] as const;

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
  const ativo = (to: string, exato: boolean) =>
    exato ? pathname === to || pathname === `${to}/` : pathname === to || pathname.startsWith(`${to}/`);

  const { data: logoUrl } = useQuery({
    queryKey: chaveDoLogo(painel.marca.logo_path),
    queryFn: () => urlDoLogo(painel.marca.logo_path),
    enabled: !!painel.marca.logo_path,
    staleTime: 50 * 60_000,
  });

  const nivel = painel.nivel;
  const corDoNivel = nivel.cor ?? "var(--bex-cyan)";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white"
            aria-hidden
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-sm font-bold" style={{ color: painel.marca.cor }}>
                {iniciais(painel.parceiro.nome)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{painel.parceiro.nome}</p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: corDoNivel }} />
              Parceiro {nivel.nome ?? ""} · Bex Print
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Seu crédito</p>
            <p className="text-sm font-semibold tabular-nums">{brl(painel.saldo_credito)}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onSair} aria-label="Sair" title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <nav className="mx-auto hidden max-w-5xl gap-1 px-4 md:flex" aria-label="Painel do parceiro">
          {NAVEGACAO.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
                ativo(item.to, item.exato)
                  ? "border-[color:var(--bex-cyan)] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icone className="h-4 w-4" />
              {item.rotulo}
            </Link>
          ))}
        </nav>
        <div className="h-[2px]" style={{ background: "var(--gradient-cmyk)" }} />
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 md:pb-12 md:pt-8">
        {children}
      </main>

      {/* No celular a navegação fica no polegar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        aria-label="Painel do parceiro"
      >
        {NAVEGACAO.map((item) => {
          const selecionado = ativo(item.to, item.exato);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                selecionado ? "text-[color:var(--bex-cyan)]" : "text-muted-foreground",
              )}
            >
              <item.icone className="h-5 w-5" />
              {item.rotulo}
            </Link>
          );
        })}
      </nav>

      <OfertaAviso painel={painel} />
    </div>
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
