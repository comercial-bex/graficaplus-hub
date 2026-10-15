import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QUEM TROCOU O PAPEL? QUEM DESATIVOU A CONTA? O LOG NÃO SABIA.
 *
 * `user_roles` e `usuarios` são auditadas pelo gatilho `tg_auditar`, que grava
 * `auth.uid()` como autor. As funções da tela /usuarios conferiam se quem chama
 * é admin e depois gravavam com a chave de serviço — sem JWT, `auth.uid()` é
 * nulo e o autor saía vazio. De 02/09 a 14/10/2026: 18 trocas de papel, 0 com
 * autor. Em 13/10 o Fernando ganhou operador, estoque e designer, a Cibele
 * ganhou gestor e perdeu 3 segundos depois, e o operador Sergio foi desativado —
 * tudo com "sistema" na coluna Quem de /logs.
 *
 * Agora a escrita vai pelo cliente da própria pessoa (a RLS já libera ao admin)
 * e a chave de serviço só faz o que é do Auth (`auth.admin.*`). O handler é
 * exercido com os dois clientes trocados por dublês que anotam quem gravou o quê.
 */

const HARISON = "6e6693f1-ea58-42b8-acf6-46fae959566a";
const FERNANDO = "e52011db-cd27-4a5b-9520-6149ef7410f2";
const NOVA_CONTA = "0b9d7c1e-5a43-4f6e-9d21-7c3e8a1f2b40";

/** Tabelas com `tg_auditar` que estas funções tocam. */
const AUDITADAS = ["user_roles", "usuarios"];

const dubles = vi.hoisted(() => {
  const estado = {
    escritas: [] as { cliente: "pessoa" | "servico"; tabela: string; op: string }[],
    auth: [] as string[],
    ehAdmin: true,
    /** O que update/delete devolvem com `.select("id")`: [] = RLS recusou em silêncio. */
    linhasAfetadas: [{ id: "linha-1" }] as unknown[],
    /** Quem tem papel admin; o beforeEach preenche. */
    admins: [] as { user_id: string }[],
  };

  function construtor(cliente: "pessoa" | "servico", tabela: string) {
    let op = "select";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) b[m] = () => b;
    for (const w of ["insert", "update", "delete", "upsert"]) {
      b[w] = () => {
        op = w;
        estado.escritas.push({ cliente, tabela, op: w });
        return b;
      };
    }
    const resposta = () => {
      if (op === "select") {
        if (tabela === "user_roles") return { data: estado.admins, error: null };
        if (tabela === "usuarios") return { data: { email: "fernando@bexprint.com" }, error: null };
        if (tabela === "logs_auditoria") {
          return { data: { id: "log-1", created_at: "2026-10-14T12:00:00.123456+00:00" }, error: null };
        }
      }
      if (op === "update" || op === "delete") return { data: estado.linhasAfetadas, error: null };
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

// createServerFn devolve o próprio handler: o teste chama a função como o
// servidor chamaria, com `data` e o `context` do middleware de login.
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
    from: (tabela: string) => dubles.construtor("servico", tabela),
    auth: {
      admin: new Proxy(
        {},
        {
          get: (_alvo, nome) => () => {
            dubles.estado.auth.push(String(nome));
            // O id fica literal: a fábrica do vi.mock sobe para antes das constantes.
            return Promise.resolve({
              data: { user: { id: "0b9d7c1e-5a43-4f6e-9d21-7c3e8a1f2b40" } },
              error: null,
            });
          },
        },
      ),
    },
  },
}));

import {
  atribuirPerfil,
  atualizarUsuario,
  criarUsuario,
  definirAtivo,
  excluirUsuario,
  removerPerfil,
} from "../src/lib/api/usuarios.functions";

