import type { Modalidade, UnidadeDePreco } from "@/domain/catalogo/modalidades";
import type { MotivoSobConsulta, OrigemDoPreco } from "@/domain/catalogo/preco-de-venda";
import type { FotoDoItem } from "@/domain/catalogo/fotos";

/**
 * O item do catálogo como a tela da equipe lê, e os filtros da grade.
 *
 * As listas de colunas ficam AQUI, fechadas, e são as colunas reais das
 * tabelas da migração 20261005200000: nesta base, um select que pede coluna
 * inexistente derruba a consulta inteira — e a tela mostraria "nenhum item".
 *
 * Domínio puro.
 */

export const COLUNAS_DO_ITEM =
  "id, catalogo_id, secao_id, codigo_bex, codigo_fornecedor, descricao, nome, especificacao, dimensoes, " +
  "embalagem, unidade_preco, quantidade_minima, multiplo, quantidade_minima_gravada, e_embalagem, " +
  "foto_id, tem_foto, foto_conferir, situacao, fora_desde, em_duvida, duvida, observacao, pagina, ordem";

export const COLUNAS_DA_MODALIDADE =
  "modalidade, posicao, quantidade_minima, multiplo, faixa, faixa_max, rotulo_inferido";

export const COLUNAS_DA_FOTO = "id, codigo_fornecedor, legenda, origem, caminho";

export const COLUNAS_DA_SECAO = "id, ordem, titulo, especificacao, categoria";

export type ModalidadeDoItem = {
  modalidade: Modalidade;
  posicao: number;
  quantidade_minima: number | null;
  multiplo: number | null;
  faixa: string | null;
  faixa_max: number | null;
  rotulo_inferido: boolean;
};

export type ItemDoCatalogo = {
  id: string;
  catalogo_id: string;
  secao_id: string | null;
  codigo_bex: string;
  codigo_fornecedor: string;
  descricao: string;
  nome: string;
  especificacao: string | null;
  dimensoes: string | null;
  embalagem: string | null;
  unidade_preco: UnidadeDePreco;
  quantidade_minima: number | null;
  multiplo: number | null;
  quantidade_minima_gravada: number | null;
  e_embalagem: boolean;
  foto_id: string | null;
  tem_foto: boolean;
  foto_conferir: boolean;
  situacao: "ativo" | "fora_da_tabela";
  fora_desde: string | null;
  em_duvida: boolean;
  duvida: string | null;
  observacao: string | null;
  pagina: number | null;
  ordem: number;
  modalidades: ModalidadeDoItem[];
};

export type FotoDoAcervo = FotoDoItem & {
  id: string;
  codigo_fornecedor: string | null;
  legenda: string | null;
};

export type SecaoDoCatalogo = {
  id: string;
  ordem: number;
  titulo: string;
  especificacao: string | null;
  /** A prateleira da loja (`categorias.ts`); `null` = ainda não apontada, a loja deduz do título. */
  categoria: string | null;
};

/** Uma linha de `catalogo_precos().precos[item]`. Custo e margem só vêm no nível financeiro. */
export type PrecoDaOpcao = {
  modalidade: Modalidade;
  preco: number | null;
  motivo: MotivoSobConsulta | null;
  regra: OrigemDoPreco | null;
  custo?: number | null;
  adicional_por_cor?: number | null;
  margem_pct?: number | null;
  frete_por_peca?: number | null;
  preco_fixo?: number | null;
};

export type PrecosDoCatalogo = {
  nivel: "comercial" | "financeiro";
  precos: Record<string, PrecoDaOpcao[]>;
};

