import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  JANELA_EM_DIAS,
  numeroNoNome,
  sugerirParaJob,
  type ItemCandidato,
  type JobParaVincular,
} from "@/domain/flexi/vinculo";

/**
 * Vincular os jobs do Flexi aos orçamentos (fase 2 de docs/plano-importacao-flexi.md).
 *
 * O servidor SUGERE e a pessoa CONFIRMA. Nada aqui baixa estoque nem cria OS.
 *
 * Por que o servidor lê os orçamentos com a chave de serviço: o operador, que é
 * quem importa e confere o job, não tem `orcamentos.read` — e não precisa ter.
 * O que sai daqui para o navegador é só número, título, descrição, medida,
 * quantidade e situação do item. Nunca preço, custo, cliente ou margem.
 *
 * Permissão: a mesma da importação — `producao.finish` ou `estoque.exit`. As
 * funções SQL `rip_gravar_sugestoes` e `rip_decidir_vinculo` (EXECUTE só do
 * service_role) conferem de novo.
 */

const PERMISSOES = ["producao.finish", "estoque.exit"];
const LIMITE_DE_JOBS = 300;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exigirUma(supabase: any, userId: string, permissoes: string[]) {
  for (const permissao of permissoes) {
    const { data, error } = await supabase.rpc("has_permission", {
      _user_id: userId,
      _permission: permissao,
    });
    if (error) throw new Error(error.message);
    if (data) return;
  }
  throw new Error(
    "Seu perfil não vincula jobs do Flexi (precisa encerrar produção ou dar saída de estoque).",
  );
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type JobDoBanco = {
  id: string;
  nome_job: string;
  largura_cm: number | string;
  altura_cm: number | string;
  copias: number;
  impresso_em: string;
};

type LinhaDeItem = {
  id: string;
  descricao: string | null;
  quantidade: number | string | null;
  largura: number | string | null;
  altura: number | string | null;
  orcamentos: {
    id: string;
    numero: number;
    titulo: string | null;
    status: string;
    created_at: string;
    os_id: string | null;
  } | null;
};

export const COLUNAS_DO_ITEM =
  "id, descricao, quantidade, largura, altura, orcamentos!inner(id, numero, titulo, status, created_at, os_id)";

const numero = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function itemCandidatoDe(l: LinhaDeItem): ItemCandidato | null {
  if (!l.orcamentos) return null;
  return {
    itemId: l.id,
    orcamentoId: l.orcamentos.id,
    orcamentoNumero: l.orcamentos.numero,
    orcamentoTitulo: l.orcamentos.titulo ?? "",
    orcamentoStatus: l.orcamentos.status,
    orcamentoCriadoEm: l.orcamentos.created_at,
    osId: l.orcamentos.os_id,
    descricao: l.descricao ?? "",
    larguraM: numero(l.largura),
    alturaM: numero(l.altura),
    quantidade: numero(l.quantidade) ?? 1,
  };
}

/** O coração, sem framework: jobs + itens → o que gravar. É o que o teste exercita. */
export function montarSugestoes(jobs: JobDoBanco[], itens: ItemCandidato[]) {
  const sugestoes: {
    rip_job_id: string;
    estado: "sugerido" | "revisar";
    origem: "numero_no_nome" | "medida";
    orcamento_item_id: string | null;
    confianca: number;
    motivos: string[];
    candidatos: unknown[];
  }[] = [];
  let semCandidato = 0;

  for (const j of jobs) {
    const job: JobParaVincular = {
      nome: j.nome_job,
      larguraCm: Number(j.largura_cm),
      alturaCm: Number(j.altura_cm),
      copias: j.copias,
      impressoEm: j.impresso_em,
    };
    const s = sugerirParaJob(job, itens);
    if (!s) {
      semCandidato += 1;
      continue;
    }
    sugestoes.push({
      rip_job_id: j.id,
      estado: s.estado,
      origem: s.origem,
      orcamento_item_id: s.principal?.itemId ?? null,
      confianca: s.principal?.confianca ?? s.candidatos[0]?.confianca ?? 0,
      motivos: s.principal?.motivos ?? [],
      candidatos: s.candidatos,
    });
  }
  return { sugestoes, semCandidato };
}

export type ResultadoDaBusca = {
  analisados: number;
  sugeridos: number;
  revisar: number;
  semCandidato: number;
};

export const sugerirVinculos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResultadoDaBusca> => {
    await exigirUma(context.supabase, context.userId, PERMISSOES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await admin()) as any;

    // Jobs sem decisão de pessoa: sem vínculo, ou com sugestão ainda aberta.
    // Re-sugerir é de graça e pega orçamento criado depois da importação.
    const { data: jobsBrutos, error: erroJobs } = await db
      .from("rip_jobs")
      .select("id, nome_job, largura_cm, altura_cm, copias, impresso_em, rip_job_vinculos(estado)")
      .order("impresso_em", { ascending: false })
      .limit(LIMITE_DE_JOBS * 3);
    if (erroJobs) throw new Error(erroJobs.message);

    const jobs = ((jobsBrutos ?? []) as (JobDoBanco & { rip_job_vinculos: unknown })[])
      .filter((j) => {
        const v = Array.isArray(j.rip_job_vinculos) ? j.rip_job_vinculos[0] : j.rip_job_vinculos;
        const estado = (v as { estado?: string } | null | undefined)?.estado;
        return !estado || estado === "sugerido" || estado === "revisar";
      })
      .slice(0, LIMITE_DE_JOBS);
    if (jobs.length === 0) return { analisados: 0, sugeridos: 0, revisar: 0, semCandidato: 0 };

    const tempos = jobs.map((j) => new Date(j.impresso_em).getTime());
    const dia = 24 * 60 * 60 * 1000;
    const de = new Date(Math.min(...tempos) - (JANELA_EM_DIAS + 1) * dia).toISOString();
    const ate = new Date(Math.max(...tempos) + (JANELA_EM_DIAS + 1) * dia).toISOString();
    const numeros = [
      ...new Set(
        jobs.map((j) => numeroNoNome(j.nome_job).orcamento).filter((n): n is number => n !== null),
      ),
    ];

    const [naJanela, peloNumero] = await Promise.all([
      db
        .from("orcamento_itens")
        .select(COLUNAS_DO_ITEM)
        .gte("orcamentos.created_at", de)
        .lte("orcamentos.created_at", ate)
        .limit(3000),
      numeros.length > 0
        ? db
            .from("orcamento_itens")
            .select(COLUNAS_DO_ITEM)
            .in("orcamentos.numero", numeros)
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (naJanela.error) throw new Error(naJanela.error.message);
    if (peloNumero.error) throw new Error(peloNumero.error.message);

    const porId = new Map<string, ItemCandidato>();
    for (const l of [...(naJanela.data ?? []), ...(peloNumero.data ?? [])] as LinhaDeItem[]) {
      const c = itemCandidatoDe(l);
      if (c) porId.set(c.itemId, c);
    }

    const { sugestoes, semCandidato } = montarSugestoes(jobs, [...porId.values()]);
    if (sugestoes.length > 0) {
      const { error } = await db.rpc("rip_gravar_sugestoes", {
        p_usuario: context.userId,
        p_sugestoes: sugestoes,
      });
      if (error) throw new Error(error.message);
    }
    return {
      analisados: jobs.length,
      sugeridos: sugestoes.filter((s) => s.estado === "sugerido").length,
      revisar: sugestoes.filter((s) => s.estado === "revisar").length,
      semCandidato,
    };
  });

const decisaoSchema = z.discriminatedUnion("acao", [
  z.object({
    acao: z.literal("confirmar"),
    ripJobId: z.string().uuid(),
    orcamentoItemId: z.string().uuid(),
  }),
  z.object({ acao: z.literal("recusar"), ripJobId: z.string().uuid() }),
  z.object({ acao: z.literal("reabrir"), ripJobId: z.string().uuid() }),
  z.object({
    acao: z.literal("sem_orcamento"),
    ripJobId: z.string().uuid(),
    motivo: z.enum(["prova", "teste", "terceirizado", "outro"]),
  }),
]);

export type DecisaoDeVinculo = z.infer<typeof decisaoSchema>;

export const decidirVinculo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => decisaoSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigirUma(context.supabase, context.userId, PERMISSOES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await admin()) as any;
    const { data: r, error } = await db.rpc("rip_decidir_vinculo", {
      p_usuario: context.userId,
      p_rip_job_id: data.ripJobId,
      p_acao: data.acao,
      p_orcamento_item_id: data.acao === "confirmar" ? data.orcamentoItemId : null,
      p_motivo: data.acao === "sem_orcamento" ? data.motivo : null,
    });
    if (error) throw new Error(error.message);
    return r as { estado: string | null; orcamento_numero?: number };
  });

