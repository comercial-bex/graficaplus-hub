import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explicarAviso } from "../../src/domain/agente-base/fila";
import { verificarTexto } from "../../src/domain/whatsapp/triagem/verificador";

/**
 * C3.1, o validador de texto do agente mais firme (`20261115120000_agente_validador_mais_firme.sql`).
 *
 * O Postgres é quem manda: o ensaio do roteiro (docs/ensaio-agente-escolhe.md, seção 9) roda estas mesmas frases no Postgres 17
 * local e no banco vivo. Aqui o bloco novo é lido como TEXTO e EXECUTADO em JavaScript, com a tradução de `\y` para `\b`
 * (o texto já vem sem acento e em minúsculas), para o SQL, o espelho em TypeScript e as listas de frases não se afastarem sem
 * ninguém ver.
 *
 * O VALIDADOR É UMA ÚLTIMA PORTA PARCIAL. A garantia real é o dono ler cada resposta antes de aprovar; estes testes só seguram o que
 * já foi previsto.
 */

const PASTA = join(__dirname, "..", "..", "supabase", "migrations");
const NOME = "20261115120000_agente_validador_mais_firme.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const c2 = readFileSync(join(PASTA, "20261114120000_agente_base_de_respostas.sql"), "utf8");
const doc = readFileSync(join(__dirname, "..", "..", "docs", "ensaio-agente-escolhe.md"), "utf8");

const MD5_ANTES = "e7cd527d465584a7d0ff8e470263616d";
const MD5_DEPOIS = "92b7101a1208c7c747c2a6f891421494";
const md5 = (t: string) => createHash("md5").update(t).digest("hex");

/** O bloco que a migração insere, exatamente como está entre as marcas $bloco$. */
const bloco = sql.slice(sql.indexOf("$bloco$") + "$bloco$".length, sql.lastIndexOf("$bloco$"));
const ANCORA = "  FOREACH c IN ARRAY v_novos LOOP\n";

/** O corpo da função como a C2 a criou (o que o Postgres guarda em prosrc). */
const corpoAntigo = (() => {
  const ini = c2.indexOf("CREATE OR REPLACE FUNCTION public._agente_problemas_de_texto(");
  const fim = c2.indexOf("-- 5. Gatilhos");
  const f = c2.slice(ini, fim);
  const a = f.indexOf("AS $function$") + "AS $function$".length;
  return f.slice(a, f.lastIndexOf("$function$"));
})();

const semComentarios = bloco
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");
const LITERAL = String.raw`'(?:[^']|'')*'`;
type Regra = { codigo: string; re: RegExp };
const regras: Regra[] = [];
for (const b of semComentarios.split("END IF;")) {
  const m = b.match(/\bIF([\s\S]*?)\bTHEN\s+v_novos := array_append\(v_novos, '([a-z_]+)'\);\s*$/);
  if (!m) continue;
  for (const op of m[1].matchAll(new RegExp(String.raw`v_plano\s*~\s*(${LITERAL})`, "g"))) {
    regras.push({
      codigo: m[2],
      re: new RegExp(op[1].slice(1, -1).replace(/''/g, "'").replace(/\\y/g, "\\b")),
    });
  }
}
const plano = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const codigosDoBanco = (t: string) => [
  ...new Set(regras.filter((r) => r.re.test(plano(t))).map((r) => r.codigo)),
];

const BARRAR: [string, string][] = [
  ["Faço o orçamento para você.", "orcamento_feito_pelo_agente"],
  ["Preparo o orçamento agora mesmo.", "orcamento_feito_pelo_agente"],
  ["Eu te passo o valor depois.", "orcamento_feito_pelo_agente"],
  ["Te passo o orçamento ainda hoje.", "orcamento_feito_pelo_agente"],
  ["Monto o orçamento e te mando.", "orcamento_feito_pelo_agente"],
  ["Montamos o orçamento para você.", "orcamento_feito_pelo_agente"],
  ["Calculo o preço para você.", "orcamento_feito_pelo_agente"],
  ["Faremos o orçamento amanhã.", "orcamento_feito_pelo_agente"],
  ["Vou preparar o orçamento.", "orcamento_feito_pelo_agente"],
  ["Posso calcular o valor para você.", "orcamento_feito_pelo_agente"],
  ["O pedido sai hoje.", "prazo_prometido"],
  ["Sai hoje mesmo.", "prazo_prometido"],
  ["Os banners saem amanhã.", "prazo_prometido"],
  ["Entregamos no outro dia.", "prazo_prometido"],
  ["Fica pronto no dia seguinte.", "prazo_prometido"],
  ["Nosso preço é competitivo.", "condicao_de_preco"],
  ["Temos condições competitivas.", "condicao_de_preco"],
  ["Isso custa pouco.", "condicao_de_preco"],
  ["Custa muito pouco para você.", "condicao_de_preco"],
  ["Temos um preço bom.", "condicao_de_preco"],
  ["Fazemos um bom preço.", "condicao_de_preco"],
  ["Preço justo para o seu pedido.", "condicao_de_preco"],
  ["Há uma taxa de entrega.", "taxa_cobrada"],
  ["Tem uma taxa de urgência.", "taxa_cobrada"],
];

