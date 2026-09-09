import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  getRoutePermissions,
  permissions,
  rolePermissions,
  routePermissions,
} from "../src/lib/permissions";

const RAIZ = path.resolve(__dirname, "..");

function rotasEmDisco() {
  const dir = path.join(RAIZ, "src/routes/_authenticated");
  const nomes = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && f !== "route.tsx")
    // "os.$id.tsx" e "os.index.tsx" são a mesma rota-pai "/os"; "$" é parâmetro
    .map((f) => f.replace(/\.tsx$/, ""))
    .filter((n) => !n.includes("$"))
    .map((n) => "/" + n.replace(/\.index$/, "").split(".")[0]);
  return [...new Set(nomes)];
}

function urlsDoMenu() {
  const src = fs.readFileSync(path.join(RAIZ, "src/components/app-sidebar.tsx"), "utf8");
  return [...src.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("mapa de rotas", () => {
  // Este é o teste que faltava: o guarda é deny-by-default, então rota sem
  // entrada no mapa fica inacessível para todo mundo, inclusive admin. Quatro
  // rotas estavam nesse estado e duas delas apareciam no menu.
  it("toda rota em disco tem permissão declarada", () => {
    const orfas = rotasEmDisco().filter((r) => getRoutePermissions(r) === null);
    expect(orfas).toEqual([]);
  });

  it("todo item do menu aponta para uma rota mapeada", () => {
    const orfas = urlsDoMenu().filter((u) => getRoutePermissions(u) === null);
    expect(orfas).toEqual([]);
  });

  it("só usa permissões que existem no catálogo", () => {
    const catalogo = new Set<string>(permissions);
    const desconhecidas = routePermissions.flatMap(({ path: p, permissions: reqs }) =>
      reqs.filter((r) => !catalogo.has(r)).map((r) => `${p} → ${r}`),
    );
    expect(desconhecidas).toEqual([]);
  });

  it("casa o prefixo mais específico primeiro", () => {
    expect(getRoutePermissions("/configuracoes-empresa")).toEqual(["configuracoes.manage"]);
    expect(getRoutePermissions("/os/123")).toEqual(["os.read"]);
    expect(getRoutePermissions("/rota-que-nao-existe")).toBeNull();
  });
});

describe("papéis", () => {
  it("nenhum papel recebe permissão fora do catálogo", () => {
    const catalogo = new Set<string>(permissions);
    const fora = Object.entries(rolePermissions).flatMap(([papel, lista]) =>
      lista.filter((p) => !catalogo.has(p)).map((p) => `${papel} → ${p}`),
    );
    expect(fora).toEqual([]);
  });

  // O papel cliente tinha 'clientes.read', a mesma permissão que abre o CRM interno,
  // e a policy de `clientes` não era escopada — um usuário de portal lia a carteira
  // inteira da gráfica. O portal passou a ter chave própria; este teste impede a volta.
  it("o papel cliente só alcança o portal", () => {
    const doCliente = rolePermissions.cliente as readonly string[];
    const alcanca = routePermissions
      .filter(({ permissions: reqs }) => reqs.some((p) => doCliente.includes(p)))
      .map((r) => r.path);
    expect(alcanca).toEqual(["/portal-cliente"]);
  });

  it("cada papel operacional abre pelo menos a tela do próprio trabalho", () => {
    const esperado: Record<string, string> = {
      designer: "/arquivos",
      operador: "/kanban",
      estoque: "/movimentacoes",
      instalador: "/entregas",
      financeiro: "/financeiro",
      vendedor: "/orcamentos",
    };
    const cegos = Object.entries(esperado).filter(([papel, rota]) => {
      const exigidas = getRoutePermissions(rota);
      const doPapel = rolePermissions[papel as keyof typeof rolePermissions] as readonly string[];
      return !exigidas?.some((p) => doPapel.includes(p));
    });
    expect(cegos).toEqual([]);
  });
});
