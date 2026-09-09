import { deCSV, lerNumero } from "@/domain/custos/planilha-csv";

/**
 * Leitura de extrato bancário — OFX e CSV.
 *
 * O OFX é o formato que todo banco brasileiro exporta ("Money 2000"), e ele traz
 * o `FITID`: o identificador que o BANCO dá a cada lançamento. É a peça que
 * torna a importação segura, porque extrato se reimporta o tempo todo — o
 * usuário baixa "últimos 30 dias" toda semana, e as janelas se sobrepõem. Sem
 * uma chave estável, cada reimportação somaria o mesmo lançamento de novo e o
 * saldo subiria sozinho.
 *
 * Por isso `fitid` é obrigatório na saída: quando o arquivo não traz um (CSV
 * simples), derivamos uma chave estável dos próprios dados da linha.
 */

export type LancamentoExtrato = {
  /** Chave estável do lançamento — usada para não importar duas vezes. */
  fitid: string;
  data: string; // YYYY-MM-DD
  descricao: string;
  /** Positivo entra, negativo sai. */
  valor: number;
  tipo: "credito" | "debito";
  documento?: string;
};

export type ResultadoExtrato = {
  lancamentos: LancamentoExtrato[];
  /** Conta informada pelo arquivo, quando houver — ajuda a não importar na conta errada. */
  conta?: { banco?: string; agencia?: string; numero?: string };
  formato: "ofx" | "csv";
  ignoradas: string[];
};

/** OFX é SGML: as tags quase nunca são fechadas. Pega o valor até a próxima tag. */
function tagOFX(bloco: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  return re.exec(bloco)?.[1]?.trim() || undefined;
}

/**
 * `20260904120000[-3:BRT]` ou `20260904` -> `2026-09-04`.
 *
 * Só a parte da data é usada, de propósito: o fuso vem escrito de formas
 * diferentes em cada banco, e converter hora para acabar guardando só o dia é
 * chance de empurrar um lançamento da meia-noite para o dia anterior.
 */
export function dataOFX(bruto: string | undefined): string | null {
  if (!bruto) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(bruto.trim());
  if (!m) return null;
  const [, ano, mes, dia] = m;
  const n = Number(mes);
  const d = Number(dia);
  if (n < 1 || n > 12 || d < 1 || d > 31) return null;
  return `${ano}-${mes}-${dia}`;
}

/** `04/09/2026`, `2026-09-04` ou `04-09-2026` -> `2026-09-04`. */
export function dataFlexivel(bruto: string | undefined): string | null {
  if (!bruto) return null;
  const t = bruto.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(t);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return dataOFX(t);
}

export function lerOFX(texto: string): ResultadoExtrato {
  const lancamentos: LancamentoExtrato[] = [];
  const ignoradas: string[] = [];

  const conta = {
    banco: tagOFX(texto, "BANKID"),
    agencia: tagOFX(texto, "BRANCHID"),
    numero: tagOFX(texto, "ACCTID"),
  };

  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  for (const bloco of blocos) {
    const data = dataOFX(tagOFX(bloco, "DTPOSTED"));
    const valor = lerNumero(tagOFX(bloco, "TRNAMT"));
    const fitid = tagOFX(bloco, "FITID");
    const descricao =
      tagOFX(bloco, "MEMO") ?? tagOFX(bloco, "NAME") ?? "Lançamento sem descrição";

    // Sem data ou sem valor o lançamento não serve para nada — e valor zero,
    // que alguns bancos usam como marcador, também não.
    if (!data || valor == null || valor === 0) {
      ignoradas.push(descricao);
      continue;
    }

    lancamentos.push({
      fitid: fitid || chaveDerivada(data, descricao, valor),
      data,
      descricao,
      valor,
      tipo: valor >= 0 ? "credito" : "debito",
      documento: tagOFX(bloco, "CHECKNUM") ?? tagOFX(bloco, "REFNUM"),
    });
  }

  return { lancamentos, conta, formato: "ofx", ignoradas };
}

