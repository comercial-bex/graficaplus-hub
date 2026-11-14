import type { RamoDaBase, RespostaDaBase, StatusDaResposta } from "./tipos";

/**
 * O casamento da pergunta com a resposta da base, usado pela área de ensaio da
 * tela. SÓ por frase gatilho: nunca IA, nunca pontuação de semelhança.
 *
 * A regra, que um consumidor futuro terá de repetir igual:
 *  1. a pergunta e as frases são normalizadas do mesmo jeito que o banco faz
 *     (minúsculas, sem acento, sem pontuação, letras repetidas três ou mais vezes
 *     viram uma, espaço único);
 *  2. uma frase casa quando aparece na pergunta como PALAVRAS INTEIRAS ("frete"
 *     casa "qual o frete?", mas não "fretes grandes demais" por dentro de outra
 *     palavra);
 *  3. só servem respostas APROVADAS do ramo da conversa;
 *  4. resposta de um produto vale mais que a de uma família, que vale mais que a
 *     geral; se o produto ou a família da conversa são conhecidos e a resposta é
 *     de outro produto, ela não serve;
 *  5. dentro do mesmo nível, ganha a frase com mais palavras, depois a mais longa,
 *     depois o tema mais frequente nas conversas.
 */

/** Cópia da normalização do banco (`_triagem_normalizar_frase`). Dígitos não são reduzidos. */
export function normalizarPerguntaDaBase(texto: string | null | undefined): string {
  if (!texto) return "";
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])\1{2,}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A frase aparece na pergunta, como palavras inteiras? Os dois lados já normalizados. */
export function fraseCasa(perguntaNormalizada: string, fraseNormalizada: string): boolean {
  if (!perguntaNormalizada || !fraseNormalizada) return false;
  return ` ${perguntaNormalizada} `.includes(` ${fraseNormalizada} `);
}

export type ContextoDoEnsaio = {
  ramo: RamoDaBase;
  produtoId?: string | null;
  familia?: string | null;
};

export type Casamento = {
  resposta: RespostaDaBase;
  /** A frase gatilho mais forte que casou, já normalizada. */
  frase: string;
  /** 3 produto, 2 família, 1 geral. */
  especificidade: 1 | 2 | 3;
  /** Só quem está aprovada serviria; as outras aparecem como "ainda não". */
  serviria: boolean;
};

function especificidadeDe(
  r: RespostaDaBase,
  ctx: ContextoDoEnsaio,
): { serve: boolean; nivel: 1 | 2 | 3 } {
  if (r.produto_id) {
    if (!ctx.produtoId || ctx.produtoId !== r.produto_id) return { serve: false, nivel: 3 };
    return { serve: true, nivel: 3 };
  }
  if (r.familia && ctx.familia) {
    const mesma = normalizarPerguntaDaBase(r.familia) === normalizarPerguntaDaBase(ctx.familia);
    return mesma ? { serve: true, nivel: 2 } : { serve: false, nivel: 2 };
  }
  // família da resposta sem família conhecida na conversa: a família só descreve o assunto, não restringe
  return { serve: true, nivel: 1 };
}

function palavras(frase: string): number {
  return frase ? frase.split(" ").length : 0;
}

/**
 * Todas as respostas, de qualquer status, cujo gatilho casa com a pergunta, da
 * que serviria primeiro à que serviria por último. Rascunho e arquivada
 * aparecem para o dono entender, mas nunca com `serviria`.
 */
export function casamentosDaPergunta(
  pergunta: string,
  respostas: readonly RespostaDaBase[],
  ctx: ContextoDoEnsaio,
): Casamento[] {
  const p = normalizarPerguntaDaBase(pergunta);
  if (!p) return [];
  const achados: Casamento[] = [];
  for (const r of respostas) {
    if (!r.ramos.includes(ctx.ramo)) continue;
    const esp = especificidadeDe(r, ctx);
    if (!esp.serve) continue;
    let melhor = "";
    for (const f of r.frases_gatilho) {
      const n = normalizarPerguntaDaBase(f);
      if (!fraseCasa(p, n)) continue;
      if (
        palavras(n) > palavras(melhor) ||
        (palavras(n) === palavras(melhor) && n.length > melhor.length)
      ) {
        melhor = n;
      }
    }
    if (!melhor) continue;
    achados.push({
      resposta: r,
      frase: melhor,
      especificidade: esp.nivel,
      serviria: r.status === "aprovada",
    });
  }
  const rank = (s: StatusDaResposta) => (s === "aprovada" ? 0 : s === "rascunho" ? 1 : 2);
  return achados.sort(
    (a, b) =>
      rank(a.resposta.status) - rank(b.resposta.status) ||
      b.especificidade - a.especificidade ||
      palavras(b.frase) - palavras(a.frase) ||
      b.frase.length - a.frase.length ||
      b.resposta.contagem_ocorrencias - a.resposta.contagem_ocorrencias ||
      a.resposta.tema.localeCompare(b.resposta.tema),
  );
}

/** A resposta aprovada que serviria, ou nada. Nunca devolve rascunho. */
export function respostaQueServiria(
  pergunta: string,
  respostas: readonly RespostaDaBase[],
  ctx: ContextoDoEnsaio,
): Casamento | null {
  return casamentosDaPergunta(pergunta, respostas, ctx).find((c) => c.serviria) ?? null;
}

/**
 * Separa o resultado do ensaio em três: a que serviria, as APROVADAS que também
 * casam e perderam no desempate, e as que ainda não servem (rascunho e
 * arquivada). Aprovada que perdeu não está esperando aprovação: tratá-la como
 * "não serve até ser aprovada" seria dizer ao dono uma coisa falsa.
 */
export function separarOsOutros(achados: readonly Casamento[]): {
  serve: Casamento | null;
  perderamNoDesempate: Casamento[];
  aindaNaoServem: Casamento[];
} {
  const serve = achados.find((a) => a.serviria) ?? null;
  const resto = achados.filter((a) => a !== serve);
  return {
    serve,
    perderamNoDesempate: resto.filter((a) => a.resposta.status === "aprovada"),
    aindaNaoServem: resto.filter((a) => a.resposta.status !== "aprovada"),
  };
}
