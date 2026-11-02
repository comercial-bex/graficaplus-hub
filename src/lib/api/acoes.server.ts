import { pareceToken } from "@/domain/api/recursos";
import { ACOES, acaoPorChave, lerArgumentos } from "@/domain/api/acoes";
import { contarNaJanela, erroDoBanco } from "@/lib/api/v1.server";

/**
 * As ações do MCP com ensaio (02/11/2026). O servidor confere token, janela e
 * argumentos e chama `api_executar`, que roda COMO a pessoa dona do token e só
 * grava com `confirmado = true`. Nada aqui manda mensagem ao cliente.
 */

export type ExecucaoDaAcao =
  | { ok: true; corpo: Record<string, unknown> }
  | { ok: false; codigo: string; mensagem: string; detalhe?: Record<string, unknown> };

/** O que o banco devolve em `erro` vira frase para quem pediu a ação. */
export function erroDaAcao(codigo: string, corpo: Record<string, unknown> = {}): ExecucaoDaAcao {
  switch (codigo) {
    case "acao_desconhecida":
      return { ok: false, codigo, mensagem: `Ação desconhecida. Existem: ${ACOES.map((a) => a.chave).join(", ")}.` };
    case "args_invalidos":
      return { ok: false, codigo, mensagem: "Argumentos inválidos para esta ação. Veja bexprint_acoes." };
    case "nao_encontrado":
      return { ok: false, codigo, mensagem: "Não achei esse registro, ou a pessoa dona do token não pode vê-lo." };
    case "estado_invalido":
      return { ok: false, codigo, mensagem: String(corpo.mensagem ?? "O registro não está num estado que aceite esta ação."), detalhe: { antes: corpo.antes ?? null } };
    case "sem_permissao":
      return { ok: false, codigo, mensagem: "A pessoa dona do token não tem permissão para esta ação. Nada foi gravado." };
    case "token_invalido":
    case "token_expirado": {
      const e = erroDoBanco(codigo);
      return { ok: false, codigo, mensagem: e.mensagem };
    }
    default:
      return { ok: false, codigo: "falha", mensagem: `Não foi possível executar agora${corpo.detalhe ? `: ${String(corpo.detalhe)}` : "."}` };
  }
}

export async function executarAcao(
  token: string | null,
  chave: string,
  argumentosBrutos: Record<string, unknown> | undefined,
  confirmado: boolean,
): Promise<ExecucaoDaAcao> {
  if (!token) return { ok: false, codigo: "sem_token", mensagem: "Mande o token pessoal no cabeçalho Authorization: Bearer bxp_… (Ajustes, API e MCP)." };
  if (!pareceToken(token)) return erroDaAcao("token_invalido");
  if (contarNaJanela(token) < 0) return { ok: false, codigo: "limite", mensagem: "Mais de 100 chamadas num minuto. Espere e tente de novo." };

  const acao = acaoPorChave(chave);
  if (!acao) return erroDaAcao("acao_desconhecida");
  const lidos = lerArgumentos(acao, argumentosBrutos);
  if (!lidos.ok) return { ok: false, codigo: "args_invalidos", mensagem: lidos.erro };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.rpc as any)("api_executar", {
    p_token: token,
    p_acao: acao.chave,
    p_args: lidos.argumentos,
    p_confirmado: confirmado,
  });
  if (error) {
    console.error("[api/mcp] api_executar falhou", { acao: acao.chave, mensagem: error.message });
    return erroDaAcao("falha");
  }
  const corpo = (data ?? {}) as Record<string, unknown>;
  if (typeof corpo.erro === "string") return erroDaAcao(corpo.erro, corpo);
  return { ok: true, corpo };
}
