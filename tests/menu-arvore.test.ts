import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AREAS,
  FORA_DO_MENU,
  abasDaTela,
  atalhosDoCelular,
  linkDoTopo,
  menuDaPessoa,
  moduloDaRota,
  moduloPadrao,
  nomeDaTela,
  paginasDaBusca,
  podeAbrirRota,
  pontuarBusca,
  telasAchadas,
  telasDoItem,
  urlsDaArvore,
  type AreaVisivel,
} from "../src/lib/menu";
import {
  getRoutePermissions,
  permissions,
  rolePermissions,
  routePermissions,
} from "../src/lib/permissions";
import { CONTAGENS_DE_FORA, CONTAGENS_LIGADAS } from "../src/components/menu/contagens";
import vivo from "./fixtures/perfil-permissoes-2026-10-06.json";
import { menuAprovado, PESSOAS } from "./apoio/menu-aprovado";

/**
 * A árvore do menu por áreas (aprovada pelo dono em 05/10/2026) e as regras
 * que ela carrega. O desenho por pessoa está em menu-por-pessoa.test.ts.
 */

const RAIZ = path.resolve(__dirname, "..");

type Matriz = Record<string, readonly string[]>;
const reserva = rolePermissions as unknown as Matriz;
const banco = vivo as unknown as Matriz;

function daPessoa(papeis: string[], matriz: Matriz) {
  const tem = new Set(papeis.flatMap((p) => matriz[p] ?? []));
  const temPermissao = (p: string) => tem.has(p);
  const podeAbrir = (url: string) => podeAbrirRota(url, temPermissao);
  return { temPermissao, podeAbrir, areas: menuDaPessoa(podeAbrir, temPermissao) };
}

const temCatalogo = (papeis: string[], matriz: Matriz) =>
  papeis.some((p) => (matriz[p] ?? []).includes("catalogo.read"));

/** O resumo no mesmo formato do script da proposta (arvore-nova.mjs). */
function resumo(areas: AreaVisivel[], podeAbrir: (url: string) => boolean) {
  return {
    areas: areas.map((a) => a.label),
    rotina: areas.filter((a) => a.daRotina).map((a) => a.label),
    itens: areas.reduce((n, a) => n + a.nItens, 0) + (linkDoTopo(podeAbrir) ? 1 : 0),
    abas: areas.reduce(
      (n, a) =>
        n +
        a.subgrupos.reduce((m, s) => m + s.itens.reduce((k, i) => k + i.telas.length - 1, 0), 0),
      0,
    ),
    atalhos: ["Início", ...atalhosDoCelular(areas).map((i) => i.title)],
    arvore: areas.map((a) => ({
      area: a.label,
      rotina: a.daRotina,
      subs: a.subgrupos.map((s) => ({
        sub: s.label ?? "(sem subgrupo)",
        itens: s.itens.map((i) => {
          const n = i.telas.length - 1;
          return (
            i.title +
            (n ? ` (+${n} aba${n > 1 ? "s" : ""})` : "") +
            (i.link !== i.url ? ` [abre em ${i.link}]` : "")
          );
        }),
      })),
    })),
  };
}

function rotasEmDisco(): string[] {
  const dir = path.join(RAIZ, "src/routes/_authenticated");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && f !== "route.tsx")
    .map((f) =>
      f
        .replace(/\.tsx$/, "")
        .replace(/\.index$/, "")
        .split(".")
        .map((parte) => (parte.startsWith("$") ? "123" : parte))
        .join("/"),
    )
    .map((r) => `/${r}`);
}

