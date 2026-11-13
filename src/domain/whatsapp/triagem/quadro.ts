import { contarPalavras, normalizarTexto } from "./normalizar";
import type { Intencao, RespostaDoQuadro } from "./tipos";

/**
 * Interpreta o que o contato escreveu pelo QUADRO de respostas possíveis.
 *
 * O quadro é dado injetado (linhas de `whatsapp_triagem_respostas`), não código:
 * o dono acrescenta frases, nunca intenções. A ordem de decisão:
 *
 *  1. Camadas de prioridade. Quem pede para PARAR vence tudo; depois robô de
 *     empresa (`automatica`); depois pedido de gente (`falar_com_equipe`,
 *     `reclamacao`); depois pergunta de preço e palavra de parceiro; depois as
 *     respostas do passo; por último cortesia (saudação, agradecimento).
 *  2. Dentro da camada, mensagem inteira igual à frase (`igual`) vence quem só
 *     começa com ela ou a contém. `comeca` e `contem` ficam juntos.
 *  3. Frases de `sim`, `mudar`, `primeira_vez` e `ja_cliente` que aparecem
 *     negadas ("não ... sim") são descartadas.
 *  4. Se sobram duas intenções de famílias diferentes, a resposta é ambígua e
 *     vira `nao_sei` (a triagem repete a pergunta).
 */

export type Interpretacao = {
  intencao: Intencao;
  ambigua: boolean;
  candidatas: Intencao[];
  normalizado: string;
  palavras: number;
  /** Fala de parceiro, revenda ou tabela. Só serve para a resposta neutra de preço. */
  termoSensivel: boolean;
  /** A camada achou pergunta de preço junto com outra intenção da mesma família ("quero ser parceiro e saber o valor"). */
  tambemPreco: boolean;
};

const CAMADAS: readonly (readonly Intencao[])[] = [
  ["parar"],
  ["automatica"],
  ["falar_com_equipe", "reclamacao"],
  ["pergunta_preco", "parceiro"],
  ["sim", "nao", "mudar", "primeira_vez", "ja_cliente", "pular", "recusar"],
  ["saudacao", "agradecimento"],
];

/** Intenções da mesma família não geram ambiguidade; vence a primeira da lista. */
const FAMILIAS: readonly (readonly Intencao[])[] = [
  ["mudar", "nao"],
  ["recusar", "pular"],
  ["agradecimento", "saudacao"],
  ["falar_com_equipe", "reclamacao"],
  ["parceiro", "pergunta_preco"],
];

const PODE_SER_NEGADA: readonly Intencao[] = [
  "sim",
  "mudar",
  "primeira_vez",
  "ja_cliente",
  "parceiro",
];

/** "sou parceiro de obra do João": a frase de parceiro seguida de "de/do/da" é outro sentido, salvo "da Bex", "de gráfica" e "de vocês". */
function outroSentidoDeParceiro(texto: string, l: Linha): boolean {
  if (l.intencao !== "parceiro" || l.casamento === "igual") return false;
  const alvo = ` ${texto} `;
  const i = alvo.indexOf(` ${l.frase} `);
  if (i < 0) return false;
  const depois = alvo
    .slice(i + l.frase.length + 1)
    .trim()
    .split(" ");
  return (
    ["de", "do", "da", "dos", "das"].includes(depois[0]) &&
    !!depois[1] &&
    !["bex", "grafica", "graficas", "voces", "vcs", "impressao"].includes(depois[1])
  );
}

const SAUDACOES_INICIAIS = [
  "oi",
  "oii",
  "ola",
  "bom dia",
  "boa tarde",
  "boa noite",
  "opa",
  "e ai",
  "eai",
  "eae",
  "oie",
  "salve",
  "tudo bem",
  "tudo bom",
];

/** Maior mensagem que ainda vale como cortesia ("boa tarde, tudo bem?"). */
const MAX_PALAVRAS_CORTESIA = 5;
/** Palavra de parceiro só vale em mensagem curta; "meu parceiro indicou vocês, uma parceria..." não. */
const MAX_PALAVRAS_PARCEIRO = 9;

