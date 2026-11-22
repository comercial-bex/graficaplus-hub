/**
 * A FICHA QUE O VENDEDOR TRAZ DE FORA (22/11/2026). Função pura: sem banco, sem React, sem rede e SEM PREÇO.
 *
 * O vendedor gera a ficha de fabricação do troféu num gerador de imagem ou de texto (o pré-prompt abaixo diz o que pedir) e
 * quer que o sistema entenda: linha, altura, quantidade, arte e as peças de cada camada. Há dois jeitos de ler:
 *   1. o BLOCO `FICHA-BEX v1`, texto em formato fixo que o pré-prompt manda o gerador escrever no fim da resposta
 *      (`lerBlocoDaFicha`: determinístico, sem IA, sem custo, funciona sem chave);
 *   2. a IMAGEM da ficha, lida por um modelo de visão no servidor (`ficha-ia.ts`), que devolve os MESMOS campos e passa
 *      pelo mesmo filtro (`normalizarFichaDaIa`).
 *
 * Regras que os testes travam (`tests/trofeus-ficha-lida.test.ts`):
 *   * a leitura NÃO se limita ao cadastro: material, espessura, largura e altura entram como foram lidos (decisão do dono,
 *     22/11/2026); quem diz se cabe no modelo é `ficha-comparar.ts`;
 *   * "A CONFIRMAR", vazio e "não informado" viram nulo, nunca zero;
 *   * número absurdo (altura de 9 m, espessura de 80 cm) vira nulo com um aviso, nunca entra na tela;
 *   * nada aqui calcula preço: o preço é do servidor (`cotarTrofeu`).
 */
import type { Decoracao, LinhaDoTrofeu, TipoDeArte } from "./conta";

export type PecaLida = {
  nome: string;
  /** O material como a ficha escreveu ("acrílico cristal"). Pode não estar no cadastro. */
  material: string | null;
  espessuraMm: number | null;
  larguraCm: number | null;
  alturaCm: number | null;
  /** Por troféu. */
  quantidade: number;
  decoracao: Decoracao | null;
  maquina: string | null;
};

export type FichaLida = {
  linha: LinhaDoTrofeu | null;
  alturaCm: number | null;
  larguraCm: number | null;
  base: { larguraCm: number | null; alturaCm: number | null } | null;
  quantidade: number | null;
  urgente: boolean | null;
  arte: TipoDeArte | null;
  nomesIndividuais: number | null;
  /** Evento, edição ou ano, colocação, categoria e o que mais a ficha traga como texto do troféu. */
  textos: { chave: string; valor: string }[];
  pecas: PecaLida[];
  observacoes: string | null;
};

export type OrigemDaLeitura = "bloco" | "imagem" | "texto";

export type LeituraDaFicha = {
  origem: OrigemDaLeitura;
  ficha: FichaLida;
  /** O que o filtro estranhou (número absurdo, opção que não existe). */
  avisos: string[];
  /** O que a leitura de imagem disse que não conseguiu ler direito. */
  duvidas: string[];
};

export type ResultadoDoBloco = { ok: true; ficha: FichaLida; avisos: string[] } | { ok: false; erro: string };

export const FICHA_LIMITES = {
  pecasMaximas: 40,
  textoMaximo: 120,
  observacoesMaximas: 600,
  medidaMaximaCm: 500,
  espessuraMaximaMm: 100,
  quantidadeMaxima: 100000,
  textosMaximos: 12,
} as const;

export const SEM_BLOCO = "Não achei o bloco FICHA-BEX no texto colado. Copie o bloco inteiro, do \"FICHA-BEX v1\" até as observações.";

const semAcento = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const limpar = (s: unknown, max: number): string =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const SEM_VALOR = /^(a\s*confirmar|n\/?a|-+|\?+|\.+|…+|nao\s+informad[oa]|desconhecid[oa]|null|nulo|indefinid[oa]|vazio)$/;

/**
 * "A CONFIRMAR", traço, reticências, vazio e parentes: a ficha não disse. Um texto inteiro entre parênteses é o
 * marcador do modelo do pré-prompt que ninguém preencheu ("(a do pedido; se não souber, 1)").
 */
