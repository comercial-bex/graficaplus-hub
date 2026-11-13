import { chaveWhatsApp, formatarTelefone } from "@/domain/documentos";
import { semAcento } from "./normalizar";
import { interpretar } from "./quadro";
import { SEMENTES_DO_QUADRO } from "./quadro-sementes";
import type { RespostaDoQuadro } from "./tipos";
import { verificarTexto } from "./verificador";

/* ------------------------------------------------------------------ */
/* Nome                                                                */
/* ------------------------------------------------------------------ */

export type MotivoDeNomeInvalido =
  | "vazio"
  | "muito_longo"
  | "link"
  | "emoji"
  | "digito"
  | "pergunta"
  | "caractere_invalido"
  | "muitas_palavras"
  | "palavra_curta_ou_longa"
  | "primeiro_nome_longo"
  | "conector_no_fim_ou_comeco"
  | "palavra_barrada"
  | "e_resposta_do_quadro";

export type NomeLido =
  | {
      ok: true;
      nome: string;
      primeiroNome: string;
      completo: boolean;
      palavras: number;
      tratamento: string | null;
    }
  | { ok: false; motivo: MotivoDeNomeInvalido };

const CONECTORES = new Set(["da", "de", "do", "das", "dos", "di", "du"]);
const TRATAMENTOS = new Map<string, string>([
  ["seu", "seu"],
  ["dona", "dona"],
  ["sr", "Sr."],
  ["sra", "Sra."],
  ["senhor", "Sr."],
  ["senhora", "Sra."],
  ["dr", "Dr."],
  ["dra", "Dra."],
  ["doutor", "Dr."],
  ["doutora", "Dra."],
  ["prof", "Prof."],
  ["professor", "Prof."],
  ["professora", "Profa."],
]);

