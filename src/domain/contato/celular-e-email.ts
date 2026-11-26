/**
 * Telefone celular e e-mail sem erro de digitação (16/11/2026, pedido do dono).
 *
 * Casos reais: um parceiro digitou "(55) 96984-1232" (pôs o 55 do país no lugar
 * do DDD) e outra digitou "gmai.com". O campo agora mostra o +55 fixo e só pede
 * DDD + número; o e-mail sugere o domínio certo.
 *
 * Tudo puro. A função do banco `parceiro_cadastrar_rapido` repete a MESMA regra
 * (lista de DDDs e DOMINIOS_COM_ERRO): mudou aqui, muda lá.
 */

import { DDDS_BRASIL } from "./ddds-do-brasil";

/** DDDs oficiais do Brasil (Anatel): a lista mora em `ddds-do-brasil.ts`, uma só para o sistema inteiro. */
export { DDDS_BRASIL } from "./ddds-do-brasil";

/** Só os dígitos de DDD + número: tira o 55 colado na frente (e o 0 de longa distância). */
export function digitosDoCelular(v: string): string {
  let d = (v ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length >= 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 11);
}

/** Máscara do campo e formato gravado: "(96) 99999-9999". */
export function mascaraCelular(v: string): string {
  const d = digitosDoCelular(v);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2), r = d.slice(2);
  if (r.length <= 5) return `(${ddd}) ${r}`;
  return `(${ddd}) ${r.slice(0, 5)}-${r.slice(5)}`;
}

/** Mensagem do que está errado no celular; `null` quando está certo. */
export function erroDoCelular(v: string): string | null {
  const d = digitosDoCelular(v);
  if (!d) return "Informe o WhatsApp com DDD.";
  if (d.length >= 2 && !(DDDS_BRASIL as readonly string[]).includes(d.slice(0, 2)))
    return `O DDD ${d.slice(0, 2)} não existe. Confira os 2 primeiros números.`;
  if (d.length >= 3 && d[2] !== "9")
    return d.length === 10
      ? "Esse parece um telefone fixo. Informe um celular (com o 9 na frente)."
      : "O celular começa com 9 depois do DDD.";
  if (d.length < 11) {
    const falta = 11 - d.length;
    return falta === 1 ? "Falta 1 número" : `Faltam ${falta} números`;
  }
  return null;
}

export function celularValido(v: string): boolean {
  return erroDoCelular(v) === null;
}

/** Os 5 botões de domínio embaixo do e-mail. */
export const DOMINIOS_SUGERIDOS = ["gmail.com", "hotmail.com", "outlook.com", "icloud.com", "yahoo.com.br"] as const;

/**
 * Domínios com erro de digitação conhecidos → o certo. O banco recusa estes
 * (mesma lista em parceiro_cadastrar_rapido).
 */
export const DOMINIOS_COM_ERRO: Record<string, string> = {
  "gmai.com": "gmail.com", "gmial.com": "gmail.com", "gmail.co": "gmail.com", "gmail.com.br": "gmail.com",
  "gmal.com": "gmail.com", "gmil.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
  "gmail.cm": "gmail.com", "gmail.con": "gmail.com", "gmaill.com": "gmail.com", "gmail.com.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmil.com": "hotmail.com",
  "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com", "homail.com": "hotmail.com", "hotamil.com": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "otlook.com": "outlook.com", "outlook.co": "outlook.com",
  "outlook.con": "outlook.com", "outllok.com": "outlook.com",
  "iclod.com": "icloud.com", "icoud.com": "icloud.com", "iclould.com": "icloud.com", "icloud.co": "icloud.com",
  "icloud.con": "icloud.com", "icluod.com": "icloud.com",
  "yaho.com.br": "yahoo.com.br", "yahooo.com.br": "yahoo.com.br", "yaoo.com.br": "yahoo.com.br",
  "yahoo.co.br": "yahoo.com.br", "yahoo.com.b": "yahoo.com.br", "yhaoo.com.br": "yahoo.com.br",
};

/** Domínios verdadeiros que ficam a uma letra de um provedor: nunca "corrigir". */
const DOMINIOS_REAIS = [
  ...DOMINIOS_SUGERIDOS, "hotmail.com.br", "outlook.com.br", "yahoo.com", "live.com", "msn.com", "me.com",
  "mail.com", "gmx.com", "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br",
];

function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** "gmai.com" → "gmail.com"; domínio de empresa → null. */
export function sugerirDominio(dominio: string): string | null {
  const d = (dominio ?? "").trim().toLowerCase();
  if (d.length < 4 || DOMINIOS_REAIS.includes(d)) return null;
  return DOMINIOS_COM_ERRO[d] ?? DOMINIOS_SUGERIDOS.find((s) => distancia(d, s) === 1) ?? null;
}

/** "ana@gmai.com" → "ana@gmail.com"; null quando não há o que sugerir. */
export function sugerirEmailCorrigido(email: string): string | null {
  const limpo = (email ?? "").trim().toLowerCase();
  const arroba = limpo.lastIndexOf("@");
  if (arroba < 1) return null;
  const certo = sugerirDominio(limpo.slice(arroba + 1));
  return certo ? `${limpo.slice(0, arroba)}@${certo}` : null;
}

export function formatoDeEmailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v ?? "").trim());
}

/** Completa com o domínio do botão: "ana" ou "ana@gm" → "ana@gmail.com". */
export function completarEmail(v: string, dominio: string): string {
  const local = (v ?? "").trim().split("@")[0];
  return local ? `${local}@${dominio}` : "";
}

/** Mensagem do que está errado no e-mail; `null` quando pode gravar. */
export function erroDoEmail(v: string): string | null {
  const limpo = (v ?? "").trim().toLowerCase();
  if (!limpo) return "Informe o e-mail.";
  if (!formatoDeEmailValido(limpo)) return "Confira o e-mail: falta o @ ou o domínio (ex.: nome@gmail.com).";
  const dominio = limpo.slice(limpo.lastIndexOf("@") + 1);
  if (DOMINIOS_COM_ERRO[dominio]) return `O domínio "${dominio}" está com erro. Você quis dizer @${DOMINIOS_COM_ERRO[dominio]}?`;
  return null;
}

/**
 * DDD 55 existe (RS), mas o erro real foi digitar o 55 do país no lugar do DDD
 * ("(55) 96984-1232"). Avisa, sem bloquear, quando o DDD digitado é 55.
 */
export function precisaAvisoDdd55(v: string): boolean {
  return digitosDoCelular(v).startsWith("55");
}
