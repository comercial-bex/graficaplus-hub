import { normalizarPerguntaDaBase } from "./casar";
import type {
  EventoDoHistorico,
  ProdutoDaBase,
  RamoDaBase,
  RespostaDaBase,
  StatusDaResposta,
} from "./tipos";

/**
 * A fila de aprovação e o que a tela escreve em português simples. Sem
 * travessão, seta nem parênteses em texto de tela.
 */

export const ROTULO_DO_STATUS: Record<StatusDaResposta, string> = {
  rascunho: "Rascunho",
  aprovada: "Aprovada",
  arquivada: "Arquivada",
};

export const EXPLICACAO_DO_STATUS: Record<StatusDaResposta, string> = {
  rascunho: "Ainda não foi aprovada. Nada usa esta resposta.",
  aprovada: "O dono leu e aprovou este texto. Se alguém mudar uma letra, ela volta a rascunho.",
  arquivada: "Guardada, mas fora de uso. O histórico fica.",
};

export function ramosEmTexto(ramos: readonly RamoDaBase[]): string {
  const tem = (r: RamoDaBase) => ramos.includes(r);
  if (tem("cliente") && tem("parceiro")) return "Cliente final e parceiro";
  if (tem("parceiro")) return "Parceiro";
  return "Cliente final";
}

/** A mais frequente nas conversas primeiro; empate pelo tema, para a ordem nunca mudar sozinha. */
export function ordenarPorFrequencia<T extends Pick<RespostaDaBase, "contagem_ocorrencias" | "tema">>(
  respostas: readonly T[],
): T[] {
  return [...respostas].sort(
    (a, b) => b.contagem_ocorrencias - a.contagem_ocorrencias || a.tema.localeCompare(b.tema),
  );
}

export type FiltroDeStatus = StatusDaResposta | "todas";

export function filtrarPorStatus(
  respostas: readonly RespostaDaBase[],
  filtro: FiltroDeStatus,
): RespostaDaBase[] {
  return ordenarPorFrequencia(
    filtro === "todas" ? respostas : respostas.filter((r) => r.status === filtro),
  );
}

export function contarPorStatus(
  respostas: readonly RespostaDaBase[],
): Record<StatusDaResposta | "todas", number> {
  const c = { rascunho: 0, aprovada: 0, arquivada: 0, todas: respostas.length };
  for (const r of respostas) c[r.status] += 1;
  return c;
}

/** "3 de 15 aprovadas": o total é o das respostas que não foram arquivadas. */
export function contadorDeAprovadas(respostas: readonly RespostaDaBase[]): {
  aprovadas: number;
  total: number;
  texto: string;
} {
  const ativas = respostas.filter((r) => r.status !== "arquivada");
  const aprovadas = ativas.filter((r) => r.status === "aprovada").length;
  return { aprovadas, total: ativas.length, texto: `${aprovadas} de ${ativas.length} aprovadas` };
}

/** A próxima da fila: o rascunho mais frequente que não é a que está aberta agora. */
export function proximaDaFila(
  respostas: readonly RespostaDaBase[],
  idAtual: string | null,
): RespostaDaBase | null {
  const fila = ordenarPorFrequencia(respostas.filter((r) => r.status === "rascunho"));
  if (fila.length === 0) return null;
  if (!idAtual) return fila[0];
  const i = fila.findIndex((r) => r.id === idAtual);
  if (i < 0) return fila[0];
  return fila[i + 1] ?? fila[0] ?? null;
}

/** O que significa cada aviso do validador do banco. Só o código chega, nunca o trecho. */
const EXPLICACAO_DO_AVISO: Record<string, string> = {
  vazio: "O texto está vazio.",
  acima_de_600_caracteres: "O texto passou de 600 letras. Encurte.",
  variavel_sem_preencher: "Sobrou um campo entre chaves. Aqui o texto precisa estar pronto.",
  moeda: "Fala em dinheiro. O agente nunca fala valor.",
  valor_em_reais: "Fala em reais. O agente nunca fala valor.",
  valor_com_centavos: "Tem um número com cara de preço.",
  valor_depois_de_valor: "Fala em valor com número.",
  preco_com_numero: "Tem preço ou valor com número, mesmo escrito por extenso. O agente nunca fala valor.",
  condicao_de_preco: "Fala em condição de preço, como grátis, promoção ou barato.",
  desconto: "Fala em desconto. O agente nunca fala desconto.",
  desconto_disfarcado: "Fala em abatimento ou condição especial, que é desconto disfarçado.",
  porcentagem: "Fala em porcentagem, que é desconto ou juros.",
  pix: "Fala em forma de pagamento. Isso é só com a equipe.",
  boleto: "Fala em forma de pagamento. Isso é só com a equipe.",
  parcelamento: "Fala em parcelamento. Isso é só com a equipe.",
  juros: "Fala em juros. Isso é só com a equipe.",
  pagamento_com_numero: "Fala em pagamento com número, como entrada, sinal ou vezes, mesmo por extenso.",
  forma_de_pagamento: "Fala em forma de pagamento, como à vista, cartão, sinal ou em vezes. Isso é só com a equipe.",
  nota_fiscal: "Fala em nota fiscal. Isso é só com a equipe.",
  prazo_em_numero: "Promete prazo em número. O agente nunca promete prazo.",
  prazo_prometido: "Promete prazo, com horas, dias ou minutos, ou com expressões como amanhã, mesmo dia e esta semana.",
  orcamento_feito_pelo_agente: "Diz que o agente faz ou entrega orçamento. Só a equipe faz.",
  parceiro: "Tem a palavra parceiro, que cliente final não pode ler.",
  parceria: "Tem a palavra parceria, que cliente final não pode ler.",
  terceirizado: "Tem a palavra terceirizado, que cliente final não pode ler.",
  tabela: "Fala em tabela, que pode ser tabela de preços. O agente nunca fala tabela.",
  preco_diferenciado: "Fala em preço diferente para alguns clientes. O agente nunca fala isso.",
  preco_especial: "Fala em preço especial, de custo ou de atacado. O agente nunca fala isso.",
  palavra_que_a_casa_nao_usa: "Tem uma palavra que a Bex Print não usa. Só existem parceiro e cliente final.",
  travessao: "Tem travessão. O estilo da Bex Print não usa.",
  seta: "Tem seta. O estilo da Bex Print não usa.",
  parenteses: "Tem parênteses. O estilo da Bex Print não usa.",
};

