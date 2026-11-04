/**
 * O que a tela diz depois de aplicar o preço do orçamento (cliente final ou parceiro), 04/11/2026.
 *
 * Desde o PR 425 o cliente final recebe o preço ESPECIAL do cliente onde ele existe e a tabela nos
 * demais itens; a mensagem continuava "Voltou ao preço de tabela", e o vendedor podia "corrigir" na
 * mão um preço que estava certo. A resposta da função do banco não separa os itens por origem, então
 * o texto descreve a regra sem prometer qual item recebeu qual preço.
 */

export type ModoDePrecoAplicado = "cliente_final" | "parceiro";

export type RespostaDoPrecoAplicado = { itens_repreciados: number; itens_sem_preco: number };

const itens = (n: number) => `${n} ${n === 1 ? "item" : "itens"}`;

export function textoDoPrecoAplicado(modo: ModoDePrecoAplicado, r: RespostaDoPrecoAplicado): string {
  const repreciados = Number(r.itens_repreciados) || 0;
  const semPreco = Number(r.itens_sem_preco) || 0;
  const aviso =
    semPreco > 0
      ? ` ${itens(semPreco)} ${semPreco === 1 ? "ficou" : "ficaram"} como ${semPreco === 1 ? "estava" : "estavam"} (sem produto ou sem ${modo === "parceiro" ? "preço de parceiro" : "preço no catálogo"}).`
      : "";
  return modo === "parceiro"
    ? `Preço de parceiro confirmado em ${itens(repreciados)}.${aviso}`
    : `Preço de cliente final aplicado em ${itens(repreciados)}: o preço especial do cliente onde ele existe, a tabela nos demais.${aviso}`;
}
