/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: as funções tv_* não estão nos tipos gerados */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { gerarSegredo, hashDoSegredo } from "@/domain/whatsapp/segredo-webhook";
import { gerarCodigo, idBemFormado, segredoBemFormado } from "@/domain/tv/pareamento";
import {
  bancoIndisponivel,
  hashDaOrigemDe,
  lerDoBanco,
  respostaTv,
} from "@/lib/api/tv-comum.server";

/**
 * POST /api/tv/parear — a TV pede o crachá e, depois de aprovada, o retira.
 *
 * A TV não tem login. O que ela tem é um pedido, e o pedido tem duas metades:
 *   o CÓDIGO, que ela mostra na parede para o admin aprovar em /telas;
 *   a RETIRADA, um segredo de 32 bytes que só ela conhece.
 * O código aponta QUAL pedido aprovar; a retirada prova que quem veio buscar o
 * crachá é a mesma tela que pediu. Sem a segunda metade, qualquer um que visse
 * o código na parede poderia buscar o token no lugar da TV.
 *
 * {acao:"novo"}
 *   200 {pareamento_id, codigo, retirada, expira_em, validade_s}
 *                                           `retirada` só aqui; `validade_s` é
 *                                           quanto falta pelo relógio do banco
 *   429 {erro:"muitos_pareamentos", libera_em}  20 pedidos vivos no total, ou
 *                                           5 vindos do mesmo endereço
 *   503 {erro:"banco_indisponivel"}
 *
 * {acao:"retirar", pareamento_id, retirada}
 *   200 {estado:"aguardando", expira_em, validade_s}  ninguém aprovou ainda
 *   200 {estado:"pareado", token, nome}   o banco fica só com o SHA-256 do token
 *   200 {estado:"expirado"}               o código venceu: peça outro
 *   200 {estado:"consumido"}              o crachá deste pedido foi revogado:
 *                                          peça outro
 *   401 {erro:"pareamento_recusado"}      pedido que não existe ou segredo
 *                                          errado — sem dizer qual dos dois
 *   503 {erro:"banco_indisponivel"}
 *
 * A RETIRADA É REPETÍVEL. O crachá não é sorteado: é derivado do segredo de
 * retirada (HMAC), então a mesma TV, com o mesmo pedido, recebe sempre o MESMO
 * token. Se a resposta "pareado" se perder no Wi-Fi da oficina, a pergunta
 * seguinte devolve o crachá de novo em vez de deixar um dispositivo órfão em
 * /telas e a TV sem acesso. Quem não tem o segredo de retirada não deriva nada
 * — e o banco só guarda o hash dele.
 *
 * Tudo que mexe no banco é UMA função por passo (`tv_criar_pareamento_da_origem`,
 * `tv_retirar_pareamento`): conferir o segredo, criar o dispositivo e queimar
 * o pedido acontecem na mesma transação. Dois `insert`/`update` soltos daqui
 * deixariam uma janela para a mesma retirada gerar dois crachás.
 *
 * O servidor compara HASH com hash. O segredo de retirada e o token nunca vão
 * para o banco em claro, nem para o log, nem para a URL.
 */

/** Colisão de código é rara (1 em ~1 bilhão por pedido vivo); três sorteios sobram. */
const SORTEIOS_DE_CODIGO = 3;

export function saudeDoPareamento(): Response {
  // GET sem efeito colateral: prova que a rota está publicada, sem expor nada.
  return respostaTv(200, { ok: true, servico: "pareamento da TV", metodo: "POST" });
}

export async function processarPareamento(request: Request): Promise<Response> {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return respostaTv(400, { erro: "corpo_invalido" });
  }
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
    return respostaTv(400, { erro: "corpo_invalido" });
  }

  const pedido = corpo as Record<string, unknown>;
  if (pedido.acao === "novo") return novoPareamento(await hashDaOrigemDe(request));
  if (pedido.acao === "retirar") return retirarPareamento(pedido.pareamento_id, pedido.retirada);
  return respostaTv(400, { erro: "acao_desconhecida" });
}

