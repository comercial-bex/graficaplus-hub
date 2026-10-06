/**
 * Como o documento escreve datas, dinheiro e medidas — e a conta das parcelas.
 *
 * Puro (sem banco, sem rede, sem navegador): o mesmo arquivo serve o PDF e os
 * testes, que rodam em dois fusos (UTC e America/Belem) justamente para pegar a
 * data que volta um dia.
 */

import { ehUnidadeDeArea } from "@/domain/orcamentos/area";
import {
  modoDeEntrega,
  ROTULO_DO_MODO,
  textoDoEndereco,
  type CondicaoDePagamento,
  type Parcela,
} from "@/domain/orcamentos/acordo";

/**
 * Fuso da gráfica (Macapá). O documento é dela: "Data de Emissão" é o dia em
 * que o orçamento nasceu LÁ. Formatando no fuso de quem imprime, o mesmo
 * orçamento feito às 22h saía com um dia a mais para quem abrisse de outro
 * fuso — e com outra validade.
 */
export const FUSO_DA_EMPRESA = "America/Belem";

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const UM_DIA = 86_400_000;

/**
 * "aaaa-mm-dd" do valor: coluna `date` passa como está; timestamp vira o dia
 * no fuso da empresa. Inválido ou vazio → null.
 */
export function diaDoValor(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (SO_DATA.test(texto)) return texto;
  const instante = new Date(texto);
  if (Number.isNaN(instante.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DA_EMPRESA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

/**
 * "07/08/2026" de uma coluna `date` ("2026-08-07") ou de um timestamp.
 *
 * Data sem hora NÃO passa por `new Date`: a norma lê "2026-08-07" como meia-
 * noite em UTC, e em Macapá (UTC−3) isso ainda é dia 6 — o PDF prometia a
 * entrega um dia antes do combinado. A string é remontada, e pronto.
 */
export function dataBR(valor: string | null | undefined): string | null {
  const dia = diaDoValor(valor);
  if (!dia) return null;
  const [, ano, mes, d] = SO_DATA.exec(dia) as RegExpExecArray;
  return `${d}/${mes}/${ano}`;
}

/**
 * Soma dias a "aaaa-mm-dd". A conta é feita em UTC e lida em UTC — dia de
 * calendário puro, sem fuso nem horário de verão no meio.
 */
export function somarDias(dia: string, dias: number): string {
  const m = SO_DATA.exec(dia);
  if (!m) return dia;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Math.round(dias) * UM_DIA;
  const r = new Date(t);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${r.getUTCFullYear()}-${dois(r.getUTCMonth() + 1)}-${dois(r.getUTCDate())}`;
}

/** Até quando o preço vale: dia da criação (no fuso da empresa) + validade_dias. */
export function validadeAte(
  criadoEm: string | null | undefined,
  validadeDias: number | null | undefined,
): string | null {
  const dia = diaDoValor(criadoEm);
  if (!dia || validadeDias == null || !Number.isFinite(Number(validadeDias))) return null;
  return somarDias(dia, Number(validadeDias));
}

/* ------------------------------------------------------------------------- */
/* Pagamento                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * As parcelas com a MESMA conta de `converter_orcamento_em_os`: todas
 * `round(total/n, 2)` e a última com a sobra dos centavos, para a soma bater
 * com o total. O documento que o cliente assina e a conta a receber que nasce
 * na conversão não podem discordar em um centavo.
 *
 * A conta é feita em centavos INTEIROS. Em ponto flutuante, `total / n * 100`
 * cai em ...,4999 onde o Postgres vê ...,5 exato: R$ 501,15 em 10x dá 50,11 na
 * conta de float e 50,12 no banco — 1 em cada 116 combinações de total e
 * parcelas diverge assim (medido de R$ 0,01 a R$ 20.000,00, 2 a 12 parcelas).
 * Em centavos inteiros, nenhuma diverge.
 *
 * Com `primeiro_vencimento`, cada parcela vence `intervalo_dias` (padrão 30)
 * depois da anterior. Sem ele a conversão vence a primeira no dia em que vira
 * OS — data que o orçamento ainda não sabe; aqui fica nula e o documento mostra
 * só os valores.
 */
export function parcelasDoAcordo(
  total: number,
  condicao: CondicaoDePagamento | null | undefined,
): Parcela[] {
  const c = condicao ?? {};
  const n = Math.max(1, Math.round(Number(c.parcelas ?? 1) || 1));
  const intervaloLido = Math.round(Number(c.intervalo_dias ?? 30));
  const intervalo = Number.isFinite(intervaloLido) ? Math.max(0, intervaloLido) : 30;
  const centavos = Math.round(Number(total || 0) * 100);
  // round() do Postgres arredonda o meio para longe do zero; para total
  // positivo é o mesmo que Math.round.
  const porParcela = Math.round(centavos / n);
  const ultima = centavos - porParcela * (n - 1);
  const primeiro =
    typeof c.primeiro_vencimento === "string" && SO_DATA.test(c.primeiro_vencimento.trim())
      ? c.primeiro_vencimento.trim()
      : null;
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    valor: (i === n - 1 ? ultima : porParcela) / 100,
    vencimento: primeiro ? somarDias(primeiro, intervalo * i) : null,
  }));
}

/* ------------------------------------------------------------------------- */
/* Entrega                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * O texto da caixa ENDEREÇO: ENTREGA, com a mesma leitura da tela
 * (`modoDeEntrega`). `precisa_entrega` manda: é o que a conversão copia para a
 * OS, e o endereço digitado antes de alguém voltar para "retira" fica guardado
 * sem valer mais.
 */
export function descreverEntrega(o: {
  precisa_entrega?: boolean | null;
  precisa_instalacao?: boolean | null;
  endereco_entrega?: unknown;
}): string {
  const modo = modoDeEntrega(o.precisa_entrega ?? null, o.precisa_instalacao ?? null);
  if (modo === "retira") return ROTULO_DO_MODO.retira;
  const endereco = textoDoEndereco(o.endereco_entrega) || "Endereço de entrega a combinar";
  return modo === "instalacao" ? `${endereco}\nCom instalação` : endereco;
}

/* ------------------------------------------------------------------------- */
/* Números                                                                    */
/* ------------------------------------------------------------------------- */

const numeroBR = (v: number, casas: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** "R$ 1.234,56" — com espaço comum: o PDF usa a fonte padrão, sem o espaço fino do Intl. */
export function dinheiro(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return `R$ ${numeroBR(Number.isFinite(n) ? n : 0, 2)}`;
}

/** "3,000m" — medidas sempre com 3 casas, como no modelo. */
export const metros = (v: number) => `${numeroBR(v, 3)}m`;

/** "22,050m²" */
export const metrosQuadrados = (v: number) => `${numeroBR(v, 3)}m²`;

/** Quantidade sem casas inúteis: "3", "12,6". */
export const quantidadeBR = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Unidade como o documento escreve: área vira "M²" ("m2" é a grafia do catálogo), o resto em maiúsculas. */
export function unidadeNoDocumento(unidade: string | null | undefined): string | null {
  const u = (unidade ?? "").trim();
  if (!u) return null;
  return ehUnidadeDeArea(u) ? "M²" : u.toUpperCase();
}
