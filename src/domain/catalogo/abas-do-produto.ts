/**
 * A janela do produto em abas (20/10/2026).
 *
 * Medido antes: uma janela só com 15 campos e a ficha de materiais no fim,
 * rolando por três seções (Identificação, Comercial, Produção). Quem cadastra
 * produto quer uma coisa de cada vez: o que é, quanto custa e quanto cobra, como
 * se faz. Cada aba responde uma dessas perguntas.
 *
 * Máquina padrão e material principal mudaram de lugar: estavam em "Comercial",
 * escondidos de quem não vê o financeiro, mas são da produção e o salvar sempre
 * os gravou para todo mundo. Agora ficam em "Produção e ficha", ao lado da ficha
 * de materiais que eles resumem.
 */

export type AbaDoProduto = "dados" | "preco" | "producao";

export type AbaVisivel = { id: AbaDoProduto; titulo: string };

export function abasDoProduto(a: { canSeeFinancials: boolean }): AbaVisivel[] {
  const abas: AbaVisivel[] = [{ id: "dados", titulo: "Dados" }];
  if (a.canSeeFinancials) {
    abas.push({ id: "preco", titulo: "Preço" });
  }
  abas.push({ id: "producao", titulo: "Produção e ficha" });
  return abas;
}

/**
 * O que a aba da ficha diz quando ainda não dá para montar a ficha. Serviço não
 * consome material; item novo precisa ser salvo antes (a ficha é gravada pelo id).
 */
export function avisoDaFicha(a: { temId: boolean; tipo: "produto" | "servico" }): string | null {
  if (a.tipo === "servico") return "Serviço não tem ficha de materiais.";
  if (!a.temId) return "Salve o item primeiro: a ficha de materiais aparece aqui depois.";
  return null;
}

/** Sinal na aba "Preço": a margem está abaixo do mínimo (vermelho) ou perto (âmbar). */
export function sinalDoPreco(status: "ok" | "alerta" | "ruim" | "vazio"): "ruim" | "alerta" | null {
  if (status === "ruim") return "ruim";
  if (status === "alerta") return "alerta";
  return null;
}
