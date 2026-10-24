import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  LIMITE_DE_LINHAS,
  areaM2,
  chaveDoJob,
  montarJobs,
  type JobFlexi,
  type LinhaCrua,
  type LinhaRejeitada,
} from "@/domain/flexi/jobs";

/**
 * Importar os jobs da fila do FlexiPRINT (fase 1 de docs/plano-importacao-flexi.md).
 *
 * Duas ações, de propósito separadas:
 *   1. `lerPrintDoFlexi` — a IA lê o print e devolve as linhas. NÃO grava nada.
 *      Gasta saldo de IA do Lovable a cada chamada, só no clique do botão.
 *   2. `gravarJobsDoFlexi` — grava o que o operador CONFERIU, pela função SQL
 *      `importar_flexi_jobs` (EXECUTE só do service_role). A função confere a
 *      permissão de novo: duas trancas, como na caixa do WhatsApp.
 *
 * Permissão: quem encerra produção (`producao.finish`) ou dá saída de estoque
 * (`estoque.exit`) — operador, estoque, gestor e admin. Importar não baixa
 * estoque nem cria OS: só guarda o fato "isto saiu da plotter".
 *
 * A leitura da IA é rascunho: número lido errado vira baixa errada mais
 * adiante, então a tela mostra as linhas e o operador corrige antes de gravar.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Imagem com tabela densa: o modelo mais leve erra dígito; este custa pouco mais.
const MODELO = "google/gemini-2.5-flash";
const TEMPO_LIMITE_MS = 60_000;
const LIMITE_DA_IMAGEM = 8_000_000;
const PERMISSOES_QUE_IMPORTAM = ["producao.finish", "estoque.exit"];

export type LeituraDoPrint =
  | { estado: "ok"; jobs: JobFlexi[]; rejeitadas: LinhaRejeitada[] }
  | { estado: "sem_ia" }
  | { estado: "limite" }
  | { estado: "sem_saldo" }
  | { estado: "falhou"; detalhe: string };

export const FERRAMENTA_DO_PRINT = {
  type: "function",
  function: {
    name: "registrar_linhas",
    description:
      "Registra cada linha da fila de jobs do FlexiPRINT, exatamente como está escrita na tela.",
    parameters: {
      type: "object",
      properties: {
        linhas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nome: {
                type: "string",
                description: "Coluna 'Nome do Trabalho'. Vazio se a célula estiver vazia.",
              },
              status: {
                type: "string",
                description: "Coluna 'Status': Concluído, Mantendo, Abortado. Vazio se não houver.",
              },
              autor: { type: "string" },
              dimensao: {
                type: "string",
                description: "Coluna 'Dimensão', como '120,015 x 80,010cm'.",
              },
              copias: { type: "string", description: "Coluna 'Cópias'." },
              tipo: {
                type: "string",
                description: "Coluna 'Tipo' (PDF, Arquivo JPEG, Imagens Bitmap...).",
              },
              tamanho: {
                type: "string",
                description: "Coluna 'Tamanho do Arq...', como '1276,3K'.",
              },
              icc: { type: "string" },
              cores: { type: "string" },
              apos_saida: {
                type: "string",
                description: "Coluna 'Após a Saída': Manter, Apagar, Arquivar.",
              },
              data: { type: "string", description: "Coluna 'Data', como '28/09/2026 15:01:56'." },
              filho: {
                type: "boolean",
                description:
                  "true quando a linha está RECUADA sob um 'Otimizar Distribuição' (job filho de aninhamento, sem coluna Configuração).",
              },
            },
            required: ["dimensao", "copias", "data"],
          },
        },
      },
      required: ["linhas"],
    },
  },
} as const;

export const PEDIDO_AO_LER_O_PRINT =
  "Esta imagem é a fila de jobs do FlexiPRINT (Production Manager). Leia TODAS as linhas, de cima para baixo, " +
  "sem pular nenhuma e sem inventar. Copie os textos exatamente como estão, inclusive vírgula decimal e texto " +
  "cortado. Se uma célula está vazia, deixe vazio. Não some, não converta unidade, não corrija. " +
  "Responda só pela ferramenta registrar_linhas.";

/** O coração da leitura, sem framework: é o que o teste exercita. */
export async function lerPrintComIa(
  imagem: string,
  chave: string | undefined,
  buscar: typeof fetch = fetch,
): Promise<LeituraDoPrint> {
  if (!chave) return { estado: "sem_ia" };

  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta: Response;
  try {
    resposta = await buscar(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PEDIDO_AO_LER_O_PRINT },
              { type: "image_url", image_url: { url: imagem } },
            ],
          },
        ],
        tools: [FERRAMENTA_DO_PRINT],
        tool_choice: { type: "function", function: { name: FERRAMENTA_DO_PRINT.function.name } },
      }),
      signal: controle.signal,
    });
  } catch {
    return { estado: "falhou", detalhe: "o serviço de IA não respondeu" };
  } finally {
    clearTimeout(limite);
  }

  if (resposta.status === 429) return { estado: "limite" };
  if (resposta.status === 402) return { estado: "sem_saldo" };
  if (!resposta.ok)
    return { estado: "falhou", detalhe: `o serviço de IA respondeu HTTP ${resposta.status}` };

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { estado: "falhou", detalhe: "resposta da IA ilegível" };
  }
  const argumentos = (
    corpo as { choices?: { message?: { tool_calls?: { function?: { arguments?: unknown } }[] } }[] }
  )?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return interpretarLinhasDaIa(argumentos);
}

