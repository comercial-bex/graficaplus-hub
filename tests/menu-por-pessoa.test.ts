import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { rolePermissions } from "../src/lib/permissions";
import vivo from "./fixtures/perfil-permissoes-2026-10-06.json";
import { menuAprovado, PESSOAS } from "./apoio/menu-aprovado";

/**
 * O MENU DE CADA PESSOA REAL DA GRÁFICA, DESENHADO DE VERDADE.
 *
 * O menu lateral (trilho de módulos + painel) é renderizado (HTML do
 * servidor) com as permissões de cada pessoa e comparado com o que o dono
 * aprovou: o cenário B da proposta de 05/10/2026, calculado por outro
 * programa (o script da proposta) sobre a mesma matriz que `rolePermissions`
 * guarda como reserva.
 *
 * Duas fontes de permissão:
 *   - a reserva do código (rolePermissions), igual à matriz de 05/10;
 *   - o retrato do banco de 06/10/2026 22:39 (perfil_permissoes), que é o que
 *     o sistema usa de verdade — a Matriz de permissões muda o banco na hora.
 */

const estado = vi.hoisted(() => ({
  permissoes: new Set<string>(),
  pathname: "/dashboard",
}));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    children,
    onClick: _clique,
    ...resto
  }: {
    to: string;
    children?: ReactNode;
    onClick?: unknown;
  }) => createElement("a", { href: to, ...resto }, children),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: estado.pathname } }),
  useNavigate: () => () => undefined,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    // Sem id: a ficha (nome e foto) não é consultada; os testes a plantam no cache.
    user: { email: "pessoa@bexprint.com.br" },
    hasPermission: (p: string) => estado.permissoes.has(p),
    signOut: async () => undefined,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("o desenho do menu não consulta o banco: as contagens vêm do cache");
    },
    rpc: () => {
      throw new Error("o desenho do menu não consulta o banco: as contagens vêm do cache");
    },
  },
}));

import { AppSidebar } from "../src/components/app-sidebar";
import { AREAS } from "../src/lib/menu";
import { AbasDaTela } from "../src/components/menu/abas-da-tela";
import { iniciais, primeiroNome } from "../src/components/menu/perfil";
import { SidebarProvider } from "../src/components/ui/sidebar";

type Matriz = Record<string, readonly string[]>;
const reserva = rolePermissions as unknown as Matriz;
const banco = vivo as unknown as Matriz;

/** O aprovado (cenário B + catálogo) para a pessoa, conforme a matriz tenha ou não catalogo.read. */
const aprovado = (nome: string, matriz: Matriz) =>
  menuAprovado(
    nome,
    PESSOAS[nome].some((p) => (matriz[p] ?? []).includes("catalogo.read")),
  );

const ID_DA_AREA: Record<string, string> = {
  Vendas: "vendas",
  Produção: "producao",
  Financeiro: "financeiro",
  Administração: "administracao",
};

/** "WhatsApp (+3 abas)" e "X [abre em /y]" do script da proposta → nome e link. */
function itemDoCenario(texto: string): { titulo: string; link: string | null } {
  const link = /\[abre em ([^\]]+)\]/.exec(texto)?.[1] ?? null;
  const titulo = texto.replace(/ \[abre em [^\]]+\]/, "").replace(/ \(\+\d+ abas?\)/, "");
  return { titulo, link };
}

let cliente: QueryClient;

beforeEach(() => {
  cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
});

function desenhar(papeis: string[], matriz: Matriz, pathname = "/dashboard"): string {
  estado.permissoes = new Set(papeis.flatMap((p) => matriz[p] ?? []));
  estado.pathname = pathname;
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: cliente },
      createElement(SidebarProvider, null, createElement(AppSidebar)),
    ),
  );
}

type Lido = {
  /** Os módulos do trilho, na ordem, com o ativo e a soma de pendências do canto. */
  trilho: { id: string; ativo: boolean; soma: number | null }[];
  /** O módulo que o painel mostra. */
  painel: string | null;
  subgrupos: string[];
  itens: { titulo: string; href: string; selo: string | null }[];
  topo: string | null;
  atalhos: string[];
  perfil: boolean;
  ola: string | null;
  pendentes: number | null;
};

