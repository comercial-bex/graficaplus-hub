/**
 * O que o motor de automações REALMENTE executa — e nada além disso.
 *
 * Lido no banco VIVO em 02/10/2026, não nas migrações. A diferença importa: a
 * última migração de `enqueue_automacoes` comparava `gatilho = p_gatilho::text`,
 * o banco vivo comparava sem o `::text`, a comparação text = enum não existe, e
 * o handler do fim engolia o erro. O motor devolvia 0 para todo evento desde
 * sempre — e ninguém viu porque havia 0 automações (corrigido na migração
 * 20261002103002).
 *
 * As quatro peças, e de onde cada uma vem:
 *
 *   QUANDO      os gatilhos de tabela (tg_automacao_os_eventos em
 *               ordens_servico, tg_automacao_pagamento_eventos em pagamentos,
 *               tg_automacao_material_eventos em materiais) e a varredura
 *               `criar_eventos_automacoes_recorrentes`, que o processador chama
 *               a cada rodada. Seis gatilhos: o enum `automacao_gatilho`.
 *   CONDIÇÃO    `automacao_condicao_ok` só lê TRÊS chaves: `status` (mudança de
 *               etapa), `estoque_minimo` e `margem_minima`. Qualquer outra chave
 *               é ignorada calada — por isso a tela não oferece outras.
 *   AÇÃO        o processador (supabase/functions/process-automations) só sabe
 *               mandar texto no WhatsApp: acao diferente de 'whatsapp' vira erro
 *               "Ação não suportada".
 *   PARA QUEM   `payload.telefone` (aceita {{ }}), senão o telefone do contexto,
 *               senão a variável AUTOMATION_DEFAULT_PHONE do servidor.
 */

/** Os seis valores do enum `automacao_gatilho`, conferidos no banco em 02/10/2026. */
export const GATILHOS = [
  "status_os_alterado",
  "os_concluida",
  "os_atrasada",
  "pagamento_atrasado",
  "estoque_minimo",
  "margem_abaixo_minimo",
] as const;

export type Gatilho = (typeof GATILHOS)[number];

export function ehGatilho(valor: unknown): valor is Gatilho {
  return typeof valor === "string" && (GATILHOS as readonly string[]).includes(valor);
}

export type Variavel = {
  /** Caminho no contexto que o processador resolve: {{os.numero}}. */
  chave: string;
  rotulo: string;
  /** Só para a prévia da mensagem na tela. */
  exemplo: string;
};

/**
 * O que existe no contexto gravado na fila. Para OS, é `automacao_contexto_os`:
 * a linha da OS inteira em `os`, a do cliente em `cliente`. Data e número saem
 * do jeito que estão no banco (2026-09-09, 150.5) — o processador não formata.
 */
const VAR_OS: Variavel[] = [
  { chave: "os.numero", rotulo: "número da OS", exemplo: "49" },
  { chave: "os.titulo", rotulo: "título da OS", exemplo: "Faixa de lona 3 × 1 m" },
  {
    chave: "os.prazo_entrega",
    rotulo: "prazo de entrega (sai como 2026-09-09)",
    exemplo: "2026-09-09",
  },
  { chave: "cliente.nome", rotulo: "nome do cliente", exemplo: "Maria Silva" },
];

/** O gatilho só acrescenta estas duas quando o STATUS mudou. */
const VAR_MUDANCA: Variavel[] = [
  {
    chave: "status_novo",
    rotulo: "código da etapa nova (ex.: arte_rejeitada)",
    exemplo: "arte_rejeitada",
  },
  {
    chave: "status_anterior",
    rotulo: "código da etapa anterior",
    exemplo: "aguardando_aprovacao_arte",
  },
];

export type InfoGatilho = {
  gatilho: Gatilho;
  rotulo: string;
  /** Quando dispara, nas palavras de quem usa — e sem prometer mais que o motor faz. */
  quando: string;
  /** Do que se fala: entra no resumo "no máximo 1 aviso por OS a cada…". */
  alvo: "OS" | "parcela" | "material";
  /**
   * Situação, não acontecimento: enquanto durar, a varredura volta a enfileirar
   * depois do intervalo mínimo. É aqui que o intervalo decide quantas mensagens
   * a mesma pessoa recebe.
   */
  situacao: boolean;
  /** O contexto tem cliente com telefone (eventos de OS). */
  aceitaCliente: boolean;
  condicao: "status" | "estoque_minimo" | "margem_minima" | null;
  variaveis: Variavel[];
};

