import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PASTA_MIGRACOES, RAIZ, corpoDa, lerDoc, lerMigracao, md5, semComentarios } from "./apoio/corpo-da-funcao";

/**
 * Aviso de aprovação só quando o próprio cliente aprova pelo link (18/11/2026): contrato da migração lido como TEXTO.
 * O ensaio no banco está em docs/ensaio-aviso-de-aprovacao-so-pelo-cliente.md (para quem aplica rodar).
 */
const NOME = "20261118100000_aviso_de_aprovacao_so_quando_o_cliente_aprova.sql";
const sql = lerMigracao(NOME);
const codigo = semComentarios(sql);
const doc = lerDoc("ensaio-aviso-de-aprovacao-so-pelo-cliente.md");
const vivo = readFileSync(join(RAIZ, "tests", "apoio", "tg-orcamento-notificar-cliente-vivo.sql"), "utf8");
const corpoVivo = corpoDa(vivo, "tg_orcamento_notificar_cliente(");

const MD5_VIVO = "3bc4800aeeb4a19dbaad743d0043bffb";
const MD5_NOVO = "f8f046865519aecd647bb88b185965d0";
const ANCORA = "IF NEW.status::text <> 'aprovado' OR OLD.status::text = 'aprovado' THEN RETURN NEW; END IF;";

function guardaDaMigracao(): string {
  const m = /v_guarda text := \$g\$([\s\S]*?)\$g\$;/.exec(sql);
  if (!m) throw new Error("sem v_guarda");
  return m[1];
}
const corpoNovo = corpoVivo.replace(ANCORA, ANCORA + guardaDaMigracao());

describe("arquivo, ordem e escopo", () => {
  it("prefixo único, depois da trava de transição, transação única", () => {
    expect(readdirSync(PASTA_MIGRACOES).filter((n) => n.startsWith("20261118100000_"))).toEqual([NOME]);
    expect("20261118100000_" > "20261117235000_").toBe(true);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toMatch(/NÃO APLICADA e NÃO ENSAIADA/);
  });

  it("não faz DML, não cria nem derruba gatilho, não toca em fila, bloqueio, reviewer nem cobrança", () => {
    const fora = codigo.replace(/\$troca\$[\s\S]*?\$troca\$/g, "");
    expect(fora).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|ALTER\s|DROP\s|CREATE\s)/i);
    expect(codigo).not.toMatch(/CREATE TRIGGER|DROP TRIGGER|whatsapp_numeros_bloqueados|reviewer|cobranca|notificacao_templates/i);
    expect(codigo).not.toMatch(/tg_os_notificar_cliente|lembrete_orcamentos_aprovados_sem_os/i);
  });
});

describe("o corpo vivo conferido e a troca por âncora única", () => {
  it("o fixture do corpo vivo tem o md5 lido no banco e a âncora aparece uma vez", () => {
    expect(md5(corpoVivo)).toBe(MD5_VIVO);
    expect(corpoVivo.split(ANCORA)).toHaveLength(2);
    expect(sql).toContain(`'${MD5_VIVO}'`);
  });

  it("a migração confere o md5 vivo, a âncora e o md5 do corpo novo, na ordem certa", () => {
    expect(codigo).toContain(`'${MD5_VIVO}'`);
    expect(codigo).toContain(`'${MD5_NOVO}'`);
    expect(codigo).toContain("pg_get_functiondef(v_oid)");
    expect(codigo).toContain(`v_ancora text := $a$${ANCORA}$a$;`);
    expect(codigo).toContain("IF v_vezes <> 1 THEN");
    expect(codigo.indexOf(MD5_VIVO)).toBeLessThan(codigo.indexOf("pg_get_functiondef(v_oid)"));
    expect(codigo.indexOf("IF v_vezes <> 1")).toBeLessThan(codigo.indexOf("EXECUTE replace("));
    expect(codigo.indexOf("EXECUTE replace(")).toBeLessThan(codigo.lastIndexOf(MD5_NOVO));
    expect(codigo).toContain("EXECUTE replace(v_def, v_ancora, v_ancora || v_guarda);");
  });

  it("aplicar a troca no corpo vivo dá exatamente o corpo de md5 ensaiado", () => {
    expect(md5(corpoNovo)).toBe(MD5_NOVO);
    expect(doc).toContain(MD5_NOVO);
    expect(doc).toContain(MD5_VIVO);
  });
});