/**
 * Chave estável para arquivo sem FITID.
 *
 * Data + descrição + valor. Não é perfeito — duas compras iguais no mesmo dia
 * colidem — mas é determinístico, que é o que importa: reimportar o mesmo
 * arquivo não duplica nada. O contador é o que separa lançamentos idênticos
 * legítimos dentro do MESMO arquivo.
 */
function chaveDerivada(data: string, descricao: string, valor: number, ocorrencia = 0): string {
  const limpa = descricao.toUpperCase().replace(/\s+/g, " ").trim().slice(0, 40);
  const sufixo = ocorrencia > 0 ? `#${ocorrencia}` : "";
  return `${data}|${limpa}|${valor.toFixed(2)}${sufixo}`;
}

const COLUNAS_DATA = ["data", "data lançamento", "data lancamento", "dt", "date"];
const COLUNAS_DESCRICAO = ["descricao", "descrição", "historico", "histórico", "memo", "lançamento", "lancamento"];
const COLUNAS_VALOR = ["valor", "valor (r$)", "amount", "montante"];
const COLUNAS_DOC = ["documento", "doc", "nº documento", "numero documento"];

function achar(linha: Record<string, string>, nomes: string[]): string | undefined {
  for (const nome of nomes) {
    const v = linha[nome];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/**
 * CSV de extrato. Cada banco nomeia a coluna do seu jeito, então as variações
 * mais comuns são aceitas — e o que não for reconhecido é listado, nunca
 * adivinhado.
 */
export function lerExtratoCSV(texto: string): ResultadoExtrato {
  const linhas = deCSV(texto);
  const lancamentos: LancamentoExtrato[] = [];
  const ignoradas: string[] = [];
  const vistos = new Map<string, number>();

  for (const linha of linhas) {
    const data = dataFlexivel(achar(linha, COLUNAS_DATA));
    const descricao = achar(linha, COLUNAS_DESCRICAO) ?? "Lançamento sem descrição";
    let valor = lerNumero(achar(linha, COLUNAS_VALOR) ?? "");

    // Alguns extratos usam colunas separadas de crédito e débito.
    if (valor == null) {
      const credito = lerNumero(linha["credito"] ?? linha["crédito"] ?? linha["entrada"] ?? "");
      const debito = lerNumero(linha["debito"] ?? linha["débito"] ?? linha["saida"] ?? linha["saída"] ?? "");
      if (credito != null && credito !== 0) valor = Math.abs(credito);
      else if (debito != null && debito !== 0) valor = -Math.abs(debito);
    }

    if (!data || valor == null || valor === 0) {
      ignoradas.push(descricao);
      continue;
    }

    const fitidArquivo = linha["fitid"] || linha["id"];
    let fitid = fitidArquivo;
    if (!fitid) {
      const base = chaveDerivada(data, descricao, valor);
      const n = vistos.get(base) ?? 0;
      vistos.set(base, n + 1);
      fitid = chaveDerivada(data, descricao, valor, n);
    }

    lancamentos.push({
      fitid,
      data,
      descricao,
      valor,
      tipo: valor >= 0 ? "credito" : "debito",
      documento: achar(linha, COLUNAS_DOC),
    });
  }

  return { lancamentos, formato: "csv", ignoradas };
}

/** Escolhe o leitor pelo conteúdo, não pela extensão — extensão mente. */
export function lerExtrato(texto: string): ResultadoExtrato {
  return /<OFX>|<STMTTRN>/i.test(texto) ? lerOFX(texto) : lerExtratoCSV(texto);
}

/** Saldo do período, para conferir com o que o banco mostra. */
export function somarExtrato(lancamentos: LancamentoExtrato[]) {
  const entradas = lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0);
  const saidas = lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s + l.valor, 0);
  return {
    entradas: Math.round(entradas * 100) / 100,
    saidas: Math.round(saidas * 100) / 100,
    liquido: Math.round((entradas + saidas) * 100) / 100,
  };
}
