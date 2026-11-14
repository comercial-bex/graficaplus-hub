import { describe, expect, it } from "vitest";
import {
  AVISO_DA_CHAVE_ANTIGA,
  AVISO_DA_PORCENTAGEM_MAXIMA,
  avisoDeConfirmacaoDoAgente,
  avisosDaBase,
  CODIGOS_DE_ENTREGA,
  CODIGOS_DE_SILENCIO,
  coberturaDaBase,
  confirmacaoDeAumentarAPorcentagem,
  contadorDoRamo,
  EXPLICACAO_DO_DEGRAU_DO_AGENTE,
  MINIMO_DE_RESPOSTAS_POR_RAMO,
  motivoDeDesligarOAgente,
  motivoDoRastroEmTexto,
  motivoEmTexto,
  PORCENTAGEM_MAXIMA_EM_PARCIAL,
  podeSubirOAgente,
  porcentagemCabeNoDegrau,
  seloDoAgente,
  simularAgente,
  textoDoBotaoDeSubirOAgente,
} from "../../src/domain/agente";
import { DEGRAUS, type Degrau } from "../../src/domain/whatsapp/triagem/escada";
import { compilarTermosDoBanco } from "../../src/domain/whatsapp/triagem/verificador";
import {
  basePadrao,
  QUADRO,
  resposta,
  TEXTO_DA_EQUIPE,
  TEXTO_DO_HORARIO,
  TEXTO_DO_VALOR,
} from "./montar";

/**
 * O painel e o simulador do agente (C4), só a parte pura: a conta das respostas aprovadas, o que falta para subir um degrau
 * e a simulação, que usa a MESMA função de decisão do servidor. Nenhum teste aqui fala com banco, rede ou WhatsApp.
 */

const SEM_BASE = coberturaDaBase([]);
const COM_BASE = coberturaDaBase(basePadrao());

function simular(
  pergunta: string,
  o: {
    ramo?: "cliente" | "parceiro";
    jaPerguntouPreco?: boolean;
    base?: ReturnType<typeof basePadrao>;
  } = {},
) {
  return simularAgente(
    { pergunta, ramo: o.ramo ?? "cliente", jaPerguntouPreco: o.jaPerguntouPreco ?? false },
    o.base ?? basePadrao(),
    QUADRO,
  );
}

describe("a conta das respostas aprovadas", () => {
  it("o mínimo é 15 por ramo e o contador diz sempre de quantas", () => {
    expect(MINIMO_DE_RESPOSTAS_POR_RAMO).toBe(15);
    expect(contadorDoRamo(COM_BASE.porRamo[0])).toBe("Cliente final: 4 de 15 aprovadas");
    expect(contadorDoRamo(COM_BASE.porRamo[1])).toBe("Parceiro: 0 de 15 aprovadas");
  });

  it("só conta a que o agente PODE mandar: aprovada, com o texto aprovado igual ao atual", () => {
    const base = [
      ...basePadrao(),
      resposta({
        id: "rasc",
        status: "rascunho",
        frases_gatilho: ["a"],
        texto_aprovado: undefined,
        resposta: "Rascunho.",
      }),
      // aprovada e depois alguém mudou a resposta sem reaprovar: o banco devolve a linha a rascunho, mas se vier assim não serve
      {
        ...resposta({ id: "mudou", frases_gatilho: ["b"] }),
        resposta: "Texto novo que o dono não leu.",
      },
    ];
    const c = coberturaDaBase(base);
    expect(c.aprovadasNoTotal).toBe(4);
    expect(c.rascunhosNoTotal).toBe(1);
    expect(c.porRamo[0].rascunhos).toBe(1);
  });

  it("resposta dos dois ramos conta nos dois e UMA vez no total", () => {
    const base = [resposta({ id: "x", ramos: ["cliente", "parceiro"], frases_gatilho: ["x"] })];
    const c = coberturaDaBase(base);
    expect(c.porRamo.map((r) => r.aprovadas)).toEqual([1, 1]);
    expect(c.aprovadasNoTotal).toBe(1);
  });

  it("completo só com 15 em cada ramo", () => {
    const quinze = (ramo: "cliente" | "parceiro") =>
      Array.from({ length: 15 }, (_, i) =>
        resposta({ id: `${ramo}${i}`, ramos: [ramo], frases_gatilho: [`f${ramo}${i}`] }),
      );
    expect(coberturaDaBase(quinze("cliente")).algumRamoAbaixo).toBe(true);
    const todas = coberturaDaBase([...quinze("cliente"), ...quinze("parceiro")]);
    expect(todas.algumRamoAbaixo).toBe(false);
    expect(todas.porRamo.every((r) => r.completo && r.faltam === 0)).toBe(true);
    expect(avisosDaBase(todas).filter((a) => /aprovadas/.test(a))).toEqual([]);
  });

  it("o aviso diz o que acontece: zero aprovada passa tudo para a equipe, e conta quantas faltam", () => {
    const zero = avisosDaBase(SEM_BASE);
    expect(zero).toHaveLength(2);
    expect(zero[0]).toMatch(
      /Cliente final não tem nenhuma resposta aprovada.*para a equipe.*15 no mínimo/,
    );
    const alguma = avisosDaBase(COM_BASE);
    expect(alguma.some((a) => /Cliente final tem só 4 de 15.*Faltam 11/.test(a))).toBe(true);
    expect(alguma.some((a) => /Parceiro não tem nenhuma/.test(a))).toBe(true);
  });

  it("avisa quando um ramo com respostas não tem a de valor: toda pergunta de preço iria à equipe sem resposta", () => {
    const semValor = basePadrao().filter((r) => r.tema !== "valor_do_produto");
    const avisos = avisosDaBase(coberturaDaBase(semValor));
    expect(
      avisos.some((a) =>
        /Cliente final não tem a resposta aprovada de que a equipe confirma o valor/.test(a),
      ),
    ).toBe(true);
    expect(avisosDaBase(COM_BASE).some((a) => /confirma o valor/.test(a))).toBe(false);
  });
});