export function semValor(texto: unknown): boolean {
  const t = semAcento(String(texto ?? "")).replace(/[*_`]/g, "").trim();
  return t === "" || SEM_VALOR.test(t) || /^\(.*\)$/.test(t);
}

function fichaTemAlgo(f: FichaLida): boolean {
  return (
    f.linha != null ||
    f.alturaCm != null ||
    f.larguraCm != null ||
    f.base != null ||
    f.quantidade != null ||
    f.urgente != null ||
    f.arte != null ||
    f.nomesIndividuais != null ||
    f.textos.length > 0 ||
    f.pecas.length > 0 ||
    f.observacoes != null
  );
}

function primeiroNumero(texto: string): number | null {
  const m = texto.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "18", "18 cm", "18,5", "180 mm", "0,18 m" viram centímetros. Sem unidade é centímetro. Ilegível é nulo. */
export function medidaEmCm(texto: unknown): number | null {
  if (semValor(texto)) return null;
  const t = semAcento(String(texto));
  const n = primeiroNumero(t);
  if (n == null) return null;
  // Arredonda a conversão: 0,28 m × 100 dá 28,000000000000004 em ponto flutuante.
  const limpo = (x: number) => Math.round(x * 1e4) / 1e4;
  if (/\d\s*mm\b/.test(t)) return limpo(n / 10);
  if (/\d\s*cm\b/.test(t)) return n;
  if (/\d\s*m\b/.test(t)) return limpo(n * 100);
  return n;
}

/** Espessura em milímetros. "3", "3 mm", "0,3 cm". Sem unidade é milímetro. */
export function espessuraEmMm(texto: unknown): number | null {
  if (semValor(texto)) return null;
  const t = semAcento(String(texto));
  const n = primeiroNumero(t);
  if (n == null) return null;
  return /\d\s*cm\b/.test(t) ? Math.round(n * 10 * 1e4) / 1e4 : n;
}

function inteiro(texto: unknown, minimo: number): number | null {
  if (semValor(texto)) return null;
  const n = primeiroNumero(semAcento(String(texto)));
  if (n == null || !Number.isInteger(n) || n < minimo) return null;
  return n;
}

const arredonda = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

/** Medida aceitável: maior que zero e dentro do que uma ficha de troféu pode trazer. Fora disso é nulo, com aviso. */
function medidaValida(n: number | null, rotulo: string, avisos: string[]): number | null {
  if (n == null) return null;
  if (!(n > 0) || n > FICHA_LIMITES.medidaMaximaCm) {
    avisos.push(`${rotulo}: o valor lido (${arredonda(n)} cm) não parece uma medida de troféu e foi ignorado.`);
    return null;
  }
  return arredonda(n);
}

function espessuraValida(n: number | null, rotulo: string, avisos: string[]): number | null {
  if (n == null) return null;
  if (!(n > 0) || n > FICHA_LIMITES.espessuraMaximaMm) {
    avisos.push(`${rotulo}: a espessura lida (${arredonda(n)} mm) não parece de acrílico e foi ignorada.`);
    return null;
  }
  return arredonda(n);
}

export function linhaDoTexto(texto: unknown): LinhaDoTrofeu | null {
  const t = semAcento(String(texto ?? ""));
  if (/\|/.test(t)) return null; // o modelo do bloco com as três opções ainda não preenchido
  if (/econom/.test(t)) return "economico";
  if (/padr/.test(t)) return "padrao";
  if (/premium|premio/.test(t)) return "premium";
  return null;
}

export function arteDoTexto(texto: unknown): TipoDeArte | null {
  const t = semAcento(String(texto ?? ""));
  if (/\|/.test(t)) return null;
  if (/cliente/.test(t)) return "cliente_manda";
  if (/adapt|modelo/.test(t)) return "adaptar_modelo";
  if (/exclus|criac|do zero/.test(t)) return "criacao_exclusiva";
  return null;
}

export function decoracaoDoTexto(texto: unknown): Decoracao | null {
  const t = semAcento(String(texto ?? ""));
  if (/\|/.test(t)) return null;
  if (/grav/.test(t)) return "gravacao_laser";
  if (/vinil|impress|laminad|plotter/.test(t)) return "vinil_laminado";
  if (/nenhum|sem\b|liso|puro|nada/.test(t)) return "nenhuma";
  return null;
}

function simNao(texto: unknown): boolean | null {
  const t = semAcento(String(texto ?? "")).trim();
  if (/\|/.test(t)) return null;
  if (/^(sim|s|true|urgente|yes)\b/.test(t)) return true;
  if (/^(nao|n|false|no|normal)\b/.test(t)) return false;
  return null;
}

/** "20 x 7", "20 cm x 7 cm", "200 x 70 mm": largura e altura da base. A unidade escrita só no fim vale para os dois. */
function baseDoTexto(texto: string, avisos: string[]): FichaLida["base"] {
  if (semValor(texto)) return null;
  const t = semAcento(texto);
  const unidade = /\bmm\b/.test(t) ? " mm" : /\bcm\b/.test(t) ? " cm" : /\d\s*m\b/.test(t) ? " m" : "";
  const comUnidade = (p: string | undefined) => (p && !/[a-z]/.test(p) ? `${p.trim()}${unidade}` : (p ?? ""));
  const partes = t.split(/\s*(?:x|×|por)\s*/);
  const a = medidaValida(medidaEmCm(comUnidade(partes[0])), "Base, largura", avisos);
  const b = medidaValida(medidaEmCm(comUnidade(partes[1])), "Base, altura", avisos);
  if (a == null && b == null) return null;
  return { larguraCm: a, alturaCm: b };
}

function textosDoTexto(texto: string): FichaLida["textos"] {
  if (semValor(texto)) return [];
  return texto
    .split(/[;\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, FICHA_LIMITES.textosMaximos)
    .flatMap((p) => {
      const i = p.indexOf("=");
      if (i <= 0) return [];
      const chave = limpar(p.slice(0, i), 40);
      const valor = limpar(p.slice(i + 1), FICHA_LIMITES.textoMaximo);
      return chave && valor && !semValor(valor) ? [{ chave, valor }] : [];
    });
}

export function fichaVazia(): FichaLida {
  return {
    linha: null,
    alturaCm: null,
    larguraCm: null,
    base: null,
    quantidade: null,
    urgente: null,
    arte: null,
    nomesIndividuais: null,
    textos: [],
    pecas: [],
    observacoes: null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// O bloco FICHA-BEX
// ---------------------------------------------------------------------------------------------------------

const CAMPOS: Record<string, string> = {
  linha: "linha",
  altura: "altura",
  altura_cm: "altura",
  largura: "largura",
  largura_cm: "largura",
  base: "base",
  base_cm: "base",
  quantidade: "quantidade",
  urgencia: "urgencia",
  arte: "arte",
  nomes_individuais: "nomes",
  nomes: "nomes",
  textos: "textos",
  pecas: "pecas",
  observacoes: "observacoes",
  observacao: "observacoes",
};

function nomeDoCampo(bruto: string): string | null {
  const limpo = semAcento(bruto)
    .replace(/\([^)]*\)/g, "")
    .replace(/[*`#>]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return CAMPOS[limpo] ?? null;
}

export function temBlocoDaFicha(texto: string): boolean {
  return /FICHA[\s_-]*BEX/i.test(String(texto ?? ""));
}

function pecaDaLinha(linha: string, avisos: string[]): PecaLida | null {
  const campos = linha
    .replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "")
    .split("|")
    .map((c) => c.trim());
  const nome = limpar(campos[0], 80);
  if (!nome || semValor(nome)) return null;
  // A linha-modelo do pré-prompt ("nome | material | espessura_mm | ...") que ninguém preencheu não é peça.
  if (semAcento(nome) === "nome" && semAcento(campos[1] ?? "") === "material") return null;
  const rotulo = `Peça "${nome}"`;
  const material = campos[1] && !semValor(campos[1]) ? limpar(campos[1], FICHA_LIMITES.textoMaximo) : null;
  const quantidade = inteiro(campos[5], 1);
  const maquina = campos[7] && !semValor(campos[7]) ? limpar(campos[7], 60) : null;
  return {
    nome,
    material,
    espessuraMm: espessuraValida(espessuraEmMm(campos[2]), rotulo, avisos),
    larguraCm: medidaValida(medidaEmCm(campos[3]), `${rotulo}, largura`, avisos),
    alturaCm: medidaValida(medidaEmCm(campos[4]), `${rotulo}, altura`, avisos),
    quantidade: quantidade != null && quantidade <= FICHA_LIMITES.quantidadeMaxima ? quantidade : 1,
    decoracao: decoracaoDoTexto(campos[6]),
    maquina,
  };
}

/**
 * Lê o bloco `FICHA-BEX v1` que o pré-prompt manda o gerador escrever. Tolera o texto em volta, cercas de código, negrito,
 * "A CONFIRMAR" e as opções do modelo ainda não preenchidas. Só falha quando não há bloco ou nada dele foi entendido.
 */
export function lerBlocoDaFicha(texto: string): ResultadoDoBloco {
  const fonte = String(texto ?? "");
  const marcador = /FICHA[\s_-]*BEX[^\n]*/i.exec(fonte);
  if (!marcador) return { ok: false, erro: SEM_BLOCO };
  const linhas = fonte.slice(marcador.index + marcador[0].length).split(/\r?\n/);

  const ficha = fichaVazia();
  const avisos: string[] = [];
  let nasPecas = false;
  const observacoes: string[] = [];
  let nasObservacoes = false;

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.replace(/```[a-z]*/gi, "").trimEnd();
    if (linha.trim() === "") continue;

    if (nasPecas && /^\s*(?:[-•*]|\d+[.)])\s+/.test(linha)) {
      if (ficha.pecas.length >= FICHA_LIMITES.pecasMaximas) continue;
      const peca = pecaDaLinha(linha, avisos);
      if (peca) ficha.pecas.push(peca);
      continue;
    }

    const m = linha.match(/^\s*(?:[-•*]\s*)?\**([A-Za-zÀ-ÿ_ ]+?(?:\([^)]*\))?)\**\s*:\s*(.*)$/);
    const campo = m ? nomeDoCampo(m[1]) : null;
    if (!m || !campo) {
      if (nasObservacoes) observacoes.push(linha.trim());
      continue;
    }
    nasPecas = campo === "pecas";
    nasObservacoes = campo === "observacoes";
    const valor = m[2].replace(/[*`]/g, "").trim();
    if (campo === "pecas") continue;
    if (campo === "observacoes") {
      if (!semValor(valor)) observacoes.push(valor);
      continue;
    }
    if (semValor(valor)) continue;

    switch (campo) {
      case "linha": {
        const l = linhaDoTexto(valor);
        if (l) ficha.linha = l;
        else avisos.push(`Linha "${limpar(valor, 40)}" não reconhecida: escolha o modelo na calculadora.`);
        break;
      }
      case "altura":
        ficha.alturaCm = medidaValida(medidaEmCm(valor), "Altura", avisos);
        break;
      case "largura":
        ficha.larguraCm = medidaValida(medidaEmCm(valor), "Largura", avisos);
        break;
      case "base":
        ficha.base = baseDoTexto(valor, avisos);
        break;
      case "quantidade": {
        const q = inteiro(valor, 1);
        if (q != null && q <= FICHA_LIMITES.quantidadeMaxima) ficha.quantidade = q;
        else avisos.push("Quantidade não entendida: digite o número de troféus na calculadora.");
        break;
      }
      case "urgencia":
        ficha.urgente = simNao(valor);
        break;
      case "arte": {
        const a = arteDoTexto(valor);
        if (a) ficha.arte = a;
        else avisos.push(`Tipo de arte "${limpar(valor, 40)}" não reconhecido: escolha na calculadora.`);
        break;
      }
      case "nomes": {
        const n = inteiro(valor, 0);
        if (n != null && n <= FICHA_LIMITES.quantidadeMaxima) ficha.nomesIndividuais = n;
        break;
      }
      case "textos":
        ficha.textos = textosDoTexto(valor);
        break;
    }
  }

  const obs = limpar(observacoes.join(" "), FICHA_LIMITES.observacoesMaximas);
  ficha.observacoes = obs || null;
  if (!fichaTemAlgo(ficha)) return { ok: false, erro: "O bloco FICHA-BEX está vazio ou fora do formato. Peça ao gerador para preencher todos os campos." };
  return { ok: true, ficha, avisos };
}

