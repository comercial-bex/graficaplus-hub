import { ehCategoria, type Categoria } from "@/domain/catalogo/categorias-da-loja";
import {
  ehModalidade,
  ehUnidadeDePreco,
  type Modalidade,
  type UnidadeDePreco,
} from "@/domain/catalogo/modalidades";

/**
 * O que o cliente recebe na vitrine (`/catalogo/$token`), chave por chave.
 *
 * `catalogo_link_abrir` já monta a resposta com lista fechada. A rota de
 * servidor passa a resposta por `vitrineFechada` mesmo assim: se um dia a
 * função do banco ganhar uma chave a mais (um custo, o código do fornecedor),
 * ela para aqui e não chega ao celular do cliente. Duas portas para o mesmo
 * fato dão defeito; duas TRAVAS para o mesmo vazamento, não.
 *
 * NÃO existe aqui, de propósito: nome e código do fornecedor, descrição
 * impressa pelo fornecedor, custo, margem, regra, motivo do "sob consulta".
 *
 * Domínio puro.
 */

export type OpcaoDaVitrine = {
  modalidade: Modalidade;
  rotulo: string;
  /** `null` = sob consulta. Nunca zero. */
  preco: number | null;
  quantidade_minima: number | null;
  multiplo: number | null;
  faixa: string | null;
};

export type ItemDaVitrine = {
  codigo: string;
  nome: string;
  especificacao: string | null;
  dimensoes: string | null;
  secao: string | null;
  /** A prateleira da loja (migração 20261006230000). `null` = deduzida do título da seção. */
  categoria: Categoria | null;
  unidade_preco: UnidadeDePreco;
  foto: { origem: "repositorio" | "storage"; caminho: string };
  opcoes: OpcaoDaVitrine[];
};

export type EmpresaDaVitrine = {
  nome: string | null;
  slogan: string | null;
  cidade: string | null;
  estado: string | null;
  telefones: string | null;
};

export type Vitrine = {
  titulo: string;
  vence_em: string;
  empresa: EmpresaDaVitrine;
  itens: ItemDaVitrine[];
};

/** As únicas chaves que saem para o cliente — o teste de vazamento lê esta lista. */
export const CHAVES_DA_VITRINE = {
  raiz: ["titulo", "vence_em", "empresa", "itens"],
  empresa: ["nome", "slogan", "cidade", "estado", "telefones"],
  item: [
    "codigo",
    "nome",
    "especificacao",
    "dimensoes",
    "secao",
    "categoria",
    "unidade_preco",
    "foto",
    "opcoes",
  ],
  foto: ["origem", "caminho"],
  opcao: ["modalidade", "rotulo", "preco", "quantidade_minima", "multiplo", "faixa"],
} as const;

type Bruto = Record<string, unknown>;

function objeto(valor: unknown): Bruto | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Bruto)
    : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

function numero(valor: unknown): number | null {
  if (valor == null) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Código BX: o único código que o cliente vê. */
const CODIGO_BX = /^BX-[0-9]{4,7}$/;

function opcaoFechada(valor: unknown): OpcaoDaVitrine | null {
  const o = objeto(valor);
  if (!o || !ehModalidade(o.modalidade)) return null;
  const preco = numero(o.preco);
  return {
    modalidade: o.modalidade,
    rotulo: texto(o.rotulo) ?? "Preço",
    // Preço zero ou negativo é defeito, não oferta: vira "sob consulta".
    preco: preco != null && preco > 0 ? preco : null,
    quantidade_minima: numero(o.quantidade_minima),
    multiplo: numero(o.multiplo),
    faixa: texto(o.faixa),
  };
}

function itemFechado(valor: unknown): ItemDaVitrine | null {
  const i = objeto(valor);
  const foto = objeto(i?.foto);
  if (!i || !foto) return null;
  const codigo = texto(i.codigo);
  const caminho = texto(foto.caminho);
  const origem = foto.origem === "repositorio" || foto.origem === "storage" ? foto.origem : null;
  // Sem código BX, sem foto ou sem nome o item não vai: o cliente não teria o que pedir.
  if (!codigo || !CODIGO_BX.test(codigo) || !caminho || !origem) return null;
  return {
    codigo,
    nome: texto(i.nome) ?? codigo,
    especificacao: texto(i.especificacao),
    dimensoes: texto(i.dimensoes),
    secao: texto(i.secao),
    categoria: ehCategoria(i.categoria) ? i.categoria : null,
    unidade_preco: ehUnidadeDePreco(i.unidade_preco) ? i.unidade_preco : "unidade",
    foto: { origem, caminho },
    opcoes: (Array.isArray(i.opcoes) ? i.opcoes : [])
      .map(opcaoFechada)
      .filter((o): o is OpcaoDaVitrine => o !== null),
  };
}

/** A resposta do banco reduzida às chaves combinadas. `null` se não tem a forma esperada. */
export function vitrineFechada(valor: unknown): Vitrine | null {
  const v = objeto(valor);
  if (!v) return null;
  const empresa = objeto(v.empresa) ?? {};
  const venceEm = texto(v.vence_em);
  if (!venceEm || !Array.isArray(v.itens)) return null;
  return {
    titulo: texto(v.titulo) ?? "Catálogo",
    vence_em: venceEm,
    empresa: {
      nome: texto(empresa.nome),
      slogan: texto(empresa.slogan),
      cidade: texto(empresa.cidade),
      estado: texto(empresa.estado),
      telefones: texto(empresa.telefones),
    },
    itens: v.itens.map(itemFechado).filter((i): i is ItemDaVitrine => i !== null),
  };
}

/** As seções da vitrine, na ordem em que aparecem, para o filtro do cliente. */
export function secoesDaVitrine(itens: ItemDaVitrine[]): string[] {
  return [...new Set(itens.map((i) => i.secao).filter((s): s is string => !!s))];
}

/** O menor preço do item (para "a partir de"), ou `null` quando tudo é sob consulta. */
export function menorPreco(item: ItemDaVitrine): number | null {
  const precos = item.opcoes.map((o) => o.preco).filter((p): p is number => p != null);
  return precos.length > 0 ? Math.min(...precos) : null;
}