/** O que a casa pode dizer. A primeira é a semente `como_pedir_orcamento`, com "montar o orçamento" no infinitivo. */
const PASSAR = [
  "Para a equipe montar o orçamento, preciso saber qual produto você quer, a medida, a quantidade e se você já tem a arte pronta. Pode mandar essas informações por aqui que eu passo para a equipe.",
  "A equipe faz o orçamento depois de ver o pedido.",
  "A equipe prepara o orçamento quando você mandar as medidas.",
  "Me diga o produto que você quer ver que eu passo o pedido para ela.",
  "Vou avisar a equipe que você quer falar com uma pessoa.",
  "Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.",
  "A equipe atende de segunda a sexta, das 8h às 18h.",
  "Quem confirma se há alguma taxa é a equipe.",
  "O pedido sai da fila de produção na ordem em que chegou.",
];

/** As 15 respostas semente da C2, como estão no banco vivo em 14/11/2026 (rascunho, ramo cliente). */
const SEMENTES: Record<string, string> = {
  como_pedir_orcamento:
    "Para a equipe montar o orçamento, preciso saber qual produto você quer, a medida, a quantidade e se você já tem a arte pronta. Pode mandar essas informações por aqui que eu passo para a equipe.",
  endereco_da_loja:
    "A Bex Print fica na Rua Cândido Mendes, 23, bairro Perpétuo Socorro, em Macapá. Se preferir, a equipe confirma como chegar.",
  entrega_do_pedido:
    "A equipe confirma se a entrega é possível para o seu endereço e como ela funciona. Me diga o bairro e o produto que você quer receber, que eu passo para ela.",
  enviar_a_arte:
    "Pode sim. Mande a arte por aqui mesmo e a equipe confere se está boa para imprimir. Se você ainda não tem a arte, conte a ideia que a equipe vê como ajudar.",
  exemplos_e_catalogo:
    "A equipe pode mostrar exemplos de trabalhos parecidos com o que você procura. Me diga o produto que você quer ver que eu passo o pedido para ela.",
  falar_com_a_equipe:
    "Tudo bem, vou avisar a equipe que você quer falar com uma pessoa. Ela responde por aqui assim que puder.",
  forma_de_pagamento:
    "O pagamento é combinado a cada pedido, então quem explica as formas disponíveis é a equipe, junto com o orçamento.",
  formato_do_arquivo:
    "Costuma servir arquivo em PDF, em vetor ou em imagem com boa resolução. Mande o que você tiver que a equipe confere se serve para imprimir.",
  horario_de_atendimento:
    "A equipe atende de segunda a sexta, das 8h às 18h. Fora desse horário, deixe sua mensagem por aqui que a equipe vê quando abrir.",
  instalacao:
    "A Bex Print tem serviço de instalação e deslocamento, e a equipe confirma se atende o seu caso. Conte o que seria instalado e onde, que eu passo para ela.",
  item_fora_do_catalogo:
    "Vou anotar o que você procura para a equipe conferir se é um trabalho que a Bex Print faz. Descreva o item, a medida e a quantidade que você precisa.",
  medida_do_produto:
    "Me diga a largura e a altura que você precisa. A equipe confere se aquela medida é possível para o produto.",
  prazo_do_pedido:
    "O prazo depende do produto, da quantidade e da fila de produção, então quem confirma é a equipe, depois de ver o que você precisa. Me conte o que você quer fazer que eu passo para ela.",
  quantidade_minima:
    "A quantidade mínima muda de produto para produto, e quem confirma é a equipe. Me diga o que você quer fazer e quantas unidades pensa em pedir, que eu passo para ela.",
  valor_do_produto:
    "Cada trabalho tem medida, material e quantidade próprios, então quem confirma o valor é a equipe, depois de entender o que você precisa. Me conte o produto, a medida e a quantidade que eu deixo anotado para ela.",
};

