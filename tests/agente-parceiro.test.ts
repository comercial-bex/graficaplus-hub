import { describe, expect, it } from "vitest";
import {
  FRASE_FIM, FRASE_MIDIA, FRASE_SAIR, FRASE_TRANSFERENCIA, FRASE_FORA_DO_HORARIO, LEMBRETE,
  iniciarAgente, minimoCompleto, responder, textoBloqueado, verificarSilencio, type EstadoDoAgente,
} from "../src/domain/whatsapp/agente-parceiro";
import { documentoValido, ufValida } from "../src/domain/parceiros/cadastro-rapido";

// Quarta-feira, 10h em Macapá (13h UTC): dentro do horário.
const HORARIO = new Date("2026-11-11T13:00:00Z");
const DOMINGO = new Date("2026-11-15T13:00:00Z");

function conversa(falas: string[], agora = HORARIO, tel = "5596991234567") {
  let { estado } = iniciarAgente(tel);
  let ultimo = { respostas: [] as string[], transferir: null as string | null, criarPreCadastro: false };
  const criados: boolean[] = [];
  for (const f of falas) {
    const r = responder(estado, { tipo: "texto", texto: f, agora });
    estado = r.estado; ultimo = r; criados.push(r.criarPreCadastro);
  }
  return { estado, ultimo, criados };
}

const COMPLETA = ["sim", "Ana Souza", "1", "ana@empresa.com.br", "Ana Brindes", "4", "Macapá/AP", "@anabrindes", "pular", "2", "sim"];