const contexto = () => ({
  userId: HARISON,
  supabase: {
    from: (tabela: string) => dubles.construtor("pessoa", tabela),
    rpc: (fn: string) =>
      Promise.resolve({ data: fn === "has_role" ? dubles.estado.ehAdmin : null, error: null }),
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chamar = (fn: unknown, data: unknown) => (fn as any)({ data, context: contexto() });

const pelaChaveDeServico = () =>
  dubles.estado.escritas.filter((e) => e.cliente === "servico" && AUDITADAS.includes(e.tabela));
const pelaPessoa = () =>
  dubles.estado.escritas.filter((e) => e.cliente === "pessoa").map((e) => `${e.op} ${e.tabela}`);

beforeEach(() => {
  dubles.estado.escritas.length = 0;
  dubles.estado.auth.length = 0;
  dubles.estado.ehAdmin = true;
  dubles.estado.linhasAfetadas = [{ id: "linha-1" }];
  dubles.estado.admins = [{ user_id: HARISON }, { user_id: "outro-admin" }];
});

describe("trocar papel grava com o JWT de quem fez", () => {
  it("dar papel: insert em user_roles pela pessoa, nada pela chave de serviço", async () => {
    await expect(chamar(atribuirPerfil, { id: FERNANDO, role: "operador" })).resolves.toEqual({ ok: true });
    expect(pelaPessoa()).toEqual(["insert user_roles"]);
    expect(pelaChaveDeServico()).toEqual([]);
  });

  it("tirar papel: delete em user_roles pela pessoa, nada pela chave de serviço", async () => {
    await expect(chamar(removerPerfil, { id: FERNANDO, role: "gestor" })).resolves.toEqual({ ok: true });
    expect(pelaPessoa()).toEqual(["delete user_roles"]);
    expect(pelaChaveDeServico()).toEqual([]);
  });

  it("tirar papel que não saiu (RLS recusou em silêncio) é erro, não 'Perfil removido'", async () => {
    dubles.estado.linhasAfetadas = [];
    await expect(chamar(removerPerfil, { id: FERNANDO, role: "gestor" })).rejects.toThrow(
      /Nenhum papel foi removido/,
    );
  });
});

describe("ativar/desativar conta grava com o JWT de quem fez", () => {
  it("desativar: update em usuarios pela pessoa; a chave de serviço só bane o login", async () => {
    await expect(chamar(definirAtivo, { id: FERNANDO, ativo: false })).resolves.toEqual({ ok: true });
    expect(pelaPessoa()).toEqual(["update usuarios"]);
    expect(pelaChaveDeServico()).toEqual([]);
    expect(dubles.estado.auth).toEqual(["updateUserById"]);
  });

  it("cadastro que não mudou não bane o login", async () => {
    dubles.estado.linhasAfetadas = [];
    await expect(chamar(definirAtivo, { id: FERNANDO, ativo: false })).rejects.toThrow(
      /não foi alterada/,
    );
    expect(dubles.estado.auth).toEqual([]);
  });

  it("editar o cadastro (que também liga/desliga 'ativo') grava pela pessoa", async () => {
    await expect(
      chamar(atualizarUsuario, {
        id: FERNANDO,
        nome: "Fernando Augusto",
        email: "fernando@bexprint.com",
        ativo: false,
      }),
    ).resolves.toEqual({ ok: true });
    expect(pelaPessoa()).toEqual(["update usuarios"]);
    expect(pelaChaveDeServico()).toEqual([]);
  });
});

describe("criar e excluir: a chave de serviço só no Auth", () => {
  it("criar: o Auth cria a conta; cadastro e papel gravados pela pessoa", async () => {
    await expect(
      chamar(criarUsuario, {
        nome: "Conta Nova",
        email: "nova@bexprint.com",
        senha: "senha-forte-1",
        ativo: true,
        role: "vendedor",
      }),
    ).resolves.toEqual({ id: NOVA_CONTA });
    expect(dubles.estado.auth).toEqual(["createUser"]);
    expect(pelaPessoa()).toEqual(["upsert usuarios", "insert user_roles"]);
    expect(pelaChaveDeServico()).toEqual([]);
  });

  it("excluir: a cascata do Auth leva conta e papéis; o autor é preenchido no log, sem linha nova", async () => {
    await expect(chamar(excluirUsuario, { id: FERNANDO })).resolves.toEqual({ ok: true });
    expect(dubles.estado.auth).toEqual(["deleteUser"]);
    expect(pelaChaveDeServico()).toEqual([]);
    const noLog = dubles.estado.escritas.filter((e) => e.tabela === "logs_auditoria");
    expect(noLog.map((e) => `${e.cliente} ${e.op}`)).toEqual(["servico update", "servico update"]);
    expect(noLog.some((e) => e.op === "insert")).toBe(false);
  });
});

describe("as travas de hoje continuam", () => {
  const todas: [string, unknown, unknown][] = [
    ["atribuirPerfil", atribuirPerfil, { id: FERNANDO, role: "admin" }],
    ["removerPerfil", removerPerfil, { id: FERNANDO, role: "operador" }],
    ["definirAtivo", definirAtivo, { id: FERNANDO, ativo: false }],
    ["atualizarUsuario", atualizarUsuario, { id: FERNANDO, nome: "Fe", email: "f@b.com", ativo: true }],
    ["excluirUsuario", excluirUsuario, { id: FERNANDO }],
  ];

  it.each(todas)("%s: quem não é admin é recusado antes de gravar qualquer coisa", async (_n, fn, data) => {
    dubles.estado.ehAdmin = false;
    await expect(chamar(fn, data)).rejects.toThrow(/somente administradores/);
    expect(dubles.estado.escritas).toEqual([]);
    expect(dubles.estado.auth).toEqual([]);
  });

  it("não remove o último administrador", async () => {
    dubles.estado.admins = [{ user_id: HARISON }];
    await expect(chamar(removerPerfil, { id: HARISON, role: "admin" })).rejects.toThrow(
      /último administrador/,
    );
    expect(dubles.estado.escritas).toEqual([]);
  });

  it("não exclui o último administrador", async () => {
    dubles.estado.admins = [{ user_id: FERNANDO }];
    await expect(chamar(excluirUsuario, { id: FERNANDO })).rejects.toThrow(/último administrador/);
    expect(dubles.estado.auth).toEqual([]);
  });

  it("não inativa nem exclui a si mesmo", async () => {
    await expect(chamar(definirAtivo, { id: HARISON, ativo: false })).rejects.toThrow(/própria conta/);
    await expect(chamar(excluirUsuario, { id: HARISON })).rejects.toThrow(/própria conta/);
    expect(dubles.estado.escritas).toEqual([]);
    expect(dubles.estado.auth).toEqual([]);
  });
});
