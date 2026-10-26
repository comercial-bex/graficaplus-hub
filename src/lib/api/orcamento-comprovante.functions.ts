import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  FORMATO_DO_CAMINHO_DO_COMPROVANTE,
  caminhoDoComprovante,
  problemaNoComprovante,
} from "@/domain/pagamento/comprovante";

/**
 * Comprovante de pagamento por orçamento (27/10/2026): pela equipe (sessão) ou pelo cliente (link).
 *
 * O envio tem dois passos, como o do portal: (1) o servidor confere quem é e devolve uma URL
 * assinada de upload para uma pasta só deste orçamento; (2) depois do upload, o servidor confere
 * que o objeto EXISTE e só então grava a linha em `orcamento_comprovantes`. O cliente nunca
 * recebe permissão de escrever fora da pasta.
 */

const arquivo = z.object({
  nome: z.string().trim().min(1).max(200),
  tipo: z.string().trim().max(100),
  tamanho: z.number().int().positive(),
});

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function equipePode(supabase: any, userId: string) {
  for (const permissao of ["orcamentos.update", "pagamentos.confirm"]) {
    const { data } = await supabase.rpc("has_permission", { _user_id: userId, _permission: permissao });
    if (data) return true;
  }
  return false;
}

async function subirUrl(db: any, orcamentoId: string, a: { nome: string; tipo: string; tamanho: number }) {
  const problema = problemaNoComprovante(a);
  if (problema) throw new Error(problema);
  const caminho = caminhoDoComprovante(orcamentoId, a.nome);
  const { data, error } = await db.storage.from("comprovantes").createSignedUploadUrl(caminho);
  if (error || !data) throw new Error(error?.message || "Não consegui preparar o envio.");
  return { caminho, token: data.token as string };
}

async function gravar(
  db: any,
  orcamentoId: string,
  a: { caminho: string; nome: string; tipo: string; tamanho: number },
  origem: "cliente" | "equipe",
  quem: string | null,
) {
  if (!a.caminho.startsWith(`orcamento/${orcamentoId}/`) || !FORMATO_DO_CAMINHO_DO_COMPROVANTE.test(a.caminho)) {
    throw new Error("Caminho do comprovante inválido para este orçamento.");
  }
  const pasta = `orcamento/${orcamentoId}`;
  const arq = a.caminho.slice(pasta.length + 1);
  const { data: achados, error: erroLista } = await db.storage.from("comprovantes").list(pasta, { search: arq, limit: 5 });
  if (erroLista) throw new Error(erroLista.message);
  if (!(achados ?? []).some((o: any) => o.name === arq)) throw new Error("O arquivo não chegou. Tente enviar de novo.");

  const { data: ja } = await db.from("orcamento_comprovantes").select("id").eq("caminho", a.caminho).maybeSingle();
  if (ja) return { id: ja.id as string };
  const { data: novo, error } = await db
    .from("orcamento_comprovantes")
    .insert({
      orcamento_id: orcamentoId,
      caminho: a.caminho,
      nome: a.nome,
      mime_type: a.tipo,
      tamanho_bytes: a.tamanho,
      origem,
      enviado_por: quem,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await db.from("eventos_negocio").insert({
    entidade: "orcamento",
    entidade_id: orcamentoId,
    tipo: origem === "cliente" ? "comprovante_enviado_pelo_cliente" : "comprovante_anexado_pela_equipe",
    titulo: origem === "cliente" ? "O cliente enviou um comprovante" : "Comprovante anexado pela equipe",
    descricao: a.nome,
    usuario_id: quem,
  });
  return { id: novo.id as string };
}

/* ----------------------------- equipe (sessão) ----------------------------- */

export const pedirEnvioDoComprovante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orcamentoId: z.string().uuid() }).merge(arquivo).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await equipePode(context.supabase, context.userId))) throw new Error("Seu perfil não pode anexar comprovante.");
    return subirUrl(await admin(), data.orcamentoId, data);
  });

export const registrarComprovante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orcamentoId: z.string().uuid(), caminho: z.string().min(10).max(300) }).merge(arquivo).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await equipePode(context.supabase, context.userId))) throw new Error("Seu perfil não pode anexar comprovante.");
    return gravar(await admin(), data.orcamentoId, data, "equipe", context.userId);
  });

/** Link temporário (10 min) para ver o comprovante dentro do sistema. */
export const urlDoComprovante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await equipePode(context.supabase, context.userId))) throw new Error("Seu perfil não pode ver comprovantes.");
    const db = await admin();
    const { data: c } = await db.from("orcamento_comprovantes").select("caminho, nome").eq("id", data.id).maybeSingle();
    if (!c) throw new Error("Comprovante não encontrado.");
    const { data: url, error } = await db.storage.from("comprovantes").createSignedUrl(c.caminho, 600);
    if (error || !url?.signedUrl) throw new Error(error?.message || "Não consegui abrir o comprovante.");
    return { url: url.signedUrl as string, nome: c.nome as string };
  });

/* ------------------------------ cliente (link) ----------------------------- */

async function orcamentoDoLink(db: any, token: string) {
  const { data: o } = await db.from("orcamentos").select("id, status").eq("token_publico", token).maybeSingle();
  if (!o) throw new Error("Link inválido ou expirado.");
  if (!["enviado", "aprovado", "convertido"].includes(String(o.status))) {
    throw new Error("Este orçamento não está aberto para receber comprovante.");
  }
  const { count } = await db.from("orcamento_comprovantes").select("id", { count: "exact", head: true }).eq("orcamento_id", o.id);
  if ((count ?? 0) >= 10) throw new Error("Já recebemos vários comprovantes. Fale com a gráfica.");
  return o.id as string;
}

export const pedirEnvioDoComprovantePublico = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(80) }).merge(arquivo).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    return subirUrl(db, await orcamentoDoLink(db, data.token), data);
  });

export const registrarComprovantePublico = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().min(10).max(80), caminho: z.string().min(10).max(300) }).merge(arquivo).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    return gravar(db, await orcamentoDoLink(db, data.token), data, "cliente", null);
  });
