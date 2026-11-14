import { describe, expect, it } from "vitest";
import {
  PASSOS_SEMENTE,
  compilarTermosDoBanco,
  horarioEmTexto,
  HORARIO_SEMENTE,
  verificarTexto,
  REGRAS_SO_DO_CODIGO,
} from "../../src/domain/whatsapp/triagem";

/**
 * C1 (14/11/2026): as regras que o verificador único ganhou para as assistentes de texto livre (prazo_relativo,
 * preco_sem_numero, data_numerica), a lista extra que vem da tabela, e propriedades sobre frases sorteadas com semente
 * fixa. O repo não tem fast-check; o gerador é o mesmo de propriedades.test.ts.
 */

function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const regrasDe = (t: string, ramo: "cliente" | "parceiro" = "cliente") =>
  verificarTexto(t, ramo).problemas.map((p) => p.regra);

const regrasDo = (t: string) => verificarTexto(t, "cliente").problemas.map((p) => p.regra);

describe("frases de gráfica que PASSAM (nenhuma regra do código as reprova)", () => {
  it.each([
    // saudação, "hoje" e "amanhã" soltos, "prazo" solto
    "Em que posso ajudar hoje?",
    "Bom dia! Tudo bem hoje?",
    "Estamos hoje com atendimento normal",
    "Posso te ajudar com mais alguma coisa amanhã?",
    "O prazo é com a equipe",
    "Quer falar do prazo com a equipe?",
    "Boa tarde, como vai você hoje?",
    // horário da casa e dia da semana sem verbo de entrega
    "Estamos fechados no domingo",
    "Voltamos a atender na segunda",
    "Atendemos de segunda até sexta",
    "Aberto no sábado até 12h",
    "Atendemos entre segunda e sexta",
    "Atendemos de segunda a sexta, das 8h às 17h",
    "Funcionamos das 8h às 12h e das 14h às 18h",
    "Abrimos aos sábados a partir das 8h30",
    "Fechamos na sexta-feira à noite",
    // saudação com Caro e Cara, pergunta do cliente
    "Caro cliente, bem-vindo à Bex Print",
    "Cara Maria, tudo bem",
    "Caro João, como podemos ajudar",
    "É caro?",
    "Será que é barato?",
    // medidas, cores, frações, quantidades
    "Cartão de visita 4/4 cores",
    "Impressão 4/0 em papel couchê",
    "Folha 1/0 em sulfite",
    "Dobra em 1/2 folha",
    "Banner 50/50 na horizontal",
    "Placa de 20/30 cm",
    "Banner 3x1 com ilhós",
    "Adesivo A4 de 90g",
    "Quero 100 unidades",
    "Preciso de 1.000 cartões",
    "Uns 1500 flyers",
    "Placa de 5 cm",
    "Orçamento de 3 banners",
    "Sobre o orçamento, a equipe entra em contato",
    // endereço, CEP, telefone, ano, número de pedido
    "Entregamos na Quadra 10/12",
    "Fica no Lote 5/6 da avenida",
    "CEP 68900-000, ligue 96 99999-9999, às 8h30",
    "Estamos desde 2015 no mercado",
    "O pedido 1234 está com a equipe",
    "OS 1.234 em atendimento",
    // palavras que parecem preço e prazo mas não são
    "O valor quem passa é a equipe",
    "Confira cada detalhe da arte",
    "A entrada do prédio fica na lateral",
    "Cada pedido é único",
    "Tenha um dia ótimo",
    "Tenha um dia incrível!",
    "Pode me mandar a arte quando quiser",
    "A arte já está pronta?",
    "Qual o tamanho do banner?",
    "Quer em lona ou em vinil?",
    "Vou chamar a equipe para você",
  ])("%j passa", (t) => {
    expect(regrasDo(t), t).toEqual([]);
  });
});

