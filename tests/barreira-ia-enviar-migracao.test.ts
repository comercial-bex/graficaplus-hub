import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A barreira no banco do envio da assistente de texto livre: o contrato da migração, do roteiro de ensaio e do código que
 * trata a recusa, lidos como TEXTO (nada aqui fala com banco). O que o SQL faz de verdade foi provado no banco vivo, dentro de
 * uma transação desfeita, e está em docs/ensaio-barreira-ia-enviar.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261115130000_barreira_no_banco_ia_enviar.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-barreira-ia-enviar.md"), "utf8");
const servidor = readFileSync(
  join(RAIZ, "src", "lib", "api", "whatsapp-assistente.server.ts"),
  "utf8",
);
const original = readFileSync(
  join(RAIZ, "drizzle", "migrations", "0002_whatsapp_caixa_v3_filas_atendimentos_ia.sql"),
  "utf8",
);

const MD5_ANTIGO = "d841150f076a0f67022f51353aad5951";
const MD5_NOVO = "9bdd6735ab66704bbe586dcf578694d6";

const md5 = (t: string) => createHash("md5").update(t).digest("hex");
const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

function comandosSemWhere(s: string): string[] {
  const achados: string[] = [];
  const re =
    /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+(?:\w+\s+)?SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of s.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

/** O que está entre `$tag$` e `$tag$`, na primeira vez. */
function dolar(texto: string, tag: string): string {
  const m = texto.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
  if (!m) throw new Error(`sem $${tag}$`);
  return m[1];
}

/** O corpo de whatsapp_ia_enviar como o banco guarda em `prosrc`, lido do arquivo que o criou. */
function corpoOriginal(): string {
  const m = original.match(
    /FUNCTION public\.whatsapp_ia_enviar\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
  );
  if (!m) throw new Error("sem o corpo original de whatsapp_ia_enviar");
  return m[1];
}

const ancora = dolar(sql, "a");
const bloco = dolar(sql, "bloco");
const corpoNovo = corpoOriginal().replace(ancora, ancora + bloco);

const blocosSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const ensaio = blocosSql.find((b) => b.includes("ENSAIO OK"))!;
const volta = blocosSql.find((b) => b.includes("DO $volta$"))!;

describe("barreira: arquivo e escopo", () => {
  it("vem depois da última migração e o prefixo de data é único", () => {
    expect(NOME > "20261115120000_agente_validador_mais_firme.sql").toBe(true);
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
  });

  it("troca UMA função e não toca em tabela, gatilho, política, coluna nem tipo", () => {
    expect(codigo).not.toMatch(/\bDROP\b/i);
    expect(codigo).not.toMatch(/\bALTER\b/i);
    expect(codigo).not.toMatch(/\bCREATE\s+(TABLE|TRIGGER|POLICY|TYPE|INDEX|VIEW|EXTENSION)\b/i);
    expect(codigo).not.toMatch(/\bINSERT\s+INTO\b/i);
    // a única função que a migração troca é whatsapp_ia_enviar, por EXECUTE sobre a definição viva
    expect([...codigo.matchAll(/^\s*EXECUTE\s/gm)]).toHaveLength(1);
    expect(codigo).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(sql).toContain("to_regprocedure('public.whatsapp_ia_enviar(uuid, text, jsonb)')");
  });

  it("nenhum UPDATE nem DELETE sem WHERE (safeupdate)", () => {
    expect(comandosSemWhere(codigo)).toEqual([]);
    expect(codigo).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
  });

  it("abre com BEGIN e lock_timeout curto, fecha com COMMIT", () => {
    const i = sql.indexOf("BEGIN;");
    const j = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    const k = sql.lastIndexOf("COMMIT;");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(sql.indexOf("DO $confere$"));
    expect(sql.slice(k).trim()).toBe("COMMIT;");
  });

  it("ACL pelo nome: revoga PUBLIC, anon e authenticated, e só o service_role executa", () => {
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;",
    );
    expect(codigo).toContain(
      "GRANT EXECUTE ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) TO service_role;",
    );
    expect([...codigo.matchAll(/\bGRANT\b/g)]).toHaveLength(1);
    expect([...codigo.matchAll(/\bREVOKE\b/g)]).toHaveLength(1);
  });
});

