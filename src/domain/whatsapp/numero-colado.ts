import { apenasDigitos, chaveWhatsApp, formatarTelefone, recebeWhatsApp } from "@/domain/documentos";

/**
 * O número colado na "Nova conversa" (21/10/2026).
 *
 * Quem atende cola o número de onde ele veio: "+55 (96) 99156-2194", "96
 * 99156-2194", o link "wa.me/5596991562194", o "api.whatsapp.com/send?phone=…"
 * de um site, ou só "99156-2194" de um cartão da cidade. Tudo vira a mesma
 * chave de 11 dígitos que o banco usa (`normalize_whatsapp_phone`), e quem
 * decide se recebe WhatsApp é a mesma regra do banco (`recebeWhatsApp` espelha
 * `telefone_recebe_whatsapp`) — a tela não libera o que o banco recusaria.
 *
 * Sem DDD, a casa é Macapá: o número ganha o 96 e a tela diz isso à vista, antes
 * de abrir a conversa.
 */

export const DDD_DA_CASA = "96";

export type NumeroLido =
  | { ok: true; chave: string; legivel: string; dddPresumido: boolean }
  /** `motivo` nulo: campo vazio, nada a dizer ainda. */
  | { ok: false; motivo: string | null };

function digitosDoTexto(texto: string): string {
  // Link do WhatsApp: o número é o que vem depois de wa.me/ ou de phone=.
  const doLink = texto.match(/wa\.me\/\+?([\d\s().-]+)/i) ?? texto.match(/[?&]phone=\+?([\d%+]+)/i);
  const bruto = doLink ? doLink[1] : texto;
  return apenasDigitos(bruto).replace(/^0+/, "");
}

export function lerNumeroColado(texto: string | null | undefined): NumeroLido {
  const t = (texto ?? "").trim();
  if (!t) return { ok: false, motivo: null };

  let d = digitosDoTexto(t);
  if (!d) return { ok: false, motivo: "Cole ou digite um número de celular." };
  if (d.length > 13) {
    return { ok: false, motivo: "Parece que há mais de um número aqui. Cole um só." };
  }

  // Sem DDD: 9 dígitos começando por 9 (celular de hoje) ou 8 começando por 6–9
  // (o formato antigo, sem o nono dígito).
  let dddPresumido = false;
  if ((d.length === 9 && d.startsWith("9")) || (d.length === 8 && d[0] >= "6")) {
    d = DDD_DA_CASA + d;
    dddPresumido = true;
  }

  const chave = chaveWhatsApp(d);
  if (chave && recebeWhatsApp(chave)) {
    return { ok: true, chave, legivel: formatarTelefone(chave), dddPresumido };
  }
  if (chave && (chave.length === 10 || (chave.length === 8 && chave[0] < "6"))) {
    return { ok: false, motivo: "Número fixo não recebe WhatsApp. Use o celular." };
  }
  if (!chave || chave.length < 10) {
    return { ok: false, motivo: "Faltam dígitos: use o celular com DDD, como (96) 99999-9999." };
  }
  return { ok: false, motivo: "Esse não é um celular do Brasil com DDD. Confira o número." };
}
