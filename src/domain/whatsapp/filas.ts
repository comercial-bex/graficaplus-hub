/**
 * Filas por setor da caixa de entrada (caixa v3, 07/10/2026).
 *
 * No banco a coluna é `whatsapp_conversas.fila` (enum `whatsapp_fila`) e cada
 * pessoa tem as dela em `usuarios.filas`. Aqui o tipo se chama `Setor` porque
 * `Fila` já é o filtro de responsável da lista ("Minhas", "Não atribuídas",
 * "Todas") desde a caixa v2 — os dois conviviam com o mesmo nome e confundiam.
 *
 * O tempo de espera é o de `whatsapp_conversas.aguardando_desde`: o gatilho
 * `_wa_mensagem_antes_inserir` preenche quando o cliente escreve e zera quando
 * alguém responde (pela tela, pelo celular ou pela assistente).
 */

export type Setor = "comercial" | "producao" | "financeiro" | "administrativo";

export type InfoDoSetor = {
  valor: Setor;
  rotulo: string;
  /** Classes de cor discretas: borda, fundo e texto do chip. Só tokens. */
  cor: string;
  /** Só o ponto de cor, para o item da lista. */
  ponto: string;
};

export const SETORES: InfoDoSetor[] = [
  {
    valor: "comercial",
    rotulo: "Comercial",
    cor: "border-status-cyan/30 bg-status-cyan/10 text-status-cyan",
    ponto: "bg-status-cyan",
  },
  {
    valor: "producao",
    rotulo: "Produção",
    cor: "border-status-amber/30 bg-status-amber/10 text-status-amber",
    ponto: "bg-status-amber",
  },
  {
    valor: "financeiro",
    rotulo: "Financeiro",
    cor: "border-positive/30 bg-positive/10 text-positive",
    ponto: "bg-positive",
  },
  {
    valor: "administrativo",
    rotulo: "Administrativo",
    cor: "border-border bg-muted text-muted-foreground",
    ponto: "bg-muted-foreground",
  },
];

const POR_VALOR = new Map(SETORES.map((s) => [s.valor, s]));

export function ehSetor(v: unknown): v is Setor {
  return typeof v === "string" && POR_VALOR.has(v as Setor);
}

export function infoDoSetor(v: string | null | undefined): InfoDoSetor {
  return (v && POR_VALOR.get(v as Setor)) || SETORES[0];
}

export function rotuloDoSetor(v: string | null | undefined): string {
  return v && POR_VALOR.has(v as Setor) ? POR_VALOR.get(v as Setor)!.rotulo : "Sem fila";
}

/**
 * O filtro de setor da lista: as filas da pessoa (padrão), todas, ou uma só.
 * Vem da URL (`/whatsapp?fila=producao`) — o link do menu abre direto nela.
 */
export type FiltroDeSetor = "minhas_filas" | "todas" | Setor;

export function filtroDaUrl(v: unknown): FiltroDeSetor {
  if (v === "todas" || v === "minhas_filas") return v;
  return ehSetor(v) ? v : "minhas_filas";
}

/** Os setores que a consulta deve pedir; `null` = sem filtro de setor. */
export function setoresDoFiltro(filtro: FiltroDeSetor, minhas: Setor[] | null | undefined): Setor[] | null {
  if (filtro === "todas") return null;
  if (filtro === "minhas_filas") {
    // Pessoa sem fila nenhuma cadastrada vê todas: esconder tudo pareceria
    // "ninguém escreveu". O administrador acerta as filas no Monitor.
    const lista = (minhas ?? []).filter(ehSetor);
    return lista.length ? lista : null;
  }
  return [filtro];
}

/* ------------------------------------------------------------------ */
/* Tempo de espera                                                     */
/* ------------------------------------------------------------------ */

export const ESPERA_ATENCAO_MIN = 15;
export const ESPERA_ATRASADA_MIN = 60;

export type NivelDeEspera = "ok" | "atencao" | "atrasada";

export type Espera = { minutos: number; texto: string; nivel: NivelDeEspera };

