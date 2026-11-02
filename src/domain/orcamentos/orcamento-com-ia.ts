import { faixaAplicada, type FaixaPreco } from "@/domain/orcamentos/faixas";
import {
  acabamentoCobravel,
  ladosSugeridos,
  quantidadeDoAcabamento,
} from "@/domain/orcamentos/cobranca-do-acabamento";

/**
 * O orçamento com IA (01/11/2026): a pessoa cola o pedido do cliente e a IA
 * monta o rascunho, lendo o roteiro da pasta de cada produto.
 *
 * A IA só diz QUAL produto, QUANTO e QUE MEDIDA, e o que ainda falta perguntar.
 * Preço nunca vem dela: o item entra com o preço de tabela e o banco faz a conta.
 * O produto vem de uma lista fechada, e o que ela responder fora da lista é
 * descartado aqui: inventar produto é o defeito que este arquivo existe para barrar.
 */

export type ProdutoParaIa = {
  id: string;
  nome: string;
  unidade: string | null;
  tipo: string | null;
  personalidade: string | null;
  como_medir: string | null;
  perguntas: string | null;
  /** Os acabamentos que o produto aceita (`produto_acabamentos`). */
  acabamentos?: string[];
};

export type ItemDaIa = {
  produto_id: string;
  nome: string;
  unidade: string | null;
  quantidade: number;
  largura_m: number | null;
  altura_m: number | null;
  observacao: string | null;
  acabamentos: string[];
};

export type LeituraDoPedido = {
  titulo: string;
  itens: ItemDaIa[];
  perguntas_que_faltam: string[];
  sem_produto: string[];
};

export const FERRAMENTA_DO_ORCAMENTO = {
  type: "function",
  function: {
    name: "montar_orcamento",
    description:
      "Registra o que o cliente pediu, com os produtos da lista e o que ainda falta perguntar.",
    parameters: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "Título curto do orçamento, em até 6 palavras." },
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              produto_id: { type: "string", description: "O id, exatamente como está na lista." },
              quantidade: { type: "number" },
              largura_m: {
                type: ["number", "null"],
                description: "Em metros. Null se o cliente não disse.",
              },
              altura_m: {
                type: ["number", "null"],
                description: "Em metros. Null se o cliente não disse.",
              },
              acabamentos: {
                type: "array",
                items: { type: "string" },
                description: "Só os que o cliente pediu, com o nome exato da lista de acabamentos do produto.",
              },
              observacao: {
                type: ["string", "null"],
                description: "Acabamento, cor ou detalhe que o cliente disse.",
              },
            },
            required: ["produto_id", "quantidade", "largura_m", "altura_m", "observacao", "acabamentos"],
          },
        },
        perguntas_que_faltam: {
          type: "array",
          items: { type: "string" },
          description: "Perguntas do roteiro de cada produto que o pedido ainda não responde.",
        },
        sem_produto: {
          type: "array",
          items: { type: "string" },
          description: "O que o cliente pediu e não está na lista de produtos.",
        },
      },
      required: ["titulo", "itens", "perguntas_que_faltam", "sem_produto"],
    },
  },
} as const;

export function montarPerguntaDoOrcamento(pedido: string, produtos: ProdutoParaIa[]) {
  const lista = produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    unidade: p.unidade,
    o_que_e: p.personalidade,
    como_medir: p.como_medir,
    perguntar: p.perguntas,
    acabamentos: p.acabamentos ?? [],
  }));
  return [
    {
      role: "system" as const,
      content: [
        "Você ajuda a equipe da Bex Print, gráfica e comunicação visual em Macapá (AP), a montar orçamentos.",
        "Leia o pedido do cliente e escolha os produtos SOMENTE da lista. Nunca invente produto, preço, prazo ou desconto.",
        "Converta as medidas para metros (80 cm = 0,8). Não chute medida nem quantidade: medida que o cliente não disse fica null.",
        "Quando o pedido não diz a quantidade, use 1 e inclua a pergunta em perguntas_que_faltam.",
        "Use o roteiro de cada produto escolhido para listar o que ainda falta perguntar. Não repita o que o pedido já respondeu.",
        "Marque acabamento só quando o cliente pediu, com o nome exato da lista do produto (ilhós e bainha = Bainha + ilhós). Se o produto aceita acabamento e o cliente não falou, inclua a pergunta em perguntas_que_faltam.",
        "O que não existir na lista vai em sem_produto.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `LISTA DE PRODUTOS:\n${JSON.stringify(lista)}\n\nPEDIDO DO CLIENTE:\n${pedido}`,
    },
  ];
}

const numeroPositivo = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const textos = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : [];

