import { faixaAplicada, type FaixaPreco } from "@/domain/orcamentos/faixas";
import {
  cobrancasDasRespostas,
  type ProcessoDaResposta,
  type ServicoDaResposta,
} from "@/domain/orcamentos/cobranca-das-respostas";
import { respostasDaIa, type ProdutoParaIa } from "@/domain/orcamentos/orcamento-com-ia";

/**
 * O atendente que conversa com o cliente e monta o orçamento (02/11/2026), em regras puras.
 *
 * Por enquanto só existe em ENSAIO: a tela responde para quem está testando e nada sai pelo WhatsApp. A assistente de
 * verdade (`assistente.ts`) continua como está, atrás de `whatsapp_configuracoes.ia_ativa`.
 *
 * A trava que manda em tudo: a IA nunca escreve valor. Ela conversa e diz o que entendeu; o valor é calculado aqui,
 * da tabela, e acrescentado ao texto. Valor, data, Pix ou desconto escritos por ela viram transferência para a equipe.
 */

export type TipoDaMensagem = "texto" | "imagem" | "documento" | "audio" | "video" | "outro";
export type FalaDaConversa = { de: "cliente" | "grafica"; texto: string };

export type TabelaDoAtendente = {
  precos: Map<string, { preco_base: number | null; area_minima: number | null; faixas: FaixaPreco[] }>;
  processos: ProcessoDaResposta[];
  servicos: ServicoDaResposta[];
  /** O serviço que cobra cada acabamento, pelo nome do acabamento. */
  acabamentos: Map<string, { id: string; nome: string; medida: "perimetro" | "area" | "peca"; preco: number | null }>;
};

export const FERRAMENTA_DO_ATENDENTE = {
  type: "function",
  function: {
    name: "atender_cliente",
    description: "Responde ao cliente e registra o que já se sabe do pedido.",
    parameters: {
      type: "object",
      properties: {
        resposta: { type: "string", description: "O texto para o cliente, sem nenhum valor em reais." },
        acao: { type: "string", enum: ["responder", "transferir"] },
        motivo_transferencia: { type: "string", description: "Por que a equipe precisa assumir." },
        confianca: { type: "number", minimum: 0, maximum: 1 },
        orcamento_pronto: {
          type: "boolean",
          description: "true só quando produto, medida, quantidade e as perguntas do checklist estão resolvidos.",
        },
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              produto_id: { type: "string", description: "O id, exatamente como está na lista." },
              quantidade: { type: "number" },
              largura_m: { type: ["number", "null"] },
              altura_m: { type: ["number", "null"] },
              acabamentos: { type: "array", items: { type: "string" } },
              respostas: {
                type: "array",
                items: {
                  type: "object",
                  properties: { pergunta_id: { type: "string" }, resposta: { type: "string" } },
                  required: ["pergunta_id", "resposta"],
                },
              },
            },
            required: ["produto_id", "quantidade", "largura_m", "altura_m", "acabamentos", "respostas"],
          },
        },
        sem_produto: { type: "array", items: { type: "string" }, description: "O que o cliente pediu e não está na lista." },
      },
      required: ["resposta", "acao", "confianca", "orcamento_pronto", "itens", "sem_produto"],
    },
  },
} as const;

