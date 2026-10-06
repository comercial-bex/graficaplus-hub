import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { permissions } from "../src/lib/permissions";

/**
 * A MIGRAÇÃO das permissões por pessoa (20261006200000).
 *
 * O ensaio no banco (DO … RAISE EXCEPTION, tudo desfeito) provou o
 * comportamento: 2.261 respostas de has_permission idênticas com a tabela
 * vazia, e dar / tirar / vencida / vencimento futuro em pessoas reais, com
 * cada papel simulado e o visitante (anon) barrado. Este teste segura o que o
 * repositório pode estragar depois: uma linha de REVOKE perdida, um GRANT a
 * mais, a guarda de admin trocada, uma chave escrita dentro de função (que
 * enganaria o "ainda não faz nada"), ou a regra de desativado divergindo.
 */

const DIR = join(__dirname, "../supabase/migrations");
const ARQUIVO = "20261006200000_permissoes_por_pessoa.sql";
const sql = readFileSync(join(DIR, ARQUIVO), "utf8");
/** Sem comentários: o cabeçalho cita nomes e palavras que confundiriam as buscas. */
const codigo = sql.replace(/--.*$/gm, "");

function corpo(funcao: string): string {
  const m = codigo.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${funcao}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$`,
    ),
  );
  expect(m, `função ${funcao} não encontrada`).not.toBeNull();
  return m![1];
}

function cabecalho(funcao: string): string {
  const m = codigo.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${funcao}\\(([\\s\\S]*?)AS \\$function\\$`),
  );
  expect(m, `função ${funcao} não encontrada`).not.toBeNull();
  return m![1].replace(/\s+/g, " ");
}

const normal = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const TELA = [
  ["minhas_permissoes", "public.minhas_permissoes()"],
  ["permissoes_da_pessoa", "public.permissoes_da_pessoa(uuid)"],
  [
    "definir_excecao_permissao",
    "public.definir_excecao_permissao(uuid, text, boolean, timestamptz, text)",
  ],
  ["remover_excecao_permissao", "public.remover_excecao_permissao(uuid, text, text)"],
  ["permissoes_uso_no_banco", "public.permissoes_uso_no_banco()"],
] as const;

