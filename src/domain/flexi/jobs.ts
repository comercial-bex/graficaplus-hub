/**
 * Jobs do Flexi (a fila do FlexiPRINT) lidos de um print da tela.
 *
 * O Flexi é a fonte do FATO ("esta lona saiu da plotter"), não da OS. Nada aqui
 * cria OS, orçamento ou baixa de estoque: só transforma as linhas lidas em
 * jobs bem formados, com uma chave que não muda se o mesmo job aparecer em dois
 * prints.
 *
 * A CHAVE NÃO USA O NOME. A coluna "Nome do Trabalho" sai cortada no print
 * ("Banner Lona Fina 8("), e o mesmo job num print com a coluna mais larga teria
 * outro nome e viraria um segundo registro. A chave é dia e hora da saída, as
 * duas medidas e as cópias — o Flexi grava a hora em segundos, e jobs
 * diferentes do mesmo segundo (os filhos de um aninhamento) têm medidas
 * diferentes.
 *
 * DATA E HORA vêm sem fuso: são as da máquina, em Macapá (UTC-3, sem horário de
 * verão). Gravar sem o `-03:00` faria o banco, que é UTC, mostrar três horas
 * a menos.
 */

export type StatusFlexi = "concluido" | "abortado" | "mantendo" | "outro";

/** O que a leitura entrega por linha, ainda como texto da tela. */
export type LinhaCrua = {
  nome?: unknown;
  status?: unknown;
  autor?: unknown;
  dimensao?: unknown;
  copias?: unknown;
  tipo?: unknown;
  tamanho?: unknown;
  icc?: unknown;
  cores?: unknown;
  apos_saida?: unknown;
  data?: unknown;
  /** a linha vem recuada sob um "Otimizar Distribuição" (job filho) */
  filho?: unknown;
};

export type JobFlexi = {
  chave: string;
  nome: string;
  status: StatusFlexi;
  autor: string | null;
  larguraCm: number;
  alturaCm: number;
  copias: number;
  areaM2: number;
  tipoArquivo: string | null;
  tamanhoKb: number | null;
  icc: string | null;
  cores: string | null;
  aposSaida: string | null;
  impressoEm: string;
  aninhado: boolean;
  /** chave do job "pai" do aninhamento, quando esta linha é filha */
  paiChave: string | null;
};

export type LinhaRejeitada = { indice: number; motivo: string };

export const LIMITE_DE_LINHAS = 300;

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t === "" ? null : t;
};

/** "1276,3K", "12722,4K", "1.276,3 KB" → KB. */
export function lerTamanhoKb(v: unknown): number | null {
  const t = texto(v, 30);
  if (!t) return null;
  const m = t.match(/^([\d.,]+)\s*([kmg])?b?$/i);
  if (!m) return null;
  const n = lerNumero(m[1]);
  if (n === null) return null;
  const unidade = (m[2] ?? "k").toLowerCase();
  const fator = unidade === "m" ? 1024 : unidade === "g" ? 1024 * 1024 : 1;
  return arred(n * fator, 1);
}

/** Número com vírgula decimal. "120,015" → 120.015. Aceita ponto de milhar. */
export function lerNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = texto(v, 30);
  if (!t) return null;
  let s = t.replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "8,000 x 8,000cm", "120,015 x 80,010cm" → largura e altura em cm. */
export function lerDimensao(v: unknown): { larguraCm: number; alturaCm: number } | null {
  const t = texto(v, 60);
  if (!t) return null;
  const m = t.match(/^([\d.,]+)\s*[x×]\s*([\d.,]+)\s*(cm|mm|m)?$/i);
  if (!m) return null;
  const a = lerNumero(m[1]);
  const b = lerNumero(m[2]);
  if (a === null || b === null) return null;
  const fator =
    (m[3] ?? "cm").toLowerCase() === "mm" ? 0.1 : (m[3] ?? "cm").toLowerCase() === "m" ? 100 : 1;
  const larguraCm = arred(a * fator, 3);
  const alturaCm = arred(b * fator, 3);
  if (larguraCm <= 0 || alturaCm <= 0) return null;
  return { larguraCm, alturaCm };
}

