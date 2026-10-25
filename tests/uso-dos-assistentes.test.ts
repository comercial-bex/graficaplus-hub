import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { duracaoLegivel, taxaDeConclusao } from "@/components/configuracoes/uso-dos-assistentes";

const SQL = readFileSync("supabase/migrations/20261025950000_uso_dos_assistentes.sql", "utf8");
const LIB = readFileSync("src/lib/uso-de-telas.ts", "utf8");
const CASCA = readFileSync("src/components/bex/assistente-em-passos.tsx", "utf8");

describe("o relatório", () => {
  it("escreve a duração como gente", () => {
    expect(duracaoLegivel(48)).toBe("48 s");
    expect(duracaoLegivel(65)).toBe("1 min 05 s");
    expect(duracaoLegivel(null)).toBe("—");
  });
  it("a taxa de conclusão não divide por zero", () => {
    expect(taxaDeConclusao({ aberturas: 4, concluidas: 3 })).toBe("75%");
    expect(taxaDeConclusao({ aberturas: 0, concluidas: 0 })).toBe("—");
  });
});

describe("o banco", () => {
  it("cada pessoa só grava o próprio uso e só o administrador lê", () => {
    expect(SQL).toContain("WITH CHECK (usuario_id = (SELECT auth.uid()))");
    expect(SQL).toContain("has_role((SELECT auth.uid()), 'admin')");
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.uso_dos_assistentes(integer) FROM PUBLIC, anon",
    );
  });
  it("só aceita os quatro eventos e não guarda texto digitado", () => {
    expect(SQL).toContain("'abriu', 'passo', 'fechou', 'concluiu'");
    expect(SQL).not.toMatch(/\b(valor|conteudo|texto|nome_digitado)\b\s+text/);
  });
  it("as colunas de saída da função não colidem com as da tabela (erro pego no ensaio)", () => {
    expect(SQL).toContain("SELECT x.tela, x.ultimo_passo, count(*) AS n");
  });
});

describe("o registro na tela", () => {
  it("falha em silêncio e não grava sem abertura em curso", () => {
    expect(LIB).toContain("if (!sessao) return;");
    expect(LIB).toContain("() => undefined");
  });
  it("a casca comum registra abriu, passo e fechou, e os cinco assistentes usam a casca com o nome da tela", () => {
    expect(CASCA).toContain("useUsoDoAssistente(tela, aberto, atual)");
    const telas = [
      ["cliente/novo-cliente-em-passos", "novo-cliente"],
      ["maquinas/nova-maquina-em-passos", "nova-maquina"],
      ["usuarios/novo-usuario-em-passos", "novo-usuario"],
      ["produtos/novo-produto-em-passos", "novo-produto"],
      ["materiais/novo-insumo-em-passos", "novo-material"],
    ];
    for (const [f, tela] of telas) {
      const fonte = readFileSync(`src/components/${f}.tsx`, "utf8");
      expect(fonte, f).toContain("<AssistenteEmPassos");
      expect(fonte, f).toContain(`tela="${tela}"`);
      expect(fonte, f).not.toContain("useUsoDoAssistente(");
    }
  });
  it("os cinco assistentes anotam a conclusão", () => {
    const arquivos = [
      ["cliente/novo-cliente-em-passos", "novo-cliente"],
      ["maquinas/nova-maquina-em-passos", "nova-maquina"],
      ["usuarios/novo-usuario-em-passos", "novo-usuario"],
      ["produtos/novo-produto-em-passos", "novo-produto"],
      ["materiais/novo-insumo-em-passos", "novo-material"],
    ];
    for (const [f, tela] of arquivos) {
      expect(readFileSync(`src/components/${f}.tsx`, "utf8"), f).toContain(
        `registrarUso("${tela}", "concluiu")`,
      );
    }
  });
  it("o relatório aparece só para o administrador", () => {
    expect(readFileSync("src/routes/_authenticated/configuracoes-empresa.tsx", "utf8")).toContain(
      'hasRole("admin") && <UsoDosAssistentes />',
    );
  });
});
