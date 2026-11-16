/**
 * Contas da tela "Preços por produto". Funções puras, sem banco e sem tela.
 *
 * Margem é sobre a venda, em percentual. O piso é round(custo / (1 - margem mínima / 100), 2), a mesma
 * conta da função _preco_piso do banco. A tela nunca grava preço: ela só pede aprovação.
 */
import {
  type CelulaDoMapa,
  type CustoRealDoProduto,
  type LeituraReal,
  celulaDoMapa,
  leituraReal,
  mesmaCelula,
} from "./custo-real";
import { FOLGA_AMARELA, type FaixaDaMargem, faixaDaMargem } from "./propostas";

export type LinhaDePreco = {
  id: string;
  nome: string;
  familia: string | null;
  unidade: string;
  /** Custo de material do cadastro, base do piso. */
  custo: number | null;
  /** Custo cheio, só para mostrar ao lado. */
  custo_cheio: number | null;
  preco: number | null;
  margem_minima: number | null;
  preco_parceiro: number | null;
  /** Custo real da visão produto_custo_real. Ausente quando o banco ainda não entrega ou o produto não tem linha. */
  real?: CustoRealDoProduto | null;
};

export type Situacao = "abaixo" | "sem_custo" | "sem_preco" | "justa" | "boa";
export type Problema = "abaixo" | "sem_custo" | "sem_preco" | "parceiro_acima";
export type FiltroDeProblema = "todos" | Problema;
export type Ordem = "problema" | "nome" | "preco" | "margem";

export const ROTULO_DA_SITUACAO: Record<Situacao, string> = {
  abaixo: "Abaixo do piso",
  sem_custo: "Sem custo",
  sem_preco: "Sem preço",
  justa: "Margem justa",
  boa: "Margem boa",
};

export const ROTULO_DO_PROBLEMA: Record<FiltroDeProblema, string> = {
  todos: "Todos",
  abaixo: "Abaixo do piso",
  sem_custo: "Sem custo",
  sem_preco: "Sem preço",
  parceiro_acima: "Parceiro acima do balcão",
};

const centavos = (n: number) => Math.round(n * 100) / 100;

export function pisoDe(custo: number | null, margemMinima: number | null): number | null {
  const m = margemMinima ?? 0;
  if (custo == null || !(custo > 0) || m >= 100) return null;
  return centavos(custo / (1 - m / 100));
}

export function margemDe(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null || !(preco > 0)) return null;
  return Math.round(((preco - custo) / preco) * 1000) / 10;
}

/** Aceita 70, 70,4, 70.40 e 1.234,56. Devolve nulo para texto vazio, negativo ou sem sentido. */
export function lerReais(texto: string): number | null {
  const t = texto
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");
  if (t === "") return null;
  let normal: string;
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "");
  else normal = t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type Avaliacao = {
  situacao: Situacao;
  piso: number | null;
  margem: number | null;
  faixa: FaixaDaMargem;
  /** O preço do parceiro passaria do balcão. */
  parceiroAcima: boolean;
  semCusto: boolean;
  semPreco: boolean;
};

/** Avalia um produto com o preço dado, que pode ser o do cadastro ou o que está sendo digitado. */
export function avaliar(
  l: Pick<LinhaDePreco, "custo" | "margem_minima" | "preco_parceiro">,
  preco: number | null,
): Avaliacao {
  const piso = pisoDe(l.custo, l.margem_minima);
  const margem = margemDe(preco, l.custo);
  const faixa = faixaDaMargem(margem, l.margem_minima);
  const parceiroAcima =
    preco != null && preco > 0 && l.preco_parceiro != null && l.preco_parceiro > preco;
  let situacao: Situacao;
  if (l.custo == null || !(l.custo > 0)) situacao = "sem_custo";
  else if (preco == null || !(preco > 0)) situacao = "sem_preco";
  else if (faixa === "abaixo") situacao = "abaixo";
  else if (faixa === "perto") situacao = "justa";
  else situacao = "boa";
  return {
    situacao,
    piso,
    margem,
    faixa,
    parceiroAcima,
    semCusto: l.custo == null || !(l.custo > 0),
    semPreco: preco == null || !(preco > 0),
  };
}

export function avaliarLinha(l: LinhaDePreco): Avaliacao {
  return avaliar(l, l.preco);
}

export function problemasDe(a: Avaliacao): Problema[] {
  const p: Problema[] = [];
  if (a.situacao === "abaixo") p.push("abaixo");
  if (a.semCusto) p.push("sem_custo");
  if (a.semPreco) p.push("sem_preco");
  if (a.parceiroAcima) p.push("parceiro_acima");
  return p;
}

const ORDEM_DO_PROBLEMA: Problema[] = ["abaixo", "sem_custo", "sem_preco", "parceiro_acima"];

/** Posição de abertura: abaixo do piso, sem custo, sem preço, parceiro acima do balcão, o resto. */
export function prioridade(a: Avaliacao): number {
  const p = problemasDe(a);
  const i = ORDEM_DO_PROBLEMA.findIndex((x) => p.includes(x));
  return i === -1 ? ORDEM_DO_PROBLEMA.length : i;
}

export type Contagem = Record<Problema, number>;

