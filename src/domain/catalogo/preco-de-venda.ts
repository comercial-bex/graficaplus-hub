import { fatorDaUnidade, type Modalidade, type UnidadeDePreco } from "@/domain/catalogo/modalidades";

/**
 * O preço de venda de um item de catálogo de fornecedor.
 *
 * DECISÃO DO DONO (05/10/2026): o preço da tabela do fornecedor é CUSTO. O
 * preço de venda sai de uma regra definida na tela — margem sobre o custo,
 * frete por peça e arredondamento para cima — com exceção por seção e por item.
 * Sem regra o item é "sob consulta": nunca R$ 0,00, nunca o custo.
 *
 * A conta que vale é a do banco (`fornecedor_preco_venda` e
 * `fornecedor_precos_interno`). Esta é o ESPELHO dela, para a tela mostrar o
 * preço enquanto a pessoa digita a margem, antes de pedir a prévia ao banco.
 * `tests/catalogo-dominio.test.ts` usa os mesmos números do ensaio do banco.
 */

export const ARREDONDAMENTOS = [0, 0.05, 0.1, 0.5, 1] as const;
export type Arredondamento = (typeof ARREDONDAMENTOS)[number];

export const ROTULO_DO_ARREDONDAMENTO: Record<Arredondamento, string> = {
  0: "No centavo",
  0.05: "Para cima, de R$ 0,05 em R$ 0,05",
  0.1: "Para cima, de R$ 0,10 em R$ 0,10",
  0.5: "Para cima, de R$ 0,50 em R$ 0,50",
  1: "Para cima, no real inteiro",
};

export function ehArredondamento(valor: unknown): valor is Arredondamento {
  return typeof valor === "number" && (ARREDONDAMENTOS as readonly number[]).includes(valor);
}

/**
 * Arredondamento decimal como o do Postgres (`round(x, n)`, metade para longe
 * do zero). `Math.round(1.005 * 100)` dá 100 — o float guarda 100,4999… —, e o
 * centavo sairia diferente do banco. Deslocar o expoente pelo TEXTO do número
 * evita a multiplicação que erra.
 */
export function arredondar(valor: number, casas: number): number {
  if (!Number.isFinite(valor)) return valor;
  const sinal = valor < 0 ? -1 : 1;
  const [mantissa, expoente] = String(Math.abs(valor)).split("e");
  const deslocado = Math.round(Number(`${mantissa}e${Number(expoente ?? 0) + casas}`));
  const [m2, e2] = String(deslocado).split("e");
  return sinal * Number(`${m2}e${Number(e2 ?? 0) - casas}`);
}

export type EntradaDoPreco = {
  custo: number | null;
  margemPct: number | null;
  fretePorPeca: number | null;
  /** Peças que o preço cobre (cento = 100). */
  fator: number;
  arredondamento: number | null;
  precoFixo: number | null;
};

/**
 * Espelho de `fornecedor_preco_venda()`:
 *   preço fixo  → ele mesmo
 *   sem custo   → null (sob consulta)
 *   sem margem  → null (sob consulta)
 *   senão       → (custo + frete por peça × peças da unidade) × (1 + margem),
 *                 arredondado PARA CIMA no passo do catálogo (ou no centavo)
 */
export function precoDeVenda(e: EntradaDoPreco): number | null {
  if (e.precoFixo != null) return arredondar(e.precoFixo, 2);
  if (e.custo == null || e.margemPct == null) return null;
  const base = (e.custo + (e.fretePorPeca ?? 0) * (e.fator || 1)) * (1 + e.margemPct / 100);
  const passo = e.arredondamento && e.arredondamento > 0 ? e.arredondamento : 0.01;
  // O banco arredonda a divisão em 6 casas antes do teto: 31,20 ÷ 0,10 é 312 e
  // não pode virar 313 por um resto de conta.
  return arredondar(Math.ceil(arredondar(base / passo, 6)) * passo, 2);
}

/** Por que o item está "sob consulta" — os mesmos motivos do banco. */
export type MotivoSobConsulta = "fora_da_tabela" | "em_duvida" | "sem_custo" | "sem_regra";

export const MOTIVO_SOB_CONSULTA: Record<MotivoSobConsulta, string> = {
  fora_da_tabela: "Saiu da tabela do fornecedor",
  em_duvida: "Unidade do preço em dúvida com o fornecedor",
  sem_custo: "A tabela não traz custo para esta opção",
  sem_regra: "O catálogo ainda não tem regra de venda",
};