/** O número que vem do PostgREST pode vir texto (numeric grande): sempre número ou null. */
export function numeroOuNulo(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Normaliza a linha crua do banco (numeric como texto, modalidades fora de ordem). */
export function itemDaLinha(linha: Record<string, unknown>): ItemDoCatalogo {
  const modalidades = (
    Array.isArray(linha.fornecedor_item_modalidades) ? linha.fornecedor_item_modalidades : []
  )
    .map((m: Record<string, unknown>) => ({
      modalidade: m.modalidade as Modalidade,
      posicao: Number(m.posicao ?? 0),
      quantidade_minima: numeroOuNulo(m.quantidade_minima),
      multiplo: numeroOuNulo(m.multiplo),
      faixa: (m.faixa as string | null) ?? null,
      faixa_max: numeroOuNulo(m.faixa_max),
      rotulo_inferido: Boolean(m.rotulo_inferido),
    }))
    .sort((a, b) => a.posicao - b.posicao);
  return {
    id: String(linha.id),
    catalogo_id: String(linha.catalogo_id),
    secao_id: (linha.secao_id as string | null) ?? null,
    codigo_bex: String(linha.codigo_bex),
    codigo_fornecedor: String(linha.codigo_fornecedor),
    descricao: String(linha.descricao ?? ""),
    nome: String(linha.nome ?? ""),
    especificacao: (linha.especificacao as string | null) ?? null,
    dimensoes: (linha.dimensoes as string | null) ?? null,
    embalagem: (linha.embalagem as string | null) ?? null,
    unidade_preco: (linha.unidade_preco as UnidadeDePreco) ?? "unidade",
    quantidade_minima: numeroOuNulo(linha.quantidade_minima),
    multiplo: numeroOuNulo(linha.multiplo),
    quantidade_minima_gravada: numeroOuNulo(linha.quantidade_minima_gravada),
    e_embalagem: Boolean(linha.e_embalagem),
    foto_id: (linha.foto_id as string | null) ?? null,
    tem_foto: Boolean(linha.tem_foto),
    foto_conferir: Boolean(linha.foto_conferir),
    situacao: linha.situacao === "fora_da_tabela" ? "fora_da_tabela" : "ativo",
    fora_desde: (linha.fora_desde as string | null) ?? null,
    em_duvida: Boolean(linha.em_duvida),
    duvida: (linha.duvida as string | null) ?? null,
    observacao: (linha.observacao as string | null) ?? null,
    pagina: numeroOuNulo(linha.pagina),
    ordem: Number(linha.ordem ?? 0),
    modalidades,
  };
}

export type FiltroDoCatalogo =
  | "todos"
  | "com_foto"
  | "sem_foto"
  | "foto_a_conferir"
  | "sem_preco"
  | "em_duvida"
  | "fora_da_tabela";

export const ROTULO_DO_FILTRO: Record<FiltroDoCatalogo, string> = {
  todos: "Todos",
  com_foto: "Com foto",
  sem_foto: "Sem foto",
  foto_a_conferir: "Foto a conferir",
  sem_preco: "Sem preço de venda",
  em_duvida: "Unidade em dúvida",
  fora_da_tabela: "Fora da tabela",
};

function chaveDeBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Item que não tem NENHUMA opção com preço de venda (é contagem, não valor). */
export function semPrecoDeVenda(
  item: ItemDoCatalogo,
  precos: PrecosDoCatalogo | null | undefined,
): boolean {
  const lista = precos?.precos[item.id] ?? [];
  return !lista.some((p) => p.preco != null);
}

/**
 * Busca e filtro da grade. A busca casa nome, descrição, código BX e código do
 * fornecedor, sem acento e sem caixa; "bx12" acha "BX-0012".
 */
export function filtrarItens(
  itens: ItemDoCatalogo[],
  criterio: { busca: string; secaoId: string | null; filtro: FiltroDoCatalogo },
  precos?: PrecosDoCatalogo | null,
): ItemDoCatalogo[] {
  const termos = chaveDeBusca(criterio.busca).split(/\s+/).filter(Boolean);
  return itens.filter((item) => {
    if (criterio.secaoId && item.secao_id !== criterio.secaoId) return false;
    switch (criterio.filtro) {
      case "com_foto":
        if (!item.tem_foto) return false;
        break;
      case "sem_foto":
        if (item.tem_foto) return false;
        break;
      case "foto_a_conferir":
        if (!item.foto_conferir) return false;
        break;
      case "sem_preco":
        if (!precos || !semPrecoDeVenda(item, precos)) return false;
        break;
      case "em_duvida":
        if (!item.em_duvida) return false;
        break;
      case "fora_da_tabela":
        if (item.situacao !== "fora_da_tabela") return false;
        break;
      default:
        break;
    }
    if (termos.length === 0) return true;
    const alvo = chaveDeBusca(
      `${item.nome} ${item.descricao} ${item.codigo_bex} ${item.codigo_fornecedor}`,
    );
    const codigos = `${item.codigo_bex} ${item.codigo_fornecedor}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return termos.every((t) => {
      if (alvo.includes(t)) return true;
      const compacto = t.replace(/[^a-z0-9]/g, "");
      if (!compacto) return false;
      // "bx12" acha "BX-0012": compara o código sem traço e sem zero à esquerda.
      const semZeros = compacto.replace(/^bx0*/, "bx");
      return codigos.includes(compacto) || codigos.replace(/bx0*/g, "bx").includes(semZeros);
    });
  });
}

/** As fotos do acervo para apontar num item: as do mesmo código primeiro. */
export function fotosParaApontar(
  fotos: FotoDoAcervo[],
  item: Pick<ItemDoCatalogo, "codigo_fornecedor">,
  busca: string,
): { doCodigo: FotoDoAcervo[]; outras: FotoDoAcervo[] } {
  const codigo = item.codigo_fornecedor
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .replace(/^0+/, "");
  const doCodigo = fotos.filter(
    (f) =>
      (f.codigo_fornecedor ?? "")
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .replace(/^0+/, "") === codigo,
  );
  const termos = chaveDeBusca(busca).split(/\s+/).filter(Boolean);
  const outras =
    termos.length === 0
      ? []
      : fotos
          .filter((f) => !doCodigo.includes(f))
          .filter((f) => {
            const alvo = chaveDeBusca(`${f.legenda ?? ""} ${f.codigo_fornecedor ?? ""}`);
            return termos.every((t) => alvo.includes(t));
          })
          .slice(0, 60);
  return { doCodigo, outras };
}
