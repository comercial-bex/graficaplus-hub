import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * USUARIOS: A PESSOA MUDA O PRÓPRIO NOME, TELEFONE E FOTO. O RESTO É DO ADMIN.
 *
 * Até 15/10/2026 a policy "usuarios self update" e o GRANT de UPDATE na tabela
 * inteira deixavam qualquer pessoa logada mudar em si mesma, pela API, o
 * `ativo` (que liga has_permission e is_staff), as `filas` do WhatsApp, as
 * `horas_semanais` da capacidade, o e-mail e o cargo. Ensaio com rollback: o
 * Leonardo (vendedor+operador) e o Yvens (gestor) gravavam tudo isso; o Sergio,
 * desativado, se reativava com o JWT que ainda valia e voltava a ter os.read.
 *
 * GRANT por coluna não resolve: o admin também é authenticated e grava pela API
 * com o próprio JWT. A trava é o gatilho de 20261015100000, que olha
 * has_role(admin) e deixa a pessoa só com o que Meus dados grava.
 *
 * E o formulário de edição em /usuarios mudava `ativo` sem banir o login e sem
 * a trava "não inativar a própria conta": a pessoa "inativa" entrava normalmente
 * e, com o furo acima, se reativava. Agora o formulário faz o que o interruptor
 * da lista faz.
 */

const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const ESTA = "20261015100000_usuarios_colunas_so_do_admin.sql";

/** SQL sem comentários de linha: o cabeçalho explica a regra e não conta. */
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");
const ler = (arquivo: string) => readFileSync(join(PASTA_MIGRACOES, arquivo), "utf8");
const migracoes = readdirSync(PASTA_MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("migração: só o admin muda o que não é nome, telefone e foto", () => {
  const sql = semComentarios(ler(ESTA));
  const corpo = /\$function\$([\s\S]*?)\$function\$/.exec(sql)?.[1] ?? "";

  it("gatilho BEFORE INSERT OR UPDATE em usuarios, linha a linha", () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+tg_usuarios_so_o_admin_muda\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.usuarios\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.usuarios_so_o_admin_muda\(\)/i,
    );
  });

  it("a função NÃO é SECURITY DEFINER: current_user tem de ser quem gravou", () => {
    const cabecalho = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.usuarios_so_o_admin_muda\(\)([\s\S]*?)\$function\$/i.exec(sql)?.[1];
    expect(cabecalho).toBeDefined();
    expect(cabecalho).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(corpo).toMatch(/current_user\s+NOT\s+IN\s+\('authenticated',\s*'anon'\)/i);
  });

  it("o admin passa por has_role, não por uma permissão que outro papel pode ganhar", () => {
    expect(corpo).toMatch(/public\.has_role\(\s*auth\.uid\(\),\s*'admin'::public\.app_role\s*\)/i);
    expect(corpo).not.toMatch(/has_permission/i);
  });

  it("no UPDATE a lista é do que a pessoa PODE mudar — coluna nova nasce do admin", () => {
    const lista = /n\.key\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(corpo)?.[1] ?? "";
    const livres = [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(livres).toEqual(["avatar_url", "nome", "telefone", "updated_at"]);
  });

  it("recusa com 42501 (sem permissão), não com erro genérico", () => {
    expect(corpo).toMatch(/ERRCODE\s*=\s*'42501'/);
  });

  it("ninguém executa a função de gatilho direto", () => {
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.usuarios_so_o_admin_muda\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
  });

  it("no INSERT da própria ficha, o padrão exigido é o padrão da coluna", () => {
    // `filas` nasceu fora das migrações (padrão '{comercial}' conferido no banco
    // em 15/10/2026); ativo e horas_semanais estão aqui.
    const criacao = semComentarios(ler("20260531172858_70c34c0f-bf50-43ba-bd7e-94186ba5ee46.sql"));
    expect(criacao).toMatch(/ativo\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+true/i);
    expect(corpo).toMatch(/NEW\.ativo\s+IS\s+DISTINCT\s+FROM\s+true/i);

    const horas = migracoes
      .map((f) => /usuarios\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+horas_semanais\s+numeric\s+NOT\s+NULL\s+DEFAULT\s+(\d+)/i.exec(semComentarios(ler(f)))?.[1])
      .filter(Boolean);
    expect(horas).toEqual(["40"]);
    expect(corpo).toMatch(/NEW\.horas_semanais\s+IS\s+DISTINCT\s+FROM\s+40\b/i);
    expect(corpo).toMatch(/NEW\.filas\s+IS\s+DISTINCT\s+FROM\s+'\{comercial\}'/i);
    expect(corpo).toMatch(/lower\(NEW\.email\)\s+IS\s+DISTINCT\s+FROM\s+lower\(auth\.jwt\(\)\s*->>\s*'email'\)/i);
  });

  it("nenhuma migração depois desta tira o gatilho", () => {
    const depois = migracoes.filter((f) => f > ESTA);
    for (const f of depois) {
      expect(semComentarios(ler(f)), f).not.toMatch(/DROP\s+TRIGGER[^;]*tg_usuarios_so_o_admin_muda/i);
    }
  });
});

