/**
 * "Parceiro nunca esquecido": regras puras espelhadas de
 * supabase/migrations/20261116150000_parceiro_nunca_esquecido.sql
 * 20261119120000_parceiro_fechado_sem_contato.sql (chamado fechado sem mensagem),
 * 20261122610000_aviso_de_parceiros_nao_esconde_chamado_fechado.sql (linhas guardadas para os fechados) e
 * 20261122600000_parceiro_reabrir_chamado.sql (reabrir o chamado fechado sem atendimento).
 * O banco decide e envia; aqui só se repete a conta para a tela e para os testes.
 */

export const LIMITE_LINHAS_LEMBRETE = 15;
/**
 * Das 15 linhas do aviso, até 5 ficam guardadas para os chamados fechados sem nenhuma mensagem (o caso mais grave): sem
 * isso, 15 parceiros abertos sem contato gastavam todas as linhas e o fechado caía em "E mais N", escondido.
 */
export const LINHAS_GUARDADAS_PARA_FECHADOS = 5;
export const LINK_PARCEIROS = "https://bexprint.com.br/parceiros";

export type Contato = {
  abertoEm: Date;
  /** Última mensagem de saída digitada por pessoa da equipe (sistema ou celular). */
  ultimaSaidaEquipe: Date | null;
  /** Última mensagem que o parceiro mandou. */
  ultimaEntrada: Date | null;
  /** Quando o atendimento mais recente foi fechado (null = aberto). */
  fechadoEm?: Date | null;
};

/** Chamado fechado sem nenhuma mensagem humana da equipe desde que abriu (nem depois). */
export function fechadoSemContato(c: Contato): boolean {
  if (!c.fechadoEm) return false;
  return !c.ultimaSaidaEquipe || c.ultimaSaidaEquipe < c.abertoEm;
}

/** Desde quando o parceiro espera a equipe; null = está em dia. */
export function desdeSemContato(c: Contato): Date | null {
  const { abertoEm, ultimaSaidaEquipe: saida, ultimaEntrada: entrada } = c;
  if (!saida || saida < abertoEm) return abertoEm;
  if (entrada && entrada > saida) return entrada;
  return null;
}

export function situacaoDoContato(
  c: Contato,
  agora: Date,
  horasLimite: number,
): { semContato: boolean; horas: number | null } {
  const desde = desdeSemContato(c);
  if (!desde) return { semContato: false, horas: null };
  const ms = agora.getTime() - desde.getTime();
  return {
    semContato: fechadoSemContato(c) || ms > horasLimite * 3_600_000,
    horas: Math.floor(ms / 3_600_000),
  };
}

export function reais(v: number): string {
  // Igual ao banco: vírgula decimal, sem separador de milhar.
  const valor = v.toFixed(2).replace(".", ",");
  return "R$ " + valor;
}

/** dd/mm no horário de Macapá (UTC-3, sem horário de verão). */
export function diaMes(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3_600_000);
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export type LinhaSemContato = {
  parceiro_id: string;
  nome: string;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  /** Só no banco (para citar no grupo); a tela não recebe. */
  responsavel_tel?: string | null;
  horas_sem_contato: number | null;
  credito: number;
  credito_vence_em: string | null;
  /** Chamado mais recente fechado sem nenhuma mensagem da equipe (migração 20261119120000). */
  fechado_sem_contato?: boolean;
  fechado_por_nome?: string | null;
  fechado_em?: string | null;
};

export type GrupoDoResponsavel<T extends LinhaSemContato = LinhaSemContato> = {
  responsavel_id: string | null;
  responsavel_nome: string;
  linhas: T[];
};

/** Agrupa por responsável (por nome), e dentro do grupo quem espera há mais tempo primeiro. */
export function agruparPorResponsavel<T extends LinhaSemContato>(
  linhas: T[],
): GrupoDoResponsavel<T>[] {
  const ordenadas = [...linhas].sort(
    (a, b) =>
      (a.responsavel_nome ?? "Sem responsável").localeCompare(
        b.responsavel_nome ?? "Sem responsável",
        "pt-BR",
      ) ||
      (a.responsavel_id ?? "").localeCompare(b.responsavel_id ?? "") ||
      (b.horas_sem_contato ?? 0) - (a.horas_sem_contato ?? 0) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
  const grupos: GrupoDoResponsavel<T>[] = [];
  for (const l of ordenadas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.responsavel_id === l.responsavel_id) ultimo.linhas.push(l);
    else
      grupos.push({
        responsavel_id: l.responsavel_id,
        responsavel_nome: l.responsavel_nome ?? "Sem responsável",
        linhas: [l],
      });
  }
  return grupos;
}

function linhaDoParceiro(l: LinhaSemContato): string {
  const credito =
    l.credito > 0 && l.credito_vence_em
      ? ` · crédito ${reais(l.credito)} até ${diaMes(new Date(l.credito_vence_em))}`
      : "";
  return `- ${l.nome} · ${l.horas_sem_contato ?? 0}h${credito}`;
}

