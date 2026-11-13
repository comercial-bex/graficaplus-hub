import { describe, expect, it } from "vitest";
import {
  interpretar,
  normalizarTexto,
  PALAVRAS_DE_PARCEIRO,
  SEMENTES_DO_QUADRO,
  type Intencao,
} from "../../src/domain/whatsapp/triagem";
import { FRASES, variar } from "./frases-reais";

describe("normalizar", () => {
  it.each([
    ["Sim!", "sim"],
    ["  SIMMMM  ", "sim"],
    ["Não é esse", "nao e esse"],
    ["Tô conhecendo", "to conhecendo"],
    ["Claro!!! 😊", "claro"],
    ["isso aí...", "isso ai"],
    ["ok", "ok"],
    ["ss", "ss"],
    ["simm", "simm"],
    ["Olá, tudo bem?", "ola tudo bem"],
    ["CEP: 68900-000", "cep 68900 000"],
    ["00000-000", "00000 000"],
    ["👍", "emojiok"],
    ["👍🏽👍", "emojiok"],
    ["👎", "emojinao"],
    ["🙂🙂", ""],
    ["", ""],
  ])("%j vira %j", (entrada, esperado) => {
    expect(normalizarTexto(entrada)).toBe(esperado);
  });

  it("não mexe nos dígitos repetidos", () => {
    expect(normalizarTexto("11111")).toBe("11111");
  });

  it("é idempotente", () => {
    for (const f of ["Simmm!!", "É isso mesmo 👍", "Quanto custa? R$ 50"]) {
      const uma = normalizarTexto(f);
      expect(normalizarTexto(uma)).toBe(uma);
    }
  });
});