describe("o que falta para subir um degrau", () => {
  const sit = (atual: Degrau, o: Partial<Parameters<typeof podeSubirOAgente>[0]> = {}) =>
    podeSubirOAgente({ atual, percentual: 0, numerosDeTeste: [], cobertura: COM_BASE, ...o });

  it("desligada sobe para ensaio mesmo com a base vazia: é o ensaio que mostra o que falta escrever", () => {
    const r = sit("desligada", { cobertura: SEM_BASE });
    expect(r).toMatchObject({ pode: true, para: "ensaio" });
  });

  it("BLOQUEIA subir para teste com ZERO respostas aprovadas, com o motivo em palavras", () => {
    const r = sit("ensaio", { cobertura: SEM_BASE, numerosDeTeste: ["5596991112233"] });
    expect(r.pode).toBe(false);
    if (!r.pode) {
      expect(r.para).toBe("teste");
      expect(r.motivo).toMatch(/Nenhuma resposta está aprovada/);
    }
  });

  it("teste pede número de teste; parcial pede porcentagem; ligada não pede nada além da base", () => {
    expect(sit("ensaio")).toMatchObject({ pode: false, para: "teste" });
    expect(sit("ensaio", { numerosDeTeste: ["5596991112233"] })).toMatchObject({
      pode: true,
      para: "teste",
    });
    expect(sit("teste", { numerosDeTeste: ["5596991112233"] })).toMatchObject({
      pode: false,
      para: "parcial",
    });
    expect(sit("teste", { percentual: 10 })).toMatchObject({ pode: true, para: "parcial" });
    expect(sit("parcial", { percentual: 10 })).toMatchObject({ pode: true, para: "ligada" });
    expect(sit("ligada")).toMatchObject({ pode: false, para: null });
  });

  it("subir com a base abaixo do mínimo PODE, mas leva os avisos junto", () => {
    const r = sit("ensaio", { numerosDeTeste: ["5596991112233"] });
    expect(r.pode).toBe(true);
    if (r.pode) expect(r.avisos.length).toBeGreaterThan(0);
  });

  it("zero aprovada bloqueia também parcial e ligada, não só teste", () => {
    expect(sit("teste", { cobertura: SEM_BASE, percentual: 10 }).pode).toBe(false);
    expect(sit("parcial", { cobertura: SEM_BASE, percentual: 10 }).pode).toBe(false);
  });

  it("os textos dos degraus existem para os cinco, e a confirmação só para os que falam de verdade", () => {
    for (const d of DEGRAUS) expect(EXPLICACAO_DO_DEGRAU_DO_AGENTE[d].length).toBeGreaterThan(20);
    expect(avisoDeConfirmacaoDoAgente("ensaio", 0)).toBeNull();
    expect(avisoDeConfirmacaoDoAgente("teste", 0)).toMatch(/só para os números de teste/);
    expect(avisoDeConfirmacaoDoAgente("parcial", 25)).toMatch(/25 de cada 100/);
    expect(avisoDeConfirmacaoDoAgente("ligada", 0)).toMatch(/todo contato/);
    expect(textoDoBotaoDeSubirOAgente("desligada")).toBe("Subir para ensaio");
    expect(textoDoBotaoDeSubirOAgente("ligada")).toBe("Já está no último degrau");
  });

  it("a chave antiga de texto livre ligada BLOQUEIA qualquer subida, com a frase em palavras", () => {
    for (const atual of ["desligada", "ensaio", "teste", "parcial"] as const) {
      const r = sit(atual, {
        chaveAntigaLigada: true,
        percentual: 10,
        numerosDeTeste: ["5596991112233"],
      });
      expect(r, atual).toMatchObject({ pode: false, motivo: AVISO_DA_CHAVE_ANTIGA });
    }
    // desligada a chave, o mesmo passo sobe
    expect(sit("desligada", { chaveAntigaLigada: false }).pode).toBe(true);
    expect(sit("desligada").pode).toBe(true);
    expect(AVISO_DA_CHAVE_ANTIGA).toMatch(/Desligue essa chave antes de subir o agente/);
  });

  it("subir para parcial com a porcentagem acima de 50 é bloqueado: 100 é o degrau ligada", () => {
    const r = sit("teste", { percentual: 80, numerosDeTeste: ["5596991112233"] });
    expect(r).toMatchObject({ pode: false, para: "parcial", motivo: AVISO_DA_PORCENTAGEM_MAXIMA });
    expect(
      sit("teste", { percentual: PORCENTAGEM_MAXIMA_EM_PARCIAL, numerosDeTeste: ["5596991112233"] })
        .pode,
    ).toBe(true);
  });

  it("a porcentagem cabe no degrau: em parcial até 50, nos outros até 100; inteiro e sem passar", () => {
    expect(porcentagemCabeNoDegrau("parcial", 50)).toBe(true);
    expect(porcentagemCabeNoDegrau("parcial", 51)).toBe(false);
    expect(porcentagemCabeNoDegrau("parcial", 100)).toBe(false);
    expect(porcentagemCabeNoDegrau("teste", 100)).toBe(true);
    expect(porcentagemCabeNoDegrau("teste", 101)).toBe(false);
    expect(porcentagemCabeNoDegrau("parcial", -1)).toBe(false);
    expect(porcentagemCabeNoDegrau("parcial", 2.5)).toBe(false);
  });

  it("aumentar a porcentagem em parcial pede confirmação em palavras; diminuir e outros degraus não", () => {
    const c = confirmacaoDeAumentarAPorcentagem("parcial", 10, 30);
    expect(c).toMatch(/de 10 para 30/);
    expect(c).not.toMatch(/[—–―→←⇒()]/);
    expect(confirmacaoDeAumentarAPorcentagem("parcial", 30, 10)).toBeNull();
    expect(confirmacaoDeAumentarAPorcentagem("parcial", 10, 10)).toBeNull();
    expect(confirmacaoDeAumentarAPorcentagem("teste", 10, 30)).toBeNull();
  });

  it("o motivo de estar desligado vira palavras", () => {
    expect(motivoDeDesligarOAgente(null)).toBe("Ainda não foi ligado.");
    expect(motivoDeDesligarOAgente("botao_desligar_tudo")).toMatch(/botão Desligar tudo/);
    expect(motivoDeDesligarOAgente("freio_falhas_de_envio")).toMatch(/falhas seguidas/);
    expect(motivoDeDesligarOAgente("outra_coisa")).toBe("Desligado. Motivo: outra coisa.");
  });
});