const INSTRUCOES = [
  "Você é a assistente da Bex Print, gráfica e comunicação visual em Macapá (AP), atendendo pelo WhatsApp.",
  "Na primeira resposta da conversa, diga que é a assistente e que a pessoa pode pedir para falar com alguém da equipe.",
  "Escreva em português do Brasil, curto, cordial e sem gíria. Faça uma ou duas perguntas por vez. Nunca repita o que o cliente já respondeu.",
  "Escolha produtos SOMENTE da lista, e use o nome que está lá. O cliente pode usar um nome de tambem_conhecido_como: é o mesmo produto. Nunca invente produto.",
  "Se o cliente não sabe a medida, sugira os tamanhos da lista dizendo para que serve cada um. Só preencha largura_m e altura_m com o que ele disse ou confirmou, em metros (80 cm = 0,8).",
  "Se o pedido passa do que a máquina faz, segundo o roteiro do produto, avise antes e ofereça a alternativa.",
  "Cada pergunta do checklist diz como tratá-la em 'como'. 'perguntar': se a conversa não respondeu, pergunte, seguindo a instrucao; registre a resposta em respostas, com o texto exato de uma das opcoes. 'seguir_cliente': registre só se o cliente falou disso, sem perguntar. O que está em ja_definido nunca se pergunta nem se menciona.",
  "NUNCA escreva valor, preço, prazo, data, desconto ou forma de pagamento: o sistema acrescenta o valor quando o orçamento fica pronto. Se o cliente perguntar o preço antes, diga que falta só o que você está perguntando.",
  "Marque orcamento_pronto=true quando produto, medida, quantidade e as perguntas 'perguntar' de cada item estiverem resolvidos. Nesse caso, escreva só uma frase curta confirmando o pedido; o valor entra depois dela.",
  "Mantenha em itens tudo o que já se sabe do pedido, a cada resposta, mesmo incompleto.",
  "Use acao='transferir' quando: o cliente pede uma pessoa; reclama ou está irritado; fala de desconto, pagamento ou nota; pede algo fora da lista; o produto pede visita técnica; ou você não tem certeza.",
  "confianca: de 0 a 1, o quanto você tem certeza de que a resposta está certa com o que foi dado.",
].join("\n");

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// "copos térmicos" é o mesmo que "copo térmico": sem isso o roteiro do produto não ia para a IA, e ela não avisava
// que logo colorido não sai colorido (achado no ensaio de 02/11/2026).
const noSingular = (p: string) => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p);
const palavras = (t: string) =>
  semAcento(t)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3)
    .map(noSingular);

/**
 * Só os produtos de que a conversa fala vão com o roteiro inteiro; os outros vão só com o nome. É o que deixa a IA
 * ver o catálogo todo sem mandar 57 roteiros a cada mensagem.
 */
export function produtosDaConversa(conversa: string, produtos: ProdutoParaIa[], limite = 6): ProdutoParaIa[] {
  const faladas = new Set(palavras(conversa));
  return produtos
    .map((p) => ({
      p,
      pontos: palavras([p.nome, ...(p.apelidos ?? [])].join(" ")).filter((x) => faladas.has(x)).length,
    }))
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.p.nome.localeCompare(b.p.nome))
    .slice(0, limite)
    .map((x) => x.p);
}

export function montarPerguntaDoAtendente(
  historico: FalaDaConversa[],
  mensagem: string,
  produtos: ProdutoParaIa[],
) {
  const conversa = [...historico.map((h) => h.texto), mensagem].join(" ");
  const emFoco = new Set(produtosDaConversa(conversa, produtos).map((p) => p.id));
  const lista = produtos.map((p) =>
    emFoco.has(p.id)
      ? {
          id: p.id,
          nome: p.nome,
          unidade: p.unidade,
          o_que_e: p.personalidade,
          como_medir: p.como_medir,
          perguntar: p.perguntas,
          acabamentos: p.acabamentos ?? [],
          tambem_conhecido_como: p.apelidos ?? [],
          tamanhos: p.tamanhos ?? [],
          ja_definido: p.ja_definido ?? [],
          checklist: (p.checklist ?? [])
            .filter((q) => !(p.ja_definido ?? []).some((d) => d.pergunta === q.pergunta))
            .map((q) => ({
              id: q.id,
              pergunta: q.pergunta,
              opcoes: q.respostas,
              como: q.ia_modo ?? "perguntar",
              instrucao: q.ia_instrucao ?? null,
            })),
        }
      : { id: p.id, nome: p.nome, tambem_conhecido_como: p.apelidos ?? [] },
  );
  const fala = historico.map((h) => `${h.de === "cliente" ? "Cliente" : "Bex Print"}: ${h.texto}`).join("\n");
  return [
    { role: "system" as const, content: INSTRUCOES },
    {
      role: "user" as const,
      content: [
        `LISTA DE PRODUTOS:\n${JSON.stringify(lista)}`,
        `CONVERSA ATÉ AGORA:\n${fala || "(nenhuma)"}`,
        `MENSAGEM NOVA DO CLIENTE:\n${mensagem}`,
      ].join("\n\n"),
    },
  ];
}

export type ItemDoAtendente = {
  produto_id: string;
  nome: string;
  unidade: string | null;
  quantidade: number;
  largura_m: number | null;
  altura_m: number | null;
  acabamentos: string[];
  respostas: ReturnType<typeof respostasDaIa>;
};

export type LeituraDoAtendente = {
  resposta: string;
  acao: "responder" | "transferir";
  motivo_transferencia: string | null;
  confianca: number;
  orcamento_pronto: boolean;
  itens: ItemDoAtendente[];
  sem_produto: string[];
};

