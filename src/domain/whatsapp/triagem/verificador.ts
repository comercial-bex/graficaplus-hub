import { semAcento } from "./normalizar";
import type { Ramo } from "./tipos";

/**
 * Verificador de texto proibido: a última porta antes de qualquer mensagem sair.
 *
 * Regra do dono: cliente final nunca lê a palavra parceiro, revendedor, tabela
 * nem preço diferenciado, e a triagem nunca fala valor, desconto, prazo ou forma
 * de pagamento. Esta função é a fonte única da regra no código; o banco tem a
 * mesma lista em `whatsapp_triagem_termos_proibidos` (B1) e o servidor roda esta
 * função no texto JÁ MONTADO, com o nome do contato e o endereço dentro, antes
 * de enfileirar. Se reprovar, não envia.
 */

export type ProblemaDeTexto = { regra: string; trecho: string };

type Regra = {
  regra: string;
  teste: RegExp;
  ramos: "todos" | "cliente";
};

/** Regra que veio da tabela `whatsapp_triagem_termos_proibidos`: diz sozinha em que texto roda. */
export type RegraDoBanco = Regra & { sobre: "plano" | "bruto" };

/** Uma linha da tabela, como o servidor a lê. `ramo` 'nome' é só do nome que o contato digita e não entra aqui. */
export type TermoDoBanco = {
  regra: string;
  termo: string;
  tipo: string;
  sobre: string;
  ramo: string;
  ativo?: boolean | null;
};

/** Termos de dinheiro e prazo: valem para os dois ramos. */
const REGRAS: readonly Regra[] = [
  { regra: "moeda", teste: /r\s?\$/i, ramos: "todos" },
  { regra: "valor_em_reais", teste: /\b\d[\d.,]*\s*(reais|real|mil)\b|\breais\b/i, ramos: "todos" },
  {
    regra: "valor_com_centavos",
    teste: /\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d+[.,]\d{2}\b(?!\s*(?:h|horas?))/i,
    ramos: "todos",
  },
  { regra: "valor_depois_de_valor", teste: /\bvalor(?:es)?\s*(?:de|e|:)?\s*\d/i, ramos: "todos" },
  { regra: "porcentagem", teste: /%|\bpor\s?cento\b/i, ramos: "todos" },
  { regra: "desconto", teste: /desconto/i, ramos: "todos" },
  { regra: "pix", teste: /\bpix\b/i, ramos: "todos" },
  { regra: "boleto", teste: /\bboleto/i, ramos: "todos" },
  { regra: "parcelamento", teste: /\bparcel/i, ramos: "todos" },
  { regra: "juros", teste: /\bjuros\b/i, ramos: "todos" },
  { regra: "nota_fiscal", teste: /nota\s+fiscal/i, ramos: "todos" },
  {
    regra: "prazo_em_numero",
    teste: /\b\d+\s*(dias?|horas?|semanas?|meses|uteis)\b/i,
    ramos: "todos",
  },
  // só no ramo cliente final
  { regra: "parceiro", teste: /parceir|parceri/i, ramos: "cliente" },
  { regra: "terceirizado", teste: /terceiriz/i, ramos: "cliente" },
  { regra: "revendedor", teste: /revend/i, ramos: "cliente" },
  { regra: "tabela", teste: /tabela/i, ramos: "cliente" },
  {
    regra: "preco_diferenciado",
    teste:
      /diferenciad|(?:preco|valor|condicoes?)\s+(?:especial|especiais|de custo|de atacado)|\batacado\b/i,
    ramos: "cliente",
  },
];

/* ------------------------------------------------------------------ */
/* Regras só do código (C1), para o texto livre das assistentes         */
/* ------------------------------------------------------------------ */

/**
 * O banco (`whatsapp_triagem_termos_proibidos`) NÃO tem estas regras: elas existem só aqui, para o texto livre da
 * assistente da caixa de entrada e do atendente do ensaio. A triagem de boas-vindas (nome do contato, textos montados
 * e textos editáveis) usa só as regras comuns acima, as mesmas do banco, via `escopo: "triagem"`: um nome como "Maria
 * Barata" ou "Cara Silva" tem de passar do passo do nome. Semear estas regras no banco é uma migração própria, só se o
 * dono quiser.
 *
 * Tudo roda sobre o texto sem acento e em minúsculas.
 */
