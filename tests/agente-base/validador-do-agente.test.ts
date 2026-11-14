import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C2, o validador do agente (`_agente_problemas_de_texto`) lido como texto e
 * EXECUTADO em JavaScript: cada expressão regular da camada própria do agente é
 * extraída do SQL e aplicada às frases abaixo. O Postgres é quem manda (o ensaio
 * do roteiro roda as mesmas frases no Postgres 17 local); aqui a tradução de
 * `\y` para `\b` basta, porque o texto já vem sem acento e em minúsculas, e o
 * teste não deixa o SQL e a lista de frases se afastarem sem ninguém ver.
 *
 * Só a camada PRÓPRIA do agente é simulada. A camada da triagem (reais, pix,
 * "3 dias", parênteses) vive em outra migração e não entra aqui.
 */

const sql = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "20261114120000_agente_base_de_respostas.sql"),
  "utf8",
);
const ini = sql.indexOf("CREATE OR REPLACE FUNCTION public._agente_problemas_de_texto(");
const fim = sql.indexOf("-- 5. Gatilhos");
const funcao = sql.slice(ini, fim);
const semComentarios = funcao
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

const constantes: Record<string, string> = {};
for (const m of semComentarios.matchAll(/(v_\w+) constant text := '([^']*)';/g)) constantes[m[1]] = m[2];

const LITERAL = String.raw`'(?:[^']|'')*'`;
const OPERANDO = new RegExp(
  String.raw`(v_plano|coalesce\(p_texto, ''\))\s*~\s*(\((?:\s*(?:${LITERAL}|v_\w+)\s*(?:\|\|)?\s*)+\)|${LITERAL})`,
  "g",
);

type Regra = { codigo: string; sobre: "plano" | "bruto"; re: RegExp; fonte: string };

function expressaoEmTexto(expr: string): string {
  let out = "";
  for (const t of expr.matchAll(new RegExp(`${LITERAL}|v_\\w+`, "g"))) {
    const tok = t[0];
    out += tok.startsWith("'") ? tok.slice(1, -1).replace(/''/g, "'") : (constantes[tok] ?? `<${tok}?>`);
  }
  return out;
}

const regras: Regra[] = [];
for (const bloco of semComentarios.split("END IF;")) {
  const m = bloco.match(/\bIF([\s\S]*?)\bTHEN\s+v_novos := array_append\(v_novos, '([a-z_]+)'\);\s*$/);
  if (!m) continue;
  for (const op of m[1].matchAll(OPERANDO)) {
    const fonte = expressaoEmTexto(op[2]);
    regras.push({
      codigo: m[2],
      sobre: op[1] === "v_plano" ? "plano" : "bruto",
      re: new RegExp(fonte.replace(/\\y/g, "\\b")),
      fonte,
    });
  }
}

const plano = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Os códigos que a camada própria do agente devolveria para o texto. */
function codigosDoAgente(texto: string): string[] {
  const p = plano(texto);
  const achados = regras.filter((r) => r.re.test(r.sobre === "plano" ? p : texto)).map((r) => r.codigo);
  return [...new Set(achados)];
}

describe("o simulador acha as regras do SQL", () => {
  it("lê as regras de todos os códigos próprios do agente", () => {
    const codigos = new Set(regras.map((r) => r.codigo));
    for (const c of [
      "preco_com_numero",
      "valor_em_reais",
      "condicao_de_preco",
      "desconto_disfarcado",
      "preco_especial",
      "preco_diferenciado",
      "tabela",
      "prazo_prometido",
      "pagamento_com_numero",
      "forma_de_pagamento",
      "orcamento_feito_pelo_agente",
    ]) {
      expect(codigos.has(c), c).toBe(true);
    }
    expect(regras.length).toBeGreaterThan(30);
    expect(constantes.v_ext).toMatch(/cinquenta/);
    expect(regras.every((r) => !r.fonte.includes("<v_"))).toBe(true);
  });
});

