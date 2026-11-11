/**
 * A faixa "Mudou depois de enviado/aprovado" da tela do orçamento, em português simples (10/11/2026).
 *
 * A RPC `orcamento_diferenca_da_versao` compara o orçamento de hoje com a versão que o cliente recebeu ou
 * aprovou, olhando só as chaves que a versão guardou (`orcamento_retrato_diferencas`). Ela devolve contagens
 * e nomes de coluna, nunca valor. Este módulo transforma isso em frases:
 *
 *  - o que o cliente viu e o que está hoje;
 *  - o que mudou, com apelidos que a equipe entende (nunca o nome da coluna);
 *  - o que fazer, que depende de o orçamento estar enviado ou aprovado e de o valor ter mudado ou não.
 *
 * A faixa só aparece onde dá para agir: orçamento enviado ou aprovado. Em convertido, rejeitado, expirado ou
 * rascunho a instrução não serviria (das 38 faixas falsas de 05/11, 19 estavam em orçamento convertido ou
 * rejeitado).
 */

export type OQueMudou = {
  mudou?: boolean;
  itens_novos?: number;
  itens_tirados?: number;
  itens_mudados?: number;
  /** Colunas do item que mudaram (só as que a versão guardou). */
  campos?: string[];
  /** Termos do cabeçalho que o cliente vê no documento e que trocaram. */
  termos?: string[];
  retrato_sem_itens?: boolean;
};

export type DiferencaDaVersao = {
  tem_versao: boolean;
  numero?: number;
  /** Da versão: "enviada" ou "aprovada". */
  status?: string;
  retroativa?: boolean;
  valor_da_versao?: number;
  valor_atual?: number;
  mudou?: boolean;
  valor_mudou?: boolean;
  /** Ausente quando o banco ainda não tem a comparação nova: a tela tolera. */
  o_que_mudou?: OQueMudou | null;
};

/** Os únicos status do orçamento em que a faixa faz sentido. */
const STATUS_COM_FAIXA = ["enviado", "aprovado"];

export function orcamentoPedeConferirVersao(statusDoOrcamento: string | null | undefined): boolean {
  return !!statusDoOrcamento && STATUS_COM_FAIXA.includes(statusDoOrcamento);
}

const APELIDO_DO_ITEM: Record<string, string> = {
  descricao: "descrição",
  quantidade: "quantidade",
  unidade: "unidade",
  valor_unitario: "preço",
  valor_total: "preço",
  preco_m2: "preço",
  desconto: "preço",
  ordem: "ordem das linhas",
  produto_id: "produto",
  tipo_produto: "produto",
  origem_calculo: "forma de cálculo",
  largura: "medida",
  altura: "medida",
  area_unitaria: "área",
  area_total: "área",
  area_minima: "área",
  area_cobrada: "área",
  acabamento: "acabamento",
  especificacao: "especificação",
  respostas: "respostas do produto",
  gerado_por_item_id: "vínculo entre itens",
  instala_item_id: "vínculo entre itens",
};

const APELIDO_DO_TERMO: Record<string, string> = {
  cliente_id: "cliente",
  validade_dias: "validade",
  prazo: "prazo de entrega",
  prazo_tipo: "prazo de entrega",
  data_entrega_prometida: "prazo de entrega",
  desconto_modo: "desconto",
  desconto_informado: "desconto",
  desconto_percentual: "desconto",
  desconto_valor: "desconto",
  preco_modo: "tipo de preço",
  precisa_entrega: "entrega ou instalação",
  precisa_instalacao: "entrega ou instalação",
  titulo: "título",
  observacao_cliente: "observação para o cliente",
};

/** Como a equipe chama a coluna do item que mudou. Coluna que não conhecemos vira "dados do item". */
export function apelidoDoCampo(chave: string): string {
  return APELIDO_DO_ITEM[chave] ?? "dados do item";
}

/** Como a equipe chama o termo do cabeçalho que mudou. */
export function apelidoDoTermo(chave: string): string {
  if (chave.startsWith("condicao_pagamento.")) return "forma de pagamento";
  return APELIDO_DO_TERMO[chave] ?? "condições do orçamento";
}