// ---------------------------------------------------------------------------------------------------------
// O que a leitura de imagem devolve
// ---------------------------------------------------------------------------------------------------------

type Solto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Solto => typeof v === "object" && v !== null && !Array.isArray(v);

function numeroSolto(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return primeiroNumero(semAcento(v));
  return null;
}

/**
 * O filtro entre o que o modelo de visão diz e o que a tela aceita. Resposta ilegível é nulo; campo fora do formato vira
 * nulo; número absurdo é ignorado com aviso; texto é aparado. O que o modelo escreveu nunca vira instrução.
 */
export function normalizarFichaDaIa(bruto: unknown): { ficha: FichaLida; avisos: string[]; duvidas: string[] } | null {
  let dado: unknown = bruto;
  if (typeof dado === "string") {
    try {
      dado = JSON.parse(dado);
    } catch {
      return null;
    }
  }
  if (!ehObjeto(dado)) return null;

  const avisos: string[] = [];
  const ficha = fichaVazia();
  ficha.linha = linhaDoTexto(dado.linha);
  ficha.alturaCm = medidaValida(numeroSolto(dado.altura_cm), "Altura", avisos);
  ficha.larguraCm = medidaValida(numeroSolto(dado.largura_cm), "Largura", avisos);
  const baseL = medidaValida(numeroSolto(dado.base_largura_cm), "Base, largura", avisos);
  const baseA = medidaValida(numeroSolto(dado.base_altura_cm), "Base, altura", avisos);
  ficha.base = baseL != null || baseA != null ? { larguraCm: baseL, alturaCm: baseA } : null;
  const q = numeroSolto(dado.quantidade);
  ficha.quantidade = q != null && Number.isInteger(q) && q >= 1 && q <= FICHA_LIMITES.quantidadeMaxima ? q : null;
  ficha.urgente = typeof dado.urgente === "boolean" ? dado.urgente : null;
  ficha.arte = arteDoTexto(dado.arte);
  const n = numeroSolto(dado.nomes_individuais);
  ficha.nomesIndividuais = n != null && Number.isInteger(n) && n >= 0 && n <= FICHA_LIMITES.quantidadeMaxima ? n : null;

  if (Array.isArray(dado.textos)) {
    ficha.textos = dado.textos
      .filter(ehObjeto)
      .slice(0, FICHA_LIMITES.textosMaximos)
      .map((t) => ({ chave: limpar(t.chave, 40), valor: limpar(t.valor, FICHA_LIMITES.textoMaximo) }))
      .filter((t) => t.chave && t.valor && !semValor(t.valor));
  }

  if (Array.isArray(dado.pecas)) {
    for (const p of dado.pecas.filter(ehObjeto).slice(0, FICHA_LIMITES.pecasMaximas)) {
      const nome = limpar(p.nome, 80);
      if (!nome) continue;
      const rotulo = `Peça "${nome}"`;
      const qtd = numeroSolto(p.quantidade);
      const material = limpar(p.material, FICHA_LIMITES.textoMaximo);
      const maquina = limpar(p.maquina, 60);
      ficha.pecas.push({
        nome,
        material: material && !semValor(material) ? material : null,
        espessuraMm: espessuraValida(numeroSolto(p.espessura_mm), rotulo, avisos),
        larguraCm: medidaValida(numeroSolto(p.largura_cm), `${rotulo}, largura`, avisos),
        alturaCm: medidaValida(numeroSolto(p.altura_cm), `${rotulo}, altura`, avisos),
        quantidade: qtd != null && Number.isInteger(qtd) && qtd >= 1 && qtd <= FICHA_LIMITES.quantidadeMaxima ? qtd : 1,
        decoracao: decoracaoDoTexto(p.decoracao),
        maquina: maquina && !semValor(maquina) ? maquina : null,
      });
    }
  }
  const obs = limpar(dado.observacoes, FICHA_LIMITES.observacoesMaximas);
  ficha.observacoes = obs && !semValor(obs) ? obs : null;

  const duvidas = Array.isArray(dado.duvidas)
    ? dado.duvidas
        .map((d) => limpar(d, 200))
        .filter((d) => d && !semValor(d))
        .slice(0, 10)
    : [];

  const algo = fichaTemAlgo(ficha);
  if (!algo) return null;
  return { ficha, avisos, duvidas };
}