const positivo = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const textos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];

/** Confere o que a IA devolveu: produto fora da lista não entra e vira "sem produto". */
export function interpretarAtendente(argumentos: unknown, produtos: ProdutoParaIa[]): LeituraDoAtendente | null {
  let a: Record<string, unknown>;
  try {
    a = (typeof argumentos === "string" ? JSON.parse(argumentos) : argumentos) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!a || typeof a !== "object" || typeof a.resposta !== "string") return null;
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const itens: ItemDoAtendente[] = [];
  const fora: string[] = [];
  for (const bruto of (Array.isArray(a.itens) ? a.itens : []) as Record<string, unknown>[]) {
    const p = porId.get(String(bruto?.produto_id ?? ""));
    if (!p) {
      fora.push(String(bruto?.produto_id ?? "item sem produto"));
      continue;
    }
    itens.push({
      produto_id: p.id,
      nome: p.nome,
      unidade: p.unidade,
      quantidade: positivo(bruto.quantidade) ?? 1,
      largura_m: positivo(bruto.largura_m),
      altura_m: positivo(bruto.altura_m),
      acabamentos: textos(bruto.acabamentos).filter((x) => (p.acabamentos ?? []).includes(x)),
      respostas: respostasDaIa(p, bruto.respostas),
    });
  }
  const confianca = Number(a.confianca);
  return {
    resposta: a.resposta.trim(),
    acao: a.acao === "transferir" ? "transferir" : "responder",
    motivo_transferencia: typeof a.motivo_transferencia === "string" && a.motivo_transferencia.trim() ? a.motivo_transferencia.trim() : null,
    confianca: Number.isFinite(confianca) ? confianca : 0,
    orcamento_pronto: a.orcamento_pronto === true,
    itens,
    sem_produto: [...textos(a.sem_produto), ...fora.map((x) => `Item fora da lista: ${x}`)],
  };
}

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ehArea = (u: string | null) => ["m2", "m²"].includes((u ?? "").trim().toLowerCase());

export type LinhaDaPrevia = { descricao: string; quantidade: number; unidade: string; total: number };
export type PreviaDoOrcamento = { linhas: LinhaDaPrevia[]; total: number; pendencias: string[] };

/**
 * O valor do orçamento, com as mesmas contas do banco: área exata da peça com a mínima do produto, faixa por
 * quantidade e linha sem medida cobrando no mínimo 1. O que não dá para calcular vira pendência, nunca zero.
 */