describe("barreira: troca na definição viva, com os md5 provados", () => {
  it("o corpo do repositório é o corpo vivo lido em 15/11/2026, e o corpo novo tem o md5 do ensaio", () => {
    expect(md5(corpoOriginal())).toBe(MD5_ANTIGO);
    expect(md5(corpoNovo)).toBe(MD5_NOVO);
    expect(sql).toContain(`v_md5_lido constant text := '${MD5_ANTIGO}'`);
    expect(sql).toContain(`<> '${MD5_NOVO}'`);
  });

  it("a âncora existe UMA vez no corpo e a migração confere isso, e a marca torna a segunda rodada inofensiva", () => {
    expect(corpoOriginal().split(ancora)).toHaveLength(2);
    expect(ancora).toBe("  IF v_texto = '' THEN RAISE EXCEPTION 'Texto vazio.'; END IF;\n");
    expect(sql).toContain("v_n <> 1");
    expect(sql).toContain("EXECUTE replace(v_def, v_ancora, v_ancora || v_bloco);");
    expect(sql).toContain("v_marca constant text := '-- BARREIRA NO BANCO (15/11/2026)';");
    expect(bloco).toContain("-- BARREIRA NO BANCO (15/11/2026)");
    expect(sql).toContain(
      "RAISE NOTICE 'A barreira já está em whatsapp_ia_enviar: nada a fazer.';",
    );
  });

  it("para sem trocar se o corpo vivo for outro", () => {
    expect(sql).toContain("(SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> v_md5_lido");
    expect(sql).toContain("mudou desde 15/11/2026");
  });
});

describe("barreira: o bloco", () => {
  it("chama o validador do banco, ramo cliente, sobre exatamente o texto que seria gravado", () => {
    expect(bloco).toContain(
      "public._agente_problemas_de_texto(left(v_texto, 4096), ARRAY['cliente']::public.triagem_ramo[])",
    );
    // o corpo grava left(v_texto, 4096): é o mesmo texto
    expect(corpoNovo).toContain("left(v_texto, 4096), c.cliente_id");
  });

  it("falha fechada: validador sem resposta também recusa", () => {
    expect(bloco).toContain("IF v_regras IS NULL OR cardinality(v_regras) > 0 THEN");
    expect(bloco).toContain("'validador_sem_resposta'");
  });

  it("a mensagem leva só o nome das regras, nunca o texto, e o prefixo é o que o código do servidor reconhece", () => {
    const raise = bloco.match(/RAISE EXCEPTION '([^']*)', ([^\n]*)/);
    expect(raise).not.toBeNull();
    expect(raise![1]).toBe("texto_reprovado_pela_barreira: %");
    expect(raise![2]).not.toMatch(/v_texto|p_texto/);
    const prefixo = servidor.match(/export const PREFIXO_DA_BARREIRA = "([^"]+)"/);
    expect(prefixo![1]).toBe("texto_reprovado_pela_barreira:");
    expect(raise![1].startsWith(prefixo![1])).toBe(true);
  });

  it("recusa ANTES da trava da conversa e de qualquer escrita, e DEPOIS da checagem de texto vazio", () => {
    const iVazio = corpoNovo.indexOf("Texto vazio.");
    const iBarreira = corpoNovo.indexOf("-- BARREIRA NO BANCO");
    const iTrava = corpoNovo.indexOf("FOR UPDATE");
    const iInsert = corpoNovo.indexOf("INSERT INTO");
    const iUpdate = corpoNovo.indexOf("UPDATE public.whatsapp_conversas");
    expect(iVazio).toBeGreaterThan(-1);
    expect(iBarreira).toBeGreaterThan(iVazio);
    expect(iTrava).toBeGreaterThan(iBarreira);
    expect(iInsert).toBeGreaterThan(iBarreira);
    expect(iUpdate).toBeGreaterThan(iBarreira);
  });

  it("o resto do corpo ficou igual: o corpo novo é o antigo mais o bloco, nada além", () => {
    expect(corpoNovo.replace(bloco, "")).toBe(corpoOriginal());
  });
});

describe("barreira: a conferência final da migração", () => {
  const confere = sql.slice(sql.indexOf("DO $confere$"));

  it("confere função única, marca, md5, ACL, search_path e modo de segurança", () => {
    expect(confere).toContain("tem % versões (esperado 1)");
    expect(confere).toContain("o bloco novo não entrou no corpo da função");
    expect(confere).toContain("não tem o md5 do ensaio");
    expect(confere).toContain("a ACL de whatsapp_ia_enviar mudou");
    expect(confere).toContain("'search_path=public' = ANY (proconfig) AND prosecdef");
  });

  it("recusa os textos proibidos com a regra esperada, deixa passar os liberados e não grava nada", () => {
    for (const regra of [
      "preco_com_numero",
      "prazo_prometido",
      "forma_de_pagamento",
      "orcamento_feito_pelo_agente",
    ]) {
      expect(confere).toContain(`'${regra}'`);
    }
    expect(confere).toContain("'Conversa não encontrada.'");
    expect(confere).toContain("'Texto vazio.'");
    expect(confere).toContain("Vou chamar alguém da equipe para continuar com você.");
    expect(confere).toContain("Assim que abrirmos, alguém da equipe responde você.");
    expect(confere).toContain("a recusa não pode repetir o texto");
    expect(confere).toContain("a conferência gravou mensagem ou fila da assistente");
  });
});

