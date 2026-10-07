import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Download, House, LogOut, Search, UserRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dica } from "@/components/bex/Dica";
import { BuscaDeTelas } from "@/components/menu/busca-de-telas";
import type { ValorDaContagem } from "@/components/menu/contagens";
import { iniciais, primeiroNome } from "@/components/menu/perfil";
import { dicaDoItemDoMenu, dicaMenu, dicasDoMenu } from "@/lib/dicas";
import { LOGO_FUNDO_ESCURO } from "@/lib/marca";
import {
  atalhosDoCelular,
  estaNaRota,
  moduloDaRota,
  moduloPadrao,
  mostraTituloDoSubgrupo,
  type AreaVisivel,
  type ContagemDoMenu,
  type IdDoModulo,
  type ItemVisivel,
  type PaginaDaBusca,
} from "@/lib/menu";
import { cn } from "@/lib/utils";

/** Trilho dos módulos + painel do módulo ativo. O layout passa o mesmo valor ao SidebarProvider. */
export const LARGURA_DO_TRILHO = "4rem";
export const LARGURA_DO_MENU = "20.5rem";

/** O módulo que a pessoa escolheu por último neste aparelho. */
const CHAVE_MODULO = "bexprint:menu:modulo";

function lerModuloLembrado(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_MODULO);
  } catch {
    // Navegação privada ou armazenamento bloqueado: o menu volta ao padrão.
    return null;
  }
}

function lembrarModulo(id: IdDoModulo) {
  try {
    window.localStorage.setItem(CHAVE_MODULO, id);
  } catch {
    /* sem armazenamento o menu só não lembra na próxima vez */
  }
}

/** Verdadeiro quando o app já roda instalado (ícone na tela inicial). Só no cliente. */
function estaInstalado(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone)
  );
}

function SeloDaContagem({ tipo, valor }: { tipo?: ContagemDoMenu; valor?: ValorDaContagem }) {
  if (!tipo || valor === undefined) return null;
  if (valor === "erro") {
    return (
      <span
        title={dicasDoMenu.contagemFalhou}
        data-selo="erro"
        className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-sidebar-border px-1 text-[11px] font-bold leading-none text-sidebar-foreground/60 group-data-[active=true]/item:border-sidebar group-data-[active=true]/item:text-sidebar"
      >
        <span aria-hidden="true">?</span>
        <span className="sr-only">{dicasDoMenu.contagemFalhou}</span>
      </span>
    );
  }
  if (valor <= 0) return null;
  return (
    <span
      data-selo={valor}
      className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-marca)] px-1.5 text-[11px] font-bold tabular-nums leading-none text-sidebar group-data-[active=true]/item:bg-sidebar group-data-[active=true]/item:text-[var(--sidebar-marca)]"
    >
      <span aria-hidden="true">{valor > 99 ? "99+" : valor}</span>
      <span className="sr-only">{`${valor} ${dicasDoMenu.contagens[tipo]}`}</span>
    </span>
  );
}

/** Uma entrada do painel: um item da árvore ou um atalho da rotina. */
type Entrada = {
  url: string;
  link: string;
  title: string;
  icon: LucideIcon;
  dica?: string;
  badge?: ContagemDoMenu;
  /** Marcador para os testes e para o CSS: "item", "topo" ou "atalho". */
  marca: "item" | "topo" | "atalho";
};

type Secao = { label: string | null; entradas: Entrada[] };

export type PropsDoMenuLateral = {
  areas: AreaVisivel[];
  /** O link do Início (ou o portal, para o papel cliente). */
  topo: { title: string; url: string } | null;
  paginasDaBusca: PaginaDaBusca[];
  pathname: string;
  pessoa: { nome: string | null; email: string | null; foto: string | null };
  contagens: Partial<Record<ContagemDoMenu, ValorDaContagem>>;
  aoEscolherNaBusca: (url: string) => void;
  aoSair: () => void;
};

/**
 * O menu lateral, na estrutura do Bex Lite que o dono pediu em 06/10/2026:
 *
 *   - um TRILHO estreito, na cor da marca, com um ícone por módulo — o Início
 *     e as áreas (Vendas, Produção, Financeiro, Administração); o módulo
 *     ativo fica num quadrado escuro;
 *   - ao lado, o PAINEL escuro: a logo, a foto da pessoa com o ponto de
 *     conectado, "Olá, {nome}" e o e-mail; o cartão "MÓDULO / {nome}" com a
 *     contagem; e as seções do módulo ativo (os subgrupos da árvore) com os
 *     itens.
 *
 * Quem decide o que aparece é `menuDaPessoa` (permissão da rota); aqui só se
 * desenha. Clicar num módulo do trilho troca o painel sem navegar, como no
 * Bex Lite; a rota manda quando muda. Recolhido (computador), sobra o trilho.
 */