describe("as tabelas: ninguém lê nem grava direto", () => {
  it("RLS ligada nas duas", () => {
    for (const t of ["permissoes_excecoes", "permissoes_excecoes_historico"]) {
      expect(codigo).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it("REVOKE de PUBLIC, anon e authenticated — PUBLIC sozinho não fecha o anon", () => {
    expect(codigo).toContain(
      "REVOKE ALL ON TABLE public.permissoes_excecoes FROM PUBLIC, anon, authenticated;",
    );
    expect(codigo).toContain(
      "REVOKE ALL ON TABLE public.permissoes_excecoes_historico FROM PUBLIC, anon, authenticated;",
    );
    expect(codigo).toContain(
      "REVOKE ALL ON SEQUENCE public.permissoes_excecoes_historico_id_seq FROM PUBLIC, anon, authenticated;",
    );
  });

  it("nenhum GRANT e nenhuma policy nas tabelas novas: tudo passa pelas funções", () => {
    expect(codigo).not.toMatch(/GRANT[^;]*ON\s+(TABLE\s+)?public\.permissoes_excecoes/i);
    expect(codigo).not.toMatch(/GRANT[^;]*ON\s+SEQUENCE/i);
    expect(codigo).not.toMatch(/CREATE POLICY[^;]*permissoes_excecoes/i);
  });

  it("uma exceção por pessoa + chave; a chave aponta para o catálogo, a pessoa para usuarios", () => {
    expect(codigo).toContain(
      "CONSTRAINT permissoes_excecoes_pkey PRIMARY KEY (usuario_id, permissao)",
    );
    expect(codigo).toMatch(/permissao\s+text\s+NOT NULL REFERENCES public\.permissoes\(chave\)/);
    // usuarios.id É o id de login (usuarios_id_fkey → auth.users): has_permission
    // recebe auth.uid() e casa com esta coluna sem conversão.
    expect(codigo).toMatch(
      /usuario_id uuid\s+NOT NULL REFERENCES public\.usuarios\(id\) ON DELETE CASCADE/,
    );
  });

  it("o histórico é gravado por gatilho, e o gatilho não é chamável por ninguém", () => {
    expect(codigo).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.permissoes_excecoes/);
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public.tg_permissoes_excecoes_historico() FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(codigo).not.toMatch(/GRANT[^;]*tg_permissoes_excecoes_historico/);
  });
});

describe("as funções que a tela chama", () => {
  it.each(TELA)("%s: nasce fechada e abre só para authenticated", (_nome, assinatura) => {
    expect(codigo).toContain(
      `REVOKE ALL ON FUNCTION ${assinatura} FROM PUBLIC, anon, authenticated;`,
    );
    expect(codigo).toContain(`GRANT EXECUTE ON FUNCTION ${assinatura} TO authenticated;`);
    expect(codigo).not.toMatch(
      new RegExp(`GRANT[^;]*${assinatura.replace(/[().]/g, "\\$&")}[^;]*\\banon\\b`),
    );
  });

  it.each(TELA)("%s: SECURITY DEFINER com search_path fixo", (nome) => {
    const c = cabecalho(nome);
    expect(c).toContain("SECURITY DEFINER");
    expect(c).toContain("SET search_path TO 'public'");
  });

  it("dar, tirar, desfazer, ver o painel e ver o uso: só papel admin E conta ativa", () => {
    for (const nome of [
      "permissoes_da_pessoa",
      "definir_excecao_permissao",
      "remover_excecao_permissao",
      "permissoes_uso_no_banco",
    ]) {
      const c = normal(corpo(nome));
      expect(c, nome).toContain(
        "v_uid is null or not public.has_role(v_uid, 'admin'::public.app_role) or public.usuario_desativado(v_uid)",
      );
      expect(c, nome).toContain("errcode = '42501'");
      // A chave permissoes.manage NÃO é porta: dá-la a alguém não entrega o painel.
      expect(c, nome).not.toContain("has_permission(v_uid");
    }
  });

  it("dar recusa: admin, quem não é da equipe, chave do portal de fora, sem motivo, data passada", () => {
    const c = corpo("definir_excecao_permissao");
    expect(c).toContain("public.has_role(p_usuario_id, 'admin'::public.app_role)");
    expect(c).toContain("r.role not in ('cliente'::public.app_role, 'parceiro'::public.app_role)");
    expect(c).toMatch(/pp\.perfil in \('cliente', 'parceiro'\)/);
    expect(c).toContain("length(v_motivo) < 3");
    expect(c).toContain("p_expira_em <= now()");
  });

  it("minhas_permissoes devolve UM array (sem o corte de 1.000 linhas) e passa por has_permission", () => {
    expect(cabecalho("minhas_permissoes")).toContain("RETURNS text[]");
    expect(normal(corpo("minhas_permissoes"))).toContain(
      "public.has_permission((select auth.uid()), p.chave)",
    );
  });
});

describe("has_permission: mesmo contrato, corpo novo", () => {
  it("mesma assinatura, STABLE, SECURITY DEFINER e search_path — as 159 policies não mudam", () => {
    const c = cabecalho("has_permission");
    expect(c).toMatch(
      /^_user_id uuid, _permission text\) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' $/,
    );
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;",
    );
    expect(codigo).toContain(
      "GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;",
    );
  });

  it("efetiva = (papéis ∪ dadas ativas) − tiradas ativas; exceção não vale para admin", () => {
    const c = normal(corpo("has_permission"));
    expect(c).toContain("coalesce( (select e.concede from public.permissoes_excecoes e");
    expect(c).toContain("(e.expira_em is null or e.expira_em > now())");
    expect(c).toContain("a.role = 'admin'::public.app_role");
    expect(c).toContain(
      "join public.perfil_permissoes pp on pp.perfil = ur.role::text and pp.permissao = _permission",
    );
  });

  it("a regra de desativado é a MESMA frase de usuario_desativado (escrita por extenso por desempenho)", () => {
    const vivo = readFileSync(join(DIR, "20260822120000_usuario_ativo_e_auditoria.sql"), "utf8");
    const m = vivo.match(/function public\.usuario_desativado[\s\S]*?as \$\$([\s\S]*?)\$\$/i);
    expect(m).not.toBeNull();
    const regra = normal(m![1])
      .replace(/^select exists \(\s*/, "")
      .replace(/\s*\)$/, "");
    expect(regra).toBe(
      "select 1 from public.usuarios u where u.id = _user_id and u.ativo is false",
    );
    expect(normal(corpo("has_permission"))).toContain(`select not exists (${regra})`);
    // E nenhuma migração posterior redefiniu usuario_desativado sem mudar has_permission junto.
    const depois = readdirSync(DIR).filter(
      (f) => f > "20260822120000_usuario_ativo_e_auditoria.sql",
    );
    const redefinem = depois.filter((f) =>
      /create\s+or\s+replace\s+function\s+public\.usuario_desativado/i.test(
        readFileSync(join(DIR, f), "utf8"),
      ),
    );
    expect(redefinem).toEqual([]);
  });

  it("nenhuma função desta migração cita uma chave do catálogo (o detector do painel não se engana)", () => {
    const catalogo = new Set<string>(permissions);
    const corpos = [...codigo.matchAll(/AS \$function\$([\s\S]*?)\$function\$/g)].map((m) => m[1]);
    expect(corpos.length).toBe(7);
    const citadas = corpos.flatMap((c) =>
      [...c.matchAll(/'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)]
        .map((m) => m[1])
        .filter((k) => catalogo.has(k)),
    );
    expect(citadas).toEqual([]);
  });
});

describe("a matriz por papel fica só com o admin", () => {
  it("as 3 policies de escrita de perfil_permissoes passam a exigir o papel admin", () => {
    const alter = [
      ...codigo.matchAll(
        /ALTER POLICY "(perfil_permissoes admin (?:insert|update|delete))"[\s\S]*?;/g,
      ),
    ];
    expect(alter.map((m) => m[1]).sort()).toEqual([
      "perfil_permissoes admin delete",
      "perfil_permissoes admin insert",
      "perfil_permissoes admin update",
    ]);
    for (const [texto] of alter) {
      expect(texto).toContain("public.has_role((select auth.uid()), 'admin'::public.app_role)");
      expect(texto).not.toContain("permissoes.manage");
    }
  });
});

describe("o que a migração NÃO faz", () => {
  it("não apaga nada nem mexe em dado além da descrição de permissoes.manage", () => {
    const semCorpos = codigo.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(semCorpos.match(/\bDROP\b[^;]*;/gi)).toEqual([
      "DROP TRIGGER IF EXISTS tg_permissoes_excecoes_historico ON public.permissoes_excecoes;",
    ]);
    expect(semCorpos).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\b/i);
    const updates = semCorpos.match(/\bUPDATE\s+public\.\w+[\s\S]*?;/gi) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("WHERE chave = 'permissoes.manage'");
  });

  it("não tem BEGIN/COMMIT (o Supabase já roda cada arquivo numa transação)", () => {
    expect(codigo).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("o prefixo de data não colide com outra migração", () => {
    const prefixo = ARQUIVO.slice(0, 14);
    expect(readdirSync(DIR).filter((f) => f.startsWith(prefixo))).toEqual([ARQUIVO]);
  });
});