export function explicarAviso(codigo: string): string {
  return EXPLICACAO_DO_AVISO[codigo] ?? "Tem um trecho que o agente não pode falar.";
}

/**
 * As frases gatilho de um campo de várias linhas, do jeito que o banco as guarda:
 * normalizadas, sem repetir e sem as que ficam vazias depois de normalizar. Uma
 * linha só com "?" ou com um emoji não é frase: conta como zero.
 */
export function frasesGatilhoDoTexto(texto: string): { cruas: string[]; normalizadas: string[] } {
  const cruas = texto
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  const normalizadas = [...new Set(cruas.map(normalizarPerguntaDaBase).filter(Boolean))];
  return { cruas, normalizadas };
}

/**
 * Como a tela escreve o produto de uma resposta. Produto desativado aparece
 * pelo nome, marcado, em vez de sumir da tela como se a resposta valesse para
 * qualquer produto.
 */
export function rotuloDoProduto(
  produtoId: string | null | undefined,
  produtos: readonly ProdutoDaBase[],
): string {
  if (!produtoId) return "Qualquer produto";
  const p = produtos.find((x) => x.id === produtoId);
  if (!p) return "Produto que não está mais no cadastro";
  return p.ativo ? p.nome : `Produto desativado: ${p.nome}`;
}

/**
 * Os produtos da lista de escolha da edição: os ativos, mais os que a resposta já usa
 * (o da resposta e o que está escolhido agora), mesmo desativados. Sem isso, a lista não
 * teria a opção do produto atual e a tela mostraria "Qualquer produto" por cima de um
 * produto que continua gravado.
 */
export function produtosParaEscolher(
  produtos: readonly ProdutoDaBase[],
  ...manter: (string | null | undefined)[]
): ProdutoDaBase[] {
  const ids = new Set(manter.filter((x): x is string => !!x));
  return produtos.filter((p) => p.ativo || ids.has(p.id));
}

/** O rótulo de cada opção da lista de escolha: o desativado leva o aviso. */
export function rotuloDaOpcaoDeProduto(p: ProdutoDaBase): string {
  return p.ativo ? p.nome : `Produto desativado: ${p.nome}`;
}

/** Erro de quem salvou o rascunho e não conseguiu aprovar: o rascunho existe, a aprovação não passou. */
export class SalvouMasNaoAprovou extends Error {
  readonly causa: unknown;
  constructor(causa: unknown) {
    super(causa instanceof Error ? causa.message : "A aprovação não passou.");
    this.name = "SalvouMasNaoAprovou";
    this.causa = causa;
  }
}

export const TEXTO_SALVOU_MAS_NAO_APROVOU = "O rascunho foi salvo, mas a aprovação não passou";

/**
 * "Editar e aprovar" quando mexeu em frases, ramo ou produto: salva primeiro (a
 * versão sobe) e aprova a versão nova. Se o salvar falha, nada mudou e o erro
 * sai como veio. Se o salvar passa e o aprovar falha, o rascunho JÁ está salvo:
 * o erro sai marcado como `SalvouMasNaoAprovou`, para a tela recarregar o
 * painel e dizer a verdade em vez de mostrar só o motivo da recusa.
 */
export async function salvarDepoisAprovar<A>(
  salvar: () => Promise<{ versao: number | null }>,
  aprovar: (versaoSalva: number) => Promise<A>,
): Promise<A> {
  const salvo = await salvar();
  if (!salvo.versao) throw new Error("O banco não devolveu a versão salva. Recarregue a página e tente de novo.");
  try {
    return await aprovar(salvo.versao);
  } catch (e) {
    throw new SalvouMasNaoAprovou(e);
  }
}

export const ROTULO_DO_EVENTO: Record<EventoDoHistorico, string> = {
  criada: "Criada como rascunho",
  editada: "Texto editado",
  aprovada: "Aprovada",
  voltou_a_rascunho: "Voltou a rascunho",
  editada_e_voltou_a_rascunho: "Editada depois de aprovada e voltou a rascunho",
  arquivada: "Arquivada",
  reaberta: "Reaberta como rascunho",
};

/** Conta letras do texto proposto contra o limite do banco. */
export const LIMITE_DE_LETRAS = 600;

/** A mensagem quando a base ainda não foi criada no banco. */
export const AVISO_BASE_NAO_INSTALADA =
  "A base de respostas ainda não existe no banco. Quem aplica as migrações precisa rodar a da base do agente.";