describe("Meus dados grava só o que o gatilho deixa", () => {
  const tela = readFileSync(join(RAIZ, "src/components/configuracoes/meus-dados-card.tsx"), "utf8");

  it("salvar: nome e telefone", () => {
    const dados = /const dados = \{([^}]*)\}/.exec(tela)?.[1] ?? "";
    const chaves = [...dados.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
    expect(chaves).toEqual(["nome", "telefone"]);
  });

  it("foto: avatar_url", () => {
    const fotos = [...tela.matchAll(/\.update\(\{\s*(\w+)\s*:/g)].map((m) => m[1]);
    expect(fotos).toEqual(["avatar_url"]);
  });

  it("ficha que falta: id e o e-mail do próprio login, mais os dados", () => {
    expect(tela).toMatch(/\.insert\(\{\s*id:\s*uid,\s*email:\s*user\.email \?\? "",\s*\.\.\.dados\s*\}\)/);
  });
});

/* ------------------------------------------------------------------------ */
/* O formulário de edição em /usuarios                                       */
/* ------------------------------------------------------------------------ */

const HARISON = "6e6693f1-ea58-42b8-acf6-46fae959566a";
const LEONARDO = "1c72900c-a334-4caa-bd3e-6159ac68fa2f";

const dubles = vi.hoisted(() => {
  const estado = {
    /** `ativo` que a ficha tem antes de salvar; null = a leitura não trouxe a linha. */
    ativoAntes: true as boolean | null,
    escritas: [] as string[],
    auth: [] as { fn: string; id: string; attrs: Record<string, unknown> }[],
    erroDoAuth: null as { message: string } | null,
  };

  function construtor(tabela: string) {
    let op = "select";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) b[m] = () => b;
    for (const w of ["insert", "update", "delete", "upsert"]) {
      b[w] = () => {
        op = w;
        estado.escritas.push(`${w} ${tabela}`);
        return b;
      };
    }
    const resposta = () => {
      if (op === "select" && tabela === "usuarios") {
        return estado.ativoAntes === null
          ? { data: null, error: { message: "sem linha" } }
          : { data: { email: "leolpmalmeida@gmail.com", ativo: estado.ativoAntes }, error: null };
      }
      if (op === "update" || op === "delete") return { data: [{ id: "linha-1" }], error: null };
      return { data: null, error: null };
    };
    b.single = () => Promise.resolve(resposta());
    b.maybeSingle = () => Promise.resolve(resposta());
    b.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve(resposta()).then(ok, falha);
    return b;
  }

  return { estado, construtor };
});

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const construtor: any = {
      middleware: () => construtor,
      inputValidator: () => construtor,
      handler: (fn: (args: unknown) => Promise<unknown>) => fn,
    };
    return construtor;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => dubles.construtor(tabela),
    auth: {
      admin: {
        updateUserById: (id: string, attrs: Record<string, unknown>) => {
          dubles.estado.auth.push({ fn: "updateUserById", id, attrs });
          return Promise.resolve({ data: { user: { id } }, error: dubles.estado.erroDoAuth });
        },
      },
    },
  },
}));

