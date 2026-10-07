import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  BellRing,
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  CalendarClock,
  ChartColumn,
  ClipboardList,
  Cuboid,
  Factory,
  FileCheck2,
  FileText,
  Funnel,
  Handshake,
  HeartHandshake,
  History,
  Hourglass,
  House,
  Landmark,
  MessageCircle,
  Network,
  Package,
  Palette,
  Printer,
  ReceiptText,
  Repeat,
  Ruler,
  Settings,
  Sheet,
  ShoppingCart,
  SlidersHorizontal,
  SquareKanban,
  Store,
  Target,
  TrendingDown,
  Truck,
  Tv,
  UserCog,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { getRoutePermissions, type Permission } from "@/lib/permissions";

/**
 * A árvore do menu lateral, em um lugar só.
 *
 * Até 06/10/2026 o menu eram 54 itens soltos em 9 grupos, e a pessoa tinha de
 * saber em qual grupo cada tela morava ("Movimentações" em Catálogo & Estoque,
 * "Produção 3D" em Produção e "Produtividade 3D" em Comercial). A proposta que
 * o dono aprovou junta tudo em quatro áreas — Vendas, Produção, Financeiro e
 * Administração —, cada uma com subgrupos e itens.
 *
 * Um item pode ser um HUB: telas parentes atrás de uma entrada só (WhatsApp,
 * Fila humana, Monitor, Respostas rápidas, Automações). O hub aparece se a pessoa abre
 * QUALQUER uma das telas dele e leva à primeira que ela abre; dentro delas, a
 * barra de abas (`abasDaTela`) mostra as irmãs.
 *
 * Quem vê o quê: SÓ a permissão da rota (`routePermissions`). Nenhuma trava a
 * mais por grupo — quando havia, o grupo "Administração" só aparecia para o
 * admin e escondia do gestor o Histórico de alterações, que a rota dele abria.
 */

/** As contagens que um item pode mostrar ao lado do nome. */
export type ContagemDoMenu =
  | "avisosPendentes"
  | "pediuAjuste"
  | "osAtrasadas"
  | "artesAguardando"
  | "parcelasVencidas";

export type AbaDoMenu = {
  title: string;
  url: string;
  /** Nome no menu antigo: a busca acha quem procura do jeito de antes. */
  antes?: string;
};

export type ItemDoMenu = AbaDoMenu & {
  icon: LucideIcon;
  /** Telas parentes que moram atrás desta entrada; viram abas dentro dela. */
  abas: AbaDoMenu[];
  /**
   * Nome da tela principal quando ela aparece como aba. "Máquinas e
   * manutenção" é o hub; a aba dele é "Máquinas", ao lado de "Manutenção".
   */
  aba?: string;
  /** Ordem como atalho do celular dentro da área (1 = o primeiro). */
  atalho?: number;
  /** Nome no botão de atalho do celular, que tem uns 60 px de largura. */
  curto?: string;
  /** Contagem de pendências ao lado do nome. */
  badge?: ContagemDoMenu;
};

export type SubgrupoDoMenu = { label: string | null; itens: ItemDoMenu[] };

export type IdDaArea = "vendas" | "producao" | "financeiro" | "administracao";

export type AreaDoMenu = {
  id: IdDaArea;
  label: string;
  /** Nome que cabe embaixo do ícone no trilho do celular (uns 56 px). */
  curto?: string;
  icon: LucideIcon;
  /**
   * Permissões de TRABALHO da área. Quem tem alguma delas tem esta área como
   * rotina, e ela abre sozinha no menu (ver `areasAbertasDeInicio`).
   */
  rotina: Permission[];
  subgrupos: SubgrupoDoMenu[];
};

const item = (
  title: string,
  url: string,
  icon: LucideIcon,
  abas: AbaDoMenu[] = [],
  extra: Partial<Pick<ItemDoMenu, "aba" | "atalho" | "curto" | "badge" | "antes">> = {},
): ItemDoMenu => ({ title, url, icon, abas, ...extra });

const aba = (title: string, url: string, antes?: string): AbaDoMenu =>
  antes ? { title, url, antes } : { title, url };