describe("barreira: ninguém além da assistente de texto livre chama a função", () => {
  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((n) => {
      const p = join(pasta, n);
      return statSync(p).isDirectory() ? arquivos(p) : [p];
    });
  }

  it("no código, só o servidor da assistente a chama; um chamador novo obriga a rever a barreira", () => {
    const chamadores = arquivos(join(RAIZ, "src"))
      .filter(
        (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(join("integrations", "supabase", "types.ts")),
      )
      .filter((p) => /(\)|rpc)\(\s*["']whatsapp_ia_enviar["']/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(RAIZ.length + 1));
    expect(chamadores).toEqual([join("src", "lib", "api", "whatsapp-assistente.server.ts")]);
  });

  it("no banco, nenhuma migração a chama de dentro de outra função (só a conferência desta)", () => {
    const outras = readdirSync(PASTA)
      .filter((n) => n.endsWith(".sql") && n !== NOME)
      .filter((n) =>
        /\b(PERFORM|SELECT)\s+(public\.)?whatsapp_ia_enviar\s*\(/i.test(
          semComentarios(readFileSync(join(PASTA, n), "utf8")),
        ),
      );
    expect(outras).toEqual([]);
  });
});

describe("barreira: o servidor trata a recusa como texto reprovado", () => {
  it("enviar() reconhece o prefixo e devolve as regras; outra falha continua sendo erro", () => {
    expect(servidor).toContain("export function regrasDaBarreira(");
    expect(servidor).toContain("const regras = regrasDaBarreira(error.message);");
    expect(servidor).toContain("if (regras) return { ok: false, regras };");
    expect(servidor).toContain(
      "throw new Error(`falha ao enfileirar a resposta: ${error.message}`);",
    );
    expect(servidor).toContain(
      "return envio.ok ? { enviado: true, mensagemId: envio.mensagemId } : { enviado: false, regras: envio.regras };",
    );
  });

  it("só nomes de regra passam para o log", () => {
    expect(servidor).toContain("/^[a-z][a-z0-9_]{0,40}$/.test(r)");
  });
});

describe("barreira: o roteiro de ensaio", () => {
  it("traz o mesmo bloco e a mesma troca da migração, com os md5", () => {
    expect(doc).toContain(MD5_ANTIGO);
    expect(doc).toContain(MD5_NOVO);
    expect(ensaio).toContain(bloco);
    expect(ensaio).toContain(ancora);
    expect(ensaio).toContain(`'${MD5_NOVO}'`);
    expect(volta).toContain(bloco);
    expect(volta).toContain(`<> '${MD5_NOVO}'`);
    expect(volta).toContain(`<> '${MD5_ANTIGO}'`);
  });

  it("o ensaio desfaz tudo: termina em RAISE EXCEPTION e não tem COMMIT nem BEGIN", () => {
    const sem = semComentarios(ensaio);
    expect(sem).not.toMatch(/\bCOMMIT\s*;/i);
    expect(sem).not.toMatch(/^\s*BEGIN;/im);
    expect(ensaio.trimEnd().endsWith("END $relatorio$;")).toBe(true);
    expect(ensaio).toContain("RAISE EXCEPTION E'ENSAIO OK (desfeito de propósito)");
    expect(comandosSemWhere(semComentarios(ensaio))).toEqual([]);
  });

  it("sonda cada origem antes e depois e exige que só whatsapp_ia_enviar mude", () => {
    for (const sonda of ["A1", "A2", "A3", "A4", "A5", "B1", "C1", "D1", "D2", "E1", "E2"])
      expect(ensaio).toContain(`'${sonda} `);
    expect(ensaio).toContain("SELECT pg_temp._sondar('antes');");
    expect(ensaio).toContain("SELECT pg_temp._sondar('depois');");
    expect(ensaio).toContain("public._wa_enfileirar_mensagem_da_equipe(");
    expect(ensaio).toContain("public.whatsapp_responder(");
    expect(ensaio).toContain("public.triagem_enviar(");
    expect(ensaio).toContain("public.agente_registrar(");
    expect(ensaio).toContain("'whatsapp_ia_enviar(uuid,text,jsonb)'");
    expect(ensaio).toContain("a troca não foi só whatsapp_ia_enviar");
    expect(ensaio).toContain("mudou o que não devia");
    expect(ensaio).toContain("uma origem humana ou de sistema deixou de aceitar");
  });

  it("a matriz tem 20 textos proibidos e 12 liberados, e o roteiro registra o resultado", () => {
    expect([...ensaio.matchAll(/\('F proibido', /g)]).toHaveLength(20);
    expect([...ensaio.matchAll(/\('F liberado', /g)]).toHaveLength(12);
    expect(doc).toContain("proibido recusado 20 de 20; liberado aceito 12 de 12");
    expect(doc).toContain("trocadas: só `whatsapp_ia_enviar(uuid,text,jsonb)`");
  });

  it("os textos do ensaio não carregam telefone nem número de conversa", () => {
    expect(ensaio).not.toMatch(/\b55\d{10,11}\b/);
    expect(doc).not.toMatch(/\b55\d{10,11}\b/);
  });
});
