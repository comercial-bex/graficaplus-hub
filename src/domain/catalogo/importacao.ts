import {
  MODALIDADES_BASE,
  ehUnidadeDePreco,
  type Modalidade,
  type UnidadeDePreco,
} from "@/domain/catalogo/modalidades";
import { arredondar } from "@/domain/catalogo/preco-de-venda";

/**
 * Sincronizar o catálogo com a planilha nova do fornecedor.
 *
 * O fornecedor manda tabela nova todo mês. A planilha segue o modelo de
 * `tabela-luga.xlsx` (aba "dados": uma linha por item, uma coluna de CUSTO por
 * opção de preço). Esta tela lê a planilha, casa cada linha com o item que já
 * existe e mostra, ANTES de gravar, o que muda: itens novos, custo que subiu,
 * custo que desceu, item que saiu da tabela, item que voltou.
 *
 * O casamento é daqui; a gravação é do banco (`catalogo_importar`), que
 * confere tudo de novo. Por isso a prévia tem de contar EXATAMENTE como o banco
 * conta — mesmo arredondamento de custo (4 casas), mesma precedência (voltou >
 * subiu > desceu > outra mudança > igual). E por isso o casamento por código e
 * descrição é mais largo que a trava do banco (que recusa criar um item que já
 * existe): toda linha que o banco consideraria repetida, este arquivo já casou.
 *
 * O que a planilha NÃO mexe: nome, especificação e foto (são da equipe), e o
 * mínimo, o múltiplo e a faixa de cada opção que já existe — a planilha só traz
 * o mínimo do item; o da opção veio do cabeçalho da seção na carga e vai junto.
 *
 * Domínio puro.
 */

export type Celula = string | number | boolean | Date | null | undefined;

/** Coluna de custo da planilha → opção de preço. */
export const COLUNAS_DE_CUSTO: Record<string, Modalidade> = {
  custo_sem_gravacao: "sem_gravacao",
  custo_gravada_1_cor: "gravada_1_cor",
  custo_gravada_mais_pagina: "gravada_mais_pagina",
  valor_unico: "valor_unico",
  custo_gravacao_laser: "gravacao_laser",
  custo_baixo_relevo: "baixo_relevo",
  custo_gravada_100_199: "gravada_100_199",
  custo_gravada_acima_1000: "gravada_acima_1000",
  custo_com_gravacao: "com_gravacao",
  custo_transfer_giro: "transfer_giro",
};

