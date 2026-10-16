import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A ABA ITENS DA OS, DESENHADA DE VERDADE (HTML do servidor), PARA QUEM PODE E
 * PARA QUEM NÃO PODE MEXER NOS ITENS.
 *
 * Desde 08/10/2026 (migração 20261008043700) só grava item de OS quem tem
 * kanban.move ou orcamentos.create — admin, gestor e vendedor. A tela tem de
 * acompanhar: quem não pode vê a lista, mas não o campo de incluir nem a
 * lixeira (antes via os botões e a regra recusava; o apagar nem avisava).
 *
 * Conferir isso "logado como operador" exige a senha de alguém. Este teste
 * prova a mesma coisa sem senha, elo por elo:
 *   1. a regra da tela usa as MESMAS chaves da regra do banco;
 *   2. pelos papéis, essas chaves só abrem para admin, gestor e vendedor
 *      (inclusive na reserva estática que vale quando o banco não responde);
 *   3. o componente, desenhado, some com incluir e apagar quando a resposta é
 *      "não pode" — e mostra os dois quando é "pode".
 * O elo que vem do banco (minhas_permissoes por pessoa) foi medido ao vivo em
 * 15/10/2026: Harison, Yvens e Leonardo recebem uma das duas chaves; Cibele
 * (financeiro) não; Sergio foi desativado e recebe zero.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("a renderização não fala com o banco");
    },
  },
}));

// A busca de produto abre um popover do Radix; aqui só importa SE aparece.
vi.mock("@/components/produto-autocomplete", () => ({
  ProdutoAutocomplete: () => createElement("div", { "data-teste": "busca-de-produto" }),
}));

import { ItensDaOS } from "../src/components/os/itens-da-os";
import { CHAVES_QUE_EDITAM_ITENS, podeEditarItensDaOS } from "../src/domain/os/itens";
import { SEM_PERMISSOES, temPermissao } from "../src/domain/acesso/permissoes-efetivas";
import { rolePermissions, type Permission } from "../src/lib/permissions";
import type { NivelDeVisao } from "../src/lib/supabase-financial-views";

const RAIZ = join(__dirname, "..");
const OS = "b2135c84-d66b-4434-9cba-a94b068b261e";
const ITENS = [
  { id: "i1", descricao: "Banner lona 440g 3x1", quantidade: 1, unidade: "un", valor_unitario: 180, valor_total: 180 },
  { id: "i2", descricao: "Adesivo vinil recorte", quantidade: 4, unidade: "m²", valor_unitario: 55, valor_total: 220 },
];

function desenhar(podeEditarItens: boolean, nivel: NivelDeVisao): string {
  const qc = new QueryClient();
  qc.setQueryData(["itens-os", OS, nivel], ITENS);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(ItensDaOS, {
        osId: OS,
        canSeeFinancials: nivel === "financeiro",
        canSeePrices: nivel !== "operacional",
        nivelDeVisao: nivel,
        podeEditarItens,
      }),
    ),
  );
}

const quantas = (html: string, re: RegExp) => html.match(new RegExp(re.source, "g"))?.length ?? 0;
const LIXEIRA = /lucide-trash2/;
const INCLUIR = /lucide-plus/;
const BUSCA = /data-teste="busca-de-produto"/;
const CAMPO = /<label/;

describe("elo 1: a tela usa as mesmas chaves da regra do banco", () => {
  it("CHAVES_QUE_EDITAM_ITENS é exatamente o que a regra 'itens_os permission all' confere", () => {
    const pasta = join(RAIZ, "supabase/migrations");
    const ultima = readdirSync(pasta)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(pasta, f), "utf8").replace(/--[^\n]*/g, ""))
      .flatMap((sql) => [...sql.matchAll(/CREATE\s+POLICY\s+"itens_os permission all"[\s\S]*?;/gi)].map((m) => m[0]))
      .at(-1);
    expect(ultima, "a regra de gravação de itens_os sumiu das migrações").toBeDefined();
    const chavesDoBanco = [...new Set([...(ultima ?? "").matchAll(/has_permission\([^,]+,\s*'([^']+)'\)/g)].map((m) => m[1]))];
    expect([...chavesDoBanco].sort()).toEqual([...CHAVES_QUE_EDITAM_ITENS].sort());
  });
});

describe("elo 2: quem tem essas chaves", () => {
  const pela = (papeis: string[], efetivas: Permission[] | null = null) =>
    podeEditarItensDaOS((p) =>
      temPermissao({ ...SEM_PERMISSOES, efetivas: efetivas ? new Set(efetivas) : null }, papeis, p),
    );

  it.each([
    ["admin", true],
    ["gestor", true],
    ["vendedor", true],
    ["financeiro", false],
    ["operador", false],
    ["designer", false],
    ["instalador", false],
    ["estoque", false],
  ])("pelo papel (reserva estática), %s → %s", (papel, esperado) => {
    expect(papel in rolePermissions).toBe(true);
    expect(pela([papel])).toBe(esperado);
  });

  it("papel somado abre se UM deles abre (Leonardo: vendedor+operador; Fernando: operador+estoque+designer+vendedor)", () => {
    expect(pela(["vendedor", "operador"])).toBe(true);
    expect(pela(["operador", "estoque", "designer", "vendedor"])).toBe(true);
  });

  it("vale o que o banco devolve (minhas_permissoes), não o papel: lista sem as chaves fecha", () => {
    // Pessoa desativada recebe lista vazia; exceção que TIRA a chave também.
    expect(pela(["vendedor"], [])).toBe(false);
    expect(pela(["vendedor"], ["orcamentos.read", "os.read"])).toBe(false);
    expect(pela(["operador"], ["orcamentos.create"])).toBe(true);
  });
});

describe("elo 3: a aba desenhada", () => {
  it.each(["operacional", "financeiro"] as const)(
    "quem NÃO pode (%s): vê os itens, sem campo de incluir, sem busca e sem lixeira",
    (nivel) => {
      const html = desenhar(false, nivel);
      expect(html).toContain("Banner lona 440g 3x1");
      expect(html).toContain("Adesivo vinil recorte");
      expect(html).not.toMatch(BUSCA);
      expect(html).not.toMatch(CAMPO);
      expect(html).not.toMatch(INCLUIR);
      expect(quantas(html, LIXEIRA)).toBe(0);
    },
  );

  it.each(["comercial", "financeiro"] as const)(
    "quem PODE (%s): vê os itens, a busca, o campo de incluir e uma lixeira por item",
    (nivel) => {
      const html = desenhar(true, nivel);
      expect(html).toContain("Banner lona 440g 3x1");
      expect(html).toMatch(BUSCA);
      expect(html).toMatch(CAMPO);
      expect(html).toMatch(INCLUIR);
      expect(quantas(html, LIXEIRA)).toBe(ITENS.length);
    },
  );

  it("o financeiro, que não mexe em item, continua vendo o valor de cada um", () => {
    const html = desenhar(false, "financeiro");
    expect(html).toContain("R$ 180.00");
    expect(html).toContain("R$ 220.00");
  });

  it("o operador não vê valor nenhum", () => {
    expect(desenhar(false, "operacional")).not.toContain("R$");
  });
});
