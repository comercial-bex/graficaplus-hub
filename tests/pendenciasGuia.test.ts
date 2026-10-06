/**
 * Cada pendência precisa chegar a alguém que consiga resolvê-la.
 *
 * O organograma da gráfica (20/09/2026) acumula função: o gerente é de vendas
 * E produção, o financeiro é financeiro E administrativo, o impressor imprime,
 * acaba e entrega. Se um rótulo ficar sem papel que o atenda, a pendência
 * existe no banco e não aparece em painel nenhum — que foi exatamente o que
 * aconteceu no Bex Lite, com 598 itens invisíveis.
 */
import { describe, it, expect } from "vitest";
import {
  GUIA_PENDENCIAS,
  PAPEIS_DO_ROTULO,
  ROTULO_PAPEL,
  rotulosDoPapel,
  type PapelResolvedor,
} from "../src/lib/pendenciasGuia";
import { AREAS } from "../src/lib/menu";

describe("rotulosDoPapel", () => {
  it("o impressor vê a fila da oficina", () => {
    expect(rotulosDoPapel(["operador"])).toEqual(["producao"]);
  });

  it("o atendimento vê o que é da recepção", () => {
    expect(rotulosDoPapel(["vendedor"])).toEqual(["atendimento"]);
  });

  it("o gerente é de vendas E produção, então vê atendimento e gerência", () => {
    expect(rotulosDoPapel(["gestor"]).sort()).toEqual(["atendimento", "gestao"]);
  });

  it("o financeiro vê só o financeiro", () => {
    expect(rotulosDoPapel(["financeiro"])).toEqual(["financeiro"]);
  });

  it("o CEO vê tudo", () => {
    expect(rotulosDoPapel(["admin"]).sort()).toEqual([
      "atendimento",
      "financeiro",
      "gestao",
      "producao",
    ]);
  });

  it("quem acumula função soma os rótulos, sem repetir", () => {
    const r = rotulosDoPapel(["operador", "financeiro"]).sort();
    expect(r).toEqual(["financeiro", "producao"]);
  });

  it("papel sem pendência endereçada some do bloco, sem quebrar", () => {
    expect(rotulosDoPapel(["cliente"])).toEqual([]);
    expect(rotulosDoPapel(["parceiro"])).toEqual([]);
    expect(rotulosDoPapel([])).toEqual([]);
    expect(rotulosDoPapel(null)).toEqual([]);
  });
});

describe("nenhuma pendência fica sem quem a veja", () => {
  it("todo rótulo tem ao menos um papel que o atende", () => {
    const orfaos = (Object.keys(PAPEIS_DO_ROTULO) as PapelResolvedor[]).filter(
      (r) => PAPEIS_DO_ROTULO[r].length === 0,
    );
    expect(orfaos).toEqual([]);
  });

  it("todo rótulo tem nome legível na tela", () => {
    for (const r of Object.keys(PAPEIS_DO_ROTULO) as PapelResolvedor[]) {
      expect(ROTULO_PAPEL[r], `rótulo ${r} sem nome`).toBeTruthy();
    }
  });

  it("todo papel citado existe no enum app_role do banco", () => {
    // Papel escrito errado aqui não dá erro: o filtro simplesmente não casa e
    // o bloco nunca aparece para ninguém.
    const PAPEIS_REAIS = new Set([
      "admin", "gestor", "financeiro", "vendedor", "designer",
      "operador", "estoque", "instalador", "cliente", "parceiro",
    ]);
    const desconhecidos = Object.values(PAPEIS_DO_ROTULO)
      .flat()
      .filter((p) => !PAPEIS_REAIS.has(p));
    expect(desconhecidos, `papéis inexistentes: ${desconhecidos.join(", ")}`).toEqual([]);
  });

  it("todo passo do guia aponta um caminho, não um status cru", () => {
    for (const [chave, guia] of Object.entries(GUIA_PENDENCIAS)) {
      expect(guia.passos.length, `${chave} sem passos`).toBeGreaterThanOrEqual(2);
      expect(guia.passos.length, `${chave} com passos demais`).toBeLessThanOrEqual(4);
    }
  });
});

describe("o caminho do guia é o do menu de verdade", () => {
  // O guia diz "Abra Área › Item" com as palavras do menu. Quando o menu virou
  // áreas (06/10/2026), "Comercial › Orçamentos", "Cadastros › Produtos" e
  // "Estoque › Materiais" passaram a mandar a pessoa procurar um grupo que não
  // existe mais — e três deles já não existiam nem no menu antigo.
  it("todo 'Área › Item' do guia é uma área do menu seguida de um item dela", () => {
    const areas = new Map(
      AREAS.map((a) => [a.label, a.subgrupos.flatMap((s) => s.itens.map((i) => i.title))] as const),
    );
    const errados: string[] = [];
    for (const [chave, guia] of Object.entries(GUIA_PENDENCIAS)) {
      for (const passo of guia.passos) {
        for (const m of passo.matchAll(/(\S+) › /g)) {
          const itens = areas.get(m[1]);
          const resto = passo.slice((m.index ?? 0) + m[0].length);
          if (!itens || !itens.some((t) => resto.startsWith(t))) errados.push(`${chave}: ${passo}`);
        }
      }
    }
    expect(errados).toEqual([]);
  });
});
