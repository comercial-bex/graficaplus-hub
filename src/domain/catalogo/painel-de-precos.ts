/**
 * O que `catalogo_painel_de_precos()` devolve, lido com desconfiança: número
 * que vem como texto (numeric do Postgres) vira número; o que falta vira null,
 * nunca zero — zero de preço seria mentira na tela da gerência.
 */

export type ExemploDoPainel = {
  nome: string;
  codigo_bex: string;
  unidade: string | null;
  custo: number | null;
  frete: number;
  preco: number | null;
  /** preço − custo − frete, por peça; null quando falta custo ou preço. */
  ganho: number | null;
};

export type CategoriaNoPainel = {
  categoria: string;
  itens: number;
  itens_com_preco: number;
  menor_preco: number | null;
  maior_preco: number | null;
  exemplo: ExemploDoPainel | null;
};

export type CatalogoNoPainel = {
  catalogo_id: string;
  titulo: string;
  regra: {
    margem_pct: number | null;
    frete_por_peca: number | null;
    arredondamento: number | null;
    atualizado_em: string | null;
    atualizado_por: string | null;
  } | null;
  excecoes: number;
  totais: {
    itens: number;
    itens_com_preco: number;
    opcoes: number;
    opcoes_com_preco: number;
    opcoes_sob_consulta: number;
  };
  categorias: CategoriaNoPainel[];
};

type Dados = Record<string, unknown>;

function obj(v: unknown): Dados {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Dados) : {};
}

function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function inteiro(v: unknown): number {
  return numeroOuNulo(v) ?? 0;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

function lerExemplo(v: unknown): ExemploDoPainel | null {
  const e = obj(v);
  const nome = textoOuNulo(e.nome);
  if (!nome) return null;
  const custo = numeroOuNulo(e.custo);
  const preco = numeroOuNulo(e.preco);
  const frete = numeroOuNulo(e.frete) ?? 0;
  return {
    nome,
    codigo_bex: textoOuNulo(e.codigo_bex) ?? "",
    unidade: textoOuNulo(e.unidade),
    custo,
    frete,
    preco,
    ganho: custo != null && preco != null ? centavos(preco - custo - frete) : null,
  };
}

export function lerPainelDePrecos(bruto: unknown): CatalogoNoPainel[] {
  const lista = obj(bruto).catalogos;
  if (!Array.isArray(lista)) return [];
  return lista.map((item) => {
    const c = obj(item);
    const r = c.regra == null ? null : obj(c.regra);
    const t = obj(c.totais);
    const categorias = Array.isArray(c.categorias) ? c.categorias : [];
    return {
      catalogo_id: String(c.catalogo_id ?? ""),
      titulo: textoOuNulo(c.titulo) ?? "Catálogo",
      regra: r
        ? {
            margem_pct: numeroOuNulo(r.margem_pct),
            frete_por_peca: numeroOuNulo(r.frete_por_peca),
            arredondamento: numeroOuNulo(r.arredondamento),
            atualizado_em: textoOuNulo(r.atualizado_em),
            atualizado_por: textoOuNulo(r.atualizado_por),
          }
        : null,
      excecoes: inteiro(c.excecoes),
      totais: {
        itens: inteiro(t.itens),
        itens_com_preco: inteiro(t.itens_com_preco),
        opcoes: inteiro(t.opcoes),
        opcoes_com_preco: inteiro(t.opcoes_com_preco),
        opcoes_sob_consulta: inteiro(t.opcoes_sob_consulta),
      },
      categorias: categorias.map((g) => {
        const x = obj(g);
        return {
          categoria: textoOuNulo(x.categoria) ?? "outros",
          itens: inteiro(x.itens),
          itens_com_preco: inteiro(x.itens_com_preco),
          menor_preco: numeroOuNulo(x.menor_preco),
          maior_preco: numeroOuNulo(x.maior_preco),
          exemplo: lerExemplo(x.exemplo),
        };
      }),
    };
  });
}