/** Lê do HTML o que a pessoa vê, pelos marcadores data-* do menu. */
function ler(html: string): Lido {
  return {
    trilho: [
      ...html.matchAll(/<button([^>]*\bdata-modulo="([a-z]+)"[^>]*)>([\s\S]*?)<\/button>/g),
    ].map(([, attrs, id, dentro]) => ({
      id,
      ativo: /data-active="true"/.test(attrs),
      soma: /data-soma="(\d+)"/.exec(dentro) ? Number(/data-soma="(\d+)"/.exec(dentro)![1]) : null,
    })),
    painel: /data-painel="([a-z]+)"/.exec(html)?.[1] ?? null,
    subgrupos: [...html.matchAll(/<h3 data-subgrupo=""[^>]*>([^<]*)<\/h3>/g)].map((x) => x[1]),
    itens: [...html.matchAll(/<a([^>]*\bdata-item="[^"]+"[^>]*)>([\s\S]*?)<\/a>/g)].map(
      ([, attrs, dentro]) => ({
        href: /href="([^"]+)"/.exec(attrs)![1],
        titulo: /<span class="min-w-0 flex-1 truncate">([^<]*)<\/span>/.exec(dentro)![1],
        selo: /data-selo="([^"]+)"/.exec(dentro)?.[1] ?? null,
      }),
    ),
    topo: /data-topo="([^"]+)"/.exec(html)?.[1] ?? null,
    atalhos: [...html.matchAll(/data-atalho="([^"]+)"/g)].map((m) => m[1]),
    perfil: html.includes('data-perfil=""'),
    ola:
      /<p data-ola=""[^>]*>([\s\S]*?)<\/p>/
        .exec(html)?.[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim() ?? null,
    pendentes: /data-pendentes="(\d+)"/.exec(html)
      ? Number(/data-pendentes="(\d+)"/.exec(html)![1])
      : null,
  };
}

/** Nome do item → URL da tela principal, para entrar numa área pelo menu. */
const URL_DO_ITEM: Record<string, string> = Object.fromEntries(
  AREAS.flatMap((a) => a.subgrupos.flatMap((s) => s.itens.map((i) => [i.title, i.url]))),
);

const URL_DO_ATALHO: Record<string, string> = {
  Orçamentos: "/orcamentos",
  WhatsApp: "/whatsapp",
  "Quadro de produção": "/kanban",
  "Ordens de serviço": "/os",
  "Agenda das máquinas": "/maquinas-agenda",
  "Contas a receber": "/a-receber",
  "Caixa e contas a pagar": "/fluxo-caixa",
  Relatórios: "/relatorios",
};

describe("cada pessoa, com a reserva do código: o menu desenhado é o cenário B que o dono aprovou", () => {
  for (const [nome, papeis] of Object.entries(PESSOAS)) {
    const esperado = aprovado(nome, reserva);

    it(`${nome}: o trilho tem o Início e as áreas dela; no Início, as telas da rotina`, () => {
      const l = ler(desenhar(papeis, reserva));
      expect(l.trilho.map((m) => m.id)).toEqual([
        "inicio",
        ...esperado.areas.map((a) => ID_DA_AREA[a]),
      ]);
      expect(l.trilho.find((m) => m.ativo)?.id).toBe("inicio");
      expect(l.painel).toBe("inicio");
      expect(l.topo).toBe("/dashboard");
      expect(l.perfil).toBe(true);
      // Os atalhos do cenário, menos o Início (que já é a Visão geral).
      expect(l.atalhos).toEqual(esperado.atalhos.slice(1).map((t) => URL_DO_ATALHO[t]));
      expect(l.itens).toEqual([]);
    });

    it(`${nome}: fora de módulo (Meu perfil), o painel abre na área da rotina dela`, () => {
      const l = ler(desenhar(papeis, reserva, "/configuracoes"));
      expect(l.painel).toBe(esperado.rotina.length ? ID_DA_AREA[esperado.rotina[0]] : "inicio");
    });

    it(`${nome}: cada área, no painel, mostra os subgrupos e os itens do cenário B na ordem`, () => {
      for (const area of esperado.arvore) {
        const doCenario = area.subs.flatMap((s) => s.itens.map(itemDoCenario));
        // Entrar numa tela da área põe a área no painel (a pessoa vê onde está).
        const primeira = doCenario[0].link ?? URL_DO_ITEM[doCenario[0].titulo];
        const l = ler(desenhar(papeis, reserva, primeira));
        const id = ID_DA_AREA[area.area];
        expect(l.painel, `${nome} › ${area.area}`).toBe(id);
        expect(l.trilho.find((m) => m.ativo)?.id, `${nome} › ${area.area}`).toBe(id);
        expect(
          l.itens.map((i) => i.titulo),
          `${nome} › ${area.area}`,
        ).toEqual(doCenario.map((i) => i.titulo));
        for (const [n, item] of doCenario.entries()) {
          if (item.link) expect(l.itens[n].href, item.titulo).toBe(item.link);
        }
        // Títulos de seção quando há mais de um subgrupo; lista corrida com um só.
        expect(l.subgrupos, `${nome} › ${area.area}`).toEqual(
          area.subs.length > 1 ? area.subs.map((s) => s.sub) : [],
        );
      }
    });
  }
});