const UNID = "um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove";
const TEEN = "dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove";
const DEZENA = "vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa";
/** Número por extenso até 99: "tres", "quinze", "vinte e cinco", "quarenta e cinco". */
const EXT = `(?:(?:${DEZENA})(?:\\s+e\\s+(?:${UNID}))?|${TEEN}|${UNID})`;
/** O mesmo sem "um" e "uma", para onde eles são artigo ("dia uma", "cobra um"). */
const EXT_SEM_UM = `(?:(?:${DEZENA})(?:\\s+e\\s+(?:dois|duas|tres|quatro|cinco|seis|sete|oito|nove))?|${TEEN}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)`;
/** Número grande por extenso, para dinheiro: "cinquenta", "cem", "mil", "mil e quinhentos". */
const CENTENA = "cem|cento|duzentos|duzentas|trezentos|trezentas|quatrocentos|quatrocentas|quinhentos|quinhentas|seiscentos|seiscentas|setecentos|setecentas|oitocentos|oitocentas|novecentos|novecentas";
const EXT_PRECO = `(?:(?:${CENTENA}|mil)(?:\\s+e\\s+(?:${CENTENA}|${DEZENA}|${TEEN}|${UNID}))?|${EXT_SEM_UM})`;
const DIA_SEMANA = "(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:\\s*-?\\s*feira)?";
const MES = "(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)";
/** Palavra que diz o que o número conta: quantidade ou medida, não dinheiro nem data. */
const QUANTIDADE =
  "(?:unidades?|un|unid\\w*|folhas?|cartoes|cartao|pecas?|banners?|adesivos?|panfletos?|flyers?|folders?|copias?|exemplares|etiquetas?|convites?|placas?|itens|produtos|vias?|cores?|cm|mm|m|mt|mts|metros?|kg|g|ml|l|x|polegadas?|paginas?|dpi)\\b";
/** Palavra que diz que o número é de endereço, pedido ou protocolo, e não preço. */
const NUMERO_DE_COISA =
  "(?<!\\b(?:terminad[oa]\\s+em|terminando\\s+em|final|telefone|tel|fone|celular|whatsapp|zap|os|pedido|orcamento|numero|nro|n|protocolo|ordem|cep|quadra|lote|casa|apto|ap|bloco|sala|rua|av|avenida|travessa|conjunto|cj|ramal|codigo)\\s*[#:]?\\s*)";

