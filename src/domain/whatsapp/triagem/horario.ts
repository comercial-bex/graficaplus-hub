import type { Feriado, TabelaDeHorario } from "./tipos";

/**
 * Horário de atendimento presencial no fuso de Belém (America/Belem).
 *
 * Espelha em TypeScript a função `whatsapp_dentro_do_horario` do banco (PR B3):
 * dia da semana de 0 (domingo) a 6 (sábado), `abre` inclusive e `fecha`
 * exclusivo, feriado fechado ou com horário próprio.
 */

export const FUSO_DA_TRIAGEM = "America/Belem";

const DIA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function relogioDeBelem(agora: Date | number): {
  diaSemana: number;
  minuto: number;
  data: string;
} {
  const d = agora instanceof Date ? agora : new Date(agora);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_DA_TRIAGEM,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return {
    diaSemana: DIA[v("weekday")] ?? 0,
    minuto: Number(v("hour")) * 60 + Number(v("minute")),
    data: `${v("year")}-${v("month")}-${v("day")}`,
  };
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function dentroDoHorario(agora: Date | number, tabela: TabelaDeHorario): boolean {
  const { diaSemana, minuto, data } = relogioDeBelem(agora);
  const feriado: Feriado | undefined = tabela.feriados?.find((f) => f.data === data);
  if (feriado) {
    if (feriado.fechado) return false;
    if (feriado.abre && feriado.fecha)
      return minuto >= minutos(feriado.abre) && minuto < minutos(feriado.fecha);
  }
  const dia = tabela.semana.find((h) => h.diaSemana === diaSemana);
  if (!dia || !dia.ativo) return false;
  return minuto >= minutos(dia.abre) && minuto < minutos(dia.fecha);
}

function horaEmTexto(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return mm === 0 ? `${hh}h` : `${hh}h${String(mm).padStart(2, "0")}`;
}

const NOME_DO_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "de segunda a sexta", "de segunda a sábado" ou "segunda, quarta e sexta". */
export function diasEmTexto(dias: readonly number[]): string {
  const ordem = [...new Set(dias)].sort((a, b) => a - b);
  if (ordem.length === 0) return "";
  if (ordem.length === 1)
    return `às ${NOME_DO_DIA[ordem[0]]}s`
      .replace("às sábados", "aos sábados")
      .replace("às domingos", "aos domingos");
  const seguidos = ordem.every((d, i) => i === 0 || d === ordem[i - 1] + 1);
  if (seguidos) return `de ${NOME_DO_DIA[ordem[0]]} a ${NOME_DO_DIA[ordem[ordem.length - 1]]}`;
  const nomes = ordem.map((d) => NOME_DO_DIA[d]);
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** As variáveis `abre`, `fecha` e `dias` do texto. Nulo se nenhum dia está ativo. */
export function horarioEmTexto(
  tabela: TabelaDeHorario,
): { abre: string; fecha: string; dias: string } | null {
  const ativos = tabela.semana.filter((h) => h.ativo);
  if (ativos.length === 0) return null;
  const base = ativos.find((h) => h.diaSemana >= 1 && h.diaSemana <= 5) ?? ativos[0];
  return {
    abre: horaEmTexto(base.abre),
    fecha: horaEmTexto(base.fecha),
    dias: diasEmTexto(ativos.map((h) => h.diaSemana)),
  };
}

/** Semente da tabela: segunda a sexta, das 8h às 18h; sábado e domingo inativos até o dono decidir. */
export const HORARIO_SEMENTE: TabelaDeHorario = {
  semana: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    diaSemana: d,
    abre: "08:00",
    fecha: "18:00",
    ativo: d >= 1 && d <= 5,
  })),
  feriados: [],
};