describe("agente de parceiros — roteiro", () => {
  it("cadastro completo chega à conferência e termina com a frase de envio", () => {
    const { estado } = conversa(COMPLETA);
    expect(estado.passo).toBe("conferencia");
    const r = responder(estado, { tipo: "texto", texto: "1", agora: HORARIO });
    expect(r.respostas).toEqual([FRASE_FIM]);
    expect(r.estado.situacao).toBe("enviado");
    expect(r.estado.ficha).toMatchObject({
      nome: "Ana Souza", telefoneCadastro: "96991234567", telefoneConfirmado: true, email: "ana@empresa.com.br",
      empresa: "Ana Brindes", ramo: "revendedor_brindes", cidade: "Macapá", uf: "AP",
      instagramOuSite: "https://instagram.com/anabrindes", documento: null, volume: "6_20", aceitaPromocoes: true,
    });
  });

  it("o pré-cadastro nasce exatamente quando o e-mail completa o mínimo", () => {
    const { criados, estado } = conversa(["sim", "Ana", "1", "ana@empresa.com.br"]);
    expect(criados).toEqual([false, false, false, true]);
    expect(minimoCompleto(estado.ficha)).toBe(true);
    expect(estado.situacao).toBe("minimo_completo");
  });

  it("passo 2 mostra o final do número da conversa", () => {
    const { ultimo } = conversa(["sim", "Ana"]);
    expect(ultimo.respostas[0]).toContain("final 4567");
  });

  it("passo 2 com 'sim' usa o número da conversa", () => {
    expect(conversa(["sim", "Ana", "sim"]).estado.ficha.telefoneCadastro).toBe("96991234567");
  });

  it("passo 2 com 2 pede outro número e aceita um válido", () => {
    const { estado } = conversa(["sim", "Ana", "2", "(96) 98888-7777"]);
    expect(estado.ficha).toMatchObject({ telefoneCadastro: "96988887777", telefoneConfirmado: false });
    expect(estado.passo).toBe("email");
  });

  it("número inválido no passo 2 pede de novo", () => {
    const { estado, ultimo } = conversa(["sim", "Ana", "2", "123"]);
    expect(estado.ficha.telefoneCadastro).toBeNull();
    expect(ultimo.respostas[0]).toContain("DDD");
  });

  it("e-mail com erro de digitação recebe sugestão e aceita 'sim'", () => {
    const { estado, ultimo } = conversa(["sim", "Ana", "1", "ana@gmai.com"]);
    expect(ultimo.respostas[0]).toContain("ana@gmail.com");
    const r = responder(estado, { tipo: "texto", texto: "sim", agora: HORARIO });
    expect(r.estado.ficha.email).toBe("ana@gmail.com");
  });

  it("várias respostas numa mensagem pulam passos já respondidos", () => {
    const { estado } = conversa(["sim", "Ana", "1", "ana@empresa.com.br @anabrindes"]);
    expect(estado.ficha.instagramOuSite).toBe("https://instagram.com/anabrindes");
    expect(estado.respondidos).toContain("instagram");
  });

  it("retoma do passo onde parou depois do silêncio", () => {
    const { estado } = conversa(["sim", "Ana", "1", "ana@empresa.com.br"]);
    const l1 = verificarSilencio(estado, 31 * 60_000);
    expect(l1.respostas).toEqual([LEMBRETE]);
    const l2 = verificarSilencio(l1.estado, 62 * 60_000);
    expect(l2.respostas).toEqual([]);
    expect(l2.estado.situacao).toBe("pausado");
    const r = responder(l2.estado, { tipo: "texto", texto: "Ana Brindes", agora: HORARIO });
    expect(r.estado.ficha.empresa).toBe("Ana Brindes");
    expect(r.estado.passo).toBe("ramo");
  });

  it("silêncio de menos de 30 min não manda lembrete", () => {
    const { estado } = conversa(["sim"]);
    expect(verificarSilencio(estado, 29 * 60_000).respostas).toEqual([]);
  });

  it.each([["1", "comunicacao_visual"], ["2", "agencia"], ["3", "designer"], ["4", "revendedor_brindes"]])("ramo %s vira %s", (n, ramo) => {
    expect(conversa(["sim", "Ana", "1", "ana@empresa.com.br", "não tenho", n]).estado.ficha.ramo).toBe(ramo);
  });

  it("ramo 5 pergunta qual e grava em ramo_outro", () => {
    const { estado } = conversa(["sim", "Ana", "1", "ana@empresa.com.br", "não tenho", "5", "Plotagem de veículos"]);
    expect(estado.ficha).toMatchObject({ ramo: "outro", ramoOutro: "Plotagem de veículos" });
  });

  it.each([["@ana.art", "https://instagram.com/ana.art"], ["www.ana.com.br", "https://www.ana.com.br"], ["não tenho", null]])("instagram/site '%s'", (t, esperado) => {
    const base = ["sim", "Ana", "1", "ana@empresa.com.br", "não tenho", "3", "Macapá/AP", t];
    const { estado } = conversa(base);
    expect(estado.ficha.instagramOuSite).toBe(esperado);
    expect(estado.passo).toBe("documento");
  });

  it.each([["1", "ate_5"], ["2", "6_20"], ["3", "mais_20"]])("volume %s vira %s", (n, v) => {
    const { estado } = conversa(["sim", "Ana", "1", "ana@empresa.com.br", "não tenho", "3", "pular", "não tenho", "pular", n]);
    expect(estado.ficha.volume).toBe(v);
  });

  it("promoções 'não' fica gravado com data e hora", () => {
    const { estado } = conversa([...COMPLETA.slice(0, -1), "não"]);
    expect(estado.ficha.aceitaPromocoes).toBe(false);
    expect(estado.ficha.aceitePromocoesEm).toBe(HORARIO.toISOString());
  });

  it("corrigir no resumo volta só no campo escolhido e retorna à conferência", () => {
    const { estado } = conversa([...COMPLETA, "2", "email", "novo@empresa.com.br"]);
    expect(estado.ficha.email).toBe("novo@empresa.com.br");
    expect(estado.passo).toBe("conferencia");
    expect(estado.ficha.empresa).toBe("Ana Brindes");
  });
});

