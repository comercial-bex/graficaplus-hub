import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Trocar o orçamento entre preço de cliente final e preço de parceiro
 * (22/10/2026). O preço de parceiro é desconto de verdade: confirmar exige a
 * SENHA de quem está orçando, conferida aqui no servidor — a tela nunca grava o
 * modo direto (a coluna não tem UPDATE para o navegador). A senha só passa por
 * esta função, vai ao Supabase Auth e não é guardada nem registrada; quem
 * confirmou e quando ficam no orçamento.
 */
export const confirmarPrecoDoOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        orcamentoId: z.string().uuid(),
        modo: z.enum(["cliente_final", "parceiro"]),
        senha: z.string().min(1).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.modo === "parceiro") {
      if (!data.senha) throw new Error("Digite a sua senha para confirmar o preço de parceiro.");
      const email = typeof context.claims.email === "string" ? context.claims.email : null;
      const url = process.env.SUPABASE_URL;
      const chave = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (!email || !url || !chave) throw new Error("Não foi possível conferir a senha agora.");
      // Cliente descartável: não guarda sessão e não mexe na sessão de quem está logado.
      const conferencia = createClient(url, chave, {
        auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      });
      const { data: sessao, error } = await conferencia.auth.signInWithPassword({ email, password: data.senha });
      if (error || sessao.user?.id !== context.userId) throw new Error("Senha incorreta.");
      await conferencia.auth.signOut().catch(() => undefined);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await (supabaseAdmin as any).rpc("orcamento_aplicar_preco", {
      p_orcamento: data.orcamentoId,
      p_modo: data.modo,
      p_usuario: context.userId,
    });
    if (error) throw new Error(error.message);
    return r as { modo: "cliente_final" | "parceiro"; itens_repreciados: number; itens_sem_preco: number };
  });