export const AREAS: AreaDoMenu[] = [
  {
    id: "vendas",
    label: "Vendas",
    icon: Store,
    rotina: ["orcamentos.create", "whatsapp.reply", "clientes.create", "leads.create"],
    subgrupos: [
      {
        label: "Atendimento",
        itens: [
          item(
            "WhatsApp",
            "/whatsapp",
            MessageCircle,
            [
              aba("Fila humana", "/whatsapp-fila-humana"),
              aba("Monitor", "/whatsapp-monitor", "Enviados"),
              aba("Respostas rápidas", "/respostas-rapidas"),
              aba("Automações", "/automacoes"),
            ],
            { atalho: 2 },
          ),
          item("Avisos ao cliente", "/avisos", BellRing, [], { badge: "avisosPendentes" }),
        ],
      },
      {
        label: "Orçamentos",
        itens: [
          item("Orçamentos", "/orcamentos", FileText, [], { atalho: 1 }),
          item("Aprovações do cliente", "/aprovacoes", FileCheck2, [], {
            badge: "pediuAjuste",
            antes: "Aprovações",
          }),
          // Acrescentado pelo dono depois da proposta (06/10/2026): o catálogo
          // da LUGA é de onde sai o item de brinde que entra no orçamento.
          item("Catálogo de brindes", "/catalogos", BookOpen, [], {
            antes: "Catálogos de fornecedores",
          }),
        ],
      },
      {
        label: "Clientes",
        itens: [
          item("Clientes", "/clientes", Users),
          item("Funil de vendas", "/funil", Funnel, [aba("Contatos novos", "/leads", "Leads")], {
            antes: "Funil",
          }),
          item("Parceiros revendedores", "/parceiros", Handshake, [], { antes: "Parceiros" }),
          item("Pós-venda", "/pos-venda", HeartHandshake, [], { antes: "Pós-venda / NPS" }),
        ],
      },
      {
        label: "Números de venda",
        itens: [
          item("Meta do mês", "/meta", Target),
          item("Metragem por cliente", "/metragem", Ruler),
        ],
      },
    ],
  },
  {
    id: "producao",
    label: "Produção",
    icon: Factory,
    rotina: [
      "os.status.advance",
      "producao.start",
      "kanban.move",
      "agenda.operate",
      "estoque.entry",
    ],
    subgrupos: [
      {
        label: "Fila da oficina",
        itens: [
          item("Quadro de produção", "/kanban", SquareKanban, [], {
            atalho: 1,
            curto: "Quadro",
            badge: "osAtrasadas",
          }),
          item("Ordens de serviço", "/os", ClipboardList, [], { atalho: 2, curto: "OS" }),
          item("Trabalho parado", "/onde-para", Hourglass, [], { antes: "Onde o trabalho para" }),
        ],
      },
      {
        label: "Máquinas",
        itens: [
          item(
            "Agenda das máquinas",
            "/maquinas-agenda",
            CalendarClock,
            [
              aba("O que ainda cabe", "/capacidade", "Capacidade da oficina"),
              aba("Conflitos", "/conflitos-agenda", "Conflitos de agenda"),
            ],
            { atalho: 3, curto: "Agenda", aba: "Agenda", antes: "Agenda de máquinas" },
          ),
          item("Máquinas e manutenção", "/maquinas", Printer, [aba("Manutenção", "/manutencao")], {
            aba: "Máquinas",
            antes: "Máquinas",
          }),
        ],
      },
      {
        label: "Arte",
        itens: [
          item(
            "Artes para produzir",
            "/design",
            Palette,
            [aba("Todos os arquivos", "/arquivos", "Arquivos")],
            { badge: "artesAguardando", antes: "Design & Arte" },
          ),
        ],
      },
      {
        label: "Entrega e qualidade",
        itens: [
          item("Entregas e instalações", "/entregas", Truck, [], {
            antes: "Entregas & Instalações",
          }),
          item(
            "Perdas e ocorrências",
            "/perdas",
            TrendingDown,
            [aba("Ocorrências e retrabalho", "/ocorrencias", "Ocorrências")],
            { aba: "Perdas", antes: "Perdas & desperdício" },
          ),
        ],
      },
      {
        label: "Material e compras",
        itens: [
          item(
            "Materiais e estoque",
            "/materiais",
            Boxes,
            [aba("Entradas e saídas", "/movimentacoes", "Movimentações")],
            { aba: "Materiais", antes: "Materiais" },
          ),
          item("Compras", "/compras", ShoppingCart),
        ],
      },
      {
        label: "Impressão 3D",
        itens: [
          item(
            "Impressão 3D",
            "/impressao-3d",
            Cuboid,
            [
              aba("Fila de impressão 3D", "/producao-3d", "Produção 3D"),
              aba("Produtividade", "/produtividade-3d", "Produtividade 3D"),
              aba("Custo por peça", "/breakdown-3d", "Custo por peça 3D"),
              aba("Filamentos", "/filamentos-3d"),
              aba("Impressoras", "/impressoras-3d"),
              aba("Tarifas 3D", "/configuracoes-3d"),
            ],
            { aba: "Orçamentos 3D" },
          ),
        ],
      },
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    icon: Wallet,
    rotina: ["pagamentos.confirm", "pagamentos.create"],
    subgrupos: [
      {
        label: "Receber",
        itens: [
          item("Contas a receber", "/a-receber", ReceiptText, [], {
            atalho: 1,
            curto: "A receber",
            badge: "parcelasVencidas",
          }),
          item("Pagamentos e comissões", "/financeiro", BadgeDollarSign, [], {
            antes: "Financeiro",
          }),
        ],
      },
      {
        label: "Pagar e caixa",
        itens: [
          item("Caixa e contas a pagar", "/fluxo-caixa", Wallet, [], {
            atalho: 2,
            curto: "Caixa",
            antes: "Fluxo de caixa",
          }),
          item("Contas bancárias e extrato", "/contas-bancarias", Landmark, [], {
            antes: "Contas bancárias",
          }),
          item("Despesas fixas e contratos", "/compromissos", Repeat, [], {
            antes: "Compromissos",
          }),
        ],
      },
      {
        label: "Preço e custo",
        itens: [
          item("Produtos e serviços", "/produtos", Package, [], { antes: "Produtos" }),
          item("Planilha de custos", "/planilha-custos", Sheet, [
            aba("Mão de obra e encargos", "/custos-producao", "Custos de mão de obra"),
          ]),
          item("Simulador de preço", "/precificacao", SlidersHorizontal),
        ],
      },
      {
        label: "Resultado",
        itens: [item("Relatórios", "/relatorios", ChartColumn, [], { atalho: 3 })],
      },
    ],
  },
  {
    id: "administracao",
    label: "Administração",
    curto: "Admin",
    icon: Settings,
    rotina: ["usuarios.manage", "configuracoes.manage"],
    subgrupos: [
      {
        label: null,
        itens: [
          item(
            "Equipe e acessos",
            "/usuarios",
            UserCog,
            [aba("O que cada papel pode", "/matriz-permissoes", "Matriz de permissões")],
            { aba: "Equipe", antes: "Usuários" },
          ),
          item("Dados da empresa", "/configuracoes-empresa", Building2),
          item("TVs da oficina", "/telas", Tv),
          item("Histórico de alterações", "/logs", History, [], { antes: "Logs & Auditoria" }),
          item(
            "Como o sistema funciona",
            "/casos-de-uso",
            Network,
            [aba("Mapa", "/mapa-sistema", "Mapa do sistema")],
            { aba: "Casos de uso", antes: "Casos de uso" },
          ),
        ],
      },
    ],
  },
];

/**
 * Rotas do mapa que NÃO são item nem aba, cada uma com o motivo — e o nome
 * que o cabeçalho mostra quando a pessoa está nela.
 */
export const FORA_DO_MENU: Record<string, { titulo: string; motivo: string }> = {
  "/dashboard": {
    titulo: "Início",
    motivo: "é o Início: link fixo no topo do menu, fora das áreas",
  },
  "/configuracoes": {
    titulo: "Meu perfil",
    motivo: "Meu perfil: fica no rodapé do menu, no cartão da pessoa",
  },
  "/portal-cliente": {
    titulo: "Portal do cliente",
    motivo:
      "para a equipe é só uma explicação; o caminho real é Clientes › ficha › aba Portal. A rota segue aberta para o papel cliente, que entra por ela",
  },
  "/orcamento-3d-novo": {
    titulo: "Novo orçamento 3D",
    motivo: "é uma ação: o botão Novo orçamento 3D dentro de Impressão 3D",
  },
  "/orcamento-3d": {
    titulo: "Orçamento 3D",
    motivo: "detalhe de orçamento 3D, aberto pela lista de Impressão 3D",
  },
};

/** Abre a rota? Mesma regra do guarda do layout: fora do mapa, ninguém abre. */
export function podeAbrirRota(url: string, temPermissao: (p: Permission) => boolean): boolean {
  const exigidas = getRoutePermissions(url);
  // Lista vazia = qualquer conta com papel (o "Meu perfil" de cada um).
  return exigidas !== null && (exigidas.length === 0 || exigidas.some(temPermissao));
}

/** As telas de um item, na ordem da árvore: a principal primeiro, com o nome de aba. */
export function telasDoItem(i: ItemDoMenu): AbaDoMenu[] {
  return [{ title: i.aba ?? i.title, url: i.url }, ...i.abas];
}

export type ItemVisivel = ItemDoMenu & {
  /** Para onde o clique leva: a primeira tela do hub que a pessoa abre. */
  link: string;
  /** As telas do hub que a pessoa abre, na ordem da árvore. */
  telas: AbaDoMenu[];
};

export type SubgrupoVisivel = { label: string | null; itens: ItemVisivel[] };

export type AreaVisivel = Omit<AreaDoMenu, "subgrupos"> & {
  /** A pessoa tem alguma permissão de trabalho desta área. */
  daRotina: boolean;
  subgrupos: SubgrupoVisivel[];
  nItens: number;
};

/**
 * O menu de uma pessoa: só o que ela abre. Item sai se nenhuma das telas dele
 * abre; subgrupo e área saem quando ficam vazios.
 */
export function menuDaPessoa(
  podeAbrir: (url: string) => boolean,
  temPermissao: (p: Permission) => boolean,
): AreaVisivel[] {
  const areas: AreaVisivel[] = [];
  for (const area of AREAS) {
    const subgrupos: SubgrupoVisivel[] = [];
    for (const sub of area.subgrupos) {
      const itens: ItemVisivel[] = [];
      for (const i of sub.itens) {
        const telas = telasDoItem(i).filter((t) => podeAbrir(t.url));
        if (telas.length > 0) itens.push({ ...i, link: telas[0].url, telas });
      }
      if (itens.length > 0) subgrupos.push({ label: sub.label, itens });
    }
    const nItens = subgrupos.reduce((n, s) => n + s.itens.length, 0);
    if (nItens > 0) {
      areas.push({
        id: area.id,
        label: area.label,
        curto: area.curto,
        icon: area.icon,
        rotina: area.rotina,
        daRotina: area.rotina.some(temPermissao),
        subgrupos,
        nItens,
      });
    }
  }
  return areas;
}

/** Os módulos do trilho: o Início e as áreas. */
export type IdDoModulo = "inicio" | IdDaArea;

/** O módulo dono da rota: Início para o Início, a área do item ou da aba; nulo fora disso. */
export function moduloDaRota(pathname: string): IdDoModulo | null {
  const p = normalizar(pathname);
  if (p === "/" || estaNaRota(p, "/dashboard")) return "inicio";
  return itemDaRota(p)?.area.id ?? null;
}

/**
 * O módulo que o painel mostra quando a rota não é de módulo nenhum (Meu
 * perfil, portal): o que a pessoa escolheu por último neste aparelho; senão a
 * primeira área da rotina dela — a área do trabalho dela é a que abre
 * sozinha —; senão o Início.
 */
export function moduloPadrao(areas: AreaVisivel[], lembrado: string | null): IdDoModulo {
  if (lembrado === "inicio") return "inicio";
  const existe = areas.find((a) => a.id === lembrado);
  if (existe) return existe.id;
  return areas.find((a) => a.daRotina)?.id ?? "inicio";
}

/**
 * O subgrupo ganha título quando o módulo tem mais de um subgrupo: no painel
 * de um módulo só, os títulos são o que separa "Receber" de "Pagar e caixa".
 * Módulo de um subgrupo só (Administração) é lista corrida.
 */
export function mostraTituloDoSubgrupo(area: AreaVisivel, sub: SubgrupoVisivel): boolean {
  return sub.label !== null && area.subgrupos.length > 1;
}

/**
 * Atalhos do celular (além do Início): até três, vindos das áreas da rotina.
 * Primeiro o atalho nº 1 de cada área da rotina, na ordem das áreas; se sobrar
 * vaga, os seguintes de cada área.
 */
export function atalhosDoCelular(areas: AreaVisivel[]): ItemVisivel[] {
  const daRotina = areas.filter((a) => a.daRotina);
  const candidatos = (a: AreaVisivel) =>
    a.subgrupos
      .flatMap((s) => s.itens)
      .filter((i) => i.atalho !== undefined)
      .sort((x, y) => (x.atalho ?? 0) - (y.atalho ?? 0));
  const escolhidos: ItemVisivel[] = [];
  for (const a of daRotina) {
    const primeiro = candidatos(a).find((c) => !escolhidos.includes(c));
    if (primeiro && escolhidos.length < 3) escolhidos.push(primeiro);
  }
  for (const a of daRotina) {
    for (const c of candidatos(a)) {
      if (escolhidos.length < 3 && !escolhidos.includes(c)) escolhidos.push(c);
    }
  }
  return escolhidos;
}

/** "/os/123/" e "/os/123" são a mesma tela; "/" fica "/". */
function normalizar(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** A rota da tela é esta URL ou fica dentro dela (/os/123 está em /os). */
export function estaNaRota(pathname: string, url: string): boolean {
  const p = normalizar(pathname);
  return p === url || p.startsWith(`${url}/`);
}

/** O item da árvore dono da rota (pela tela principal ou por uma aba). */
export function itemDaRota(pathname: string): { area: AreaDoMenu; item: ItemDoMenu } | null {
  const p = normalizar(pathname);
  for (const area of AREAS) {
    for (const sub of area.subgrupos) {
      for (const i of sub.itens) {
        if (telasDoItem(i).some((t) => estaNaRota(p, t.url))) return { area, item: i };
      }
    }
  }
  return null;
}

/** A barra de abas da tela atual: só quando o hub tem 2 ou mais telas que a pessoa abre. */
export function abasDaTela(
  pathname: string,
  podeAbrir: (url: string) => boolean,
): { item: ItemDoMenu; telas: AbaDoMenu[]; ativa: string } | null {
  const dono = itemDaRota(pathname);
  if (!dono) return null;
  const telas = telasDoItem(dono.item).filter((t) => podeAbrir(t.url));
  if (telas.length < 2) return null;
  const p = normalizar(pathname);
  const ativa = telas.find((t) => estaNaRota(p, t.url))?.url;
  // Aba que a pessoa não abre não é marcada nem mostrada: o guarda já está
  // dizendo "Acesso restrito" no corpo da tela.
  if (!ativa) return null;
  return { item: dono.item, telas, ativa };
}

/**
 * O nome da tela no cabeçalho — sempre o da árvore, nunca o pedaço da URL
 * ("Breakdown-3d", "A-receber" era o que o celular mostrava). Detalhe herda o
 * nome da lista: /os/123 é "Ordens de serviço".
 */
export function nomeDaTela(pathname: string): string {
  const p = normalizar(pathname);
  if (p === "/") return "Início";
  const fora = Object.entries(FORA_DO_MENU).find(([url]) => estaNaRota(p, url));
  if (fora) return fora[1].titulo;
  const dono = itemDaRota(p);
  if (dono) {
    if (estaNaRota(p, dono.item.url)) return dono.item.title;
    return dono.item.abas.find((t) => estaNaRota(p, t.url))?.title ?? dono.item.title;
  }
  return "Bex Print";
}

/** Toda URL que a árvore usa (itens e abas), na ordem em que aparece. */
export function urlsDaArvore(): string[] {
  return AREAS.flatMap((a) =>
    a.subgrupos.flatMap((s) => s.itens.flatMap((i) => telasDoItem(i).map((t) => t.url))),
  );
}

/** O link fixo do topo: o Início, ou o portal para quem só tem o portal (papel cliente). */
export function linkDoTopo(
  podeAbrir: (url: string) => boolean,
): { title: string; url: string } | null {
  if (podeAbrir("/dashboard")) return { title: "Início", url: "/dashboard" };
  if (podeAbrir("/portal-cliente"))
    return { title: FORA_DO_MENU["/portal-cliente"].titulo, url: "/portal-cliente" };
  return null;
}

export type PaginaDaBusca = {
  titulo: string;
  url: string;
  icon: LucideIcon;
  /** Cabeçalho do grupo na busca: a área, ou "Geral". */
  grupo: string;
  /** O que aparece à direita: o subgrupo, ou o hub de quem a tela é aba. */
  onde: string;
  /** Tudo que casa com o que a pessoa digita, o título primeiro. */
  palavras: string[];
};

/**
 * Todas as telas que a pessoa abre, para a busca do Ctrl+K: o topo, cada item
 * e cada aba que ela abre, o perfil e o "Novo orçamento 3D". Cada uma leva o
 * nome antigo do menu como palavra de busca — quem decorou "Leads" ou "Fluxo
 * de caixa" acha a tela nova pelo nome velho.
 */
export function paginasDaBusca(
  areas: AreaVisivel[],
  podeAbrir: (url: string) => boolean,
): PaginaDaBusca[] {
  const slug = (url: string) => url.replace(/^\//, "").replaceAll("-", " ");
  const paginas: PaginaDaBusca[] = [];
  const topo = linkDoTopo(podeAbrir);
  if (topo) {
    paginas.push({
      titulo: topo.title,
      url: topo.url,
      icon: House,
      grupo: "Geral",
      onde: "",
      palavras: [topo.title, "painel", "dashboard", slug(topo.url)],
    });
  }
  for (const area of areas) {
    for (const sub of area.subgrupos) {
      for (const i of sub.itens) {
        for (const tela of i.telas) {
          const principal = tela.url === i.url;
          const titulo = principal ? i.title : tela.title;
          const antes = principal ? i.antes : i.abas.find((a) => a.url === tela.url)?.antes;
          const onde = principal ? (sub.label ?? area.label) : i.title;
          paginas.push({
            titulo,
            url: tela.url,
            icon: i.icon,
            grupo: area.label,
            onde,
            palavras: [titulo, onde, area.label, ...(antes ? [antes] : []), slug(tela.url)],
          });
        }
      }
    }
  }
  if (podeAbrir("/orcamento-3d-novo")) {
    paginas.push({
      titulo: FORA_DO_MENU["/orcamento-3d-novo"].titulo,
      url: "/orcamento-3d-novo",
      icon: Cuboid,
      grupo: "Geral",
      onde: "Impressão 3D",
      palavras: ["Novo orçamento 3D", "Impressão 3D", "calculadora 3D", slug("/orcamento-3d-novo")],
    });
  }
  if (podeAbrir("/configuracoes")) {
    paginas.push({
      titulo: FORA_DO_MENU["/configuracoes"].titulo,
      url: "/configuracoes",
      icon: UserRound,
      grupo: "Geral",
      onde: "",
      palavras: ["Meu perfil", "senha", "foto", "telefone", slug("/configuracoes")],
    });
  }
  return paginas;
}

/** Sem acento e em minúscula: "orcamento" acha "Orçamentos". */
function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Nota de uma tela para o que foi digitado. Todas as palavras digitadas
 * precisam aparecer em algum lugar; o título que começa pelo digitado vem
 * primeiro, depois o que tem tudo no título, depois o resto.
 */
export function pontuarBusca(digitado: string, palavras: string[] = []): number {
  const termos = semAcento(digitado).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return 1;
  const [titulo = "", ...resto] = palavras.map(semAcento);
  const tudo = [titulo, ...resto].join(" ");
  if (!termos.every((t) => tudo.includes(t))) return 0;
  if (titulo.startsWith(termos.join(" "))) return 1;
  if (termos.every((t) => titulo.includes(t))) return 0.8;
  return 0.5;
}

/** As telas que casam com o digitado, da melhor nota para a pior; empate fica na ordem do menu. */
export function telasAchadas(paginas: PaginaDaBusca[], digitado: string): PaginaDaBusca[] {
  return paginas
    .map((p) => ({ p, nota: pontuarBusca(digitado, p.palavras) }))
    .filter((x) => x.nota > 0)
    .sort((a, b) => b.nota - a.nota)
    .map((x) => x.p);
}
