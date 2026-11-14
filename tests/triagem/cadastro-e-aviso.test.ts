import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRACAO_B4, PASTA_DAS_MIGRACOES, corpoDaFuncao, lerMigracao, semComentarios } from "./sql-lido-como-texto";

/**
 * Contrato da migração B7 e B8 (a triagem grava no cadastro e o aviso do grupo traz o resumo). Lê o SQL como texto:
 * nada aqui fala com banco. O comportamento de verdade é provado pelo roteiro `docs/ensaio-triagem-cadastro-e-aviso.md`.
 */
const MIGRACAO_B7 = "20261114100000_triagem_grava_cadastro_e_aviso_com_resumo.sql";
const DOC = join(__dirname, "..", "..", "docs", "ensaio-triagem-cadastro-e-aviso.md");
const MD5_APLICAR_VIVO = "d32589123febf3acbec9c233810fc55a";
const MD5_VARRER_VIVO = "a7f66a3a0cf0b7791120829ffdcf30ae";

const sql = lerMigracao(MIGRACAO_B7);
const codigo = semComentarios(sql);
const doc = readFileSync(DOC, "utf8");

/** O que o banco guarda em pg_proc.prosrc: o texto entre `AS $function$` e o `$function$;` que fecha. */
function prosrcDe(arquivo: string, nome: string): string {
  const def = corpoDaFuncao(arquivo, nome);
  const ini = def.indexOf("AS $function$") + "AS $function$".length;
  return def.slice(ini, def.lastIndexOf("$function$;"));
}
const md5 = (t: string) => createHash("md5").update(t).digest("hex");

/** Os blocos ```sql do roteiro, sem comentários `--`. */
function blocosSqlDoRoteiro(texto: string): string[] {
  return [...texto.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => semComentarios(m[1]));
}

/**
 * UPDATE ou DELETE sem WHERE: o banco vivo usa safeupdate e recusa. Lê cada comando até o `;` (nenhum UPDATE ou DELETE destes
 * arquivos tem `;` dentro de texto entre aspas). `DO UPDATE SET`, `BEFORE UPDATE ON` e `FOR UPDATE` não são comandos UPDATE.
 */
function comandosSemWhere(sqlSemComentarios: string): string[] {
  const achados: string[] = [];
  const re = /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of sqlSemComentarios.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

/** O texto do bloco do ensaio vivo: de `DO $ensaio$` até o `$ensaio$;`. */
const ensaioVivo = (() => {
  const ini = doc.indexOf("DO $ensaio$");
  return doc.slice(ini, doc.indexOf("$ensaio$;", ini) + "$ensaio$;".length);
})();

describe("B7 e B8: arquivo e vocabulário", () => {
  it("vem depois da B4 e o prefixo de data é único", () => {
    expect(MIGRACAO_B7 > MIGRACAO_B4).toBe(true);
    const prefixo = MIGRACAO_B7.slice(0, 14);
    const iguais = readdirSync(PASTA_DAS_MIGRACOES).filter((n) => n.startsWith(prefixo));
    expect(iguais).toEqual([MIGRACAO_B7]);
  });

  it("diz que foi aplicada depois do ensaio e aponta o roteiro", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- APLICADA em 14\/11\/2026/);
    expect(sql).toContain("docs/ensaio-triagem-cadastro-e-aviso.md");
  });

  it("sem travessão, seta e a palavra que o dono baniu, na migração e no roteiro", () => {
    for (const texto of [sql, doc]) {
      expect(texto).not.toMatch(/[—–→]/);
    }
    expect(sql).not.toMatch(/revend/i);
  });
});

