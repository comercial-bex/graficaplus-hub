/**
 * As etapas da OS — fonte única.
 *
 * Antes desta lista havia QUATRO versões do mesmo conjunto de status, e as
 * quatro divergiam:
 *
 *   enum `status_os` no banco          26 valores — a única que manda de verdade
 *   COLUNAS do Kanban                  25 — faltava `em_producao`, então uma OS
 *                                      nesse status sumia do quadro
 *   lista da tela de detalhe da OS     25 — oferecia `em_design` e `novo`, que
 *                                      NÃO EXISTEM no enum: escolher e salvar
 *                                      devolvia erro de banco
 *   domain/os/workflow.ts              7 — quase todos inválidos; estava órfão,
 *                                      e é por isso que ninguém tinha percebido
 *
 * É o mesmo padrão do RBAC: três listas para a mesma verdade, e o efeito prático
 * é tela que oferece o que o banco recusa. Agora existe uma só, e um teste
 * confere que ela bate com o enum nos dois sentidos.
 *
 * AS CINCO ETAPAS
 * O fluxo clássico de gráfica é entrada → pré-impressão → impressão →
 * acabamento → expedição. Ele vale aqui, mas o miolo é diferente: a Bex não é
 * offset. Não há CTP, não há chapa, não há matriz. O que a pré-impressão faz
 * aqui é fechar arquivo e aprovar arte; o que a "impressão" faz é uma DENTRE
 * várias máquinas.
 *
 * E é essa a diferença que o quadro precisa mostrar: as etapas de produção são
 * PARALELAS, não sequenciais. Um banner passa só pela impressora. Uma placa de
 * acrílico passa só pelo laser. Enfileirar impressão → corte → laser → 3D
 * sugere um caminho que nenhuma peça percorre.
 *
 * ETAPA É COLUNA; STATUS É DETALHE DO CARTÃO
 * Na primeira versão do quadro cada status virou uma coluna: vinte e cinco
 * colunas, depois empilhadas em cinco faixas com rolagem horizontal em cada
 * uma. Não era quadro, era lista deitada — e a literatura de Kanban é direta a
 * respeito: três a cinco colunas, e se não dá para entender num olhar, é
 * complexidade demais.
 *
 * Então a coluna passou a ser a ETAPA (cinco), e o status virou informação
 * DENTRO do cartão, onde ele responde "em qual máquina" sem custar uma coluna
 * vazia na tela. Arrastar entre colunas move para o status de entrada da etapa;
 * refinar o status é escolha no próprio cartão.
 */

export const ETAPAS = [
  "entrada",
  "pre_impressao",
  "producao",
  "acabamento",
  "saida",
  "fora_do_fluxo",
] as const;

export type Etapa = (typeof ETAPAS)[number];

export const ROTULO_ETAPA: Record<Etapa, string> = {
  entrada: "Entrada",
  pre_impressao: "Pré-impressão",
  producao: "Produção",
  acabamento: "Acabamento e qualidade",
  saida: "Saída",
  fora_do_fluxo: "Fora do fluxo",
};

export const DESCRICAO_ETAPA: Record<Etapa, string> = {
  entrada: "Pedido recebido, briefing e arquivos do cliente conferidos.",
  pre_impressao: "Arte fechada e aprovada. Aqui a peça vira arquivo de produção.",
  producao: "A máquina que a peça usa. São caminhos PARALELOS — cada peça passa por um.",
  acabamento: "Corte, dobra, laminação, e a conferência antes de liberar.",
  saida: "Conferido, embalado e entregue ou instalado.",
  fora_do_fluxo: "Parado ou cancelado — não conta como fila.",
};

export type StatusOs = {
  /** valor exato do enum `status_os` — não pode divergir do banco */
  status: string;
  rotulo: string;
  etapa: Etapa;
  setor: string;
  /**
   * Etapa de máquina: caminho paralelo, não passo do fluxo. A peça entra em UMA
   * delas, não em todas.
   */
  paralela?: boolean;
  /** Quando o status existe no banco mas merece ressalva na tela. */
  observacao?: string;
};