describe("C3.1: o bloco novo lido do SQL", () => {
  it("acha as regras de todos os quatro códigos", () => {
    expect(new Set(regras.map((r) => r.codigo))).toEqual(
      new Set([
        "orcamento_feito_pelo_agente",
        "prazo_prometido",
        "condicao_de_preco",
        "taxa_cobrada",
      ]),
    );
    expect(regras.length).toBeGreaterThanOrEqual(8);
  });

  it.each(BARRAR)("barra %s", (frase, codigo) => {
    expect(codigosDoBanco(frase), frase).toContain(codigo);
  });

  it.each(PASSAR)("deixa passar: %s", (frase) => {
    expect(codigosDoBanco(frase), frase).toEqual([]);
  });

  it("as 15 respostas semente da C2 continuam passando no bloco novo", () => {
    expect(Object.keys(SEMENTES)).toHaveLength(15);
    for (const [tema, texto] of Object.entries(SEMENTES)) {
      expect(codigosDoBanco(texto), tema).toEqual([]);
    }
  });
});

describe("C3.1: o espelho em TypeScript concorda com o banco", () => {
  it.each(BARRAR)("o verificador completo barra %s", (frase) => {
    for (const ramo of ["cliente", "parceiro"] as const) {
      expect(verificarTexto(frase, ramo).ok, `${ramo}: ${frase}`).toBe(false);
    }
  });

  it.each(PASSAR)("o verificador completo deixa passar: %s", (frase) => {
    expect(verificarTexto(frase, "cliente").problemas, frase).toEqual([]);
  });

  it("as 15 respostas semente passam no verificador completo, nos dois ramos (é o que o agente roda antes de pedir o envio)", () => {
    for (const [tema, texto] of Object.entries(SEMENTES)) {
      for (const ramo of ["cliente", "parceiro"] as const) {
        const r = verificarTexto(texto, ramo);
        // a palavra que o cliente final não lê (parceiro) não aparece nas sementes
        expect(r.problemas, `${ramo} ${tema}`).toEqual([]);
      }
    }
  });

  it("os códigos novos do TypeScript são os do banco quando o assunto é o mesmo", () => {
    const pelo = (f: string) => verificarTexto(f, "cliente").problemas.map((p) => p.regra);
    expect(pelo("Faço o orçamento para você.")).toContain("orcamento_feito_pelo_agente");
    expect(pelo("Há uma taxa de entrega.")).toContain("taxa_cobrada");
    expect(pelo("Entregamos no outro dia.")).toContain("prazo_relativo");
    expect(pelo("Isso custa pouco.")).toContain("preco_sem_numero");
    expect(pelo("Nosso preço é competitivo.")).toContain("preco_sem_numero");
  });

  it("o escopo triagem NÃO ganhou regra nova: nome e frase da triagem seguem sem falso positivo", () => {
    const novas = ["orcamento_feito_pelo_agente", "taxa_cobrada"];
    // nomes que parecem verbo de orçamento ou taxa, e frases da triagem com as palavras novas
    const textos = [
      "Taxa",
      "Maria Taxa de Souza",
      "Paulo Faco",
      "Ana Passo",
      "Monto",
      "Competitivo",
      "Faço o orçamento",
      "Preparo o orçamento",
      "Te passo o valor",
      "Há uma taxa de entrega",
      "Entregamos no outro dia",
      "Isso custa pouco",
    ];
    for (const t of textos) {
      const r = verificarTexto(t, "cliente", [], { escopo: "triagem" });
      for (const n of novas)
        expect(
          r.problemas.map((p) => p.regra),
          t,
        ).not.toContain(n);
    }
    for (const t of [
      "Faço o orçamento",
      "Há uma taxa de entrega",
      "Entregamos no outro dia",
      "Isso custa pouco",
      "Competitivo",
    ]) {
      expect(verificarTexto(t, "cliente", [], { escopo: "triagem" }).ok, t).toBe(true);
    }
  });
});