/** [ramo, texto, código esperado]. Todos já provados no Postgres 17 pelo roteiro. */
const BARRA: [string, string, string][] = [
  // preço por extenso e "sai por"
  ["cliente", "O preço é cem", "preco_com_numero"],
  ["cliente", "O valor fica em cento e cinquenta", "preco_com_numero"],
  ["cliente", "Sai por duzentos cada", "preco_com_numero"],
  ["cliente", "Sai por 30 cada", "preco_com_numero"],
  ["cliente", "Custa cinquenta a unidade", "preco_com_numero"],
  ["cliente", "Cobramos mil e quinhentos", "preco_com_numero"],
  ["cliente", "Fica por oitenta", "preco_com_numero"],
  ["cliente", "A partir de cem a unidade", "preco_com_numero"],
  ["cliente", "A partir de 20 a unidade", "preco_com_numero"],
  ["cliente", "Custa um real", "valor_em_reais"],
  ["cliente", "Sai por dois contos", "valor_em_reais"],
  // prazo
  ["cliente", "Fica pronto em 48h", "prazo_prometido"],
  ["cliente", "Pronto em 3d", "prazo_prometido"],
  ["cliente", "Fica pronto em 2h", "prazo_prometido"],
  ["cliente", "Fica pronto em até 36h", "prazo_prometido"],
  ["cliente", "Fica pronto em dois dias", "prazo_prometido"],
  ["cliente", "Leva uma semana", "prazo_prometido"],
  ["cliente", "Entrego dia 15", "prazo_prometido"],
  ["cliente", "Entrego no dia quinze", "prazo_prometido"],
  ["cliente", "Fica pronto no mesmo dia", "prazo_prometido"],
  ["cliente", "Entregamos esta semana", "prazo_prometido"],
  ["cliente", "Entregamos ainda hoje", "prazo_prometido"],
  ["cliente", "Fica pronto em 30 minutos", "prazo_prometido"],
  ["cliente", "Fica pronto em meia hora", "prazo_prometido"],
  ["cliente", "Fica pronto em quinze minutos", "prazo_prometido"],
  // pagamento
  ["cliente", "Pagamento à vista", "forma_de_pagamento"],
  ["cliente", "Aceitamos cartão de crédito", "forma_de_pagamento"],
  ["cliente", "Aceitamos cartão", "forma_de_pagamento"],
  ["cliente", "Dividimos em três vezes", "forma_de_pagamento"],
  ["cliente", "Dividimos em 3x", "forma_de_pagamento"],
  ["cliente", "Metade na entrada e metade na retirada", "forma_de_pagamento"],
  ["cliente", "Pedimos um sinal", "forma_de_pagamento"],
  ["cliente", "Pagamento em dinheiro", "forma_de_pagamento"],
  ["cliente", "Para pagar a entrada, fale com a equipe", "forma_de_pagamento"],
  ["cliente", "Pode pagar a entrada de 30", "pagamento_com_numero"],
  ["cliente", "Pagamento em duas vezes", "pagamento_com_numero"],
  // o ramo parceiro: as regras de preço especial, diferenciado e tabela valem lá também
  ["parceiro", "Temos preço especial para parceiros", "preco_especial"],
  ["parceiro", "Parceiro tem preço diferenciado", "preco_diferenciado"],
  ["parceiro", "Os valores diferenciados ficam no cadastro", "preco_diferenciado"],
  ["parceiro", "O valor de atacado é combinado depois", "preco_especial"],
  ["parceiro", "Trabalhamos no atacado", "preco_especial"],
  ["parceiro", "Vou mandar a tabela de preços", "tabela"],
  ["parceiro", "Temos condições especiais", "preco_especial"],
  ["parceiro", "Aqui é preço de custo", "preco_especial"],
  ["parceiro", "Sai por duzentos cada", "preco_com_numero"],
  ["parceiro", "Fica pronto em 48h", "prazo_prometido"],
  ["parceiro", "Pagamento à vista", "forma_de_pagamento"],
];