describe("o que o corpo novo faz", () => {
  it("o resto do corpo é idêntico: sem a guarda sobra o corpo vivo", () => {
    expect(corpoNovo.replace(guardaDaMigracao(), "")).toBe(corpoVivo);
  });

  it("avisa só com aprovado_por_nome preenchido nesta atualização, depois da guarda de status", () => {
    const g = guardaDaMigracao();
    expect(g).toContain("NULLIF(btrim(COALESCE(NEW.aprovado_por_nome, '')), '') IS NULL");
    expect(g).toContain("NEW.aprovado_por_nome IS NOT DISTINCT FROM OLD.aprovado_por_nome");
    expect(g).toContain("RETURN NEW; END IF;");
    expect(corpoNovo.indexOf(ANCORA)).toBeLessThan(corpoNovo.indexOf("aprovado_por_nome"));
    expect(corpoNovo.indexOf("aprovado_por_nome")).toBeLessThan(corpoNovo.indexOf("enfileirar_notificacao"));
  });

  it("mesma chave de idempotência, mesmo template e mesmo destino", () => {
    for (const t of [
      "'orcamento:' || NEW.id::text || ':aprovado'",
      "'orcamento_aprovado', 'orcamento', NEW.id, 'orcamento_aprovado'",
      "COALESCE(v_cliente.whatsapp_principal, v_cliente.telefone, NEW.contato_telefone)",
    ]) {
      expect(corpoNovo).toContain(t);
    }
  });

  it("a coluna existe no schema e a aprovação da equipe nunca a grava", () => {
    const tipos = readFileSync(join(RAIZ, "src", "integrations", "supabase", "types.ts"), "utf8");
    expect(tipos).toContain("aprovado_por_nome");
    const aprovarEquipe = corpoDa(lerMigracao("20261117190000_aprovacao_e_renovacao_por_funcao.sql"), "aprovar_orcamento(");
    expect(aprovarEquipe).not.toContain("aprovado_por_nome");
  });
});

describe("texto da migração e do doc", () => {
  it("o doc embute a troca, os seis casos e termina em RAISE EXCEPTION", () => {
    expect(doc).toContain("DO $troca$");
    expect(doc).toContain("RAISE EXCEPTION E'ENSAIO");
    for (const c of ["[1]", "[2]", "[3]", "[4]", "[5]", "[6]"]) expect(doc).toContain(c);
    for (const f of ["responder_orcamento_publico", "aprovar_orcamento", "sync_orcamento_3d_para_funil", "api_executar"]) {
      expect(doc).toContain(f);
    }
  });

  it("mostra antes e depois de cada caminho de aprovação", () => {
    expect(sql).toMatch(/link do cliente[^\n]*antes: avisa\s+depois: avisa/);
    expect(sql).toMatch(/botão Aprovar[^\n]*antes: avisa\s+depois: NÃO avisa/);
    expect(doc).toContain("| Link do cliente");
    expect(doc).toContain("**não**");
  });
});

describe("tela da equipe não promete aviso ao cliente", () => {
  const raiz = join(__dirname, "..");
  it("a confirmação de aprovar diz que o cliente não recebe aviso", () => {
    const tela = readFileSync(join(raiz, "src/components/orcamento/acoes-do-status.tsx"), "utf8");
    expect(tela).toContain("O cliente não recebe aviso no WhatsApp por isso");
    expect(tela).not.toContain("O cliente pode receber um aviso");
  });
  it("a tela de avisos automáticos diz que o aviso é da aprovação pelo link", () => {
    const card = readFileSync(join(raiz, "src/components/notificacoes/templates-automaticos-card.tsx"), "utf8");
    expect(card).toContain("quando o próprio cliente aprova o orçamento pelo link");
  });
  it("texto novo sem travessão, seta nem parênteses", () => {
    const tela = readFileSync(join(raiz, "src/components/orcamento/acoes-do-status.tsx"), "utf8");
    const frase = /O cliente não recebe aviso[^"]*/.exec(tela)?.[0] ?? "";
    expect(frase.length).toBeGreaterThan(10);
    expect(frase).not.toMatch(/[—–→()]|->/);
  });
});