describe("a árvore cobre o mapa de rotas, e o mapa cobre a árvore", () => {
  // Rota sem lugar no menu é tela que ninguém acha; item sem porta no mapa é
  // link para "Acesso restrito" (o guarda é deny-by-default).
  it("toda rota do mapa é item, aba ou está fora do menu com motivo", () => {
    const naArvore = new Set(urlsDaArvore());
    const semLugar = routePermissions
      .map((r) => r.path)
      .filter((p) => !naArvore.has(p) && !(p in FORA_DO_MENU));
    expect(semLugar).toEqual([]);
  });

  it("toda URL da árvore tem porta no mapa", () => {
    expect(urlsDaArvore().filter((u) => getRoutePermissions(u) === null)).toEqual([]);
  });

  it("a lista de fora do menu só fala de rota que existe no mapa, e cada uma tem motivo", () => {
    const doMapa = new Set(routePermissions.map((r) => r.path));
    for (const [url, { titulo, motivo }] of Object.entries(FORA_DO_MENU)) {
      expect(doMapa.has(url), `${url} não está no mapa de rotas`).toBe(true);
      expect(titulo.length, url).toBeGreaterThan(0);
      expect(motivo.length, url).toBeGreaterThan(10);
      expect(urlsDaArvore(), `${url} está fora do menu E na árvore`).not.toContain(url);
    }
  });

  it("nenhuma URL aparece duas vezes na árvore", () => {
    const urls = urlsDaArvore();
    expect(urls.filter((u, i) => urls.indexOf(u) !== i)).toEqual([]);
  });

  it("as permissões de rotina de cada área existem no catálogo", () => {
    const catalogo = new Set<string>(permissions);
    expect(AREAS.flatMap((a) => a.rotina).filter((p) => !catalogo.has(p))).toEqual([]);
  });

  it("as quatro áreas, nesta ordem, e a primeira se chama Vendas (decisão do dono)", () => {
    expect(AREAS.map((a) => a.label)).toEqual([
      "Vendas",
      "Produção",
      "Financeiro",
      "Administração",
    ]);
  });

  it("Catálogo de brindes fica em Vendas › Orçamentos, logo depois de Aprovações do cliente", () => {
    const orcamentos = AREAS[0].subgrupos.find((s) => s.label === "Orçamentos");
    expect(orcamentos?.itens.map((i) => i.url)).toEqual([
      "/orcamentos",
      "/aprovacoes",
      "/catalogos",
    ]);
    // Aparece para quem tem catalogo.read — no banco de 06/10, todo mundo menos o operador.
    for (const [papel, ve] of [
      ["admin", true],
      ["gestor", true],
      ["financeiro", true],
      ["vendedor", true],
      ["operador", false],
    ] as const) {
      const urls = daPessoa([papel], banco).areas.flatMap((a) =>
        a.subgrupos.flatMap((s) => s.itens.map((i) => i.url)),
      );
      expect(urls.includes("/catalogos"), papel).toBe(ve);
    }
  });
});

describe("as portas que o dono apertou em 06/10/2026", () => {
  const abre = (papel: string, url: string, matriz: Matriz) =>
    podeAbrirRota(url, (p) => (matriz[papel] ?? []).includes(p));

  for (const [nome, matriz] of [
    ["reserva do código", reserva],
    ["banco em 06/10", banco],
  ] as const) {
    it(`metragem, pós-venda e avisos: admin, gestor, financeiro e vendedor continuam; o operador sai (${nome})`, () => {
      for (const url of ["/metragem", "/pos-venda", "/avisos"]) {
        for (const papel of ["admin", "gestor", "financeiro", "vendedor"]) {
          expect(abre(papel, url, matriz), `${papel} ${url}`).toBe(true);
        }
        // Os outros papéis de oficina também saem; ninguém os tem hoje.
        for (const papel of ["operador", "designer", "estoque", "instalador"]) {
          expect(abre(papel, url, matriz), `${papel} ${url}`).toBe(false);
        }
      }
    });

    it(`casos de uso e mapa do sistema: só o admin (${nome})`, () => {
      for (const url of ["/casos-de-uso", "/mapa-sistema"]) {
        const quem = Object.keys(matriz)
          .filter((papel) => !papel.startsWith("_"))
          .filter((papel) => abre(papel, url, matriz));
        expect(quem, url).toEqual(["admin"]);
      }
    });

    it(`o histórico de alterações abre para o gestor e aparece no menu dele (${nome})`, () => {
      expect(abre("gestor", "/logs", matriz)).toBe(true);
      const { areas } = daPessoa(["gestor"], matriz);
      const adm = areas.find((a) => a.id === "administracao");
      expect(adm?.subgrupos.flatMap((s) => s.itens.map((i) => i.title))).toContain(
        "Histórico de alterações",
      );
    });
  }

  it("configuracoes.manage não serve mais de porta só do admin: o gestor a recebeu em 06/10", () => {
    // Por isso as páginas técnicas usam usuarios.manage. Se o gestor perder
    // configuracoes.manage, nada aqui muda; se ganhar usuarios.manage, o teste
    // de cima acusa que as páginas técnicas deixaram de ser só do admin.
    expect(banco.gestor).toContain("configuracoes.manage");
    expect(banco.gestor).not.toContain("usuarios.manage");
    expect(getRoutePermissions("/casos-de-uso")).toEqual(["usuarios.manage"]);
    expect(getRoutePermissions("/mapa-sistema")).toEqual(["usuarios.manage"]);
  });
});