export const COLUNAS_OBRIGATORIAS = ["secao", "codigo", "descricao"] as const;

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "Unidade do preço" → "unidade_do_preco": o cabeçalho escrito de qualquer jeito. */
export function chaveDaColuna(cabecalho: string): string {
  return semAcento(String(cabecalho ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Valor em reais no meio do texto ("JOGO SAI R$ 6,55 C/20 FLS") é custo e não
 * fica em texto que a equipe toda lê. Igual a `fornecedor_sem_valores()`.
 */
export function semValores(texto: string): string {
  return texto.replace(/R\$\s*[0-9][0-9.,]*/gi, "(valor na tabela)");
}

/**
 * O código como a planilha e o nome de arquivo o escrevem varia ("05049" ×
 * "5049", "LG C14" × "LGC14"). Igual a `fornecedor_codigo_normalizado()`.
 */
export function normalizarCodigo(codigo: string | null | undefined): string | null {
  const limpo = String(codigo ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .replace(/^0+/, "");
  return limpo === "" ? null : limpo;
}

/** Descrição para casar: sem valor, sem acento, sem diferença de caixa e de espaço. */
export function normalizarDescricao(descricao: string): string {
  return semAcento(semValores(descricao)).toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Número de planilha em português. A célula numérica do Excel já vem número;
 * a de texto pode vir "0,146" — e a leitura genérica da casa (`lerNumero`)
 * trata vírgula seguida de 3 dígitos como milhar e leria 146. Custo de argola é
 * R$ 0,146: aqui vírgula sozinha é SEMPRE decimal.
 *   "1.234,56" → 1234.56   "0,146" → 0.146   "12.5" → 12.5   "***" → null
 */
export function lerNumeroBR(celula: Celula): number | null | "ilegivel" {
  if (celula == null) return null;
  if (typeof celula === "number") return Number.isFinite(celula) ? celula : "ilegivel";
  if (typeof celula !== "string") return "ilegivel";
  const texto = celula.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (texto === "" || /^[*\-–—]+$/.test(texto)) return null;
  let normalizado = texto;
  if (texto.includes(",") && texto.includes(".")) {
    normalizado =
      texto.lastIndexOf(",") > texto.lastIndexOf(".")
        ? texto.replace(/\./g, "").replace(",", ".")
        : texto.replace(/,/g, "");
  } else if (texto.includes(",")) {
    normalizado = texto.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return "ilegivel";
  return Number(normalizado);
}

function textoDaCelula(celula: Celula): string | null {
  if (celula == null) return null;
  if (celula instanceof Date) return celula.toISOString().slice(0, 10);
  const texto = String(celula).trim();
  return texto === "" ? null : texto;
}

function simOuNao(celula: Celula): boolean {
  if (typeof celula === "boolean") return celula;
  const t = semAcento(String(celula ?? "")).trim().toLowerCase();
  return t === "sim" || t === "s" || t === "1" || t === "true" || t === "x";
}

/**
 * A unidade a que o preço se refere. Além das sete palavras do banco, entende
 * o que a planilha da LUGA escreve: "pacote com 10 unidades (ver observação)"
 * e "conforme a coluna EMBALAGEM" (UNITÁRIO = peça; o resto = pacote) — as
 * mesmas regras da carga inicial, para a sincronização não "mudar" o que não
 * mudou.
 */
export function unidadeDoPreco(texto: string | null, embalagem: string | null): UnidadeDePreco | null {
  const t = semAcento(texto ?? "").trim().toLowerCase();
  if (t === "") return "unidade";
  if (ehUnidadeDePreco(t)) return t;
  if (t.startsWith("conforme a coluna embalagem")) {
    return (embalagem ?? "").trim().toUpperCase().startsWith("UNIT") ? "unidade" : "pacote";
  }
  if (t.startsWith("pacote") || t === "pct") return "pacote";
  const sinonimos: Record<string, UnidadeDePreco> = {
    un: "unidade",
    und: "unidade",
    unid: "unidade",
    peca: "unidade",
    "por unidade": "unidade",
    "por peca": "unidade",
    "por cento": "cento",
    "100": "cento",
    mil: "milheiro",
    "por milheiro": "milheiro",
    "1000": "milheiro",
    cx: "caixa",
    fl: "folha",
    "por folha": "folha",
  };
  return sinonimos[t] ?? null;
}

export type LinhaDaPlanilha = {
  /** Número da linha na planilha (a 1ª linha de dados é a 2). */
  linhaNaPlanilha: number;
  fornecedor: string | null;
  secao: string;
  ordemSecao: number | null;
  especificacao: string | null;
  codigo: string;
  descricao: string;
  dimensoes: string | null;
  embalagem: string | null;
  unidade: UnidadeDePreco;
  quantidadeMinima: number | null;
  multiplo: number | null;
  quantidadeMinimaGravada: number | null;
  adicionalPorCor: number | null;
  eEmbalagem: boolean;
  observacao: string | null;
  pagina: number | null;
  linhaDaTabela: number | null;
  edicao: string | null;
  custos: Partial<Record<Modalidade, number>>;
};

export type ProblemaDaPlanilha = { linha: number | null; mensagem: string };

export type LeituraDaPlanilha = {
  linhas: LinhaDaPlanilha[];
  problemas: ProblemaDaPlanilha[];
};

/**
 * Lê a aba de dados (primeira linha = cabeçalho). Linha vazia é pulada; linha
 * com defeito vira problema com o número da linha — e problema bloqueia a
 * gravação: planilha pela metade não sincroniza.
 */
export function lerPlanilha(dados: Celula[][]): LeituraDaPlanilha {
  const problemas: ProblemaDaPlanilha[] = [];
  const indiceCabecalho = dados.findIndex((linha) =>
    (linha ?? []).some((c) => chaveDaColuna(String(c ?? "")) === "codigo"),
  );
  if (indiceCabecalho < 0) {
    return {
      linhas: [],
      problemas: [{ linha: null, mensagem: 'A planilha não tem a coluna "codigo". Use o modelo da primeira carga (aba "dados").' }],
    };
  }
  const colunas = (dados[indiceCabecalho] ?? []).map((c) => chaveDaColuna(String(c ?? "")));
  const faltando = COLUNAS_OBRIGATORIAS.filter((c) => !colunas.includes(c));
  const colunasDeCusto = Object.keys(COLUNAS_DE_CUSTO).filter((c) => colunas.includes(c));
  if (faltando.length > 0) {
    problemas.push({ linha: null, mensagem: `Faltam as colunas: ${faltando.join(", ")}.` });
  }
  if (colunasDeCusto.length === 0) {
    problemas.push({
      linha: null,
      mensagem: "A planilha não tem nenhuma coluna de custo (custo_sem_gravacao, valor_unico…).",
    });
  }
  if (problemas.length > 0) return { linhas: [], problemas };

  const pos = (nome: string) => colunas.indexOf(nome);
  const celula = (linha: Celula[], nome: string): Celula => {
    const i = pos(nome);
    return i < 0 ? null : linha[i];
  };
  const numero = (linha: Celula[], nome: string, numeroDaLinha: number, rotulo: string): number | null => {
    const v = lerNumeroBR(celula(linha, nome));
    if (v === "ilegivel") {
      problemas.push({ linha: numeroDaLinha, mensagem: `${rotulo} ilegível: "${String(celula(linha, nome))}".` });
      return null;
    }
    return v;
  };

  const linhas: LinhaDaPlanilha[] = [];
  for (let i = indiceCabecalho + 1; i < dados.length; i++) {
    const linha = dados[i] ?? [];
    const numeroDaLinha = i + 1;
    if (linha.every((c) => textoDaCelula(c) === null)) continue;

    const codigo = textoDaCelula(celula(linha, "codigo"));
    const descricao = textoDaCelula(celula(linha, "descricao"));
    const secao = textoDaCelula(celula(linha, "secao"));
    if (!codigo || !descricao || !secao) {
      problemas.push({
        linha: numeroDaLinha,
        mensagem: `Linha sem ${!codigo ? "código" : !descricao ? "descrição" : "seção"}.`,
      });
      continue;
    }
    const embalagem = textoDaCelula(celula(linha, "embalagem"));
    const textoDaUnidade = textoDaCelula(celula(linha, "unidade_do_preco"));
    const unidade = unidadeDoPreco(textoDaUnidade, embalagem);
    if (!unidade) {
      problemas.push({
        linha: numeroDaLinha,
        mensagem: `Unidade do preço "${textoDaUnidade}" desconhecida (use unidade, cento, milheiro, caixa, rolo, folha ou pacote).`,
      });
      continue;
    }

    const custos: Partial<Record<Modalidade, number>> = {};
    for (const coluna of colunasDeCusto) {
      const valor = numero(linha, coluna, numeroDaLinha, `Custo (${coluna})`);
      if (valor == null) continue;
      if (valor < 0) {
        problemas.push({ linha: numeroDaLinha, mensagem: `Custo negativo em ${coluna}.` });
        continue;
      }
      custos[COLUNAS_DE_CUSTO[coluna]] = valor;
    }

    const positivo = (nome: string, rotulo: string): number | null => {
      const v = numero(linha, nome, numeroDaLinha, rotulo);
      if (v == null) return null;
      if (v <= 0) {
        problemas.push({ linha: numeroDaLinha, mensagem: `${rotulo} tem de ser maior que zero.` });
        return null;
      }
      return v;
    };

    linhas.push({
      linhaNaPlanilha: numeroDaLinha,
      fornecedor: textoDaCelula(celula(linha, "fornecedor")),
      secao,
      ordemSecao: numero(linha, "ordem_secao", numeroDaLinha, "Ordem da seção"),
      especificacao: textoDaCelula(celula(linha, "especificacao")),
      codigo,
      descricao,
      dimensoes: textoDaCelula(celula(linha, "dimensoes")),
      embalagem,
      unidade,
      quantidadeMinima: positivo("quantidade_minima", "Quantidade mínima"),
      multiplo: positivo("multiplo", "Múltiplo"),
      quantidadeMinimaGravada: positivo("quantidade_minima_gravada", "Mínimo gravado"),
      adicionalPorCor: numero(linha, "adicional_por_cor", numeroDaLinha, "Adicional por cor"),
      eEmbalagem: simOuNao(celula(linha, "e_embalagem")),
      observacao: textoDaCelula(celula(linha, "observacao")),
      pagina: numero(linha, "pagina", numeroDaLinha, "Página"),
      linhaDaTabela: numero(linha, "linha", numeroDaLinha, "Linha da tabela"),
      edicao: textoDaCelula(celula(linha, "tabela")),
      custos,
    });
  }
  if (linhas.length === 0 && problemas.length === 0) {
    problemas.push({ linha: null, mensagem: "A planilha não tem nenhum item." });
  }
  return { linhas, problemas };
}

/** As linhas do fornecedor deste catálogo, quando a planilha traz vários. */
export function linhasDoFornecedor(
  linhas: LinhaDaPlanilha[],
  fornecedor: string,
): { linhas: LinhaDaPlanilha[]; outros: string[] } {
  const alvo = semAcento(fornecedor).toLowerCase().trim();
  const comNome = linhas.filter((l) => l.fornecedor);
  if (comNome.length === 0) return { linhas, outros: [] };
  const primeiraPalavra = alvo.split(/\s+/)[0] ?? alvo;
  const doAlvo = (l: LinhaDaPlanilha) => {
    const nome = semAcento(l.fornecedor ?? "").toLowerCase().trim();
    return nome === "" || nome === alvo || nome.split(/\s+/)[0] === primeiraPalavra;
  };
  const outros = [...new Set(linhas.filter((l) => !doAlvo(l)).map((l) => l.fornecedor ?? ""))];
  return { linhas: linhas.filter(doAlvo), outros };
}

/* ------------------------------------------------------------------------- */
/* O que já existe no catálogo                                                */
/* ------------------------------------------------------------------------- */

export type ModalidadeExistente = {
  modalidade: Modalidade;
  quantidadeMinima: number | null;
  multiplo: number | null;
  faixa: string | null;
  faixaMax: number | null;
  rotuloInferido: boolean;
  custo: number | null;
  adicionalPorCor: number | null;
};

export type ItemExistente = {
  id: string;
  codigoFornecedor: string;
  descricao: string;
  situacao: "ativo" | "fora_da_tabela";
  secaoId: string | null;
  unidade: UnidadeDePreco;
  quantidadeMinima: number | null;
  multiplo: number | null;
  quantidadeMinimaGravada: number | null;
  dimensoes: string | null;
  embalagem: string | null;
  eEmbalagem: boolean;
  observacao: string | null;
  ordem: number;
  modalidades: ModalidadeExistente[];
};

export type SecaoExistente = {
  id: string;
  titulo: string;
  ordem: number;
  especificacao: string | null;
};

function chaveDeSecao(titulo: string): string {
  return semAcento(titulo).toLowerCase().replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------------- */
/* Casamento linha × item                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Casa cada linha com um item, nesta ordem:
 *   1. mesmo código E mesma descrição (em ordem: a 1ª linha repetida fica com
 *      o 1º item — a ordem importa para a trava do banco);
 *   2. sobrou exatamente UMA linha e UM item com o mesmo código: é o mesmo item
 *      com a descrição corrigida;
 *   3. o resto é item novo; item que ficou sem linha sai da tabela.
 * Devolve, para cada linha (pelo índice), o id do item ou `null`.
 */
export function casarLinhas(linhas: LinhaDaPlanilha[], itens: ItemExistente[]): (string | null)[] {
  const resultado: (string | null)[] = linhas.map(() => null);
  const usados = new Set<string>();
  const porChave = new Map<string, ItemExistente[]>();
  const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem);
  for (const item of ordenados) {
    const chave = `${normalizarCodigo(item.codigoFornecedor)}|${normalizarDescricao(item.descricao)}`;
    porChave.set(chave, [...(porChave.get(chave) ?? []), item]);
  }
  linhas.forEach((linha, i) => {
    const chave = `${normalizarCodigo(linha.codigo)}|${normalizarDescricao(linha.descricao)}`;
    const candidato = (porChave.get(chave) ?? []).find((it) => !usados.has(it.id));
    if (candidato) {
      resultado[i] = candidato.id;
      usados.add(candidato.id);
    }
  });

  const linhasSobrando = new Map<string, number[]>();
  linhas.forEach((linha, i) => {
    if (resultado[i] !== null) return;
    const codigo = normalizarCodigo(linha.codigo) ?? "";
    linhasSobrando.set(codigo, [...(linhasSobrando.get(codigo) ?? []), i]);
  });
  const itensSobrando = new Map<string, ItemExistente[]>();
  for (const item of ordenados) {
    if (usados.has(item.id)) continue;
    const codigo = normalizarCodigo(item.codigoFornecedor) ?? "";
    itensSobrando.set(codigo, [...(itensSobrando.get(codigo) ?? []), item]);
  }
  for (const [codigo, indices] of linhasSobrando) {
    const sobra = itensSobrando.get(codigo) ?? [];
    if (indices.length === 1 && sobra.length === 1) {
      resultado[indices[0]] = sobra[0].id;
      usados.add(sobra[0].id);
    }
  }
  return resultado;
}

/* ------------------------------------------------------------------------- */
/* O plano que vai ao banco e a prévia que a pessoa lê                         */
/* ------------------------------------------------------------------------- */

export type ModalidadeDoPlano = {
  modalidade: Modalidade;
  custo: number;
  adicional_por_cor: number | null;
  quantidade_minima: number | null;
  multiplo: number | null;
  faixa: string | null;
  faixa_max: number | null;
  rotulo_inferido: boolean;
};

export type ItemDoPlano = {
  item_id: string | null;
  secao_ref: string;
  codigo_fornecedor: string;
  descricao: string;
  nome?: string;
  dimensoes: string | null;
  embalagem: string | null;
  unidade_preco: UnidadeDePreco;
  quantidade_minima: number | null;
  multiplo: number | null;
  quantidade_minima_gravada: number | null;
  e_embalagem: boolean;
  observacao: string | null;
  pagina: number | null;
  linha: number | null;
  modalidades: ModalidadeDoPlano[];
};

export type SecaoDoPlano = {
  ref: string;
  secao_id: string | null;
  ordem: number;
  titulo: string;
  especificacao: string | null;
};

/** O formato que `catalogo_importar(p_catalogo_id, p_plano)` recebe. */
export type PlanoDeImportacao = {
  edicao: string | null;
  arquivo: string | null;
  notas: string[];
  secoes: SecaoDoPlano[];
  itens: ItemDoPlano[];
};

export type MudancaDeCusto = { modalidade: Modalidade; antes: number | null; depois: number | null };

export type LinhaDaPrevia = {
  linha: LinhaDaPlanilha;
  itemId: string | null;
  custos: MudancaDeCusto[];
};

export type ClasseDaLinha = "novo" | "voltou" | "subiu" | "desceu" | "outra" | "igual";

export type PreviaDaSincronizacao = {
  novos: LinhaDaPrevia[];
  voltaram: LinhaDaPrevia[];
  subiram: LinhaDaPrevia[];
  desceram: LinhaDaPrevia[];
  outras: LinhaDaPrevia[];
  iguais: number;
  /** Itens ativos que não vieram na planilha: viram "fora da tabela" (nunca são apagados). */
  sairam: ItemExistente[];
  /** Mudou o cadastro (unidade, mínimo, seção…) sem mudar custo: o banco grava, a pessoa precisa ver. */
  cadastroMudou: { linha: LinhaDaPlanilha; itemId: string; campos: string[] }[];
  secoesNovas: string[];
  avisos: string[];
};

const custo4 = (v: number | null | undefined) => (v == null ? null : arredondar(v, 4));

/** Faixa de quantidade da opção, quando a coluna da tabela a define. */
const FAIXA_PADRAO: Partial<Record<Modalidade, { faixa: string; faixaMax: number | null }>> = {
  gravada_100_199: { faixa: "100 a 199 peças", faixaMax: 199 },
  gravada_acima_1000: { faixa: "acima de 1.000 peças", faixaMax: null },
};

const CONECTORES = new Set([
  "de", "da", "do", "das", "dos", "e", "com", "para", "em", "a", "o", "as", "os", "no", "na", "ou", "c/", "p/", "s/",
]);

/**
 * "AGENDA LISA PRETA" → "Agenda Lisa Preta", sem o código do fornecedor e sem
 * valor em reais. A mesma regra da carga inicial, para item novo da planilha.
 */
export function nomeLegivel(descricao: string, codigo: string): string {
  let texto = semValores(descricao);
  const termos = [codigo, ...codigo.split(/[^A-Za-z0-9]+/).filter((t) => t.length >= 3 && /\d/.test(t))];
  for (const termo of termos.filter((t) => t.trim().length >= 3).sort((a, b) => b.length - a.length)) {
    const escapado = termo.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    texto = texto.replace(new RegExp(`(?<![A-Za-z0-9])${escapado}(?![A-Za-z0-9])`, "gi"), "");
  }
  texto = texto
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—·|,;:.]+|[\s\-–—·|,;:]+$/g, "")
    .trim();
  return texto
    .split(" ")
    .map((p, i) => {
      const baixa = p.toLowerCase();
      if (i > 0 && CONECTORES.has(baixa)) return baixa;
      if (/\d/.test(p)) return baixa;
      if (p.startsWith('"') && p.length > 1) return `"${p.slice(1, 2).toUpperCase()}${p.slice(2).toLowerCase()}`;
      return p.slice(0, 1).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

function mesmoTexto(a: string | null, b: string | null): boolean {
  return (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Monta o plano para o banco e a prévia para a pessoa.
 *
 * Opção que o item JÁ tem leva junto o mínimo, o múltiplo e a faixa que tem
 * (a planilha não traz isso por opção — sem levar, a sincronização apagaria).
 * Opção nova copia de um item da mesma seção que tenha a mesma opção (era o
 * cabeçalho da seção na tabela); sem vizinho, usa o mínimo da linha.
 */
export function montarPlano(entrada: {
  linhas: LinhaDaPlanilha[];
  secoes: SecaoExistente[];
  itens: ItemExistente[];
  arquivo: string | null;
  notas?: string[];
}): { plano: PlanoDeImportacao; previa: PreviaDaSincronizacao } {
  const { linhas, secoes, itens } = entrada;
  const avisos: string[] = [];

  // Seções. A tabela da LUGA tem DUAS seções com o mesmo título ("CANETAS
  // PLÁSTICAS - SEMI METAL E METAL", 30 e 31): casar só pelo título juntava as
  // duas e mudava 42 canetas de seção em silêncio. A chave é ordem + título
  // (a coluna ordem_secao); sem ela, o título. Para achar a seção que já
  // existe: mesma ordem e mesmo título; senão, o título quando só UMA seção
  // livre tem esse título; senão, seção nova (a prévia mostra).
  const chaveDaLinha = (l: LinhaDaPlanilha) => `${l.ordemSecao ?? ""}|${chaveDeSecao(l.secao)}`;
  const secoesDoPlano: SecaoDoPlano[] = [];
  const refDaSecao = new Map<string, string>();
  const secoesUsadas = new Set<string>();
  for (const linha of linhas) {
    const chave = chaveDaLinha(linha);
    if (refDaSecao.has(chave)) continue;
    const titulo = chaveDeSecao(linha.secao);
    const mesmoTitulo = secoes.filter((s) => chaveDeSecao(s.titulo) === titulo && !secoesUsadas.has(s.id));
    const existente =
      mesmoTitulo.find((s) => linha.ordemSecao != null && s.ordem === linha.ordemSecao) ??
      (mesmoTitulo.length === 1 ? mesmoTitulo[0] : undefined);
    if (existente) secoesUsadas.add(existente.id);
    const ref = `s${secoesDoPlano.length + 1}`;
    refDaSecao.set(chave, ref);
    const especificacao = linhas.find((l) => chaveDaLinha(l) === chave && l.especificacao)?.especificacao ?? null;
    secoesDoPlano.push({
      ref,
      secao_id: existente?.id ?? null,
      ordem: linha.ordemSecao ?? secoesDoPlano.length + 1,
      titulo: linha.secao.trim(),
      especificacao,
    });
  }

  const casamento = casarLinhas(linhas, itens);
  const porId = new Map(itens.map((i) => [i.id, i]));
  const vistos = new Set(casamento.filter((id): id is string => id !== null));

  // Vizinho da mesma seção com a mesma opção: o cabeçalho da seção na carga.
  const padraoDaSecao = new Map<string, ModalidadeExistente>();
  for (const item of [...itens].sort((a, b) => a.ordem - b.ordem)) {
    if (!item.secaoId) continue;
    for (const m of item.modalidades) {
      const chave = `${item.secaoId}|${m.modalidade}`;
      if (!padraoDaSecao.has(chave)) padraoDaSecao.set(chave, m);
    }
  }

  const previa: PreviaDaSincronizacao = {
    novos: [],
    voltaram: [],
    subiram: [],
    desceram: [],
    outras: [],
    iguais: 0,
    sairam: itens.filter((i) => i.situacao === "ativo" && !vistos.has(i.id)),
    cadastroMudou: [],
    secoesNovas: secoesDoPlano.filter((s) => !s.secao_id).map((s) => s.titulo),
    avisos,
  };

  const itensDoPlano: ItemDoPlano[] = linhas.map((linha, indice) => {
    const itemId = casamento[indice];
    const existente = itemId ? porId.get(itemId) ?? null : null;
    const secaoRef = refDaSecao.get(chaveDaLinha(linha))!;
    const secaoId = secoesDoPlano.find((s) => s.ref === secaoRef)?.secao_id ?? null;

    const modalidades: ModalidadeDoPlano[] = (Object.entries(linha.custos) as [Modalidade, number][]).map(
      ([modalidade, custo]) => {
        const base = MODALIDADES_BASE.has(modalidade);
        const atual = existente?.modalidades.find((m) => m.modalidade === modalidade);
        const vizinho = secaoId ? padraoDaSecao.get(`${secaoId}|${modalidade}`) : undefined;
        const faixaPadrao = FAIXA_PADRAO[modalidade];
        const molde = atual ?? (base ? undefined : vizinho);
        // A planilha traz UMA "cor adicional" por linha; no catálogo ela é de
        // uma opção só (a de silk 1 cor). A opção que tem cobrança de cor
        // adicional continua tendo, com o valor da planilha; a que não tem
        // continua sem — senão a sincronização carimbaria a cor adicional no
        // "silk + 1ª página" e no baixo relevo.
        const temCorAdicional = molde
          ? molde.adicionalPorCor != null
          : modalidade === "gravada_1_cor";
        return {
          modalidade,
          custo: custo4(custo)!,
          adicional_por_cor: temCorAdicional ? (linha.adicionalPorCor ?? null) : null,
          quantidade_minima: molde
            ? molde.quantidadeMinima
            : base
              ? (linha.quantidadeMinima ?? linha.multiplo)
              : linha.quantidadeMinimaGravada,
          multiplo: molde ? molde.multiplo : base ? linha.multiplo : null,
          faixa: molde ? molde.faixa : (faixaPadrao?.faixa ?? null),
          faixa_max: molde ? molde.faixaMax : (faixaPadrao?.faixaMax ?? null),
          rotulo_inferido: molde ? molde.rotuloInferido : false,
        };
      },
    );

    // A mesma conta do banco: mudança de custo por opção, opção que saiu com custo.
    const mudancas: MudancaDeCusto[] = [];
    let sobe = false;
    let desce = false;
    let outra = false;
    for (const m of modalidades) {
      const antes = custo4(existente?.modalidades.find((x) => x.modalidade === m.modalidade)?.custo ?? null);
      const depois = custo4(m.custo);
      if (antes === depois) continue;
      mudancas.push({ modalidade: m.modalidade, antes, depois });
      if (antes == null || depois == null) outra = true;
      else if (depois > antes) sobe = true;
      else desce = true;
    }
    for (const m of existente?.modalidades ?? []) {
      if (m.custo != null && !(m.modalidade in linha.custos)) {
        mudancas.push({ modalidade: m.modalidade, antes: custo4(m.custo), depois: null });
        outra = true;
      }
    }

    const entradaDaPrevia: LinhaDaPrevia = { linha, itemId, custos: mudancas };
    let classe: ClasseDaLinha;
    if (!existente) classe = "novo";
    else if (existente.situacao === "fora_da_tabela") classe = "voltou";
    else if (sobe) classe = "subiu";
    else if (desce) classe = "desceu";
    else if (outra) classe = "outra";
    else classe = "igual";
    if (classe === "novo") previa.novos.push(entradaDaPrevia);
    else if (classe === "voltou") previa.voltaram.push(entradaDaPrevia);
    else if (classe === "subiu") previa.subiram.push(entradaDaPrevia);
    else if (classe === "desceu") previa.desceram.push(entradaDaPrevia);
    else if (classe === "outra") previa.outras.push(entradaDaPrevia);
    else previa.iguais++;

    const descricao = linha.descricao.trim();
    // Observação da equipe (feita no catálogo) não some porque a linha veio sem observação.
    const observacao = linha.observacao ?? existente?.observacao ?? null;

    if (existente && existente.situacao === "ativo") {
      const campos: string[] = [];
      if (existente.unidade !== linha.unidade) campos.push(`unidade do preço: ${existente.unidade} → ${linha.unidade}`);
      if (existente.quantidadeMinima !== (linha.quantidadeMinima ?? null))
        campos.push(`mínimo: ${existente.quantidadeMinima ?? "—"} → ${linha.quantidadeMinima ?? "—"}`);
      if (existente.multiplo !== (linha.multiplo ?? null))
        campos.push(`múltiplo: ${existente.multiplo ?? "—"} → ${linha.multiplo ?? "—"}`);
      if (existente.secaoId !== secaoId) campos.push("seção");
      if (!mesmoTexto(normalizarDescricao(existente.descricao), normalizarDescricao(descricao)))
        campos.push("descrição");
      if (!mesmoTexto(existente.dimensoes, linha.dimensoes)) campos.push("dimensões");
      if (!mesmoTexto(existente.embalagem, linha.embalagem)) campos.push("embalagem");
      if (campos.length > 0) previa.cadastroMudou.push({ linha, itemId: existente.id, campos });
    }

    return {
      item_id: itemId,
      secao_ref: secaoRef,
      codigo_fornecedor: linha.codigo.trim(),
      descricao,
      ...(existente ? {} : { nome: nomeLegivel(descricao, linha.codigo) || descricao }),
      dimensoes: linha.dimensoes,
      embalagem: linha.embalagem,
      unidade_preco: linha.unidade,
      quantidade_minima: linha.quantidadeMinima,
      multiplo: linha.multiplo,
      quantidade_minima_gravada: linha.quantidadeMinimaGravada,
      e_embalagem: linha.eEmbalagem,
      observacao,
      pagina: linha.pagina,
      linha: linha.linhaDaTabela,
      modalidades,
    };
  });

  // Mesmo código, linhas novas e itens que saem: provavelmente só a descrição mudou.
  const codigosNovos = new Set(previa.novos.map((n) => normalizarCodigo(n.linha.codigo)));
  const suspeitos = [...new Set(previa.sairam.map((s) => s.codigoFornecedor))].filter((c) =>
    codigosNovos.has(normalizarCodigo(c)),
  );
  if (suspeitos.length > 0) {
    avisos.push(
      `${suspeitos.length === 1 ? "O código" : "Os códigos"} ${suspeitos.slice(0, 8).join(", ")}${suspeitos.length > 8 ? "…" : ""} ` +
        "aparece como item novo E como item que sai. Se só a descrição mudou, o item antigo vai para \"fora da tabela\" " +
        "e o novo nasce sem foto e sem nome da equipe — confira antes de aplicar.",
    );
  }

  const edicoes = linhas.map((l) => l.edicao).filter((e): e is string => !!e);
  const contagem = new Map<string, number>();
  for (const e of edicoes) contagem.set(e, (contagem.get(e) ?? 0) + 1);
  const edicao = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    plano: {
      edicao,
      arquivo: entrada.arquivo,
      notas: (entrada.notas ?? []).slice(0, 200),
      secoes: secoesDoPlano,
      itens: itensDoPlano,
    },
    previa,
  };
}