describe("cada pessoa, com o banco de 06/10/2026 (o que o sistema usa hoje)", () => {
  for (const [nome, papeis] of Object.entries(PESSOAS)) {
    it(`${nome}: os mesmos módulos e atalhos do cenário`, () => {
      const esperado = aprovado(nome, banco);
      const l = ler(desenhar(papeis, banco));
      expect(l.trilho.map((m) => m.id)).toEqual([
        "inicio",
        ...esperado.areas.map((a) => ID_DA_AREA[a]),
      ]);
      expect(l.atalhos).toEqual(esperado.atalhos.slice(1).map((t) => URL_DO_ATALHO[t]));
    });
  }

  it("Yvens vê Dados da empresa e o Histórico de alterações, e não vê as páginas técnicas", () => {
    const l = ler(desenhar(["gestor"], banco, "/logs"));
    expect(l.painel).toBe("administracao");
    expect(l.itens.map((i) => i.titulo)).toEqual([
      "Dados da empresa",
      "TVs da oficina",
      "Histórico de alterações",
    ]);
    expect(l.subgrupos).toEqual([]);
  });

  it("Sergio só tem Início e Produção no trilho — sem Avisos, Metragem e Pós-venda", () => {
    const l = ler(desenhar(["operador"], banco, "/kanban"));
    expect(l.trilho.map((m) => m.id)).toEqual(["inicio", "producao"]);
    for (const u of ["/avisos", "/metragem", "/pos-venda"]) {
      expect(l.itens.map((i) => i.href)).not.toContain(u);
    }
  });

  it("Cibele, em Contas a receber: o painel do Financeiro com as três seções", () => {
    const l = ler(desenhar(["financeiro"], banco, "/a-receber"));
    expect(l.trilho.map((m) => [m.id, m.ativo])).toEqual([
      ["inicio", false],
      ["vendas", false],
      ["producao", false],
      ["financeiro", true],
    ]);
    expect(l.subgrupos).toEqual(["Receber", "Pagar e caixa", "Preço e custo", "Resultado"]);
  });
});

describe("o cabeçalho do painel", () => {
  it("a logo para fundo escuro, do repositório, e nunca a de fundo claro", () => {
    const html = desenhar(["operador"], banco);
    const img = /<img[^>]*alt="Bex Print"[^>]*>/.exec(html)?.[0] ?? "";
    expect(img).toContain('src="/marca/bex-print-fundo-escuro.png"');
    expect(img).toContain("w-36");
    expect(html).not.toContain("bex-print-fundo-claro");
    expect(html).not.toContain("__l5e/assets-v1");
  });

  it("a foto da pessoa (ou as iniciais), o ponto de conectado e o 'Olá, {nome}'", () => {
    cliente.setQueryData(["meu-perfil", null], {
      id: "x",
      nome: "Sergio Costa da Cruz",
      email: "sergio@bexprint.com.br",
      telefone: null,
      avatar_url: null,
    });
    const html = desenhar(["operador"], banco);
    const l = ler(html);
    expect(l.ola).toBe("Olá, Sergio");
    expect(html).toContain("sergio@bexprint.com.br");
    expect(html).toContain('aria-label="Conectado"');
    // Sem foto gravada, as iniciais no lugar — nunca uma imagem quebrada.
    expect(html).toContain(">SC<");
  });

  it("sem ficha carregada, o nome vem do e-mail e as iniciais também", () => {
    const l = ler(desenhar(["operador"], banco));
    expect(l.ola).toBe("Olá, Pessoa");
    expect(primeiroNome("Leonardo Pimentel de Almeida", null)).toBe("Leonardo");
    expect(primeiroNome(null, "cibele@bexprint.com.br")).toBe("Cibele");
    expect(iniciais("Leonardo Pimentel de Almeida", null)).toBe("LA");
    expect(iniciais("Harison", null)).toBe("HA");
    expect(iniciais(null, "yvens@bexprint.com.br")).toBe("YV");
  });

  it("o cartão do módulo conta as entradas do painel", () => {
    const html = desenhar(["financeiro"], banco, "/a-receber");
    expect(html).toMatch(/>9 itens</);
    const inicio = desenhar(["operador"], banco);
    expect(inicio).toMatch(/>4 itens</); // Início + 3 atalhos
  });
});