const SO_DO_CODIGO: readonly Regra[] = [
  // Prazo sem número. "hoje", "amanhã" e "prazo" soltos NÃO são promessa ("Em que posso ajudar hoje?"); o dia só reprova
  // com verbo de entrega por perto. Os verbos fortes (pronto, entrega, chega, retirada) pegam até três palavras de
  // distância; os fracos (fica, sai) só uma, porque "fica à vontade" não é prazo.
  {
    regra: "prazo_relativo",
    teste: new RegExp(
      [
        "\\b(?:ainda hoje|hoje mesmo|amanha mesmo|semana que vem|proxima semana|proximo mes|fica pronto|ficara pronto|fica prontinho|pronto em|garantia|garantido|garantimos)\\b",
        "\\b(?:pront\\w*|entreg\\w*|chega\\w*|retir\\w*)\\b(?:\\s+\\w+){0,3}\\s+(?:hoje|amanha|depois de amanha)\\b",
        "\\b(?:hoje|amanha|depois de amanha)\\b(?:\\s+\\w+){0,3}\\s+(?:pront\\w*|entreg\\w*|chega\\w*|retir\\w*)\\b",
        "\\b(?:fica|ficam|ficara|ficarao|sai|saira|saem|ate)\\b(?:\\s+\\w+)?\\s+(?:hoje|amanha|depois de amanha)\\b",
        "\\b(?:hoje|amanha|depois de amanha)\\b(?:\\s+\\w+)?\\s+(?:fica|ficam|ficara|ficarao|sai|saira|saem)\\b",
        // dia da semana: só com verbo de entrega ou "pronto" por perto ("pronto na sexta", "entregamos até quarta")
        `\\b(?:pront\\w*|entreg\\w*|chega\\w*|retir\\w*)\\b(?:\\s+\\w+){0,2}\\s+${DIA_SEMANA}\\b`,
        `\\b${DIA_SEMANA}\\b(?:\\s+\\w+){0,2}\\s+(?:pront\\w*|entreg\\w*|chega\\w*|retir\\w*)\\b`,
        `\\b(?:sai|saira|saem)\\b(?:\\s+\\w+)?\\s+${DIA_SEMANA}\\b`,
        `\\b${DIA_SEMANA}\\s+que\\s+vem\\b`,
        "\\b(?:essa|esta|nessa|nesta|dessa|desta)\\s+semana\\b",
        "\\b(?:fim|final)\\s+da\\s+semana\\b",
        "\\bfim\\s+de\\s+semana\\b(?:\\s+\\w+){0,2}\\s+(?:pront\\w*|entreg\\w*)\\b",
        "\\bvalidade\\b",
        "\\bvalid[oa]s?\\s+(?:por|ate)\\b",
        "\\bdaqui\\s+a\\b",
      ].join("|"),
    ),
    ramos: "todos",
  },
  // Prazo por extenso e abreviado: "dois dias", "uma semana", "quarenta e cinco dias", "48h", "3d", "mesmo dia", "dia 15",
  // "15 de novembro", "dia quinze". "um dia" só reprova fora de "tenha um dia ótimo". Hora do relógio ("das 8h às 17h",
  // "8h30") nunca entra: "h" só reprova de 24 para cima, e "d" não vale em "impressão 3D" nem "letra 3D" (mas "letra caixa em 3D" reprova: furo aceito, vai para a equipe).
  {
    regra: "prazo_por_extenso",
    teste: new RegExp(
      [
        `\\b(?<!\\b(?:tenha|tenham|desejo|desejamos)\\s)${EXT}\\s+(?:dias?|semanas?|horas?|meses|mes|uteis)\\b(?!\\s+(?:otimo|bom|boa|incrivel|maravilhoso|abencoado|lindo|excelente|feliz|tranquilo|especial|agradavel|produtivo))`,
        "(?<![\\d.,/-])(?:2[4-9]|[3-9]\\d|\\d{3,})\\s*h\\b",
        "(?<!\\b(?:impressao|letreiro|letras?|logo|efeito|modelo|caixa|adesivo|placa|banner)\\s)(?<![\\d.,/-])\\d{1,2}\\s*d\\b",
        "\\bmesmo\\s+dia\\b",
        `\\bdia\\s+(?:\\d{1,2}|primeiro|${EXT_SEM_UM})\\b`,
        `\\b(?:\\d{1,2}|primeiro|${EXT})\\s+de\\s+${MES}\\b`,
      ].join("|"),
    ),
    ramos: "todos",
  },
  // Data escrita em número: só data de verdade (dia 1 a 31, mês 1 a 12), sem colar em cor ("4/4 cores"), fração ("1/2
  // folha"), medida ("20/30 cm"), nem em endereço ("Quadra 10/12", "Lote 5/6"). Com três partes (10/11/2026) é sempre
  // data. Com duas, o caso ambíguo (10/12 é data válida e também número de quadra) se resolve olhando a palavra de antes e
  // a de depois: endereço, cartão, frente e verso antes, ou medida e cor depois, não é data.
  {
    regra: "data_numerica",
    teste: new RegExp(
      [
        "(?<![\\d/.,-])(?:0?[1-9]|[12]\\d|3[01])\\/(?:0?[1-9]|1[0-2])\\/(?:\\d{4}|\\d{2})(?!\\d)",
        "(?<![\\d/.,-])(?<!\\b(?:quadra|lote|casa|apto|ap|bloco|sala|numero|n|rua|av|avenida|travessa|conjunto|cj|pagina|pag|folha|medida|tamanho|cartao|cartoes|visita|panfleto|panfletos|folder|flyer|impressao|colorido|cor|cores|frente|verso|escala|proporcao)\\s)(?:0?[1-9]|[12]\\d|3[01])\\/(?:0?[1-9]|1[0-2])(?![\\d/]|[.,]\\d)(?!\\s*(?:cores?|cor|cm|mm|m|metros?|folhas?|x|kg|g|ml|l|vias?|pecas?|un|unid\\w*|mts?|polegadas?|paginas?)\\b)",
      ].join("|"),
    ),
    ramos: "todos",
  },
  // Preço sem número: "promoção", "a partir de", "preço". A palavra "valor" sozinha fica de fora ("o valor quem passa é a
  // equipe" é a frase da casa), e "orçamento" também. "Caro cliente", "Cara Maria" e "É caro?" (pergunta) não são preço:
  // barato e caro só reprovam em afirmação sobre preço ("é barato", "mais caro", "saiu caro", "caro demais").
  {
    regra: "preco_sem_numero",
    teste: new RegExp(
      [
        "\\b(?:promoc(?:ao|oes)|promo|gratis|gratuit[oa]s?|de graca|sem custo|a partir de|orcamento fechado|preco|precos|precific\\w*|valor de)\\b",
        "\\b(?:e|eh|esta|estao|ta|ficou|fica|ficam|ficaram|saiu|sai|saem|sao|foi|ser|seria|mais|menos|muito|bem|tao|pouco|super)\\s+(?:barat(?:o|a|os|as|inho|inha|issimo|issima)|car(?:o|a|os|as|issimo|issima))\\b(?![^.!;\\n]*\\?)",
        "\\b(?:barat(?:o|a|os|as|inho|inha)|car(?:o|a|os|as))\\s+(?:demais|bastante)\\b(?![^.!;\\n]*\\?)",
      ].join("|"),
    ),
    ramos: "todos",
  },
  // Preço dito por verbo ou por extenso: "custa 50", "cobramos cem", "sai por mil e quinhentos", "investimento de 800", "1500",
  // "1.500", "dois contos", "pila", "centavos", "um real", "por peça", "o metro", "cada" (depois de número ou no fim da
  // frase). Quantidade ("100 unidades", "orçamento de 3 banners", "1.000 cartões") e número de pedido ou endereço ("OS 1234")
  // não são preço.
  {
    regra: "preco_com_verbo",
    teste: new RegExp(
      [
        `\\b(?:custa|custam|custo|cobramos|cobra|cobro|cobrar|sai\\s+por|saem\\s+por|saimos\\s+por|fica\\s+por|ficam\\s+por|investimento\\s+de|orcamento\\s+de|a\\s+partir\\s+de)\\s+(?:(?:de|e|apenas|so|uns|umas|cerca\\s+de|em\\s+torno\\s+de|aproximadamente)\\s+)?(?:\\d[\\d.,]*|${EXT_PRECO}\\b)(?!\\s*${QUANTIDADE})`,
        `(?<![\\d.,/-])${NUMERO_DE_COISA}(?:\\d{1,3}(?:\\.\\d{3})+|(?!(?:19|20)\\d\\d\\b)[1-9]\\d{3})(?![\\d]|[.,]\\d)(?!\\s*${QUANTIDADE})`,
        `\\b(?:\\d+|${EXT_PRECO})\\s+contos?\\b`,
        "\\bpilas?\\b",
        "\\bcentavos?\\b",
        "\\bum\\s+real\\b",
        "\\bpor\\s+pecas?\\b",
        "\\b(?:o|por)\\s+metro\\b",
        "\\b(?:\\d+|" + EXT_PRECO + ")\\s*(?:\\w+\\s+){0,2}cada\\b",
        "\\bcada\\s*(?:[.!;?]|$)",
      ].join("|"),
    ),
    ramos: "todos",
  },
  // Forma de pagamento sem as palavras que o banco já conhece: "à vista", "cartão de crédito", "pagamento na entrega",
  // "metade na entrada", "sinal", "em 3x", "em três vezes". "entrada" e "valor" soltos passam.
  {
    regra: "pagamento",
    teste: new RegExp(
      [
        "\\ba\\s+vista\\b",
        "\\bcartao\\s+de\\s+(?:credito|debito)\\b",
        "\\bpagamento\\s+na\\s+entrega\\b",
        "\\bmetade\\s+na\\s+entrada\\b",
        "\\bsinal\\b",
        `\\bem\\s+(?:\\d{1,2}\\s*x|\\d{1,2}\\s+vezes|${EXT}\\s+vezes)\\b`,
      ].join("|"),
    ),
    ramos: "todos",
  },
];

