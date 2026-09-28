import { describe, expect, it } from "vitest";
import {
  lerRespostaZapi,
  montarBotoes,
  montarEnvio,
  renderizarTemplate,
  telefoneParaZapi,
  valeTentarDeNovo,
} from "../src/domain/whatsapp/zapi-envio";

const CRED = { instanceId: "3ABC", token: "TOK" };

describe("o telefone que o Z-API quer", () => {
  /**
   * `chaveWhatsApp` TIRA o 55 — ela existe para reconhecer a mesma pessoa
   * entre cliente, lead e conversa. O Z-API quer o contrário. Trocar os dois
   * faz TODA mensagem falhar com "número inválido", e é o tipo de erro que só
   * apareceria em produção.
   */
  it("acrescenta o código do país", () => {
    expect(telefoneParaZapi("(96) 98121-6527")).toBe("5596981216527");
    expect(telefoneParaZapi("96981216527")).toBe("5596981216527");
  });

  it("não duplica o 55 de quem já mandou com ele", () => {
    expect(telefoneParaZapi("+55 96 98121-6527")).toBe("5596981216527");
    expect(telefoneParaZapi("5596981216527")).toBe("5596981216527");
  });

  it("recusa fixo e dois números colados, como o cadastro do cliente", () => {
    expect(telefoneParaZapi("96 3222-1234")).toBeNull();
    expect(telefoneParaZapi("96 99131-8834 / 96 98140-8722")).toBeNull();
    expect(telefoneParaZapi("")).toBeNull();
    expect(telefoneParaZapi(null)).toBeNull();
  });
});

describe("montar a chamada", () => {
  it("texto vai para send-text", () => {
    const r = montarEnvio({ tipo: "texto", para: "96981216527", texto: "oi" }, CRED);
    expect(r).toEqual({
      url: "https://api.z-api.io/instances/3ABC/token/TOK/send-text",
      corpo: { phone: "5596981216527", message: "oi" },
    });
  });

  it("pdf vai para send-document/pdf com nome de arquivo", () => {
    const r = montarEnvio(
      { tipo: "pdf", para: "96981216527", documento: "https://x/y.pdf", nomeArquivo: "Orçamento 39.pdf" },
      CRED,
    ) as any;
    expect(r.url).toBe("https://api.z-api.io/instances/3ABC/token/TOK/send-document/pdf");
    expect(r.corpo.fileName).toBe("Orçamento 39.pdf");
    expect(r.corpo.document).toBe("https://x/y.pdf");
  });

  it("recusa antes de gastar uma chamada: destino ruim, texto vazio, pdf sem arquivo", () => {
    expect(montarEnvio({ tipo: "texto", para: "96 3222-1234", texto: "oi" }, CRED)).toHaveProperty("erro");
    expect(montarEnvio({ tipo: "texto", para: "96981216527", texto: "   " }, CRED)).toHaveProperty("erro");
    expect(montarEnvio({ tipo: "pdf", para: "96981216527" }, CRED)).toHaveProperty("erro");
  });

  it("recusa quando o servidor está sem token", () => {
    const r = montarEnvio({ tipo: "texto", para: "96981216527", texto: "oi" }, { instanceId: "3ABC", token: "" });
    expect(r).toHaveProperty("erro");
  });
});

describe("ler a resposta", () => {
  it("sucesso é messageId, não só o HTTP 200", () => {
    expect(lerRespostaZapi(200, { messageId: "ABC" })).toEqual({ ok: true, idExterno: "ABC" });
  });

  it("200 sem messageId não é sucesso", () => {
    // O Z-API às vezes devolve 200 com erro no corpo — olhar só o status
    // marcaria como enviada uma mensagem que não saiu.
    expect(lerRespostaZapi(200, { error: "phone not exists" })).toEqual({
      ok: false,
      erro: "phone not exists",
    });
    expect(lerRespostaZapi(200, {})).toEqual({ ok: false, erro: "o Z-API respondeu sem messageId" });
  });

  it("erro de HTTP sem corpo vira o próprio status", () => {
    expect(lerRespostaZapi(500, null)).toEqual({ ok: false, erro: "HTTP 500" });
  });
});