describe("frases que BARRAM, com a regra que as pega", () => {
  it.each([
    // prazo relativo: dia com verbo de entrega, dia da semana com entrega
    ["Fica pronto amanhã", "prazo_relativo"],
    ["Fica pronto hoje", "prazo_relativo"],
    ["Entregamos hoje", "prazo_relativo"],
    ["Amanhã a gente entrega", "prazo_relativo"],
    ["Pronto depois de amanhã", "prazo_relativo"],
    ["Sai hoje mesmo", "prazo_relativo"],
    ["Ainda hoje eu confirmo", "prazo_relativo"],
    ["Até amanhã fica certo", "prazo_relativo"],
    ["Pronto na sexta", "prazo_relativo"],
    ["Entregamos até quarta", "prazo_relativo"],
    ["Fica pronto sexta", "prazo_relativo"],
    ["Sábado fica pronto", "prazo_relativo"],
    ["Fica para segunda que vem", "prazo_relativo"],
    ["Semana que vem fica pronto", "prazo_relativo"],
    ["Isso fica pronto essa semana", "prazo_relativo"],
    ["Sai até o fim da semana", "prazo_relativo"],
    ["A validade é da equipe", "prazo_relativo"],
    ["Orçamento válido por um tempo", "prazo_relativo"],
    ["Daqui a pouco confirmo", "prazo_relativo"],
    ["Tem garantia total", "prazo_relativo"],
    // prazo por extenso e abreviado
    ["Fica em dois dias", "prazo_por_extenso"],
    ["Leva uma semana", "prazo_por_extenso"],
    ["Em três dias úteis", "prazo_por_extenso"],
    ["Em tres dias", "prazo_por_extenso"],
    ["Demora quinze dias", "prazo_por_extenso"],
    ["Em quarenta e cinco dias", "prazo_por_extenso"],
    ["Uma hora e fica pronto", "prazo_por_extenso"],
    ["Em dois meses", "prazo_por_extenso"],
    ["Sai em 48h", "prazo_por_extenso"],
    ["Entrega em 3d", "prazo_por_extenso"],
    ["Fica pronto no mesmo dia", "prazo_por_extenso"],
    ["Até o dia 20", "prazo_por_extenso"],
    ["Dia 15 está bom", "prazo_por_extenso"],
    ["Para 15 de novembro", "prazo_por_extenso"],
    ["Entrega em vinte de dezembro", "prazo_por_extenso"],
    ["Dia quinze a gente vê", "prazo_por_extenso"],
    // data em número
    ["Fica pronto 10/11", "data_numerica"],
    ["Vence em 10/11/2026", "data_numerica"],
    ["Vence 15/12", "data_numerica"],
    ["Até 3/4", "data_numerica"],
    ["10/11", "data_numerica"],
    // preço sem número
    ["Está barato", "preco_sem_numero"],
    ["Ficou caro", "preco_sem_numero"],
    ["É barato", "preco_sem_numero"],
    ["Sai mais barato assim", "preco_sem_numero"],
    ["Fica muito caro", "preco_sem_numero"],
    ["Saiu caro demais", "preco_sem_numero"],
    ["Temos promoção", "preco_sem_numero"],
    ["É grátis", "preco_sem_numero"],
    ["Sem custo para você", "preco_sem_numero"],
    ["Qual o preço", "preco_sem_numero"],
    ["Os preços mudam", "preco_sem_numero"],
    ["O valor de um banner varia", "preco_sem_numero"],
    ["Sai de graça", "preco_sem_numero"],
    // preço com verbo ou por extenso
    ["Custa 50", "preco_com_verbo"],
    ["Cobramos cinquenta", "preco_com_verbo"],
    ["Cobra cem", "preco_com_verbo"],
    ["Sai por mil e quinhentos", "preco_com_verbo"],
    ["Fica por 80", "preco_com_verbo"],
    ["Investimento de 800", "preco_com_verbo"],
    ["Orçamento de 300", "preco_com_verbo"],
    ["A partir de 80", "preco_com_verbo"],
    ["Fica 1500", "preco_com_verbo"],
    ["Fica 1.500", "preco_com_verbo"],
    ["São dois contos", "preco_com_verbo"],
    ["Uns 30 pila", "preco_com_verbo"],
    ["Cinquenta centavos", "preco_com_verbo"],
    ["Um real", "preco_com_verbo"],
    ["Sai por peça", "preco_com_verbo"],
    ["Cobramos o metro", "preco_com_verbo"],
    ["Fica 50 cada", "preco_com_verbo"],
    ["O banner é tanto cada.", "preco_com_verbo"],
    // pagamento
    ["Pagamento à vista", "pagamento"],
    ["Aceitamos a vista", "pagamento"],
    ["Cartão de crédito também", "pagamento"],
    ["Cartão de débito também", "pagamento"],
    ["Pagamento na entrega", "pagamento"],
    ["Metade na entrada", "pagamento"],
    ["Pede um sinal", "pagamento"],
    ["Em 3x", "pagamento"],
    ["Em três vezes", "pagamento"],
    ["Em 10x no cartão", "pagamento"],
  ])("%j barra por %s", (t, regra) => {
    expect(regrasDo(t), t).toContain(regra);
  });

  it("os dois ramos barram igual", () => {
    for (const t of ["Fica pronto amanhã", "Custa 50", "Pagamento à vista", "dia 15"]) {
      expect(regrasDe(t, "cliente")).toEqual(regrasDe(t, "parceiro"));
      expect(regrasDe(t, "parceiro").length).toBeGreaterThan(0);
    }
  });
});