/** Palavras que nunca são nome: respostas, pedidos, produtos, verbos, termos de empresa, termos sensíveis e palavrões. */
const NAO_E_NOME = new Set([
  // respostas e cortesia
  "sim",
  "nao",
  "ok",
  "okay",
  "oi",
  "ola",
  "opa",
  "obrigado",
  "obrigada",
  "valeu",
  "vlw",
  "blz",
  "beleza",
  "claro",
  "certo",
  "pode",
  "isso",
  "tudo",
  "bem",
  "bom",
  "boa",
  "dia",
  "tarde",
  "noite",
  "hm",
  "hmm",
  "uh",
  "eh",
  "ah",
  "oh",
  "ue",
  "uai",
  "nada",
  "kk",
  "kkk",
  "rs",
  "rsrs",
  "haha",
  "hehe",
  "tipo",
  "assim",
  "entendi",
  "pular",
  "depois",
  "aqui",
  "ali",
  "entao",
  "ja",
  "ainda",
  "nunca",
  "sempre",
  "talvez",
  "outro",
  "outra",
  // pedidos e verbos
  "quero",
  "queria",
  "preciso",
  "precisava",
  "precisando",
  "gostaria",
  "fazem",
  "fazer",
  "faz",
  "tem",
  "tenho",
  "temos",
  "vou",
  "vai",
  "estou",
  "estamos",
  "pode",
  "podem",
  "poderia",
  "ajuda",
  "ajudar",
  "comprar",
  "compra",
  "pedir",
  "pedido",
  "encomendar",
  "imprimir",
  "impressao",
  "urgente",
  "urgencia",
  "amanha",
  "hoje",
  "agora",
  "rapido",
  "informacao",
  "informacoes",
  "saber",
  "perguntar",
  "pergunta",
  "duvida",
  // produtos e serviços
  "banner",
  "banners",
  "lona",
  "lonas",
  "adesivo",
  "adesivos",
  "vinil",
  "placa",
  "placas",
  "acrilico",
  "cartao",
  "cartoes",
  "panfleto",
  "panfletos",
  "folder",
  "flyer",
  "camiseta",
  "camisetas",
  "caneca",
  "canecas",
  "brinde",
  "brindes",
  "fita",
  "pasta",
  "bonequinho",
  "mdf",
  "plastificado",
  "etiqueta",
  "etiquetas",
  "letreiro",
  "fachada",
  "faixa",
  "faixas",
  "cracha",
  "crachas",
  "convite",
  "convites",
  "calendario",
  "carimbo",
  "impressao3d",
  "miniatura",
  "logomarca",
  "logo",
  "arte",
  "design",
  "orcamento",
  "orcamentos",
  "produto",
  "produtos",
  "servico",
  "servicos",
  "material",
  "tamanho",
  "quantidade",
  "metro",
  "metros",
  "unidades",
  // empresa, robô e cobrança
  "bloqueio",
  "linha",
  "banco",
  "fatura",
  "divida",
  "cobranca",
  "promocao",
  "oferta",
  "atendimento",
  "suporte",
  "empresa",
  "loja",
  "protocolo",
  "codigo",
  "verificacao",
  "cupom",
  "curriculo",
  "assistente",
  "virtual",
  "bem-vindo",
  "bemvindo",
  // termos sensíveis
  "parceiro",
  "parceira",
  "parceiros",
  "parceria",
  "terceirizado",
  "terceirizada",
  "tabela",
  "preco",
  "precos",
  "valor",
  "valores",
  "desconto",
  "revendedor",
  "revendedora",
  "revenda",
  "atacado",
  // dinheiro e pagamento: o banco proíbe o texto montado com estas palavras (verificador.ts), e o nome volta na
  // mensagem do robô ("Prazer, Pix!"), então nunca pode ser nome. O que o verificador já pega (pix, juros, boleto,
  // parcel*, reais, diferenciad*) é conferido de novo abaixo, direto da lista dele; estas são as formas coladas
  // ou sem acento que a lista dele não alcança.
  "pix",
  "juros",
  "boleto",
  "boletos",
  "parcela",
  "parcelas",
  "parcelamento",
  "reais",
  "diferenciado",
  "diferenciada",
  "notafiscal",
  "nota",
  "fiscal",
  "porcentagem",
  "percentual",
  "precisamos",
  "orcar",
  "camisa",
  "quanto",
  "puto",
  // palavrões
  "porra",
  "caralho",
  "merda",
  "bosta",
  "puta",
  "putaria",
  "fdp",
  "foder",
  "foda",
  "fodase",
  "buceta",
  "viado",
  "vagabundo",
  "vagabunda",
  "idiota",
  "imbecil",
  "babaca",
  "otario",
  "otaria",
  "lixo",
  "cuzao",
  "arrombado",
  "desgraca",
  "crl",
  "krl",
  "pqp",
  "vsf",
  "vtnc",
  "cu",
]);
const PREFIXOS_BARRADOS = [
  "notafisc",
  "porcent",
  "percent",
  "parcel",
  "diferenciad",
  "boleto",
  "parceir",
  "parceri",
  "terceiriz",
  "revend",
  "orcament",
  "desconto",
  "preco",
  "tabela",
];

const SAUDACOES = ["oi", "ola", "opa", "e ai", "eai", "bom dia", "boa tarde", "boa noite"];
const INTRODUCOES = [
  "meu nome e",
  "meu nome",
  "me chamo",
  "eu me chamo",
  "pode me chamar de",
  "pode chamar de",
  "pode me chamar",
  "me chama de",
  "me chamam de",
  "o nome e",
  "nome",
  "aqui e o",
  "aqui e a",
  "aqui e",
  "eu sou o",
  "eu sou a",
  "eu sou",
  "sou o",
  "sou a",
  "sou",
  "e o",
  "e a",
];