export function previaDoOrcamento(itens: ItemDoAtendente[], produtos: ProdutoParaIa[], t: TabelaDoAtendente): PreviaDoOrcamento {
  const linhas: LinhaDaPrevia[] = [];
  const pendencias: string[] = [];
  const noOrcamento: { id: string; produto_id: string; gerado_por_item_id: string | null }[] = [];
  for (const [n, i] of itens.entries()) {
    const preco = t.precos.get(i.produto_id);
    const faixa = faixaAplicada(preco?.faixas ?? [], i.quantidade);
    const area = ehArea(i.unidade);
    const unitario = faixa ? (area ? (faixa.preco_m2_referencia ?? preco?.preco_base ?? null) : faixa.preco_unitario) : (preco?.preco_base ?? null);
    if (unitario == null) {
      pendencias.push(`${i.nome}: sem preço de tabela para ${i.quantidade} ${i.unidade ?? "un"}`);
      continue;
    }
    if (area && !(i.largura_m && i.altura_m)) {
      pendencias.push(`${i.nome}: falta a medida`);
      continue;
    }
    const itemId = `item-${n}`;
    noOrcamento.push({ id: itemId, produto_id: i.produto_id, gerado_por_item_id: null });
    if (area) {
      const peca = Math.max(Math.round(i.largura_m! * i.altura_m! * 1e6) / 1e6, preco?.area_minima ?? 0);
      linhas.push({
        descricao: `${i.nome} (${i.largura_m!.toLocaleString("pt-BR")} × ${i.altura_m!.toLocaleString("pt-BR")} m)`,
        quantidade: i.quantidade,
        unidade: "peça",
        total: centavos(peca * i.quantidade * unitario),
      });
    } else {
      linhas.push({ descricao: i.nome, quantidade: i.quantidade, unidade: i.unidade ?? "un", total: centavos(Math.max(i.quantidade, 1) * unitario) });
    }
    const peca = { largura: i.largura_m ?? 0, altura: i.altura_m ?? 0, quantidade: i.quantidade };
    const produto = produtos.find((p) => p.id === i.produto_id);
    for (const c of cobrancasDasRespostas({
      perguntas: produto?.checklist ?? [],
      respostas: i.respostas,
      processos: t.processos,
      servicos: t.servicos,
      peca,
      informadas: {},
      linhasDoOrcamento: noOrcamento,
      itemAtualId: itemId,
    })) {
      if (c.estado === "falta_quantidade") pendencias.push(`${c.nome}: quem atende informa a quantidade`);
      if (c.estado === "falta_medida") pendencias.push(`${c.nome}: falta a medida da peça`);
      if (c.estado !== "cobra" || !c.servico) continue;
      noOrcamento.push({ id: `${itemId}-${c.processo_id}`, produto_id: c.servico.id, gerado_por_item_id: itemId });
      linhas.push({ descricao: c.nome, quantidade: c.quantidade, unidade: c.servico.unidade, total: c.total });
    }
    for (const nome of i.acabamentos) {
      const a = t.acabamentos.get(nome);
      if (!a || a.preco == null) {
        pendencias.push(`${nome}: acabamento sem preço`);
        continue;
      }
      if (noOrcamento.some((l) => l.produto_id === a.id && l.gerado_por_item_id === itemId)) continue;
      const contorno = 2 * ((i.largura_m ?? 0) + (i.altura_m ?? 0)) * i.quantidade;
      const q = a.medida === "peca" ? i.quantidade : a.medida === "area" ? (i.largura_m ?? 0) * (i.altura_m ?? 0) * i.quantidade : contorno;
      if (!(q > 0)) {
        pendencias.push(`${nome}: falta a medida`);
        continue;
      }
      // Bainha em só dois lados muda o contorno: quem atende confere antes de enviar.
      linhas.push({ descricao: nome, quantidade: Math.round(q * 100) / 100, unidade: a.medida === "peca" ? "un" : a.medida === "area" ? "m²" : "m", total: centavos(Math.max(q, a.medida === "area" ? 0 : 1) * a.preco) });
    }
  }
  return { linhas, total: centavos(linhas.reduce((s, l) => s + l.total, 0)), pendencias };
}

// Espaço comum no lugar do que o formatador põe: o texto vai para o WhatsApp.
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

/** O valor como vai ao cliente: vem da tabela, nunca da IA. */
export function textoDoValor(p: PreviaDoOrcamento): string {
  const itens = p.linhas.map((l) => {
    const q = l.quantidade.toLocaleString("pt-BR");
    return `• ${l.unidade === "peça" ? `${q} × ` : `${q} ${l.unidade} de `}${l.descricao}: ${reais(l.total)}`;
  });
  return [...itens, `*Total: ${reais(p.total)}*`].join("\n");
}

const PROIBIDAS = /\b(desconto|pix|boleto|parcel\w*|cart[aã]o|juros|nota fiscal|prazo de \d+|em \d+ dias?)\b/i;

/** O texto da IA pode sair? Nulo = pode. Valor e data ela não escreve nunca: isso vem do sistema. */
export function motivoParaBarrarAtendente(texto: string): string | null {
  if (!texto.trim()) return "a IA não escreveu resposta";
  if (/R\$\s*\d|\b\d+[.,]\d{2}\s*reais\b|\b\d+\s*reais\b/i.test(texto)) return "a IA escreveu um valor por conta própria";
  if (/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(texto)) return "a IA escreveu uma data por conta própria";
  if (PROIBIDAS.test(texto)) return "a resposta tocava em pagamento, desconto ou prazo";
  return null;
}

export type DecisaoDoAtendente = {
  acao: "responder" | "transferir";
  texto: string;
  motivo: string | null;
  previa: PreviaDoOrcamento | null;
};

export const FRASE_DE_PASSAGEM = "Vou chamar alguém da equipe para continuar com você.";
const FRASE_DO_AUDIO = "Ainda não consigo ouvir áudio por aqui. Pode escrever? Se preferir, chamo alguém da equipe.";
const FRASE_DO_ARQUIVO = "Recebi o arquivo, e a equipe confere a arte antes de produzir.";