describe("contagens no menu", () => {
  function plantar() {
    cliente.setQueryData(["avisos-pendentes", "contagem-do-menu"], 3);
    cliente.setQueryData(["vw-aprovacoes-orcamento", "contagem-do-menu"], 1);
    cliente.setQueryData(
      ["pendencias-do-sistema"],
      [
        {
          chave: "parcela_vencida_sem_baixa",
          titulo: "",
          quantidade: 2,
          total: 2,
          severidade: "critico",
          quem_resolve: "financeiro",
          o_que_fazer: "",
          link: "/a-receber",
        },
      ],
    );
  }

  it("Cibele: o número ao lado de Contas a receber, no cartão do módulo e a soma de Vendas no trilho", () => {
    plantar();
    const l = ler(desenhar(["financeiro"], banco, "/a-receber"));
    expect(l.itens.find((i) => i.href === "/a-receber")?.selo).toBe("2");
    expect(l.pendentes).toBe(2);
    // Vendas não está no painel: 3 avisos + 1 pedido de ajuste não somem de vista.
    expect(l.trilho.find((m) => m.id === "vendas")?.soma).toBe(4);
    expect(l.trilho.find((m) => m.id === "financeiro")?.soma).toBeNull();
  });

  it("Leonardo: avisos e ajustes ao lado dos itens; parcelas vencidas não, porque ele não abre a tela", () => {
    plantar();
    const l = ler(desenhar(["vendedor", "operador"], banco, "/orcamentos"));
    expect(l.itens.find((i) => i.href === "/avisos")?.selo).toBe("3");
    expect(l.itens.find((i) => i.href === "/aprovacoes")?.selo).toBe("1");
    expect(l.pendentes).toBe(4);
    expect(l.trilho.map((m) => m.soma)).toEqual([null, null, null]);
  });

  it("Sergio não vê número nenhum: nenhum item com contagem chega ao menu dele", () => {
    plantar();
    const l = ler(desenhar(["operador"], banco, "/kanban"));
    expect(l.itens.map((i) => i.selo).filter(Boolean)).toEqual([]);
    expect(l.trilho.map((m) => m.soma)).toEqual([null, null]);
    expect(l.pendentes).toBeNull();
  });

  it("contagem que falhou aparece como '?', nunca como zero", () => {
    const erro = new Error("canceling statement due to statement timeout");
    cliente.getQueryCache().build(
      cliente,
      { queryKey: ["avisos-pendentes", "contagem-do-menu"] },
      {
        data: undefined,
        dataUpdateCount: 0,
        dataUpdatedAt: 0,
        error: erro,
        errorUpdateCount: 1,
        errorUpdatedAt: Date.now(),
        fetchFailureCount: 1,
        fetchFailureReason: erro,
        fetchMeta: null,
        isInvalidated: false,
        status: "error",
        fetchStatus: "idle",
      },
    );
    const l = ler(desenhar(["vendedor"], banco, "/whatsapp"));
    expect(l.itens.find((i) => i.href === "/avisos")?.selo).toBe("erro");
  });
});

describe("a barra de abas do hub, desenhada", () => {
  it("o admin em Enviados vê as quatro telas do WhatsApp, com Enviados marcada", () => {
    estado.permissoes = new Set(banco.admin);
    estado.pathname = "/whatsapp-monitor";
    const html = renderToStaticMarkup(createElement(AbasDaTela));
    expect([...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "/whatsapp",
      "/whatsapp-monitor",
      "/respostas-rapidas",
      "/automacoes",
    ]);
    expect(/<a[^>]*aria-current="page"[^>]*>([^<]*)</.exec(html)?.[1]).toBe("Enviados");
  });

  it("o Sergio em Ordens de serviço não vê barra nenhuma (não é hub)", () => {
    estado.permissoes = new Set(banco.operador);
    estado.pathname = "/os";
    expect(renderToStaticMarkup(createElement(AbasDaTela))).toBe("");
  });

  it("fica uma vez só, no layout, logo acima da tela — e o título do cabeçalho vem da árvore", () => {
    const layout = fs.readFileSync(
      path.resolve(__dirname, "../src/routes/_authenticated/route.tsx"),
      "utf8",
    );
    expect(layout).toMatch(/<AbasDaTela \/>\s*<Outlet \/>/);
    expect(layout).toContain('import { nomeDaTela } from "@/lib/menu"');
    expect(layout).not.toContain("NOMES_DE_TELA");
  });
});