const TERMOS_SENSIVEIS =
  /\b(parceir\w*|parceri\w*|terceiriz\w*|revend\w*|revenda|tabela\w*|diferenciad\w*|atacado)\b/;

export function temTermoSensivel(normalizado: string): boolean {
  return TERMOS_SENSIVEIS.test(normalizado);
}

/** Tira "oi," "bom dia" etc. do começo, se sobrar alguma coisa depois. */
export function semSaudacaoInicial(normalizado: string): string {
  let t = normalizado;
  for (let volta = 0; volta < 4; volta++) {
    const achou = SAUDACOES_INICIAIS.find((s) => t.startsWith(s + " "));
    if (!achou) break;
    t = t.slice(achou.length + 1);
  }
  return t;
}

const VOCABULARIO_DE_CORTESIA = [
  "boa noite",
  "boa tarde",
  "bom dia",
  "tudo bem",
  "tudo bom",
  "td bem",
  "como vai",
  "e ai",
  "oi",
  "oii",
  "ola",
  "opa",
  "eai",
  "eae",
  "oie",
  "salve",
  "hey",
  "hello",
  "hi",
  "alo",
  "fala",
  "ai",
  "gente",
  "pessoal",
  "turma",
  "amigos",
  "voce",
  "vcs",
  "voces",
].sort((a, b) => b.length - a.length);

/** A mensagem inteira é só cumprimento ("oi, boa tarde pessoal")? */
export function soCortesia(normalizado: string): boolean {
  let t = normalizado;
  if (!t) return false;
  for (let volta = 0; volta < 8 && t; volta++) {
    const achou = VOCABULARIO_DE_CORTESIA.find((p) => t === p || t.startsWith(p + " "));
    if (!achou) return false;
    t = t.slice(achou.length).trim();
  }
  return t === "";
}

type Linha = { intencao: Intencao; frase: string; casamento: RespostaDoQuadro["casamento"] };

function casa(texto: string, l: Linha): boolean {
  switch (l.casamento) {
    case "igual":
      return texto === l.frase;
    case "comeca":
      return texto === l.frase || texto.startsWith(l.frase + " ");
    case "contem":
      return ` ${texto} `.includes(` ${l.frase} `);
  }
}

/** A frase aparece negada? "nao" logo antes dela, ou "nao" em qualquer lugar para `sim`. */
function negada(texto: string, l: Linha): boolean {
  if (l.casamento === "igual") return false;
  if (l.frase.split(" ").includes("nao")) return false;
  const palavras = texto.split(" ");
  if (l.intencao === "sim" && palavras.includes("nao")) return true;
  const alvo = ` ${texto} `;
  const i = alvo.indexOf(` ${l.frase} `);
  if (i < 0) return false;
  const antes = alvo.slice(0, i).trim().split(" ");
  // "não quero ser parceiro" casa também por "ser parceiro": para parceiro, "não" nas 3 palavras antes já nega
  if (l.intencao === "parceiro") return antes.slice(-3).includes("nao");
  return antes[antes.length - 1] === "nao";
}

type LinhaComPasso = Linha & { passo: string | null };

/** Normalizar o quadro inteiro a cada mensagem seria desperdício: o array é imutável, guarda por referência. */
const CACHE_DO_QUADRO = new WeakMap<readonly RespostaDoQuadro[], LinhaComPasso[]>();

function linhasNormalizadas(quadro: readonly RespostaDoQuadro[]): LinhaComPasso[] {
  let linhas = CACHE_DO_QUADRO.get(quadro);
  if (!linhas) {
    linhas = quadro
      .filter((r) => r.ativo !== false)
      .map((r) => ({
        passo: r.passo,
        intencao: r.intencao,
        frase: normalizarTexto(r.frase),
        casamento: r.casamento,
      }));
    CACHE_DO_QUADRO.set(quadro, linhas);
  }
  return linhas;
}

