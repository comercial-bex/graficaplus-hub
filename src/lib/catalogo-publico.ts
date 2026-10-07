import { supabase } from "@/integrations/supabase/client";
import {
  CABECALHO_DO_CATALOGO,
  MENSAGEM_VITRINE_INVALIDA,
  ROTA_DA_VITRINE,
} from "@/domain/catalogo/link-do-catalogo";
import { BUCKET_DE_FOTOS, urlDaFoto, type FotoDoItem } from "@/domain/catalogo/fotos";
import {
  ROTA_DA_COTACAO,
  type PedidoDeCotacao,
  type RespostaDaCotacao,
} from "@/domain/catalogo/cotacao";
import { vitrineFechada, type Vitrine } from "@/domain/catalogo/vitrine";

/**
 * O navegador do cliente falando com a rota da vitrine.
 *
 * Toda resposta que não é 200 vira `ErroDaVitrine` com o motivo: a página
 * nunca mostra uma vitrine vazia por causa de uma falha — "não há nada para
 * você" e "o servidor não respondeu" levam o cliente a decisões opostas.
 */

export type MotivoDoErroDaVitrine = "link_invalido" | "fora_do_ar" | "sem_conexao";

export class ErroDaVitrine extends Error {
  constructor(
    public readonly motivo: MotivoDoErroDaVitrine,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDaVitrine";
  }
}

export async function abrirVitrine(token: string): Promise<Vitrine> {
  let resposta: Response;
  try {
    resposta = await fetch(ROTA_DA_VITRINE, {
      method: "GET",
      headers: { [CABECALHO_DO_CATALOGO]: token },
      cache: "no-store",
    });
  } catch {
    throw new ErroDaVitrine(
      "sem_conexao",
      "Sem conexão com a Bex Print. Confira a internet do celular e tente de novo.",
    );
  }
  if (resposta.status === 401) throw new ErroDaVitrine("link_invalido", MENSAGEM_VITRINE_INVALIDA);
  if (resposta.status !== 200) {
    throw new ErroDaVitrine(
      "fora_do_ar",
      "O catálogo não abriu agora. Tente de novo em alguns minutos.",
    );
  }
  let lido: unknown;
  try {
    lido = await resposta.json();
  } catch {
    lido = null;
  }
  const vitrine = vitrineFechada(lido);
  if (!vitrine) {
    throw new ErroDaVitrine(
      "fora_do_ar",
      "O catálogo não abriu agora. Tente de novo em alguns minutos.",
    );
  }
  return vitrine;
}

/**
 * "Pedir cotação": registra o carrinho do cliente na gráfica. Devolve o estado
 * em vez de lançar — bloqueio por excesso de pedidos e pedido fora da forma são
 * respostas que a tela mostra, não falhas; só link inválido lança, porque aí a
 * página inteira muda.
 */
export async function pedirCotacao(
  token: string,
  pedido: PedidoDeCotacao,
): Promise<RespostaDaCotacao> {
  let resposta: Response;
  try {
    resposta = await fetch(ROTA_DA_COTACAO, {
      method: "POST",
      headers: { [CABECALHO_DO_CATALOGO]: token, "content-type": "application/json" },
      body: JSON.stringify(pedido),
      cache: "no-store",
    });
  } catch {
    return { estado: "fora_do_ar" };
  }
  if (resposta.status === 401) throw new ErroDaVitrine("link_invalido", MENSAGEM_VITRINE_INVALIDA);
  let lido: Record<string, unknown> = {};
  try {
    const bruto: unknown = await resposta.json();
    if (bruto && typeof bruto === "object" && !Array.isArray(bruto))
      lido = bruto as Record<string, unknown>;
  } catch {
    lido = {};
  }
  if (resposta.status === 200 && lido.estado === "registrado") return { estado: "registrado" };
  if (resposta.status === 429) {
    const libera = Number(lido.libera_s);
    return { estado: "bloqueado", libera_s: Number.isFinite(libera) && libera > 0 ? libera : 60 };
  }
  if (resposta.status === 400) {
    return {
      estado: "pedido_invalido",
      mensagem:
        typeof lido.mensagem === "string"
          ? lido.mensagem
          : "Confira o nome, o WhatsApp e os itens.",
    };
  }
  return { estado: "fora_do_ar" };
}

/** URL da foto: a do site para o acervo da carga, a pública do bucket para as enviadas pela tela. */
export function enderecoDaFoto(foto: FotoDoItem | null | undefined): string | null {
  return urlDaFoto(
    foto,
    (caminho) => supabase.storage.from(BUCKET_DE_FOTOS).getPublicUrl(caminho).data.publicUrl,
  );
}
