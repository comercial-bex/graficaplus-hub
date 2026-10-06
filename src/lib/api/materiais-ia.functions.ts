import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  FERRAMENTA_DA_IA,
  candidatosParaIa,
  interpretarArgumentosDaIa,
  montarPerguntaDaIa,
  type ConferenciaIa,
  type MaterialComparavel,
  type NovoMaterial,
} from "@/domain/materiais/parecidos";

/**
 * "Conferir com IA" no cadastro de material: a IA do Lovable (AI Gateway) diz
 * quais materiais já cadastrados são o MESMO que o novo — o que a busca por
 * texto não enxerga, como sinônimo ("PS" × "poliestireno").
 *
 * Gasta saldo de IA do Lovable a cada chamada. Decisão do dono (05/10/2026):
 * só no clique do botão, nunca enquanto se digita (a busca por texto, grátis,
 * cobre o enquanto-digita). Por isso também:
 *   - só quem cadastra material usa (admin, gestor, estoque — a mesma regra da
 *     policy de escrita de `materiais`);
 *   - o modelo é o mais leve (`gemini-2.5-flash-lite`) e a lista que vai junto
 *     é curta: até 60 materiais, os mais parecidos por texto;
 *   - a IA recebe nome, unidade e características. Nunca custo, estoque ou
 *     fornecedor.
 *
 * A chave (`LOVABLE_API_KEY`) só existe no servidor. Sem ela a resposta é
 * "sem_ia" e a tela diz que a IA não está ligada no projeto — a busca por
 * texto continua funcionando. 402 = saldo de IA acabou; 429 = muitas chamadas
 * seguidas. Nenhum dos dois vira "nenhum duplicado".
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELO = "google/gemini-2.5-flash-lite";
const PAPEIS_QUE_CADASTRAM = ["admin", "gestor", "estoque"];
const TEMPO_LIMITE_MS = 20_000;

function limpar(texto: unknown, maximo: number): string {
  return typeof texto === "string" ? texto.replace(/\s+/g, " ").trim().slice(0, maximo) : "";
}

/** O coração da conferência, sem framework: é o que o teste exercita. */
export async function conferirComIa(
  novo: NovoMaterial,
  lerMateriais: () => Promise<MaterialComparavel[]>,
  chave: string | undefined,
  buscar: typeof fetch = fetch,
): Promise<ConferenciaIa> {
  if (!novo.nome || novo.nome.length < 3) {
    return { estado: "falhou", detalhe: "Escreva o nome do material antes de conferir." };
  }
  if (!chave) return { estado: "sem_ia" };

  const candidatos = candidatosParaIa(novo, await lerMateriais());
  if (candidatos.length === 0) return { estado: "ok", duplicados: [], nome_sugerido: null };

  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta: Response;
  try {
    resposta = await buscar(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        messages: montarPerguntaDaIa(novo, candidatos),
        tools: [FERRAMENTA_DA_IA],
        tool_choice: { type: "function", function: { name: FERRAMENTA_DA_IA.function.name } },
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
  if (!resposta.ok) return { estado: "falhou", detalhe: `o serviço de IA respondeu HTTP ${resposta.status}` };

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { estado: "falhou", detalhe: "resposta da IA ilegível" };
  }
  const argumentos = (corpo as { choices?: { message?: { tool_calls?: { function?: { arguments?: unknown } }[] } }[] })
    ?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (argumentos == null) return { estado: "falhou", detalhe: "a IA não respondeu no formato combinado" };
  return interpretarArgumentosDaIa(argumentos, candidatos);
}

export const conferirMaterialComIa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nome: string; unidade?: string | null; caracteristicas?: string | null }) => input)
  .handler(async ({ data, context }): Promise<ConferenciaIa> => {
    const { data: papeis, error: erroPapeis } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (erroPapeis) throw new Error("Não foi possível conferir o seu perfil. Tente de novo.");
    if (!(papeis ?? []).some((p) => PAPEIS_QUE_CADASTRAM.includes(String(p.role)))) {
      throw new Error("A conferência com IA é de quem cadastra material (administrador, gestor ou estoque).");
    }

    return conferirComIa(
      {
        nome: limpar(data.nome, 120),
        unidade: limpar(data.unidade, 20) || null,
        caracteristicas: limpar(data.caracteristicas, 500) || null,
      },
      async () => {
        // A view operacional: nome, unidade e características, sem custo.
        // `as any`: views não estão nos tipos gerados.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: lista, error } = await (context.supabase as any)
          .from("materiais_operacional")
          .select("id, nome, unidade, caracteristicas")
          .order("nome")
          .limit(2000);
        if (error) throw new Error("Não foi possível ler os materiais cadastrados.");
        return (lista ?? []) as MaterialComparavel[];
      },
      process.env.LOVABLE_API_KEY,
    );
  });