export const STATUS: StatusOs[] = [
  { status: "entrada", rotulo: "Entrada", etapa: "entrada", setor: "Atendimento" },
  { status: "aguardando_briefing", rotulo: "Aguardando briefing", etapa: "entrada", setor: "Atendimento" },
  { status: "briefing_ok", rotulo: "Briefing OK", etapa: "entrada", setor: "Atendimento" },

  { status: "design", rotulo: "Design", etapa: "pre_impressao", setor: "Design" },
  { status: "aguardando_aprovacao_arte", rotulo: "Aprovação de arte", etapa: "pre_impressao", setor: "Design" },
  { status: "arte_aprovada", rotulo: "Arte aprovada", etapa: "pre_impressao", setor: "Design" },
  { status: "arte_rejeitada", rotulo: "Arte rejeitada", etapa: "pre_impressao", setor: "Design" },
  { status: "aguardando_producao", rotulo: "Fila de produção", etapa: "pre_impressao", setor: "PCP" },

  // Os cinco caminhos de máquina. Paralelos: a peça entra em um.
  { status: "em_impressao", rotulo: "Impressão", etapa: "producao", setor: "Produção", paralela: true },
  { status: "em_corte", rotulo: "Recorte", etapa: "producao", setor: "Produção", paralela: true },
  { status: "em_laser_cnc", rotulo: "Laser / CNC", etapa: "producao", setor: "Produção", paralela: true },
  { status: "em_3d", rotulo: "Impressão 3D", etapa: "producao", setor: "Produção", paralela: true },
  {
    status: "em_uv",
    rotulo: "UV",
    etapa: "producao",
    setor: "Produção",
    paralela: true,
    observacao: "a casa não tem máquina UV — este caminho é para serviço de terceiro",
  },

  // Dois status para a mesma coisa, herdados do banco. `em_producao` era o que
  // não tinha coluna: OS nele sumia do quadro.
  {
    status: "em_producao",
    rotulo: "Em produção",
    etapa: "producao",
    setor: "Produção",
    observacao: "genérico, quando a máquina não foi especificada",
  },
  {
    status: "producao",
    rotulo: "Produção",
    etapa: "producao",
    setor: "Produção",
    observacao: "duplica 'Em produção' — prefira o específico da máquina",
  },

  { status: "em_acabamento", rotulo: "Acabamento", etapa: "acabamento", setor: "Produção" },
  { status: "controle_qualidade", rotulo: "Controle de qualidade", etapa: "acabamento", setor: "Qualidade" },
  { status: "retrabalho", rotulo: "Retrabalho", etapa: "acabamento", setor: "Qualidade" },

  { status: "aguardando_retirada", rotulo: "Aguardando retirada", etapa: "saida", setor: "Expedição" },
  { status: "aguardando_entrega", rotulo: "Aguardando entrega", etapa: "saida", setor: "Expedição" },
  { status: "em_entrega", rotulo: "Em entrega", etapa: "saida", setor: "Logística" },
  { status: "em_instalacao", rotulo: "Instalação", etapa: "saida", setor: "Instalação" },
  { status: "concluido", rotulo: "Concluído", etapa: "saida", setor: "Finalização" },
  { status: "faturado", rotulo: "Faturado", etapa: "saida", setor: "Financeiro" },

  { status: "pausado", rotulo: "Pausado", etapa: "fora_do_fluxo", setor: "Pendência" },
  { status: "cancelado", rotulo: "Cancelado", etapa: "fora_do_fluxo", setor: "Cancelado" },
];

const PORSTATUS = new Map(STATUS.map((s) => [s.status, s]));

export function statusInfo(status: string | null | undefined): StatusOs | null {
  return status ? PORSTATUS.get(status) ?? null : null;
}

export function rotuloDe(status: string | null | undefined): string {
  return statusInfo(status)?.rotulo ?? status ?? "—";
}

export function setorDe(status: string | null | undefined): string {
  return statusInfo(status)?.setor ?? "—";
}

export function porEtapa(etapa: Etapa): StatusOs[] {
  return STATUS.filter((s) => s.etapa === etapa);
}

/** As etapas na ordem do fluxo, cada uma com os seus status. */
export function fluxo(): { etapa: Etapa; rotulo: string; descricao: string; status: StatusOs[] }[] {
  return ETAPAS.map((etapa) => ({
    etapa,
    rotulo: ROTULO_ETAPA[etapa],
    descricao: DESCRICAO_ETAPA[etapa],
    status: porEtapa(etapa),
  }));
}

/**
 * As colunas do quadro: as cinco etapas do fluxo.
 *
 * `fora_do_fluxo` NÃO é coluna. Uma OS pausada não é um estágio da produção, é
 * uma exceção — vira selo no cartão e filtro, e some do caminho de todo dia.
 */
export const ETAPAS_QUADRO = ETAPAS.filter((e) => e !== "fora_do_fluxo") as Exclude<
  Etapa,
  "fora_do_fluxo"
>[];

export function etapaDe(status: string | null | undefined): Etapa | null {
  return statusInfo(status)?.etapa ?? null;
}

/**
 * O status que a OS assume ao ser solta numa coluna.
 *
 * Arrastar diz a ETAPA; o status exato dentro dela é detalhe que o operador
 * refina no cartão. O padrão é o começo da etapa, porque é onde a peça entra.
 *
 * A saída é a única que olha a própria OS: quem entrega e quem retira esperam
 * coisas diferentes, e a OS já sabe qual é o caso (`precisa_entrega` /
 * `precisa_instalacao`). Chutar "aguardando retirada" para uma OS que vai ser
 * instalada seria inventar um combinado que não existe.
 */
export function statusPadraoDaEtapa(
  etapa: Etapa,
  os?: { precisa_entrega?: boolean | null; precisa_instalacao?: boolean | null } | null,
): string {
  switch (etapa) {
    case "entrada":
      return "entrada";
    case "pre_impressao":
      return "design";
    case "producao":
      return "em_producao";
    case "acabamento":
      return "em_acabamento";
    case "saida":
      if (os?.precisa_instalacao) return "em_instalacao";
      if (os?.precisa_entrega) return "aguardando_entrega";
      return "aguardando_retirada";
    case "fora_do_fluxo":
      return "pausado";
  }
}

/**
 * Quanto do caminho já foi andado, de 0 a 1 — para barra de progresso.
 *
 * `fora_do_fluxo` devolve null e não zero: uma OS pausada não está no começo,
 * está fora da conta. Zero desenharia barra vazia e diria a coisa errada.
 */
export function progressoDaEtapa(status: string | null | undefined): number | null {
  const info = statusInfo(status);
  if (!info || info.etapa === "fora_do_fluxo") return null;
  const ordem = ETAPAS.filter((e) => e !== "fora_do_fluxo");
  const i = ordem.indexOf(info.etapa);
  return i < 0 ? null : (i + 1) / ordem.length;
}
