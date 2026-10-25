/**
 * Acabamento: o que se faz DEPOIS de produzir a peça (laser, CNC, recorte, manual) e custa
 * máquina, mão de obra e às vezes material. O tempo é guardado POR UNIDADE DA BASE em que o
 * acabamento é cobrado (m², metro linear, peça ou minuto) — a conta do custo está no banco
 * (`custo_do_acabamento`), esta camada só descreve, avisa e sugere preço.
 */

export type Processo = "laser" | "cnc" | "recorte" | "manual" | "outro";
export type BaseDoAcabamento = "m2" | "metro_linear" | "un" | "min";

export const PROCESSOS: ReadonlyArray<{ valor: Processo; rotulo: string; usaMaquina: boolean }> = [
  { valor: "laser", rotulo: "Corte a laser", usaMaquina: true },
  { valor: "cnc", rotulo: "CNC (fresa)", usaMaquina: true },
  { valor: "recorte", rotulo: "Recorte eletrônico", usaMaquina: true },
  { valor: "manual", rotulo: "Manual (mão de obra)", usaMaquina: false },
  { valor: "outro", rotulo: "Outro", usaMaquina: false },
];

export const BASES: ReadonlyArray<{ valor: BaseDoAcabamento; rotulo: string; curto: string }> = [
  { valor: "m2", rotulo: "Por m²", curto: "m²" },
  { valor: "metro_linear", rotulo: "Por metro linear", curto: "m" },
  { valor: "un", rotulo: "Por peça", curto: "un" },
  { valor: "min", rotulo: "Por minuto", curto: "min" },
];

export const rotuloDoProcesso = (p: string) => PROCESSOS.find((x) => x.valor === p)?.rotulo ?? p;
export const rotuloDaBase = (b: string) => BASES.find((x) => x.valor === b)?.rotulo ?? b;
export const unidadeDaBase = (b: string) => BASES.find((x) => x.valor === b)?.curto ?? b;

/**
 * O que NÃO se faz: PVC no laser libera cloro (gás corrosivo e tóxico: destrói a ótica e o
 * tubo e faz mal a quem respira). Devolve o aviso, ou null quando está tudo bem.
 */
export function avisoDeProcesso(processo: string, nomeDoProduto: string): string | null {
  if (processo === "laser" && /\bpvc\b/i.test(nomeDoProduto)) {
    return "PVC não vai no laser: libera cloro. Use CNC ou corte manual.";
  }
  return null;
}

/** Preço que entrega a margem pedida sobre a venda: custo ÷ (1 − margem). */
export function precoPelaMargem(custo: number | null, margemPct: number): number | null {
  if (custo == null || custo <= 0 || !(margemPct >= 0) || margemPct >= 100) return null;
  return Math.round((custo / (1 - margemPct / 100)) * 100) / 100;
}

export type CustoDoAcabamento = {
  acabamento_id: string;
  custo_material: number;
  custo_maquina: number;
  custo_mao_obra: number;
  custo_indireto: number;
  custo_total: number;
  completo: boolean;
  faltas: string[];
  maquina: string | null;
};

/** O banco devolve números como texto em alguns caminhos: normaliza. */
export function lerCusto(bruto: unknown): CustoDoAcabamento | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    acabamento_id: String(b.acabamento_id ?? ""),
    custo_material: n(b.custo_material),
    custo_maquina: n(b.custo_maquina),
    custo_mao_obra: n(b.custo_mao_obra),
    custo_indireto: n(b.custo_indireto),
    custo_total: n(b.custo_total),
    completo: b.completo === true,
    faltas: Array.isArray(b.faltas) ? b.faltas.map(String) : [],
    maquina: typeof b.maquina === "string" ? b.maquina : null,
  };
}

/** Margem de uma venda sobre o custo do acabamento, em %, ou null sem preço/custo. */
export function margemDoAcabamento(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null || preco <= 0) return null;
  return Math.round(((preco - custo) / preco) * 1000) / 10;
}
