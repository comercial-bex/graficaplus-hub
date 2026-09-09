import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
] as const;

const roleSchema = z.enum(appRoles);

type AdminContext = {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> };
  userId: string;
};

/** Garante que quem chama é administrador antes de liberar o client privilegiado. */
async function assertAdmin(context: AdminContext) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (data !== true) throw new Error("Acesso negado: somente administradores.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
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
    const admin = await assertAdmin(context as unknown as AdminContext);

    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error || !created?.user) throw new Error(error?.message ?? "Falha ao criar acesso");

    const userId = created.user.id;
    try {
      const { error: perfilError } = await admin.from("usuarios").upsert(
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
        const { error: roleError } = await admin
          .from("user_roles")
          .insert({ user_id: userId, role: data.role });
        if (roleError) throw new Error(roleError.message);
      }
    } catch (e) {
      await admin.auth.admin.deleteUser(userId);
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
    const admin = await assertAdmin(context as unknown as AdminContext);

    const { data: atual } = await admin.from("usuarios").select("email").eq("id", data.id).single();

    if (atual && atual.email !== data.email) {
      const { error } = await admin.auth.admin.updateUserById(data.id, {
        email: data.email,
        email_confirm: true,
      });
      if (error) throw new Error(error.message);
    }

    const { error } = await admin
      .from("usuarios")
      .update({
        nome: data.nome,
        email: data.email,
        telefone: data.telefone ?? null,
        cargo_pretendido: data.cargo ?? null,
        ativo: data.ativo,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

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
    const { error } = await admin.from("usuarios").update({ ativo: data.ativo }).eq("id", data.id);
    if (error) throw new Error(error.message);
    // Bloqueia/libera o login banindo temporariamente a conta.
    await admin.auth.admin.updateUserById(data.id, {
      ban_duration: data.ativo ? "none" : "876000h",
    } as never);
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

    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = (admins ?? []).map((r) => r.user_id);
    if (adminIds.includes(data.id) && adminIds.length <= 1) {
      throw new Error("Não é possível excluir o último administrador.");
    }

    const { error } = await admin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    await admin.from("usuarios").delete().eq("id", data.id);
    return { ok: true };
  });

export const atribuirPerfil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: uuid, role: roleSchema }))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context as unknown as AdminContext);
    const { error } = await admin
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
    const admin = await assertAdmin(ctx);

    if (data.role === "admin") {
      const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      if ((admins ?? []).length <= 1) {
        throw new Error("Não é possível remover o último administrador.");
      }
    }

    const { error } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", data.id)
      .eq("role", data.role);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
