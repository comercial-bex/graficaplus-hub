import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C3, o agente que escolhe respostas aprovadas: o contrato da migração e do roteiro de ensaio, lidos como TEXTO (nada aqui
 * fala com banco). O que o SQL faz de verdade foi provado no Postgres 17 local e está no roteiro.
 */

const PASTA = join(__dirname, "..", "..", "supabase", "migrations");
const NOME = "20261115100000_agente_escolhe_respostas.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const b4 = readFileSync(join(PASTA, "20261113132000_triagem_estado_e_envio.sql"), "utf8");
const doc = readFileSync(join(__dirname, "..", "..", "docs", "ensaio-agente-escolhe.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
/** Tira o que está entre aspas simples: "INSERT,UPDATE" dentro de has_table_privilege não é comando. */
const semLiterais = (t: string) => t.replace(/'(?:[^']|'')*'/g, "''");
const codigo = semComentarios(sql);
const md5 = (t: string) => createHash("md5").update(t).digest("hex");

function comandosSemWhere(s: string): string[] {
  const achados: string[] = [];
  const re =
    /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+(?:\w+\s+)?SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of s.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

/** Nome, assinatura e corpo (o que o Postgres guarda em prosrc) de cada função criada. */
function funcoes(texto: string) {
  const re =
    /CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$;/g;
  return [...texto.matchAll(re)].map((m) => ({
    nome: m[1],
    args: m[2],
    cabecalho: m[3],
    corpo: m[4],
  }));
}
const novas = funcoes(sql);

const blocosSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const ensaio = blocosSql.find((b) => b.includes("DO $ensaio$"))!;
// há dois blocos de volta antes da seção 8: o das views da C4 (5.0, que vem ANTES) e o da C3 (5.1, o que derruba as tabelas)
const volta = blocosSql.find(
  (b) => b.includes("DO $volta$") && b.includes("DROP TABLE public.agente_eventos"),
)!;
const voltaDasViews = blocosSql.find(
  (b) => b.includes("DO $volta$") && b.includes("DROP VIEW public.agente_metricas_dia"),
)!;

describe("C3: arquivo e escopo", () => {
  it("vem depois da última migração e o prefixo de data é único", () => {
    expect(NOME > "20261114120000_agente_base_de_respostas.sql").toBe(true);
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
  });

  it("só cria, e troca UMA função viva: o dono da conversa", () => {
    expect(codigo).not.toMatch(/\bDROP\b/i);
    expect(codigo).not.toMatch(/\bADD COLUMN\b/i);
    expect(codigo).not.toMatch(/\bCREATE TYPE\b|\bALTER TYPE\b/i);
    expect(codigo).not.toMatch(
      /\bALTER\s+TABLE\s+(?!public\.agente_(config|eventos)\s+ENABLE ROW LEVEL SECURITY)/i,
    );
    const nomes = novas.map((f) => f.nome);
    for (const n of nomes)
      expect(
        n.startsWith("agente_") || n.startsWith("_agente_") || n === "triagem_dono_da_conversa",
        n,
      ).toBe(true);
    expect(nomes.filter((n) => n === "triagem_dono_da_conversa")).toHaveLength(1);
    expect(novas).toHaveLength(16);
    // gatilhos só nas tabelas novas
    expect(
      [...codigo.matchAll(/CREATE TRIGGER \w+ [\s\S]*? ON public\.(\w+)/g)].map((m) => m[1]),
    ).toEqual(["agente_config", "agente_config"]);
    // nenhuma escrita em tabela viva fora das funções (o único INSERT no nível da migração é a linha de configuração)
    const foraDasFuncoes = codigo
      .replace(/AS \$function\$[\s\S]*?\$function\$;/g, "")
      .replace(/DO \$(pre|confere)\$[\s\S]*?\$\1\$;/g, "");
    expect([...foraDasFuncoes.matchAll(/\bINSERT INTO public\.(\w+)/g)].map((m) => m[1])).toEqual([
      "agente_config",
    ]);
    expect(semLiterais(foraDasFuncoes).replace(/CREATE TRIGGER[^;]*;/g, "")).not.toMatch(
      /\bUPDATE\b|(?<!ON )\bDELETE\b/i,
    );
  });

  it("nenhuma coluna nova em tabela viva, nenhum valor novo de enum, nenhuma origem nova, nenhum CHECK de origem mexido", () => {
    expect(codigo).not.toMatch(/ADD VALUE/i);
    expect(codigo).not.toMatch(/origem\s+IN\s*\(|CHECK\s*\(\s*origem|whatsapp_mensagens_origem/i);
    // a mensagem do agente sai com a origem que já existe
    expect(codigo).toMatch(
      /'saida', 'texto', 'pendente', left\(v_texto, 4096\), c\.cliente_id, c\.os_id, NULL, 'automacao'/,
    );
    expect(codigo).toContain("CREATE TABLE public.agente_config (");
    expect(codigo).toContain("CREATE TABLE public.agente_eventos (");
    expect([...codigo.matchAll(/CREATE TABLE (public\.\w+)/g)].map((m) => m[1])).toEqual([
      "public.agente_config",
      "public.agente_eventos",
    ]);
  });

  it("abre com lock_timeout de 5 s, fecha com COMMIT e termina com a conferência que desfaz tudo", () => {
    expect(codigo).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';/);
    expect(codigo.trim().endsWith("COMMIT;")).toBe(true);
    expect(codigo).toMatch(/DO \$confere\$/);
    expect(codigo).toMatch(/DO \$pre\$/);
  });

  it("nenhum UPDATE nem DELETE sem WHERE, na migração, no ensaio e na volta (safeupdate)", () => {
    expect(comandosSemWhere(codigo)).toEqual([]);
    expect(comandosSemWhere(ensaio)).toEqual([]);
    expect(comandosSemWhere(volta)).toEqual([]);
    expect(comandosSemWhere("UPDATE public.t SET a = 1;")).toHaveLength(1);
    expect(comandosSemWhere("DELETE FROM public.t;")).toHaveLength(1);
    expect(comandosSemWhere("UPDATE public.t SET a = 1 WHERE id;")).toEqual([]);
  });

  it("o corpo vivo que a troca confere é o da B4, e a troca muda UM ramo", () => {
    const original = funcoes(b4).find((f) => f.nome === "triagem_dono_da_conversa")!;
    expect(md5(original.corpo)).toBe("4632f793e72ba4d6d4b824fffcec6b5a");
    expect(sql).toContain("4632f793e72ba4d6d4b824fffcec6b5a");
    const nova = novas.find((f) => f.nome === "triagem_dono_da_conversa")!;
    const antes = `  IF t.status IN ('concluida', 'entregue_equipe') THEN
    RETURN CASE WHEN cfg.agente_apos_triagem THEN 'assistente' ELSE 'ninguem' END;
  END IF;`;
    const depois = nova.corpo.slice(
      nova.corpo.indexOf("  IF t.status IN ('concluida', 'entregue_equipe') THEN"),
      nova.corpo.indexOf("  IF t.status = 'pausada_humano' THEN"),
    );
    expect(original.corpo).toContain(antes);
    // tirando o ramo novo e pondo o antigo no lugar, o corpo é IDÊNTICO ao vivo, letra por letra
    expect(nova.corpo.replace(depois, antes + "\n")).toBe(original.corpo);
    expect(nova.cabecalho.replace(/\s+/g, " ")).toBe(original.cabecalho.replace(/\s+/g, " "));
    // e a volta do roteiro devolve o corpo da B4
    const corpoDaVolta = funcoes(volta).find((f) => f.nome === "triagem_dono_da_conversa")!.corpo;
    expect(corpoDaVolta).toBe(original.corpo);
    expect(volta).toContain("4632f793e72ba4d6d4b824fffcec6b5a");
  });
});

describe("C3: tabelas e eventos só com códigos e contagens", () => {
  const eventos = codigo.slice(
    codigo.indexOf("CREATE TABLE public.agente_eventos ("),
    codigo.indexOf("CREATE UNIQUE INDEX agente_eventos_decisao_unica"),
  );
  const config = codigo.slice(
    codigo.indexOf("CREATE TABLE public.agente_config ("),
    codigo.indexOf("INSERT INTO public.agente_config"),
  );
  const colunas = (t: string) =>
    [
      ...t.matchAll(/^\s{2}(\w+)\s+(?:uuid|text|boolean|integer|timestamptz|jsonb|public\.\w+)/gm),
    ].map((m) => m[1]);

  it("nenhuma coluna de texto de mensagem, nome, telefone, CEP, preço, valor, custo, desconto ou orçamento", () => {
    for (const c of [...colunas(eventos), ...colunas(config)]) {
      expect(c, c).not.toMatch(
        /^(texto|text|mensagem|conteudo|body|nome|telefone|phone|cep|endereco|email|frase|pergunta|resposta)$/,
      );
      expect(c, c).not.toMatch(/preco|valor|custo|desconto|orcamento|revend/);
    }
    expect(colunas(eventos)).toEqual(
      expect.arrayContaining([
        "conversa_id",
        "mensagem_id",
        "saida_id",
        "tipo",
        "acao",
        "motivo",
        "codigo",
        "resposta_id",
        "versao",
        "ramo",
        "sensivel",
        "detalhe",
        "criado_em",
      ]),
    );
  });

  it("o tipo do evento é a lista combinada e o CHECK do detalhe recusa chave de conteúdo em qualquer nível", () => {
    expect(eventos).toContain(
      "tipo IN ('escolheu', 'entregou', 'barrado', 'enviado', 'ensaio', 'erro', 'pausado', 'freio')",
    );
    expect(eventos).toContain("jsonb_path_exists(detalhe,");
    expect(eventos).toContain('strict $.** ? (@.type() == "object").keyvalue()');
    for (const chave of [
      "texto",
      "text",
      "mensagem",
      "conteudo",
      "body",
      "nome",
      "telefone",
      "phone",
      "cep",
      "endereco",
      "email",
      "resposta",
      "frase",
      "pergunta",
    ]) {
      expect(eventos, chave).toMatch(new RegExp(`\\^\\([^)]*\\b${chave}\\b[^)]*\\)\\$`));
    }
    expect(eventos).toContain("octet_length(detalhe::text) <= 1000");
    expect(eventos).toMatch(/regras_so_codigos/);
  });

  it("a mesma mensagem de entrada nunca tem duas decisões (índice único) e a configuração é de uma linha só", () => {
    expect(codigo).toMatch(
      /CREATE UNIQUE INDEX agente_eventos_decisao_unica ON public\.agente_eventos \(mensagem_id\)\s+WHERE mensagem_id IS NOT NULL AND tipo IN \('escolheu', 'entregou', 'barrado', 'ensaio'\)/,
    );
    expect(config).toContain("id boolean PRIMARY KEY DEFAULT true CHECK (id)");
    expect(config).toContain("estado public.triagem_estado NOT NULL DEFAULT 'desligada'");
  });

  it("nenhuma função grava a frase do contato: o texto do contato só aparece em agente_contexto, que lê", () => {
    for (const f of novas) {
      if (f.nome === "agente_contexto" || f.nome === "triagem_dono_da_conversa") continue;
      expect(f.corpo, f.nome).not.toMatch(/\bm\.texto\b|\bm\.legenda\b/);
    }
    const ctx = novas.find((f) => f.nome === "agente_contexto")!;
    expect(ctx.cabecalho).toMatch(/STABLE/);
    expect(ctx.corpo).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });
});

describe("C3: quem escreve e quem executa", () => {
  it("RLS ligada, só leitura de tabela para a equipe e para o servidor, nenhuma política de escrita", () => {
    expect(codigo).toContain("ALTER TABLE public.agente_config ENABLE ROW LEVEL SECURITY;");
    expect(codigo).toContain("ALTER TABLE public.agente_eventos ENABLE ROW LEVEL SECURITY;");
    expect(codigo).toContain(
      "REVOKE ALL ON public.agente_config FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(codigo).toContain(
      "REVOKE ALL ON public.agente_eventos FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(codigo).toContain(
      "GRANT SELECT ON public.agente_config TO authenticated, service_role;",
    );
    expect(codigo).toContain(
      "GRANT SELECT ON public.agente_eventos TO authenticated, service_role;",
    );
    expect(codigo).not.toMatch(/GRANT (ALL|INSERT|UPDATE|DELETE)[^;]*ON public\.agente_/i);
    expect(
      [...codigo.matchAll(/CREATE POLICY "[^"]+" ON public\.agente_\w+\s+FOR (\w+)/g)].map(
        (m) => m[1],
      ),
    ).toEqual(["SELECT", "SELECT"]);
  });

  it("toda função nova é SECURITY DEFINER com search_path, revogada de PUBLIC, anon e authenticated pelo nome, e só o service_role executa", () => {
    for (const f of novas) {
      const assinatura = `public.${f.nome}(${f.args
        .split(",")
        .map((a) =>
          a
            .trim()
            .replace(/^\w+\s+/, "")
            .replace(/\s+DEFAULT\s+.*$/i, ""),
        )
        .filter(Boolean)
        .join(", ")})`;
      if (f.nome !== "triagem_dono_da_conversa") {
        expect(codigo, f.nome).toContain(
          `REVOKE ALL ON FUNCTION ${assinatura} FROM PUBLIC, anon, authenticated;`,
        );
      }
      if (f.nome === "_agente_config_antes_gravar") continue;
      expect(f.cabecalho, f.nome).toMatch(/SECURITY DEFINER/);
      expect(f.cabecalho, f.nome).toMatch(/SET search_path TO 'public'/);
      if (f.nome !== "triagem_dono_da_conversa")
        expect(codigo, f.nome).toContain(
          `GRANT EXECUTE ON FUNCTION ${assinatura} TO service_role;`,
        );
    }
    expect(codigo).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO (anon|authenticated|PUBLIC)/i);
  });

  it("estado, percentual, números de teste, teto e freios exigem whatsapp.manage; a escada sobe um degrau por vez", () => {
    const f = novas.find((x) => x.nome === "agente_config_salvar")!.corpo;
    expect(f).toContain(
      "Mudar o estado, a porcentagem ou os números de teste do agente exige a permissão de gerenciar o WhatsApp.",
    );
    expect(f).toContain(
      "Mudar o teto, os freios, o aviso ao grupo, o atraso ou a guarda do rastro exige a permissão de gerenciar o WhatsApp.",
    );
    expect(f).toContain("IF v_para > v_de + 1 THEN");
    expect(f).toContain("Para desligar, use o botão Desligar tudo");
    // o que decide o que o contato vê e quanto se guarda entra no mesmo cadeado dos freios
    for (const k of ["avisar_grupo", "retencao_eventos_dias", "atraso_min_s", "atraso_max_s"]) {
      expect(f, k).toMatch(
        new RegExp(`\\(p_config \\? '${k}'\\) AND [^\\n]*IS DISTINCT FROM c\\.${k}`),
      );
    }
    expect(novas.find((x) => x.nome === "_agente_config_antes_gravar")!.corpo).toContain(
      "> array_position(ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'], OLD.estado::text) + 1",
    );
    expect(novas.find((x) => x.nome === "agente_desligar")!.corpo).toContain(
      "_agente_cancelar_pendentes(NULL)",
    );
  });
});

describe("C3: a saída do agente, e só ela", () => {
  const reg = novas.find((f) => f.nome === "agente_registrar")!.corpo;

  it("o texto enviado é o texto_aprovado da linha da base, na versão conferida e com o validador do agente; nenhum campo da decisão vira texto", () => {
    expect(reg).toContain("v_texto := r.texto_aprovado;");
    expect(reg).toContain("r.versao IS DISTINCT FROM (p_decisao ->> 'versao')::integer");
    expect(reg).toContain(
      "v_regras := public._agente_problemas_de_texto(r.texto_aprovado, r.ramos);",
    );
    expect(reg).not.toMatch(/p_decisao ->> 'texto'|p_decisao -> 'texto'/);
    expect(reg).toContain("r.status <> 'aprovada'");
  });

  it("a chave, a marca e o ensaio: chave triagem:<id>:agente:<entrada>, triagem_id e agente no payload, ensaio só evento", () => {
    expect(reg).toContain("v_chave := 'triagem:' || t.id::text || ':agente:' || m.id::text;");
    expect(reg).toContain("'triagem_id', t.id,");
    expect(reg).toContain("'agente', true, 'passo', 'agente'");
    expect(reg).toContain("jsonb_build_object('agente', jsonb_build_object('triagem_id', t.id");
    const ensaioNoCodigo = reg.slice(
      reg.indexOf("-- ENSAIO: só o evento"),
      reg.indexOf("IF v_acao = 'escolher' THEN\n    v_chave"),
    );
    expect(ensaioNoCodigo).toContain("'ensaio'");
    expect(ensaioNoCodigo).toContain(
      "RETURN jsonb_build_object('registrado', true, 'ensaio', true, 'enviado', false",
    );
    expect(ensaioNoCodigo).not.toMatch(
      /whatsapp_mensagens|whatsapp_fila_envio|enfileirar_notificacao|_agente_avisar_equipe|whatsapp_automacao_bloqueios/,
    );
  });

  it("confere de novo, com a conversa travada: agente ligado, mensagem, triagem, degrau, gente, bloqueio, teto, volume e fila", () => {
    for (const trecho of [
      "pg_advisory_xact_lock(hashtextextended('agente:'",
      "FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE",
      "IF g.estado = 'desligada'",
      "_agente_triagem_liberou(c.id)",
      "m.created_at <= coalesce(t.concluida_em, t.atualizado_em)",
      "_agente_degrau_permite(c.id)",
      "_triagem_humano_na_conversa(c.id)",
      "_triagem_bloqueado(c.id)",
      "v_enviadas >= g.max_mensagens",
      "v_na_hora >= g.max_por_hora OR v_no_dia >= g.max_por_dia",
      "f.payload ? 'agente'",
    ]) {
      expect(reg, trecho).toContain(trecho);
    }
  });

  it("o aviso ao grupo não leva nome, telefone nem a frase: só o motivo e o link da conversa", () => {
    const av = novas.find((f) => f.nome === "_agente_avisar_equipe")!.corpo;
    expect(av).toContain("'agente_aviso:' || p_conversa");
    expect(av).not.toMatch(/nome_contato|\.telefone|\.texto\b|texto_aprovado/);
    expect(av).toContain("EXCEPTION WHEN OTHERS");
  });

  it("parar grava o bloqueio só em hash e só no envio real", () => {
    expect(reg).toContain(
      "whatsapp_automacao_bloqueios (telefone_hash, lid_hash, conversa_id, motivo, origem)",
    );
    expect(reg).toContain("'parar', 'agente'");
    expect(reg.indexOf("v_hash_tel := public._triagem_hash")).toBeGreaterThan(
      reg.indexOf("-- ENSAIO: só o evento"),
    );
  });

  it("a rodada de varredura e o freio por erros desligam só a configuração e cancelam o que está na fila", () => {
    expect(novas.find((f) => f.nome === "agente_varrer")!.corpo).toContain(
      "_agente_cancelar_pendentes(NULL)",
    );
    expect(novas.find((f) => f.nome === "agente_evento")!.corpo).toContain(
      "freio_erros_de_leitura",
    );
    expect(novas.find((f) => f.nome === "agente_varrer")!.corpo).toContain(
      "greatest(now() - interval '30 minutes', coalesce(g.desligada_em, '-infinity'::timestamptz))",
    );
  });
});

describe("C3: o roteiro de ensaio", () => {
  it("tem as seções, na ordem", () => {
    const titulos = [...doc.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
    // 8 é a migração das métricas da C4 (20261115110000); as subseções 8.0 a 8.6 não entram nesta conta
    // 9 é o validador de texto mais firme (20261115120000)
    expect(titulos).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(doc).toMatch(/^## O que muda em produção ao aplicar/m);
    expect(doc).not.toMatch(/@@/);
  });

  it("o ensaio abre com SET LOCAL lock_timeout de 2 s e termina em RAISE EXCEPTION, sem DDL", () => {
    const limpo = semComentarios(ensaio);
    expect(limpo.trimStart().startsWith("SET LOCAL lock_timeout = '2s';")).toBe(true);
    expect(limpo).toContain("PERFORM set_config('lock_timeout', '2s', true);");
    const fim = limpo.trimEnd();
    expect(fim.endsWith("END $ensaio$;")).toBe(true);
    expect(
      fim.slice(fim.lastIndexOf("RAISE EXCEPTION")).startsWith("RAISE EXCEPTION E'ENSAIO PASSOU"),
    ).toBe(true);
    expect(semLiterais(limpo)).not.toMatch(
      /\bCREATE\b|\bALTER\b|\bDROP\b|\bTRUNCATE\b|\bCOMMIT\b/i,
    );
    // todo UPDATE e todo DELETE tem WHERE (conferido acima), e o único DELETE tira as falhas de mentira que a prova 22 pôs na fila
    const deletes = [...limpo.matchAll(/\bDELETE\s+FROM\s+[\w.]+[^;]*;/gi)].map((m) =>
      m[0].replace(/\s+/g, " "),
    );
    expect(deletes).toEqual([
      "DELETE FROM public.whatsapp_fila_envio WHERE idempotency_key LIKE 'ensaio-falha-agente-%';",
    ]);
  });

  it("as comparações do ensaio são seguras com nulo: nenhuma usa <> ou = em valor lido de linha que pode não existir", () => {
    const limpo = semComentarios(ensaio);
    // `x ->> 'campo' <> 'valor'` passaria com nulo; só IS DISTINCT FROM prova
    expect(limpo).not.toMatch(/->>\s*'[a-z_]+'\s*<>/);
    expect(limpo).not.toMatch(/\)::boolean\s*(<>|=)\s/);
  });

  it("prova cada regra do dono e cada coisa que o código promete", () => {
    for (const p of [
      "ENSAIO",
      "FALHOU 5: a mensagem gravada não é a aprovada",
      "'texto', 'O valor fica em R$ 50, pronto em 2 dias'",
      "teto_de_mensagens",
      "preco_de_novo",
      "resposta_mudou",
      "humano_na_conversa",
      "'parar'",
      "triagem_nao_liberou",
      "passou_com_a_resposta",
      "freio_erros_de_leitura",
      "desligado_a_mao",
      "freio_falhas_de_envio",
      "agente_apos_triagem",
      "rajada",
      "freio_de_volume",
      "ja_entregue",
      "ja_enviado",
      "resposta_aprovada",
      "fora_do_degrau",
      '"frase"',
      "agente_resumo",
      "agente_conferir_envio",
    ]) {
      expect(ensaio, p).toContain(p);
    }
    const provas = [...ensaio.matchAll(/v_r := array_append\(v_r, (?:format\()?'(\d+)\)/g)].map(
      (m) => Number(m[1]),
    );
    // a prova 2 tem duas formas (com e sem gestor no banco)
    expect([...new Set(provas)]).toEqual(Array.from({ length: 33 }, (_, i) => i));
  });

  it("a saída esperada traz as 33 provas e o ensaio local nada deixou", () => {
    const saida = doc.slice(doc.indexOf("Saída esperada"), doc.indexOf("## 4."));
    expect(saida).toContain("ENSAIO PASSOU (33 provas, de 0 a 32)");
    for (let i = 0; i <= 32; i++) expect(saida, `prova ${i}`).toMatch(new RegExp(`^${i}\\) `, "m"));
  });

  it("os blocos de ANTES, DEPOIS e a conferência só leem", () => {
    const leitura =
      doc.slice(doc.indexOf("## 0. ANTES"), doc.indexOf("## 3. ENSAIO")) +
      doc.slice(doc.indexOf("## 4. DEPOIS"), doc.indexOf("## 5. Voltar atrás")) +
      doc.slice(doc.indexOf("### 5.2"), doc.indexOf("## 6."));
    for (const b of [...leitura.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) =>
      semComentarios(m[1]),
    )) {
      expect(semLiterais(b)).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/,
      );
    }
  });

  it("a volta recusa rodar com o agente ligado, troca o dono ANTES de derrubar e confere o md5 e a ACL", () => {
    const v = semComentarios(volta);
    expect(v.indexOf("CREATE OR REPLACE FUNCTION public.triagem_dono_da_conversa")).toBeLessThan(
      v.indexOf("DROP TABLE public.agente_eventos"),
    );
    expect(v).toContain("O agente não está desligado");
    expect(v).toContain("SET LOCAL lock_timeout = '2s';");
    expect(v.trim().endsWith("COMMIT;")).toBe(true);
    for (const f of novas)
      if (f.nome !== "triagem_dono_da_conversa") expect(v, f.nome).toContain(`public.${f.nome}(`);
  });

  it("os md5 do roteiro são os do corpo das funções do arquivo (o roteiro não envelheceu)", () => {
    for (const f of novas) {
      expect(doc, `md5 de ${f.nome}`).toContain(`--   ${f.nome} ${md5(f.corpo)}`);
    }
  });

  it("o roteiro não usa a outra palavra do mercado, travessão nem seta fora do nome do teste", () => {
    const sem = doc.replace("tests/vocabulario-sem-revendedor.test.ts", "");
    expect(sem).not.toMatch(/revend/i);
    expect(doc).not.toMatch(/[—–→]/);
  });

  it("diz com todas as letras o que a chave antiga faz e que o dono não deve ligá-la", () => {
    expect(doc).toMatch(/O dono não deve ligá-la/);
    expect(doc).toContain("agente_apos_triagem");
    expect(doc).toMatch(/Ordem de publicação: aplique a migração ANTES do Publish/);
  });
});

describe("C3, revisão de 14/11/2026: o que o SQL faz (as provas de verdade estão no ensaio, estas seguram o texto)", () => {
  const corpo = (n: string) => novas.find((f) => f.nome === n)!.corpo;

  it("a retenção nunca apaga entregou, enviado e escolheu de conversa", () => {
    const v = corpo("agente_varrer");
    expect(v).toContain(
      "AND NOT (tipo IN ('entregou', 'enviado', 'escolheu') AND conversa_id IS NOT NULL)",
    );
    expect(v.indexOf("DELETE FROM public.agente_eventos")).toBeLessThan(
      v.indexOf("AND NOT (tipo IN"),
    );
  });

  it("o registro recusa conversa já entregue e cancela o pendente ao entregar e ao parar", () => {
    const r = corpo("agente_registrar");
    expect(r).toContain("'motivo', 'ja_entregue'");
    expect(r).toMatch(/e\.conversa_id = c\.id AND e\.tipo = 'entregou'[\s\S]{0,120}ja_entregue/);
    // ja_entregue é conferido DENTRO da trava da conversa
    expect(r.indexOf("FOR UPDATE")).toBeLessThan(r.indexOf("ja_entregue"));
    expect(r.match(/_agente_cancelar_pendentes\(c\.id\)/g)).toHaveLength(2);
    // a entrega que PROMETE avisar a equipe não cancela a resposta que acabou de enfileirar
    const passou = r.slice(
      r.indexOf("IF v_passar THEN"),
      r.indexOf("ELSIF v_acao = 'entregar' THEN"),
    );
    expect(passou).not.toContain("_agente_cancelar_pendentes");
  });

  it("pergunta de preço: o banco marca pelo tema, olha só eventos reais e o contador da triagem, e a resposta com produto não sai", () => {
    const r = corpo("agente_registrar");
    expect(r).toContain("v_sensivel := v_sensivel OR r.tema = 'valor_do_produto'");
    expect(r).toContain("OR r.produto_id IS NOT NULL THEN");
    expect(r).toMatch(/e\.sensivel\s+AND e\.tipo IN \('escolheu', 'entregou'\)\)/);
    expect(r).not.toMatch(/e\.sensivel[^)]*'ensaio'/);
    expect(r).toContain("coalesce(t.perguntas_de_preco, 0) >= 1");
    expect(r).toContain("v_motivo := 'preco_de_novo'");
    const c = corpo("agente_contexto");
    expect(c).toContain("coalesce(t.perguntas_de_preco, 0)");
    expect(c).toContain(
      "CASE WHEN g.estado = 'ensaio' THEN ARRAY['escolheu', 'entregou', 'ensaio']",
    );
    expect(codigo).toMatch(/column_name = 'perguntas_de_preco'/);
  });

  it("pediu_valor_de_novo não libera o agente", () => {
    const l = corpo("_agente_triagem_liberou");
    expect(l).toContain("IN ('etapa_esgotada', 'texto_livre')");
    expect(l).not.toContain("pediu_valor_de_novo");
  });

  it("freio de volume e rajada entregam à equipe; nenhum dos dois é barrar", () => {
    const r = corpo("agente_registrar");
    expect(r).toContain("v_acao := 'entregar'; v_motivo := 'freio_de_volume';");
    expect(r).toContain("v_acao := 'entregar'; v_motivo := 'rajada';");
    expect(r).not.toContain("resposta_em_andamento");
    expect(r).not.toMatch(/v_acao := 'barrar'; v_motivo := '(freio_de_volume|rajada)'/);
  });

  it("o aviso ao grupo usa o retorno de enfileirar_notificacao: NULL é ja_enviado", () => {
    const a = corpo("_agente_avisar_equipe");
    expect(a).toMatch(/SELECT public\.enfileirar_notificacao\([\s\S]*?\)\s+INTO v_id;/);
    expect(a).toContain("IF v_id IS NULL THEN RETURN 'ja_enviado'; END IF;");
    expect(a).not.toMatch(/PERFORM public\.enfileirar_notificacao/);
  });

  it("a fila leva resposta_id e versao, e a conferência recebe os dois e olha a resposta", () => {
    const r = corpo("agente_registrar");
    expect(r).toContain("'resposta_id', r.id, 'versao', r.versao");
    const f = novas.find((x) => x.nome === "agente_conferir_envio")!;
    expect(f.args.replace(/\s+/g, " ")).toBe(
      "p_conversa_id uuid, p_resposta_id uuid, p_versao integer",
    );
    expect(f.corpo).toContain("'resposta_aprovada'");
    expect(f.corpo).toContain("b.produto_id IS NULL");
    expect(f.corpo).toContain("_agente_problemas_de_texto(b.texto_aprovado, b.ramos)");
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public.agente_conferir_envio(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;",
    );
    expect(codigo).toContain(
      "GRANT EXECUTE ON FUNCTION public.agente_conferir_envio(uuid, uuid, integer) TO service_role;",
    );
  });

  it("toda recusa que a tela pode mostrar está escrita para a tela: acento, sem parênteses e sem sublinhado", () => {
    const frases = [...sql.matchAll(/RAISE EXCEPTION '((?:[^'%]|'')*)'(?:,|;)/g)].map((m) => m[1]);
    const daTela = frases.filter((f) =>
      /degrau|Seu perfil|Configuração inválida|números de teste|Desligar tudo|gerenciar o WhatsApp/.test(
        f,
      ),
    );
    expect(daTela.length).toBeGreaterThanOrEqual(8);
    for (const f of daTela) {
      expect(f, f).not.toMatch(/[()_]/);
      expect(f, f).toMatch(/[ãõçáéíóúâêôà]/i);
    }
  });

  it("o roteiro documenta o que a revisão pediu: filas cruzadas, FK em usuarios, ensaio que superestima, erro sem nova tentativa e sandbox_exec", () => {
    expect(doc).toMatch(/As filas do agente e da triagem se cruzam pela chave `triagem_id`/);
    expect(doc).toMatch(/desligar a triagem cancela também a linha do agente/);
    expect(doc).toMatch(/falhas de envio do agente contam no freio de falhas da triagem/);
    expect(doc).toMatch(/Chave estrangeira para `usuarios` também pede trava curta/);
    expect(doc).toMatch(/O ensaio superestima/);
    expect(doc).toMatch(/Erro transitório não tem nova tentativa/);
    expect(doc).toMatch(/O papel `sandbox_exec` mantém o acesso que a postura do projeto lhe dá/);
  });

  it("cada DROP FUNCTION da volta tem a assinatura (tipos dos argumentos) da função que a migração cria", () => {
    const tipos = (args: string) =>
      args
        .split(",")
        .map((x) =>
          x
            .replace(/\s+DEFAULT\s+.*$/i, "")
            .trim()
            .split(/\s+/)
            .at(-1),
        )
        .filter(Boolean)
        .join(",");
    const criadas = new Map(novas.map((f) => [f.nome, tipos(f.args)]));
    const drops = [...volta.matchAll(/DROP FUNCTION public\.(\w+)\(([^)]*)\);/g)];
    expect(drops.length).toBeGreaterThanOrEqual(14);
    for (const [, nome, args] of drops) {
      expect(criadas.has(nome), nome).toBe(true);
      expect(tipos(args), nome).toBe(criadas.get(nome));
    }
    // todas as funções novas caem, menos o dono, que volta ao corpo da B4
    const caem = new Set(drops.map((d) => d[1]));
    for (const f of novas)
      if (f.nome !== "triagem_dono_da_conversa") expect(caem.has(f.nome), f.nome).toBe(true);
  });

  it("a volta da C4 (DROP VIEW das 4 views) vem ANTES da da C3, é a mesma da seção 8.5, e a da C3 recusa rodar com as views", () => {
    expect(doc.indexOf(voltaDasViews)).toBeLessThan(doc.indexOf(volta));
    expect(doc.indexOf("### 5.0 ")).toBeLessThan(doc.indexOf("### 5.1 "));
    expect([...voltaDasViews.matchAll(/DROP VIEW public\.(\w+);/g)]).toHaveLength(4);
    expect(semComentarios(voltaDasViews)).not.toMatch(/CASCADE/i);
    const da85 = doc.slice(doc.indexOf("## 8.5 Voltar atrás"));
    expect(da85).toContain(voltaDasViews);
    expect(volta).toMatch(
      /relname LIKE 'agente\\_metricas\\_%'\) THEN\s+RAISE EXCEPTION 'As views da C4 ainda existem/,
    );
    expect(volta.indexOf("As views da C4 ainda existem")).toBeLessThan(
      volta.indexOf("DROP TABLE public.agente_eventos"),
    );
  });
});