export type ItemParaEscolher = {
  itemId: string;
  orcamentoNumero: number;
  titulo: string;
  descricao: string;
  status: string;
  larguraCm: number | null;
  alturaCm: number | null;
  quantidade: number;
};

/** "Outro orçamento": a pessoa digita o número e escolhe o item. Sem preço, sem cliente. */
export const itensDoOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ numero: z.number().int().min(1).max(999999) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ItemParaEscolher[]> => {
    await exigirUma(context.supabase, context.userId, PERMISSOES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await admin()) as any;
    const { data: linhas, error } = await db
      .from("orcamento_itens")
      .select(COLUNAS_DO_ITEM)
      .eq("orcamentos.numero", data.numero)
      .order("ordem", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return ((linhas ?? []) as LinhaDeItem[])
      .map(itemCandidatoDe)
      .filter((i): i is ItemCandidato => i !== null)
      .map((i) => ({
        itemId: i.itemId,
        orcamentoNumero: i.orcamentoNumero,
        titulo: i.orcamentoTitulo,
        descricao: i.descricao,
        status: i.orcamentoStatus,
        larguraCm: i.larguraM ? Math.round(i.larguraM * 1000) / 10 : null,
        alturaCm: i.alturaM ? Math.round(i.alturaM * 1000) / 10 : null,
        quantidade: i.quantidade,
      }));
  });
