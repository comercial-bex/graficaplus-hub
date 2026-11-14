import { respostasDaIa, type ProdutoParaIa } from "@/domain/orcamentos/orcamento-com-ia";
import { verificarSaida } from "@/domain/whatsapp/assistente";
import type { RegraDoBanco } from "@/domain/whatsapp/triagem/verificador";

/**
 * O atendente que conversa com o cliente e monta o orçamento (02/11/2026), em regras puras.
 *
 * Por enquanto só existe em ENSAIO: a tela responde para quem está testando e nada sai pelo WhatsApp. A assistente de
 * verdade (`assistente.ts`) continua como está, atrás de `whatsapp_configuracoes.ia_ativa`.
 *
 * A trava que manda em tudo (C1, 14/11/2026): o atendente NUNCA fala preço, prazo nem data, e não monta orçamento. Ele
 * entende o que o contato precisa e registra o que já se sabe do pedido; quando o pedido está completo, passa para a
 * equipe, que orça. Antes, este arquivo calculava o valor da tabela e o somava ao texto (11 de 31 respostas do ensaio
 * saíram com valor); essa conta saiu, e a tabela de preços nem é mais lida aqui. O texto passa pelo verificador único
 * (`triagem/verificador.ts`, ramo cliente final) antes de sair; reprovado, vira transferência com o nome da regra.
 */

export type TipoDaMensagem = "texto" | "imagem" | "documento" | "audio" | "video" | "outro";
export type FalaDaConversa = { de: "cliente" | "grafica"; texto: string };

export const FERRAMENTA_DO_ATENDENTE = {
  type: "function",
  function: {
    name: "atender_cliente",
    description: "Responde ao cliente e registra o que já se sabe do pedido.",
    parameters: {
      type: "object",
      properties: {
        resposta: { type: "string", description: "O texto para o cliente, sem valor, preço, prazo nem data." },
        acao: { type: "string", enum: ["responder", "transferir"] },
        motivo_transferencia: { type: "string", description: "Por que a equipe precisa assumir." },
        confianca: { type: "number", minimum: 0, maximum: 1 },
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
      required: ["resposta", "acao", "confianca", "itens", "sem_produto"],
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
  "Escreva sem travessão, sem setas e sem parênteses.",
  "Seu objetivo é entender o que o cliente precisa e dar uma expectativa do que a Bex Print faz, falando dos produtos. Quem passa preço, prazo e orçamento é sempre a equipe.",
  "NUNCA escreva valor, preço, orçamento fechado, prazo, data, dia da semana de entrega, validade, garantia, desconto, promoção ou forma de pagamento, nem número que pareça isso. Se o cliente perguntar, diga só que a equipe confirma isso com tudo certinho para o pedido, e siga com a pergunta de que você precisa.",
  "NUNCA pergunte se a pessoa é parceira, cliente final ou de qualquer outro tipo, e nunca fale de tabela, desconto ou preço.",
  "Quando produto, medida, quantidade e as perguntas 'perguntar' de cada item estiverem resolvidos, use acao='transferir' com o motivo 'pedido completo para a equipe'. Não monte orçamento.",
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
    itens,
    sem_produto: [...textos(a.sem_produto), ...fora.map((x) => `Item fora da lista: ${x}`)],
  };
}

/**
 * O texto pode sair? Nulo = pode. Passa pelo verificador único, ramo cliente final, com os termos extras da tabela;
 * o motivo leva o nome das regras, nunca o trecho.
 */
export function motivoParaBarrarAtendente(texto: string, extras: readonly RegraDoBanco[] = []): string | null {
  if (!texto.trim()) return "a IA não escreveu resposta";
  const regras = verificarSaida(texto, extras);
  return regras.length > 0 ? `texto reprovado pelo verificador: ${regras.join(", ")}` : null;
}

export type DecisaoDoAtendente = {
  acao: "responder" | "transferir";
  texto: string;
  motivo: string | null;
};

export const FRASE_DE_PASSAGEM = "Vou chamar alguém da equipe para continuar com você.";
const FRASE_DO_AUDIO = "Ainda não consigo ouvir áudio por aqui. Pode escrever? Se preferir, chamo alguém da equipe.";
const FRASE_DO_ARQUIVO = "Recebi o arquivo, e a equipe confere a arte antes de produzir.";

/** A decisão final, com as travas por cima do que a IA quis. Nunca leva valor, prazo ou data. */
export function decidirAtendente(
  l: LeituraDoAtendente,
  tipo: TipoDaMensagem = "texto",
  extras: readonly RegraDoBanco[] = [],
): DecisaoDoAtendente {
  const transferir = (motivo: string): DecisaoDoAtendente => ({ acao: "transferir", texto: FRASE_DE_PASSAGEM, motivo });
  if (l.acao === "transferir") return transferir(l.motivo_transferencia ?? "a IA pediu ajuda da equipe");
  if (l.confianca < 0.6) return transferir(`confiança baixa (${Math.round(l.confianca * 100)}%)`);
  if (l.sem_produto.length > 0) return transferir(`fora do catálogo: ${l.sem_produto.join(", ")}`);
  const inicio = tipo === "imagem" || tipo === "documento" ? `${FRASE_DO_ARQUIVO} ` : "";
  const texto = `${inicio}${l.resposta}`;
  const barrar = motivoParaBarrarAtendente(texto, extras);
  if (barrar) return transferir(barrar);
  return { acao: "responder", texto, motivo: null };
}

/** Áudio não passa pela IA: sem transcrição, ela responderia sem saber o que foi dito. */
export function decisaoDoAudio(): DecisaoDoAtendente {
  return { acao: "responder", texto: FRASE_DO_AUDIO, motivo: null };
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