/** A mensagem única do grupo da equipe (mesmo texto que o banco monta). */
export function montarLembreteEquipe(
  linhas: LinhaSemContato[],
  opcoes: { horas: number; telefonesGestor: string[]; limite?: number },
): string {
  const limite = opcoes.limite ?? LIMITE_LINHAS_LEMBRETE;
  const n = linhas.length;
  const abertas = linhas.filter((l) => !l.fechado_sem_contato);
  const fechadas = linhas
    .filter((l) => l.fechado_sem_contato)
    .sort(
      (a, b) =>
        (a.fechado_em ?? "").localeCompare(b.fechado_em ?? "") || a.nome.localeCompare(b.nome, "pt-BR"),
    );
  const partes: string[] = [];
  let usadas = 0;
  // Os abertos usam o que sobra depois de guardar a reserva dos fechados.
  const limiteAbertos = limite - Math.min(fechadas.length, LINHAS_GUARDADAS_PARA_FECHADOS);
  for (const g of agruparPorResponsavel(abertas)) {
    if (usadas >= limiteAbertos) break;
    const tel = g.linhas[0].responsavel_tel;
    partes.push(`${g.responsavel_nome}${tel ? ` @55${tel}` : ""}`);
    for (const l of g.linhas) {
      if (usadas >= limiteAbertos) break;
      partes.push(linhaDoParceiro(l));
      usadas++;
    }
  }
  // Grupos seguintes começam com linha vazia, como no banco.
  const corpo: string[] = [];
  partes.forEach((p, i) => {
    if (i > 0 && !p.startsWith("- ")) corpo.push("");
    corpo.push(p);
  });
  if (fechadas.length && usadas < limite) {
    if (corpo.length) corpo.push("");
    corpo.push("Chamados fechados sem nenhuma mensagem:");
    for (const l of fechadas) {
      if (usadas >= limite) break;
      corpo.push(
        `- ${l.nome} · fechado em ${l.fechado_em ? diaMes(new Date(l.fechado_em)) : ""}`,
      );
      usadas++;
    }
  }
  // O que de fato não coube: o total menos as linhas mostradas.
  if (n > usadas) corpo.push(`E mais ${n - usadas}.`);
  const gestores = [...new Set(opcoes.telefonesGestor.map((t) => `55${t}`))].sort();
  const na = abertas.length;
  const topo =
    na > 0
      ? `${na} ${na === 1 ? "parceiro" : "parceiros"} sem contato da equipe há mais de ${opcoes.horas} horas:`
      : "";
  return (
    `Bom dia! ${topo}\n\n` +
    corpo.join("\n") +
    "\n\n" +
    (gestores.length ? `Gestor ${gestores.map((g) => `@${g}`).join(" ")} acompanhe.\n` : "") +
    `Ver a lista: ${LINK_PARCEIROS}`
  );
}

/**
 * Quem vê o botão "Reabrir chamado" no cartão: só no chamado fechado sem nenhuma mensagem, e só a gerência de parceiros
 * (`parceiros.manage`) ou o responsável do próprio parceiro. A função do banco (`parceiro_reabrir_chamado`) confere de
 * novo: isto só evita mostrar o botão a quem o banco recusaria.
 */
export function podeReabrirChamado(a: {
  fechadoSemContato?: boolean;
  podeGerir: boolean;
  usuarioId: string | null;
  responsavelId: string | null;
}): boolean {
  if (!a.fechadoSemContato) return false;
  if (a.podeGerir) return true;
  return !!a.usuarioId && !!a.responsavelId && a.usuarioId === a.responsavelId;
}

/** O que a tela diz depois de reabrir: o chamado volta a ser "aberto agora" e o prazo do aviso recomeça. */
export function fraseDoChamadoReaberto(numero: string | null, horas: number): string {
  return `${numero ? `Chamado ${numero} reaberto` : "Chamado reaberto"}. O prazo de ${horas} horas recomeça agora: se ninguém falar com o parceiro, ele volta para esta lista.`;
}

export const FRASE_CHAMADO_JA_ABERTO = "Este chamado já está aberto.";

export const MODELO_CREDITO_VENCENDO =
  "Oi, {{nome}}! Seu crédito de {{credito}} na Bex Print vence em {{data}}. Ele vale na sua 1ª compra a partir de {{minimo}} em produtos. Tem algum serviço na mão? É só responder aqui.\n\nPara não receber estes avisos, responda SAIR.";

export function montarLembreteCredito(v: {
  nome: string;
  credito: number;
  venceEm: Date;
  minimo: number;
}): string {
  const vars: Record<string, string> = {
    nome: v.nome.trim().split(/\s+/)[0] ?? "",
    credito: reais(v.credito),
    data: diaMes(v.venceEm),
    minimo: reais(v.minimo),
  };
  return MODELO_CREDITO_VENCENDO.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}
