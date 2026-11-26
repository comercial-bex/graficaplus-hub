/**
 * Países do cadastro de cliente (01/11/2026): bandeira, nome e código de discagem (DDI).
 * O dono tem cliente de fora (a Guiana Francesa, por exemplo), e o Holdprint mostra o país
 * com a bandeira e o nome, o que facilita achar. O código ISO de duas letras é o que vai
 * para `clientes.pais`; o DDI é o que vai na frente do WhatsApp.
 *
 * Cliente do Brasil tem CPF ou CNPJ e telefone brasileiro. Cliente de fora não tem
 * documento brasileiro, e o telefone é escrito com "+" e o código do país.
 */

import { ehCelularBrasileiro } from "@/domain/contato/ddds-do-brasil";
import { chaveWhatsApp, numeroRecebidoDeFora } from "@/domain/documentos";

export interface Pais {
  /** ISO 3166-1 de duas letras, em maiúsculas. */
  codigo: string;
  nome: string;
  /** Só dígitos, sem o "+". */
  ddi: string;
}

/** [código, nome, DDI]. A ordem aqui não importa: `PAISES` põe os mais usados na frente. */
const TABELA: ReadonlyArray<readonly [string, string, string]> = [
  ["BR", "Brasil", "55"],
  ["GF", "Guiana Francesa", "594"],
  ["SR", "Suriname", "597"],
  ["GY", "Guiana", "592"],
  ["VE", "Venezuela", "58"],
  ["CO", "Colômbia", "57"],
  ["PE", "Peru", "51"],
  ["BO", "Bolívia", "591"],
  ["PY", "Paraguai", "595"],
  ["UY", "Uruguai", "598"],
  ["AR", "Argentina", "54"],
  ["CL", "Chile", "56"],
  ["EC", "Equador", "593"],
  ["PT", "Portugal", "351"],
  ["ES", "Espanha", "34"],
  ["FR", "França", "33"],
  ["IT", "Itália", "39"],
  ["DE", "Alemanha", "49"],
  ["GB", "Reino Unido", "44"],
  ["IE", "Irlanda", "353"],
  ["NL", "Países Baixos", "31"],
  ["BE", "Bélgica", "32"],
  ["CH", "Suíça", "41"],
  ["AT", "Áustria", "43"],
  ["SE", "Suécia", "46"],
  ["NO", "Noruega", "47"],
  ["DK", "Dinamarca", "45"],
  ["FI", "Finlândia", "358"],
  ["PL", "Polônia", "48"],
  ["RU", "Rússia", "7"],
  ["UA", "Ucrânia", "380"],
  ["TR", "Turquia", "90"],
  ["GR", "Grécia", "30"],
  ["US", "Estados Unidos", "1"],
  ["CA", "Canadá", "1"],
  ["MX", "México", "52"],
  ["CU", "Cuba", "53"],
  ["HT", "Haiti", "509"],
  ["PA", "Panamá", "507"],
  ["CR", "Costa Rica", "506"],
  ["GT", "Guatemala", "502"],
  ["HN", "Honduras", "504"],
  ["SV", "El Salvador", "503"],
  ["NI", "Nicarágua", "505"],
  ["AO", "Angola", "244"],
  ["MZ", "Moçambique", "258"],
  ["CV", "Cabo Verde", "238"],
  ["GW", "Guiné-Bissau", "245"],
  ["ST", "São Tomé e Príncipe", "239"],
  ["TL", "Timor-Leste", "670"],
  ["ZA", "África do Sul", "27"],
  ["NG", "Nigéria", "234"],
  ["EG", "Egito", "20"],
  ["MA", "Marrocos", "212"],
  ["DZ", "Argélia", "213"],
  ["SN", "Senegal", "221"],
  ["CN", "China", "86"],
  ["JP", "Japão", "81"],
  ["KR", "Coreia do Sul", "82"],
  ["IN", "Índia", "91"],
  ["ID", "Indonésia", "62"],
  ["TH", "Tailândia", "66"],
  ["VN", "Vietnã", "84"],
  ["PH", "Filipinas", "63"],
  ["MY", "Malásia", "60"],
  ["SG", "Singapura", "65"],
  ["HK", "Hong Kong", "852"],
  ["MO", "Macau", "853"],
  ["TW", "Taiwan", "886"],
  ["AE", "Emirados Árabes Unidos", "971"],
  ["SA", "Arábia Saudita", "966"],
  ["IL", "Israel", "972"],
  ["LB", "Líbano", "961"],
  ["PK", "Paquistão", "92"],
  ["BD", "Bangladesh", "880"],
  ["AU", "Austrália", "61"],
  ["NZ", "Nova Zelândia", "64"],
];

export const PAIS_PADRAO = "BR";

/**
 * Os que mais aparecem para uma gráfica de Macapá: o Brasil, os vizinhos de fronteira e o resto que pede orçamento.
 * França e Colômbia entraram em 26/11/2026: o dono tem cliente dos dois países.
 */
