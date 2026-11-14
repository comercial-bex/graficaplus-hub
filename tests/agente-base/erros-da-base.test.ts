import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TEXTO_DE_VERSAO_TROCADA,
  textoDoErroDaBase,
  type AcaoDaBase,
} from "../../src/domain/agente-base/erros";
import { explicarAviso } from "../../src/domain/agente-base/fila";

/**
 * Nenhum texto do banco chega à tela da base de respostas. Os erros que as
 * funções do banco levantam trazem parênteses, números de versão e códigos
 * internos de regra; `textoDoErroDaBase` troca cada um por uma frase própria.
 * As mensagens de entrada são LIDAS da migração, para o teste não ficar para
 * trás quando alguém escrever uma recusa nova.
 */

const sql = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "20261114120000_agente_base_de_respostas.sql"),
  "utf8",
);
const servidor = readFileSync(join(__dirname, "..", "..", "src", "lib", "api", "agente-base.functions.ts"), "utf8");

const ACOES: AcaoDaBase[] = ["ler", "verificar", "salvar", "aprovar", "rascunho", "arquivar"];

/** Cada RAISE EXCEPTION da migração, com o `%` trocado por um valor de exemplo. */
const mensagensDoBanco = [...sql.matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'/g)]
  .map((m) => m[1].replace(/''/g, "'"))
  .filter((t) => !t.startsWith("esperava") && !t.includes("Faltam pré-requisitos"))
  .map((t) => t.replace(/%/g, "3"));

const SIMBOLOS = /[()—–―→←⇒%]/;
const TEM_ACENTO = /[ãõçáéíóúâêôà]/i;

describe("as recusas do banco viram frase própria", () => {
  it("a migração tem recusas para traduzir", () => {
    expect(mensagensDoBanco.length).toBeGreaterThan(15);
  });

  it("nenhuma mensagem do banco, em nenhuma ação, chega igual à tela", () => {
    for (const m of mensagensDoBanco) {
      for (const acao of ACOES) {
        const saida = textoDoErroDaBase({ message: m, code: "P0001" }, acao);
        expect(saida, `${acao}: ${m}`).not.toBe(m);
        expect(saida, `${acao}: ${m}`).not.toContain(m);
      }
    }
  });

  it("a frase de tela não tem parênteses, travessão, seta, porcentagem nem código com sublinhado, e parece português", () => {
    for (const m of mensagensDoBanco) {
      for (const acao of ACOES) {
        const saida = textoDoErroDaBase({ message: m, code: "P0001" }, acao);
        expect(saida, `${acao}: ${m}`).not.toMatch(SIMBOLOS);
        expect(saida, `${acao}: ${m}`).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
        expect(saida, `${acao}: ${m}`).not.toMatch(/\b(whatsapp|configuracoes)\.manage\b/);
        expect(saida, `${acao}: ${m}`).toMatch(TEM_ACENTO);
        expect(saida.length, `${acao}: ${m}`).toBeLessThan(400);
      }
    }
  });

  it("as recusas com número de versão não deixam o número passar", () => {
    const m = "A resposta mudou depois que você a viu (versão 5 no banco, você viu 4). Recarregue e leia de novo antes de aprovar.";
    const saida = textoDoErroDaBase({ message: m }, "aprovar");
    expect(saida).not.toMatch(/\d/);
    expect(saida).not.toContain("versão");
  });
});

describe("versão trocada", () => {
  it("na aprovação, diz que mudou enquanto o dono lia e pede para ler de novo", () => {
    const m = "A resposta mudou depois que você a viu (versão 5 no banco, você viu 4). Recarregue e leia de novo antes de aprovar.";
    expect(textoDoErroDaBase({ message: m }, "aprovar")).toBe(
      "Esta resposta mudou enquanto você lia. Leia de novo antes de aprovar.",
    );
    expect(TEXTO_DE_VERSAO_TROCADA).toBe("Esta resposta mudou enquanto você lia. Leia de novo antes de aprovar.");
  });

  it("ao salvar, o pedido é o mesmo, com o verbo certo", () => {
    const m = "A resposta mudou depois que você a abriu (versão 5 no banco, você viu 4). Recarregue antes de salvar.";
    expect(textoDoErroDaBase({ message: m }, "salvar")).toBe(
      "Esta resposta mudou enquanto você lia. Leia de novo antes de salvar.",
    );
  });
});

describe("recusa do validador", () => {
  it("passa os códigos por explicarAviso e nenhum código cru chega à tela", () => {
    const m = "Não aprovei: o texto tem problemas (preco_com_numero, prazo_prometido).";
    const saida = textoDoErroDaBase({ message: m, code: "23514" }, "aprovar");
    expect(saida).toContain(explicarAviso("preco_com_numero"));
    expect(saida).toContain(explicarAviso("prazo_prometido"));
    expect(saida).not.toMatch(/preco_com_numero|prazo_prometido/);
    expect(saida.startsWith("Não aprovei.")).toBe(true);
  });

  it("a recusa do gatilho, com os códigos depois dos dois pontos, também", () => {
    const saida = textoDoErroDaBase({ message: "Texto recusado na aprovação: forma_de_pagamento, tabela" }, "aprovar");
    expect(saida).toContain(explicarAviso("forma_de_pagamento"));
    expect(saida).toContain(explicarAviso("tabela"));
    expect(saida).not.toMatch(/forma_de_pagamento/);
  });

  it("código que a tela não conhece cai na explicação padrão, sem mostrar o código", () => {
    const saida = textoDoErroDaBase({ message: "Não aprovei: o texto tem problemas (codigo_novo_do_banco)." }, "aprovar");
    expect(saida).toContain(explicarAviso("codigo_novo_do_banco"));
    expect(saida).not.toContain("codigo_novo_do_banco");
  });

  it("sem código legível, avisa de modo geral", () => {
    expect(textoDoErroDaBase({ message: "Não aprovei: o texto tem problemas ()." }, "aprovar")).toMatch(/^Não aprovei\./);
  });
});

describe("erros de dados e de infraestrutura", () => {
  it("restrição de checagem, chave estrangeira e duplicata têm frase própria", () => {
    const check = textoDoErroDaBase(
      { message: 'new row for relation "agente_base_respostas" violates check constraint "agente_base_respostas_frases_gatilho_check"', code: "23514" },
      "salvar",
    );
    expect(check).not.toMatch(/agente_base|constraint|relation/);
    expect(textoDoErroDaBase({ message: "insert violates foreign key constraint", code: "23503" }, "salvar")).not.toMatch(/constraint|foreign/);
    expect(textoDoErroDaBase({ message: "duplicate key value violates unique constraint", code: "23505" }, "salvar")).toMatch(/Já existe uma resposta com este tema/);
  });

  it("erro desconhecido, de rede ou vazio vira a frase padrão da ação, sem o texto cru", () => {
    for (const acao of ACOES) {
      for (const bruto of ["fetch failed ECONNRESET", "permission denied for table agente_base_respostas", "canceling statement due to lock timeout", ""]) {
        const saida = textoDoErroDaBase({ message: bruto }, acao);
        expect(saida).toMatch(TEM_ACENTO);
        expect(saida).not.toContain("ECONNRESET");
        expect(saida).not.toMatch(/permission denied|lock timeout|agente_base/);
      }
      expect(textoDoErroDaBase(null, acao)).toMatch(/Tente de novo/);
      expect(textoDoErroDaBase(undefined, acao)).toMatch(/Tente de novo/);
    }
  });
});

describe("o servidor nunca repassa o texto do banco", () => {
  const comentarios = (t: string) =>
    t
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
  const codigo = comentarios(servidor);

  it("nenhum throw usa a mensagem do erro do banco", () => {
    expect(codigo).not.toMatch(/throw new Error\(\s*[\w.]*error\.message/);
    expect(codigo).not.toMatch(/throw new Error\(\s*[\w.]*erro\.message/);
    expect(codigo).not.toMatch(/throw\s+(error|erro|lidas\.error|prod\.error)\b/);
  });

  it("todo erro do rpc e das leituras passa por falhou, com a ação certa", () => {
    expect(codigo).toMatch(/function falhou\(acao: AcaoDaBase, erro: ErroDoBanco\): never/);
    expect(codigo).toMatch(/throw new Error\(textoDoErroDaBase\(erro, acao\)\)/);
    for (const acao of ["ler", "verificar", "salvar", "aprovar", "rascunho", "arquivar"]) {
      expect(codigo, acao).toContain(`falhou("${acao}"`);
    }
    // cada if (error) da página do servidor chama falhou
    const ifs = [...codigo.matchAll(/if \((\w+(?:\.\w+)?)\)\s*(\S+)/g)].filter((m) => /error$/.test(m[1]) || m[1] === "error");
    expect(ifs.length).toBeGreaterThanOrEqual(9);
    for (const m of ifs) expect(m[2], m[0]).toMatch(/^(falhou|\{|return)/);
  });

  it("o erro cru fica só no log do servidor", () => {
    expect(codigo).toMatch(/console\.error\(`\[agente-base\] \$\{acao\}/);
  });
});