const LETRAS = /^\p{L}+(?:['’-]\p{L}+)*$/u;

function maiusculaInicial(palavra: string): string {
  return palavra
    .toLowerCase()
    .replace(/(^|['’-])(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toUpperCase());
}

function removerPrefixos(tokens: string[]): { tokens: string[]; tratamento: string | null } {
  let t = [...tokens];
  const plano = (x: string) =>
    semAcento(x)
      .toLowerCase()
      .replace(/[.,;:!]+$/g, "");
  const tira = (frases: string[]): boolean => {
    for (const f of frases) {
      const partes = f.split(" ");
      if (t.length > partes.length && partes.every((p, i) => plano(t[i]) === p)) {
        t = t.slice(partes.length);
        return true;
      }
    }
    return false;
  };
  // "oi, bom dia, meu nome é ..." — cumprimentos, depois introdução
  for (let i = 0; i < 3 && tira(SAUDACOES); i++);
  tira(INTRODUCOES);
  let tratamento: string | null = null;
  while (t.length > 1 && TRATAMENTOS.has(plano(t[0]))) {
    tratamento = tratamento ?? TRATAMENTOS.get(plano(t[0])) ?? null;
    t = t.slice(1);
  }
  return { tokens: t, tratamento };
}

export function extrairNome(
  texto: string | null | undefined,
  quadro: readonly RespostaDoQuadro[] = SEMENTES_DO_QUADRO,
): NomeLido {
  const bruto = (texto ?? "").normalize("NFC").trim();
  if (!bruto) return { ok: false, motivo: "vazio" };
  if (bruto.length > 80) return { ok: false, motivo: "muito_longo" };
  if (/https?:|www\.|@|\.com\b|\.br\b/i.test(bruto)) return { ok: false, motivo: "link" };
  if (/\p{Extended_Pictographic}/u.test(bruto)) return { ok: false, motivo: "emoji" };
  if (/\d/.test(bruto)) return { ok: false, motivo: "digito" };
  if (/[?¿]/.test(bruto)) return { ok: false, motivo: "pergunta" };

  const limpo = bruto
    .replace(/[!.,;:]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) return { ok: false, motivo: "vazio" };

  const { tokens, tratamento } = removerPrefixos(limpo.split(" "));
  if (tokens.length === 0) return { ok: false, motivo: "vazio" };
  const planoDe = (x: string) => semAcento(x).toLowerCase().replace(/[.]+$/g, "");
  if (tokens.length === 1 && TRATAMENTOS.has(planoDe(tokens[0])))
    return { ok: false, motivo: "vazio" };
  // até 4 palavras de nome, fora os conectores (da, de, do...), e no máximo 6 no total
  const semConectores = tokens.filter((p) => !CONECTORES.has(semAcento(p).toLowerCase()));
  if (semConectores.length > 4 || tokens.length > 6)
    return { ok: false, motivo: "muitas_palavras" };
  if (!tokens.every((p) => LETRAS.test(p))) return { ok: false, motivo: "caractere_invalido" };

  const planos = tokens.map((p) => semAcento(p).toLowerCase());
  if (CONECTORES.has(planos[0]) || CONECTORES.has(planos[planos.length - 1]))
    return { ok: false, motivo: "conector_no_fim_ou_comeco" };
  for (let i = 0; i < tokens.length; i++) {
    if (CONECTORES.has(planos[i])) continue;
    const n = planos[i].replace(/['’-]/g, "").length;
    if (n < 2 || n > 20) return { ok: false, motivo: "palavra_curta_ou_longa" };
    if (NAO_E_NOME.has(planos[i]) || PREFIXOS_BARRADOS.some((p) => planos[i].startsWith(p)))
      return { ok: false, motivo: "palavra_barrada" };
  }
  // a mesma lista do banco: se o texto montado com este nome seria barrado pelo verificador (que o banco espelha),
  // não é nome. Sem isto, "Pix" virava "Prazer, Pix!", o texto era barrado e a triagem desligava para todos.
  const barradoPeloVerificador = (x: string) => !verificarTexto(x, "cliente").ok;
  if (barradoPeloVerificador(tokens.join(" ")) || tokens.some(barradoPeloVerificador))
    return { ok: false, motivo: "palavra_barrada" };
  const principais = tokens.filter((_, i) => !CONECTORES.has(planos[i]));
  if (principais[0].replace(/['’-]/g, "").length > 15)
    return { ok: false, motivo: "primeiro_nome_longo" };

  // o que casa com o quadro em qualquer passo (sim, ok, quero banner...) não é nome
  if (interpretar(tokens.join(" "), null, quadro, { qualquerPasso: true }).intencao !== "nao_sei") {
    return { ok: false, motivo: "e_resposta_do_quadro" };
  }

  const nome = tokens
    .map((p, i) => (CONECTORES.has(planos[i]) ? planos[i] : maiusculaInicial(p)))
    .join(" ");
  // a coluna do banco guarda até 60 letras: nome maior que isso o banco recusaria em silêncio
  if (nome.length > 60) return { ok: false, motivo: "muito_longo" };
  return {
    ok: true,
    nome,
    primeiroNome: maiusculaInicial(principais[0]),
    completo: principais.length >= 2,
    palavras: tokens.length,
    tratamento,
  };
}

/** Resposta ao "qual é o seu sobrenome?": junta ao primeiro nome, ou aceita o nome completo repetido. */
export function extrairSobrenome(
  texto: string | null | undefined,
  primeiroNome: string,
  quadro: readonly RespostaDoQuadro[] = SEMENTES_DO_QUADRO,
): NomeLido {
  const lido = extrairNome(texto, quadro);
  if (!lido.ok) return lido;
  const mesmoPrimeiro =
    semAcento(lido.primeiroNome).toLowerCase() === semAcento(primeiroNome).toLowerCase();
  if (lido.completo && mesmoPrimeiro) return lido;
  if (lido.palavras > 3) return { ok: false, motivo: "muitas_palavras" };
  return extrairNome(`${primeiroNome} ${lido.nome}`, quadro);
}

/* ------------------------------------------------------------------ */
/* CEP                                                                 */
/* ------------------------------------------------------------------ */

export type CepLido = { ok: true; cep: string; formatado: string } | { ok: false };

/** CEP com ou sem hífen, com ponto ou espaço, no meio de uma frase. Nunca pedaço de telefone. */
export function extrairCep(texto: string | null | undefined): CepLido {
  const t = texto ?? "";
  const re = /(?<!\d)(\d{2})\.?(\d{3})[-\s]?(\d{3})(?!\d)/g;
  for (const m of t.matchAll(re)) {
    const cep = `${m[1]}${m[2]}${m[3]}`;
    if (/^(\d)\1{7}$/.test(cep)) continue;
    // um pedaço de "99111-2233" já foi barrado pelo (?!\d); aqui barra "96 99111 223"
    const depois = t.slice((m.index ?? 0) + m[0].length);
    if (/^[-\s]?\d/.test(depois)) continue;
    return { ok: true, cep, formatado: `${cep.slice(0, 5)}-${cep.slice(5)}` };
  }
  return { ok: false };
}

/** Texto que parece endereço escrito à mão (rua, avenida, bairro, número da casa). */
export function pareceEndereco(texto: string | null | undefined): boolean {
  const t = semAcento(texto ?? "").toLowerCase();
  if (t.trim().length < 8) return false;
  return (
    /\b(rua|avenida|av|travessa|tv|alameda|rodovia|estrada|bairro|quadra|qd|lote|apto|apartamento|casa|conjunto|residencial|beco|passagem)\b/.test(
      t,
    ) || /\b(n|no|numero)\s*\d+/.test(t)
  );
}

/* ------------------------------------------------------------------ */
/* Telefone                                                            */
/* ------------------------------------------------------------------ */

export type TelefoneLido =
  | { ok: true; chave: string; legivel: string; final: string }
  | {
      ok: false;
      motivo: "sem_numero" | "curto" | "longo" | "sem_ddd" | "nao_e_celular" | "varios";
    };

const CELULAR_BR = /^[1-9][1-9]9\d{8}$/;

/** O número do chat serve para mostrar e confirmar? Decide pelo sufixo lid e pelo formato, não pelo tamanho. */
export function telefoneDoChatUtilizavel(chat: {
  normalizado: string | null;
  ehLid: boolean;
}): boolean {
  if (chat.ehLid || !chat.normalizado) return false;
  const chave = chaveWhatsApp(chat.normalizado);
  return !!chave && CELULAR_BR.test(chave);
}

/** O celular brasileiro (sem o 55) que o texto carrega, ou nulo. Decide só pelo formato. */
export function celularBrasileiro(valor: string | null | undefined): string | null {
  const chave = chaveWhatsApp(valor);
  return chave && CELULAR_BR.test(chave) ? chave : null;
}

/**
 * O valor tem cara de lid (o identificador interno do WhatsApp) e não de telefone?
 * Decide pelo FORMATO, nunca por a conversa ter ou não um `chat_lid` guardado: quase toda
 * conversa tem um, e junto dele o telefone real (em 13/11/2026, 142 das 145 conversas com
 * lid tinham celular brasileiro normal). Tem cara de lid:
 *   - qualquer coisa com "@" (o sufixo de endereço do WhatsApp, como "@lid");
 *   - dígitos que não formam celular brasileiro e têm de 12 a 15 posições. Número de fora
 *     cai aqui também: de longe ele é igual a um lid, e a triagem não manda nada para ele.
 * Celular brasileiro, com ou sem 55, nunca tem cara de lid.
 */
export function telefoneComCaraDeLid(valor: string | null | undefined): boolean {
  const bruto = (valor ?? "").trim();
  if (!bruto) return false;
  if (bruto.includes("@")) return true;
  if (celularBrasileiro(bruto)) return false;
  const digitos = bruto.replace(/\D/g, "");
  return digitos.length >= 12 && digitos.length <= 15;
}

/**
 * A triagem só escreve para celular brasileiro. Qualquer outra coisa (lid, número de fora,
 * telefone fixo, vazio) fica sem mensagem do robô: o consumidor da fila de envio aceita 12 a
 * 15 dígitos como número de fora, e um lid mandado assim falha no Z-API.
 */
export function triagemPodeFalarCom(valor: string | null | undefined): boolean {
  return celularBrasileiro(valor) !== null;
}

export function finalDoTelefone(telefone: string | null | undefined): string {
  const d = (telefone ?? "").replace(/\D/g, "");
  return d.slice(-4);
}

/**
 * Telefone brasileiro escrito pelo contato: com e sem 55, com e sem o 9º dígito,
 * com parênteses, hífen ou espaço, no meio de uma frase. Usa a mesma chave que o
 * banco (`chaveWhatsApp`, espelho de `normalize_whatsapp_phone`).
 */
export function extrairTelefone(
  texto: string | null | undefined,
  opcoes: { dddPadrao?: string | null } = {},
): TelefoneLido {
  const t = texto ?? "";
  const grupos = [...t.matchAll(/\+?\(?\d[\d\s().-]{5,}\d/g)]
    // "68900-000" é CEP, nunca telefone sem DDD: não completa com o DDD padrão
    .filter((m) => !/^\d{5}-\d{3}$/.test(m[0].trim()))
    .map((m) => m[0].replace(/\D/g, ""))
    .filter((d) => d.length >= 8);
  if (grupos.length === 0)
    return { ok: false, motivo: t.replace(/\D/g, "").length > 0 ? "curto" : "sem_numero" };
  if (grupos.length > 1) return { ok: false, motivo: "varios" };
  let d = grupos[0].replace(/^0+/, "");
  if (d.length > 13) return { ok: false, motivo: "longo" };
  if ((d.length === 9 && d.startsWith("9")) || d.length === 8) {
    if (!opcoes.dddPadrao) return { ok: false, motivo: "sem_ddd" };
    d = opcoes.dddPadrao + d;
  }
  const chave = chaveWhatsApp(d);
  if (!chave || chave.length < 10) return { ok: false, motivo: "curto" };
  if (!CELULAR_BR.test(chave))
    return {
      ok: false,
      motivo: chave.length === 10 || chave.length === 11 ? "nao_e_celular" : "longo",
    };
  return { ok: true, chave, legivel: formatarTelefone(chave), final: chave.slice(-4) };
}
