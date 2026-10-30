/**
 * O "hoje" da casa. O banco roda em UTC e o aparelho de quem usa pode estar em qualquer fuso;
 * `new Date().toISOString().slice(0, 10)` devolve a data de Greenwich, que entre 21h e a meia-noite
 * de Macapá já é amanhã: o pagamento lançado à noite saía com a data do dia seguinte e o painel
 * contava como atrasado o que vencia no dia seguinte. Estas funções dão a data em Macapá, qualquer
 * que seja o fuso de quem pergunta. No banco, o par é `public.hoje_br()`.
 */
export const FUSO_DA_CASA_PARA_DATAS = "America/Belem";

const partes = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_DA_CASA_PARA_DATAS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A data de um instante em Macapá, "aaaa-mm-dd". Sem argumento, é hoje. */
export function hojeBr(instante: Date | string | number = new Date()): string {
  const data = instante instanceof Date ? instante : new Date(instante);
  const p = Object.fromEntries(partes.formatToParts(data).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** O mês de um instante em Macapá, "aaaa-mm". Sem argumento, é o mês de hoje. */
export function mesBr(instante: Date | string | number = new Date()): string {
  return hojeBr(instante).slice(0, 7);
}

/** A data de n dias antes de hoje em Macapá, "aaaa-mm-dd" (n = 29 dá "os últimos 30 dias"). */
export function diasAntesDeHojeBr(n: number, agora: Date = new Date()): string {
  const [a, m, d] = hojeBr(agora).split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  data.setUTCDate(data.getUTCDate() - n);
  return data.toISOString().slice(0, 10);
}
