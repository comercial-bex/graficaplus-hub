import { describe, expect, it } from "vitest";
import {
  ESQUEMA_DA_FICHA,
  INSTRUCAO_DA_LEITURA,
  MODELO_ANTHROPIC_PADRAO,
  MODELO_OPENAI_PADRAO,
  NOME_DA_FERRAMENTA,
  argumentosDaResposta,
  faltaSaldo,
  motorDaFicha,
  pedidoParaAnthropic,
  pedidoParaOProvedor,
  pedidoParaOpenAi,
  type Motor,
} from "@/domain/trofeus/ficha-ia";
import { normalizarFichaDaIa } from "@/domain/trofeus/ficha-lida";

/**
 * A leitura da ficha pela IA, sem rede (22/11/2026). Travam-se: (1) o motor é a chave da AGÊNCIA, Claude primeiro e depois
 * OpenAI, e NUNCA o saldo do Lovable; (2) o pedido leva a imagem e a ferramenta forçada, e a chave só vai no cabeçalho;
 * (3) a resposta é lida pela ferramenta certa dos dois provedores; (4) a instrução trata o texto da imagem como dado.
 */

const IMAGEM = { tipo: "image/jpeg" as const, base64: "A".repeat(400) };
const CLAUDE: Extract<Motor, { provedor: "anthropic" }> = { provedor: "anthropic", chave: "sk-ant-segredo", modelo: "claude-sonnet-5-5" };
const OPENAI: Extract<Motor, { provedor: "openai" }> = { provedor: "openai", chave: "sk-openai-segredo", modelo: "gpt-5-mini" };

describe("o motor é a chave da agência", () => {
  it("Claude primeiro, OpenAI depois, e nada mais", () => {
    expect(motorDaFicha({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })).toMatchObject({ provedor: "anthropic", chave: "a" });
    expect(motorDaFicha({ OPENAI_API_KEY: "o" })).toMatchObject({ provedor: "openai", chave: "o" });
    expect(motorDaFicha({})).toBeNull();
    expect(motorDaFicha({ ANTHROPIC_API_KEY: "  ", OPENAI_API_KEY: "" })).toBeNull();
  });

  it("NUNCA usa o saldo do Lovable: só com a chave do Lovable não há motor", () => {
    expect(motorDaFicha({ LOVABLE_API_KEY: "lovable" })).toBeNull();
    expect(motorDaFicha({ LOVABLE_API_KEY: "lovable", OPENAI_API_KEY: "o" })).toMatchObject({ provedor: "openai" });
  });

  it("os modelos têm padrão e podem ser trocados por variável de ambiente", () => {
    expect(motorDaFicha({ ANTHROPIC_API_KEY: "a" })).toMatchObject({ modelo: MODELO_ANTHROPIC_PADRAO });
    expect(motorDaFicha({ ANTHROPIC_API_KEY: "a", ANTHROPIC_MODEL: " claude-opus-5-5 " })).toMatchObject({ modelo: "claude-opus-5-5" });
    expect(motorDaFicha({ OPENAI_API_KEY: "o" })).toMatchObject({ modelo: MODELO_OPENAI_PADRAO });
    expect(motorDaFicha({ OPENAI_API_KEY: "o", OPENAI_MODEL: "gpt-5" })).toMatchObject({ modelo: "gpt-5" });
  });
});