/** Os argumentos da ferramenta → jobs. Qualquer formato fora do combinado é "falhou", nunca "zero linhas". */
export function interpretarLinhasDaIa(argumentos: unknown): LeituraDoPrint {
  let objeto: unknown = argumentos;
  if (typeof argumentos === "string") {
    try {
      objeto = JSON.parse(argumentos);
    } catch {
      return { estado: "falhou", detalhe: "a IA não respondeu no formato combinado" };
    }
  }
  const linhas = (objeto as { linhas?: unknown })?.linhas;
  if (!Array.isArray(linhas))
    return { estado: "falhou", detalhe: "a IA não respondeu no formato combinado" };
  if (linhas.length === 0)
    return { estado: "falhou", detalhe: "a IA não encontrou nenhuma linha na imagem" };
  const { jobs, rejeitadas } = montarJobs(
    linhas.filter((l) => l && typeof l === "object") as LinhaCrua[],
  );
  return { estado: "ok", jobs, rejeitadas };
}

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
    "Seu perfil não importa jobs do Flexi (precisa encerrar produção ou dar saída de estoque).",
  );
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const lerPrintDoFlexi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        imagem: z
          .string()
          .max(LIMITE_DA_IMAGEM, "A imagem é grande demais. Tire um print só da fila.")
          .regex(
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/,
            "Envie um print em PNG, JPEG ou WebP.",
          ),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LeituraDoPrint> => {
    await exigirUma(context.supabase, context.userId, PERMISSOES_QUE_IMPORTAM);
    return lerPrintComIa(data.imagem, process.env.LOVABLE_API_KEY);
  });

const textoOpcional = (max: number) => z.string().trim().max(max).nullable();

const jobSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  status: z.enum(["concluido", "abortado", "mantendo", "outro"]),
  autor: textoOpcional(60),
  larguraCm: z.number().positive().max(100000),
  alturaCm: z.number().positive().max(100000),
  copias: z.number().int().min(1).max(100000),
  tipoArquivo: textoOpcional(60),
  tamanhoKb: z.number().nonnegative().max(1e9).nullable(),
  icc: textoOpcional(80),
  cores: textoOpcional(40),
  aposSaida: textoOpcional(30),
  impressoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/),
  aninhado: z.boolean(),
  paiChave: z.string().max(80).nullable(),
});

const gravarSchema = z.object({
  maquinaId: z.string().uuid(),
  origem: z.enum(["print", "arquivo"]),
  jobs: z.array(jobSchema).min(1).max(LIMITE_DE_LINHAS),
});

export type ResultadoDaGravacao = {
  importacaoId: string;
  lidas: number;
  novas: number;
  atualizadas: number;
  iguais: number;
};

export const gravarJobsDoFlexi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => gravarSchema.parse(d))
  .handler(async ({ data, context }): Promise<ResultadoDaGravacao> => {
    await exigirUma(context.supabase, context.userId, PERMISSOES_QUE_IMPORTAM);

    // A área e a chave são derivadas AQUI, da medida e da data que o operador
    // conferiu — não do que o navegador mandou. Assim linha editada na tela
    // continua com chave e área coerentes.
    const linhas = data.jobs.map((j) => ({
      chave: chaveDoJob(j.impressoEm, j.larguraCm, j.alturaCm, j.copias),
      nome: j.nome,
      status: j.status,
      autor: j.autor,
      largura_cm: j.larguraCm,
      altura_cm: j.alturaCm,
      copias: j.copias,
      area_m2: areaM2(j.larguraCm, j.alturaCm, j.copias),
      tipo_arquivo: j.tipoArquivo,
      tamanho_kb: j.tamanhoKb,
      perfil_icc: j.icc,
      cores: j.cores,
      apos_saida: j.aposSaida,
      impresso_em: j.impressoEm,
      aninhado: j.aninhado,
      pai_chave: j.paiChave,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await admin()) as any;
    const { data: r, error } = await db.rpc("importar_flexi_jobs", {
      p_usuario: context.userId,
      p_maquina_id: data.maquinaId,
      p_origem: data.origem,
      p_linhas: linhas,
    });
    if (error) throw new Error(error.message);
    return {
      importacaoId: r.importacao_id,
      lidas: r.lidas,
      novas: r.novas,
      atualizadas: r.atualizadas,
      iguais: r.iguais,
    };
  });