describe("o simulador usa a decisão de verdade e só mostra resposta aprovada", () => {
  it("pergunta que a base conhece: mostra a resposta aprovada, palavra por palavra", () => {
    const r = simular("que horas abre?");
    expect(r.desfecho).toBe("responderia");
    expect(r.resposta?.texto).toBe(TEXTO_DO_HORARIO);
    expect(r.resposta?.tema).toBe("horario_de_atendimento");
    expect(r.motivo).toBeNull();
  });

  it("pergunta de preço: só a resposta de que a equipe confirma, e diz isso", () => {
    const r = simular("quanto custa um banner?");
    expect(r.desfecho).toBe("responderia");
    expect(r.resposta?.texto).toBe(TEXTO_DO_VALOR);
    expect(r.resposta?.ehPreco).toBe(true);
    expect(r.explicacao).toMatch(/a equipe confirma o valor/);
  });

  it("a segunda pergunta de preço entrega à equipe", () => {
    const r = simular("quanto custa um banner?", { jaPerguntouPreco: true });
    expect(r.desfecho).toBe("entregaria");
    expect(r.motivo).toBe("preco_de_novo");
    expect(r.resposta).toBeNull();
  });

  it("pergunta sem resposta aprovada entrega à equipe e diz que talvez falte escrever", () => {
    const r = simular("voces fazem adesivo de parede?");
    expect(r).toMatchObject({ desfecho: "entregaria", motivo: "sem_resposta" });
    expect(r.explicacao).toMatch(/falte escrever/);
  });

  it("resposta em rascunho NUNCA é escolhida, mesmo que a frase case", () => {
    const base = [
      ...basePadrao().filter((r) => r.tema !== "horario_de_atendimento"),
      resposta({
        id: "h2",
        tema: "horario_de_atendimento",
        status: "rascunho",
        texto_aprovado: undefined,
        resposta: "Rascunho.",
        frases_gatilho: ["que horas abre"],
      }),
    ];
    // o rascunho não tem texto aprovado, mas `resposta` existe: o simulador precisa recusar mesmo assim
    const r = simular("que horas abre?", {
      base: base.map((x) => (x.id === "h2" ? { ...x, texto_aprovado: null } : x)),
    });
    expect(r).toMatchObject({ desfecho: "entregaria", motivo: "sem_resposta" });
  });

  it("o ramo importa: resposta só do cliente não serve ao parceiro", () => {
    expect(simular("que horas abre?", { ramo: "parceiro" })).toMatchObject({
      desfecho: "entregaria",
      motivo: "sem_resposta",
    });
    const base = basePadrao().map((r) => ({
      ...r,
      ramos: ["cliente", "parceiro"] as ("cliente" | "parceiro")[],
    }));
    expect(simular("que horas abre?", { ramo: "parceiro", base }).desfecho).toBe("responderia");
  });

  it("cumprimento fica em silêncio, 'parar' para, reclamação entrega", () => {
    expect(simular("obrigado!")).toMatchObject({ desfecho: "silencio", motivo: "cortesia" });
    expect(simular("parar")).toMatchObject({ desfecho: "pararia", motivo: "parar" });
    expect(simular("isso é um absurdo, quero reclamar")).toMatchObject({
      desfecho: "entregaria",
      motivo: "reclamou",
    });
  });

  it("falar com uma pessoa: manda a resposta aprovada e passa a conversa para a equipe", () => {
    const r = simular("quero falar com uma pessoa");
    expect(r.desfecho).toBe("responderia");
    expect(r.resposta?.texto).toBe(TEXTO_DA_EQUIPE);
    expect(r.resposta?.passaParaEquipe).toBe(true);
    expect(r.titulo).toMatch(/passaria para a equipe/);
  });

  it("empate exato entre duas respostas entrega, sem sorteio", () => {
    const base = [
      resposta({ id: "a", tema: "tema_a", frases_gatilho: ["prazo de entrega"] }),
      resposta({ id: "b", tema: "tema_b", frases_gatilho: ["prazo de entrega"] }),
    ];
    expect(simular("qual o prazo de entrega?", { base })).toMatchObject({
      desfecho: "entregaria",
      motivo: "empate",
    });
  });

  it("base vazia: toda pergunta entregaria à equipe, e nunca inventa texto", () => {
    for (const p of ["quanto custa?", "que horas abre?", "oi, tudo bem?"]) {
      const r = simular(p, { base: [] });
      expect(r.resposta).toBeNull();
    }
    expect(simular("que horas abre?", { base: [] }).motivo).toBe("sem_resposta");
  });

  it("o texto mostrado nunca é diferente do aprovado, em nenhuma pergunta", () => {
    const aprovados = new Set(basePadrao().map((r) => r.texto_aprovado));
    for (const p of [
      "quanto custa",
      "qual o valor do banner 2x1",
      "preço",
      "horario",
      "que horas abre",
      "falar com atendente",
      "qual medida",
      "que medida usar",
      "voces entregam?",
      "oi",
      "bom dia, quanto custa o cartão?",
    ]) {
      const r = simular(p);
      if (r.resposta) expect(aprovados.has(r.resposta.texto)).toBe(true);
    }
  });

  it("resposta com termo proibido que o dono acrescentou é barrada na conferência final e entrega", () => {
    const base = [
      resposta({
        id: "p",
        tema: "tema_p",
        frases_gatilho: ["lancamento"],
        texto_aprovado: "Temos uma novidade hoje.",
      }),
    ];
    const entrada = {
      pergunta: "tem lancamento novo?",
      ramo: "cliente" as const,
      jaPerguntouPreco: false,
    };
    expect(simularAgente(entrada, base, QUADRO).desfecho).toBe("responderia");
    const termos = compilarTermosDoBanco([
      {
        regra: "novidade_proibida",
        termo: "novidade",
        tipo: "trecho",
        sobre: "plano",
        ramo: "todos",
        ativo: true,
      },
    ]).regras;
    expect(termos).toHaveLength(1);
    const r = simularAgente(entrada, base, QUADRO, termos);
    expect(r).toMatchObject({ desfecho: "entregaria", motivo: "texto_reprovado", resposta: null });
  });
});

