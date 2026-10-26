import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  precoPorUnidadeDoMaterial,
  precosPagosPorMaterial,
  resumoDasCompras,
  situacaoDoDocumento,
  formatarPrecoDaUnidade,
  type CompraNoFornecedor,
  type Finalidade,
  type ItemDaCompra,
  type MaterialDoCadastro,
  type TipoDoDocumento,
} from "../src/domain/fornecedores/compras";
import { getRoutePermissions, rolePermissions } from "../src/lib/permissions";
import { AREAS, urlsDaArvore } from "../src/lib/menu";

/**
 * FORNECEDORES NO FINANCEIRO E AS COMPRAS NA CAMALEÃO TINTAS (26/10/2026).
 *
 * O dono mandou 8 prints do ControlShop da Camaleão: o que a gráfica comprou lá
 * de julho a setembro, em dois CNPJs da casa (Agência Bex e Bex Print). Nada
 * disso existia no sistema: contas a pagar só tinha parcelas de equipamento.
 *
 * O teste segura três coisas: as contas da tela (venda, reserva paga sem nota,
 * devolução e o preço por m²/ml contra o cadastro), a importação conferindo
 * com os prints item por item, e a porta — preço de compra é custo, só lê quem
 * vê o financeiro ou cuida de compras, e ninguém grava direto.
 */

const MIGRACOES = join(__dirname, "..", "supabase/migrations");
const ESQUEMA = readFileSync(join(MIGRACOES, "20261027700000_fornecedores_e_compras_no_fornecedor.sql"), "utf8");
const IMPORTACAO = readFileSync(join(MIGRACOES, "20261027700500_compras_na_camaleao_jul_set_2026.sql"), "utf8");
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");

/* ------------------------------------------------------------------------ */
/* A importação lida do próprio arquivo de migração                          */
/* ------------------------------------------------------------------------ */

/** Separa "a, 'b, c', 3" respeitando as aspas simples do SQL. */
function campos(linha: string): string[] {
  const saida: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === "'") {
      if (aspas && linha[i + 1] === "'") {
        atual += "'";
        i++;
        continue;
      }
      aspas = !aspas;
      continue;
    }
    if (ch === "," && !aspas) {
      saida.push(atual.trim());
      atual = "";
      continue;
    }
    atual += ch;
  }
  saida.push(atual.trim());
  return saida;
}

type ItemLido = { codigo: string; descricao: string; qtd: number; lista: number; desc: number; preco: number; total: number; finalidade: string };

