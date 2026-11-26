import { apenasDigitos, chaveWhatsApp, formatarTelefone, recebeWhatsApp } from "@/domain/documentos";
import { montarTelefoneInternacional, paisPorDdi, separarTelefoneInternacional } from "@/domain/clientes/paises";

/**
 * O número colado na "Nova conversa" (21/10/2026; de fora em 26/11/2026).
 *
 * Quem atende cola o número de onde ele veio: "+55 (96) 99156-2194", "96
 * 99156-2194", o link "wa.me/5596991562194", o "api.whatsapp.com/send?phone=…"
 * de um site, ou só "99156-2194" de um cartão da cidade. Tudo vira a mesma
 * chave de 11 dígitos que o banco usa (`normalize_whatsapp_phone`), e quem
 * decide se recebe WhatsApp é a mesma regra do banco (`recebeWhatsApp` espelha
 * `telefone_recebe_whatsapp`) — a tela não libera o que o banco recusaria.
 *
 * Número de fora (França, Guiana Francesa, Colômbia...): vale quando vem com o "+" e o
 * código do país, com o "00" europeu ("0033 6 12 34 56 78") ou num link do WhatsApp (que
 * sempre leva o código do país). Sem nenhum desses, a regra continua a brasileira: o
 * "+" é a pessoa dizendo "este é de fora", e um celular brasileiro com dígito a mais não
 * pode passar por estrangeiro. O zero de discagem do país ("06 12…") sai sozinho.
 *
 * Sem DDD, a casa é Macapá: o número ganha o 96 e a tela diz isso à vista, antes
 * de abrir a conversa.
 */

export const DDD_DA_CASA = "96";

export type NumeroLido =
  | {
      ok: true;
      /** A chave de reconhecimento (a de `telefone_normalizado`): é com ela que se procura conversa e cliente. */
      chave: string;
      /** O que vai para o servidor: o celular brasileiro pela chave, o de fora com "+" e o código do país. */
      telefone: string;
      legivel: string;
      dddPresumido: boolean;
      internacional: boolean;
      /** Código ISO do país de fora, quando o código de discagem é conhecido. */
      pais: string | null;
    }
  /** `motivo` nulo: campo vazio, nada a dizer ainda. */
  | { ok: false; motivo: string | null };

const DICA_DE_FORA = "Se o número é de outro país, escolha o país na bandeira ou escreva com o +.";

/**
 * `escrito` é o texto como a pessoa o digitou, já com o "+": o agrupamento dela ("+33 6 12 34 56 78") é o que
 * aparece na confirmação. Em link e em número só de dígitos não há agrupamento a preservar.
 */
function lerDeFora(d: string, escrito: string): NumeroLido {
  const { ddi, nacional } = separarTelefoneInternacional(escrito);
  const montado = ddi ? montarTelefoneInternacional(ddi, nacional) : `+${d}`;
  const digitos = apenasDigitos(montado);
  if (digitos.length > 15) {
    return { ok: false, motivo: "Número de fora com mais de 15 números. Confira, ou cole um só." };
  }
  if (digitos.length < 8) {
    return { ok: false, motivo: "Faltam números. Digite o número completo, depois do código do país." };
  }
  return {
    ok: true,
    chave: chaveWhatsApp(digitos) as string,
    telefone: `+${digitos}`,
    legivel: montado,
    dddPresumido: false,
    internacional: true,
    pais: ddi ? (paisPorDdi(ddi)?.codigo ?? null) : null,
  };
}

export function lerNumeroColado(texto: string | null | undefined): NumeroLido {
  const t = (texto ?? "").trim();
  if (!t) return { ok: false, motivo: null };

  // Link do WhatsApp: o número é o que vem depois de wa.me/ ou de phone=. Ele sempre leva o código do país.
  const doLink = t.match(/wa\.me\/\+?([\d\s().-]+)/i) ?? t.match(/[?&]phone=\+?([\d%+]+)/i);
  const bruto = doLink ? doLink[1] : t;
  let d = apenasDigitos(bruto).replace(/^0+/, "");
  if (!d) return { ok: false, motivo: "Cole ou digite um número de celular." };

  // O "00" europeu no lugar do "+": "0033 6 12 34 56 78". Só vale quando sobra um código de país depois dele.
  const comZeroZero = /^00[1-9]/.test(bruto.trim());
  const comCodigoDoPais = doLink !== null || bruto.trim().startsWith("+") || comZeroZero;
  if (comCodigoDoPais && !d.startsWith("55")) {
    const digitado = bruto.trim();
    const escrito = doLink ? `+${d}` : comZeroZero ? `+${digitado.replace(/^00\s*/, "")}` : digitado;
    return lerDeFora(d, escrito);
  }

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
    return {
      ok: true,
      chave,
      telefone: chave,
      legivel: formatarTelefone(chave),
      dddPresumido,
      internacional: false,
      pais: "BR",
    };
  }
  if (chave && (chave.length === 10 || (chave.length === 8 && chave[0] < "6"))) {
    return { ok: false, motivo: "Número fixo não recebe WhatsApp. Use o celular." };
  }
  if (!chave || chave.length < 10) {
    return { ok: false, motivo: "Faltam dígitos: use o celular com DDD, como (96) 99999-9999." };
  }
  return { ok: false, motivo: `Esse não é um celular do Brasil com DDD. ${DICA_DE_FORA}` };
}