describe("cada pessoa vê o que o dono aprovou (cenário B, calculado pelo script da proposta)", () => {
  for (const [nome, papeis] of Object.entries(PESSOAS)) {
    it(`${nome} — com a reserva do código, que é a matriz de 05/10 (+ catálogo)`, () => {
      const { areas, podeAbrir } = daPessoa(papeis, reserva);
      const {
        areas: a,
        rotina,
        itens,
        abas,
        atalhos,
        arvore,
      } = menuAprovado(nome, temCatalogo(papeis, reserva));
      expect(resumo(areas, podeAbrir)).toEqual({ areas: a, rotina, itens, abas, atalhos, arvore });
    });
  }

  it("com o banco de 06/10, só o Yvens muda — pelas 26 permissões que o gestor ganhou naquele dia", () => {
    for (const [nome, papeis] of Object.entries(PESSOAS)) {
      const { areas, podeAbrir } = daPessoa(papeis, banco);
      const meu = resumo(areas, podeAbrir);
      const {
        areas: a,
        rotina,
        itens,
        abas,
        atalhos,
        arvore,
      } = menuAprovado(nome, temCatalogo(papeis, banco));
      if (nome !== "Yvens (gestor)") {
        expect(meu, nome).toEqual({ areas: a, rotina, itens, abas, atalhos, arvore });
        continue;
      }
      // configuracoes.manage: "Dados da empresa" aparece, e Administração vira
      // área de rotina. impressao3d.settings.manage: Filamentos, Impressoras e
      // Tarifas 3D entram como abas de Impressão 3D.
      expect(meu.itens).toBe(itens + 1);
      expect(meu.abas).toBe(abas + 3);
      expect(meu.rotina).toEqual(["Vendas", "Produção", "Administração"]);
      expect(meu.arvore.find((x) => x.area === "Administração")?.subs[0].itens).toEqual([
        "Dados da empresa",
        "TVs da oficina",
        "Histórico de alterações",
      ]);
      expect(meu.atalhos).toEqual(atalhos);
    }
  });
});

describe("o módulo do trilho", () => {
  it("a rota diz o módulo: Início, a área do item ou da aba; fora disso, nenhum", () => {
    expect(moduloDaRota("/dashboard")).toBe("inicio");
    expect(moduloDaRota("/")).toBe("inicio");
    expect(moduloDaRota("/os/123")).toBe("producao");
    expect(moduloDaRota("/whatsapp-monitor")).toBe("vendas");
    expect(moduloDaRota("/matriz-permissoes")).toBe("administracao");
    expect(moduloDaRota("/configuracoes")).toBeNull();
    expect(moduloDaRota("/portal-cliente")).toBeNull();
  });

  it("fora de módulo: o lembrado no aparelho, senão a área da rotina, senão o Início", () => {
    const padrao = (papeis: string[], lembrado: string | null) =>
      moduloPadrao(daPessoa(papeis, banco).areas, lembrado);
    expect(padrao(["operador"], null)).toBe("producao");
    expect(padrao(["financeiro"], null)).toBe("financeiro");
    expect(padrao(["gestor"], null)).toBe("vendas");
    expect(padrao(["admin"], "financeiro")).toBe("financeiro");
    // Lembrado que a pessoa não vê (perdeu a permissão): volta à rotina.
    expect(padrao(["operador"], "financeiro")).toBe("producao");
    expect(padrao(["operador"], "inicio")).toBe("inicio");
    expect(padrao(["cliente"], null)).toBe("inicio");
  });
});