export function contar(linhas: LinhaDePreco[]): Contagem {
  const c: Contagem = { abaixo: 0, sem_custo: 0, sem_preco: 0, parceiro_acima: 0 };
  for (const l of linhas) for (const p of problemasDe(avaliarLinha(l))) c[p] += 1;
  return c;
}

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function familiasDe(linhas: LinhaDePreco[]): string[] {
  return [...new Set(linhas.map((l) => l.familia).filter((f): f is string => !!f))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

export function filtrar(
  linhas: LinhaDePreco[],
  f: {
    familia: string | null;
    problema: FiltroDeProblema;
    busca: string;
    /** Célula do mapa de margem tocada, ou nulo para todas. */
    celula?: CelulaDoMapa | null;
  },
): LinhaDePreco[] {
  const q = semAcento(f.busca.trim());
  return linhas.filter((l) => {
    if (f.familia && (l.familia ?? "") !== f.familia) return false;
    if (q && !semAcento(l.nome).includes(q)) return false;
    if (f.problema !== "todos" && !problemasDe(avaliarLinha(l)).includes(f.problema)) return false;
    if (f.celula && !mesmaCelula(celulaDoMapa(l, l.preco), f.celula)) return false;
    return true;
  });
}

export function ordenar(linhas: LinhaDePreco[], ordem: Ordem): LinhaDePreco[] {
  const nome = (a: LinhaDePreco, b: LinhaDePreco) => a.nome.localeCompare(b.nome, "pt-BR");
  const copia = [...linhas];
  if (ordem === "nome") return copia.sort(nome);
  if (ordem === "preco")
    return copia.sort((a, b) => (a.preco ?? Infinity) - (b.preco ?? Infinity) || nome(a, b));
  if (ordem === "margem") {
    // Margem líquida quando há custo real; senão a de material, como antes.
    const chave = (l: LinhaDePreco) =>
      leituraReal(l, l.preco).margem ?? avaliarLinha(l).margem ?? -Infinity;
    return copia.sort((a, b) => chave(a) - chave(b) || nome(a, b));
  }
  // Problema no topo; dentro do mesmo grupo, a menor margem primeiro.
  return copia.sort((a, b) => {
    const aa = avaliarLinha(a);
    const bb = avaliarLinha(b);
    return (
      prioridade(aa) - prioridade(bb) ||
      (aa.margem ?? Infinity) - (bb.margem ?? Infinity) ||
      nome(a, b)
    );
  });
}

/** Texto da margem, escrito por extenso, sem parênteses. */
export function frasesDaMargem(a: Avaliacao, minima: number | null): string {
  const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (a.margem == null) return "Sem margem, falta custo ou preço";
  if (minima == null) return `Margem de ${n(a.margem)} por cento`;
  if (a.faixa === "abaixo")
    return `Margem de ${n(a.margem)} por cento, abaixo do mínimo de ${n(minima)}`;
  if (a.faixa === "perto")
    return `Margem de ${n(a.margem)} por cento, perto do mínimo de ${n(minima)}`;
  return `Margem de ${n(a.margem)} por cento, acima do mínimo de ${n(minima)}`;
}

export type Previa = {
  piso: number | null;
  margem: number | null;
  avaliacao: Avaliacao;
  mudou: boolean;
  /** Frase de aviso, ou nulo quando o preço está certo. */
  aviso: string | null;
  /** Pode enviar o pedido: preço válido e diferente do atual. */
  podePedir: boolean;
  /** Abaixo do piso exige motivo escrito. */
  exigeMotivo: boolean;
  /** Margem líquida, vezes o custo e regra de três para o preço digitado. */
  real: LeituraReal;
};

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O que a linha mostra na hora em que a pessoa digita. */
export function previaDoPreco(l: LinhaDePreco, texto: string): Previa {
  const digitado = lerReais(texto);
  const avaliacao = avaliar(l, digitado ?? l.preco);
  const mudou = digitado != null && (l.preco == null || Math.abs(digitado - l.preco) >= 0.005);
  const avisos: string[] = [];
  if (texto.trim() !== "" && digitado == null)
    avisos.push("Digite um valor em reais, por exemplo 70,40.");
  else if (digitado != null) {
    if (avaliacao.situacao === "abaixo" && avaliacao.piso != null) {
      avisos.push(
        `Abaixo do piso de ${reais(avaliacao.piso)}. O motivo é obrigatório.`,
      );
    }
    if (avaliacao.parceiroAcima)
      avisos.push("O preço do parceiro ficaria acima do balcão. Isso não pode.");
    if (avaliacao.situacao === "sem_custo")
      avisos.push("Sem custo cadastrado, não dá para conferir o piso.");
  }
  const aviso = avisos.length ? avisos.join(" ") : null;
  return {
    piso: avaliacao.piso,
    margem: avaliacao.margem,
    avaliacao,
    mudou,
    aviso,
    podePedir: digitado != null && mudou && !avaliacao.parceiroAcima,
    exigeMotivo: digitado != null && avaliacao.situacao === "abaixo",
    real: leituraReal(l, digitado ?? l.preco),
  };
}

/** Quando o banco ainda não tem a função de pedir aprovação, a mensagem é humana e não um código. */
export function mensagemDoPedido(mensagem: string): string {
  const m = mensagem.toLowerCase();
  const ausente =
    m.includes("preco_proposta_criar") &&
    (m.includes("does not exist") ||
      m.includes("could not find") ||
      m.includes("schema cache") ||
      m.includes("pgrst202") ||
      m.includes("42883"));
  return ausente
    ? "O pedido de aprovação ainda não está ligado no banco. Avise o suporte e tente mais tarde."
    : mensagem;
}

export { FOLGA_AMARELA };
