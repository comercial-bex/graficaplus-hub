import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migracao = readFileSync(
  "supabase/migrations/20261121120000_higiene_lembretes_e_laco_do_chao.sql",
  "utf8",
);

describe("migração: higiene dos lembretes e laço do chão (21/11/2026)", () => {
  it("troca só o corpo de duas funções, com o md5 de antes e o de depois conferidos", () => {
    expect(migracao).toContain("5a5f75b4abb65cf763a18226107b6581");
    expect(migracao).toContain("5efedcc3af2f1af0ded8f11646f1a07b");
    expect(migracao).toContain("7ed3350d7810cac624fc63a8c61ac1bd");
    expect(migracao).toContain("c52e2e74fc0b7c543839f2c8c5c63007");
    expect(migracao).not.toContain("PREENCHER");
    expect(migracao).toMatch(/pg_get_functiondef\('public\.lembrete_orcamentos_aprovados_sem_os'::regproc\)/);
    expect(migracao).toMatch(/pg_get_functiondef\('public\.lembretes_da_equipe'::regproc\)/);
  });

  it("não cria função nem mexe em permissão: CREATE OR REPLACE mantém os grants", () => {
    expect(migracao).not.toMatch(/^\s*(GRANT|REVOKE)\b/m);
    expect(migracao).not.toMatch(/CREATE\s+(OR REPLACE\s+)?FUNCTION/i);
    expect(migracao).toContain("has_function_privilege('anon'");
  });

  it("o aviso aos gestores só olha quem está ativo", () => {
    expect(migracao).toContain(
      "WHERE u.ativo IS NOT FALSE AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'gestor')",
    );
  });

  it("o bloco do laço do chão cobra OS em produção sem máquina, sem apontamento aberto e sem job 3D", () => {
    expect(migracao).toContain("Em produção, mas ninguém começou numa máquina");
    expect(migracao).toContain("os.status::text = 'em_producao'");
    expect(migracao).toContain("os.maquina_id IS NULL");
    expect(migracao).toContain("a.finalizado_em IS NULL");
    expect(migracao).toContain("NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j WHERE j.os_id = os.id)");
    expect(migracao).toContain('use "Começar na máquina"');
  });

  it("o bloco novo tem EXCEPTION próprio: se falhar, o aviso diário sai como saía", () => {
    const bloco = migracao.slice(
      migracao.indexOf("-- 12. OS em produção que ninguém começou"),
      migracao.indexOf("$bloco$;"),
    );
    expect(bloco).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(bloco).toContain("RAISE WARNING");
  });

  it("é uma transação só, com guarda de corpo e conferência final", () => {
    expect(migracao).toMatch(/^BEGIN;$/m);
    expect(migracao).toMatch(/^COMMIT;$/m);
    expect(migracao).toContain("mudou no banco");
    expect(migracao).toContain("a âncora do aviso da equipe aparece");
  });
});

describe("os documentos do pacote", () => {
  it("o ensaio registra o achado do bloqueio que não barrava a fila de automações", () => {
    const doc = readFileSync("docs/ensaio-higiene-lembretes-e-laco-do-chao-21-11-2026.md", "utf8");
    expect(doc).toContain("4 envios ao número bloqueado");
    expect(doc).toContain("7ed3350d7810cac624fc63a8c61ac1bd");
    expect(doc).toContain("c52e2e74fc0b7c543839f2c8c5c63007");
  });

  it("o plano tem as cinco frentes e a regra de não reenviar PDF", () => {
    const plano = readFileSync("docs/plano-para-chegar-aos-100-21-11-2026.md", "utf8");
    for (const frente of [
      "Frente 1. Fechar o laço do chão",
      "Frente 2. Limpar o quadro",
      "Frente 3. Destravar o funil",
      "Frente 4. Valores dos orçamentos",
      "Frente 5. Higiene menor",
    ]) {
      expect(plano).toContain(frente);
    }
    expect(plano).toContain("nenhum PDF é reenviado ao cliente por nós");
  });

  it("o AGENTS.md não diz mais que a trava de status do orçamento está por aplicar", () => {
    const agents = readFileSync("AGENTS.md", "utf8");
    expect(agents).not.toContain("NOT applied until the owner runs it");
    expect(agents).toContain("tg_orcamento_transicao_de_status");
  });
});