describe("vale tentar de novo?", () => {
  it("número inválido e token errado não melhoram repetindo", () => {
    expect(valeTentarDeNovo("phone not exists")).toBe(false);
    expect(valeTentarDeNovo("Número inválido")).toBe(false);
    expect(valeTentarDeNovo("unauthorized")).toBe(false);
    expect(valeTentarDeNovo("invalid token")).toBe(false);
  });

  it("rede e limite de taxa, sim", () => {
    expect(valeTentarDeNovo("fetch failed")).toBe(true);
    expect(valeTentarDeNovo("HTTP 429")).toBe(true);
    expect(valeTentarDeNovo("HTTP 500")).toBe(true);
  });
});

describe("renderizar o modelo da mensagem", () => {
  /**
   * Os seis modelos existem desde agosto, bem escritos. O que nunca existiu
   * foi quem trocasse `{{cliente}}` pelo nome e mandasse.
   */
  const PRODUCAO =
    "Boa notícia, {{cliente}}: o pedido {{os_numero}} ({{os_titulo}}) entrou em produção. Previsão de entrega: {{prazo}}.";

  it("troca todas as chaves", () => {
    expect(
      renderizarTemplate(PRODUCAO, {
        cliente: "Max Lima",
        os_numero: 44,
        os_titulo: "Banner 2×1",
        prazo: "30/09",
      }),
    ).toBe("Boa notícia, Max Lima: o pedido 44 (Banner 2×1) entrou em produção. Previsão de entrega: 30/09.");
  });

  it("variável ausente não vira {{prazo}} cru no WhatsApp do cliente", () => {
    const r = renderizarTemplate(PRODUCAO, { cliente: "Max", os_numero: 44, os_titulo: "Banner" });
    expect(r).not.toContain("{{");
    expect(r).toBe("Boa notícia, Max: o pedido 44 (Banner) entrou em produção. Previsão de entrega.");
  });

  it("título vazio não deixa parênteses sozinhos", () => {
    const r = renderizarTemplate(PRODUCAO, { cliente: "Max", os_numero: 44, prazo: "30/09" });
    expect(r).not.toContain("()");
    expect(r).toContain("o pedido 44 entrou em produção");
  });

  it("sem variável nenhuma ainda produz frase legível", () => {
    const r = renderizarTemplate(PRODUCAO, null);
    expect(r).not.toContain("{{");
    expect(r.length).toBeGreaterThan(10);
  });
});

describe("botões de resposta", () => {
  it("monta o send-button-list", () => {
    const r = montarBotoes(
      {
        para: "96981216527",
        texto: "A arte do pedido 44 está pronta.",
        botoes: [
          { id: "aprovar", rotulo: "Aprovar" },
          { id: "ajuste", rotulo: "Pedir ajuste" },
        ],
      },
      CRED,
    ) as any;
    expect(r.url).toContain("/send-button-list");
    expect(r.corpo.buttonList.buttons).toHaveLength(2);
    expect(r.corpo.phone).toBe("5596981216527");
  });

  it("corta no terceiro botão — mais que isso o Z-API recusa a chamada inteira", () => {
    const r = montarBotoes(
      {
        para: "96981216527",
        texto: "oi",
        botoes: [1, 2, 3, 4, 5].map((n) => ({ id: `b${n}`, rotulo: `Botão ${n}` })),
      },
      CRED,
    ) as any;
    expect(r.corpo.buttonList.buttons).toHaveLength(3);
  });

  it("recusa sem botão e com destino ruim", () => {
    expect(montarBotoes({ para: "96981216527", texto: "oi", botoes: [] }, CRED)).toHaveProperty("erro");
    expect(montarBotoes({ para: "96 3222-1234", texto: "oi", botoes: [{ id: "a", rotulo: "A" }] }, CRED))
      .toHaveProperty("erro");
  });
});