describe("sementes do quadro", () => {
  it("sobrevivem à normalização sem mudar", () => {
    for (const s of SEMENTES_DO_QUADRO) {
      expect(normalizarTexto(s.frase), s.frase).toBe(s.frase);
    }
  });

  it("não repetem a mesma frase, passo e casamento", () => {
    const chaves = SEMENTES_DO_QUADRO.map(
      (s) => `${s.passo}|${s.frase}|${s.casamento}|${s.intencao}`,
    );
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("a palavra revendedor não existe no quadro", () => {
    for (const s of SEMENTES_DO_QUADRO) expect(s.frase).not.toMatch(/revend/);
    expect(PALAVRAS_DE_PARCEIRO).not.toContain("revendedor");
  });

  it("as palavras de parceiro do dono estão todas no quadro como parceiro", () => {
    for (const p of PALAVRAS_DE_PARCEIRO) {
      expect(interpretar(p, "nome", SEMENTES_DO_QUADRO).intencao, p).toBe("parceiro");
    }
  });

  it("cobre as quinze intenções", () => {
    const presentes = new Set(SEMENTES_DO_QUADRO.map((s) => s.intencao));
    expect([...presentes].sort()).toEqual(Object.keys(FRASES).sort());
  });
});

describe("interpretar: pelo menos 80 frases reais por intenção", () => {
  for (const [intencao, { passo, bases }] of Object.entries(FRASES)) {
    // "oi, Parceiro" é vocativo (gíria), não pedido: a palavra solta de parceiro só vale como mensagem inteira
    const todas = [...new Set(bases.flatMap(variar))].filter(
      (f) => !(intencao === "parceiro" && /^oi, parce(i|ri)/i.test(f)),
    );

    it(`${intencao}: ${todas.length} frases, ${bases.length} escritas à mão`, () => {
      expect(todas.length).toBeGreaterThanOrEqual(80);
      expect(bases.length).toBeGreaterThanOrEqual(45);
      const erradas = todas
        .map((frase) => ({ frase, lida: interpretar(frase, passo, SEMENTES_DO_QUADRO).intencao }))
        .filter((x) => x.lida !== intencao);
      expect(erradas).toEqual([]);
    });
  }
});

describe("interpretar: onde o quadro NÃO deve acertar", () => {
  const ler = (t: string, passo: string | null = "nome"): Intencao =>
    interpretar(t, passo, SEMENTES_DO_QUADRO).intencao;

  it("sim e não valem só na etapa do telefone: na primeira vez são ambíguos de propósito", () => {
    expect(ler("sim", "telefone")).toBe("sim");
    expect(ler("sim", "primeira_vez")).toBe("nao_sei");
    expect(ler("não", "primeira_vez")).toBe("nao_sei");
    expect(ler("sim", "cep")).toBe("nao_sei");
    expect(ler("sim", "nome")).toBe("nao_sei");
  });

  it("'não quero' sozinho é recusar no CEP e nada no nome; nunca é parar", () => {
    expect(ler("não quero", "cep")).toBe("recusar");
    expect(ler("não quero", "nome")).toBe("nao_sei");
    expect(ler("não quero", "telefone")).not.toBe("parar");
  });

  it("'para' só vale como mensagem inteira", () => {
    expect(ler("para")).toBe("parar");
    expect(ler("para quando fica pronto?")).not.toBe("parar");
    expect(ler("preciso para amanhã")).not.toBe("parar");
    expect(ler("pare")).toBe("parar");
    expect(ler("sair")).toBe("parar");
    expect(ler("quero sair mais cedo")).not.toBe("parar");
  });

  it("sim negado é descartado", () => {
    expect(ler("não, sim", "telefone")).not.toBe("sim");
    expect(ler("não sei se sim", "telefone")).not.toBe("sim");
  });

  it("frase de duas famílias diferentes é ambígua", () => {
    const r = interpretar("sim, mas quero mudar", "telefone", SEMENTES_DO_QUADRO);
    expect(r.intencao).toBe("nao_sei");
    expect(r.ambigua).toBe(true);
    expect(r.candidatas.sort()).toEqual(["mudar", "sim"]);
  });

  it("não e mudar são da mesma família: 'não, é outro' vira mudar", () => {
    expect(ler("não, é outro", "telefone")).toBe("mudar");
  });

  it("pedido de preço vence a confirmação: 'certo, quanto custa?'", () => {
    expect(ler("certo, quanto custa?", "telefone")).toBe("pergunta_preco");
  });

  it("parar vence tudo e falar com a equipe vence o preço", () => {
    expect(ler("quanto custa? pare de mandar mensagem")).toBe("parar");
    expect(ler("quanto custa? quero falar com uma pessoa")).toBe("falar_com_equipe");
  });

  it("cortesia não decide nada numa mensagem com conteúdo", () => {
    expect(ler("oi, quero um banner")).toBe("nao_sei");
    expect(ler("obrigado, quanto custa?")).toBe("pergunta_preco");
    expect(ler("bom dia, quero falar com atendente")).toBe("falar_com_equipe");
  });

  it("cumprimento na frente não atrapalha: 'oi, sim' no telefone é sim", () => {
    expect(ler("oi, sim", "telefone")).toBe("sim");
    expect(ler("Boa tarde! Pode registrar", "telefone")).toBe("sim");
  });

  it("a palavra de parceiro vale só em mensagem curta", () => {
    expect(ler("meu parceiro indicou vocês")).not.toBe("parceiro");
    expect(ler("queria uma parceria de marketing")).not.toBe("parceiro");
    expect(ler("preciso de nota fiscal de parceiro")).not.toBe("parceiro");
    expect(
      ler("tenho uma parceria antiga com a loja do meu primo e queria saber de um banner"),
    ).not.toBe("parceiro");
    expect(ler("parceria")).toBe("parceiro");
    expect(ler("Parceiro!")).toBe("parceiro");
    // vocativo com cumprimento não é pedido de parceria
    for (const f of ["oi parceiro", "oi, Parceria!", "e aí parceiro", "Boa tarde, parceiro!"])
      expect(ler(f), f).not.toBe("parceiro");
    for (const f of ["nao sou parceiro", "não quero ser parceiro", "sou parceiro de obra do João"])
      expect(ler(f), f).not.toBe("parceiro");
    expect(ler("quero ser parceiro")).toBe("parceiro");
  });

  it("revendedor nunca é parceiro, mas marca o termo sensível", () => {
    const r = interpretar("sou revendedor", "nome", SEMENTES_DO_QUADRO);
    expect(r.intencao).not.toBe("parceiro");
    expect(r.termoSensivel).toBe(true);
  });

  it("pergunta de tabela para parceiro ou revenda cai em pergunta de preço e marca o termo sensível", () => {
    const a = interpretar("vocês têm tabela para revenda?", "nome", SEMENTES_DO_QUADRO);
    expect(a.intencao).toBe("pergunta_preco");
    expect(a.termoSensivel).toBe(true);
    const b = interpretar("tem preço de parceiro?", "nome", SEMENTES_DO_QUADRO);
    expect(b.intencao).toBe("pergunta_preco");
    expect(b.termoSensivel).toBe(true);
  });

  it("texto vazio, número solto e papo sem relação são nao_sei", () => {
    expect(ler("")).toBe("nao_sei");
    expect(ler("   ")).toBe("nao_sei");
    expect(ler("12345")).toBe("nao_sei");
    expect(ler("Maria Souza")).toBe("nao_sei");
    expect(ler("pode ser o tamanho 2x1", "nome")).toBe("nao_sei");
  });

  it("linha inativa não conta e o quadro é dado injetado", () => {
    const quadro = [
      { passo: null, intencao: "sim" as const, frase: "bora la", casamento: "igual" as const },
    ];
    expect(interpretar("Bora lá!", null, quadro).intencao).toBe("sim");
    expect(interpretar("Bora lá!", null, [{ ...quadro[0], ativo: false }]).intencao).toBe(
      "nao_sei",
    );
    expect(interpretar("sim", null, quadro).intencao).toBe("nao_sei");
  });

  it("igual vence começa com", () => {
    const quadro = [
      { passo: null, intencao: "sim" as const, frase: "ok", casamento: "igual" as const },
      { passo: null, intencao: "nao" as const, frase: "ok", casamento: "comeca" as const },
    ];
    expect(interpretar("ok", null, quadro).intencao).toBe("sim");
    expect(interpretar("ok mas nao", null, quadro).intencao).toBe("nao");
  });
});