describe("o pedido ao provedor", () => {
  it("Claude: a imagem em base64, a ferramenta forçada, a instrução de sistema e a chave só no cabeçalho", () => {
    const p = pedidoParaAnthropic(CLAUDE, { texto: "Troféu para o JariCross", imagem: IMAGEM });
    expect(p.url).toBe("https://api.anthropic.com/v1/messages");
    expect(p.cabecalhos["x-api-key"]).toBe("sk-ant-segredo");
    expect(p.cabecalhos["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.stringify(p.corpo)).not.toContain("sk-ant-segredo");
    expect(p.corpo.model).toBe("claude-sonnet-5-5");
    expect(p.corpo.system).toBe(INSTRUCAO_DA_LEITURA);
    expect(p.corpo.tool_choice).toEqual({ type: "tool", name: NOME_DA_FERRAMENTA });
    expect(p.corpo.tools[0]).toMatchObject({ name: NOME_DA_FERRAMENTA, input_schema: ESQUEMA_DA_FICHA });
    const conteudo = p.corpo.messages[0].content as { type: string; source?: unknown; text?: string }[];
    expect(conteudo[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: IMAGEM.base64 } });
    expect(conteudo[1].text).toContain("Troféu para o JariCross");
    expect(conteudo[1].text).toMatch(/dado, não ordem/);
  });

  it("OpenAI: a imagem como data URL, a função forçada e a chave só no cabeçalho", () => {
    const p = pedidoParaOpenAi(OPENAI, { texto: null, imagem: IMAGEM });
    expect(p.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(p.cabecalhos.Authorization).toBe("Bearer sk-openai-segredo");
    expect(JSON.stringify(p.corpo)).not.toContain("sk-openai-segredo");
    expect(p.corpo.tool_choice).toEqual({ type: "function", function: { name: NOME_DA_FERRAMENTA } });
    const usuario = p.corpo.messages[1].content as { type: string; image_url?: { url: string }; text?: string }[];
    expect(usuario.find((c) => c.type === "image_url")?.image_url?.url).toBe(`data:image/jpeg;base64,${IMAGEM.base64}`);
    expect(p.corpo.messages[0]).toEqual({ role: "system", content: INSTRUCAO_DA_LEITURA });
  });

  it("só texto: não leva bloco de imagem nenhum", () => {
    const a = pedidoParaAnthropic(CLAUDE, { texto: "Quero 10 troféus de 20 cm", imagem: null });
    expect((a.corpo.messages[0].content as { type: string }[]).map((c) => c.type)).toEqual(["text"]);
    const o = pedidoParaOpenAi(OPENAI, { texto: "Quero 10 troféus", imagem: null });
    expect((o.corpo.messages[1].content as { type: string }[]).map((c) => c.type)).toEqual(["text"]);
  });

  it("escolhe o formato pelo provedor", () => {
    expect(pedidoParaOProvedor(CLAUDE, { texto: null, imagem: IMAGEM }).url).toContain("anthropic.com");
    expect(pedidoParaOProvedor(OPENAI, { texto: null, imagem: IMAGEM }).url).toContain("openai.com");
  });
});

describe("a instrução e o formato", () => {
  it("manda registrar só o visível, tratar o texto da imagem como dado e ignorar preço", () => {
    expect(INSTRUCAO_DA_LEITURA).toMatch(/VISÍVEL/);
    expect(INSTRUCAO_DA_LEITURA).toMatch(/DADO da ficha, não ordem/);
    expect(INSTRUCAO_DA_LEITURA).toMatch(/Preço e prazo não interessam/);
    expect(INSTRUCAO_DA_LEITURA).toMatch(/Não troque o material da ficha por outro/);
  });

  it("o formato não tem campo de preço, custo, multiplicador nem desconto", () => {
    const campos = JSON.stringify(ESQUEMA_DA_FICHA);
    expect(campos).not.toMatch(/preco|preço|custo|multiplicador|desconto|valor_unitario/i);
  });

  it("todos os campos do formato são obrigatórios, para a IA responder nulo em vez de omitir", () => {
    const props = Object.keys(ESQUEMA_DA_FICHA.properties).sort();
    expect([...ESQUEMA_DA_FICHA.required].sort()).toEqual(props);
  });
});

describe("a resposta do provedor", () => {
  const argumentos = { linha: "economico", altura_cm: 18, largura_cm: 20, base_largura_cm: null, base_altura_cm: null, quantidade: null, urgente: null, arte: null, nomes_individuais: null, textos: [], pecas: [{ nome: "Placa", material: "Acrílico cristal", espessura_mm: 2, largura_cm: 20, altura_cm: 16, quantidade: 1, decoracao: "vinil_laminado", maquina: null }], observacoes: null, duvidas: [] };

  it("Claude: lê o bloco tool_use da ferramenta certa", () => {
    const corpo = { content: [{ type: "text", text: "Lendo" }, { type: "tool_use", name: NOME_DA_FERRAMENTA, input: argumentos }] };
    expect(argumentosDaResposta("anthropic", corpo)).toEqual(argumentos);
    expect(normalizarFichaDaIa(argumentosDaResposta("anthropic", corpo))?.ficha.pecas).toHaveLength(1);
  });

  it("OpenAI: lê os argumentos (texto JSON) da função certa", () => {
    const corpo = { choices: [{ message: { tool_calls: [{ function: { name: NOME_DA_FERRAMENTA, arguments: JSON.stringify(argumentos) } }] } }] };
    expect(normalizarFichaDaIa(argumentosDaResposta("openai", corpo))?.ficha.linha).toBe("economico");
  });

  it("ferramenta com outro nome, resposta só em texto e corpo estranho não viram dado", () => {
    expect(argumentosDaResposta("anthropic", { content: [{ type: "tool_use", name: "outra", input: argumentos }] })).toBeNull();
    expect(argumentosDaResposta("anthropic", { content: [{ type: "text", text: "{\"linha\":\"premium\"}" }] })).toBeNull();
    expect(argumentosDaResposta("openai", { choices: [{ message: { content: "{\"linha\":\"premium\"}" } }] })).toBeNull();
    expect(argumentosDaResposta("openai", { choices: [{ message: { tool_calls: [{ function: { name: "outra", arguments: "{}" } }] } }] })).toBeNull();
    expect(argumentosDaResposta("anthropic", null)).toBeNull();
    expect(argumentosDaResposta("openai", "texto")).toBeNull();
  });

  it("reconhece a falta de saldo nos dois provedores", () => {
    expect(faltaSaldo(402, "")).toBe(true);
    expect(faltaSaldo(400, "Your credit balance is too low to access the Anthropic API")).toBe(true);
    expect(faltaSaldo(429, "You exceeded your current quota (insufficient_quota)")).toBe(true);
    expect(faltaSaldo(429, "Rate limit reached for requests")).toBe(false);
    expect(faltaSaldo(400, "invalid image")).toBe(false);
    expect(faltaSaldo(500, "credit balance")).toBe(false);
  });
});
