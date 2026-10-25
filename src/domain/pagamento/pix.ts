/**
 * Pix copia e cola ("BR Code" estático), no formato EMV do Banco Central.
 *
 * Nada aqui fala com banco nem confirma pagamento: gera o texto que o cliente cola no app do banco
 * (com o valor já preenchido) e a mensagem para mandar a ele. Quem confirma que o dinheiro entrou
 * é a pessoa, olhando o extrato ("Marcar Pix recebido").
 *
 * Campos (id + tamanho com 2 dígitos + valor): 00 versão · 01 tipo (11 reutilizável) · 26 conta
 * (00 "br.gov.bcb.pix", 01 chave, 02 descrição) · 52 categoria · 53 moeda 986 · 54 valor · 58 país ·
 * 59 nome · 60 cidade · 62 (05 identificador) · 63 CRC16 (CCITT-FALSE, polinômio 0x1021, início 0xFFFF)
 * calculado sobre o texto inteiro até "6304".
 */

export type TipoDeChavePix = "cpf" | "cnpj" | "telefone" | "email" | "aleatoria";

export const TIPOS_DE_CHAVE_PIX: ReadonlyArray<{ valor: TipoDeChavePix; rotulo: string }> = [
  { valor: "cnpj", rotulo: "CNPJ" },
  { valor: "cpf", rotulo: "CPF" },
  { valor: "telefone", rotulo: "Celular" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "aleatoria", rotulo: "Chave aleatória" },
];

export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

/** Sem acento, só letras, números e espaço, no tamanho que o Banco Central aceita. */
export function textoDoBrCode(texto: string, max: number): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max);
}

/** Deixa a chave no formato que o Pix espera (CPF/CNPJ só dígitos, celular com +55, e-mail minúsculo). */
export function normalizarChavePix(tipo: TipoDeChavePix, bruta: string): string {
  const t = bruta.trim();
  if (tipo === "cpf" || tipo === "cnpj") return t.replace(/\D/g, "");
  if (tipo === "telefone") {
    const d = t.replace(/\D/g, "");
    return d.startsWith("55") && d.length >= 12 ? `+${d}` : `+55${d}`;
  }
  if (tipo === "email") return t.toLowerCase();
  return t.toLowerCase();
}

/** A chave tem o tamanho certo para o tipo? Devolve o motivo, ou null quando serve. */
export function problemaNaChavePix(tipo: TipoDeChavePix, chave: string): string | null {
  if (!chave) return "Informe a chave Pix.";
  if (tipo === "cpf" && chave.length !== 11) return "CPF tem 11 dígitos.";
  if (tipo === "cnpj" && chave.length !== 14) return "CNPJ tem 14 dígitos.";
  if (tipo === "telefone" && !/^\+55\d{10,11}$/.test(chave)) return "Celular: DDD + número (10 ou 11 dígitos).";
  if (tipo === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(chave)) return "E-mail inválido.";
  if (tipo === "aleatoria" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(chave)) return "A chave aleatória é um código com 36 caracteres (8-4-4-4-12).";
  return null;
}

export function brCodePix(a: { chave: string; valor?: number | null; nome: string; cidade: string; identificador?: string; descricao?: string }): string {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", a.chave) + (a.descricao ? campo("02", textoDoBrCode(a.descricao, 40)) : "");
  const valor = a.valor != null && a.valor > 0 ? campo("54", a.valor.toFixed(2)) : "";
  const adicional = campo("05", (a.identificador ?? "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***");
  const sem =
    campo("00", "01") +
    campo("01", "11") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    valor +
    campo("58", "BR") +
    campo("59", textoDoBrCode(a.nome, 25) || "NAO INFORMADO") +
    campo("60", textoDoBrCode(a.cidade, 15) || "BRASIL") +
    campo("62", adicional) +
    "6304";
  return sem + crc16(sem);
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** A mensagem para o cliente: valor, a chave e o copia e cola, sem prometer nada além do Pix. */
export function mensagemDoPix(a: { cliente?: string | null; valor: number; numeroDoOrcamento?: number | null; copiaECola: string; empresa?: string | null }): string {
  const nome = a.cliente?.trim() ? `Olá, ${a.cliente.trim().split(/\s+/)[0]}! ` : "Olá! ";
  const ref = a.numeroDoOrcamento ? ` do orçamento #${a.numeroDoOrcamento}` : "";
  return [
    `${nome}Segue o Pix${ref}${a.empresa ? ` da ${a.empresa}` : ""}.`,
    `Valor: ${brl(a.valor)}`,
    "",
    "Pix copia e cola (é só colar no app do seu banco, o valor já vem preenchido):",
    a.copiaECola,
    "",
    "Quando pagar, me manda o comprovante por aqui, por favor.",
  ].join("\n");
}

/** Link do WhatsApp com a mensagem pronta; sem telefone, abre a escolha do contato. */
export function linkDoWhatsapp(telefone: string | null | undefined, mensagem: string): string {
  const d = (telefone ?? "").replace(/\D/g, "");
  const numero = d ? (d.startsWith("55") ? d : `55${d}`) : "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}