describe("todo motivo tem texto, e o texto é do dono: sem travessão, seta nem parênteses", () => {
  it("cada motivo de entrega e de silêncio tem frase própria", () => {
    for (const c of [...CODIGOS_DE_ENTREGA, ...CODIGOS_DE_SILENCIO]) {
      expect(motivoEmTexto(c), c).not.toBe(c.replace(/_/g, " "));
      expect(motivoEmTexto(c).length, c).toBeGreaterThan(15);
    }
    expect(motivoDoRastroEmTexto("passou_com_a_resposta")).toMatch(
      /passou a conversa para a equipe/,
    );
  });

  it("rajada e freio de volume são motivos de ENTREGA, nunca de silêncio, e resposta_em_andamento deixou de existir", () => {
    expect(CODIGOS_DE_ENTREGA).toEqual(expect.arrayContaining(["rajada", "freio_de_volume"]));
    expect(CODIGOS_DE_SILENCIO).not.toContain("rajada");
    expect(CODIGOS_DE_SILENCIO).not.toContain("freio_de_volume");
    expect(CODIGOS_DE_SILENCIO).not.toContain("resposta_em_andamento");
    expect(CODIGOS_DE_ENTREGA).not.toContain("resposta_em_andamento");
    expect(motivoEmTexto("rajada")).toMatch(/entrega à equipe/);
    expect(motivoEmTexto("freio_de_volume")).toMatch(/entrega a conversa à equipe/);
  });

  it("código que o agente não conhece volta escrito sem sublinhado, nunca vazio", () => {
    expect(motivoEmTexto("motivo_novo_qualquer")).toBe("motivo novo qualquer");
  });

  it("nenhum texto de tela tem travessão, seta ou parênteses, nem a palavra do mercado que o dono não usa", () => {
    const textos = [
      ...CODIGOS_DE_ENTREGA.map(motivoEmTexto),
      ...CODIGOS_DE_SILENCIO.map(motivoEmTexto),
      motivoDoRastroEmTexto("passou_com_a_resposta"),
      ...Object.values(EXPLICACAO_DO_DEGRAU_DO_AGENTE),
      ...avisosDaBase(SEM_BASE),
      ...avisosDaBase(COM_BASE),
      avisoDeConfirmacaoDoAgente("teste", 0) ?? "",
      avisoDeConfirmacaoDoAgente("parcial", 10) ?? "",
      avisoDeConfirmacaoDoAgente("ligada", 0) ?? "",
      AVISO_DA_CHAVE_ANTIGA,
      AVISO_DA_PORCENTAGEM_MAXIMA,
      confirmacaoDeAumentarAPorcentagem("parcial", 10, 30) ?? "",
      seloDoAgente({ respostas: 1, entregou: false })!.explicacao,
      seloDoAgente({ respostas: 1, entregou: true })!.explicacao,
      seloDoAgente({ respostas: 0, entregou: true })!.explicacao,
      motivoDeDesligarOAgente("botao_desligar_tudo"),
      motivoDeDesligarOAgente("freio_erros_de_leitura"),
      contadorDoRamo(COM_BASE.porRamo[0]),
    ];
    for (const t of textos) {
      expect(t).not.toMatch(/[—–―→←⇒()]/);
      expect(t).not.toMatch(/revend/i);
    }
  });
});
