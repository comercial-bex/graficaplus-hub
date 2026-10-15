import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/*
 * QUEM FEZ: `user_roles` e `usuarios` são auditadas pelo gatilho `tg_auditar`,
 * que grava `auth.uid()` como autor. Pela chave de serviço não há JWT e o autor
 * sai nulo — de 02/09 a 14/10/2026 foram 18 trocas de papel e 0 com autor; o
 * operador desativado em 13/10 também ficou sem autor.
 *
 * Por isso toda escrita nessas tabelas vai pelo cliente da própria pessoa
 * (`ctx.supabase`, com o JWT do admin): a RLS já libera ao admin (`roles admin
 * all` em user_roles; `usuarios admin insert` e `usuarios self update` em
 * usuarios). A chave de serviço fica para o que só o Auth faz (`auth.admin.*`)
 * e para leitura. Travado em tests/autor-na-troca-de-papel.test.ts.
 */

const uuid = z.string().uuid();

const appRoles = [
  "admin",
  "gestor",
  "financeiro",
  "vendedor",
  "designer",
  "operador",
  "estoque",
  "instalador",
  "cliente",
  // Aceito para REMOVER o papel de um revendedor pela tela de usuários. Dar o papel
  // é pela gestão de parceiros, que também liga a conta ao cadastro do parceiro.
  "parceiro",
] as const;

const roleSchema = z.enum(appRoles);

type AdminContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

/**
 * Garante que quem chama é administrador antes de liberar o client privilegiado.
 * O client devolvido é só para `auth.admin.*` e leitura — gravar em tabela
 * auditada por ele apaga o autor (ver o topo do arquivo).
 */
async function assertAdmin(context: AdminContext) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (data !== true) throw new Error("Acesso negado: somente administradores.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type ClienteDeServico = Awaited<ReturnType<typeof assertAdmin>>;

/**
 * O login acompanha o cadastro: conta inativa fica banida no Auth, ativa fica
 * liberada. Vale para o interruptor da lista (`definirAtivo`) e para o
 * formulário de edição (`atualizarUsuario`) — pelo formulário, "inativo" sem
 * banir deixava a pessoa entrar e, com o JWT dela, se reativar.
 *
 * Só depois de o cadastro mudar: banir antes e a RLS recusar em silêncio
 * deixaria o login bloqueado com o cadastro dizendo "ativo".
 */
async function loginAcompanhaCadastro(admin: ClienteDeServico, id: string, ativo: boolean) {
  const { error } = await admin.auth.admin.updateUserById(id, {
    ban_duration: ativo ? "none" : "876000h",
  } as never);
  if (error) {
    throw new Error(
      ativo
        ? `O cadastro foi reativado, mas o login continua bloqueado: ${error.message}. Tente de novo.`
        : `O cadastro foi inativado, mas o login não foi bloqueado: ${error.message}. Tente de novo.`,
    );
  }
}

/**
 * Excluir a conta é pelo Auth: o banco apaga `usuarios` e `user_roles` em
 * cascata dentro da transação do Auth, onde não há JWT, e o gatilho grava essas
 * linhas com autor nulo. O JWT do admin não chega lá, então o autor é preenchido
 * nas PRÓPRIAS linhas que o gatilho acabou de gravar — linha nova duplicaria o
 * evento no log.
 *
 * A cascata sai numa transação só, com o mesmo `created_at`: a linha da conta é
 * achada pelo id e as dos papéis pelo mesmo instante. Sem o instante, uma
 * remoção antiga de papel com autor nulo levaria o nome de quem excluiu agora.
 */
async function preencherAutorDaExclusao(
  admin: ClienteDeServico,
  alvoId: string,
  autorId: string,
) {
  const { data: linhaDaConta, error } = await admin
    .from("logs_auditoria")
    .select("id, created_at")
    .eq("entidade", "usuarios")
    .eq("acao", "delete")
    .eq("entidade_id", alvoId)
    .is("usuario_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A conta já saiu; falhar aqui não pode virar "não foi possível excluir".
  if (error || !linhaDaConta) {
    console.error("[usuarios] exclusão sem autor no log", alvoId, error?.message);
    return;
  }
  const r1 = await admin
    .from("logs_auditoria")
    .update({ usuario_id: autorId })
    .eq("id", linhaDaConta.id);
  const r2 = await admin
    .from("logs_auditoria")
    .update({ usuario_id: autorId })
    .eq("entidade", "user_roles")
    .eq("acao", "delete")
    .eq("created_at", linhaDaConta.created_at)
    .eq("detalhes->antes->>user_id", alvoId)
    .is("usuario_id", null);
  if (r1.error || r2.error) {
    console.error("[usuarios] exclusão sem autor no log", alvoId, r1.error?.message ?? r2.error?.message);
  }
}

export type UsuarioAdmin = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  cargo_pretendido: string | null;
  avatar_url: string | null;
  ativo: boolean;
  created_at: string;
  ultimo_acesso: string | null;
  roles: string[];
};

export const listarUsuarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsuarioAdmin[]> => {
    const admin = await assertAdmin(context as unknown as AdminContext);

    const [{ data: usuarios, error }, { data: roles }, { data: authList }] = await Promise.all([
      admin.from("usuarios").select("*").order("nome"),
      admin.from("user_roles").select("user_id, role"),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (error) throw new Error(error.message);

    const lastSignIn = new Map<string, string | null>(
      (authList?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]),
    );

    return (usuarios ?? []).map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      telefone: u.telefone,
      cargo_pretendido: u.cargo_pretendido,
      avatar_url: u.avatar_url,
      ativo: u.ativo,
      created_at: u.created_at,
      ultimo_acesso: lastSignIn.get(u.id) ?? null,
      roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as string),
    }));
  });

