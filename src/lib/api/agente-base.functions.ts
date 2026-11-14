import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { textoDoErroDaBase, type AcaoDaBase, type ErroDoBanco } from "@/domain/agente-base/erros";
import type {
  LinhaDoHistorico,
  ProdutoDaBase,
  RamoDaBase,
  RespostaDaBase,
} from "@/domain/agente-base/tipos";

/**
 * A tela de aprovação da base de respostas do agente (C2), do lado do servidor.
 *
 * O padrão é o da tela da triagem: o servidor confere a permissão pela sessão de
 * quem pediu e SÓ ENTÃO chama as funções do banco com a chave do servidor, que
 * conferem a permissão de novo com `has_permission`. Ninguém grava nas tabelas
 * da base pelo navegador (nem o próprio servidor: toda escrita é por função).
 *
 *   whatsapp.manage       aprova (hoje, só o dono)
 *   configuracoes.manage  salva rascunho, volta a rascunho e arquiva
 *   ler                   qualquer uma das duas
 *
 * Nenhum consumidor chama a base ainda. Aprovar uma resposta não muda o que
 * nenhum contato recebe. Nenhuma coluna de preço existe, e a lista de produtos
 * leva só id, nome, família e se está ativo.
 *
 * NENHUM texto do banco chega à tela. Toda falha do banco passa por `falhou`,
 * que registra o erro cru só no log do servidor e levanta uma frase própria,
 * em português simples (`textoDoErroDaBase`). A recusa do validador entrega os
 * códigos das regras, que viram explicação por `explicarAviso`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as funções da base não estão nos tipos gerados
type Banco = any;

async function admin(): Promise<Banco> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Banco;
}

/** Registra o erro cru só no log do servidor e levanta a frase própria. Nunca devolve o texto do banco. */
function falhou(acao: AcaoDaBase, erro: ErroDoBanco): never {
  console.error(`[agente-base] ${acao}: ${erro?.code ?? "sem código"} ${erro?.message ?? ""}`.slice(0, 500));
  throw new Error(textoDoErroDaBase(erro, acao));
}

async function tem(supabase: Banco, userId: string, permissao: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _permission: permissao,
  });
  if (error) falhou("ler", error);
  return data === true;
}

const PERMISSAO_EM_PALAVRAS: Record<string, string> = {
  "whatsapp.manage": "de gerenciar o WhatsApp",
  "configuracoes.manage": "de gerenciar as configurações",
};

function emPalavras(permissao: string): string {
  return PERMISSAO_EM_PALAVRAS[permissao] ?? "necessária para esta ação";
}

async function exigir(supabase: Banco, userId: string, permissao: string) {
  if (!(await tem(supabase, userId, permissao))) {
    throw new Error(`Seu perfil não tem a permissão ${emPalavras(permissao)}.`);
  }
}

async function exigirUma(supabase: Banco, userId: string, permissoes: string[]) {
  for (const p of permissoes) if (await tem(supabase, userId, p)) return;
  throw new Error(
    `Seu perfil não tem a permissão ${permissoes.map(emPalavras).join(" nem a permissão ")}.`,
  );
}

const AS_DUAS = ["configuracoes.manage", "whatsapp.manage"];

/** A tabela ainda não existe no banco (a migração é aplicada à mão, depois do código). */
function tabelaNaoExiste(erro: { code?: string; message?: string } | null | undefined): boolean {
  if (!erro) return false;
  return (
    erro.code === "42P01" ||
    erro.code === "PGRST205" ||
    /does not exist|schema cache|Could not find the table/i.test(erro.message ?? "")
  );
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export type { ProdutoDaBase };

export type PainelDaBase = {
  /** false: a migração ainda não foi aplicada. A tela diz isso em vez de quebrar. */
  instalada: boolean;
  /** whatsapp.manage: pode aprovar. */
  podeAprovar: boolean;
  /** configuracoes.manage ou whatsapp.manage: pode salvar rascunho, voltar a rascunho e arquivar. */
  podeEditar: boolean;
  respostas: RespostaDaBase[];
  produtos: ProdutoDaBase[];
};

const COLUNAS =
  "id, tema, pergunta, frases_gatilho, ramos, produto_id, familia, resposta, status, texto_aprovado, versao, aprovada_por, aprovada_em, origem, contagem_ocorrencias, atualizado_em";

export const lerPainelDaBase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainelDaBase> => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const podeAprovar = await tem(context.supabase, context.userId, "whatsapp.manage");
    const db = await admin();
    const lidas = await db
      .from("agente_base_respostas")
      .select(COLUNAS)
      .order("contagem_ocorrencias", { ascending: false })
      .order("tema")
      .limit(500);
    if (tabelaNaoExiste(lidas.error)) {
      return { instalada: false, podeAprovar, podeEditar: true, respostas: [], produtos: [] };
    }
    if (lidas.error) falhou("ler", lidas.error);
    const respostas = (lidas.data ?? []) as RespostaDaBase[];
    // só id, nome, família e se está ativo: nenhum preço sai do banco por aqui
    const ativos = await db.from("produtos").select("id, nome, familia, ativo").eq("ativo", true).order("nome").limit(1000);
    if (ativos.error) falhou("ler", ativos.error);
    const produtos = (ativos.data ?? []) as ProdutoDaBase[];
    // os produtos que as respostas citam, mesmo desativados: a tela não pode fazer a ligação sumir
    const jaTenho = new Set(produtos.map((p) => p.id));
    const citados = [...new Set(respostas.map((r) => r.produto_id).filter((x): x is string => !!x && !jaTenho.has(x)))];
    if (citados.length > 0) {
      const outros = await db.from("produtos").select("id, nome, familia, ativo").in("id", citados);
      if (outros.error) falhou("ler", outros.error);
      produtos.push(...((outros.data ?? []) as ProdutoDaBase[]));
    }
    return { instalada: true, podeAprovar, podeEditar: true, respostas, produtos };
  });

