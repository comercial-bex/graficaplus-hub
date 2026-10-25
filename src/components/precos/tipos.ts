import type { Composicao } from "@/domain/precos/tabela-de-precos";

export type Produto = {
  id: string;
  nome: string;
  categoria: string | null;
  tipo: string | null;
  unidade: string;
  custo_medio: number | null;
  preco_base: number | null;
  preco_parceiro: number | null;
  ativo: boolean;
  margem_minima: number | null;
  imagem_url: string | null;
  tempo_producao_min: number | null;
  maquina_padrao_id: string | null;
  observacoes_internas?: string | null;
};
export type TipoDePreco = "final" | "parceiro";
export type Concorrente = {
  id: string;
  produto_id: string;
  concorrente: string;
  preco: number;
  tipo_preco: TipoDePreco;
  fonte: string | null;
  coletado_em: string;
};
export type LinhaDaReceita = { material: string; unidade: string; quantidade: number; custoUnitario: number };
export type Linha = {
  produto: Produto;
  familia: string | null;
  custo: number | null;
  /** custo do cadastro OU o cheio, conforme a base escolhida na tela */
  custoBase: number | null;
  cheio: number | null;
  /** custo e preço de balcão copiados de um produto parecido */
  provisorio: boolean;
  composicao: Composicao | null;
  receita: LinhaDaReceita[];
  venda: number | null;
  parceiro: { valor: number; origem: "cadastro" | "nivel" } | null;
  promocao: { titulo: string; preco: number } | null;
  concorrentes: Concorrente[];
};

export const ROTULO_DO_TIPO: Record<TipoDePreco, string> = { final: "venda final", parceiro: "terceirizado" };

export const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
export const sinal = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