describe("barra de abas do hub", () => {
  const de = (papeis: string[]) => daPessoa(papeis, banco).podeAbrir;

  it("o admin, no Monitor, vê as seis telas do WhatsApp com Monitor marcada", () => {
    const abas = abasDaTela("/whatsapp-monitor", de(["admin"]));
    expect(abas?.telas.map((t) => t.title)).toEqual([
      "WhatsApp",
      "Visão geral",
      "Fila humana",
      "Monitor",
      "Respostas rápidas",
      "Automações",
    ]);
    expect(abas?.ativa).toBe("/whatsapp-monitor");
  });

  it("o vendedor não vê a aba de Automações, que não abre para ele", () => {
    expect(abasDaTela("/whatsapp", de(["vendedor"]))?.telas.map((t) => t.url)).toEqual([
      "/whatsapp",
      "/whatsapp-visao-geral",
      "/whatsapp-fila-humana",
      "/whatsapp-monitor",
      "/respostas-rapidas",
    ]);
  });

  it("a tela principal aparece com o nome de aba quando o hub tem nome composto", () => {
    expect(abasDaTela("/manutencao", de(["operador"]))?.telas.map((t) => t.title)).toEqual([
      "Máquinas",
      "Manutenção",
    ]);
  });

  it("sem barra quando o hub tem uma tela só para a pessoa", () => {
    // A Cibele abre Materiais (custos.read) e não abre Entradas e saídas.
    expect(abasDaTela("/materiais", de(["financeiro"]))).toBeNull();
  });

  it("sem barra fora de hub, e sem barra em tela que a pessoa não abre", () => {
    expect(abasDaTela("/orcamentos", de(["admin"]))).toBeNull();
    expect(abasDaTela("/dashboard", de(["admin"]))).toBeNull();
    expect(abasDaTela("/automacoes", de(["vendedor"]))).toBeNull();
  });
});

describe("o nome da tela no cabeçalho vem da árvore, nunca da URL", () => {
  it("cada item e cada aba mostram o próprio nome", () => {
    for (const area of AREAS) {
      for (const sub of area.subgrupos) {
        for (const i of sub.itens) {
          expect(nomeDaTela(i.url)).toBe(i.title);
          for (const a of i.abas) expect(nomeDaTela(a.url)).toBe(a.title);
        }
      }
    }
  });

  it("os casos que o celular mostrava pela URL", () => {
    expect(nomeDaTela("/breakdown-3d")).toBe("Custo por peça");
    expect(nomeDaTela("/a-receber")).toBe("Contas a receber");
    expect(nomeDaTela("/onde-para")).toBe("Trabalho parado");
    expect(nomeDaTela("/whatsapp-monitor")).toBe("Monitor");
  });

  it("toda rota em disco tem nome na árvore ou na lista de fora do menu", () => {
    // "Bex Print" é o que sobra quando a rota não está em lugar nenhum.
    for (const rota of rotasEmDisco()) expect(nomeDaTela(rota), rota).not.toBe("Bex Print");
    expect(nomeDaTela("/os/123")).toBe("Ordens de serviço");
    expect(nomeDaTela("/orcamento-3d/123")).toBe("Orçamento 3D");
    expect(nomeDaTela("/dashboard/")).toBe("Início");
    expect(nomeDaTela("/configuracoes")).toBe("Meu perfil");
  });
});