/** Nomes das regras que só o código tem. Quem compara com o banco (teste de paridade) tira estas. */
export const REGRAS_SO_DO_CODIGO: readonly string[] = SO_DO_CODIGO.map((r) => r.regra);

/** Estilo pedido pelo dono: sem travessão, seta nem parênteses; nada de variável sem preencher. */
const ESTILO: readonly Regra[] = [
  // travessões de Unicode: em dash, en dash, barra horizontal U+2015, traço de figura U+2012, sinal de menos U+2212, dois e três
  // em dash U+2E3A e U+2E3B, e as formas pequena U+FE58, U+FE63 e de largura total U+FF0D. O hífen comum NÃO entra (Ana-Clara).
  { regra: "travessao", teste: /[—–―‒−⸺⸻﹘﹣－]/, ramos: "todos" },
  // setas: bloco de setas U+2190 a U+21FF, setas de dingbats U+2794, U+2798 a U+27AF e U+27B1 a U+27BE (inclui U+279C; fora ficam os emojis de mais, menos, divisão e laço), setas suplementares A e B
  // U+27F0 a U+27FF e U+2900 a U+297F, e as setas de emoji U+2B05 a U+2B07. Mais as setas de teclado: ->, => e <-.
  { regra: "seta", teste: /[←-⇿➔➘-➯➱-➾⟰-⟿⤀-⥿⬅-⬇]|->|=>|<-/, ramos: "todos" },
  { regra: "parenteses", teste: /[()]/, ramos: "todos" },
  { regra: "variavel_sem_preencher", teste: /\{\{|\}\}/, ramos: "todos" },
];