export function linhasDoPasso(
  quadro: readonly RespostaDoQuadro[],
  passo: string | null,
  qualquerPasso = false,
): Linha[] {
  return linhasNormalizadas(quadro).filter(
    (l) => qualquerPasso || l.passo === null || l.passo === passo,
  );
}

function reduzirPorFamilia(candidatas: Intencao[]): Intencao[] {
  const out = new Set<Intencao>(candidatas);
  for (const fam of FAMILIAS) {
    const presentes = fam.filter((i) => out.has(i));
    for (const i of presentes.slice(1)) out.delete(i);
  }
  return [...out];
}

export function interpretar(
  texto: string | null | undefined,
  passo: string | null,
  quadro: readonly RespostaDoQuadro[],
  opcoes: { qualquerPasso?: boolean } = {},
): Interpretacao {
  const normalizado = normalizarTexto(texto);
  const palavras = contarPalavras(normalizado);
  const base: Interpretacao = {
    intencao: "nao_sei",
    ambigua: false,
    candidatas: [],
    normalizado,
    palavras,
    termoSensivel: temTermoSensivel(normalizado),
    tambemPreco: false,
  };
  if (!normalizado) return base;

  const linhas = linhasDoPasso(quadro, passo, opcoes.qualquerPasso);
  const semSaud = semSaudacaoInicial(normalizado);
  const versoes = semSaud === normalizado ? [normalizado] : [normalizado, semSaud];

  for (const camada of CAMADAS) {
    const doNivel = linhas.filter((l) => camada.includes(l.intencao));
    const iguais = new Set<Intencao>();
    const outras = new Set<Intencao>();
    for (const l of doNivel) {
      if (l.intencao === "saudacao" || l.intencao === "agradecimento") {
        if (palavras > MAX_PALAVRAS_CORTESIA) continue;
      }
      if (l.intencao === "parceiro" && palavras > MAX_PALAVRAS_PARCEIRO) continue;
      // "oi parceiro", "e aí parceiro": vocativo, não pedido. A palavra solta só vale como mensagem inteira.
      const candidatasDaFrase =
        l.intencao === "parceiro" && l.casamento === "igual" && /^parce(i|ri)/.test(l.frase)
          ? [normalizado]
          : versoes;
      for (const v of candidatasDaFrase) {
        if (!casa(v, l)) continue;
        if (PODE_SER_NEGADA.includes(l.intencao) && negada(v, l)) continue;
        if (outroSentidoDeParceiro(v, l)) continue;
        (l.casamento === "igual" ? iguais : outras).add(l.intencao);
        break;
      }
    }
    // cortesia que sobra numa mensagem com conteúdo ("oi, quero um banner") não decide nada
    if (
      camada.includes("saudacao") &&
      palavras <= MAX_PALAVRAS_CORTESIA + 1 &&
      soCortesia(normalizado)
    )
      iguais.add("saudacao");
    const achadas = iguais.size > 0 ? [...iguais] : [...outras];
    if (achadas.length === 0) continue;
    const reduzidas = reduzirPorFamilia(achadas);
    const tambemPreco = reduzidas.includes("parceiro") && achadas.includes("pergunta_preco");
    if (reduzidas.length === 1)
      return { ...base, intencao: reduzidas[0], candidatas: reduzidas, tambemPreco };
    // "parar" e "falar com equipe" nunca são ambíguos: já saíram nas camadas anteriores
    return { ...base, intencao: "nao_sei", ambigua: true, candidatas: reduzidas };
  }
  return base;
}

/** Palavra ou frase de parceiro, na mensagem inteira curta (nunca "meu parceiro indicou vocês"). */
export function ehPalavraDeParceiro(
  texto: string | null | undefined,
  quadro: readonly RespostaDoQuadro[],
): boolean {
  const i = interpretar(texto, null, quadro);
  return i.intencao === "parceiro" && !i.tambemPreco;
}