// ---------------------------------------------------------------------------------------------------------
// O pré-prompt
// ---------------------------------------------------------------------------------------------------------

/** O bloco que o gerador escreve no fim. Os nomes dos campos são os que `lerBlocoDaFicha` entende. */
export const BLOCO_DA_FICHA = [
  "FICHA-BEX v1",
  "linha: economico | padrao | premium",
  "altura_cm:",
  "largura_cm:",
  "base_cm: (largura x altura)",
  "quantidade: (a do pedido; se não souber, 1)",
  "urgencia: sim | nao",
  "arte: cliente_manda | adaptar_modelo | criacao_exclusiva",
  "nomes_individuais: (quantos textos diferentes por troféu, por exemplo o nome do atleta)",
  "textos: evento=...; ano=...; colocacao=...; categoria=...",
  "pecas:",
  "- nome | material | espessura_mm | largura_cm | altura_cm | qtd_por_trofeu | decoracao (nenhuma | vinil_laminado | gravacao_laser) | maquina",
  "observacoes:",
].join("\n");

/**
 * O texto que se cola no gerador (de imagem ou de texto) ANTES do pedido do cliente. Não limita material, espessura nem
 * medida ao que há em estoque ou no cadastro: o gerador diz o que o projeto pede e a calculadora aponta o que não bate.
 */