export const PAISES_FREQUENTES: readonly string[] = ["BR", "GF", "FR", "CO", "SR", "GY", "VE", "PT", "US"];

const todos: Pais[] = TABELA.map(([codigo, nome, ddi]) => ({ codigo, nome, ddi }));

/** Frequentes na ordem de uso; depois todos os outros, em ordem alfabética. */
export const PAISES: readonly Pais[] = [
  ...PAISES_FREQUENTES.map((c) => todos.find((p) => p.codigo === c)!),
  ...todos
    .filter((p) => !PAISES_FREQUENTES.includes(p.codigo))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
];

export function paisPorCodigo(codigo: string | null | undefined): Pais | undefined {
  return todos.find((p) => p.codigo === (codigo ?? "").toUpperCase());
}

/** O país de um código de discagem. Código dividido por vários países ("1": EUA e Canadá) devolve o mais usado. */
export function paisPorDdi(ddi: string | null | undefined): Pais | undefined {
  return PAISES.find((p) => p.ddi === (ddi ?? "").replace(/\D/g, ""));
}

/** Sem país informado é Brasil: é o que os clientes de antes são. */
export function ehBrasil(codigo: string | null | undefined): boolean {
  return !codigo || codigo.toUpperCase() === PAIS_PADRAO;
}