/** Documentos e itens como a migração os grava, na ordem do arquivo. */
function lerImportacao() {
  const sql = semComentarios(IMPORTACAO);
  const blocos = sql.split(/INSERT INTO public\.compras_fornecedor \(/).slice(1);
  return blocos.map((b) => {
    const documento = /'((?:VENDA|RESERVA|DEVOLUÇÃO) \d+)'/.exec(b)?.[1] ?? "";
    const valores = /(-?\d+\.\d{2}),\s*(-?\d+\.\d{2}),\s*(-?\d+\.\d{2}),/.exec(b);
    const itens: ItemLido[] = [...b.matchAll(/^\s*\(v_c, (.+)\)[,;]\s*$/gm)].map((m) => {
      const c = campos(m[1]);
      return {
        codigo: c[1],
        descricao: c[2],
        qtd: Number(c[4]),
        lista: Number(c[5]),
        desc: Number(c[6]),
        preco: Number(c[7]),
        total: Number(c[8]),
        finalidade: c[9],
      };
    });
    return {
      documento,
      bruto: Number(valores?.[1]),
      desconto: Number(valores?.[2]),
      total: Number(valores?.[3]),
      itens,
    };
  });
}

describe("importação da Camaleão confere com os prints", () => {
  const docs = lerImportacao();

  it("8 documentos, 22 itens", () => {
    expect(docs.map((d) => d.documento)).toEqual([
      "VENDA 21512",
      "VENDA 21517",
      "RESERVA 22426",
      "RESERVA 22921",
      "RESERVA 22990",
      "VENDA 23192",
      "VENDA 23220",
      "DEVOLUÇÃO 23222",
    ]);
    expect(docs.reduce((n, d) => n + d.itens.length, 0)).toBe(22);
  });

  it("bruto − desconto = total, e a soma dos itens = total de cada documento", () => {
    for (const d of docs) {
      expect(Math.round((d.bruto - d.desconto) * 100), d.documento).toBe(Math.round(d.total * 100));
      const soma = d.itens.reduce((s, i) => s + Math.round(i.total * 100), 0);
      expect(soma, d.documento).toBe(Math.round(d.total * 100));
    }
  });

  it("cada item: quantidade × preço = total, e tabela com o desconto dá o preço pago (±1 centavo)", () => {
    for (const d of docs) {
      for (const i of d.itens) {
        expect(Math.round(i.qtd * i.preco * 100), `${d.documento} ${i.codigo}`).toBe(Math.round(i.total * 100));
        expect(Math.abs(i.lista * (1 - i.desc / 100) - i.preco), `${d.documento} ${i.codigo}`).toBeLessThanOrEqual(0.011);
      }
    }
  });

  it("o total pago bate com os prints: R$ 5.092,64", () => {
    const centavos = docs.reduce((s, d) => s + Math.round(d.total * 100), 0);
    expect(centavos).toBe(509264);
  });

  it("é só registro: não grava em estoque, caixa, contas a pagar nem custo do material", () => {
    const sql = semComentarios(IMPORTACAO);
    for (const tabela of ["material_lotes", "movimentacoes_estoque", "caixa_movimentos", "contas_pagar", "materiais", "pedidos_compra"]) {
      expect(sql, tabela).not.toMatch(new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+public\\.${tabela}\\b`, "i"));
    }
  });

  it("idempotente: cada documento entra uma vez só pelo par fornecedor + documento", () => {
    const sql = semComentarios(IMPORTACAO);
    expect((sql.match(/ON CONFLICT \(fornecedor_id, documento\) DO NOTHING/g) ?? []).length).toBe(8);
    expect(semComentarios(ESQUEMA)).toMatch(/UNIQUE \(fornecedor_id, documento\)/);
  });
});

/* ------------------------------------------------------------------------ */
/* As contas da tela                                                         */
/* ------------------------------------------------------------------------ */

const VINIL = "m-vinil";
const LONA = "m-lona";
const PERFURADO = "m-perfurado";
const TINTA = "m-tinta";

let seq = 0;
function item(
  descricao: string,
  quantidade: number,
  preco: number,
  finalidade: Finalidade,
  material: string | null = null,
  rende: number | null = null,
): ItemDaCompra {
  seq += 1;
  return {
    id: `i${seq}`,
    ordem: seq,
    codigo: null,
    descricao,
    unidade: "UN",
    quantidade,
    preco_lista: null,
    desconto_pct: null,
    preco_unitario: preco,
    total: Math.round(quantidade * preco * 100) / 100,
    finalidade,
    material_id: material,
    rende_do_material: rende,
  };
}

function doc(
  id: string,
  tipo: TipoDoDocumento,
  data: string,
  comprador: string,
  itens: ItemDaCompra[],
  extra: Partial<CompraNoFornecedor> = {},
): CompraNoFornecedor {
  const total = Math.round(itens.reduce((s, i) => s + i.total * 100, 0)) / 100;
  return {
    id,
    fornecedor_id: "camaleao",
    documento: id,
    tipo,
    data_operacao: data,
    comprador_nome: comprador,
    comprador_cnpj: comprador === "BEX PRINT" ? "68.726.406/0001-90" : null,
    codigo_cliente: null,
    forma_pagamento: null,
    condicao_pagamento: null,
    pago: true,
    total_bruto: total,
    desconto: 0,
    total,
    devolve_compra_id: null,
    observacoes: null,
    fonte: null,
    itens,
    ...extra,
  };
}

const CAMALEAO: CompraNoFornecedor[] = [
  doc("VENDA 21512", "venda", "2026-07-30T17:33:25Z", "AGENCIA BEX", [
    item("VINIL BRANCO SYNTP", 1, 380, "materia_prima", VINIL, 53),
    item("VINIL BRANCO DEX", 1, 360, "materia_prima", VINIL, 53),
    item("LONA 280G 1,60X50", 1, 580, "materia_prima", LONA, 80),
    item("AGUA", 1, 3, "consumo"),
    item("REFRIGERANTE", 1, 5.28, "consumo"),
  ]),
  doc("VENDA 21517", "venda", "2026-07-30T17:45:10Z", "AGENCIA BEX", [
    item("FERRAMENTAS DE APLICAÇÃO", 1, 97.19, "ferramenta"),
  ]),
  doc("RESERVA 22426", "reserva", "2026-08-15T16:15:21Z", "AGENCIA BEX", [
    item("VINIL BRANCO DEX", 5, 340, "materia_prima", VINIL, 53),
    item("JETBEST 1L", 4, 231.7, "tinta", TINTA, 1000),
    item("VINIL TRANSPARENTE", 5, 21.5, "materia_prima"),
  ]),
  doc("RESERVA 22921", "reserva", "2026-08-27T17:38:41Z", "BEX PRINT", [
    item("PERFURADO 1,27X50", 1, 400, "materia_prima", PERFURADO, 63.5),
  ]),
  doc("RESERVA 22990", "reserva", "2026-08-28T19:48:35Z", "AGENCIA BEX", [item("LAMINA 45", 1, 21.87, "ferramenta")]),
  doc("VENDA 23192", "venda", "2026-09-02T17:26:01Z", "AGENCIA BEX", [item("SOPRADOR LILAS", 1, 315, "ferramenta")]),
  doc("VENDA 23220", "venda", "2026-09-02T19:17:31Z", "AGENCIA BEX", [item("SOPRADOR BOSCH", 1, 511, "ferramenta")]),
  doc("DEVOLUÇÃO 23222", "devolucao", "2026-09-02T19:28:23Z", "AGENCIA BEX", [item("SOPRADOR LILAS", -1, 315, "ferramenta")], {
    devolve_compra_id: "VENDA 23192",
  }),
];

const CADASTRO: MaterialDoCadastro[] = [
  { id: VINIL, nome: "Vinil adesivo branco brilho", unidade: "m²", custo_medio: 9.5, custo_unitario: 9.5 },
  { id: LONA, nome: "Lona 280g brilho", unidade: "m²", custo_medio: 9.5, custo_unitario: 9.5 },
  { id: PERFURADO, nome: "Vinil adesivo perfurado", unidade: "m²", custo_medio: 22, custo_unitario: 22 },
  { id: TINTA, nome: "Tinta solvente (conjunto)", unidade: "ml", custo_medio: 0.09, custo_unitario: 0.09 },
];

describe("o que foi comprado, o que voltou e o que ficou só reservado", () => {
  it("situação de cada documento", () => {
    const s = Object.fromEntries(CAMALEAO.map((d) => [d.documento, situacaoDoDocumento(d, CAMALEAO)]));
    expect(s).toEqual({
      "VENDA 21512": "comprado",
      "VENDA 21517": "comprado",
      "RESERVA 22426": "reserva_paga",
      "RESERVA 22921": "reserva_paga",
      "RESERVA 22990": "reserva_paga",
      "VENDA 23192": "devolvido",
      "VENDA 23220": "comprado",
      "DEVOLUÇÃO 23222": "devolucao",
    });
  });

  it("totais: vendas, devolvido, reservas pagas e o que de fato saiu", () => {
    const r = resumoDasCompras(CAMALEAO);
    expect(r.vendas).toBe(2251.47);
    expect(r.devolvido).toBe(315);
    expect(r.reservasPagas).toBe(3156.17);
    expect(r.totalPago).toBe(5092.64);
    expect(r.documentos).toBe(8);
  });

  it("quem pagou: a Agência Bex quase tudo, a Bex Print o perfurado", () => {
    const r = resumoDasCompras(CAMALEAO);
    expect(r.porComprador).toEqual([
      { nome: "AGENCIA BEX", cnpj: null, total: 4692.64 },
      { nome: "BEX PRINT", cnpj: "68.726.406/0001-90", total: 400 },
    ]);
  });

  it("para quê: matéria-prima, tinta, ferramentas e copa — a devolução abate a ferramenta", () => {
    const r = resumoDasCompras(CAMALEAO);
    expect(r.porFinalidade).toEqual([
      { finalidade: "materia_prima", total: 3527.5 },
      { finalidade: "tinta", total: 926.8 },
      { finalidade: "ferramenta", total: 630.06 },
      { finalidade: "consumo", total: 8.28 },
    ]);
  });

  it("documento não pago não entra no que saiu", () => {
    const naoPago = doc("RESERVA 1", "reserva", "2026-10-01T12:00:00Z", "AGENCIA BEX", [item("X", 1, 100, "outro")], {
      pago: false,
    });
    expect(resumoDasCompras([...CAMALEAO, naoPago]).totalPago).toBe(5092.64);
    expect(situacaoDoDocumento(naoPago, [naoPago])).toBe("reserva_em_aberto");
  });
});

describe("preço pago por m²/ml × custo do cadastro", () => {
  it("rolo ÷ m² que rende; litro ÷ 1.000 ml; sem material ligado, sem preço", () => {
    expect(precoPorUnidadeDoMaterial(CAMALEAO[2].itens[0])).toBeCloseTo(340 / 53, 6);
    expect(precoPorUnidadeDoMaterial(CAMALEAO[2].itens[1])).toBeCloseTo(0.2317, 6);
    expect(precoPorUnidadeDoMaterial(CAMALEAO[2].itens[2])).toBeNull();
  });

  it("o último pago por material, a faixa e a distância do cadastro", () => {
    const linhas = Object.fromEntries(precosPagosPorMaterial(CAMALEAO, CADASTRO).map((l) => [l.material.nome, l]));
    // Tinta: o cadastro está a R$ 0,09/ml; os 4 litros Jetbest saíram a R$ 0,2317/ml.
    expect(linhas["Tinta solvente (conjunto)"].ultimoPago).toBeCloseTo(0.2317, 6);
    expect(linhas["Tinta solvente (conjunto)"].diferenca).toBeCloseTo(0.09 / 0.2317 - 1, 6);
    // Vinil branco: três compras; a última (reserva de 15/08) é a mais barata.
    expect(linhas["Vinil adesivo branco brilho"].ultimoDocumento).toBe("RESERVA 22426");
    expect(linhas["Vinil adesivo branco brilho"].menorPago).toBeCloseTo(340 / 53, 6);
    expect(linhas["Vinil adesivo branco brilho"].maiorPago).toBeCloseTo(380 / 53, 6);
    expect(linhas["Lona 280g brilho"].ultimoPago).toBe(7.25);
    expect(linhas["Vinil adesivo perfurado"].ultimoPago).toBeCloseTo(400 / 63.5, 6);
  });

  it("devolução não é preço de compra", () => {
    const soDevolucao = [CAMALEAO[7]];
    expect(precosPagosPorMaterial(soDevolucao, CADASTRO)).toEqual([]);
  });

  it("casas que fazem sentido: R$ 0,2317/ml e R$ 6,42/m²", () => {
    expect(formatarPrecoDaUnidade(0.2317, "ml")).toBe("R$ 0,2317/ml");
    expect(formatarPrecoDaUnidade(340 / 53, "m²")).toBe("R$ 6,42/m²");
  });
});

/* ------------------------------------------------------------------------ */
/* A porta: quem lê e quem grava                                             */
/* ------------------------------------------------------------------------ */

describe("a tela", () => {
  const tela = readFileSync(join(__dirname, "..", "src/components/fornecedores/compras-do-fornecedor.tsx"), "utf8");

  it("o aviso das reservas concorda no plural (visto no ar em 26/10: '3 reservas … não virou')", () => {
    expect(tela).toContain("reservas foram pagas e não viraram venda");
    expect(tela).toContain("Uma reserva foi paga e não virou venda");
  });

  it("os quatro cartões de valor não ficam lado a lado na coluna estreita (cortavam 'R$ 5.092,64')", () => {
    expect(tela).toContain("sm:grid-cols-2 2xl:grid-cols-4");
    expect(tela).not.toContain("lg:grid-cols-4");
  });
});

describe("preço de compra é custo: a porta da tela e do banco", () => {
  const sql = semComentarios(ESQUEMA);

  it("a tela abre com financeiro.read ou compras.read e mora no Financeiro", () => {
    expect(getRoutePermissions("/fornecedores")).toEqual(["financeiro.read", "compras.read"]);
    expect(urlsDaArvore()).toContain("/fornecedores");
    const financeiro = AREAS.find((a) => a.id === "financeiro");
    const pagar = financeiro?.subgrupos.find((s) => s.label === "Pagar e caixa");
    expect(pagar?.itens.map((i) => i.url)).toContain("/fornecedores");
  });

  it("vendedor, operador e parceiro não abrem; admin, gestor, financeiro e estoque abrem", () => {
    const abre = (papel: keyof typeof rolePermissions) =>
      (rolePermissions[papel] as readonly string[]).some((p) => p === "financeiro.read" || p === "compras.read");
    expect(abre("admin")).toBe(true);
    expect(abre("gestor")).toBe(true);
    expect(abre("financeiro")).toBe(true);
    expect(abre("estoque")).toBe(true);
    expect(abre("vendedor")).toBe(false);
    expect(abre("operador")).toBe(false);
  });

  it("as tabelas novas: RLS ligada, anon fora, authenticated só lê e a leitura é financeiro ou compras", () => {
    for (const t of ["compras_fornecedor", "compras_fornecedor_itens"]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    }
    expect(sql).toMatch(
      /REVOKE ALL ON public\.compras_fornecedor, public\.compras_fornecedor_itens FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(/GRANT SELECT ON public\.compras_fornecedor, public\.compras_fornecedor_itens TO authenticated;/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*compras_fornecedor[^;]*TO authenticated/);
    const politicas = [...sql.matchAll(/CREATE POLICY "[^"]+" ON public\.(compras_fornecedor(?:_itens)?)([\s\S]*?);/g)];
    expect(politicas).toHaveLength(2);
    for (const p of politicas) {
      expect(p[2]).toMatch(/FOR SELECT TO authenticated/);
      expect(p[2]).toContain("'financeiro.read'");
      expect(p[2]).toContain("'compras.read'");
    }
  });

  it("cadastrar fornecedor é pela função, que confere a permissão e fecha o anon", () => {
    expect(sql).toMatch(/FUNCTION public\.salvar_fornecedor\([\s\S]*?SECURITY DEFINER/);
    expect(sql).toContain("public.has_permission(v_uid, 'catalogo.manage')");
    expect(sql).toContain("public.has_permission(v_uid, 'pagamentos.create')");
    expect(sql).toContain("public.has_permission(v_uid, 'compras.create')");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.salvar_fornecedor\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE)[^;]*ON public\.fornecedores/);
  });

  it("devolução sempre aponta para a compra que desfaz", () => {
    expect(sql).toContain("CHECK ((tipo = 'devolucao') = (devolve_compra_id IS NOT NULL))");
  });
});
