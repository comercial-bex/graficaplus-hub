import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BANCO da origem do contato e do aviso novo: a migração lida como texto.
 *
 * O que estas travas seguram:
 *  - só existem DUAS modalidades de contato, cliente_final e parceiro, e a palavra revendedor não entra;
 *  - as três tabelas novas têm RLS, ninguém de fora lê e ninguém grava direto: escrita só por função;
 *  - nenhum GRANT para o anon em lugar nenhum;
 *  - toda função nasce com search_path e as internas só o servidor executa;
 *  - o catálogo de anúncios e a classificação vivem em TABELA editável: 2 conjuntos e 8 anúncios semeados;
 *  - o aviso novo só tem um destino, o grupo da equipe, e nada do preço volta ao cliente;
 *  - a RPC da mensagem mantém os 12 parâmetros e o bloco novo não derruba a mensagem;
 *  - a migração não toca em clientes.revendedor, parceiros, orçamentos nem preço.
 */

const PASTA = join(__dirname, "..", "supabase/migrations");
const NOME = "20261113100000_origem_do_contato_e_aviso_novo.sql";
const BRUTO = readFileSync(join(PASTA, NOME), "utf8");

/** Tira os comentários `--` para que explicar algo num comentário não passe nem reprove. */
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const SQL = semComentarios(BRUTO);

/** Corpo de `CREATE OR REPLACE FUNCTION public.<nome>(` até o `$function$;` que fecha. */
function corpoDa(nome: string): string {
  const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `a função ${nome} não está na migração`).toBeGreaterThanOrEqual(0);
  const fim = SQL.indexOf("$function$;", inicio);
  expect(fim).toBeGreaterThan(inicio);
  return SQL.slice(inicio, fim + "$function$;".length);
}

/** Todos os GRANT do arquivo, como { o que, para quem }. */
function grants(): { alvo: string; para: string[] }[] {
  return [...SQL.matchAll(/\bGRANT\b([^;]+?)\bTO\b([^;]+);/gi)].map((m) => ({
    alvo: m[1].trim(),
    para: m[2].split(",").map((p) => p.trim().toLowerCase()),
  }));
}

const TABELAS = ["conjuntos_anuncio", "anuncios_origem", "palavras_de_origem"];

const INTERNAS = [
  ["_wa_registrar_anuncio", "text, jsonb, timestamptz, boolean"],
  ["_wa_classificar_contato", "text, text, uuid, uuid"],
  ["tg_atendimento_traz_contexto", ""],
  ["tg_lead_tipo_confiavel", ""],
  ["tg_atendimento_avisa_grupo", ""],
  ["whatsapp_definir_tipo_do_contato", "uuid, uuid, text"],
] as const;

const DA_TELA = [
  ["origem_salvar_conjunto", "text, text, text, text, text, text, boolean"],
  ["origem_vincular_anuncio", "text, text"],
  ["origem_salvar_anuncio", "text, text, text, boolean"],
  ["origem_salvar_palavra", "text, boolean"],
  ["origem_remover_palavra", "text"],
] as const;

