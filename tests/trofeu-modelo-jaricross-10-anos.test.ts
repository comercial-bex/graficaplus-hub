import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A migração que cadastra o modelo "JariCross 10 Anos" (26/11/2026). Lê o texto da migração: provam-se as peças que entram, o que
 * deliberadamente NÃO entra (a base de preto 10 mm, sem material nem preço no cadastro) e que ela só acrescenta.
 */

const MIGRACAO = readFileSync("supabase/migrations/20261126300000_trofeu_modelo_jaricross_10_anos.sql", "utf8");
const SEM_COMENTARIOS = (s: string) => s.replace(/^\s*--.*$/gm, "");
const CODIGO = SEM_COMENTARIOS(MIGRACAO);
const SEED = readFileSync("supabase/migrations/20261122200000_trofeu_catalogo_e_regras.sql", "utf8");

describe("o modelo JariCross 10 Anos", () => {
  it("entra como econômico, de 18 cm, provisório, com o nome que a ficha escreve (é por ele que a leitura o acha)", () => {
    expect(CODIGO).toMatch(/SELECT 'JariCross 10 Anos', 'economico'/);
    expect(CODIGO).toMatch(/0\.180, 20\.0, 3\.00, true/);
  });

  it("tem duas peças, e cada uma usa um material que EXISTE no cadastro de materiais", () => {
    expect(CODIGO).toMatch(/\(1, 'Placa principal \(formato capacete\)', 'ACRILICO CRISTAL VIRGEM 6MM', 6\.0, 0\.200, 0\.150, 1, 1\.35, 'vinil_laminado'\)/);
    expect(CODIGO).toMatch(/\(2, 'Placa frontal da base',\s+'ACRILICO BRANCO VIRGEM 2MM',\s+2\.0, 0\.160, 0\.040, 1, 1\.00, 'vinil_laminado'\)/);
    // os dois materiais são os do cadastro do banco vivo: o do cristal 6 mm está nas migrações do acrílico e o do branco 2 mm também
    const todas = ["ACRILICO CRISTAL VIRGEM 6MM", "ACRILICO BRANCO VIRGEM 2MM"];
    const migracoes = readFileSync("supabase/migrations/20261122200000_trofeu_catalogo_e_regras.sql", "utf8");
    expect(migracoes).toContain(todas[0]);
    expect(CODIGO).toContain(todas[1]);
    expect(CODIGO).toMatch(/count\(\*\) FROM public\.materiais WHERE nome = 'ACRILICO CRISTAL VIRGEM 6MM'\) <> 1/);
  });

  it("a BASE de acrílico preto de 10 mm NÃO entra e a descrição avisa que o preço não a inclui (sem custo inventado)", () => {
    expect(CODIGO).not.toMatch(/'Base'/);
    expect(CODIGO).not.toMatch(/PRETO VIRGEM 10MM/);
    expect(CODIGO).toContain("ATENÇÃO: falta a BASE de acrílico preto brilhante de 10 mm");
    expect(CODIGO).toContain("o preço deste modelo NÃO inclui a base");
    // nenhum material novo e nenhum custo: a migração não mexe em `materiais`
    expect(CODIGO).not.toMatch(/INSERT INTO public\.materiais|UPDATE public\.materiais|custo_/i);
  });

  it("só acrescenta: duas inserções, sem UPDATE nem DELETE, e reaplicar não duplica", () => {
    expect([...CODIGO.matchAll(/INSERT INTO public\.(\w+)/g)].map((m) => m[1])).toEqual(["trofeu_modelos", "trofeu_pecas"]);
    expect(CODIGO).not.toMatch(/\bUPDATE\s+public\.|\bDELETE FROM\b/i);
    expect(CODIGO).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM public\.trofeu_modelos WHERE nome = 'JariCross 10 Anos'\)/);
    expect(CODIGO).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM public\.trofeu_pecas p WHERE p\.modelo_id = m\.id AND p\.ordem = v\.ordem\)/);
  });

  it("confere no fim que o modelo ficou ativo e provisório e que os três de antes seguem lá", () => {
    expect(CODIGO).toMatch(/provisorio AND ativo/);
    for (const nome of ["Troféu econômico", "Troféu padrão em duas camadas", "Troféu premium em camadas"]) {
      expect(CODIGO).toContain(`'${nome}'`);
      expect(SEED).toContain(`'${nome}'`);
    }
    expect(MIGRACAO).toMatch(/DESFAZER/);
  });

  it("o fator de forma e o tempo de mão de obra vêm dos modelos que já existem (econômico 1,35 e 15 min; padrão 25 min)", () => {
    expect(SEED).toMatch(/'Troféu econômico', 1, 'Placa principal', 'ACRILICO CRISTAL VIRGEM 2MM', 2\.0, 0\.200, 0\.160, 1, 1\.35, 'vinil_laminado'/);
    expect(SEED).toMatch(/0\.180, 15\.0, 3\.00/);
    expect(SEED).toMatch(/0\.180, 25\.0, 3\.00/);
  });
});
