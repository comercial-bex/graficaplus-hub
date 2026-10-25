/**
 * O material como escolha: produtos que a gráfica vende como variações da mesma impressão
 * (lona brilho ou reforçada, vinil branco ou fosco…) aparecem juntos, em cartões, no item.
 *
 * Quem decide a lista é o nome do produto, escrito como na tabela de terceirizados. Produto que
 * ainda não existe (ou está inativo) simplesmente não aparece: quando for cadastrado e ativado
 * com este nome, o cartão surge sozinho. Escolher um cartão troca o PRODUTO do item, então preço,
 * custo, área mínima e tamanhos vêm do produto escolhido — nenhum preço novo nasce aqui.
 */

export type VarianteDeMaterial = { nome: string; rotulo: string };

export type FamiliaDeMaterial = {
  chave: string;
  titulo: string;
  variantes: readonly VarianteDeMaterial[];
};

export const FAMILIAS_DE_MATERIAL: readonly FamiliaDeMaterial[] = [
  {
    chave: "lona",
    titulo: "Material da lona",
    variantes: [
      { nome: "Lona 280g impressa", rotulo: "Brilho 280 g" },
      { nome: "Lona 440g reforçada impressa", rotulo: "Reforçada 440 g" },
      { nome: "Lona fosca", rotulo: "Fosca" },
      { nome: "Lona backlight", rotulo: "Backlight" },
    ],
  },
  {
    chave: "vinil",
    titulo: "Material do adesivo",
    variantes: [
      { nome: "Adesivo PROMO", rotulo: "Promo" },
      { nome: "Adesivo vinil branco impresso", rotulo: "Branco TOP" },
      { nome: "Adesivo transparente", rotulo: "Transparente" },
      { nome: "Adesivo fosco", rotulo: "Fosco" },
      { nome: "Adesivo blackout", rotulo: "Blackout" },
    ],
  },
  {
    chave: "perfurado",
    titulo: "Adesivo perfurado",
    variantes: [
      { nome: "Adesivo perfurado (one way)", rotulo: "TOP" },
      { nome: "Adesivo perfurado promocional", rotulo: "Promocional" },
    ],
  },
];

const chaveDoNome = (n: string) => n.trim().toLowerCase();

export type OpcaoDeMaterial<T> = { produto: T; rotulo: string; atual: boolean };

/**
 * As variações do material do produto atual que existem no catálogo (ativo), na ordem da família.
 * Menos de duas = não há o que escolher: devolve vazio e a tela não mostra nada.
 */
export function variantesDoMaterial<T extends { nome: string }>(
  nomeAtual: string | null | undefined,
  catalogo: readonly T[],
): { titulo: string; opcoes: OpcaoDeMaterial<T>[] } | null {
  if (!nomeAtual) return null;
  const atual = chaveDoNome(nomeAtual);
  const familia = FAMILIAS_DE_MATERIAL.find((f) =>
    f.variantes.some((v) => chaveDoNome(v.nome) === atual),
  );
  if (!familia) return null;
  const opcoes: OpcaoDeMaterial<T>[] = [];
  for (const v of familia.variantes) {
    const produto = catalogo.find((p) => chaveDoNome(p.nome) === chaveDoNome(v.nome));
    if (produto) opcoes.push({ produto, rotulo: v.rotulo, atual: chaveDoNome(v.nome) === atual });
  }
  return opcoes.length >= 2 ? { titulo: familia.titulo, opcoes } : null;
}