export type ResultadoDaVerificacao = { ok: boolean; problemas: ProblemaDeTexto[] };

/**
 * Traduz a lista do banco para regras. POSIX do Postgres vira JavaScript (`\y` é `\b`); linha inválida, inativa ou do
 * ramo 'nome' fica de fora e é contada. A lista do código é o piso: o que vem do banco só ACRESCENTA, e uma linha que
 * não compila nunca tira regra de ninguém.
 */
export function compilarTermosDoBanco(linhas: unknown): { regras: RegraDoBanco[]; ignorados: number } {
  const regras: RegraDoBanco[] = [];
  let ignorados = 0;
  if (!Array.isArray(linhas)) return { regras, ignorados };
  for (const bruta of linhas as Partial<TermoDoBanco>[]) {
    if (!bruta || bruta.ativo === false) continue;
    if (bruta.ramo === "nome") continue;
    const ramos = bruta.ramo === "cliente" ? "cliente" : bruta.ramo === "todos" ? "todos" : null;
    const termo = typeof bruta.termo === "string" ? bruta.termo.trim() : "";
    if (!ramos || !termo || typeof bruta.regra !== "string" || !bruta.regra) {
      ignorados++;
      continue;
    }
    const sobre = bruta.sobre === "bruto" ? "bruto" : "plano";
    try {
      const fonte =
        bruta.tipo === "trecho"
          ? semAcento(termo).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          : termo.replace(/\\[ym]/g, "\\b").replace(/\\M/g, "\\b").replace(/\\Y/g, "\\B");
      regras.push({ regra: bruta.regra, teste: new RegExp(fonte, "i"), ramos, sobre });
    } catch {
      ignorados++;
    }
  }
  return { regras, ignorados };
}

/**
 * `escopo: "completo"` (padrão) é para o texto livre das assistentes e roda todas as regras. `escopo: "triagem"` é para a
 * triagem de boas-vindas (nome digitado, textos montados e editáveis): só as regras comuns, as mesmas do banco.
 */
export type OpcoesDeVerificacao = { escopo?: "completo" | "triagem" };

export function verificarTexto(
  texto: string,
  ramo: Ramo,
  extras: readonly RegraDoBanco[] = [],
  opcoes: OpcoesDeVerificacao = {},
): ResultadoDaVerificacao {
  const bruto = texto ?? "";
  const plano = semAcento(bruto).toLowerCase();
  const problemas: ProblemaDeTexto[] = [];
  for (const r of extras) {
    if (r.ramos === "cliente" && ramo !== "cliente") continue;
    const m = (r.sobre === "bruto" ? bruto : plano).match(r.teste);
    if (m) problemas.push({ regra: r.regra, trecho: m[0] });
  }
  for (const r of opcoes.escopo === "triagem" ? [...REGRAS, ...ESTILO] : [...REGRAS, ...SO_DO_CODIGO, ...ESTILO]) {
    if (r.ramos === "cliente" && ramo !== "cliente") continue;
    const alvo =
      r.regra === "moeda" || r.regra === "porcentagem" || ESTILO.includes(r) ? bruto : plano;
    const m = alvo.match(r.teste);
    if (m) problemas.push({ regra: r.regra, trecho: m[0] });
  }
  if (!bruto.trim()) problemas.push({ regra: "vazio", trecho: "" });
  if (bruto.length > 600) problemas.push({ regra: "acima_de_600_caracteres", trecho: "" });
  return { ok: problemas.length === 0, problemas };
}

export function textoLimpo(
  texto: string,
  ramo: Ramo,
  extras: readonly RegraDoBanco[] = [],
  opcoes: OpcoesDeVerificacao = {},
): boolean {
  return verificarTexto(texto, ramo, extras, opcoes).ok;
}
