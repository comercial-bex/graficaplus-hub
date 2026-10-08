import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * PREFIXO DE MIGRAÇÃO É ÚNICO.
 *
 * Duas migrações com o mesmo prefixo rodam em ordem alfabética do resto do
 * nome — ninguém escolhe essa ordem. Em 31/05/2026 sete arquivos nasceram com
 * 20260531203000: _permission_matrix_rls tirou a regra "a equipe grava item de
 * OS e de orçamento" e _separate_financial_rls_views, que roda depois só
 * porque "s" vem depois de "p", recriou a regra. Por mais de quatro meses a
 * equipe inteira pôde mudar preço de item pela API (fechado em 20261008043700).
 *
 * Com várias sessões trabalhando em paralelo, dois branches podem escolher o
 * mesmo prefixo; este teste fica vermelho no main assim que os dois entrarem.
 * O lote antigo fica congelado aqui: renomear migração já aplicada mudaria a
 * versão que o banco registrou.
 */

const PASTA_MIGRACOES = join(__dirname, "..", "supabase/migrations");

const REPETIDOS_ANTIGOS: Record<string, string[]> = {
  "20260531203000": [
    "20260531203000_automacoes_whatsapp.sql",
    "20260531203000_expandir_arquivos_aprovacoes.sql",
    "20260531203000_os_resultados_fechar_os.sql",
    "20260531203000_permission_matrix_rls.sql",
    "20260531203000_relatorios_prioritarios.sql",
    "20260531203000_replace_mock_modules.sql",
    "20260531203000_separate_financial_rls_views.sql",
  ],
};

describe("prefixo de migração", () => {
  it("cada prefixo de 14 dígitos aparece uma vez só (fora o lote antigo congelado)", () => {
    const porPrefixo = new Map<string, string[]>();
    for (const arquivo of readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith(".sql")).sort()) {
      const prefixo = arquivo.slice(0, 14);
      porPrefixo.set(prefixo, [...(porPrefixo.get(prefixo) ?? []), arquivo]);
    }
    const repetidos = Object.fromEntries([...porPrefixo].filter(([, arquivos]) => arquivos.length > 1));
    expect(
      repetidos,
      "Duas migrações com o mesmo prefixo rodam em ordem alfabética do nome. Renomeie a SUA (a que ainda não foi aplicada) para um prefixo livre.",
    ).toEqual(REPETIDOS_ANTIGOS);
  });
});