/** "28/09/2026 15:01:56" → "2026-09-28T15:01:56-03:00". Data inexistente → null. */
export function lerDataHora(v: unknown): string | null {
  const t = texto(v, 30);
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [d, mes, ano, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mes < 1 || mes > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (d > diasNoMes) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${p(mes)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}-03:00`;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function lerStatus(v: unknown): StatusFlexi {
  const t = texto(v, 30);
  if (!t) return "outro";
  const s = semAcento(t);
  if (s.startsWith("conclu")) return "concluido";
  if (s.startsWith("abort")) return "abortado";
  if (s.startsWith("mant")) return "mantendo";
  return "outro";
}

function arred(n: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** m² impressos: largura × altura × cópias, em cm → m². */
export function areaM2(larguraCm: number, alturaCm: number, copias: number): number {
  return arred((larguraCm * alturaCm * copias) / 10000, 4);
}

/** Chave estável do job. Ver o cabeçalho: não leva o nome. */
export function chaveDoJob(
  impressoEm: string,
  larguraCm: number,
  alturaCm: number,
  copias: number,
): string {
  return `${impressoEm}|${larguraCm.toFixed(3)}x${alturaCm.toFixed(3)}|${copias}`;
}

function booleano(v: unknown): boolean {
  return (
    v === true || (typeof v === "string" && ["true", "sim", "1"].includes(v.trim().toLowerCase()))
  );
}

/**
 * Transforma as linhas lidas em jobs. Linha sem medida, sem data ou sem cópia
 * válida é REJEITADA com o motivo — nunca "arrumada" com um palpite, porque job
 * errado vira baixa de estoque errada mais adiante.
 */
export function montarJobs(linhas: LinhaCrua[]): {
  jobs: JobFlexi[];
  rejeitadas: LinhaRejeitada[];
} {
  const jobs: JobFlexi[] = [];
  const rejeitadas: LinhaRejeitada[] = [];
  let ultimoPai: string | null = null;

  linhas.slice(0, LIMITE_DE_LINHAS).forEach((l, indice) => {
    const dim = lerDimensao(l.dimensao);
    if (!dim) return void rejeitadas.push({ indice, motivo: "medida ilegível" });
    const impressoEm = lerDataHora(l.data);
    if (!impressoEm) return void rejeitadas.push({ indice, motivo: "data ilegível" });
    const c = lerNumero(l.copias);
    if (c === null || !Number.isInteger(c) || c < 1 || c > 100000) {
      return void rejeitadas.push({ indice, motivo: "cópias inválidas" });
    }
    const filho = booleano(l.filho);
    const chave = chaveDoJob(impressoEm, dim.larguraCm, dim.alturaCm, c);
    jobs.push({
      chave,
      nome: texto(l.nome, 200) ?? "(sem nome)",
      status: lerStatus(l.status),
      autor: texto(l.autor, 60),
      larguraCm: dim.larguraCm,
      alturaCm: dim.alturaCm,
      copias: c,
      areaM2: areaM2(dim.larguraCm, dim.alturaCm, c),
      tipoArquivo: texto(l.tipo, 60),
      tamanhoKb: lerTamanhoKb(l.tamanho),
      icc: texto(l.icc, 80),
      cores: texto(l.cores, 40),
      aposSaida: texto(l.apos_saida, 30),
      impressoEm,
      aninhado: filho,
      paiChave: filho ? ultimoPai : null,
    });
    if (!filho) ultimoPai = chave;
  });

  if (linhas.length > LIMITE_DE_LINHAS) {
    rejeitadas.push({
      indice: LIMITE_DE_LINHAS,
      motivo: `mais de ${LIMITE_DE_LINHAS} linhas: importe em partes`,
    });
  }

  // O mesmo job duas vezes no MESMO print (linha repetida) não vale duas vezes.
  const vistas = new Set<string>();
  const unicos = jobs.filter((j) => (vistas.has(j.chave) ? false : (vistas.add(j.chave), true)));
  return { jobs: unicos, rejeitadas };
}

/** Soma de m² dos jobs concluídos e não aninhados-filhos duplicados. */
export function resumoDosJobs(jobs: JobFlexi[]) {
  const concluidos = jobs.filter((j) => j.status === "concluido");
  return {
    total: jobs.length,
    concluidos: concluidos.length,
    abortados: jobs.filter((j) => j.status === "abortado").length,
    mantendo: jobs.filter((j) => j.status === "mantendo").length,
    // Filho de aninhamento e pai medem a MESMA mídia: contar os dois dobraria.
    // O pai tem a medida da chapa; contar só quem não é filho.
    areaConcluidaM2: arred(
      concluidos.filter((j) => !j.aninhado).reduce((s, j) => s + j.areaM2, 0),
      2,
    ),
  };
}
