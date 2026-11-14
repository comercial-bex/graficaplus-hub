import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decidirDoAgente, TEMA_DE_PRECO, type DecisaoDoAgente } from "../../src/domain/agente";
import { verificarTexto } from "../../src/domain/whatsapp/triagem";
import { basePadrao, contexto, prng, QUADRO, resposta } from "./montar";

/**
 * Propriedades do agente, sobre conversas sorteadas com semente fixa:
 *  1. NENHUMA saída contém preço ou prazo: o texto que sai é sempre exatamente o `texto_aprovado` de uma resposta da base, e
 *     passa no verificador, e não tem dígito, moeda, porcentagem, desconto, pagamento nem prazo, mesmo com respostas
 *     "envenenadas" na base;
 *  2. resposta envenenada (com preço ou prazo) nunca é escolhida;
 *  3. pergunta de preço só recebe a resposta do tema de preço, e a segunda vai à equipe;
 *  4. desligada, gente na conversa, bloqueio, teto e mensagem já decidida nunca escolhem;
 *  5. a decisão é determinística e só `escolher` carrega texto.
 */

const LIMPAS = [
  "A equipe atende de segunda a sexta. Fora desse horário, deixe sua mensagem por aqui.",
  "Me diga a largura e a altura que você precisa. A equipe confere se aquela medida é possível.",
  "Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.",
  "A equipe confirma se a entrega é possível para o seu endereço e como ela funciona.",
  "Costuma servir arquivo em PDF, em vetor ou em imagem com boa resolução.",
  "Cada trabalho tem medida, material e quantidade próprios, então quem confirma o valor é a equipe.",
];
const ENVENENADAS = [
  "O banner custa R$ 50 e fica pronto em 2 dias.",
  "Fazemos por cinquenta reais, com desconto para quem compra mais.",
  "A partir de 20 a unidade, pagamento à vista no pix.",
  "Fica pronto amanhã, é só passar aqui.",
  "Parcelamos em 3x no cartão de crédito.",
  "O orçamento sai de graça e o prazo é de 48h.",
  "Trabalhamos com revenda de brindes e preço de atacado.",
];
const FRASES = [
  "horario",
  "medida",
  "arte",
  "entrega",
  "formato",
  "valor",
  "prazo",
  "quanto custa",
  "preco",
  "pagamento",
  "catalogo",
];
const MENSAGENS = [
  "qual o horario?",
  "quanto custa um banner?",
  "qual o valor do cartao",
  "me passa o preco",
  "qual a medida maxima",
  "posso mandar minha arte",
  "voces fazem entrega",
  "qual formato de arquivo",
  "qual o prazo",
  "aceitam pix",
  "tem catalogo",
  "obrigado",
  "bom dia",
  "quero falar com uma pessoa",
  "pare de me mandar mensagem",
  "isso e um absurdo",
  "banner de 2m por 1m",
  "preciso de 100 cartoes",
  "valor",
  "horario e valor",
  "oi",
  "ok",
  "kkkk",
  "?",
  "quero um orcamento",
];

const PRECO_OU_PRAZO =
  /\d|r\$|reais|real\b|centavo|desconto|%|por cento|pix|boleto|parcel|juros|vista|cartao de credito|prazo de|pronto em|amanha|hoje mesmo|promoc|gratis|barato|atacado|preco especial|revend/i;

function sortear(semente: number) {
  const r = prng(semente);
  const pick = <T>(l: readonly T[]) => l[Math.floor(r() * l.length)];
  const base = basePadrao();
  const n = Math.floor(r() * 7);
  for (let i = 0; i < n; i++) {
    const veneno = r() < 0.45;
    const frases = [pick(FRASES), ...(r() < 0.4 ? [pick(FRASES)] : [])];
    base.push(
      resposta({
        tema: `sorteada_${semente}_${i}`,
        frases_gatilho: [...new Set(frases)],
        texto_aprovado: veneno ? pick(ENVENENADAS) : pick(LIMPAS),
      }),
    );
  }
  const texto = pick(MENSAGENS);
  const ctx = contexto({
    texto,
    base,
    perguntasDePreco: r() < 0.3 ? 1 : 0,
    enviadas: r() < 0.1 ? 3 : Math.floor(r() * 3),
    humanoNaConversa: r() < 0.05,
    bloqueado: r() < 0.05,
    jaDecidida: r() < 0.05,
    envioPendente: r() < 0.05,
    ramo: undefined,
  } as never);
  return { ctx, texto, base };
}

const N = 4000;