describe("escopo da triagem: só as regras comuns, as mesmas do banco", () => {
  const triagem = (t: string) => verificarTexto(t, "cliente", [], { escopo: "triagem" }).problemas.map((p) => p.regra);
  it.each(["Prazer, Cara!", "Maria Barata", "Hoje", "Ana Caro", "dia 15", "Fica pronto amanhã", "10/11", "Custa 50"])(
    "%j não é reprovado pelas regras só do código",
    (t) => {
      expect(triagem(t).filter((r) => REGRAS_SO_DO_CODIGO.includes(r))).toEqual([]);
    },
  );
  it("as regras comuns continuam valendo na triagem", () => {
    for (const t of ["Prazer, Pix!", "R$ 10", "10%", "em 3 dias", "tabela"]) expect(triagem(t).length, t).toBeGreaterThan(0);
  });
  it("o horário da casa montado a partir da tabela passa no completo", () => {
    const h = horarioEmTexto(HORARIO_SEMENTE)!;
    expect(h.dias).toBe("de segunda a sexta");
    expect(regrasDo(`Funcionamos das ${h.abre} às ${h.fecha}, ${h.dias}.`)).toEqual([]);
  });
});

describe("os textos semente continuam passando (nenhuma regra nova os reprova)", () => {
  it("todos os passos, variantes e repetições, no ramo deles, já com as variáveis de exemplo", () => {
    const exemplo = (t: string) =>
      t
        .replace(/\{\{\s*primeiro_nome\s*\}\}/g, "Maria")
        .replace(/\{\{\s*telefone\s*\}\}/g, "terminado em 2233")
        .replace(/\{\{\s*cep\s*\}\}/g, "68900-000")
        .replace(/\{\{\s*bairro\s*\}\}/g, "Centro")
        .replace(/\{\{\s*cidade\s*\}\}/g, "Macapá")
        .replace(/\{\{\s*abre\s*\}\}/g, "8h")
        .replace(/\{\{\s*fecha\s*\}\}/g, "18h")
        .replace(/\{\{\s*dias\s*\}\}/g, "de segunda a sexta")
        .replace(/\{\{\s*ack\s*\}\}/g, "Tudo bem.")
        .replace(/\{\{[^}]*\}\}/g, "ok");
    let n = 0;
    for (const p of PASSOS_SEMENTE) {
      for (const t of [p.texto, ...(p.variantes ?? []), ...(p.repeticao ? [p.repeticao] : [])]) {
        const novas = verificarTexto(exemplo(t), p.ramo as "cliente" | "parceiro").problemas.filter((x) =>
          REGRAS_SO_DO_CODIGO.includes(x.regra),
        );
        expect(novas, `${p.codigo}: ${t}`).toEqual([]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(40);
  });
});

describe("lista extra da tabela", () => {
  const linha = (o: Record<string, unknown>) => ({ regra: "extra", termo: "x", tipo: "trecho", sobre: "plano", ramo: "todos", ativo: true, ...o });

  it("trecho, padrão POSIX (\\y vira \\b) e texto bruto, sem acento e sem diferença de caixa", () => {
    const { regras, ignorados } = compilarTermosDoBanco([
      linha({ regra: "frete", termo: "frete" }),
      linha({ regra: "brinde", termo: "\\ybrinde\\y", tipo: "padrao" }),
      linha({ regra: "arroba", termo: "@", tipo: "padrao", sobre: "bruto" }),
      linha({ regra: "acento", termo: "Instalação" }),
    ]);
    expect(ignorados).toBe(0);
    const r = (t: string) => verificarTexto(t, "cliente", regras).problemas.map((p) => p.regra);
    expect(r("Entregamos com FRETE")).toContain("frete");
    expect(r("Ganha um brinde hoje")).toContain("brinde");
    expect(r("Brindes não")).not.toContain("brinde");
    expect(r("fale em @bexprint")).toContain("arroba");
    expect(r("Fazemos instalacao")).toContain("acento");
  });

  it("ramo cliente só vale para cliente; ramo nome, inativa, vazia e inválida ficam de fora, contadas", () => {
    const { regras, ignorados } = compilarTermosDoBanco([
      linha({ regra: "so_cliente", termo: "exclusivo", ramo: "cliente" }),
      linha({ regra: "do_nome", termo: "zzz", ramo: "nome" }),
      linha({ regra: "desligada", termo: "ligada", ativo: false }),
      linha({ regra: "vazia", termo: "  " }),
      linha({ regra: "quebrada", termo: "(", tipo: "padrao" }),
      null,
    ]);
    expect(regras.map((r) => r.regra)).toEqual(["so_cliente"]);
    expect(ignorados).toBe(2);
    expect(verificarTexto("oferta exclusivo", "cliente", regras).ok).toBe(false);
    expect(verificarTexto("oferta exclusivo", "parceiro", regras).ok).toBe(true);
  });

  it("resposta que não é lista vira lista vazia", () => {
    for (const x of [null, undefined, {}, "x", 3]) expect(compilarTermosDoBanco(x)).toEqual({ regras: [], ignorados: 0 });
  });
});

describe("propriedades, sobre frases sorteadas (semente fixa)", () => {
  const LIMPAS = [
    "Olá, Max",
    "Qual produto você procura",
    "Pode me dizer a medida e a quantidade",
    "A arte já está pronta",
    "A equipe confirma os detalhes com você",
    "Trabalhamos com banners, adesivos e placas",
    "Fale com a gente por aqui",
  ];
  const RUINS = [
    "fica R$ 50",
    "custa 50 reais",
    "mil reais",
    "10%",
    "10 por cento",
    "pronto amanhã",
    "em 3 dias",
    "entregamos até sexta",
    "tabela",
    "revendedor",
    "parceiro",
    "Pix",
    "desconto",
    "a partir de 80",
    "dia 10/11",
    "é barato",
    "garantia",
  ];

  it("frase limpa passa; qualquer frase ruim, em qualquer posição, reprova", () => {
    const sorteio = prng(1409);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(sorteio() * xs.length)];
    for (let i = 0; i < 400; i++) {
      const partes = Array.from({ length: 1 + Math.floor(sorteio() * 3) }, () => pick(LIMPAS));
      const limpa = `${partes.join(". ")}.`;
      expect(verificarTexto(limpa, "cliente").problemas, limpa).toEqual([]);
      const ruim = pick(RUINS);
      const k = Math.floor(sorteio() * (partes.length + 1));
      const sujo = [...partes.slice(0, k), ruim, ...partes.slice(k)].join(". ");
      expect(verificarTexto(sujo, "cliente").ok, sujo).toBe(false);
    }
  });

  it("a lista extra só acrescenta: nunca tira um problema que a lista do código já achou", () => {
    const sorteio = prng(77);
    const extras = compilarTermosDoBanco([
      { regra: "frete", termo: "frete", tipo: "trecho", sobre: "plano", ramo: "todos", ativo: true },
      { regra: "quebrada", termo: "(", tipo: "padrao", sobre: "plano", ramo: "todos", ativo: true },
    ]).regras;
    const todas = [...LIMPAS, ...RUINS, "com frete"];
    for (let i = 0; i < 300; i++) {
      const t = Array.from({ length: 1 + Math.floor(sorteio() * 3) }, () => todas[Math.floor(sorteio() * todas.length)]).join(". ");
      const sem = new Set(verificarTexto(t, "cliente").problemas.map((p) => p.regra));
      const com = new Set(verificarTexto(t, "cliente", extras).problemas.map((p) => p.regra));
      for (const r of sem) expect(com.has(r), `${t}: ${r}`).toBe(true);
    }
  });
});