/** De onde veio o preço — a equipe precisa saber se é a regra geral ou uma exceção. */
export type OrigemDoPreco = "preco_fixo" | "item" | "secao" | "catalogo";

export const ORIGEM_DO_PRECO: Record<OrigemDoPreco, string> = {
  preco_fixo: "preço fixo do item",
  item: "margem própria do item",
  secao: "margem da seção",
  catalogo: "margem do catálogo",
};

/** A regra como a tela guarda e manda ao banco (`fornecedor_normalizar_regras`). */
export type RegrasDeVenda = {
  catalogo: { margem_pct?: number; frete_por_peca?: number; arredondamento?: number };
  secoes: Record<string, { margem_pct?: number; frete_por_peca?: number }>;
  itens: Record<
    string,
    { margem_pct?: number; frete_por_peca?: number; precos_fixos?: Partial<Record<Modalidade, number>> }
  >;
};

export const REGRAS_VAZIAS: RegrasDeVenda = { catalogo: {}, secoes: {}, itens: {} };

export type LinhaParaPrecificar = {
  itemId: string;
  secaoId: string | null;
  situacao: "ativo" | "fora_da_tabela";
  emDuvida: boolean;
  unidade: UnidadeDePreco;
  modalidade: Modalidade;
  custo: number | null;
};

export type PrecoCalculado = {
  preco: number | null;
  motivo: MotivoSobConsulta | null;
  origem: OrigemDoPreco | null;
};

/**
 * Espelho de UMA linha de `fornecedor_precos_interno()`:
 * preço fixo do item > margem do item > da seção > do catálogo; frete do item >
 * da seção > do catálogo > zero; arredondamento sempre o do catálogo.
 */
export function calcularPreco(linha: LinhaParaPrecificar, regras: RegrasDeVenda): PrecoCalculado {
  const doItem = regras.itens[linha.itemId];
  const daSecao = linha.secaoId ? regras.secoes[linha.secaoId] : undefined;
  const doCatalogo = regras.catalogo;
  const fixo = doItem?.precos_fixos?.[linha.modalidade] ?? null;

  if (linha.situacao === "fora_da_tabela") return { preco: null, motivo: "fora_da_tabela", origem: null };
  if (linha.emDuvida) return { preco: null, motivo: "em_duvida", origem: null };
  if (fixo == null && linha.custo == null) return { preco: null, motivo: "sem_custo", origem: null };

  const margem = doItem?.margem_pct ?? daSecao?.margem_pct ?? doCatalogo.margem_pct ?? null;
  if (fixo == null && margem == null) return { preco: null, motivo: "sem_regra", origem: null };

  const preco = precoDeVenda({
    custo: linha.custo,
    margemPct: margem,
    fretePorPeca: doItem?.frete_por_peca ?? daSecao?.frete_por_peca ?? doCatalogo.frete_por_peca ?? 0,
    fator: fatorDaUnidade(linha.unidade),
    arredondamento: doCatalogo.arredondamento ?? null,
    precoFixo: fixo,
  });
  const origem: OrigemDoPreco =
    fixo != null
      ? "preco_fixo"
      : doItem?.margem_pct != null
        ? "item"
        : daSecao?.margem_pct != null
          ? "secao"
          : "catalogo";
  return { preco, motivo: null, origem };
}

/** O que entra no orçamento: o preço do cento vira preço da peça. */
export function precoDaPeca(preco: number, unidade: UnidadeDePreco): number {
  return arredondar(preco / fatorDaUnidade(unidade), 4);
}

const REAL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * R$ com centavos; custo de 3 ou 4 casas (R$ 0,072 da argola) aparece inteiro —
 * cortar em R$ 0,07 esconderia 3% do custo de quem compra milheiro.
 */
export function emReais(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return "—";
  const casas =
    Math.abs(arredondar(valor, 2) - valor) < 1e-9
      ? 2
      : Math.abs(arredondar(valor, 3) - valor) < 1e-9
        ? 3
        : 4;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(valor);
}

/** R$ sempre com 2 casas — o preço que vai ao cliente. */
export function precoEmReais(valor: number): string {
  return REAL.format(valor);
}