const PASSA: [string, string][] = [
  // horário da casa
  ["cliente", "A equipe atende de segunda a sexta, das 8h às 17h."],
  ["cliente", "Abrimos às 8h e fechamos às 18h, de segunda a sexta."],
  ["cliente", "Atendemos até 17h."],
  ["cliente", "Fechamos ao meio dia."],
  // quantidades e medidas
  ["cliente", "O pedido mínimo é de cem unidades."],
  ["cliente", "A partir de 100 unidades a equipe confirma o mínimo."],
  ["cliente", "A partir de cem unidades a equipe confirma o mínimo."],
  ["cliente", "A partir de 1.000 unidades a equipe confirma o mínimo."],
  ["cliente", "Trabalhamos com pedidos de dez unidades ou mais e com até vinte cores."],
  ["cliente", "A medida é 90 x 60 cm."],
  ["cliente", "A lona tem 2 metros por 1 metro."],
  ["cliente", "O arquivo precisa ter 300 dpi e 10 cm de sangria."],
  // produto e linguagem do dia a dia
  ["cliente", "Fazemos cartão de visita, panfleto e banner."],
  ["cliente", "Fazemos impressão 3D e impressão em 3D."],
  ["cliente", "A loja fica na entrada do bairro."],
  ["cliente", "Dar entrada no pedido é só mandar a arte."],
  ["cliente", "A forma de pagamento quem combina é a equipe."],
  ["cliente", "O valor quem passa é a equipe, com tudo certinho para o seu pedido."],
  ["cliente", "Pode enviar em PDF ou em CorelDRAW, com as fontes em curva."],
  ["cliente", "Pode mandar a arte por aqui que a equipe confere se está boa para imprimir."],
  // parceiro e parceria seguem livres no ramo parceiro
  ["parceiro", "O cadastro de parceiro é rápido e a equipe conversa com você."],
  ["parceiro", "A parceria começa pelo cadastro."],
  ["parceiro", "As condições de parceiro ficam disponíveis depois do cadastro."],
  ["parceiro", "A equipe atende de segunda a sexta, das 8h às 17h."],
];

describe("o validador do agente barra preço, prazo e pagamento por extenso", () => {
  for (const [ramo, texto, codigo] of BARRA) {
    it(`${ramo}: "${texto}" devolve ${codigo}`, () => {
      expect(codigosDoAgente(texto), texto).toContain(codigo);
    });
  }
});

describe("o validador do agente deixa passar horário da casa, quantidades, medidas e as palavras parceiro e parceria", () => {
  for (const [ramo, texto] of PASSA) {
    it(`${ramo}: "${texto}" passa`, () => {
      expect(codigosDoAgente(texto), texto).toEqual([]);
    });
  }
});

describe("a camada própria do agente não depende do ramo", () => {
  it("nenhuma regra própria olha v_ramo ou p_ramos depois da chamada da triagem", () => {
    const propria = semComentarios.slice(semComentarios.indexOf("v_novos := array_append(v_novos, 'preco_com_numero')") - 900);
    expect(propria).not.toMatch(/v_ramo|p_ramos/);
    // as de preço especial, diferenciado e tabela estão nela
    for (const c of ["preco_especial", "preco_diferenciado", "tabela"]) {
      expect(propria).toContain(`array_append(v_novos, '${c}')`);
    }
  });

  it("as regras de preço especial cobrem as palavras pedidas", () => {
    const fonte = regras.filter((r) => r.codigo === "preco_especial").map((r) => r.fonte).join(" ");
    for (const w of ["preco|precos|valor|valores|condicao|condicoes", "especial|especiais", "de custo", "de atacado", "atacad"]) {
      expect(fonte, w).toContain(w);
    }
    expect(regras.filter((r) => r.codigo === "preco_diferenciado").map((r) => r.fonte).join(" ")).toContain("diferenciad");
    expect(regras.filter((r) => r.codigo === "tabela").map((r) => r.fonte).join(" ")).toMatch(/tabelas\?/);
  });
});

describe("os exemplos escritos nos comentários do SQL são verdadeiros", () => {
  const linhas = funcao.split("\n").map((l) => l.trim());
  const barra = linhas.filter((l) => l.startsWith("--") && /\bBarra\b/.test(l));
  const passa = linhas.filter((l) => l.startsWith("--") && /\bPassa:/.test(l));
  const citados = (l: string) => [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  it("há blocos Barra e Passa para preço, prazo, pagamento e preço especial", () => {
    expect(barra.length).toBeGreaterThanOrEqual(5);
    expect(passa.length).toBeGreaterThanOrEqual(4);
  });

  it("todo exemplo de Barra é barrado pela camada própria, inclusive sinal e metade", () => {
    const todos = barra.flatMap(citados);
    expect(todos.length).toBeGreaterThan(30);
    for (const ex of todos) expect(codigosDoAgente(ex), ex).not.toEqual([]);
    expect(todos).toContain("pedimos um sinal");
    expect(todos).toContain("metade na entrada");
  });

  it("todo exemplo de Passa passa", () => {
    const todos = passa.flatMap(citados);
    expect(todos.length).toBeGreaterThan(12);
    for (const ex of todos) expect(codigosDoAgente(ex), ex).toEqual([]);
  });

  it("o comentário antigo de sinal de metade, que não batia com a regra, não existe mais", () => {
    expect(funcao).not.toMatch(/"sinal de metade"/);
  });
});
