import type { ItemDoBalcao, OpcoesDoPedido } from "./simulador-de-balcao";

/**
 * Os cenários de balcão: o que um cliente (ou um parceiro) pode pedir e que
 * costuma dar problema. Letras como o dono usou: A, B, C, D, Y e Z são produtos
 * da tabela de terceirizados.
 *
 *   A = Adesivo PROMO            D = Banner
 *   B = Adesivo TOP              Y = Lona Backlight
 *   C = Lona PROMO               Z = Adesivo perfurado TOP
 */

export type Cenario = {
  id: string;
  titulo: string;
  /** o problema que este cenário procura */
  procura: string;
  itens: ItemDoBalcao[];
  opcoes?: OpcoesDoPedido;
};

const A = "adesivo_promo";
const B = "adesivo_top";
const C = "lona_promo";
const D = "banner";
const Y = "lona_backlight";
const Z = "perfurado_top";

export const CENARIOS: Cenario[] = [
  { id: "S01", titulo: "A sozinho — 10 adesivos de 50×50 cm", procura: "preço PROMO e material em estoque", itens: [{ produto: A, larguraM: 0.5, alturaM: 0.5, quantidade: 10 }] },
  { id: "S02", titulo: "B sozinho — 1 adesivo de 1,0×0,8 m", procura: "preço TOP e falta de vinil", itens: [{ produto: B, larguraM: 1, alturaM: 0.8, quantidade: 1 }] },
  { id: "S03", titulo: "C sozinho — lona de 3×1 m", procura: "estoque de lona 280 g e ilhós", itens: [{ produto: C, larguraM: 3, alturaM: 1, quantidade: 1 }] },
  {
    id: "S04",
    titulo: "A + B + C juntos",
    procura: "soma de preço, tempo e consumo de material por produto",
    itens: [
      { produto: A, larguraM: 0.5, alturaM: 0.5, quantidade: 10 },
      { produto: B, larguraM: 1, alturaM: 0.8, quantidade: 1 },
      { produto: C, larguraM: 3, alturaM: 1, quantidade: 1 },
    ],
  },
  {
    id: "S05",
    titulo: "C e D — lona e banner",
    procura: "duas linhas de lona 280 g disputando o mesmo estoque",
    itens: [
      { produto: C, larguraM: 3, alturaM: 1, quantidade: 1 },
      { produto: D, larguraM: 0.9, alturaM: 1.2, quantidade: 2 },
    ],
  },
  {
    id: "S06",
    titulo: "D e C — os mesmos itens, em outra ordem",
    procura: "a ordem das linhas não pode mudar preço nem tempo",
    itens: [
      { produto: D, larguraM: 0.9, alturaM: 1.2, quantidade: 2 },
      { produto: C, larguraM: 3, alturaM: 1, quantidade: 1 },
    ],
  },
  {
    id: "S07",
    titulo: "Y e Z — backlight e perfurado",
    procura: "material que nem está cadastrado e vinil sem estoque",
    itens: [
      { produto: Y, larguraM: 2, alturaM: 1, quantidade: 1 },
      { produto: Z, larguraM: 1, alturaM: 0.5, quantidade: 4 },
    ],
  },
  { id: "S08a", titulo: "Limiar: B com exatamente 6,00 m²", procura: "'acima de 6 m²' é maior que 6, não maior ou igual", itens: [{ produto: B, larguraM: 3, alturaM: 2, quantidade: 1 }] },
  { id: "S08b", titulo: "Limiar: B com 6,02 m²", procura: "o degrau de preço no centavo depois do limiar", itens: [{ produto: B, larguraM: 3.01, alturaM: 2, quantidade: 1 }] },
  {
    id: "S09a",
    titulo: "B em duas linhas de 4 m², limiar POR LINHA",
    procura: "o mesmo pedido muda de preço conforme a regra dos 6 m²",
    itens: [
      { produto: B, larguraM: 2, alturaM: 2, quantidade: 1 },
      { produto: B, larguraM: 2, alturaM: 2, quantidade: 1 },
    ],
    opcoes: { limiarPor: "linha" },
  },
  {
    id: "S09b",
    titulo: "B em duas linhas de 4 m², limiar POR PRODUTO",
    procura: "mesma coisa, somando as linhas do mesmo produto (8 m²)",
    itens: [
      { produto: B, larguraM: 2, alturaM: 2, quantidade: 1 },
      { produto: B, larguraM: 2, alturaM: 2, quantidade: 1 },
    ],
    opcoes: { limiarPor: "produto" },
  },
  { id: "S10", titulo: "Adesivo + recorte simples — 2×0,5 m", procura: "recorte e decapagem em peça grande e cheia", itens: [{ produto: "adesivo_recorte", larguraM: 2, alturaM: 0.5, quantidade: 1, complexidade: "simples" }] },
  { id: "S11", titulo: "Adesivo + recorte detalhado — 500 etiquetas de 4×4 cm", procura: "mão de obra de decapagem manda no tempo (peça pequena custa por peça, não por m²)", itens: [{ produto: "adesivo_recorte", larguraM: 0.04, alturaM: 0.04, quantidade: 500, complexidade: "detalhada" }] },
  { id: "S12", titulo: "Lona TOP de fachada — 8×1,5 m (12 m²)", procura: "preço acima de 6 m² e bainha com ilhós", itens: [{ produto: "lona_top", larguraM: 8, alturaM: 1.5, quantidade: 1 }] },
  { id: "S13", titulo: "Lona TOP gigante — 12×3 m (36 m²)", procura: "estoque de 44 m² e emenda (3 m passa da boca de 1,8 m)", itens: [{ produto: "lona_top", larguraM: 12, alturaM: 3, quantidade: 1 }] },
  { id: "S14a", titulo: "B de 1,2×0,9 m — cabe girado no rolo de 1,06 m?", procura: "rolo de vinil mais estreito que a boca da plotter", itens: [{ produto: B, larguraM: 1.2, alturaM: 0.9, quantidade: 1 }] },
  { id: "S14b", titulo: "B de 1,5×1,5 m — passa da largura do rolo?", procura: "peça que não cabe em lado nenhum", itens: [{ produto: B, larguraM: 1.5, alturaM: 1.5, quantidade: 1 }] },
  { id: "S15", titulo: "Banner pequeno — 0,3×0,4 m", procura: "área mínima de 1 m² do cadastro × tabela sem mínimo", itens: [{ produto: D, larguraM: 0.3, alturaM: 0.4, quantidade: 1 }] },
  {
    id: "S16",
    titulo: "Pedido com 10 linhas diferentes de adesivo e lona",
    procura: "preparo por linha e conferência somam tempo de mão de obra",
    itens: [
      ...Array.from({ length: 6 }, (_, i) => ({ produto: i % 2 === 0 ? A : B, larguraM: 0.3 + i * 0.05, alturaM: 0.2, quantidade: 5 })),
      { produto: C, larguraM: 2, alturaM: 1, quantidade: 1 },
      { produto: D, larguraM: 0.8, alturaM: 1.2, quantidade: 1 },
      { produto: "adesivo_transparente", larguraM: 0.4, alturaM: 0.4, quantidade: 3 },
      { produto: "adesivo_fosco", larguraM: 0.4, alturaM: 0.4, quantidade: 3 },
    ],
  },
  { id: "S17", titulo: "500 adesivos A de 10×10 cm", procura: "aproveitamento do rolo em peça pequena e avanço", itens: [{ produto: A, larguraM: 0.1, alturaM: 0.1, quantidade: 500 }] },
  {
    id: "S18",
    titulo: "A + B + C em EXPRESSO",
    procura: "taxa de 12% sobre os produtos e o que impede o expresso",
    itens: [
      { produto: A, larguraM: 0.5, alturaM: 0.5, quantidade: 10 },
      { produto: B, larguraM: 1, alturaM: 0.8, quantidade: 1 },
      { produto: C, larguraM: 3, alturaM: 1, quantidade: 1 },
    ],
    opcoes: { prazo: "expresso" },
  },
  { id: "S19", titulo: "Lona TOP de 40 m² em EXPRESSO", procura: "pedido grande estoura a janela de 6 horas", itens: [{ produto: "lona_top", larguraM: 20, alturaM: 2, quantidade: 1 }], opcoes: { prazo: "expresso" } },
  { id: "S20", titulo: "Pedido pequeno em EXPRESSO com 5 h 40 min de fila", procura: "a fila na frente come a janela", itens: [{ produto: "lona_top", larguraM: 2, alturaM: 1, quantidade: 1 }], opcoes: { prazo: "expresso", filaMin: 340 } },
  {
    id: "S21",
    titulo: "Lona TOP + adesivo com recorte, em EXPRESSO",
    procura: "duas máquinas e mão de obra, em sequência",
    itens: [
      { produto: "lona_top", larguraM: 3, alturaM: 1, quantidade: 1 },
      { produto: "adesivo_recorte", larguraM: 1, alturaM: 0.5, quantidade: 2, complexidade: "media" },
    ],
    opcoes: { prazo: "expresso" },
  },
  { id: "S22", titulo: "Lona fosca e backlight em EXPRESSO", procura: "material que o sistema nem conhece", itens: [{ produto: "lona_fosca", larguraM: 2, alturaM: 1, quantidade: 1 }, { produto: Y, larguraM: 1, alturaM: 1, quantidade: 1 }], opcoes: { prazo: "expresso" } },
  { id: "S23", titulo: "Lona TOP 3×1 m sem acabamento", procura: "sem bainha nem ilhós a mão de obra some", itens: [{ produto: "lona_top", larguraM: 3, alturaM: 1, quantidade: 1, acabamento: "nenhum" }] },
  { id: "S24", titulo: "Duas lonas PROMO (3×1 m cada) — estoque de 3,05 m²", procura: "o estoque de lona 280 g já está no fim", itens: [{ produto: C, larguraM: 3, alturaM: 1, quantidade: 2 }] },
];
