import type { FotoGerada } from "@/lib/api/produtos-foto-ia.functions";

/**
 * O lote de "Gerar fotos que faltam": quem entra e quando para.
 *
 * Revisão de 03/11/2026 (o lote ainda não tinha gerado nenhuma foto de verdade):
 *   - serviço (Deslocamento, Ilhós na lona...) não leva foto gerada, então não entra
 *     na contagem nem no lote: o botão dizia 57 e eram 43 produtos;
 *   - o lote só parava para "sem IA", "sem saldo" e "limite". Com a sessão vencida ou
 *     o gateway fora do ar ele seguia pelos 57 produtos, um aviso vermelho por produto,
 *     e terminava com aviso verde. Agora para depois de 3 falhas seguidas e na hora
 *     quando o erro é de acesso;
 *   - "limite" (429) espera e tenta o mesmo produto de novo, em vez de encerrar o lote:
 *     o dono pediu "clicar e ir gerando até o fim";
 *   - quem já ganhou foto no meio do lote (outra pessoa enviou a real) é pulado pelo
 *     servidor sem gastar saldo, e não conta como falha.
 */

/** Teto de segurança por clique: uma aba esquecida aberta não gasta saldo sem fim. */
export const LOTE_DE_FOTOS = 60;
/** Falhas seguidas (nenhuma foto no meio) que encerram o lote. */
export const FALHAS_SEGUIDAS_QUE_PARAM = 3;
/** Segundos de espera entre as tentativas quando o gateway diz "muitas chamadas" (429). */
export const ESPERAS_DO_LIMITE_S: readonly number[] = [30, 60];

export type ProdutoDoLote = {
  id: string;
  nome: string;
  imagem_url?: string | null;
  ativo?: boolean | null;
  tipo?: string | null;
};

/** Ativo, que não é serviço e ainda sem foto. */
export function produtosSemFoto<P extends ProdutoDoLote>(produtos: readonly P[]): P[] {
  return produtos.filter((p) => p.ativo !== false && p.tipo !== "servico" && !(p.imagem_url ?? "").trim());
}

export type MotivoDaParada = "fim" | "pediu" | "sem_ia" | "sem_saldo" | "limite" | "acesso" | "falhas_seguidas";

export type SaidaDoLote = {
  geradas: number;
  puladas: number;
  falhas: number;
  motivo: MotivoDaParada;
};

/** Sessão vencida, perfil sem papel ou token inválido: insistir em outro produto não resolve. */
export function ehErroDeAcesso(e: unknown): boolean {
  const texto = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /sess[aã]o|unauthorized|invalid token|forbidden|administrador e ger[eê]ncia|conferir o seu perfil|n[aã]o autenticad/i.test(texto);
}

type Resultado = { resultado: FotoGerada } | { erro: unknown };