describe("propriedades do agente (4.000 conversas sorteadas)", () => {
  it("1 e 2: o que sai é exatamente um texto aprovado da base, limpo, sem dígito, preço nem prazo; envenenada nunca sai", () => {
    let escolheu = 0;
    let envenenadasNaBase = 0;
    for (let s = 1; s <= N; s++) {
      const { ctx } = sortear(s);
      const d = decidirDoAgente(ctx, QUADRO);
      for (const r of ctx.base)
        if (PRECO_OU_PRAZO.test(r.texto_aprovado ?? "")) envenenadasNaBase++;
      if (d.acao !== "escolher") continue;
      escolheu++;
      const linha = ctx.base.find((r) => r.id === d.respostaId)!;
      expect(d.texto, `semente ${s}`).toBe(linha.texto_aprovado);
      expect(d.versao).toBe(linha.versao);
      expect(verificarTexto(d.texto, "cliente").ok, `semente ${s}: ${d.texto}`).toBe(true);
      expect(PRECO_OU_PRAZO.test(d.texto), `semente ${s}: ${d.texto}`).toBe(false);
    }
    // a prova não vale se o sorteio nunca escolhe ou nunca sorteia veneno
    expect(escolheu).toBeGreaterThan(N * 0.15);
    expect(envenenadasNaBase).toBeGreaterThan(N * 0.5);
  });

  it("3: pergunta de preço só recebe o tema de preço; com pergunta de preço anterior vai à equipe", () => {
    let precos = 0;
    for (let s = 1; s <= N; s++) {
      const { ctx } = sortear(s);
      const d = decidirDoAgente(ctx, QUADRO);
      if (d.acao === "escolher" && d.ehPreco) {
        precos++;
        expect(d.tema, `semente ${s}`).toBe(TEMA_DE_PRECO);
        expect(
          ctx.perguntasDePreco,
          `semente ${s}: segunda pergunta de preço não pode escolher`,
        ).toBe(0);
      }
      if (d.acao === "entregar" && d.motivo === "preco_de_novo")
        expect(ctx.perguntasDePreco).toBeGreaterThanOrEqual(1);
    }
    expect(precos).toBeGreaterThan(50);
  });

  it("4: gente na conversa, bloqueio, teto, mensagem já decidida e resposta na fila nunca escolhem", () => {
    for (let s = 1; s <= N; s++) {
      const { ctx } = sortear(s);
      const d = decidirDoAgente(ctx, QUADRO);
      if (
        ctx.humanoNaConversa ||
        ctx.bloqueado ||
        ctx.jaDecidida ||
        ctx.envioPendente ||
        ctx.enviadas >= ctx.config.maxMensagens
      ) {
        expect(d.acao, `semente ${s}`).not.toBe("escolher");
      }
    }
  });

  it("4b: desligada nunca decide nada, e sem triagem liberada o agente fica em silêncio", () => {
    for (let s = 1; s <= 500; s++) {
      const { ctx } = sortear(s);
      expect(
        decidirDoAgente({ ...ctx, config: { ...ctx.config, estado: "desligada" } }, QUADRO),
      ).toEqual({ acao: "nada", motivo: "desligada" });
      expect(decidirDoAgente({ ...ctx, triagem: null }, QUADRO).acao).toBe("nada");
    }
  });

  it("5: determinística, e só `escolher` carrega texto", () => {
    for (let s = 1; s <= 800; s++) {
      const { ctx } = sortear(s);
      const a = decidirDoAgente(ctx, QUADRO);
      const b = decidirDoAgente(structuredClone(ctx), QUADRO);
      expect(b).toEqual(a);
      if (a.acao !== "escolher") expect("texto" in a).toBe(false);
    }
  });

  it("nenhuma decisão carrega a frase do contato", () => {
    for (let s = 1; s <= 800; s++) {
      const { ctx, texto } = sortear(s);
      const d: DecisaoDoAgente = decidirDoAgente(ctx, QUADRO);
      const ruido = texto.length >= 8 ? texto : null;
      if (ruido && d.acao !== "escolher") expect(JSON.stringify(d)).not.toContain(ruido);
    }
  });
});

describe("as 15 sementes da base (C2) passam pela última porta do agente", () => {
  const PASTA = join(__dirname, "..", "..", "supabase", "migrations");
  const sql = readFileSync(join(PASTA, "20261114120000_agente_base_de_respostas.sql"), "utf8");
  const ini = sql.indexOf("INSERT INTO public.agente_base_respostas (tema, pergunta");
  const corpo = sql.slice(ini, sql.indexOf("END $sementes$;", ini));
  const re =
    /\('([a-z_]+)',\s*'([^']*)',\s*ARRAY\[([^\]]*)\]::text\[\],\s*ARRAY\['cliente'\]::public\.triagem_ramo\[\],\s*(NULL|'[^']*'),\s*([\s\S]*?),\s*'semente',\s*(\d+)\)/g;
  const sementes = [...corpo.matchAll(re)].map((m) => ({ tema: m[1], texto: m[5].trim() }));

  it("lê as 15", () => expect(sementes).toHaveLength(15));
  it("as de texto literal passam por verificarTexto no ramo cliente, escopo completo", () => {
    const literais = sementes.filter((s) => s.texto.startsWith("'"));
    expect(literais.length).toBeGreaterThanOrEqual(13);
    for (const s of literais) {
      const texto = s.texto.slice(1, -1).replace(/''/g, "'");
      const v = verificarTexto(texto, "cliente");
      expect(v.problemas, s.tema).toEqual([]);
    }
  });
  it("e as duas que leem o cadastro (horário e endereço), nas duas formas que a migração produz, também passam", () => {
    const formas = [
      "A equipe atende de segunda a sexta, das 8h às 18h. Fora desse horário, deixe sua mensagem por aqui que a equipe vê quando abrir.",
      "O horário de atendimento a equipe confirma. Deixe sua mensagem por aqui que ela vê assim que puder.",
      "A Bex Print fica na Rua Cândido Mendes, 23, bairro Perpétuo Socorro, em Macapá. Se preferir, a equipe confirma como chegar.",
      "O endereço a equipe confirma. Me diga que você quer ir até a loja que eu passo para ela.",
    ];
    for (const t of formas) expect(verificarTexto(t, "cliente").problemas, t).toEqual([]);
  });
});