describe("agente de parceiros — saídas e travas", () => {
  it.each(["consentimento", "nome", "email"])("SAIR funciona em qualquer passo (%s)", (_p) => {
    const falas = { consentimento: [], nome: ["sim"], email: ["sim", "Ana", "1"] }[_p as "nome"] as string[];
    const { estado, ultimo } = conversa([...falas, "SAIR"]);
    expect(estado.situacao).toBe("saiu");
    expect(ultimo.respostas).toEqual([FRASE_SAIR]);
  });

  it("pedir atendente transfere", () => {
    const { ultimo } = conversa(["sim", "quero falar com um atendente"]);
    expect(ultimo.transferir).toBe("pediu_atendente");
    expect(ultimo.respostas).toEqual([FRASE_TRANSFERENCIA]);
  });

  it.each(["qual o preço?", "tem desconto?", "qual o prazo de entrega?", "aceita pix?", "tenho crédito?"])("'%s' transfere para a equipe", (t) => {
    expect(conversa(["sim", t]).ultimo.transferir).toBe("assunto_da_equipe");
  });

  it("áudio ou imagem transfere com a frase de recebimento", () => {
    const { estado } = iniciarAgente("5596991234567");
    const r = responder(estado, { tipo: "midia", agora: HORARIO });
    expect(r.respostas).toEqual([FRASE_MIDIA]);
    expect(r.transferir).toBe("midia");
  });

  it("duas respostas ininteligíveis seguidas transferem", () => {
    const { ultimo, estado } = conversa(["sim", "Ana", "xyz", "abc"]);
    expect(ultimo.transferir).toBe("ininteligivel");
    expect(estado.situacao).toBe("transferido");
  });

  it("uma resposta inválida seguida de uma válida não transfere", () => {
    expect(conversa(["sim", "Ana", "xyz", "1", "lixo", "ana@empresa.com.br"]).estado.situacao).toBe("minimo_completo");
  });

  it("depois de transferida, o agente não responde mais", () => {
    const { estado } = conversa(["sim", "qual o preço?"]);
    expect(responder(estado, { tipo: "texto", texto: "Ana", agora: HORARIO }).respostas).toEqual([]);
  });

  it("fora do horário continua coletando e avisa uma única vez", () => {
    const { estado } = iniciarAgente("5596991234567");
    const r1 = responder(estado, { tipo: "texto", texto: "sim", agora: DOMINGO });
    expect(r1.respostas[0]).toBe(FRASE_FORA_DO_HORARIO);
    expect(r1.estado.passo).toBe("nome");
    const r2 = responder(r1.estado, { tipo: "texto", texto: "Ana", agora: DOMINGO });
    expect(r2.respostas).not.toContain(FRASE_FORA_DO_HORARIO);
    expect(r2.estado.ficha.nome).toBe("Ana");
  });

  it.each(["custa R$ 50", "10% off", "fica pronto 12/11", "tem desconto"])("bloqueia resposta com '%s'", (t) => {
    expect(textoBloqueado(t)).toBe(true);
  });

  it("nenhuma pergunta fixa do roteiro dispara o bloqueio", () => {
    let estado: EstadoDoAgente = iniciarAgente("5596991234567").estado;
    for (const f of COMPLETA) {
      const r = responder(estado, { tipo: "texto", texto: f, agora: HORARIO });
      expect(r.transferir).toBeNull();
      estado = r.estado;
    }
  });
});

describe("validações novas do cadastro", () => {
  it.each([["529.982.247-25", true], ["111.111.111-11", false], ["529.982.247-24", false], ["11.222.333/0001-81", true], ["11.222.333/0001-80", false]])("documento %s → %s", (d, ok) => {
    expect(documentoValido(d)).toBe(ok);
  });
  it("UF", () => { expect(ufValida("ap")).toBe(true); expect(ufValida("XX")).toBe(false); });
});
