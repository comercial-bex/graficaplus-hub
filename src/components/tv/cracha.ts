/**
 * Onde a TV guarda o crachá (token) e o pedido de pareamento em andamento.
 *
 * O crachá vive em `localStorage[CHAVE_DO_TOKEN]` e, de reserva, num cookie
 * de longa duração da MESMA origem (Path=/tv; SameSite=Strict; Secure). Dois
 * lugares porque a TV é desligada todo dia e alguns navegadores de Smart TV
 * limpam o storage ao reiniciar — perder o crachá é alguém ter de subir na
 * escada com o celular. O cookie nunca é lido pelo servidor: a rota só aceita
 * o token no cabeçalho `x-tv-token`. Nunca na URL.
 *
 * Tudo aqui lê e grava no navegador; só roda dentro de efeito. Cada leitura e
 * escrita está em try/catch: storage bloqueado não pode derrubar a parede.
 */

import {
  CHAVE_DO_PAREAMENTO,
  CHAVE_DO_TOKEN,
  idBemFormado,
  segredoBemFormado,
  type PedidoDePareamento,
} from "@/domain/tv/pareamento";
import { CHAVE_DO_TOKEN_PENDENTE } from "@/domain/tv/pin";

const UM_ANO_S = 365 * 24 * 60 * 60;
/** O caminho da rota pública da TV: o cookie só viaja para cá. */
const CAMINHO_DO_COOKIE = "/tv";

function lerCookie(nome: string): string | null {
  try {
    const partes = document.cookie ? document.cookie.split("; ") : [];
    for (const parte of partes) {
      const i = parte.indexOf("=");
      if (i > 0 && parte.slice(0, i) === nome) return decodeURIComponent(parte.slice(i + 1));
    }
  } catch {
    /* sem cookie: segue sem */
  }
  return null;
}

function lerStorage(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarStorage(chave: string, valor: string | null): void {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, valor);
  } catch {
    /* storage bloqueado: o cookie (ou a memória) segura */
  }
}

/** O crachá guardado, se existir e tiver a forma certa. Formato errado é como não ter. */
export function lerToken(): string | null {
  const candidato = lerStorage(CHAVE_DO_TOKEN) ?? lerCookie(CHAVE_DO_TOKEN);
  if (!segredoBemFormado(candidato)) return null;
  // storage e cookie podem ter divergido (um apagado, outro não): iguala os dois
  gravarToken(candidato);
  return candidato;
}

export function gravarToken(token: string): void {
  gravarStorage(CHAVE_DO_TOKEN, token);
  try {
    document.cookie = `${CHAVE_DO_TOKEN}=${encodeURIComponent(token)}; Path=${CAMINHO_DO_COOKIE}; Max-Age=${UM_ANO_S}; SameSite=Strict; Secure`;
  } catch {
    /* sem cookie: o storage segura */
  }
}

/** 401 do painel: o crachá não vale mais. Some dos dois lugares. */
export function apagarToken(): void {
  gravarStorage(CHAVE_DO_TOKEN, null);
  try {
    document.cookie = `${CHAVE_DO_TOKEN}=; Path=${CAMINHO_DO_COOKIE}; Max-Age=0; SameSite=Strict; Secure`;
  } catch {
    /* idem */
  }
}

/**
 * O pedido guardado, para a TV REAPROVEITAR sempre — nunca abrir outro a cada
 * recarga (a fila de pareamento tem teto de 20 e cada pedido vivo é uma
 * linha). Quem diz se ele ainda vale é o servidor, na resposta de "retirar".
 */
export function lerPedidoGuardado(): PedidoDePareamento | null {
  return interpretarPedidoGuardado(lerStorage(CHAVE_DO_PAREAMENTO));
}

/** Separado para o teste: o que está no storage tem de ter a forma de um pedido. */
export function interpretarPedidoGuardado(texto: string | null): PedidoDePareamento | null {
  if (!texto) return null;
  try {
    const cru = JSON.parse(texto) as Record<string, unknown>;
    if (!cru || typeof cru !== "object") return null;
    if (!idBemFormado(cru.pareamento_id) || !segredoBemFormado(cru.retirada)) return null;
    if (typeof cru.codigo !== "string" || typeof cru.expira_em !== "string") return null;
    const validade =
      typeof cru.validade_s === "number" && Number.isFinite(cru.validade_s) ? cru.validade_s : 0;
    return {
      pareamento_id: cru.pareamento_id,
      codigo: cru.codigo,
      retirada: cru.retirada,
      expira_em: cru.expira_em,
      validade_s: validade,
    };
  } catch {
    return null;
  }
}

export function gravarPedido(pedido: PedidoDePareamento | null): void {
  gravarStorage(CHAVE_DO_PAREAMENTO, pedido ? JSON.stringify(pedido) : null);
}

/**
 * O crachá que a TV sorteou para entrar pelo PIN, guardado ANTES de ir ao
 * servidor: se a resposta "liberado" se perder, a próxima tentativa leva o
 * mesmo crachá e o servidor reconhece a mesma TV, em vez de criar outra.
 */
export function lerTokenPendente(): string | null {
  const guardado = lerStorage(CHAVE_DO_TOKEN_PENDENTE);
  return segredoBemFormado(guardado) ? guardado : null;
}

export function gravarTokenPendente(token: string | null): void {
  gravarStorage(CHAVE_DO_TOKEN_PENDENTE, token);
}
