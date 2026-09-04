/**
 * CSV de ida e volta para a planilha de custos.
 *
 * O arquivo vai ser aberto no Excel em português — e o Excel pt-BR usa PONTO E
 * VÍRGULA como separador e VÍRGULA como decimal. Um CSV escrito no padrão
 * americano abre lá com tudo numa coluna só; um lido no padrão americano
 * transforma "9,50" em duas colunas ou em 9. Nos dois casos o custo entra
 * errado e ninguém percebe, porque o arquivo "abriu".
 *
 * Por isso o separador é detectado na leitura e é `;` na escrita, e o decimal
 * aceita as duas formas.
 */

export type LinhaCSV = Record<string, string>;

/** Detecta `;` ou `,` pelo cabeçalho — o que aparecer mais vezes fora de aspas. */
export function detectarSeparador(cabecalho: string): ";" | "," | "\t" {
  const contar = (sep: string) => {
    let n = 0;
    let dentroDeAspas = false;
    for (let i = 0; i < cabecalho.length; i++) {
      const c = cabecalho[i];
      if (c === '"') dentroDeAspas = !dentroDeAspas;
      else if (c === sep && !dentroDeAspas) n++;
    }
    return n;
  };
  const candidatos: (";" | "," | "\t")[] = [";", ",", "\t"];
  return candidatos.reduce((melhor, sep) => (contar(sep) > contar(melhor) ? sep : melhor), ";");
}

/** Divide uma linha respeitando aspas e aspas escapadas (`""`). */
function dividirLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
    } else if (c === sep && !dentroDeAspas) {
      campos.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/**
 * Lê o CSV inteiro. Quebra de linha dentro de aspas é respeitada — endereço e
 * observação com quebra são comuns e picotariam a planilha.
 */
export function deCSV(texto: string): LinhaCSV[] {
  // BOM que o Excel escreve; sem tirar, a primeira coluna vira "﻿nome".
  const limpo = texto.replace(/^﻿/, "");
  if (!limpo.trim()) return [];

  const linhas: string[] = [];
  let atual = "";
  let dentroDeAspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (c === '"') dentroDeAspas = !dentroDeAspas;
    if ((c === "\n" || c === "\r") && !dentroDeAspas) {
      if (c === "\r" && limpo[i + 1] === "\n") i++;
      linhas.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  if (atual !== "") linhas.push(atual);

  const comConteudo = linhas.filter((l) => l.trim() !== "");
  if (comConteudo.length === 0) return [];

  const sep = detectarSeparador(comConteudo[0]);
  const colunas = dividirLinha(comConteudo[0], sep).map((c) => c.toLowerCase());

  return comConteudo.slice(1).map((linha) => {
    const campos = dividirLinha(linha, sep);
    const registro: LinhaCSV = {};
    colunas.forEach((coluna, i) => {
      registro[coluna] = campos[i] ?? "";
    });
    return registro;
  });
}

/**
 * Número em português OU inglês.
 *
 * "1.234,56" (pt) e "1,234.56" (en) são o mesmo valor escrito de dois jeitos, e
 * "9,50" e "9.50" também. A regra: o último separador que aparecer é o decimal.
 * Devolve `null` quando não dá para ler — nunca 0, porque custo zero e custo
 * ilegível levam a decisões opostas.
 */
export function lerNumero(bruto: string | null | undefined): number | null {
  if (bruto == null) return null;
  const texto = String(bruto).trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (texto === "") return null;

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");
  let normalizado = texto;

  if (temVirgula && temPonto) {
    // O separador decimal é o que vem por último.
    normalizado =
      texto.lastIndexOf(",") > texto.lastIndexOf(".")
        ? texto.replace(/\./g, "").replace(",", ".")
        : texto.replace(/,/g, "");
  } else if (temVirgula) {
    // Só vírgula: decimal, salvo quando é claramente milhar ("1,234").
    const depois = texto.split(",")[1] ?? "";
    normalizado = depois.length === 3 && !/^0/.test(depois) ? texto.replace(/,/g, "") : texto.replace(",", ".");
  }

  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

/** Escreve um valor pt-BR com vírgula decimal, para abrir certo no Excel. */
export function escreverNumero(valor: number | null | undefined, casas = 4): string {
  if (valor == null || !Number.isFinite(valor)) return "";
  return valor.toFixed(casas).replace(".", ",");
}

function escapar(valor: string): string {
  return /[";\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/**
 * Gera o CSV. Separador `;` e BOM, que é o que o Excel pt-BR espera — sem o BOM
 * ele lê o arquivo como Latin-1 e os acentos viram caracteres estranhos.
 */
export function paraCSV(colunas: string[], linhas: LinhaCSV[]): string {
  const cabecalho = colunas.map(escapar).join(";");
  const corpo = linhas.map((linha) => colunas.map((c) => escapar(linha[c] ?? "")).join(";"));
  return "﻿" + [cabecalho, ...corpo].join("\r\n") + "\r\n";
}