export const CATALOGO: Record<Gatilho, InfoGatilho> = {
  status_os_alterado: {
    gatilho: "status_os_alterado",
    rotulo: "A OS muda de etapa",
    quando:
      "Cada vez que a etapa (status) de uma OS muda — pelo Quadro, pela ficha da OS, pela aprovação de arte ou pelo painel do impressor. Escolha as etapas que interessam.",
    alvo: "OS",
    situacao: false,
    aceitaCliente: true,
    condicao: "status",
    variaveis: [...VAR_OS, ...VAR_MUDANCA],
  },
  os_concluida: {
    gatilho: "os_concluida",
    rotulo: "A OS é concluída",
    quando:
      "Quando a OS passa para Concluído: retirada no balcão, entrega confirmada ou Fechar OS.",
    alvo: "OS",
    situacao: false,
    aceitaCliente: true,
    condicao: null,
    variaveis: [...VAR_OS, ...VAR_MUDANCA],
  },
  os_atrasada: {
    gatilho: "os_atrasada",
    rotulo: "A OS passa do prazo",
    quando:
      "Quando o prazo de entrega já passou e a OS não está concluída, faturada nem cancelada. É uma situação: enquanto durar, volta a avisar depois do intervalo mínimo.",
    alvo: "OS",
    situacao: true,
    aceitaCliente: true,
    condicao: null,
    variaveis: VAR_OS,
  },
  pagamento_atrasado: {
    gatilho: "pagamento_atrasado",
    rotulo: "Um pagamento vence sem ser pago",
    quando:
      "Parcela pendente, parcial ou atrasada com vencimento já passado. Também é situação: repete depois do intervalo mínimo até ser paga.",
    alvo: "parcela",
    situacao: true,
    // O motor mandaria para o cliente, mas cobrança automática é decisão do
    // financeiro, não de uma regra: aqui o aviso vai para a equipe.
    aceitaCliente: false,
    condicao: null,
    variaveis: [
      { chave: "pagamento.valor", rotulo: "valor da parcela (sai como 150.5)", exemplo: "150.5" },
      {
        chave: "pagamento.data_vencimento",
        rotulo: "vencimento (sai como 2026-09-30)",
        exemplo: "2026-09-30",
      },
      ...VAR_OS,
    ],
  },
  estoque_minimo: {
    gatilho: "estoque_minimo",
    rotulo: "Um material chega ao estoque mínimo",
    quando:
      "Quando o estoque de um material fica igual ou abaixo do mínimo — o mínimo cadastrado em cada material, ou o número que você informar. Repete depois do intervalo mínimo até ser reposto.",
    alvo: "material",
    situacao: true,
    // Material não tem cliente: sem número fixo o processador cairia no
    // telefone padrão do servidor, que pode nem existir.
    aceitaCliente: false,
    condicao: "estoque_minimo",
    variaveis: [
      { chave: "material.nome", rotulo: "nome do material", exemplo: "Lona 440 g" },
      { chave: "material.estoque", rotulo: "estoque atual", exemplo: "3" },
      { chave: "material.estoque_minimo", rotulo: "mínimo cadastrado", exemplo: "10" },
      { chave: "material.unidade", rotulo: "unidade", exemplo: "m²" },
    ],
  },
  margem_abaixo_minimo: {
    gatilho: "margem_abaixo_minimo",
    rotulo: "A OS fecha com margem baixa",
    quando:
      "Quando a OS é fechada (Fechar OS) e a margem real fica abaixo do limite. A margem é dinheiro: mande só para quem pode ver.",
    alvo: "OS",
    situacao: true,
    aceitaCliente: false,
    condicao: "margem_minima",
    variaveis: [
      ...VAR_OS,
      { chave: "os.margem_real", rotulo: "margem real, em % (sai como 18.5)", exemplo: "18.5" },
    ],
  },
};

export function infoDoGatilho(gatilho: string | null | undefined): InfoGatilho | null {
  return ehGatilho(gatilho) ? CATALOGO[gatilho] : null;
}

/**
 * Destino "cliente da OS".
 *
 * O processador manda `payload.telefone` só com os dígitos, e o Z-API exige o
 * 55 na frente (ver `telefoneParaZapi`). O cadastro guarda o telefone SEM o 55:
 * conferido em 02/10/2026, 6 dos 7 clientes têm 10 ou 11 dígitos e nenhum tem
 * 55. Sem destino explícito o processador usaria `contexto.telefone`, que é o
 * telefone cru do cadastro — e a mensagem iria para um número que o Z-API não
 * entende. `telefone_normalizado` é a coluna gerada por normalize_whatsapp_phone
 * (DDD + número, já com o 9).
 */
export const TELEFONE_DO_CLIENTE = "55{{cliente.telefone_normalizado}}";

/**
 * Etapas em que o cliente JÁ recebe aviso automático (notificacoes_fila +
 * notificacao_templates). Contrato com `marco_notificavel_os`, conferido no
 * banco em 02/10/2026 para os 26 valores do enum. Automação para o cliente
 * nestas etapas manda a segunda mensagem sobre a mesma coisa.
 */
export const ETAPAS_COM_AVISO_AO_CLIENTE = [
  "aguardando_aprovacao_arte",
  "producao",
  "em_producao",
  "em_impressao",
  "em_corte",
  "em_uv",
  "em_laser_cnc",
  "em_3d",
  "aguardando_retirada",
  "em_entrega",
  "concluido",
] as const;

/** Intervalo mínimo entre dois avisos da mesma automação para a mesma OS/parcela/material. */
export const INTERVALOS: { segundos: number; rotulo: string }[] = [
  { segundos: 3600, rotulo: "1 hora" },
  { segundos: 6 * 3600, rotulo: "6 horas" },
  { segundos: 12 * 3600, rotulo: "12 horas" },
  { segundos: 86400, rotulo: "1 dia" },
  { segundos: 3 * 86400, rotulo: "3 dias" },
  { segundos: 7 * 86400, rotulo: "7 dias" },
];

/** `delay_segundos`: o processador só pega a mensagem depois deste tempo. */
export const ESPERAS: { segundos: number; rotulo: string }[] = [
  { segundos: 0, rotulo: "Assim que o processador rodar" },
  { segundos: 300, rotulo: "5 minutos depois" },
  { segundos: 1800, rotulo: "30 minutos depois" },
  { segundos: 3600, rotulo: "1 hora depois" },
];

/** 86400 → "1 dia"; 1800 → "30 min". Serve também para valor gravado fora da lista. */
export function rotuloDeDuracao(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos <= 0) return "na hora";
  if (segundos % 86400 === 0) {
    const d = segundos / 86400;
    return `${d} ${d === 1 ? "dia" : "dias"}`;
  }
  if (segundos % 3600 === 0) {
    const h = segundos / 3600;
    return `${h} ${h === 1 ? "hora" : "horas"}`;
  }
  if (segundos % 60 === 0) return `${segundos / 60} min`;
  return `${segundos} s`;
}