describe("C3.1: a migração", () => {
  it("troca na definição viva: confere o md5 lido, a âncora uma vez e o marcador de repetição", () => {
    expect(sql).toContain(`v_md5_lido constant text := '${MD5_ANTES}'`);
    expect(sql).toContain("pg_get_functiondef(v_oid)");
    expect(sql).toMatch(/v_n <> 1 THEN\s+RAISE EXCEPTION 'Esperava a âncora/);
    expect(sql).toContain("-- C3.1: validador mais firme");
    expect(sql).toContain("EXECUTE replace(v_def, v_ancora, v_bloco || v_ancora);");
    // não recopia o corpo: nenhum CREATE OR REPLACE FUNCTION literal da função
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\._agente_problemas_de_texto/);
  });

  it("o corpo da C2 tem o md5 lido e a âncora UMA vez", () => {
    expect(md5(corpoAntigo)).toBe(MD5_ANTES);
    expect(corpoAntigo.split(ANCORA)).toHaveLength(2);
  });

  it("o corpo antigo mais o bloco tem o md5 que a conferência da migração e o roteiro dizem", () => {
    const novo = corpoAntigo.replace(ANCORA, bloco + ANCORA);
    expect(md5(novo)).toBe(MD5_DEPOIS);
    expect(sql).toContain(`'${MD5_DEPOIS}'`);
    expect(doc).toContain(MD5_DEPOIS);
    // a troca só ACRESCENTA: o corpo antigo está inteiro dentro do novo, na mesma ordem
    const [antes, depois] = corpoAntigo.split(ANCORA);
    expect(novo.startsWith(antes)).toBe(true);
    expect(novo.endsWith(ANCORA + depois)).toBe(true);
  });

  it("a volta tira exatamente o bloco: a regex da volta devolve o corpo antigo", () => {
    const novo = corpoAntigo.replace(ANCORA, bloco + ANCORA);
    const volta = novo.replace(
      /\n {2}-- C3\.1: validador mais firme[\s\S]*?(?= {2}FOREACH c IN ARRAY v_novos LOOP)/,
      "",
    );
    expect(md5(volta)).toBe(MD5_ANTES);
  });

  it("a conferência desfaz tudo: frases barradas, frases que passam, respostas que existem e ACL", () => {
    const conf = sql.slice(sql.indexOf("DO $confere$"));
    expect(conf).toContain("devia ser barrada com");
    expect(conf).toContain("devia passar e foi barrada");
    expect(conf).toContain("barra respostas que já existem");
    expect(conf).toContain("barra respostas aprovadas");
    expect(conf).toContain("a ACL de _agente_problemas_de_texto mudou");
    expect(sql).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';/);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });

  it("vem depois da C4 e o prefixo de data é único; não mexe em mais nada", () => {
    expect(NOME > "20261115110000_agente_metricas.sql").toBe(true);
    const codigo = sql
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    expect(codigo).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE|TRUNCATE)\b/i);
    expect(codigo).not.toMatch(/CREATE (TABLE|TYPE|TRIGGER|INDEX|VIEW)/i);
  });

  it("não usa a outra palavra do mercado, travessão nem seta", () => {
    expect(sql).not.toMatch(/revend/i);
    expect(sql).not.toMatch(/[—–→]/);
  });
});

describe("C3.1: o que a tela de aprovação e o roteiro dizem", () => {
  it("cada código novo tem explicação própria na tela de aprovação", () => {
    const fallback = explicarAviso("codigo_que_nao_existe");
    for (const c of [
      "orcamento_feito_pelo_agente",
      "prazo_prometido",
      "condicao_de_preco",
      "taxa_cobrada",
    ]) {
      expect(explicarAviso(c), c).not.toBe(fallback);
    }
  });

  it("a tela de aprovação diz que o validador é uma última porta parcial e que a garantia é o dono ler cada resposta", () => {
    const rota = readFileSync("src/routes/_authenticated/configuracoes-agente-base.tsx", "utf8");
    expect(rota).toMatch(/O conferidor automático é só uma última porta/);
    expect(rota).toMatch(/A garantia de verdade é você ler cada resposta inteira antes de aprovar/);
    const fila = readFileSync("src/components/agente-base/fila-de-aprovacao.tsx", "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(fila).toContain("O conferidor automático não achou nada");
    expect(fila).toContain("Quem garante que a resposta não cita valor nem prazo é você");
    // a frase velha prometia o que o validador não garante
    expect(fila).not.toContain(
      "O texto não fala valor, desconto, prazo em número nem forma de pagamento",
    );
  });

  it("o roteiro diz o mesmo, com todas as letras", () => {
    const secao = doc.slice(doc.indexOf("## 9. "));
    expect(secao).toMatch(/última porta parcial/);
    expect(secao).toMatch(/a garantia real é o dono ler cada resposta/);
  });
});