export function MenuLateral({
  areas,
  topo,
  paginasDaBusca,
  pathname,
  pessoa,
  contagens,
  aoEscolherNaBusca,
  aoSair,
}: PropsDoMenuLateral) {
  const { state, isMobile, setOpen, setOpenMobile } = useSidebar();
  const recolhido = state === "collapsed" && !isMobile;

  // No celular o menu é um Sheet por cima da tela: sem fechar ao escolher,
  // a navegação acontece atrás do painel e parece que o toque não funcionou.
  const fecharNoCelular = () => {
    if (isMobile) setOpenMobile(false);
  };

  // O módulo do trilho: o da rota; o que a pessoa clicou nesta rota; ou, fora
  // de módulo (Meu perfil), o lembrado neste aparelho / o da rotina. Começa
  // pelo padrão no servidor e no cliente — ler o armazenamento no primeiro
  // desenho faria o HTML dos dois discordar.
  const [escolha, setEscolha] = useState<{ modulo: IdDoModulo; em: string } | null>(null);
  const [lembrado, setLembrado] = useState<string | null>(null);
  useEffect(() => {
    setLembrado(lerModuloLembrado());
  }, []);
  const daRota = moduloDaRota(pathname);
  const ativo: IdDoModulo =
    escolha && escolha.em === pathname ? escolha.modulo : (daRota ?? moduloPadrao(areas, lembrado));
  useEffect(() => {
    lembrarModulo(ativo);
  }, [ativo]);
  const escolherModulo = (id: IdDoModulo) => {
    setEscolha({ modulo: id, em: pathname });
    if (recolhido) setOpen(true);
  };

  const [buscaAberta, setBuscaAberta] = useState(false);
  const abrirBusca = () => {
    fecharNoCelular();
    setBuscaAberta(true);
  };
  const escolherNaBusca = (url: string) => {
    setBuscaAberta(false);
    fecharNoCelular();
    aoEscolherNaBusca(url);
  };

  const [teclaDaBusca, setTeclaDaBusca] = useState("Ctrl K");
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setTeclaDaBusca("⌘K");
  }, []);

  // Começa escondido para o SSR não decidir por um `window` que não existe;
  // no cliente a gente confere e mostra o item se ainda não está instalado.
  const [mostrarInstalar, setMostrarInstalar] = useState(false);
  useEffect(() => {
    setMostrarInstalar(!estaInstalado());
  }, []);

  const somaDaArea = (area: AreaVisivel) =>
    area.subgrupos
      .flatMap((s) => s.itens)
      .reduce((n, i) => {
        const v = i.badge ? contagens[i.badge] : undefined;
        return typeof v === "number" ? n + v : n;
      }, 0);

  // Os módulos do trilho: Início (quando a pessoa o abre) e as áreas dela.
  const modulos: {
    id: IdDoModulo;
    label: string;
    curto: string;
    icon: LucideIcon;
    soma: number;
  }[] = [
    ...(topo
      ? [{ id: "inicio" as const, label: topo.title, curto: topo.title, icon: House, soma: 0 }]
      : []),
    ...areas.map((a) => ({
      id: a.id,
      label: a.label,
      curto: a.curto ?? a.label,
      icon: a.icon,
      soma: somaDaArea(a),
    })),
  ];

  const entradaDoItem = (i: ItemVisivel, marca: Entrada["marca"]): Entrada => ({
    url: i.url,
    link: i.link,
    title: i.title,
    icon: i.icon,
    dica: dicaDoItemDoMenu(
      i.link,
      i.telas.filter((t) => t.url !== i.link).map((t) => t.title),
    ),
    badge: i.badge,
    marca,
  });

  // As seções do painel: no Início, o próprio Início e as telas da rotina da
  // pessoa (os atalhos); nas áreas, os subgrupos da árvore.
  const areaAtiva = areas.find((a) => a.id === ativo) ?? null;
  const atalhos = atalhosDoCelular(areas);
  const secoes: Secao[] = areaAtiva
    ? areaAtiva.subgrupos.map((s) => ({
        label: mostraTituloDoSubgrupo(areaAtiva, s) ? s.label : null,
        entradas: s.itens.map((i) => entradaDoItem(i, "item")),
      }))
    : [
        ...(topo
          ? [
              {
                label: "Visão geral",
                entradas: [
                  {
                    url: topo.url,
                    link: topo.url,
                    title: topo.title,
                    icon: House,
                    dica: dicaMenu(topo.url),
                    marca: "topo" as const,
                  },
                ],
              },
            ]
          : []),
        ...(atalhos.length > 0
          ? [{ label: "Sua rotina", entradas: atalhos.map((i) => entradaDoItem(i, "atalho")) }]
          : []),
      ];
  const moduloAtivo = modulos.find((m) => m.id === ativo);
  const nEntradas = secoes.reduce((n, s) => n + s.entradas.length, 0);
  const pendentes = areaAtiva ? somaDaArea(areaAtiva) : 0;
  const ativa = (e: Entrada) => estaNaRota(pathname, e.url);

  const nome = primeiroNome(pessoa.nome, pessoa.email);
  // Dica só no computador: no celular o nome já fica embaixo do ícone, e o
  // Sheet foca o primeiro botão ao abrir — a dica abriria sozinha, por cima da logo.
  const DicaDoTrilho = ({ texto, children }: { texto: string; children: ReactNode }) =>
    isMobile ? (
      <>{children}</>
    ) : (
      <Dica texto={texto} lado="right">
        {children}
      </Dica>
    );
  const linhaDoRodape =
    "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:h-9";

  return (
    <>
      <Sidebar collapsible="icon" larguraNoCelular={LARGURA_DO_MENU}>
        <div className="flex h-full w-full">
          {/* O trilho: um ícone por módulo, na cor da marca. */}
          <nav
            aria-label="Módulos"
            className="flex w-16 shrink-0 flex-col items-center gap-1.5 bg-[var(--sidebar-trilho)] py-3"
          >
            {modulos.map((m) => {
              const ehAtivo = m.id === ativo;
              return (
                <DicaDoTrilho key={m.id} texto={m.label}>
                  <button
                    type="button"
                    data-modulo={m.id}
                    data-active={ehAtivo}
                    aria-label={m.label}
                    aria-current={ehAtivo ? "true" : undefined}
                    onClick={() => escolherModulo(m.id)}
                    className={cn(
                      "relative flex w-14 flex-col items-center justify-center gap-0.5 rounded-xl py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar md:h-11 md:w-11 md:py-0",
                      ehAtivo
                        ? "bg-sidebar text-[var(--sidebar-marca)] shadow-lg"
                        : "text-[var(--sidebar-trilho-foreground)]/75 hover:bg-black/10 hover:text-[var(--sidebar-trilho-foreground)]",
                    )}
                  >
                    <m.icon className="h-5 w-5" aria-hidden="true" />
                    <span className="max-w-full truncate text-[9px] font-bold leading-none md:hidden">
                      {m.curto}
                    </span>
                    {/* Módulo fechado não esconde pendência: a soma vai no canto do ícone. */}
                    {!ehAtivo && m.soma > 0 && (
                      <span
                        data-soma={m.soma}
                        className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar px-1 text-[10px] font-bold tabular-nums leading-none text-[var(--sidebar-marca)]"
                      >
                        <span aria-hidden="true">{m.soma > 99 ? "99+" : m.soma}</span>
                        <span className="sr-only">{`${m.soma} pendências em ${m.label}`}</span>
                      </span>
                    )}
                  </button>
                </DicaDoTrilho>
              );
            })}

            <div className="mt-auto flex flex-col items-center gap-1.5">
              <DicaDoTrilho texto={dicasDoMenu.busca}>
                <button
                  type="button"
                  aria-label={`Buscar tela (${teclaDaBusca})`}
                  onClick={abrirBusca}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--sidebar-trilho-foreground)]/75 transition-colors hover:bg-black/10 hover:text-[var(--sidebar-trilho-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar"
                >
                  <Search className="h-5 w-5" aria-hidden="true" />
                </button>
              </DicaDoTrilho>
              {/* Recolhido, é por aqui que se chega ao perfil. */}
              <DicaDoTrilho texto="Meu perfil">
                <Link
                  to="/configuracoes"
                  onClick={fecharNoCelular}
                  aria-label="Meu perfil"
                  className="flex h-11 w-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar"
                >
                  <Avatar className="h-8 w-8 border-2 border-sidebar">
                    <AvatarImage src={pessoa.foto ?? undefined} alt="" className="object-cover" />
                    <AvatarFallback className="bg-sidebar text-[10px] font-bold text-[var(--sidebar-marca)]">
                      {iniciais(pessoa.nome, pessoa.email)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              </DicaDoTrilho>
            </div>
          </nav>

          {/* O painel do módulo ativo. Recolhido no computador, some. */}
          <div
            data-painel={ativo}
            className="flex min-w-0 flex-1 flex-col bg-sidebar group-data-[collapsible=icon]:hidden"
          >
            <div className="relative flex flex-col items-center gap-2.5 border-b border-sidebar-border px-4 pb-4 pt-4">
              {/* O X do Sheet fica escondido pelo componente base; sem este botão a única
                  saída no celular é acertar a faixa estreita do overlay. */}
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
                className="h-auto w-36 max-w-[calc(100%-3rem)] select-none object-contain"
              />
              <Link
                to="/configuracoes"
                onClick={fecharNoCelular}
                title="Meu perfil"
                className="relative mt-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Avatar className="h-16 w-16 ring-[3px] ring-[var(--sidebar-marca)]/70 ring-offset-2 ring-offset-sidebar">
                  <AvatarImage
                    src={pessoa.foto ?? undefined}
                    alt={`Foto de ${nome}`}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-sidebar-accent text-base font-bold text-[var(--sidebar-marca)]">
                    {iniciais(pessoa.nome, pessoa.email)}
                  </AvatarFallback>
                </Avatar>
                <span
                  aria-label="Conectado"
                  role="img"
                  className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-[var(--sidebar-online)] ring-2 ring-sidebar"
                />
              </Link>
              <div className="w-full min-w-0 text-center">
                <p
                  data-ola=""
                  className="truncate text-sm font-semibold text-sidebar-foreground"
                  title={pessoa.nome ?? undefined}
                >
                  Olá{nome ? "," : ""} <span className="text-[var(--sidebar-marca)]">{nome}</span>
                </p>
                {pessoa.email && (
                  <p
                    className="truncate text-[11px] text-sidebar-foreground/60"
                    title={pessoa.email}
                  >
                    {pessoa.email}
                  </p>
                )}
              </div>
            </div>

            {moduloAtivo && (
              <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--sidebar-marca)]/40 bg-[var(--sidebar-marca)]/10">
                  <moduloAtivo.icon
                    className="h-4 w-4 text-[var(--sidebar-marca)]"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-sidebar-foreground/55">
                    Módulo
                  </p>
                  <p className="truncate text-sm font-bold leading-tight text-sidebar-accent-foreground">
                    {moduloAtivo.label}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end text-[10px] leading-tight">
                  <span className="font-semibold text-sidebar-foreground/70">
                    {nEntradas} {nEntradas === 1 ? "item" : "itens"}
                  </span>
                  {pendentes > 0 && (
                    <span
                      data-pendentes={pendentes}
                      className="font-bold text-[var(--sidebar-marca)]"
                    >
                      {pendentes} {pendentes === 1 ? "pendente" : "pendentes"}
                    </span>
                  )}
                </div>
              </div>
            )}

            <nav
              aria-label={moduloAtivo ? `Telas de ${moduloAtivo.label}` : "Telas"}
              className="flex-1 space-y-5 overflow-y-auto px-3 py-4"
            >
              {secoes.map((sec, n) => (
                <div key={sec.label ?? `secao-${n}`}>
                  {sec.label && (
                    <h3
                      data-subgrupo=""
                      className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-sidebar-foreground/55"
                    >
                      {sec.label}
                    </h3>
                  )}
                  <ul className="space-y-0.5">
                    {sec.entradas.map((e) => {
                      const ehAtiva = ativa(e);
                      const marcas: Record<string, string> = {
                        [`data-${e.marca}`]: e.marca === "item" ? e.url : e.link,
                      };
                      return (
                        <li key={e.url}>
                          <Dica texto={e.dica} lado="right" className="w-full">
                            <Link
                              to={e.link}
                              onClick={fecharNoCelular}
                              {...marcas}
                              data-active={ehAtiva}
                              aria-current={ehAtiva ? "page" : undefined}
                              className="group/item flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-[var(--sidebar-trilho)] data-[active=true]:font-bold data-[active=true]:text-[var(--sidebar-trilho-foreground)] md:h-9"
                            >
                              <e.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">{e.title}</span>
                              <SeloDaContagem
                                tipo={e.badge}
                                valor={e.badge ? contagens[e.badge] : undefined}
                              />
                            </Link>
                          </Dica>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="space-y-0.5 border-t border-sidebar-border p-3">
              <Link
                to="/configuracoes"
                onClick={fecharNoCelular}
                data-perfil=""
                data-active={estaNaRota(pathname, "/configuracoes")}
                className={cn(linhaDoRodape, "data-[active=true]:text-[var(--sidebar-marca)]")}
              >
                <UserRound className="h-4 w-4" aria-hidden="true" />
                <span>Meu perfil</span>
              </Link>
              {mostrarInstalar && (
                <button
                  type="button"
                  className={linhaDoRodape}
                  onClick={() => {
                    // Quem escuta é src/components/pwa/instalar-app.tsx; fecha o menu
                    // para o pedido de instalação não aparecer atrás do painel.
                    window.dispatchEvent(new CustomEvent("bexprint:instalar"));
                    fecharNoCelular();
                  }}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Instalar no celular</span>
                </button>
              )}
              <button type="button" className={linhaDoRodape} onClick={aoSair}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Sair</span>
              </button>
            </div>
          </div>
        </div>
      </Sidebar>

      <BuscaDeTelas
        paginas={paginasDaBusca}
        aberta={buscaAberta}
        aoMudar={setBuscaAberta}
        aoEscolher={escolherNaBusca}
      />
    </>
  );
}
