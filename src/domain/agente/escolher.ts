import { casamentosDaPergunta, type Casamento } from "../agente-base/casar";
import type { RamoDaBase, RespostaDaBase } from "../agente-base/tipos";
import { TEMA_DE_PRECO } from "./tipos";

/**
 * Escolher o CÓDIGO da resposta. Nunca monta texto: devolve uma linha da base, e só se ela está aprovada.
 *
 * Usa o motor de `agente-base/casar.ts` sem mudar uma regra (frase inteira como palavras, resposta de produto vale mais
 * que a de família, que vale mais que a geral, maior frase vence). Acrescenta só o que o agente precisa:
 *  - PERGUNTA DE PREÇO só pode receber a resposta do tema `valor_do_produto` ("a equipe confirma"), mesmo que outra
 *    resposta tenha casado com uma frase maior ("quanto custa a entrega" nunca recebe a resposta da entrega);
 *  - EMPATE exato (mesma especificidade, mesmo número de palavras e mesmo tamanho de frase, em respostas diferentes) não
 *    se resolve por sorteio nem por tema: vai à equipe.
 */

export type Escolha =
  | {
      tipo: "escolhida";
      casamento: Casamento;
      candidatas: number;
      especificidade: 1 | 2 | 3;
      ehPreco: boolean;
    }
  | { tipo: "empate"; candidatas: number; ehPreco: false }
  | { tipo: "sem_resposta"; candidatas: 0; ehPreco: boolean };

function palavras(frase: string): number {
  return frase ? frase.split(" ").length : 0;
}

/** Só serve resposta aprovada, com texto aprovado e que ainda diz o mesmo que o dono leu. */
export function respostaServe(r: RespostaDaBase): boolean {
  return (
    r.status === "aprovada" &&
    typeof r.texto_aprovado === "string" &&
    r.texto_aprovado.trim() !== "" &&
    r.texto_aprovado === r.resposta
  );
}

export function escolherResposta(
  pergunta: string,
  base: readonly RespostaDaBase[],
  ctx: { ramo: RamoDaBase; produtoId?: string | null; familia?: string | null },
  intencaoDePreco: boolean,
): Escolha {
  const servem = base.filter(respostaServe);
  const casados = casamentosDaPergunta(pergunta, servem, ctx).filter((c) => c.serviria);
  const ehPreco = intencaoDePreco || casados.some((c) => c.resposta.tema === TEMA_DE_PRECO);

  if (ehPreco) {
    // a pergunta de preço só pode receber a resposta de preço, case a frase dela ou não
    const dePreco = casados.find((c) => c.resposta.tema === TEMA_DE_PRECO);
    if (dePreco)
      return {
        tipo: "escolhida",
        casamento: dePreco,
        candidatas: casados.length,
        especificidade: dePreco.especificidade,
        ehPreco: true,
      };
    const geral = servem.find(
      (r) => r.tema === TEMA_DE_PRECO && r.ramos.includes(ctx.ramo) && !r.produto_id && !r.familia,
    );
    if (!geral) return { tipo: "sem_resposta", candidatas: 0, ehPreco: true };
    const casamento: Casamento = { resposta: geral, frase: "", especificidade: 1, serviria: true };
    return { tipo: "escolhida", casamento, candidatas: 1, especificidade: 1, ehPreco: true };
  }

  if (casados.length === 0) return { tipo: "sem_resposta", candidatas: 0, ehPreco: false };
  const [primeiro, segundo] = casados;
  if (
    segundo &&
    segundo.resposta.id !== primeiro.resposta.id &&
    segundo.especificidade === primeiro.especificidade &&
    palavras(segundo.frase) === palavras(primeiro.frase) &&
    segundo.frase.length === primeiro.frase.length
  ) {
    return { tipo: "empate", candidatas: casados.length, ehPreco: false };
  }
  return {
    tipo: "escolhida",
    casamento: primeiro,
    candidatas: casados.length,
    especificidade: primeiro.especificidade,
    ehPreco: false,
  };
}