export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      nome: z.string().min(2),
      email: z.string().email(),
      senha: z.string().min(8),
      telefone: z.string().optional().nullable(),
      cargo: z.string().optional().nullable(),
      ativo: z.boolean().default(true),
      role: roleSchema.optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AdminContext;
    const admin = await assertAdmin(ctx);

    // O Auth cria a conta; o gatilho handle_new_user já põe a linha em `usuarios`.
    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error || !created?.user) throw new Error(error?.message ?? "Falha ao criar acesso");

    const userId = created.user.id;
    try {
      const { error: perfilError } = await ctx.supabase.from("usuarios").upsert(
        {
          id: userId,
          nome: data.nome,
          email: data.email,
          telefone: data.telefone ?? null,
          cargo_pretendido: data.cargo ?? null,
          ativo: data.ativo,
        },
        { onConflict: "id" },
      );
      if (perfilError) throw new Error(perfilError.message);

      if (data.role) {
        const { error: roleError } = await ctx.supabase
          .from("user_roles")
          .insert({ user_id: userId, role: data.role });
        if (roleError) throw new Error(roleError.message);
      }
    } catch (e) {
      await admin.auth.admin.deleteUser(userId);
      await preencherAutorDaExclusao(admin, userId, ctx.userId);
      throw e;
    }

    return { id: userId };
  });

export const atualizarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: uuid,
      nome: z.string().min(2),
      email: z.string().email(),
      telefone: z.string().optional().nullable(),
      cargo: z.string().optional().nullable(),
      ativo: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AdminContext;
    const admin = await assertAdmin(ctx);
    if (data.id === ctx.userId && !data.ativo) {
      throw new Error("Você não pode inativar a própria conta.");
    }

    const { data: atual } = await ctx.supabase
      .from("usuarios")
      .select("email, ativo")
      .eq("id", data.id)
      .single();

    if (atual && atual.email !== data.email) {
      const { error } = await admin.auth.admin.updateUserById(data.id, {
        email: data.email,
        email_confirm: true,
      });
      if (error) throw new Error(error.message);
    }

    const { data: alteradas, error } = await ctx.supabase
      .from("usuarios")
      .update({
        nome: data.nome,
        email: data.email,
        telefone: data.telefone ?? null,
        cargo_pretendido: data.cargo ?? null,
        ativo: data.ativo,
      })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    // Com o JWT da pessoa, a RLS recusa em silêncio: zero linhas e nenhum erro.
    if (!alteradas?.length) throw new Error("O cadastro não foi alterado. Recarregue a lista.");
    // Sem o estado anterior, alinha assim mesmo: o login fica igual ao cadastro.
    if (atual?.ativo !== data.ativo) await loginAcompanhaCadastro(admin, data.id, data.ativo);

    return { ok: true };
  });

export const definirAtivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: uuid, ativo: z.boolean() }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AdminContext;
    const admin = await assertAdmin(ctx);
    if (data.id === ctx.userId && !data.ativo) {
      throw new Error("Você não pode inativar a própria conta.");
    }
    const { data: alteradas, error } = await ctx.supabase
      .from("usuarios")
      .update({ ativo: data.ativo })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    // Zero linhas = a RLS recusou em silêncio. Banir assim mesmo deixaria o
    // login bloqueado com o cadastro dizendo "ativo".
    if (!alteradas?.length) throw new Error("A conta não foi alterada. Recarregue a lista.");
    await loginAcompanhaCadastro(admin, data.id, data.ativo);
    return { ok: true };
  });

export const definirSenha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: uuid, senha: z.string().min(8) }))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context as unknown as AdminContext);
    const { error } = await admin.auth.admin.updateUserById(data.id, { password: data.senha });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const enviarResetSenha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ email: z.string().email(), redirectTo: z.string().url() }))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context as unknown as AdminContext);
    const { error } = await admin.auth.resetPasswordForEmail(data.email, {
      redirectTo: data.redirectTo,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const excluirUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: uuid }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AdminContext;
    const admin = await assertAdmin(ctx);
    if (data.id === ctx.userId) throw new Error("Você não pode excluir a própria conta.");

    const { data: admins } = await ctx.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (admins ?? []).map((r) => r.user_id);
    if (adminIds.includes(data.id) && adminIds.length <= 1) {
      throw new Error("Não é possível excluir o último administrador.");
    }

    // `usuarios` e `user_roles` saem em cascata (ON DELETE CASCADE para auth.users).
    const { error } = await admin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    await preencherAutorDaExclusao(admin, data.id, ctx.userId);
    return { ok: true };
  });

export const atribuirPerfil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: uuid, role: roleSchema }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AdminContext;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase
      .from("user_roles")
      .insert({ user_id: data.id, role: data.role });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

export const removerPerfil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: uuid, role: roleSchema }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AdminContext;
    await assertAdmin(ctx);

    if (data.role === "admin") {
      const { data: admins } = await ctx.supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      if ((admins ?? []).length <= 1) {
        throw new Error("Não é possível remover o último administrador.");
      }
    }

    const { data: removidas, error } = await ctx.supabase
      .from("user_roles")
      .delete()
      .eq("user_id", data.id)
      .eq("role", data.role)
      .select("id");
    if (error) throw new Error(error.message);
    // Zero linhas: a pessoa já não tinha o papel, ou a RLS recusou em silêncio.
    if (!removidas?.length) {
      throw new Error("Nenhum papel foi removido: a pessoa já não tinha esse papel. Recarregue a lista.");
    }
    return { ok: true };
  });
