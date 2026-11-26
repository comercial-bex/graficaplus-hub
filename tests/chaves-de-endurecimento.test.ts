import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Onda 2 do diagnóstico de 23/11/2026: seis chaves estrangeiras nas colunas que já guardam o id de outra tabela e tinham 0 órfão
 * no banco vivo (conferido em 26/11/2026). Estas conferências leem a migração: provam quais colunas ganham chave, para onde
 * apontam, o que acontece ao apagar o pai e que NENHUMA coluna polimórfica entrou.
 */

const MIGRACAO = readFileSync("supabase/migrations/20261126200000_chaves_estrangeiras_de_endurecimento.sql", "utf8");
const TIPOS = readFileSync("src/integrations/supabase/types.ts", "utf8");
const SEM_COMENTARIOS = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const CODIGO = SEM_COMENTARIOS(MIGRACAO);

const CHAVES = [
  { tabela: "orcamentos", coluna: "conversa_id", pai: "whatsapp_conversas", acao: "SET NULL" },
  { tabela: "arquivos", coluna: "conversa_id", pai: "whatsapp_conversas", acao: "SET NULL" },
  { tabela: "parceiro_orcamentos", coluna: "os_id", pai: "ordens_servico", acao: "SET NULL" },
  { tabela: "whatsapp_atendimentos", coluna: "responsavel_id", pai: "usuarios", acao: "SET NULL" },
  { tabela: "whatsapp_conversa_leituras", coluna: "user_id", pai: "usuarios", acao: "CASCADE" },
  { tabela: "alertas_integridade", coluna: "fila_id", pai: "notificacoes_fila", acao: "SET NULL" },
] as const;

/** O bloco `tabela: { Row: { ... } }` do arquivo de tipos gerados. */
function linhaDaTabela(tabela: string): string {
  const inicio = TIPOS.indexOf(`      ${tabela}: {\n        Row: {`);
  expect(inicio, `tabela ${tabela} no arquivo de tipos`).toBeGreaterThan(-1);
  return TIPOS.slice(inicio, TIPOS.indexOf("        Insert: {", inicio));
}

describe("as seis chaves", () => {
  for (const c of CHAVES) {
    it(`${c.tabela}.${c.coluna} aponta para ${c.pai} e ao apagar o pai faz ${c.acao}`, () => {
      const nome = `${c.tabela}_${c.coluna}_fkey`;
      const alter = new RegExp(
        `ALTER TABLE public\\.${c.tabela}\\s+ADD CONSTRAINT ${nome} FOREIGN KEY \\(${c.coluna}\\) REFERENCES public\\.${c.pai}\\(id\\) ON DELETE ${c.acao};`,
      );
      expect(CODIGO).toMatch(alter);
      // só entra se ainda não existir: a migração pode ser reaplicada
      expect(CODIGO).toContain(`conname = '${nome}' AND conrelid = 'public.${c.tabela}'::regclass`);
    });
    it(`a coluna ${c.tabela}.${c.coluna} existe no arquivo de tipos do banco`, () => {
      expect(linhaDaTabela(c.tabela)).toMatch(new RegExp(`\\n\\s+${c.coluna}: (string|string \\| null)\\n`));
    });
  }

  it("são exatamente seis e nenhuma tem ação diferente de SET NULL (cinco) ou CASCADE (uma, a que é NOT NULL e parte da chave primária)", () => {
    const todas = [...CODIGO.matchAll(/ADD CONSTRAINT (\w+) FOREIGN KEY/g)].map((m) => m[1]);
    expect(todas).toHaveLength(6);
    expect([...CODIGO.matchAll(/ON DELETE (SET NULL|CASCADE|RESTRICT|NO ACTION)/g)].map((m) => m[1]).sort()).toEqual(
      ["CASCADE", "SET NULL", "SET NULL", "SET NULL", "SET NULL", "SET NULL"],
    );
  });

  it("a que dá CASCADE é a de user_id, que é NOT NULL e faz parte da chave primária (o resto nunca apaga dado do filho)", () => {
    expect(CODIGO).toMatch(/whatsapp_conversa_leituras_user_id_fkey FOREIGN KEY \(user_id\) REFERENCES public\.usuarios\(id\) ON DELETE CASCADE/);
    const bloco = linhaDaTabela("whatsapp_conversa_leituras");
    expect(bloco).toMatch(/\n\s+user_id: string\n/); // sem "| null": NOT NULL
  });
});

describe("nenhuma coluna polimórfica ganha chave", () => {
  it("o id que muda de tabela conforme o tipo ao lado (tasks.current_action_owner_id e parentes) fica de fora", () => {
    expect(CODIGO).not.toMatch(/current_action_owner/);
    expect(CODIGO).not.toMatch(/ALTER TABLE public\.tasks\b/);
  });
});

describe("a migração não aplica a chave às cegas", () => {
  it("recusa com a conta dos órfãos, antes de qualquer ALTER, se algum valor não tiver correspondente", () => {
    const iGuarda = CODIGO.indexOf("DO $guarda$");
    const iPrimeiroAlter = CODIGO.indexOf("ALTER TABLE");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iGuarda).toBeLessThan(iPrimeiroAlter);
    expect(CODIGO).toMatch(/sem correspondente em %\. Corrija os órfãos antes de aplicar a chave\./);
  });

  it("desiste em vez de ficar na fila se a tabela estiver ocupada, e confere no fim que as seis valem para todas as linhas", () => {
    expect(CODIGO).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(CODIGO).toMatch(/NOT v_achou\.convalidated OR v_achou\.confdeltype <> v\.acao::"char"/);
  });

  it("não mexe em dado: nenhum INSERT, UPDATE ou DELETE na migração", () => {
    expect(CODIGO).not.toMatch(/\b(INSERT INTO|UPDATE\s+public\.|DELETE FROM)\b/i);
  });

  it("traz o bloco DESFAZER com as seis chaves", () => {
    const desfazer = MIGRACAO.slice(MIGRACAO.indexOf("-- DESFAZER"));
    expect(desfazer.match(/DROP CONSTRAINT/g)).toHaveLength(6);
  });
});

describe("a chave nova não deixa nenhuma consulta embutida do PostgREST ambígua", () => {
  // Uma chave nova entre duas tabelas que já tinham outra pode fazer `tabela(...)` dentro de `.select` falhar com PGRST201.
  // Conferido em 26/11/2026: nenhum `.select` do código embute estes pares sem dica. Este teste trava a regressão no que ainda
  // pode ser lido pelo código-fonte.
  const FONTES = [
    "src/routes/_authenticated/arquivos.tsx",
    "src/components/whatsapp/usar-caixa-de-entrada.ts",
    "src/routes/parceiro.compras.tsx",
    "src/routes/_authenticated/vendas-diretas.tsx",
  ].map((f) => readFileSync(f, "utf8"));
  it("nenhuma consulta embute whatsapp_conversas a partir de orcamentos ou arquivos, nem ordens_servico a partir de parceiro_orcamentos", () => {
    const junto = FONTES.join("\n");
    expect(junto).not.toMatch(/from\("orcamentos"\)[\s\S]{0,200}whatsapp_conversas\(/);
    expect(junto).not.toMatch(/from\("arquivos"\)[\s\S]{0,200}whatsapp_conversas\(/);
    expect(junto).not.toMatch(/from\("parceiro_orcamentos"\)[\s\S]{0,300}ordens_servico\(/);
  });
});