async function novoPareamento(hashDaOrigem: string | null): Promise<Response> {
  for (let sorteio = 0; sorteio < SORTEIOS_DE_CODIGO; sorteio++) {
    const codigo = gerarCodigo();
    const retirada = gerarSegredo();
    const hashDaRetirada = await hashDoSegredo(retirada);

    const criado = await lerDoBanco("tv_criar_pareamento_da_origem", () =>
      (supabaseAdmin.rpc as any)("tv_criar_pareamento_da_origem", {
        p_codigo: codigo,
        p_retirada_hash: hashDaRetirada,
        p_origem_hash: hashDaOrigem,
      }),
    );
    if (!criado.ok) return bancoIndisponivel();

    const { estado } = criado.valor;
    if (estado === "criado") {
      return respostaTv(200, {
        pareamento_id: criado.valor.pareamento_id,
        codigo,
        retirada,
        expira_em: criado.valor.expira_em,
        validade_s: criado.valor.validade_s,
      });
    }
    if (estado === "cheio") {
      // Freio contra enchente: a rota é pública e cada pedido é uma linha.
      // A resposta é a mesma para "fila cheia" e "muitos deste endereço": quem
      // está enchendo não precisa saber em qual dos dois tetos bateu.
      return respostaTv(
        429,
        { erro: "muitos_pareamentos", libera_em: criado.valor.libera_em ?? null },
        { "retry-after": "60" },
      );
    }
    if (estado !== "codigo_repetido") break;
    // código repetido: outro pedido vivo sorteou o mesmo. Sorteia de novo.
  }
  // Três colisões seguidas ou estado que este código não conhece: não é hora
  // de inventar resposta. A TV mostra "servidor sem resposta" e tenta de novo.
  return bancoIndisponivel();
}

async function retirarPareamento(pareamentoId: unknown, retirada: unknown): Promise<Response> {
  // Formato errado recebe a mesma recusa de segredo errado: quem sonda a rota
  // não aprende se errou a forma, o pedido ou o segredo.
  if (!idBemFormado(pareamentoId) || !segredoBemFormado(retirada)) {
    return respostaTv(401, { erro: "pareamento_recusado" });
  }

  // O crachá é derivado do segredo de retirada, igual a cada pergunta, e só
  // existe de verdade se o banco responder "pareado" — aí o hash dele está
  // gravado. Nas outras respostas ele é descartado sem nunca ter saído daqui.
  const token = await derivarToken(pareamentoId, retirada);
  const hashDaRetirada = await hashDoSegredo(retirada);
  const hashDoToken = await hashDoSegredo(token);

  const retirado = await lerDoBanco("tv_retirar_pareamento", () =>
    (supabaseAdmin.rpc as any)("tv_retirar_pareamento", {
      p_pareamento_id: pareamentoId,
      p_retirada_hash: hashDaRetirada,
      p_token_hash: hashDoToken,
    }),
  );
  if (!retirado.ok) return bancoIndisponivel();

  switch (retirado.valor.estado) {
    case "pareado":
      return respostaTv(200, { estado: "pareado", token, nome: retirado.valor.nome });
    case "aguardando":
      return respostaTv(200, {
        estado: "aguardando",
        expira_em: retirado.valor.expira_em,
        validade_s: retirado.valor.validade_s,
      });
    case "expirado":
      return respostaTv(200, { estado: "expirado" });
    case "consumido":
      return respostaTv(200, { estado: "consumido" });
    case "recusado":
      return respostaTv(401, { erro: "pareamento_recusado" });
    default:
      return bancoIndisponivel();
  }
}

/**
 * O crachá da TV: HMAC-SHA256 com o segredo de retirada como chave, em
 * base64url (43 caracteres, o mesmo formato de `gerarSegredo`).
 *
 * Por que derivar em vez de sortear: sorteado, o token só existia na resposta
 * "pareado"; se ela se perdesse, a TV ficava sem crachá e o banco com um
 * dispositivo que ninguém usa. Derivado, a mesma pergunta dá a mesma resposta.
 *
 * O que isso NÃO muda: o segredo de retirada tem 32 bytes aleatórios e o banco
 * só guarda o SHA-256 dele, então quem lê o banco continua sem conseguir
 * montar o token de nenhuma TV. O texto fixo separa este uso de qualquer outro
 * hash do mesmo segredo (o `retirada_hash` é SHA-256 puro, outra conta).
 */
async function derivarToken(pareamentoId: string, retirada: string): Promise<string> {
  const texto = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    texto.encode(retirada),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      chave,
      texto.encode(`bexprint-tv-token:${pareamentoId.toLowerCase()}`),
    ),
  );
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
