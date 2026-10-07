/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: catalogo_link_pedir_cotacao não está nos tipos gerados */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashDoSegredo } from "@/domain/whatsapp/segredo-webhook";
import {
  CABECALHO_DO_CATALOGO,
  MENSAGEM_VITRINE_INVALIDA,
  tokenDoCatalogoBemFormado,
} from "@/domain/catalogo/link-do-catalogo";
import { pedidoDeCotacaoFechado } from "@/domain/catalogo/cotacao";

/**
 * POST /api/catalogo/cotacao — o cliente pede cotação do carrinho pelo link.
 *
 * AS MESMAS REGRAS DA ROTA DA VITRINE (`catalogo-link.server.ts`):
 *
 * 1. Nenhuma tabela é lida nem gravada direto. Daqui só sai a chamada a
 *    `catalogo_link_pedir_cotacao`, que confere o link pelo hash, confere cada
 *    item contra o link e grava com lista fechada de chaves.
 *
 * 2. O corpo passa por `pedidoDeCotacaoFechado` ANTES de ir ao banco: nome,
 *    telefone e itens {codigo, modalidade, quantidade}, nada mais. Corpo fora
 *    da forma → 400, sem gastar a cota do freio.
 *
 * 3. O token vem no cabeçalho `x-catalogo-token`, nunca na URL, e vai ao banco
 *    só como SHA-256. A origem vai como SHA-256 do endereço (o freio conta por
 *    origem, como no PIN da TV). Nem token, nem hash, nem telefone entram em log.
 *
 * Respostas: 200 {estado:"registrado"} · 429 {erro:"muitos_pedidos", libera_s}
 * · 400 {erro:"pedido_invalido", mensagem} · 401 link que não abre · 503 banco.
 */

function resposta(status: number, corpo: unknown, extras?: Record<string, string>): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extras,
    },
  });
}

function indisponivel(): Response {
  return resposta(503, { erro: "cotacao_indisponivel" });
}

function linkInvalido(): Response {
  return resposta(401, { erro: "link_invalido", mensagem: MENSAGEM_VITRINE_INVALIDA });
}

/**
 * De onde veio o pedido, para o freio contar por origem. `cf-connecting-ip`
 * primeiro porque é a borda que escreve, não quem chama. Sem endereço, a
 * origem fica desconhecida e vale só o teto por link.
 */
async function hashDaOrigemDe(request: Request): Promise<string | null> {
  const endereco =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0];
  const limpo = endereco?.trim().toLowerCase();
  if (!limpo || limpo.length > 64) return null;
  return hashDoSegredo(`bexprint-catalogo-origem:${limpo}`);
}

export async function responderCotacao(request: Request): Promise<Response> {
  const token = request.headers.get(CABECALHO_DO_CATALOGO);
  if (!tokenDoCatalogoBemFormado(token)) return linkInvalido();

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return resposta(400, { erro: "corpo_invalido" });
  }
  const pedido = pedidoDeCotacaoFechado(corpo);
  if (!pedido)
    return resposta(400, {
      erro: "pedido_invalido",
      mensagem: "Confira o nome, o WhatsApp e os itens.",
    });

  const hash = await hashDoSegredo(token);
  const origem = await hashDaOrigemDe(request);

  let data: unknown;
  try {
    const r = await (supabaseAdmin.rpc as any)("catalogo_link_pedir_cotacao", {
      p_token_hash: hash,
      p_nome: pedido.nome,
      p_telefone: pedido.telefone,
      p_itens: pedido.itens,
      p_origem_hash: origem,
    });
    if (r.error) {
      // Só o nome da função e o código do Postgres: o que entra aqui é hash de credencial.
      console.error(
        "[catalogo] catalogo_link_pedir_cotacao falhou no banco",
        r.error.code ?? "sem código",
      );
      return indisponivel();
    }
    data = r.data;
  } catch {
    console.error("[catalogo] catalogo_link_pedir_cotacao não chegou ao banco");
    return indisponivel();
  }

  const valor =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  switch (valor?.estado) {
    case "registrado":
      return resposta(200, { estado: "registrado" });
    case "bloqueado": {
      const libera = Number(valor.libera_s);
      const segundos = Number.isFinite(libera) && libera > 0 ? Math.ceil(libera) : 60;
      return resposta(
        429,
        { erro: "muitos_pedidos", libera_s: segundos },
        { "retry-after": String(segundos) },
      );
    }
    case "pedido_invalido":
      return resposta(400, {
        erro: "pedido_invalido",
        mensagem:
          typeof valor.mensagem === "string" ? valor.mensagem : "Confira os itens do pedido.",
      });
    case "invalido":
    case "vencido":
    case "revogado":
      return linkInvalido();
    default:
      // Estado que este código não conhece nunca vira "registrado".
      return indisponivel();
  }
}