import { atualizarUsuario, definirAtivo } from "../src/lib/api/usuarios.functions";

const contexto = () => ({
  userId: HARISON,
  supabase: {
    from: (tabela: string) => dubles.construtor(tabela),
    rpc: (fn: string) => Promise.resolve({ data: fn === "has_role", error: null }),
  },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chamar = (fn: unknown, data: unknown) => (fn as any)({ data, context: contexto() });

const ficha = (id: string, ativo: boolean) => ({
  id,
  nome: "Leonardo Pimentel de Almeida",
  email: "leolpmalmeida@gmail.com",
  telefone: null,
  cargo: null,
  ativo,
});
const bans = () => dubles.estado.auth.map((a) => `${a.id === LEONARDO ? "Leonardo" : a.id} ${String(a.attrs.ban_duration)}`);

beforeEach(() => {
  dubles.estado.ativoAntes = true;
  dubles.estado.escritas.length = 0;
  dubles.estado.auth.length = 0;
  dubles.estado.erroDoAuth = null;
});

describe("formulário de edição: o login acompanha o 'ativo'", () => {
  it("inativar pelo formulário bane o login, como o interruptor da lista", async () => {
    await expect(chamar(atualizarUsuario, ficha(LEONARDO, false))).resolves.toEqual({ ok: true });
    expect(dubles.estado.escritas).toEqual(["update usuarios"]);
    expect(bans()).toEqual(["Leonardo 876000h"]);
  });

  it("reativar pelo formulário libera o login", async () => {
    dubles.estado.ativoAntes = false;
    await expect(chamar(atualizarUsuario, ficha(LEONARDO, true))).resolves.toEqual({ ok: true });
    expect(bans()).toEqual(["Leonardo none"]);
  });

  it("editar nome/telefone sem mexer no 'ativo' não chama o Auth", async () => {
    await expect(chamar(atualizarUsuario, ficha(LEONARDO, true))).resolves.toEqual({ ok: true });
    expect(dubles.estado.auth).toEqual([]);
  });

  it("sem o estado anterior, alinha o login com o que foi salvo", async () => {
    dubles.estado.ativoAntes = null;
    await expect(chamar(atualizarUsuario, ficha(LEONARDO, true))).resolves.toEqual({ ok: true });
    expect(bans()).toEqual(["Leonardo none"]);
  });

  it("não inativa a própria conta pelo formulário — recusa antes de gravar", async () => {
    await expect(chamar(atualizarUsuario, ficha(HARISON, false))).rejects.toThrow(/própria conta/);
    expect(dubles.estado.escritas).toEqual([]);
    expect(dubles.estado.auth).toEqual([]);
  });

  it("editar a própria conta mantendo ativa continua possível", async () => {
    await expect(chamar(atualizarUsuario, ficha(HARISON, true))).resolves.toEqual({ ok: true });
    expect(dubles.estado.escritas).toEqual(["update usuarios"]);
  });
});

describe("Auth recusou o banimento: o admin fica sabendo", () => {
  it("formulário: cadastro inativo com login liberado vira erro, não 'Usuário atualizado'", async () => {
    dubles.estado.erroDoAuth = { message: "User not found" };
    await expect(chamar(atualizarUsuario, ficha(LEONARDO, false))).rejects.toThrow(
      /inativado, mas o login não foi bloqueado: User not found/,
    );
  });

  it("interruptor da lista: idem (antes o erro do Auth era descartado)", async () => {
    dubles.estado.erroDoAuth = { message: "User not found" };
    await expect(chamar(definirAtivo, { id: LEONARDO, ativo: true })).rejects.toThrow(
      /reativado, mas o login continua bloqueado: User not found/,
    );
  });
});