export async function rodarLote(a: {
  produtos: readonly ProdutoDoLote[];
  /** Chama o servidor para um produto; lança quando a chamada falha (rede, sessão, perfil). */
  gerar: (produtoId: string) => Promise<FotoGerada>;
  devePararAgora: () => boolean;
  aoComecar: (feitas: number, p: ProdutoDoLote) => void;
  aoResultado: (p: ProdutoDoLote, r: Resultado) => void;
  aoEsperarLimite?: (segundos: number, p: ProdutoDoLote) => void;
  dormir?: (ms: number) => Promise<void>;
  falhasQueParam?: number;
  esperasDoLimiteS?: readonly number[];
}): Promise<SaidaDoLote> {
  const dormir = a.dormir ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const maximoSeguidas = a.falhasQueParam ?? FALHAS_SEGUIDAS_QUE_PARAM;
  const esperas = a.esperasDoLimiteS ?? ESPERAS_DO_LIMITE_S;
  let geradas = 0;
  let puladas = 0;
  let falhas = 0;
  let seguidas = 0;
  let motivo: MotivoDaParada = "fim";

  for (let i = 0; i < a.produtos.length; i++) {
    const p = a.produtos[i];
    if (a.devePararAgora()) {
      motivo = "pediu";
      break;
    }
    a.aoComecar(i, p);

    // Um produto: se o gateway diz 429, espera e tenta o MESMO produto de novo, até esgotar as esperas.
    let resultado: FotoGerada | null = null;
    let erro: unknown = null;
    let tentativa = 0;
    let pediuParar = false;
    for (;;) {
      try {
        resultado = await a.gerar(p.id);
        erro = null;
      } catch (e) {
        resultado = null;
        erro = e ?? new Error("falhou");
      }
      if (resultado?.estado === "limite" && tentativa < esperas.length) {
        const segundos = esperas[tentativa++];
        a.aoEsperarLimite?.(segundos, p);
        // Dorme de 1 em 1 segundo: o "Parar" vale também durante a espera.
        for (let s = 0; s < segundos && !a.devePararAgora(); s++) await dormir(1000);
        if (a.devePararAgora()) {
          pediuParar = true;
          break;
        }
        continue;
      }
      break;
    }
    if (pediuParar) {
      motivo = "pediu";
      break;
    }

    if (resultado === null) {
      falhas += 1;
      seguidas += 1;
      a.aoResultado(p, { erro });
      if (ehErroDeAcesso(erro)) {
        motivo = "acesso";
        break;
      }
    } else if (resultado.estado === "ok") {
      geradas += 1;
      seguidas = 0;
      a.aoResultado(p, { resultado });
    } else if (resultado.estado === "ja_tem_foto" || resultado.estado === "servico") {
      // Nada foi gasto e nada deu errado: o produto só não precisa de foto.
      puladas += 1;
      a.aoResultado(p, { resultado });
    } else if (resultado.estado === "falhou") {
      falhas += 1;
      seguidas += 1;
      a.aoResultado(p, { resultado });
    } else {
      // sem_ia, sem_saldo ou limite que as esperas não resolveram: insistir só repete o erro.
      a.aoResultado(p, { resultado });
      motivo = resultado.estado;
      break;
    }
    if (seguidas >= maximoSeguidas) {
      motivo = "falhas_seguidas";
      break;
    }
  }
  return { geradas, puladas, falhas, motivo };
}

/** O aviso do fim do lote: verde só quando gerou foto; nunca verde para um lote que não gerou nada. */
export function resumoDoLote(s: SaidaDoLote, semFotoAntes: number): { nivel: "sucesso" | "aviso" | "info"; texto: string } {
  const fotos = (n: number) => `${n} ${n === 1 ? "foto gerada" : "fotos geradas"}`;
  const restantes = Math.max(semFotoAntes - s.geradas, 0);
  switch (s.motivo) {
    case "fim":
      if (s.geradas > 0) {
        return {
          nivel: "sucesso",
          texto: `${fotos(s.geradas)}. ${restantes === 0 ? "Todos os produtos ativos têm foto." : `Faltam ${restantes}.`}`,
        };
      }
      if (s.puladas > 0 && s.falhas === 0) return { nivel: "info", texto: "Nada a gerar: esses produtos já tinham foto ou são serviços." };
      return { nivel: "aviso", texto: "Nenhuma foto gerada desta vez. Veja os avisos acima." };
    case "pediu":
      return { nivel: "info", texto: `Lote parado a pedido. ${fotos(s.geradas)}. Faltam ${restantes}.` };
    case "sem_ia":
      return { nivel: "aviso", texto: `Lote parado: a IA não está ligada neste projeto. ${fotos(s.geradas)}.` };
    case "sem_saldo":
      return { nivel: "aviso", texto: `Lote parado: o saldo de IA do projeto acabou. ${fotos(s.geradas)}. Faltam ${restantes}.` };
    case "limite":
      return { nivel: "aviso", texto: `Lote parado: a IA segue no limite de chamadas depois de esperar. ${fotos(s.geradas)}. Tente de novo em alguns minutos.` };
    case "acesso":
      return { nivel: "aviso", texto: `Lote parado: a sessão venceu ou a sua conta não pode gerar fotos. Entre de novo e tente. ${fotos(s.geradas)}.` };
    case "falhas_seguidas":
      return {
        nivel: "aviso",
        texto: `Lote parado depois de ${FALHAS_SEGUIDAS_QUE_PARAM} falhas seguidas, para não gastar saldo à toa. Veja os avisos acima. ${fotos(s.geradas)}.`,
      };
  }
}