export const PRE_PROMPT_DA_FICHA = `Você vai criar a FICHA DE FABRICAÇÃO de um troféu de acrílico para a Bex Print (Macapá-AP).

1) COMO A CASA TRABALHA
- Linhas de troféu: ECONÔMICO (placa principal e base, arte em vinil impresso e laminado), PADRÃO (duas camadas na placa, base e placa frontal) e PREMIUM (várias camadas: coluna, aros, silhueta gravada, placa da edição, suporte e base).
- Use os materiais, as espessuras e as medidas que o projeto pedir: a casa confere depois. Para CADA peça informe o material (tipo e cor), a espessura em mm e a largura e a altura em cm.
- Máquinas da casa: laser CO2 100 W (corta e grava acrílico até 10 mm; no cadastro, CNC Laser 10060), plotter de impressão (vinil impresso e laminação) e plotter de recorte. Se o projeto pedir outro processo (UV/DTF, fresa, laser de fibra), escreva em "observacoes" em vez de assumir que existe.
- Não escreva preço nem prazo. Não invente medida: se não souber, escreva "A CONFIRMAR".
- Todo texto dentro da imagem em português, legível, sem letras sobrepostas ou cortadas.

2) CONTEÚDO DA FICHA
Vista montada; vista explodida numerada; tabela de peças (nome, material, espessura, largura x altura, quantidade, decoração, máquina); passo a passo da montagem; dados personalizados (evento, edição ou ano, colocação, categoria, textos da base).

3) NO FIM DA RESPOSTA, em texto simples (fora da imagem), escreva este bloco preenchido, sem mudar os nomes dos campos:
${BLOCO_DA_FICHA}

PEDIDO DO CLIENTE: <cole aqui o pedido>`;