/** "a", "a e b", "a, b e c". Sem repetir o mesmo apelido (largura e altura são "medida"). */
export function listaEmFrase(itens: string[]): string {
  const unicos = [...new Set(itens)];
  if (unicos.length <= 1) return unicos[0] ?? "";
  return `${unicos.slice(0, -1).join(", ")} e ${unicos[unicos.length - 1]}`;
}

const brl = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const plural = (n: number, singular: string, pluralDe: string) =>
  `${n} ${n === 1 ? singular : pluralDe}`;

export type FrasesDaFaixa = {
  /** Negrito, 16 px: "Mudou depois de enviado". */
  titulo: string;
  /** O que o cliente viu e o que está hoje. */
  valor: string;
  /** Zero, uma ou duas frases: o que mudou nos itens e o que mudou nos termos. */
  oQueMudou: string[];
  /** O que a pessoa faz agora. */
  oQueFazer: string;
};

/**
 * As frases da faixa, ou `null` quando ela não deve aparecer: sem versão, sem mudança, ou orçamento que já não
 * está enviado nem aprovado. Mudança só nos termos do cabeçalho (prazo, validade, desconto, forma de pagamento)
 * também acende a faixa: o cliente vê isso no documento.
 */
export function frasesDaFaixa(
  versao: DiferencaDaVersao | null | undefined,
  statusDoOrcamento: string | null | undefined,
): FrasesDaFaixa | null {
  if (!versao?.tem_versao) return null;
  if (!orcamentoPedeConferirVersao(statusDoOrcamento)) return null;

  const dif = versao.o_que_mudou ?? null;
  const termos = dif?.termos ?? [];
  if (!versao.mudou && termos.length === 0) return null;

  const aprovada = versao.status === "aprovada";
  const valorMudou = !!versao.valor_mudou;

  let valor = valorMudou
    ? `O cliente ${aprovada ? "aprovou" : "recebeu"} ${brl(versao.valor_da_versao)} e hoje o orçamento está em ${brl(versao.valor_atual)}.`
    : `O valor continua ${brl(versao.valor_da_versao)}.`;
  if (versao.retroativa) {
    valor += ` A versão ${versao.numero ?? 1} é um retrato de 22/10, quando o controle começou.`;
  }

  const partes: string[] = [];
  const novos = dif?.itens_novos ?? 0;
  const tirados = dif?.itens_tirados ?? 0;
  const mudados = dif?.itens_mudados ?? 0;
  if (novos > 0) partes.push(plural(novos, "item novo", "itens novos"));
  if (tirados > 0) partes.push(plural(tirados, "item tirado", "itens tirados"));
  if (mudados > 0) {
    const campos = listaEmFrase((dif?.campos ?? []).map(apelidoDoCampo)) || "dados do item";
    partes.push(`${campos} em ${plural(mudados, "item", "itens")}`);
  }

  const oQueMudou: string[] = [];
  if (partes.length > 0) oQueMudou.push(`Mudou: ${partes.join(", ")}.`);
  if (termos.length > 0) {
    const lista = listaEmFrase(termos.map(apelidoDoTermo));
    oQueMudou.push(`${partes.length > 0 ? "Também mudou" : "Mudou"}: ${lista}.`);
  }
  // Banco sem a comparação nova, ou mudança que só o hash antigo via: ao menos diz que são os itens.
  if (oQueMudou.length === 0 && !valorMudou) oQueMudou.push("Os itens mudaram sem mudar o total.");

  const oQueFazer = !aprovada
    ? "Envie de novo para o cliente ver o orçamento certo."
    : valorMudou
      ? "Para virar OS, volte ao valor aprovado ou peça nova aprovação do cliente."
      : "O valor é o mesmo, então esta mudança não impede de virar OS. Confira com o cliente se ele sabe da mudança.";

  return {
    titulo: `Mudou depois de ${aprovada ? "aprovado" : "enviado"}`,
    valor,
    oQueMudou,
    oQueFazer,
  };
}

/** Quando a conferência falha, a faixa não pode sumir em silêncio (falha que se lê como vazio). */
export const FRASE_DE_FALHA_DA_FAIXA =
  "Não consegui conferir se este orçamento mudou depois de enviado. Atualize a página; se continuar, avise o suporte.";
