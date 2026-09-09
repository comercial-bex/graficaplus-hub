/**
 * Leitura de extratos bancários (OFX e CSV) no navegador.
 *
 * A validação de duplicidade acontece no banco (função importar_extrato),
 * mas aqui já normalizamos data/valor/tipo para que o preview mostre
 * exatamente o que será importado.
 */

export type LinhaExtrato = {
  data: string; // AAAA-MM-DD
  descricao: string;
  valor: number; // sempre positivo
  tipo: "credito" | "debito";
  documento?: string | null;
  fitid?: string | null;
};

function normalizarData(bruto: string): string | null {
  // O OFX costuma trazer o fuso entre colchetes ("20260103120000[-3:BRT]"),
  // que atrapalha os testes de formato abaixo — por isso sai antes de tudo.
  const t = bruto
    .trim()
    .replace(/\[[^\]]*\]/g, "")
    .trim();
  if (!t) return null;
  // OFX: 20260105 ou 20260105120000[-3:BRT]
  const ofx = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx && t.length >= 8 && !t.includes("/") && !t.includes("-")) {
    return `${ofx[1]}-${ofx[2]}-${ofx[3]}`;
  }
  // 05/01/2026 ou 05-01-2026
  const br = t.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})$/);
  if (br) {
    const ano = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${ano}-${br[2]}-${br[1]}`;
  }
  // 2026-01-05
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function normalizarValor(bruto: string): number {
  let t = bruto.trim().replace(/[R$\s]/g, "");
  if (!t) return 0;
  const negativo = /^\(.*\)$/.test(t) || t.startsWith("-");
  t = t.replace(/[()]/g, "").replace(/^-/, "");
  // 1.234,56 -> 1234.56 | 1,234.56 -> 1234.56
  if (t.includes(",") && t.includes(".")) {
    t =
      t.lastIndexOf(",") > t.lastIndexOf(".")
        ? t.replace(/\./g, "").replace(",", ".")
        : t.replace(/,/g, "");
  } else if (t.includes(",")) {
    t = t.replace(",", ".");
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  return negativo ? -n : n;
}

function tag(bloco: string, nome: string): string {
  const m = bloco.match(new RegExp(`<${nome}>([^<\r\n]*)`, "i"));
  return m ? m[1].trim() : "";
}

export function parseOFX(conteudo: string): LinhaExtrato[] {
  const blocos = conteudo.split(/<STMTTRN>/i).slice(1);
  const linhas: LinhaExtrato[] = [];
  for (const bruto of blocos) {
    const bloco = bruto.split(/<\/STMTTRN>/i)[0] ?? bruto;
    const data = normalizarData(tag(bloco, "DTPOSTED"));
    const valor = normalizarValor(tag(bloco, "TRNAMT"));
    if (!data || valor === 0) continue;
    const descricao =
      tag(bloco, "MEMO") || tag(bloco, "NAME") || tag(bloco, "TRNTYPE") || "Lançamento bancário";
    linhas.push({
      data,
      descricao,
      valor: Math.abs(valor),
      tipo: valor < 0 ? "debito" : "credito",
      documento: tag(bloco, "CHECKNUM") || null,
      fitid: tag(bloco, "FITID") || null,
    });
  }
  return linhas;
}

function separarColunas(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (const ch of linha) {
    if (ch === '"') aspas = !aspas;
    else if (ch === sep && !aspas) {
      out.push(atual);
      atual = "";
    } else atual += ch;
  }
  out.push(atual);
  return out.map((c) => c.trim().replace(/^"|"$/g, ""));
}

export function parseCSV(conteudo: string): LinhaExtrato[] {
  const linhasTexto = conteudo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhasTexto.length === 0) return [];

  const sep =
    (linhasTexto[0].match(/;/g)?.length ?? 0) >= (linhasTexto[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const cabecalho = separarColunas(linhasTexto[0], sep).map((c) =>
    c
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
  );
  const temCabecalho =
    cabecalho.some((c) => c.includes("data")) && !normalizarData(cabecalho[0] ?? "");

  const idx = (nomes: string[]) => cabecalho.findIndex((c) => nomes.some((n) => c.includes(n)));
  const iData = temCabecalho ? idx(["data", "date"]) : 0;
  const iDesc = temCabecalho ? idx(["descricao", "historico", "memo", "lancamento"]) : 1;
  const iValor = temCabecalho ? idx(["valor", "amount", "montante"]) : 2;
  const iDoc = temCabecalho ? idx(["documento", "doc", "identificador"]) : -1;
  const iTipo = temCabecalho ? idx(["tipo", "credito/debito"]) : -1;

  const linhas: LinhaExtrato[] = [];
  for (const texto of linhasTexto.slice(temCabecalho ? 1 : 0)) {
    const cols = separarColunas(texto, sep);
    const data = normalizarData(cols[iData >= 0 ? iData : 0] ?? "");
    const valor = normalizarValor(cols[iValor >= 0 ? iValor : 2] ?? "");
    if (!data || valor === 0) continue;
    const tipoTexto = (iTipo >= 0 ? cols[iTipo] : "").toLowerCase();
    const debito = valor < 0 || tipoTexto.startsWith("d") || tipoTexto.includes("saida");
    linhas.push({
      data,
      descricao: (cols[iDesc >= 0 ? iDesc : 1] ?? "").trim() || "Lançamento bancário",
      valor: Math.abs(valor),
      tipo: debito ? "debito" : "credito",
      documento: iDoc >= 0 ? cols[iDoc] || null : null,
      fitid: null,
    });
  }
  return linhas;
}

export function lerExtrato(nomeArquivo: string, conteudo: string): LinhaExtrato[] {
  const nome = nomeArquivo.toLowerCase();
  if (nome.endsWith(".ofx") || /<STMTTRN>/i.test(conteudo)) return parseOFX(conteudo);
  return parseCSV(conteudo);
}

/** Marca linhas repetidas dentro do próprio arquivo. */
export function chaveLinha(l: LinhaExtrato) {
  return `${l.data}|${l.valor.toFixed(2)}|${l.tipo}|${l.descricao.toLowerCase()}|${l.fitid ?? ""}`;
}
