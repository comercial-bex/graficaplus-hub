/** Ramos aceitos no programa de parceiros (terceirizados do setor gráfico). */
export const RAMOS = [
  { valor: "grafica", rotulo: "Gráfica / gráfica rápida" },
  { valor: "comunicacao_visual", rotulo: "Comunicação visual" },
  { valor: "agencia", rotulo: "Agência de publicidade / marketing" },
  { valor: "designer", rotulo: "Designer / freelancer" },
  { valor: "revendedor_brindes", rotulo: "Brindes e personalizados" },
  { valor: "outro", rotulo: "Outro" },
] as const;

export function rotuloDoRamo(valor: string | null | undefined, outro?: string | null): string | null {
  if (!valor) return null;
  if (valor === "outro") return outro ? `Outro: ${outro}` : "Outro";
  return RAMOS.find((r) => r.valor === valor)?.rotulo ?? valor;
}

/** @usuario ou instagram.com/usuario → https://instagram.com/usuario; site sem protocolo ganha https://. */
export function normalizarComprovacao(entrada: string): string {
  const v = entrada.trim();
  if (!v) return "";
  const arroba = v.match(/^@([A-Za-z0-9._]+)$/);
  if (arroba) return `https://instagram.com/${arroba[1]}`;
  const insta = v.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/i);
  if (insta) return `https://instagram.com/${insta[1]}`;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[^\s]+\.[^\s]{2,}/.test(v)) return `https://${v}`;
  return v;
}