export const lerHistoricoDaResposta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<LinhaDoHistorico[]> => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const db = await admin();
    const { data: linhas, error } = await db
      .from("agente_base_respostas_historico")
      .select("id, resposta_id, versao, evento, status, resposta, por, em")
      .eq("resposta_id", data.id)
      .order("em", { ascending: false })
      .limit(200);
    if (error) falhou("ler", error);
    const historico = (linhas ?? []) as LinhaDoHistorico[];
    // o nome de quem mexeu, sem chave estrangeira: lê só nome da tabela de usuários
    const ids = [...new Set(historico.map((l) => l.por).filter((x): x is string => !!x))];
    if (ids.length === 0) return historico;
    const { data: nomes } = await db.from("usuarios").select("id, nome").in("id", ids);
    const porId = new Map<string, string>(
      ((nomes ?? []) as { id: string; nome: string | null }[]).map((u) => [u.id, u.nome ?? ""]),
    );
    return historico.map((l) => ({ ...l, por: l.por ? (porId.get(l.por) || "Pessoa da equipe") : null }));
  });

/** Os avisos do validador do banco para um texto, só pelos códigos. Não grava nada. */
export const verificarTextoDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        texto: z.string().max(2000),
        ramos: z.array(z.enum(["cliente", "parceiro"])).min(1).max(2),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ avisos: string[] }> => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const db = await admin();
    const { data: r, error } = await db.rpc("_agente_problemas_de_texto", {
      p_texto: data.texto,
      p_ramos: data.ramos,
    });
    if (error) falhou("verificar", error);
    return { avisos: (r ?? []) as string[] };
  });

/* ------------------------------------------------------------------ */
/* Escrita: sempre por função do banco                                 */
/* ------------------------------------------------------------------ */

const ramosSchema = z.array(z.enum(["cliente", "parceiro"])).min(1).max(2);

const salvarSchema = z.object({
  id: z.string().uuid().nullable(),
  tema: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,60}$/, "O tema usa só letras minúsculas, números e sublinhado."),
  pergunta: z.string().trim().min(1).max(160),
  frases: z.array(z.string().max(120)).max(30),
  ramos: ramosSchema,
  produtoId: z.string().uuid().nullable(),
  familia: z.string().trim().max(80).nullable(),
  resposta: z.string().trim().min(1).max(600),
  versaoVista: z.number().int().min(1).nullable(),
});

export type RespostaParaSalvar = z.input<typeof salvarSchema>;

export const salvarRespostaDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => salvarSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const db = await admin();
    const { data: r, error } = await db.rpc("agente_resposta_salvar", {
      p_usuario: context.userId,
      p_id: data.id,
      p_tema: data.tema,
      p_pergunta: data.pergunta,
      p_frases: data.frases,
      p_ramos: data.ramos satisfies RamoDaBase[],
      p_produto_id: data.produtoId,
      p_familia: data.familia,
      p_resposta: data.resposta,
      p_versao_vista: data.versaoVista,
      p_origem: "dono",
    });
    if (error) falhou("salvar", error);
    const j = (r ?? {}) as {
      id?: string;
      versao?: number;
      status?: string;
      voltou_a_rascunho?: boolean;
      problemas?: string[];
    };
    return {
      ok: true as const,
      id: j.id ?? null,
      versao: j.versao ?? null,
      status: j.status ?? null,
      voltouARascunho: j.voltou_a_rascunho === true,
      problemas: j.problemas ?? [],
    };
  });

/**
 * Aprova UMA resposta, a que o dono está vendo, na versão que ele viu. Se alguém
 * mudou o texto no meio, o banco recusa. Com `textoNovo`, é o "Editar e aprovar":
 * o texto editado e a aprovação acontecem na mesma transação. Exige whatsapp.manage.
 */
export const aprovarRespostaDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        versaoVista: z.number().int().min(1),
        textoNovo: z.string().trim().max(600).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.manage");
    const db = await admin();
    const { data: r, error } = await db.rpc("agente_resposta_aprovar", {
      p_usuario: context.userId,
      p_id: data.id,
      p_versao_vista: data.versaoVista,
      p_texto_novo: data.textoNovo && data.textoNovo.length > 0 ? data.textoNovo : null,
    });
    if (error) falhou("aprovar", error);
    return { ok: true as const, versao: ((r ?? {}) as { versao?: number }).versao ?? null };
  });

const soId = z.object({ id: z.string().uuid() });

export const voltarARascunhoDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => soId.parse(d))
  .handler(async ({ data, context }) => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const db = await admin();
    const { error } = await db.rpc("agente_resposta_rascunho", {
      p_usuario: context.userId,
      p_id: data.id,
    });
    if (error) falhou("rascunho", error);
    return { ok: true as const };
  });

export const arquivarRespostaDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => soId.parse(d))
  .handler(async ({ data, context }) => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const db = await admin();
    const { error } = await db.rpc("agente_resposta_arquivar", {
      p_usuario: context.userId,
      p_id: data.id,
    });
    if (error) falhou("arquivar", error);
    return { ok: true as const };
  });
