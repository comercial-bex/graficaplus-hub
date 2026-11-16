/**
 * "Parceiro nunca esquecido": regras puras espelhadas de
 * supabase/migrations/20261116150000_parceiro_nunca_esquecido.sql.
 * O banco decide e envia; aqui só se repete a conta para a tela e para os testes.
 */

export const LIMITE_LINHAS_LEMBRETE = 15;
export const LINK_PARCEIROS = "https://bexprint.com.br/parceiros";

export type Contato = {
  abertoEm: Date;
  /** Última mensagem de saída digitada por pessoa da equipe (sistema ou celular). */
  ultimaSaidaEquipe: Date | null;
  /** Última mensagem que o parceiro mandou. */
  ultimaEntrada: Date | null;
};

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
  return { semContato: ms > horasLimite * 3_600_000, horas: Math.floor(ms / 3_600_000) };
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
  const partes: string[] = [];
  let usadas = 0;
  for (const g of agruparPorResponsavel(linhas)) {
    if (usadas >= limite) break;
    const tel = g.linhas[0].responsavel_tel;
    partes.push(`${g.responsavel_nome}${tel ? ` @55${tel}` : ""}`);
    for (const l of g.linhas) {
      if (usadas >= limite) break;
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
  if (n > limite) corpo.push(`E mais ${n - limite}.`);
  const gestores = [...new Set(opcoes.telefonesGestor.map((t) => `55${t}`))].sort();
  return (
    `Bom dia! ${n} ${n === 1 ? "parceiro" : "parceiros"} sem contato da equipe há mais de ${opcoes.horas} horas:\n\n` +
    corpo.join("\n") +
    "\n\n" +
    (gestores.length ? `Gestor ${gestores.map((g) => `@${g}`).join(" ")} acompanhe.\n` : "") +
    `Ver a lista: ${LINK_PARCEIROS}`
  );
}

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
