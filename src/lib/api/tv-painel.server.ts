/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: as funções tv_* não estão nos tipos gerados */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashDoSegredo } from "@/domain/whatsapp/segredo-webhook";
import { CABECALHO_DO_TOKEN, segredoBemFormado } from "@/domain/tv/pareamento";
import { bancoIndisponivel, lerDoBanco, respostaTv } from "@/lib/api/tv-comum.server";

/**
 * GET /api/tv/painel — o que a TV da Oficina lê a cada 60 segundos.
 *
 * ORDEM DAS COISAS
 *   1. Lê o crachá do cabeçalho `x-tv-token`. Nunca da URL: endereço fica em
 *      log de servidor, em histórico e em captura de tela.
 *   2. Confere o HASH do crachá em `tv_dispositivos` (`tv_conferir_dispositivo`,
 *      que também marca o último acesso, no máximo uma vez por minuto).
 *      Sem dispositivo com esse hash, recusa. Não existe crachá padrão.
 *   3. Só então chama `tv_painel_maquinas()`, a única função que monta o que
 *      vai para a parede, e devolve o jsonb dela SEM mexer: este arquivo não
 *      escolhe coluna, não soma e não filtra. Cartão e lista saem da mesma
 *      consulta no banco; refazer conta aqui é como os dois passam a discordar.
 *
 * RESPOSTAS
 *   200  o jsonb de `tv_painel_maquinas()`
 *   401  {erro:"tv_nao_pareada"}   sem crachá, crachá mal formado ou desconhecido
 *   401  {erro:"tv_revogada"}      alguém revogou esta TV em /telas
 *   503  {erro:"banco_indisponivel"}
 *
 * NUNCA 200 com listas vazias quando algo falhou: a TV trata 503 como "sem
 * conexão desde HH:MM" e mantém o último dado esmaecido. Lista vazia ela
 * mostraria como oficina parada.
 */
export async function responderPainel(request: Request): Promise<Response> {
  const token = request.headers.get(CABECALHO_DO_TOKEN);
  if (!segredoBemFormado(token)) return respostaTv(401, { erro: "tv_nao_pareada" });

  const hashDoToken = await hashDoSegredo(token);
  const conferido = await lerDoBanco("tv_conferir_dispositivo", () =>
    (supabaseAdmin.rpc as any)("tv_conferir_dispositivo", { p_token_hash: hashDoToken }),
  );
  if (!conferido.ok) return bancoIndisponivel();

  const { estado } = conferido.valor;
  if (estado === "desconhecida") return respostaTv(401, { erro: "tv_nao_pareada" });
  if (estado === "revogada") return respostaTv(401, { erro: "tv_revogada" });
  // Estado que este código não conhece não abre a porta nem vira "não pareada"
  // (a TV apagaria o crachá bom): é falha, e falha é 503.
  if (estado !== "ativa") return bancoIndisponivel();

  const painel = await lerDoBanco("tv_painel_maquinas", () =>
    (supabaseAdmin.rpc as any)("tv_painel_maquinas"),
  );
  if (!painel.ok) return bancoIndisponivel();

  return respostaTv(200, painel.valor);
}