/** A decisão final, com as travas por cima do que a IA quis. */
export function decidirAtendente(
  l: LeituraDoAtendente,
  produtos: ProdutoParaIa[],
  tabela: TabelaDoAtendente,
  tipo: TipoDaMensagem = "texto",
): DecisaoDoAtendente {
  const transferir = (motivo: string, previa: PreviaDoOrcamento | null = null): DecisaoDoAtendente => ({
    acao: "transferir",
    texto: FRASE_DE_PASSAGEM,
    motivo,
    previa,
  });
  if (l.acao === "transferir") return transferir(l.motivo_transferencia ?? "a IA pediu ajuda da equipe");
  if (l.confianca < 0.6) return transferir(`confiança baixa (${Math.round(l.confianca * 100)}%)`);
  const barrar = motivoParaBarrarAtendente(l.resposta);
  if (barrar) return transferir(barrar);
  if (l.sem_produto.length > 0) return transferir(`fora do catálogo: ${l.sem_produto.join(", ")}`);
  const previa = l.itens.length > 0 ? previaDoOrcamento(l.itens, produtos, tabela) : null;
  const inicio = tipo === "imagem" || tipo === "documento" ? `${FRASE_DO_ARQUIVO} ` : "";
  if (!l.orcamento_pronto) return { acao: "responder", texto: `${inicio}${l.resposta}`, motivo: null, previa };
  if (!previa || previa.linhas.length === 0 || previa.pendencias.length > 0) {
    return transferir(`orçamento sem valor fechado: ${(previa?.pendencias ?? ["nenhum item"]).join("; ")}`, previa);
  }
  return { acao: "responder", texto: `${inicio}${l.resposta}\n\n${textoDoValor(previa)}`, motivo: null, previa };
}

/** Áudio não passa pela IA: sem transcrição, ela responderia sem saber o que foi dito. */
export function decisaoDoAudio(): DecisaoDoAtendente {
  return { acao: "responder", texto: FRASE_DO_AUDIO, motivo: null, previa: null };
}

/** Telefone, e-mail e documento não saem para a IA: na réplica, o texto vai sem eles. */
export function mascararDados(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\b\d{2,3}\.?\d{3}\.?\d{3}[/-]?\d{0,4}-?\d{2}\b/g, "[documento]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[telefone]");
}

/** Mensagem que não é texto vira um marcador na conversa, como a IA a recebe. */
export function falaDaMensagem(m: { tipo: string | null; texto: string | null; legenda: string | null }): string {
  const texto = (m.texto ?? m.legenda ?? "").trim();
  if (texto) return mascararDados(texto).slice(0, 800);
  return `[${m.tipo ?? "mensagem"} enviada]`;
}

export function tipoDaMensagem(tipo: string | null | undefined): TipoDaMensagem {
  return (["texto", "imagem", "documento", "audio", "video"] as const).find((t) => t === tipo) ?? "outro";
}

/**
 * Os turnos da réplica: cada mensagem do cliente, com a conversa como ela estava até ali e a resposta que a equipe
 * deu de verdade, para comparar. Mensagens seguidas do cliente contam como um turno só.
 */
export function turnosDaConversa(
  mensagens: { direcao: string; tipo: string | null; texto: string | null; legenda: string | null }[],
  limite = 8,
): { historico: FalaDaConversa[]; mensagem: string; tipo: TipoDaMensagem; respostaDaEquipe: string | null }[] {
  const turnos: { historico: FalaDaConversa[]; mensagem: string; tipo: TipoDaMensagem; respostaDaEquipe: string | null }[] = [];
  const historico: FalaDaConversa[] = [];
  let i = 0;
  while (i < mensagens.length && turnos.length < limite) {
    const m = mensagens[i];
    if (m.direcao !== "entrada") {
      historico.push({ de: "grafica", texto: falaDaMensagem(m) });
      i++;
      continue;
    }
    const doCliente: string[] = [];
    let tipo: TipoDaMensagem = tipoDaMensagem(m.tipo);
    while (i < mensagens.length && mensagens[i].direcao === "entrada") {
      doCliente.push(falaDaMensagem(mensagens[i]));
      tipo = tipoDaMensagem(mensagens[i].tipo);
      i++;
    }
    const respostas: string[] = [];
    let j = i;
    while (j < mensagens.length && mensagens[j].direcao !== "entrada") {
      respostas.push(falaDaMensagem(mensagens[j]));
      j++;
    }
    const mensagem = doCliente.join("\n");
    turnos.push({ historico: [...historico], mensagem, tipo, respostaDaEquipe: respostas.join("\n") || null });
    historico.push({ de: "cliente", texto: mensagem });
  }
  return turnos;
}
