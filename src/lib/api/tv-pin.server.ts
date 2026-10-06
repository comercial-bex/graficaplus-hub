/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: as funções tv_* não estão nos tipos gerados */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashDoSegredo } from "@/domain/whatsapp/segredo-webhook";
import { segredoBemFormado } from "@/domain/tv/pareamento";
import { pinBemFormado } from "@/domain/tv/pin";
import {
  bancoIndisponivel,
  hashDaOrigemDe,
  lerDoBanco,
  respostaTv,
} from "@/lib/api/tv-comum.server";

/**
 * /api/tv/pin — a TV da Oficina se libera digitando o PIN na própria tela.
 *
 * GET
 *   200 {ligado, digitos}        se a entrada por PIN está ligada e quantas
 *                                 casas o teclado desenha. Nada mais: nem quando
 *                                 foi definido, nem por quem.
 *   503 {erro:"banco_indisponivel"}
 *
 * POST {pin, token}
 *   O `token` é o crachá que a TV SORTEOU e guardou antes de mandar. Vai ao
 *   banco só o SHA-256 dele; o PIN vai como veio, porque quem confere contra o
 *   hash bcrypt é o banco (e um PIN de 4 dígitos não ganha nada com hash no
 *   caminho: são 10 mil valores, qualquer um refaz a tabela inteira).
 *   200 {estado:"liberado", nome}    o crachá vale: a TV passa a ler o painel.
 *                                     Repetir com o mesmo token dá a mesma
 *                                     resposta, sem criar outro aparelho
 *   401 {erro:"pin_errado", restantes}
 *   429 {erro:"muitas_tentativas", libera_s} + retry-after
 *                                     5 erros deste endereço, ou 30 no total,
 *                                     em 15 minutos
 *   403 {erro:"pin_desligado"}       o PIN foi desligado em /telas: a TV avisa
 *                                     e espera ser ligado de novo
 *   409 {erro:"token_revogado"}      o crachá que a TV guardou foi revogado:
 *                                     ela sorteia outro e repete
 *   400 {erro:"corpo_invalido" | "token_mal_formado" | "pin_mal_formado"}
 *                                     sem ir ao banco
 *   503 {erro:"banco_indisponivel"}
 *
 * O token nunca volta na resposta: quem tem o crachá é a TV, desde antes de
 * perguntar. E nada daqui vai para log, URL ou cabeçalho de resposta.
 */

export async function estadoDoPin(): Promise<Response> {
  const estado = await lerDoBanco("tv_estado_do_pin", () =>
    (supabaseAdmin.rpc as any)("tv_estado_do_pin"),
  );
  if (!estado.ok) return bancoIndisponivel();

  const ligado = estado.valor.ligado === true;
  const digitos = Number(estado.valor.digitos);
  if (ligado && !Number.isInteger(digitos)) return bancoIndisponivel();
  return respostaTv(200, { ligado, digitos: ligado ? digitos : null });
}

export async function entrarComPin(request: Request): Promise<Response> {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return respostaTv(400, { erro: "corpo_invalido" });
  }
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
    return respostaTv(400, { erro: "corpo_invalido" });
  }

  const { pin, token } = corpo as Record<string, unknown>;
  // Formato errado não vai ao banco e não gasta tentativa: o formato não é
  // segredo (o GET diz quantas casas o PIN tem).
  if (!segredoBemFormado(token)) return respostaTv(400, { erro: "token_mal_formado" });
  if (!pinBemFormado(pin)) return respostaTv(400, { erro: "pin_mal_formado" });

  const hashDoToken = await hashDoSegredo(token);
  const hashDaOrigem = await hashDaOrigemDe(request);

  const entrada = await lerDoBanco("tv_entrar_com_pin", () =>
    (supabaseAdmin.rpc as any)("tv_entrar_com_pin", {
      p_pin: pin,
      p_token_hash: hashDoToken,
      p_origem_hash: hashDaOrigem,
    }),
  );
  if (!entrada.ok) return bancoIndisponivel();

  switch (entrada.valor.estado) {
    case "liberado":
      return respostaTv(200, { estado: "liberado", nome: entrada.valor.nome });
    case "pin_errado": {
      const restantes = Number(entrada.valor.restantes);
      return respostaTv(401, {
        erro: "pin_errado",
        restantes: Number.isFinite(restantes) ? restantes : 0,
      });
    }
    case "bloqueado": {
      const libera = Number(entrada.valor.libera_s);
      const segundos = Number.isFinite(libera) && libera > 0 ? Math.ceil(libera) : 60;
      return respostaTv(
        429,
        { erro: "muitas_tentativas", libera_s: segundos },
        { "retry-after": String(segundos) },
      );
    }
    case "pin_desligado":
      return respostaTv(403, { erro: "pin_desligado" });
    case "token_revogado":
      return respostaTv(409, { erro: "token_revogado" });
    default:
      // Estado que este código não conhece: não é hora de inventar resposta.
      return bancoIndisponivel();
  }
}