/** "há 12 min", "há 1 h 05", "há 2 d" — e o nível pela régua 15 / 60 min. */
export function esperaDe(aguardandoDesde: string | null | undefined, agora: Date = new Date()): Espera | null {
  if (!aguardandoDesde) return null;
  const t = new Date(aguardandoDesde).getTime();
  if (Number.isNaN(t)) return null;
  const minutos = Math.max(0, Math.floor((agora.getTime() - t) / 60_000));
  const nivel: NivelDeEspera =
    minutos >= ESPERA_ATRASADA_MIN ? "atrasada" : minutos >= ESPERA_ATENCAO_MIN ? "atencao" : "ok";
  let texto: string;
  if (minutos < 1) texto = "agora";
  else if (minutos < 60) texto = `${minutos} min`;
  else if (minutos < 24 * 60) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    texto = m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  } else texto = `${Math.floor(minutos / (24 * 60))} d`;
  return { minutos, texto, nivel };
}

/** Classes do selo de espera: neutro, âmbar (>15 min) ou vermelho (>60 min). */
export function corDaEspera(nivel: NivelDeEspera): string {
  if (nivel === "atrasada") return "text-destructive";
  if (nivel === "atencao") return "text-status-amber";
  return "text-muted-foreground";
}

/** Ordena a fila humana: quem espera há mais tempo primeiro. */
export function ordenarPorEspera<T extends { aguardando_desde?: string | null }>(lista: T[]): T[] {
  return lista
    .filter((c) => !!c.aguardando_desde)
    .slice()
    .sort((a, b) => String(a.aguardando_desde).localeCompare(String(b.aguardando_desde)));
}

/* ------------------------------------------------------------------ */
/* Atendimentos (WA-AAMM-NNNN)                                         */
/* ------------------------------------------------------------------ */

export type MotivoResolucao = "atendido" | "sem_resposta_necessaria" | "spam" | "duplicado" | "outro";

export const MOTIVOS_DE_RESOLUCAO: { valor: MotivoResolucao; rotulo: string; dica: string }[] = [
  { valor: "atendido", rotulo: "Atendido", dica: "O cliente teve a resposta que precisava." },
  {
    valor: "sem_resposta_necessaria",
    rotulo: "Sem resposta necessária",
    dica: "Agradecimento, figurinha, \"ok\" — nada a responder.",
  },
  { valor: "spam", rotulo: "Spam", dica: "Propaganda ou mensagem automática de empresa." },
  { valor: "duplicado", rotulo: "Duplicado", dica: "O assunto já está em outra conversa." },
  { valor: "outro", rotulo: "Outro", dica: "Explique na nota — ela é obrigatória." },
];

export function rotuloDoMotivo(m: string | null | undefined): string {
  return MOTIVOS_DE_RESOLUCAO.find((x) => x.valor === m)?.rotulo ?? (m ? String(m) : "—");
}

export type AtendimentoResumo = {
  id: string;
  numero: string;
  fila: string;
  aberto_em: string;
  origem_abertura: string;
  responsavel_id: string | null;
  primeira_resposta_em: string | null;
  fechado_em: string | null;
  motivo_resolucao: string | null;
  nota_resolucao: string | null;
};

/** "3 min", "1 h 20", "2 d" entre dois instantes; `null` se faltar um. */
export function duracaoEntre(inicio: string | null | undefined, fim: string | null | undefined): string | null {
  if (!inicio || !fim) return null;
  const e = esperaDe(inicio, new Date(fim));
  return e ? (e.texto === "agora" ? "< 1 min" : e.texto) : null;
}

/**
 * Pode resolver como "Atendido"? Espelha a recusa de `whatsapp_resolver`: se a
 * última mensagem é do cliente, ele ainda espera resposta. A tela avisa antes,
 * o banco recusa de qualquer jeito.
 */
export function atendidoPermitido(
  mensagens: { direcao: string; recebido_em: string | null; enviado_em: string | null; created_at: string }[],
): boolean {
  let ultima: (typeof mensagens)[number] | null = null;
  let quando = "";
  for (const m of mensagens) {
    const q = m.recebido_em ?? m.enviado_em ?? m.created_at;
    if (q >= quando) {
      quando = q;
      ultima = m;
    }
  }
  return !ultima || ultima.direcao !== "entrada";
}