describe("cabeçalho e transação", () => {
  it("diz que foi aplicada em 13 de novembro de 2026 e que a ordem era aplicar antes de publicar o front", () => {
    const cabecalho = BRUTO.split("\n").slice(0, 12).join("\n");
    expect(cabecalho).toMatch(/^-- APLICADA em 13\/11\/2026\./);
    expect(BRUTO).toMatch(/ANTES de publicar o front/);
  });

  it("é uma migração só, transacional, e termina com a conferência que desfaz tudo se algo estiver fora", () => {
    expect(SQL).toMatch(/^\s*BEGIN;/m);
    expect(SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(SQL).toContain("DO $conferencia$");
    expect(SQL).toContain("RAISE EXCEPTION 'whatsapp_registrar_mensagem ficou com % versões");
    expect(SQL).toContain("IF v_n <> 12 THEN");
  });

  it("o ensaio do dono existe e cobre a simulação do aviso", () => {
    const ensaio = join(__dirname, "..", "docs/ensaio-origem-do-contato.md");
    expect(existsSync(ensaio)).toBe(true);
    const texto = readFileSync(ensaio, "utf8");
    expect(texto).toContain("RAISE EXCEPTION E'ENSAIO CONCLUÍDO");
    for (const caso of ["LEAD NOVO de anúncio", "LEAD NOVO sem anúncio", "CLIENTE VOLTOU", "QUER SER PARCEIRO"]) {
      expect(texto, `o ensaio não mostra o caso ${caso}`).toContain(caso);
    }
  });
});

describe("duas modalidades, nunca revendedor", () => {
  it("a palavra revendedor não aparece em nenhuma linha de código da migração", () => {
    expect(SQL).not.toMatch(/revendedor/i);
  });

  it("os CHECKs de tipo aceitam só cliente_final e parceiro", () => {
    expect(SQL).toContain("CONSTRAINT conjuntos_anuncio_tipo_check CHECK (tipo IN ('cliente_final', 'parceiro'))");
    expect(SQL).toContain("CONSTRAINT leads_tipo_check CHECK (tipo IN ('cliente_final', 'parceiro'))");
    expect(SQL).toContain(
      "CONSTRAINT whatsapp_atendimentos_tipo_contato_check CHECK (tipo_contato IN ('cliente_final', 'parceiro'))",
    );
    // Todo IN ('...') de tipo da migração só tem esses dois valores.
    const listas = [...SQL.matchAll(/\btipo(?:_contato)?\s+IN\s*\(([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ""));
    expect(listas.length).toBeGreaterThanOrEqual(3);
    for (const l of listas) expect(l).toBe("'cliente_final','parceiro'");
  });

  it("a palavra de origem só pode apontar para parceiro e precisa estar normalizada", () => {
    expect(SQL).toContain("CONSTRAINT palavras_de_origem_tipo_check CHECK (tipo = 'parceiro')");
    expect(SQL).toContain("palavra = public.bex_normalizar_texto(palavra)");
  });

  it("a origem do tipo tem só quatro valores", () => {
    expect(SQL).toContain("CHECK (tipo_origem IN ('anuncio', 'palavra', 'telefone', 'manual'))");
    expect(SQL).toContain("CHECK (origem_do_tipo IN ('anuncio', 'palavra', 'telefone', 'manual'))");
  });

  it("cliente_final nunca é classificado por palavra nem por telefone", () => {
    const corpo = corpoDa("_wa_classificar_contato");
    const ramos = [...corpo.matchAll(/v_tipo := ([^;]+);/g)].map((m) => m[1].trim());
    // lead manual, anúncio, palavra e telefone: só o do anúncio e o do lead manual vêm de dado; palavra e telefone são 'parceiro'
    expect(ramos).toEqual(["v_lead_tipo", "v_tipo_anuncio", "'parceiro'", "'parceiro'"]);
  });
});

describe("tabelas novas: RLS, leitura da equipe e escrita só por função", () => {
  for (const t of TABELAS) {
    it(`${t}: RLS ligada, REVOKE por nome, só SELECT para authenticated`, () => {
      expect(SQL).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(SQL).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(SQL).toContain(`GRANT SELECT ON public.${t} TO authenticated;`);
      expect(SQL).toContain(`GRANT ALL ON public.${t} TO service_role;`);
      const dela = grants().filter((g) => g.alvo.includes(`public.${t}`) && !g.alvo.startsWith("EXECUTE"));
      expect(dela.map((g) => `${g.alvo}|${g.para.join(",")}`).sort()).toEqual([
        `ALL ON public.${t}|service_role`,
        `SELECT ON public.${t}|authenticated`,
      ]);
    });

    it(`${t}: uma policy só, de leitura, da equipe, sem subconsulta em tabela com RLS`, () => {
      const policies = [...SQL.matchAll(new RegExp(`CREATE POLICY "[^"]+" ON public\\.${t}\\b([^;]+);`, "g"))].map(
        (m) => m[1],
      );
      expect(policies).toHaveLength(1);
      const p = policies[0];
      expect(p).toMatch(/FOR SELECT TO authenticated/);
      expect(p).toContain("public.is_staff((SELECT auth.uid()))");
      expect(p).toContain("public.has_permission((SELECT auth.uid()), 'whatsapp.read')");
      expect(p).toContain("public.has_permission((SELECT auth.uid()), 'configuracoes.manage')");
      expect(p).not.toMatch(/\bFROM\b/i);
    });
  }

  it("nenhum GRANT em lugar nenhum da migração vai para anon ou PUBLIC", () => {
    const todos = grants();
    expect(todos.length).toBeGreaterThan(10);
    for (const g of todos) {
      expect(g.para, `GRANT ${g.alvo}`).not.toContain("anon");
      expect(g.para, `GRANT ${g.alvo}`).not.toContain("public");
    }
  });

  it("nenhum GRANT de INSERT, UPDATE ou DELETE para authenticated", () => {
    for (const g of grants()) {
      if (g.para.includes("authenticated") && !g.alvo.startsWith("EXECUTE")) {
        expect(g.alvo, `GRANT ${g.alvo}`).toMatch(/^SELECT\b/);
      }
    }
  });

  it("não cria visão sobre as tabelas novas", () => {
    expect(SQL).not.toMatch(/CREATE\s+(OR REPLACE\s+)?VIEW/i);
  });
});

describe("funções: search_path, dono do privilégio e SECURITY DEFINER", () => {
  it("toda função criada tem SET search_path TO 'public'", () => {
    const nomes = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
    expect(nomes.length).toBeGreaterThanOrEqual(13);
    for (const n of nomes) {
      expect(corpoDa(n), `${n} sem search_path`).toContain("SET search_path TO 'public'");
    }
  });

  it("toda função criada revoga de PUBLIC, anon e authenticated pelo nome", () => {
    const nomes = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
    for (const n of nomes) {
      expect(
        SQL,
        `${n} sem REVOKE explícito (REVOKE de PUBLIC não fecha o anon)`,
      ).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${n}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    }
  });

  for (const [nome, assinatura] of INTERNAS) {
    it(`${nome}: só o service_role executa`, () => {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${nome}(${assinatura}) FROM PUBLIC, anon, authenticated;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${nome}(${assinatura}) TO service_role;`);
      const quem = grants()
        .filter((g) => g.alvo.startsWith("EXECUTE") && g.alvo.includes(`public.${nome}(`))
        .flatMap((g) => g.para);
      expect(quem).toEqual(["service_role"]);
    });
  }

  for (const nome of ["_wa_registrar_anuncio", "_wa_classificar_contato", "tg_atendimento_avisa_grupo", "whatsapp_definir_tipo_do_contato"]) {
    it(`${nome} é SECURITY DEFINER`, () => {
      expect(corpoDa(nome)).toMatch(/\bSECURITY DEFINER\b/);
    });
  }

  it("os dois gatilhos que precisam do chamador real rodam sem SECURITY DEFINER", () => {
    expect(corpoDa("tg_lead_tipo_confiavel")).not.toMatch(/SECURITY DEFINER/);
    expect(corpoDa("tg_atendimento_traz_contexto")).not.toMatch(/SECURITY DEFINER/);
    expect(corpoDa("tg_lead_tipo_confiavel")).toContain("current_user IN ('postgres', 'service_role', 'supabase_admin')");
  });

  for (const [nome, assinatura] of DA_TELA) {
    it(`${nome}: authenticated executa e a primeira linha exige configuracoes.manage`, () => {
      expect(corpoDa(nome)).toMatch(/\bSECURITY DEFINER\b/);
      expect(corpoDa(nome)).toMatch(/BEGIN\s+PERFORM public\.require_permission\('configuracoes\.manage'\);/);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${nome}(${assinatura}) TO authenticated, service_role;`);
    });
  }

  it("a normalização é pura e a tela pode chamá-la", () => {
    const corpo = corpoDa("bex_normalizar_texto");
    expect(corpo).toMatch(/\bIMMUTABLE\b/);
    expect(corpo).not.toMatch(/\bFROM\s+public\./);
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.bex_normalizar_texto(text) TO authenticated, service_role;");
    // Sem a extensão unaccent: a conta é feita com translate.
    expect(corpo).toContain("translate(");
    expect(SQL).not.toMatch(/unaccent\s*\(/i);
  });

  it("as funções da tela não mexem em parceiros, clientes, orçamentos nem em preço", () => {
    for (const [nome] of DA_TELA) {
      expect(corpoDa(nome), nome).not.toMatch(/\b(parceiros|clientes|orcamentos|orcamento_itens|parceiro_niveis)\b/);
    }
  });
});

describe("seed: a conta de anúncios Bex Print", () => {
  // As funções também têm INSERT nestas tabelas: o seed é o INSERT com a lista de colunas e VALUES de linhas fixas.
  const iConjuntos = SQL.indexOf("INSERT INTO public.conjuntos_anuncio (conjunto_id, nome, campanha_id, campanha_nome, tipo, produto_padrao, ativo) VALUES");
  const iAnuncios = SQL.indexOf("INSERT INTO public.anuncios_origem (anuncio_id, conjunto_id, nome_interno, produto, ativo) VALUES");
  const iPalavras = SQL.indexOf("INSERT INTO public.palavras_de_origem (palavra, tipo, ativo) VALUES\n");
  const conjuntos = SQL.slice(iConjuntos, iAnuncios);
  const anuncios = SQL.slice(iAnuncios, iPalavras);
  const palavras = SQL.slice(iPalavras, SQL.indexOf("DO $conferencia$"));

  it("dois conjuntos com os ids e o tipo certos", () => {
    const linhas = [...conjuntos.matchAll(/\('(\d{18})', '([^']+)',\s*'(\d{18})', '([^']+)', '(cliente_final|parceiro)'/g)];
    expect(linhas.map((m) => [m[1], m[5]])).toEqual([
      ["120252255931120481", "cliente_final"],
      ["120252255945380481", "parceiro"],
    ]);
    expect(conjuntos).toContain("ON CONFLICT (conjunto_id) DO NOTHING");
  });

  it("oito anúncios, cada um no conjunto certo, com os pausados inativos", () => {
    const linhas = [...anuncios.matchAll(/\('(\d{18})', '(\d{18})', '([^']+)', (NULL|'[^']+'), (true|false)\)/g)].map((m) => ({
      id: m[1],
      conjunto: m[2],
      ativo: m[5] === "true",
      produto: m[4] === "NULL" ? null : m[4].slice(1, -1),
    }));
    expect(linhas).toHaveLength(8);
    const doClienteFinal = "120252255931120481";
    const doParceiro = "120252255945380481";
    expect(linhas.map((l) => [l.id, l.conjunto, l.ativo])).toEqual([
      ["120252258241960481", doClienteFinal, true],
      ["120252258241750481", doClienteFinal, true],
      ["120252258241600481", doClienteFinal, true],
      ["120252258242200481", doClienteFinal, false],
      ["120252256242340481", doClienteFinal, false],
      ["120252255941070481", doClienteFinal, false],
      ["120252264127430481", doParceiro, true],
      ["120252255959270481", doParceiro, false],
    ]);
    // O criativo troca e o id fica: só o Brindes 3D tem produto semeado; os dois Expresso seguem o título que chega.
    expect(linhas.filter((l) => l.produto).map((l) => l.id)).toEqual(["120252258241960481"]);
    expect(anuncios).toContain("ON CONFLICT (anuncio_id) DO NOTHING");
  });

  it("as palavras já estão normalizadas, só apontam para parceiro e incluem o feminino", () => {
    const lista = [...palavras.matchAll(/\('([^']+)', 'parceiro', true\)/g)].map((m) => m[1]);
    expect(lista.sort()).toEqual(
      ["parceria", "quero ser parceira", "quero ser parceiro", "ser parceira", "ser parceiro", "terceirizada", "terceirizado"].sort(),
    );
    for (const p of lista) expect(p).toBe(p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    expect(palavras).not.toMatch(/'cliente_final'/);
  });

  it("o anúncio herda o tipo do conjunto: não existe coluna de tipo no anúncio", () => {
    const tabela = SQL.slice(SQL.indexOf("CREATE TABLE IF NOT EXISTS public.anuncios_origem"), SQL.indexOf("CREATE INDEX IF NOT EXISTS anuncios_origem_conjunto_idx"));
    expect(tabela).not.toMatch(/\btipo\b/);
    expect(tabela).toContain("conjunto_id text REFERENCES public.conjuntos_anuncio (conjunto_id) ON DELETE SET NULL");
    expect(tabela).toContain("conjunto_definido_por");
    // Encaixe da sincronização futura com a Meta: colunas existem, ninguém escreve nelas aqui.
    expect(SQL).not.toMatch(/(INSERT|UPDATE)[^;]*\bmeta_sincronizado_em\b[^;]*=\s*now\(\)/i);
  });

  it("trocar o criativo mantendo o id só atualiza título e corpo guardados", () => {
    const corpo = corpoDa("_wa_registrar_anuncio");
    expect(corpo).toContain("ON CONFLICT (anuncio_id) DO UPDATE SET");
    expect(corpo).toContain("titulo_criativo = coalesce(EXCLUDED.titulo_criativo, anuncios_origem.titulo_criativo)");
    expect(corpo).toContain("total_contatos = anuncios_origem.total_contatos + EXCLUDED.total_contatos");
    expect(corpo).not.toMatch(/conjunto_id\s*=/);
  });
});

describe("whatsapp_registrar_mensagem: os 12 parâmetros e o bloco que não derruba a mensagem", () => {
  const corpo = corpoDa("whatsapp_registrar_mensagem");
  const assinatura = corpo.slice(corpo.indexOf("("), corpo.indexOf("\n RETURNS"));

  it("continua com exatamente 12 parâmetros e os mesmos nomes (nada de sobrecarga)", () => {
    const nomes = [...assinatura.matchAll(/\b(p_[a-z_]+) /g)].map((m) => m[1]);
    expect(nomes).toEqual([
      "p_instancia_id", "p_zapi_message_id", "p_telefone", "p_direcao", "p_tipo", "p_texto", "p_legenda",
      "p_media_url", "p_nome_contato", "p_payload", "p_momento", "p_origem",
    ]);
    expect([...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.whatsapp_registrar_mensagem\(/g)]).toHaveLength(1);
  });

  it("preserva o que a versão viva fazia: CASE de canal e 'Anúncio <id>', lead só de gente fora da equipe, lock", () => {
    expect(corpo).toContain("CASE p_payload->>'canal_origem'");
    expect(corpo).toContain("THEN 'Anúncio ' || btrim(p_payload->>'anuncio_id')");
    expect(corpo).toContain("AND NOT public._wa_telefone_da_equipe(v_tel) THEN");
    expect(corpo).toContain("PERFORM pg_advisory_xact_lock(hashtext(p_instancia_id::text || ':' || p_zapi_message_id));");
    expect(corpo).toContain("ON CONFLICT (instancia_id, zapi_message_id) DO NOTHING");
    expect(corpo).toContain("'telefone_normalizado', v_tel");
  });

  it("o bloco novo vai inteiro dentro de EXCEPTION WHEN OTHERS com RAISE WARNING que identifica a conversa e a mensagem", () => {
    const inicio = corpo.indexOf("IF p_direcao = 'entrada' THEN\n    BEGIN");
    expect(inicio).toBeGreaterThan(0);
    const fim = corpo.indexOf("END;\n  END IF;", inicio);
    const bloco = corpo.slice(inicio, fim);
    expect(bloco).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'origem do contato falhou \(conversa %, mensagem %, anuncio %\): % \[%\]'/);
    expect(bloco).toContain("v_conversa.id, p_zapi_message_id, v_anuncio, SQLERRM, SQLSTATE");
    // Tudo que usa tabela nova está dentro do bloco.
    for (const chamada of ["_wa_registrar_anuncio", "_wa_classificar_contato", "set_config('bex.contato_ctx'"]) {
      expect(bloco).toContain(chamada);
      expect(corpo.indexOf(chamada)).toBeGreaterThan(inicio);
      expect(corpo.indexOf(chamada)).toBeLessThan(fim);
    }
    // Não há EXCEPTION sem RAISE em lugar nenhum da migração.
    for (const m of SQL.matchAll(/EXCEPTION WHEN OTHERS THEN([\s\S]{0,200})/g)) {
      expect(m[1], "EXCEPTION que engole o erro sem avisar").toMatch(/RAISE WARNING|v_nivel := NULL|NULL;/);
    }
  });

  it("a variável de contexto é zerada logo depois do INSERT da mensagem, fora do bloco que pode falhar", () => {
    const limpeza = "PERFORM set_config('bex.contato_ctx', '', true);";
    const posLimpeza = corpo.indexOf(limpeza);
    expect(posLimpeza).toBeGreaterThan(corpo.indexOf("INSERT INTO public.whatsapp_mensagens"));
    expect(posLimpeza).toBeLessThan(corpo.lastIndexOf("RETURN jsonb_build_object("));
    // E o contexto só vale dentro da transação.
    expect(corpo).toMatch(/\)::text, true\);/);
  });

  it("só conta contato novo quando a mensagem vai abrir atendimento, com a mesma condição do gatilho da mensagem", () => {
    expect(corpo).toContain("v_abre := v_conversa.atendimento_ativo_id IS NULL");
    expect(corpo).toContain("AND p_tipo <> 'sistema'");
    expect(corpo).toContain("AND COALESCE(p_origem, 'humano') <> 'automacao'");
    expect(corpo).toContain("AND NOT public._wa_telefone_da_equipe(v_tel);");
    expect(corpo).toContain("PERFORM public._wa_registrar_anuncio(v_anuncio, p_payload, v_quando, v_abre);");
  });

  it("nunca sobrescreve a etiqueta que já existe no lead", () => {
    expect(corpo).toContain("WHERE id = v_conversa.lead_id AND tipo IS NULL;");
  });

  it("o gatilho do atendimento só copia o contexto da mesma conversa", () => {
    const g = corpoDa("tg_atendimento_traz_contexto");
    expect(g).toContain("(v_ctx->>'conversa_id')::uuid = NEW.conversa_id");
    expect(g).toContain("current_setting('bex.contato_ctx', true)");
    expect(g).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'contexto do contato falhou \(atendimento %\): %'/);
    expect(SQL).toMatch(/CREATE TRIGGER tg_atendimento_traz_contexto BEFORE INSERT ON public\.whatsapp_atendimentos/);
    // O aviso é AFTER INSERT e continua sendo o mesmo gatilho: a migração não recria o gatilho do aviso.
    expect(SQL).not.toMatch(/CREATE TRIGGER tg_atendimento_avisa_grupo/);
  });
});

describe("o aviso novo no grupo da equipe", () => {
  const aviso = corpoDa("tg_atendimento_avisa_grupo");

  it("só enfileira para o grupo da equipe e a chave de idempotência continua por atendimento", () => {
    const chamadas = [...aviso.matchAll(/enfileirar_notificacao\(([^;]+?)\);/g)].map((m) => m[1].replace(/\s+/g, " "));
    expect(chamadas).toHaveLength(2); // o texto novo e o aviso mínimo de reserva
    for (const c of chamadas) {
      expect(c).toMatch(/^'whatsapp', v_grupo, /);
      expect(c).toContain("'aviso_grupo_equipe'");
      expect(c).toContain("'grupo_equipe:atendimento:' || NEW.id");
    }
    expect(aviso).toContain("v_grupo text := public.grupo_equipe_destino();");
    // Nenhuma outra porta de saída: nem envio direto, nem telefone do contato como destino.
    expect(aviso).not.toMatch(/whatsapp_responder|zapi|v_conv\.telefone\s*,\s*v_conv\.cliente_id/i);
    expect(aviso).not.toMatch(/enfileirar_notificacao\('whatsapp', v_conv/);
  });

  it("mantém as saídas de antes: manual, telefone de equipe que não é só parceiro, e grupo sem configuração", () => {
    expect(aviso).toContain("IF v_grupo IS NULL OR NEW.origem_abertura::text = 'manual' THEN RETURN NEW; END IF;");
    expect(aviso).toContain("r.role::text <> 'parceiro'");
  });

  it("o erro vira RAISE WARNING que identifica o atendimento, e sai um aviso mínimo para a equipe não ficar sem saber", () => {
    expect(aviso).toMatch(/RAISE WARNING 'aviso no grupo da equipe falhou \(atendimento %, conversa %\): % \[%\]',\s+NEW\.id, NEW\.conversa_id, SQLERRM, SQLSTATE/);
    expect(aviso).toContain("IF v_passou THEN");
    expect(aviso).toContain("🆕 NOVO ATENDIMENTO");
  });

  it("o texto traz título, rótulos em palavras, primeira mensagem, preço, link e protocolo na última linha", () => {
    for (const t of [
      "🆕 LEAD NOVO", "🔁 CLIENTE VOLTOU", "🤝 PARCEIRO", "🤝 QUER SER PARCEIRO", "🔁 VOLTOU A CONVERSAR",
      " · anúncio ", "👤 ", "💬 \"", "📣 Origem: contato direto, sem anúncio", "📣 Origem: não identificada",
      "🏷️ Cliente: ", "📄 Tem ", "🕒 Última conversa ", "💰 Preço: ", "👉 Responder: https://bexprint.com.br/whatsapp?conversa=",
      "'Protocolo ' || NEW.numero",
    ]) {
      expect(aviso, `faltou ${t} no aviso`).toContain(t);
    }
    // O protocolo é o último argumento do concat_ws.
    expect(aviso).toMatch(/'👉 Responder: https:\/\/bexprint\.com\.br\/whatsapp\?conversa=' \|\| NEW\.conversa_id,\s+'Protocolo ' \|\| NEW\.numero\);/);
    for (const midia of ["uma foto", "um áudio", "um vídeo", "um documento", "uma localização", "um contato"]) {
      expect(aviso, `faltou "Enviou ${midia}"`).toContain(`Enviou ${midia}`);
    }
  });

  it("o texto do preço tem as cinco frases combinadas e fica só no grupo", () => {
    for (const frase of [
      "'parceiro' || COALESCE(', nível ' || v_nivel, '')",
      "'cliente final, tabela cheia'",
      "'tabela cheia até o cadastro como parceiro'",
      "'tipo a confirmar'",
    ]) {
      expect(aviso, `faltou ${frase}`).toContain(frase);
    }
    // Aviso interno: pode dizer parceiro e tabela cheia, mas nunca palavra de revendedor nem preço diferenciado.
    expect(aviso).not.toMatch(/revendedor|preço diferenciado|valor diferenciado/i);
    // Nada que o contato leria: nenhum template de cliente, nenhuma resposta, nenhum documento.
    expect(aviso).not.toMatch(/cobranca_orcamento|documento_enviado|whatsapp_responder|mensagem_ao_cliente/i);
  });

  it("não escreve 'tabela de parceiro' nem preço diferenciado voltados ao cliente em lugar nenhum da migração", () => {
    expect(SQL).not.toMatch(/tabela de parceiro/i);
    expect(SQL).not.toMatch(/preço diferenciado|valor diferenciado/i);
    // A migração não cria mensagem, modelo nem automação para o contato.
    expect(SQL).not.toMatch(/whatsapp_responder|INSERT INTO public\.(automacoes|notificacoes_modelos|documentos_enviados)/i);
  });

  it("a ordem do título: volta de conversa vence, depois parceiro cadastrado, quer ser parceiro, cliente voltou, lead novo", () => {
    const i = [
      "NEW.reaberto_de IS NOT NULL THEN '🔁 VOLTOU A CONVERSAR'",
      "v_parc IS NOT NULL OR (NEW.tipo_contato = 'parceiro' AND NEW.origem_do_tipo = 'telefone') THEN '🤝 PARCEIRO'",
      "NEW.tipo_contato = 'parceiro' THEN '🤝 QUER SER PARCEIRO'",
      "v_conv.cliente_id IS NOT NULL THEN '🔁 CLIENTE VOLTOU'",
      "ELSE '🆕 LEAD NOVO'",
    ].map((t) => aviso.indexOf(t));
    for (const p of i) expect(p).toBeGreaterThan(0);
    expect([...i].sort((a, b) => a - b)).toEqual(i);
  });

  it("a última conversa vem das mensagens do atendimento anterior, não de ultima_mensagem_at", () => {
    expect(aviso).toContain("m.atendimento_id = NEW.reaberto_de");
    expect(aviso).not.toMatch(/ultima_mensagem_at/);
  });

  it("lê só o que o atendimento carrega, a conversa, o cliente e o parceiro: nunca a tabela de mensagens para o texto", () => {
    expect(aviso).toContain("NEW.primeira_mensagem");
    expect(aviso).toContain("public.parceiro_ativo_do_cliente(v_conv.cliente_id)");
    expect(aviso).toMatch(/status IN \('rascunho', 'enviado'\)/);
  });
});

describe("a migração não toca no que o dono mandou deixar quieto", () => {
  const TOCADAS = ["clientes", "parceiros", "orcamentos", "orcamento_itens", "parceiro_niveis", "parceiro_compras"];

  it("nenhum INSERT, UPDATE, DELETE nem ALTER em clientes, parceiros, orçamentos ou preço", () => {
    for (const t of TOCADAS) {
      expect(SQL, `escreve em ${t}`).not.toMatch(new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|ALTER\\s+TABLE|TRUNCATE)\\s+(ONLY\\s+)?(public\\.)?${t}\\b`, "i"));
    }
  });

  it("clientes.revendedor não aparece", () => {
    expect(BRUTO.split("\n").filter((l) => !l.trim().startsWith("--"))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/revendedor/i)]),
    );
    expect(SQL).not.toMatch(/revendedor/i);
  });

  it("só lê parceiros e orçamentos, e só para classificar e avisar", () => {
    const leem = [...SQL.matchAll(/\bFROM\s+public\.(parceiros|orcamentos|clientes)\b/g)].length;
    expect(leem).toBeGreaterThan(0);
    // Nenhuma função de preço é recriada aqui.
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(parceiro_nivel|parceiro_ativo_do_cliente|orcamento_de_parceiro_ativo|tg_orcamento_modo_parceiro_automatico|calcular_|preco_)/);
  });

  it("nenhuma função de preço passa a ler leads.tipo ou o tipo do atendimento", () => {
    // Quem lê tipo_contato, tipo_origem ou leads.tipo na migração: só a classificação, o aviso, a tela e a RPC da mensagem.
    const funcoesQueLeem = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)]
      .map((m) => m[1])
      .filter((n) => /\b(tipo_contato|tipo_origem|origem_do_tipo)\b|\bl\.tipo\b|public\.leads\s+SET\s+tipo/.test(corpoDa(n)));
    expect(funcoesQueLeem.sort()).toEqual([
      "_wa_classificar_contato",
      "tg_atendimento_avisa_grupo",
      "tg_atendimento_traz_contexto",
      "tg_lead_tipo_confiavel",
      "whatsapp_definir_tipo_do_contato",
      "whatsapp_registrar_mensagem",
    ]);
  });
});

describe("gatilho que impede forjar a origem da etiqueta pela API", () => {
  it("quem chama pela API só grava origem manual", () => {
    const g = corpoDa("tg_lead_tipo_confiavel");
    expect(g).toContain("NEW.tipo_origem := 'manual';");
    expect(g).toContain("NEW.tipo_origem := OLD.tipo_origem;");
    expect(SQL).toMatch(/CREATE TRIGGER tg_leads_tipo_confiavel BEFORE INSERT OR UPDATE ON public\.leads/);
  });

  it("marcar na mão passa pela função do servidor, que exige whatsapp.reply e grava o evento no histórico", () => {
    const f = corpoDa("whatsapp_definir_tipo_do_contato");
    expect(f).toContain("PERFORM public._wa_exigir_resposta(p_usuario);");
    expect(f).toContain("'Este contato já é cliente cadastrado: o preço segue o cadastro.'");
    expect(f).toContain("INSERT INTO public.whatsapp_conversa_eventos");
    expect(SQL).toContain("'atendimento', 'tipo_contato']");
  });
});