describe("atalhos do celular", () => {
  it("Início mais as telas de trabalho da rotina, até três", () => {
    const atalhos = (papeis: string[]) =>
      atalhosDoCelular(daPessoa(papeis, banco).areas).map((i) => i.link);
    expect(atalhos(["operador"])).toEqual(["/kanban", "/os", "/maquinas-agenda"]);
    expect(atalhos(["financeiro"])).toEqual(["/a-receber", "/fluxo-caixa", "/relatorios"]);
    expect(atalhos(["vendedor", "operador"])).toEqual(["/orcamentos", "/kanban", "/whatsapp"]);
    expect(atalhos(["admin"])).toEqual(["/orcamentos", "/kanban", "/a-receber"]);
  });

  it("cada atalho tem nome curto que cabe no botão", () => {
    for (const area of AREAS) {
      for (const i of area.subgrupos.flatMap((s) => s.itens)) {
        if (i.atalho === undefined) continue;
        expect((i.curto ?? i.title).length, i.title).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe("busca de telas (Ctrl+K)", () => {
  it("lista exatamente as telas que a pessoa abre: topo, itens, abas, perfil e novo orçamento 3D", () => {
    for (const papeis of Object.values(PESSOAS)) {
      const { areas, podeAbrir } = daPessoa(papeis, banco);
      const urls = paginasDaBusca(areas, podeAbrir).map((p) => p.url);
      expect(
        urls.filter((u, i) => urls.indexOf(u) !== i),
        papeis.join("+"),
      ).toEqual([]);
      for (const u of urls) expect(podeAbrir(u), `${papeis} ${u}`).toBe(true);
      const daArvore = areas.flatMap((a) =>
        a.subgrupos.flatMap((s) => s.itens.flatMap((i) => i.telas.map((t) => t.url))),
      );
      expect(urls).toEqual(expect.arrayContaining([...daArvore, "/dashboard", "/configuracoes"]));
    }
  });

  it("o operador não acha na busca o que o menu dele não tem", () => {
    const { areas, podeAbrir } = daPessoa(["operador"], banco);
    const urls = paginasDaBusca(areas, podeAbrir).map((p) => p.url);
    for (const u of [
      "/avisos",
      "/metragem",
      "/pos-venda",
      "/a-receber",
      "/usuarios",
      "/casos-de-uso",
    ]) {
      expect(urls).not.toContain(u);
    }
  });

  it("acha sem acento, pelo nome antigo e pela URL", () => {
    const { areas, podeAbrir } = daPessoa(["admin"], banco);
    const paginas = paginasDaBusca(areas, podeAbrir);
    const achar = (texto: string) => telasAchadas(paginas, texto).map((p) => p.url);
    expect(achar("orcamento")[0]).toBe("/orcamentos");
    expect(achar("leads")).toContain("/leads");
    expect(achar("fluxo de caixa")[0]).toBe("/fluxo-caixa");
    expect(achar("monitor")).toContain("/whatsapp-monitor");
    expect(achar("logs")).toContain("/logs");
    expect(achar("breakdown")).toEqual(["/breakdown-3d"]);
    expect(achar("receber")[0]).toBe("/a-receber");
    expect(achar("xyzabc")).toEqual([]);
    // O título que começa pelo digitado vem antes do que só o contém, mesmo de
    // outro grupo: "orcamento" põe Orçamentos acima de Novo orçamento 3D.
    expect(achar("orcamento").slice(0, 2)).toEqual(["/orcamentos", "/orcamento-3d-novo"]);
    expect(pontuarBusca("", ["Qualquer"])).toBe(1);
  });
});

describe("contagens ao lado dos itens", () => {
  it("toda contagem da árvore está ligada ou fora com motivo — nenhuma esquecida", () => {
    const daArvore = new Set(
      AREAS.flatMap((a) => a.subgrupos.flatMap((s) => s.itens.map((i) => i.badge))).filter(Boolean),
    );
    const decididas = new Set<string>([...CONTAGENS_LIGADAS, ...Object.keys(CONTAGENS_DE_FORA)]);
    expect([...daArvore].sort()).toEqual([...decididas].sort());
    for (const motivo of Object.values(CONTAGENS_DE_FORA))
      expect(motivo.length).toBeGreaterThan(40);
  });

  it("as contagens ligadas não listam para contar no navegador (o PostgREST corta em 1.000)", () => {
    const src = fs.readFileSync(path.join(RAIZ, "src/components/menu/contagens.ts"), "utf8");
    // Toda leitura de tabela/view é contagem no banco: head: true.
    const leituras = src.match(/\.select\([^)]*\)/g) ?? [];
    expect(leituras.length).toBeGreaterThan(0);
    for (const l of leituras) expect(l).toContain('count: "exact", head: true');
    expect(src).not.toMatch(/\.length\b/);
  });

  it("a tela de cada contagem ligada abre para quem tem a permissão que a contagem pede no banco", () => {
    // vw_avisos_pendentes e vw_aprovacoes_orcamento pedem is_staff; a linha de
    // parcelas vencidas de pendencias_do_sistema() pede financeiro.read (ou custos.read).
    const itemDa = (badge: string) =>
      AREAS.flatMap((a) => a.subgrupos.flatMap((s) => s.itens)).find((i) => i.badge === badge)!;
    expect(itemDa("parcelasVencidas").url).toBe("/a-receber");
    expect(getRoutePermissions("/a-receber")).toEqual(["financeiro.read"]);
    expect(telasDoItem(itemDa("avisosPendentes")).map((t) => t.url)).toEqual(["/avisos"]);
    expect(telasDoItem(itemDa("pediuAjuste")).map((t) => t.url)).toEqual(["/aprovacoes"]);
  });
});