/** A bandeira como emoji, montada do código ISO ("BR" vira 🇧🇷). No Windows aparece só as letras. */
export function bandeira(codigo: string | null | undefined): string {
  const c = (codigo ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** "🇬🇫 Guiana Francesa" */
export function rotuloDoPais(codigo: string | null | undefined): string {
  const p = paisPorCodigo(codigo);
  return p ? `${bandeira(p.codigo)} ${p.nome}` : (codigo ?? "");
}

const soDigitos = (v: string) => v.replace(/\D/g, "");

/**
 * Os países em que o número nacional começa com um "0" de discagem que NÃO entra no número internacional: o francês digita
 * "06 12 34 56 78", mas pelo WhatsApp é +33 6 12 34 56 78. Sem tirar o zero, o número gravado era 330612345678, que não
 * existe (provado em 26/11/2026 com o campo do cadastro: "+33 06 12 34 56 78" saía para o Z-API como 330612345678).
 *
 * Só entram os países em que o número, depois do código, nunca começa com 0 de verdade. Fora da lista de propósito: Itália
 * (o fixo mantém o 0), Argentina (tem o 9 e o 15 no meio) e México (regra própria): para esses o número vai como foi digitado.
 */
const DDIS_COM_ZERO_DE_DISCAGEM: ReadonlySet<string> = new Set([
  "33", "594", "58", "44", "49", "31", "32", "41", "43", "46", "358", "353", "90", "380", "61", "64", "595", "598", "593",
  "27", "234", "20", "212", "213", "81", "82", "91", "62", "66", "84", "63", "60", "886", "971", "966", "972", "92", "880",
]);

/** O número nacional sem o "(0)" nem o zero de discagem, quando o país usa. Sem dígitos sobrando, devolve como veio. */
export function semZeroDeDiscagem(ddi: string, nacional: string): string {
  let n = (nacional ?? "").trim().replace(/^\(0\)\s*/, "");
  if (DDIS_COM_ZERO_DE_DISCAGEM.has(soDigitos(ddi))) {
    const sem = n.replace(/^0\s*/, "");
    if (soDigitos(sem)) n = sem;
  }
  return n;
}

/** "+594 694 12 34 56": o código do país e o número, do jeito que o banco e o WhatsApp esperam (sem o zero de discagem). */
export function montarTelefoneInternacional(ddi: string, nacional: string): string {
  const resto = semZeroDeDiscagem(ddi, nacional);
  return soDigitos(resto) ? `+${soDigitos(ddi)} ${resto}` : "";
}

/** Tira de `texto` os primeiros `n` dígitos, sem levar embora o resto da formatação. */
function semOsPrimeirosDigitos(texto: string, n: number): string {
  let vistos = 0;
  let i = 0;
  while (i < texto.length && vistos < n) {
    if (/\d/.test(texto[i])) vistos += 1;
    i += 1;
  }
  return texto.slice(i).trim();
}

/** O contrário: acha o código do país no começo do número (o mais longo que bater). */
export function separarTelefoneInternacional(valor: string | null | undefined): { ddi: string; nacional: string } {
  const bruto = (valor ?? "").trim();
  if (!bruto.startsWith("+")) return { ddi: "", nacional: bruto };
  const digitos = soDigitos(bruto);
  const ddis = [...new Set(todos.map((p) => p.ddi))].sort((a, b) => b.length - a.length);
  const ddi = ddis.find((d) => digitos.startsWith(d));
  if (!ddi) return { ddi: "", nacional: semOsPrimeirosDigitos(bruto, 0).replace(/^\+\s*/, "") };
  return { ddi, nacional: semOsPrimeirosDigitos(bruto.replace(/^\+\s*/, ""), ddi.length) };
}

/**
 * O que muda no cadastro quando se troca o país. Documento brasileiro some para quem é de fora;
 * telefone de um lado não serve do outro, então é limpo, menos quando o novo país é de fora e o
 * antigo também era: aí só troca o código na frente e o número fica.
 */
export function trocarDePais(
  atual: { pais?: string | null; documento?: string | null; telefone?: string | null },
  novoPais: string,
): { pais: string; documento: string; telefone: string } {
  const eraBrasil = ehBrasil(atual.pais);
  const seraBrasil = ehBrasil(novoPais);
  const documento = seraBrasil ? (atual.documento ?? "") : "";
  let telefone = "";
  if (eraBrasil && seraBrasil) telefone = atual.telefone ?? "";
  else if (!eraBrasil && !seraBrasil) {
    const { nacional } = separarTelefoneInternacional(atual.telefone);
    telefone = montarTelefoneInternacional(paisPorCodigo(novoPais)?.ddi ?? "", nacional);
  }
  return { pais: novoPais, documento, telefone };
}

/** O país que o telefone diz ser: o código depois do "+". Sem "+", ou com +55, é Brasil. */
export function paisDoTelefone(valor: string | null | undefined): string {
  const { ddi } = separarTelefoneInternacional(valor);
  if (!ddi || ddi === "55") return PAIS_PADRAO;
  return paisPorDdi(ddi)?.codigo ?? PAIS_PADRAO;
}

/**
 * O país do cadastro, corrigido pelo telefone. Cliente criado a partir de um contato de orçamento ou de um lead nascia com
 * país Brasil mesmo com "+33…" no telefone (a coluna tem o padrão BR), e a lista de clientes passava a cobrar CPF/CNPJ dele.
 * Se o cadastro diz Brasil e o telefone diz outro país, vale o telefone; qualquer outro país escolhido vale como está.
 */
export function paisEfetivo(pais: string | null | undefined, telefone: string | null | undefined): string {
  if (!ehBrasil(pais)) return (pais ?? PAIS_PADRAO).toUpperCase();
  return paisDoTelefone(telefone);
}

/** Exemplos de número, sem o código do país, para o campo de cada país mais usado. */
const EXEMPLO_DO_NUMERO: Record<string, string> = {
  "55": "(96) 99999-9999",
  "594": "694 12 34 56",
  "33": "6 12 34 56 78",
  "57": "300 123 4567",
  "597": "712 3456",
  "592": "612 3456",
  "58": "412 123 4567",
  "351": "912 345 678",
  "1": "212 555 1234",
};

export function exemploDoNumero(ddi: string): string {
  return EXEMPLO_DO_NUMERO[soDigitos(ddi)] ?? "número sem o código do país";
}

/**
 * O telefone para mostrar. Brasileiro passa como veio. De fora, vai com o "+" e o código do país: o que está gravado com "+"
 * (cadastro) sai limpo, sem o zero de discagem; o que chegou pelo webhook só com dígitos (12 a 15) ganha o "+" e o código
 * separado do resto. Sem país reconhecível, só o "+" na frente dos dígitos.
 */
export function telefoneInternacionalLegivel(valor: string | null | undefined): string | null {
  const bruto = (valor ?? "").trim();
  if (!bruto) return null;
  if (bruto.startsWith("+")) {
    const { ddi, nacional } = separarTelefoneInternacional(bruto);
    if (ddi === "55") return null;
    if (ddi) return montarTelefoneInternacional(ddi, nacional) || bruto;
    return bruto;
  }
  const d = soDigitos(bruto);
  // A mesma regra do envio (`numeroRecebidoDeFora`): quem pode ser respondido como número de fora também aparece como tal.
  // Celular brasileiro (com ou sem o 55) nunca: é mostrado como brasileiro.
  if (numeroRecebidoDeFora(d) && !ehCelularBrasileiro(chaveWhatsApp(d))) {
    const { ddi, nacional } = separarTelefoneInternacional(`+${d}`);
    return ddi ? `+${ddi} ${nacional}` : `+${d}`;
  }
  return null;
}

/**
 * O que a pessoa colou ou digitou no campo de telefone, arrumado para o campo com bandeira.
 *   "0033 6 12 34 56 78"           -> "+33 6 12 34 56 78"   (o "00" europeu é o "+")
 *   "wa.me/33612345678"            -> "+33612345678"        (o link do WhatsApp sempre leva o código do país)
 *   "wa.me/5596991562194"          -> "96991562194"         (o Brasil volta sem o 55, como o campo brasileiro espera)
 * Qualquer outra coisa passa como veio.
 */
export function textoParaCampoDeTelefone(texto: string | null | undefined): string {
  const t = (texto ?? "").replace(/^\s+/, "");
  const link = t.match(/wa\.me\/\+?([\d\s().-]+)/i) ?? t.match(/[?&]phone=\+?([\d%+]+)/i);
  if (link) {
    const d = soDigitos(link[1]);
    if (!d) return t;
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d.slice(2);
    return `+${d}`;
  }
  if (/^00[1-9]/.test(t)) return `+${t.slice(2).replace(/^\s+/, "")}`;
  return t;
}