/** Confere a resposta da IA: produto fora da lista não entra, e o que não entrou é dito. */
export function interpretarLeitura(
  argumentos: unknown,
  produtos: ProdutoParaIa[],
): LeituraDoPedido | null {
  let a: Record<string, unknown>;
  try {
    a = (typeof argumentos === "string" ? JSON.parse(argumentos) : argumentos) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  if (!a || typeof a !== "object" || !Array.isArray(a.itens)) return null;
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const itens: ItemDaIa[] = [];
  const foraDaLista: string[] = [];
  for (const bruto of a.itens as Record<string, unknown>[]) {
    const p = porId.get(String(bruto?.produto_id ?? ""));
    if (!p) {
      foraDaLista.push(String(bruto?.produto_id ?? "item sem produto"));
      continue;
    }
    itens.push({
      produto_id: p.id,
      nome: p.nome,
      unidade: p.unidade,
      quantidade: numeroPositivo(bruto.quantidade) ?? 1,
      largura_m: numeroPositivo(bruto.largura_m),
      altura_m: numeroPositivo(bruto.altura_m),
      observacao:
        typeof bruto.observacao === "string" && bruto.observacao.trim()
          ? bruto.observacao.trim()
          : null,
      acabamentos: textos(bruto.acabamentos).filter((x) => (p.acabamentos ?? []).includes(x)),
    });
  }
  return {
    titulo:
      typeof a.titulo === "string" && a.titulo.trim()
        ? a.titulo.trim().slice(0, 80)
        : "Pedido lido pela IA",
    itens,
    perguntas_que_faltam: textos(a.perguntas_que_faltam),
    sem_produto: [
      ...textos(a.sem_produto),
      ...foraDaLista.map((x) => `Item que a IA não achou na lista: ${x}`),
    ],
  };
}

const UNIDADES_DE_AREA = ["m2", "m²"];

export type ServicoDoAcabamento = {
  acabamento: string;
  id: string;
  nome: string;
  unidade: string | null;
  preco: number | null;
};

/**
 * As linhas de acabamento que o pedido já traz: bainha e ilhós viram linha com o
 * contorno certo, como na tela. Sem medida não dá para calcular, e isso vira pergunta.
 */
export function linhasDoAcabamento(i: ItemDaIa, servicos: ServicoDoAcabamento[]) {
  const linhas: {
    produto_id: string;
    descricao: string;
    unidade: string | null;
    quantidade: number;
    valor_unitario: number;
    origem_calculo: string;
  }[] = [];
  const pendentes: string[] = [];
  for (const nome of i.acabamentos) {
    const regra = acabamentoCobravel(nome);
    const servico = servicos.find((s) => s.acabamento === nome);
    if (!regra || !servico) {
      pendentes.push(`${nome}: cobrar à mão, não há serviço ligado.`);
      continue;
    }
    const quantidade = quantidadeDoAcabamento(
      regra.medida,
      { largura: i.largura_m ?? 0, altura: i.altura_m ?? 0, quantidade: i.quantidade },
      ladosSugeridos(i.nome),
    );
    if (quantidade <= 0) {
      pendentes.push(`${nome} em ${i.nome}: falta a medida para calcular.`);
      continue;
    }
    linhas.push({
      produto_id: servico.id,
      descricao: servico.nome,
      unidade: servico.unidade,
      quantidade,
      valor_unitario: servico.preco ?? 0,
      origem_calculo: "ia",
    });
  }
  return { linhas, pendentes };
}

/** Produto vendido por m² sem medida fica sem preço: é pergunta, não é zero escondido. */
export function itemSemMedida(i: Pick<ItemDaIa, "unidade" | "largura_m" | "altura_m">): boolean {
  return UNIDADES_DE_AREA.includes((i.unidade ?? "").toLowerCase()) && !(i.largura_m && i.altura_m);
}

/**
 * O preço de tabela para esta quantidade: 200 chaveiros não custam o preço de 1.
 * A faixa é a mesma regra da tela do orçamento (`faixaAplicada`).
 */
export function precoDeTabela(i: Pick<ItemDaIa, "unidade" | "quantidade">, precoBase: number | null, faixas: FaixaPreco[]): number | null {
  const faixa = faixaAplicada(faixas, i.quantidade);
  if (!faixa) return precoBase;
  const area = UNIDADES_DE_AREA.includes((i.unidade ?? "").toLowerCase());
  return area ? (faixa.preco_m2_referencia ?? precoBase) : faixa.preco_unitario;
}

/**
 * O texto do acabamento do item. A IA às vezes repete na observação o que já marcou
 * ("Bainha + ilhós" e "Bainha e ilhós"): a repetição não entra.
 */
export function textoDoAcabamento(i: Pick<ItemDaIa, "acabamentos" | "observacao">): string | null {
  const palavras = (t: string) =>
    t
      .toLowerCase()
      .split(/[^a-zà-ú0-9]+/)
      .filter((p) => p.length >= 3);
  const marcadas = new Set(i.acabamentos.flatMap(palavras));
  const repetida = !!i.observacao && palavras(i.observacao).every((p) => marcadas.has(p));
  return [...i.acabamentos, ...(i.observacao && !repetida ? [i.observacao] : [])].join(", ") || null;
}

/** A linha que vai para `orcamento_itens`: quem calcula o total é o gatilho do banco. */
export function linhaDoItem(i: ItemDaIa, precoBase: number | null, ordem: number) {
  const area = UNIDADES_DE_AREA.includes((i.unidade ?? "").toLowerCase());
  return {
    produto_id: i.produto_id,
    descricao: i.nome,
    unidade: i.unidade,
    quantidade: i.quantidade,
    ordem,
    largura: i.largura_m,
    altura: i.altura_m,
    preco_m2: area && i.largura_m && i.altura_m ? precoBase : null,
    valor_unitario: area ? 0 : (precoBase ?? 0),
    acabamento: textoDoAcabamento(i),
    origem_calculo: "ia",
  };
}

/** A observação interna do rascunho: o que a pessoa ainda precisa perguntar ao cliente. */
export function observacaoDoRascunho(l: LeituraDoPedido, pedido: string): string {
  const partes = [`Pedido do cliente:\n${pedido.trim()}`];
  if (l.perguntas_que_faltam.length > 0) {
    partes.push(`Falta perguntar:\n${l.perguntas_que_faltam.map((p) => `- ${p}`).join("\n")}`);
  }
  if (l.sem_produto.length > 0)
    partes.push(`Sem produto no catálogo:\n${l.sem_produto.map((p) => `- ${p}`).join("\n")}`);
  return partes.join("\n\n");
}
