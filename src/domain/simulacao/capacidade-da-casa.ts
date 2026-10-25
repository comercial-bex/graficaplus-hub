import type { MaterialDaCasa } from "./tabela-terceirizados";

/**
 * O que a casa consegue fazer, para a simulação do balcão. Cada número diz de
 * onde vem: BANCO (lido em 25/10/2026) ou PREMISSA (chute razoável a medir na
 * oficina, no mesmo espírito dos "números de calibração" de `tempo-de-maquina.ts`).
 * Mudou a oficina? Muda aqui, e os cenários mostram o que isso muda.
 */

export const CASA = {
  impressao: {
    // BANCO: Plotter de Impressão i1600 180 — Eco, modo Produção (4 passadas)
    larguraUtilM: 1.8,
    margemLateralM: 0.01,
    m2PorHora: 14,
    setupMin: 0,
    // PREMISSA: o rolo avança antes e depois do trabalho
    avancoM: 0.2,
  },
  recorte: {
    // BANCO: Plotter de Recorte 120 — motor de passo
    larguraUtilM: 1.26,
    mmPorSegundo: 800,
  },
  // BANCO: 2 pessoas com papel de operador ou instalador
  operadores: 2,
  // A tabela promete "produção rápida: entre 3 e 6 horas úteis". Janela do expresso:
  janelaExpressoMin: 360,
  // PREMISSA: quanto de mão de obra, em relógio, o expresso aguenta. Passou disso e o que manda no
  // tempo é gente trabalhando, que não se acelera: o expresso não é oferecido.
  limiteMaoDeObraExpressoMin: 90,
} as const;

/** PREMISSAS de mão de obra, em minutos. */
export const MAO_DE_OBRA = {
  preparoPorLinhaMin: 3,
  bainhaEIlhosPorMetroMin: 3,
  bastaoECordaPorPecaMin: 4,
  conferenciaEEmbalagemPorPedidoMin: 5,
  /** decapar peça pequena custa por PEÇA, não por m²: minutos por peça, por complexidade */
  decapagemPorPecaMin: { simples: 0.05, media: 0.15, detalhada: 0.4 },
  /** peça maior que o rolo vira painéis soldados (lona) ou alinhados (vinil): minutos por metro de emenda */
  emendaLonaPorMetroMin: 4,
  emendaVinilPorMetroMin: 1,
} as const;

export type BobinaDaCasa = {
  nome: string;
  /** BANCO: largura do rolo carregado; nulo = o material nem está cadastrado */
  larguraM: number | null;
  /** BANCO: m² em estoque; nulo = não cadastrado */
  estoqueM2: number | null;
};

export const BOBINAS: Record<MaterialDaCasa, BobinaDaCasa> = {
  vinil_branco: { nome: "Vinil adesivo branco brilho", larguraM: 1.06, estoqueM2: 0 },
  vinil_perfurado: { nome: "Vinil adesivo perfurado", larguraM: 1.06, estoqueM2: 0 },
  vinil_transparente: { nome: "Vinil transparente", larguraM: null, estoqueM2: null },
  vinil_fosco: { nome: "Vinil fosco", larguraM: null, estoqueM2: null },
  vinil_blackout: { nome: "Vinil blackout", larguraM: null, estoqueM2: null },
  lona_280: { nome: "Lona 280g brilho", larguraM: 1.6, estoqueM2: 3.05 },
  lona_440: { nome: "Lona 440g reforçada", larguraM: 1.6, estoqueM2: 44 },
  lona_fosca: { nome: "Lona fosca", larguraM: null, estoqueM2: null },
  lona_backlight: { nome: "Lona backlight", larguraM: null, estoqueM2: null },
};

/** BANCO: o que o acabamento consome e quanto há. */
export const ESTOQUE_DE_ACABAMENTO = {
  ilhosUn: 0,
  ilhosPorMetro: 2,
  bastaoECordaUn: 10,
} as const;
