/**
 * Cada máquina com o seu ícone e a sua cor.
 *
 * O quadro não divide coluna por máquina — cinco colunas por etapa já é o
 * limite do que se lê num olhar, e dividir a Produção em cinco daria dez. O
 * caminho da peça é dito DENTRO do cartão, e é dito por ícone e cor, que se
 * reconhecem sem ler.
 *
 * DE ONDE VEM A MÁQUINA
 * De dois lugares, nesta ordem:
 *
 *   1. `maquinas.tipo` da OS — a máquina de verdade, quando alguém escolheu.
 *   2. o status da OS (`em_impressao`, `em_corte`, ...) — o caminho, quando
 *      ninguém escolheu ainda.
 *
 * O segundo não é luxo: conferido no banco em 09/09/2026, as duas OS abertas
 * têm `maquina_id` NULO. Se a identidade dependesse só do vínculo, o cartão
 * não mostraria máquina nenhuma justamente enquanto ela é decidida.
 *
 * `em_laser_cnc` é AMBÍGUO: a casa tem dois lasers (CO2 e Fiber) e o status não
 * diz qual. Nesse caso o cartão mostra "Laser" genérico em vez de escolher um.
 * Chutar seria o mesmo erro de gravar vínculo arbitrário — parece informação e
 * é palpite.
 *
 * CORES
 * Vêm da paleta de gráficos que já existe (--chart-1..5), menos o violeta: o
 * #7c5cff original dá 4,26 de contraste sobre o cartão escuro (#12131a) e
 * reprova no mínimo de 4,5 para texto pequeno. Clareado para #9980ff dá 6,07.
 */

export type IdentidadeMaquina = {
  /** chave estável — o `tipo` da tabela `maquinas`, ou o caminho do status */
  chave: string;
  /** nome curto, do tamanho que cabe num cartão */
  curto: string;
  /** nome do ícone lucide-react — a tela resolve o componente */
  icone: "Printer" | "Scissors" | "Zap" | "Crosshair" | "Cuboid" | "Sun" | "Factory";
  /** cor em hex, já conferida contra o fundo escuro */
  cor: string;
  /** ressalva quando existe */
  observacao?: string;
};

const DESCONHECIDA: IdentidadeMaquina = {
  chave: "desconhecida",
  curto: "Máquina",
  icone: "Factory",
  cor: "#8b94a7",
};

/**
 * Os cinco tipos conferidos na tabela `maquinas` em 09/09/2026. `tipo` é coluna
 * de TEXTO LIVRE, não enum — então tipo novo não quebra a tela, cai no genérico
 * e continua legível. O teste avisa se algum dos cinco sair daqui.
 */
export const POR_TIPO: Record<string, IdentidadeMaquina> = {
  plotter_impressao: {
    chave: "plotter_impressao",
    curto: "Impressão",
    icone: "Printer",
    cor: "#00d3f2", // chart-1
  },
  plotter_recorte: {
    chave: "plotter_recorte",
    curto: "Recorte",
    icone: "Scissors",
    cor: "#ff2d9b", // chart-2
  },
  laser_co2: {
    chave: "laser_co2",
    curto: "Laser CO2",
    icone: "Zap",
    cor: "#f5d90a", // chart-3
  },
  laser_fiber: {
    chave: "laser_fiber",
    curto: "Fiber",
    icone: "Crosshair",
    cor: "#4ade80", // chart-5
  },
  impressora_3d: {
    chave: "impressora_3d",
    curto: "3D",
    icone: "Cuboid",
    cor: "#9980ff", // chart-4 clareado para passar no contraste
  },
};

/**
 * O caminho que o status indica, quando não há máquina vinculada.
 *
 * `em_laser_cnc` aponta para uma identidade genérica de propósito — ver a nota
 * sobre ambiguidade no topo.
 */
const POR_STATUS: Record<string, IdentidadeMaquina> = {
  em_impressao: POR_TIPO.plotter_impressao,
  em_corte: POR_TIPO.plotter_recorte,
  em_3d: POR_TIPO.impressora_3d,
  em_laser_cnc: {
    chave: "laser",
    curto: "Laser",
    icone: "Zap",
    cor: "#f5d90a",
    observacao: "a casa tem dois lasers (CO2 e Fiber) — o status não diz qual",
  },
  em_uv: {
    chave: "uv",
    curto: "UV",
    icone: "Sun",
    // Cinza de propósito: não é uma das nossas. Pintar de cor de máquina
    // sugeriria um equipamento que a casa não tem.
    cor: "#8b94a7",
    observacao: "a casa não tem máquina UV — este caminho é serviço de terceiro",
  },
};

/**
 * A identidade a mostrar no cartão. Devolve null quando não há máquina nem
 * caminho — uma OS em briefing não passou por máquina nenhuma, e inventar um
 * ícone ali seria ruído.
 */
export function identidadeDaMaquina(os: {
  maquinas?: { tipo?: string | null; nome?: string | null } | null;
  status?: string | null;
}): IdentidadeMaquina | null {
  const tipo = os.maquinas?.tipo;
  if (tipo && POR_TIPO[tipo]) return POR_TIPO[tipo];
  // Máquina vinculada com tipo que não conhecemos: mostra o genérico com o
  // nome dela. Some da tela seria pior — a OS está numa máquina de verdade.
  if (os.maquinas?.nome) {
    return { ...DESCONHECIDA, curto: os.maquinas.nome };
  }
  return os.status ? (POR_STATUS[os.status] ?? null) : null;
}

/**
 * O status já diz qual é o caminho de máquina?
 *
 * Serve para o cartão não falar duas vezes: com o selo colorido ao lado,
 * "Laser / CNC · Laser CO2" e "Impressão · Impressão" são a mesma informação
 * repetida, e o selo é o mais específico dos dois. Já "Em produção · Fiber"
 * soma — o status diz o estágio genérico e o selo diz a máquina.
 */
export function statusIndicaMaquina(status: string | null | undefined): boolean {
  return Boolean(status && POR_STATUS[status]);
}

/** Só para a legenda do quadro: as cinco máquinas, na ordem do fluxo. */
export function legendaDeMaquinas(): IdentidadeMaquina[] {
  return [
    POR_TIPO.plotter_impressao,
    POR_TIPO.plotter_recorte,
    POR_TIPO.laser_co2,
    POR_TIPO.laser_fiber,
    POR_TIPO.impressora_3d,
  ];
}