describe("B7: a gravação no cadastro", () => {
  const gravar = prosrcDe(sql, "triagem_gravar_no_cadastro");

  it("só escreve o que é seguro: nunca telefone, conversão de lead nem cadastro novo", () => {
    expect(gravar).not.toMatch(/SET\s+telefone/i);
    expect(gravar).not.toMatch(/converter_lead_em_cliente/i);
    expect(gravar).not.toMatch(/INSERT\s+INTO\s+public\.(clientes|leads)/i);
    expect(gravar).not.toMatch(/telefone_alternativo_verificado\s*=/i);
    expect(codigo).not.toMatch(/CREATE OR REPLACE FUNCTION public\.converter_lead_em_cliente/);
  });

  it("todo UPDATE de lead e de cliente tem WHERE por id e confere o campo vazio de novo", () => {
    const updates = gravar.match(/UPDATE\s+public\.(leads|clientes)[\s\S]*?;/g) ?? [];
    expect(updates.length).toBe(4);
    for (const u of updates) expect(u).toMatch(/WHERE\s+id\s*=\s*v_(lead|cli)\.id/);
    // nome: o WHERE repete a conta de marcador; observações: repete a marca da nota; endereço: repete o "vazio" de cada campo
    expect(updates.filter((u) => /_triagem_nome_e_marcador\(nome\)/.test(u)).length).toBe(2);
    expect(updates.some((u) => /position\('Triagem do WhatsApp' IN coalesce\(observacoes/.test(u))).toBe(true);
    const endereco = updates.find((u) => /SET\s+cep\s*=/.test(u)) ?? "";
    for (const campo of ["cep", "endereco", "bairro", "cidade", "estado"]) {
      expect(endereco).toMatch(new RegExp(`${campo}\\s*=\\s*CASE WHEN v_troca_\\w+ AND (btrim\\(coalesce\\(${campo}|regexp_replace\\(coalesce\\(${campo})`));
    }
  });

  it("nunca espera trava nem derruba a mensagem: SKIP LOCKED, lock_timeout, erro por parte e QUERY_CANCELED", () => {
    const def = corpoDaFuncao(sql, "triagem_gravar_no_cadastro");
    expect(def).toMatch(/SET lock_timeout TO '1s'/);
    expect((gravar.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length).toBe(2);
    expect(gravar).toMatch(/WHEN query_canceled THEN/);
    // um bloco por parte: o lead, o nome do cliente, o CEP e endereço do cliente (a falha de um não desfaz os outros)
    expect((gravar.match(/EXCEPTION WHEN OTHERS THEN/g) ?? []).length).toBe(3);
    expect(gravar).toMatch(/'erro_lead'/);
    expect(gravar).toMatch(/'erro_cliente_nome'/);
    expect(gravar).toMatch(/'erro_cliente_endereco'/);
    expect(gravar).not.toMatch(/'erro_cliente'/);
  });

  it("o UPDATE do nome do cliente e o do CEP e endereço ficam em blocos separados", () => {
    const nome = gravar.indexOf("UPDATE public.clientes SET nome = v_nome");
    const endereco = gravar.indexOf("UPDATE public.clientes SET\n");
    expect(nome).toBeGreaterThan(0);
    expect(endereco).toBeGreaterThan(nome);
    const entre = gravar.slice(nome, endereco);
    // entre os dois UPDATE o bloco do nome fecha (END;) depois do seu EXCEPTION, antes do endereço abrir o dele
    expect(entre).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*'erro_cliente_nome'[\s\S]*END;[\s\S]*BEGIN/);
    // o erro do endereço não mexe no nome: só limpa o que o próprio bloco anotou
    expect(gravar).toMatch(/v_campos := array_remove\(array_remove\(v_campos, 'cep_cliente'\), 'endereco_cliente'\)/);
  });

  it("o log leva só o id e o SQLSTATE, nunca a mensagem do erro", () => {
    for (const aviso of sql.match(/RAISE WARNING[^;]*;/g) ?? []) expect(aviso).not.toMatch(/SQLERRM/);
  });

  it("só triagem real, terminada e fora do ensaio", () => {
    expect(gravar).toMatch(/t\.modo <> 'real'/);
    expect(gravar).toMatch(/IN \('desligada', 'ensaio'\)/);
    expect(gravar).toMatch(/t\.status NOT IN \('concluida', 'entregue_equipe'\)/);
    expect(codigo).toMatch(/IF t\.modo = 'real' AND NOT v_ensaio AND v_status IN \('concluida', 'entregue_equipe'\) THEN/);
  });

  it("CEP de outro cadastro nunca recebe o endereço, e o nome só vale completo", () => {
    expect(gravar).toMatch(/v_cep_cli <> '' AND v_cep_cli <> t\.cep/);
    expect(gravar).toMatch(/cep_diferente_mantido/);
    expect(gravar).toMatch(/t\.nome_completo AND position\(' ' IN v_nome\) > 0 AND public\._triagem_nome_valido\(v_nome\)/);
  });

  it("CEP vazio só recebe endereço se rua, bairro, cidade e UF do cadastro estão vazios ou iguais ao ViaCEP", () => {
    expect(gravar).toMatch(/v_conflito := v_cep_cli = '' AND EXISTS/);
    for (const c of ["v_cli.endereco, v_rua", "v_cli.bairro, v_bairro", "v_cli.cidade, v_cidade", "v_cli.estado, v_uf"]) expect(gravar).toContain(c);
    expect(gravar).toMatch(/IF v_conflito THEN\s+v_mantido := array_append\(v_mantido, 'endereco_diferente_mantido'\)/);
    // o UPDATE de endereço só roda no ramo sem conflito
    expect(gravar.indexOf("ELSE\n            v_troca_cep")).toBeGreaterThan(gravar.indexOf("IF v_conflito THEN"));
  });

  it("o rastro usa o tipo que já existe, só com códigos, e adiado é só trava ou erro", () => {
    expect(gravar).toMatch(/'pulou'/);
    expect(codigo).not.toMatch(/ALTER TYPE/);
    expect(gravar).toMatch(/'codigos', to_jsonb\(v_campos \|\| v_adiado \|\| v_mantido\)/);
    expect(gravar).toMatch(/WHEN cardinality\(v_adiado\) > 0 THEN 'cadastro_adiado'\s+WHEN cardinality\(v_campos\) > 0 THEN 'cadastro_gravado'\s+ELSE 'cadastro_mantido'/);
    // decidir por regra não gravar NUNCA vai para a lista de adiado
    expect(gravar).not.toMatch(/v_adiado := array_append\(v_adiado, '(cep|endereco)_diferente_mantido'\)/);
    expect(gravar).toMatch(/v_mantido := array_append\(v_mantido, 'cep_diferente_mantido'\)/);
    // as únicas coisas que entram em adiado: trava e erro
    const entradas = [...gravar.matchAll(/v_adiado := array_append\(v_adiado, '([a-z_]+)'\)/g)].map((m) => m[1]).sort();
    expect(entradas).toEqual(["adiado_cliente", "adiado_lead", "erro_cliente_endereco", "erro_cliente_nome", "erro_lead"]);
  });

  it("toda função nova só para o service_role", () => {
    for (const f of ["_triagem_nome_e_marcador(text)", "triagem_gravar_no_cadastro(uuid)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`);
    }
  });
});

describe("precondição: as colunas que a migração usa", () => {
  const trigagens = ["lead_id", "cep_endereco", "nome_completo", "primeira_vez", "telefone_confirmado", "pediu_equipe", "aviso_grupo_rodada"];
  it("a migração confere as colunas de whatsapp_triagens e para dizendo quais faltam", () => {
    for (const c of trigagens) expect(sql).toContain(`('whatsapp_triagens', '${c}')`);
    expect(sql).toMatch(/faltam colunas que a migração usa: %/);
  });
  it("o roteiro (0.2) confere as mesmas colunas, 29 linhas", () => {
    for (const c of trigagens) expect(doc).toContain(`'${c}'`);
    expect(doc).toMatch(/Esperado: 29 linhas/);
  });
});

describe("B7 e B8: a troca é por texto sobre a definição viva", () => {
  it("confere o md5 dos dois corpos vivos, que é o da B4", () => {
    expect(sql).toContain(MD5_APLICAR_VIVO);
    expect(sql).toContain(MD5_VARRER_VIVO);
    const b4 = lerMigracao(MIGRACAO_B4);
    expect(md5(prosrcDe(b4, "triagem_aplicar"))).toBe(MD5_APLICAR_VIVO);
    expect(md5(prosrcDe(b4, "triagem_varrer"))).toBe(MD5_VARRER_VIVO);
  });

  it("os pontos de troca existem uma vez no corpo vivo", () => {
    const b4 = lerMigracao(MIGRACAO_B4);
    const aplicar = prosrcDe(b4, "triagem_aplicar");
    const varrer = prosrcDe(b4, "triagem_varrer");
    const conta = (t: string, p: string) => t.split(p).length - 1;
    expect(conta(aplicar, "  -- texto barrado: a pergunta anterior que ainda não saiu também não vai (a equipe assume)")).toBe(1);
    expect(conta(varrer, "  -- 6. avisos de grupo:")).toBe(1);
    expect(conta(varrer, "  RETURN jsonb_build_object('expiradas'")).toBe(1);
  });

  it("não copia as funções vivas: nem triagem_aplicar nem triagem_varrer são recriadas por CREATE OR REPLACE no arquivo", () => {
    expect(codigo).not.toMatch(/CREATE OR REPLACE FUNCTION public\.triagem_aplicar/);
    expect(codigo).not.toMatch(/CREATE OR REPLACE FUNCTION public\.triagem_varrer/);
    expect(codigo).toMatch(/EXECUTE v_novo;/);
  });
});

describe("B8: o texto do aviso do grupo", () => {
  const inicio = sql.indexOf("v_texto := concat_ws");
  const fim = sql.indexOf("PERFORM public.enfileirar_notificacao", inicio);
  const texto = sql.slice(inicio, fim);

  it("traz o resumo que a equipe usa", () => {
    for (const parte of [
      "Triagem do robô: ",
      "'parceiro'",
      "'cliente final'",
      "Anúncio: ",
      "Produto: ",
      "Primeira vez: sim",
      "Primeira vez: não, disse que já é cliente",
      "Pediu preço",
      "O telefone de contato é outro, sem verificação",
      "Pediu para falar com a equipe",
      "Responder: https://bexprint.com.br/whatsapp?conversa=",
    ]) {
      expect(texto).toContain(parte);
    }
  });

  it("nunca leva CEP, telefone nem sobrenome", () => {
    expect(texto).not.toMatch(/\bcep\b/i);
    expect(texto).not.toMatch(/telefone_alternativo|telefone_chat|nome_informado|telefone_normalizado/);
    expect(texto).not.toMatch(/t\.nome_informado/);
    // o primeiro nome vem da consulta, cortado no primeiro espaço
    expect(sql).toMatch(/split_part\(btrim\(coalesce\(x\.nome_informado, ''\)\), ' ', 1\) AS primeiro_nome/);
  });

  it("anúncio e produto passam pelo saneador antes de entrar no texto", () => {
    expect(sql).toMatch(/v_anuncio text := public\._triagem_texto_de_aviso\(t\.anuncio_titulo, 80\);/);
    expect(sql).toMatch(/v_produto text := public\._triagem_texto_de_aviso\(t\.produto, 60\);/);
    const f = corpoDaFuncao(sql, "_triagem_texto_de_aviso");
    expect(f).toMatch(/IMMUTABLE/);
    // controle, invisíveis (Cf), markdown do WhatsApp, link e www, espaços, tamanho
    for (const parte of ["\\u0001-\\u001F", "\\u200B-\\u200F", "\\u202A-\\u202E", "\\uFEFF", "'[*_~`]'", "(https?://|www\\.)", "'(http|www)'", "'\\s+'", "left("]) {
      expect(f).toContain(parte);
    }
    // o título do anúncio só entra no texto pelas variáveis saneadas
    expect(texto).not.toMatch(/t\.anuncio_titulo|t\.produto/);
  });

  it("anúncio e produto vêm do atendimento", () => {
    expect(sql).toMatch(/LEFT JOIN public\.whatsapp_atendimentos a ON a\.id = x\.atendimento_id/);
    expect(sql).toMatch(/a\.anuncio_titulo, a\.produto/);
  });

  it("a chave de idempotência e o ramo de entidade do aviso não mudaram", () => {
    expect(sql).toMatch(/'triagem_aviso:' \|\| t\.id \|\| CASE WHEN t\.aviso_grupo_rodada > 1 THEN ':' \|\| t\.aviso_grupo_rodada ELSE '' END/);
    expect(sql).toMatch(/'whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'whatsapp_atendimento'/);
    expect(sql).toMatch(/coalesce\(t\.atendimento_id, t\.id\)/);
  });
});

describe("roteiro de ensaio", () => {
  it("tem ANTES, ENSAIO terminando em RAISE EXCEPTION, DEPOIS e ROLLBACK", () => {
    expect(doc).toMatch(/## 0\. ANTES de aplicar/);
    expect(doc).toMatch(/## 3\. ENSAIO/);
    expect(doc).toMatch(/## 4\. DEPOIS do ensaio/);
    expect(doc).toMatch(/## 5\. Voltar atrás/);
    expect(doc).toMatch(/RAISE EXCEPTION E'ENSAIO OK \(tudo desfeito de propósito\):\\n%'/);
    expect(doc).toContain(MD5_APLICAR_VIVO);
    expect(doc).toContain(MD5_VARRER_VIVO);
  });

  it("nenhum UPDATE nem DELETE sem WHERE, na migração e em todo bloco SQL do roteiro (safeupdate)", () => {
    expect(comandosSemWhere(codigo)).toEqual([]);
    expect(blocosSqlDoRoteiro(doc).length).toBeGreaterThan(8);
    for (const bloco of blocosSqlDoRoteiro(doc)) expect(comandosSemWhere(bloco)).toEqual([]);
  });

  it("o varredor de UPDATE sem WHERE enxerga o que deve e deixa passar o que é legítimo", () => {
    expect(comandosSemWhere("UPDATE public.t SET a = 1;")).toHaveLength(1);
    expect(comandosSemWhere("DELETE FROM public.t;")).toHaveLength(1);
    expect(comandosSemWhere("UPDATE public.t SET a = 1\n WHERE true;")).toEqual([]);
    expect(comandosSemWhere("UPDATE public.t SET a = 1 WHERE id = x; DELETE FROM public.t WHERE id = x;")).toEqual([]);
    expect(comandosSemWhere("CREATE TRIGGER z BEFORE UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION f(); SELECT 1 FROM t FOR UPDATE SKIP LOCKED;")).toEqual([]);
  });

  it("o ensaio vivo trava em 2 s, não faz DDL e avisa que segura o número de atendimento", () => {
    expect(ensaioVivo).toMatch(/BEGIN\s+(--[^\n]*\n\s*)?SET LOCAL lock_timeout = '2s';/);
    expect(ensaioVivo).not.toMatch(/\b(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?(TRIGGER|FUNCTION|TABLE|INDEX)\b/i);
    expect(ensaioVivo).not.toMatch(/zz_ensaio_b7_falha|_ensaio_b7_falha/);
    expect(doc).toMatch(/segura|TRAVADA/);
    expect(doc).toMatch(/whatsapp_atendimento_seq/);
    expect(doc).toMatch(/pouco movimento/);
  });

  it("a prova de gatilho que recusa escrita ficou só no banco local, e cobre as três partes", () => {
    const local = doc.slice(doc.indexOf("### 3.2"), doc.indexOf("## 4. DEPOIS do ensaio"));
    expect(local).toMatch(/só no banco local/);
    expect(local).toContain("CREATE TRIGGER zz_ensaio_b7_falha");
    for (const c of ["erro_lead", "erro_cliente_endereco", "erro_cliente_nome"]) expect(local).toContain(c);
  });

  it("11c olha o texto sem o link, antes do regex de oito dígitos e das palavras proibidas", () => {
    const i = ensaioVivo.indexOf("v_sem_link := regexp_replace(v_txt, 'conversa=");
    expect(i).toBeGreaterThan(0);
    const depois = ensaioVivo.slice(i);
    expect(depois.indexOf("v_sem_link ~ '\\d{8,}'")).toBeGreaterThan(0);
    expect(depois.indexOf("v_sem_link ~* '(souza|")).toBeGreaterThan(0);
    // o texto com o link não passa mais pelo regex de dígitos
    expect(ensaioVivo).not.toMatch(/v_txt ~ '\\d\{8,\}'/);
  });

  it("a prova 13 usa título malicioso e confere o aviso inteiro", () => {
    expect(ensaioVivo).toMatch(/13\) título e produto maliciosos/);
    for (const parte of ["*Promo*", "https://evil.example", "www.evil.com", "chr(8203)", "chr(8238)", "repeat('x', 200)", "[*_~`]", "(http|www)"]) {
      expect(ensaioVivo).toContain(parte);
    }
  });

  it("a prova de CEP vazio com endereço diferente existe, e o motivo 'adiado' só aparece para trava e erro", () => {
    expect(ensaioVivo).toMatch(/endereco_diferente_mantido/);
    expect(ensaioVivo).toMatch(/7d\)/);
    // no ensaio vivo (sem gatilho) nenhuma prova espera cadastro_adiado
    expect(ensaioVivo).not.toMatch(/cadastro_adiado/);
  });

  it("a volta termina conferindo o md5 de triagem_aplicar e traz a triagem_varrer da B4 inteira, com a consulta final", () => {
    const volta = doc.slice(doc.indexOf("## 5. Voltar atrás"), doc.indexOf("## 6. O que este diff NÃO resolve"));
    const bloco51 = volta.slice(volta.indexOf("### 5.1"), volta.indexOf("### 5.2"));
    expect(bloco51).toMatch(new RegExp(`md5\\(prosrc\\)[^\\n]*\\n?[^\\n]*<> '${MD5_APLICAR_VIVO}'[\\s\\S]*COMMIT;`));
    expect(bloco51.indexOf(MD5_APLICAR_VIVO)).toBeLessThan(bloco51.lastIndexOf("COMMIT;"));
    // a função da B4 inteira, byte a byte, e a conferência do md5 do corpo
    const b4 = lerMigracao(MIGRACAO_B4);
    expect(volta).toContain(corpoDaFuncao(b4, "triagem_varrer"));
    expect(md5(prosrcDe(b4, "triagem_varrer"))).toBe(MD5_VARRER_VIVO);
    const bloco52 = volta.slice(volta.indexOf("### 5.2"), volta.indexOf("### 5.3"));
    expect(bloco52).toContain(`<> '${MD5_VARRER_VIVO}'`);
    expect(bloco52.indexOf("DROP FUNCTION IF EXISTS public._triagem_texto_de_aviso")).toBeGreaterThan(bloco52.indexOf("END $function$;"));
    const bloco53 = volta.slice(volta.indexOf("### 5.3"));
    expect(bloco53).toContain("aplicar_volta");
    expect(bloco53).toContain("varrer_volta");
    expect(bloco53).toContain("_triagem_texto_de_aviso");
  });

  it("o roteiro diz que adiamento por trava não é refeito e que o dado continua na triagem", () => {
    expect(doc).toMatch(/não é refeito/);
    expect(doc).toMatch(/dado continua (inteiro )?na triagem|Os dados continuam na própria triagem/);
    expect(doc).toMatch(/cadastro_mantido/);
  });
});
