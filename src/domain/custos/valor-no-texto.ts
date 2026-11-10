/**
 * Valor em reais escrito à mão num campo de texto que a equipe inteira lê (10/11/2026).
 *
 * Observação de produto, observação de acabamento e características de material aparecem para quem não vê
 * custo, e as características de material vão ao gateway de IA na conferência de duplicidade. Em 25/10, 27/10
 * e 03/11 alguém digitou custo ali; em 05/11 a limpeza tirou 20 frases (o original ficou guardado em
 * `custo_em_texto_guardado`, só para quem vê custo). O aviso na tela impede a volta: a mesma marca que o
 * banco usou para achar (`R$`), sem bloquear o salvamento.
 */
const MARCA_DE_REAIS = /R\$/;

export function textoTemValorEmReais(texto: string | null | undefined): boolean {
  return !!texto && MARCA_DE_REAIS.test(texto);
}

/** O que o aviso diz. Fica aqui para a tela e o teste lerem a mesma frase. */
export const AVISO_VALOR_NO_TEXTO =
  "Este texto é lido por toda a equipe. Não escreva valor em reais aqui: o custo vai no campo de custo, que só o financeiro vê.";
