import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ler a ficha do troféu NO SERVIDOR (22/11/2026). Travam-se: (1) a permissão é conferida ANTES de ler o banco e de gastar
 * uma chamada de IA; (2) a entrada é estrita; (3) o bloco FICHA-BEX sem imagem NÃO chama IA nem precisa de chave; (4) a
 * imagem vai ao provedor da AGÊNCIA (Claude, depois OpenAI) e a chave não volta na resposta; (5) cada falha do provedor
 * vira um estado que a tela sabe dizer; (6) o catálogo devolvido tem só nomes e medidas: nunca custo nem multiplicador.
 */

type Linha = Record<string, unknown>;

const h = vi.hoisted(() => ({
  permissoes: new Set<string>(),
  erroDePermissao: false,
  rpc: [] as string[],
  tabelas: {} as Record<string, Linha | Linha[] | null>,
  erroNaTabela: null as string | null,
  consultas: [] as { tabela: string; colunas: string }[],
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@tanstack/react-start", () => {
  type Validador = (d: unknown) => unknown;
  type Manipulador = (a: { data: unknown; context: unknown }) => Promise<unknown>;
  return {
    createServerFn: () => {
      let validar: Validador = (d) => d;
      const cadeia = {
        middleware: () => cadeia,
        inputValidator: (v: Validador) => {
          validar = v;
          return cadeia;
        },
        handler: (fn: Manipulador) => async (entrada?: { data: unknown }) =>
          fn({
            data: validar(entrada?.data),
            context: {
              userId: "u1",
              supabase: {
                rpc: async (nome: string, args: Record<string, unknown>) => {
                  h.rpc.push(`${nome}:${String(args._permission ?? "")}`);
                  if (h.erroDePermissao) return { data: null, error: { message: "timeout" } };
                  return { data: h.permissoes.has(String(args._permission)), error: null };
                },
              },
            },
          }),
      };
      return cadeia;
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => {
      const q = { tabela, colunas: "*" };
      h.consultas.push(q);
      const filtros: Record<string, unknown> = {};
      const em: Record<string, unknown[]> = {};
      const resolver = (unico: boolean) => {
        if (h.erroNaTabela === tabela) return { data: null, error: { message: `permission denied for table ${tabela}` } };
        const fonte = h.tabelas[tabela] ?? null;
        if (unico) return { data: Array.isArray(fonte) ? (fonte[0] ?? null) : fonte, error: null };
        let linhas = Array.isArray(fonte) ? fonte : fonte ? [fonte] : [];
        linhas = linhas.filter((l) => Object.entries(filtros).every(([k, v]) => !(k in l) || l[k] === v));
        for (const [k, vs] of Object.entries(em)) linhas = linhas.filter((l) => !(k in l) || vs.includes(l[k]));
        return { data: linhas, error: null };
      };
      const b = {
        select: (c: string) => {
          q.colunas = c;
          return b;
        },
        eq: (c: string, v: unknown) => {
          filtros[c] = v;
          return b;
        },
        in: (c: string, vs: unknown[]) => {
          em[c] = vs;
          return b;
        },
        order: () => b,
        maybeSingle: async () => resolver(true),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver(false)).then(ok, ko),
      };
      return b;
    },
  },
}));

import { lerFichaComIa, lerFichaDoTrofeu, type ResultadoDaFicha } from "@/lib/api/trofeus-ficha.functions";
import { NOME_DA_FERRAMENTA } from "@/domain/trofeus/ficha-ia";

const IMAGEM = { tipo: "image/png", base64: "iVBORw0KGgo".repeat(40) };
const BLOCO = "FICHA-BEX v1\nlinha: economico\naltura_cm: 18\nquantidade: 12\npecas:\n- Placa principal | Acrílico cristal | 2 | 20 | 16 | 1 | vinil_laminado |";
const CHAVE_CLAUDE = "sk-ant-NAO-PODE-VAZAR";
const CHAVE_OPENAI = "sk-openai-NAO-PODE-VAZAR";

const ARGUMENTOS = {
  linha: "premium", altura_cm: 28, largura_cm: 20, base_largura_cm: 20, base_altura_cm: 7, quantidade: 3, urgente: false, arte: "criacao_exclusiva", nomes_individuais: 0,
  textos: [{ chave: "evento", valor: "KR Combat" }],
  pecas: [{ nome: "Coluna", material: "Acrílico cristal", espessura_mm: 6, largura_cm: 6, altura_cm: 24, quantidade: 1, decoracao: "nenhuma", maquina: "laser CO2" }],
  observacoes: null, duvidas: ["texto da base cortado"],
};
const respostaClaude = () => new Response(JSON.stringify({ content: [{ type: "tool_use", name: NOME_DA_FERRAMENTA, input: ARGUMENTOS }] }), { status: 200 });
const respostaOpenAi = () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: NOME_DA_FERRAMENTA, arguments: JSON.stringify(ARGUMENTOS) } }] } }] }), { status: 200 });

function catalogoNoBanco() {
  h.tabelas = {
    trofeu_modelos: [
      { id: "m-eco", nome: "Troféu econômico", linha: "economico", altura_referencia_m: "0.180", ativo: true, multiplicador_base: "3.0", minutos_de_mao_de_obra: "20" },
      { id: "m-pre", nome: "Troféu premium em camadas", linha: "premium", altura_referencia_m: "0.280", ativo: true, multiplicador_base: "3.5", minutos_de_mao_de_obra: "40" },
    ],
    trofeu_pecas: [
      { modelo_id: "m-eco", ordem: 1, nome: "Placa principal", material_id: "mat-c2", espessura_mm: "2.0", largura_m: "0.200", altura_m: "0.160", quantidade: 1, decoracao: "vinil_laminado", fator_de_forma: "1.35" },
      { modelo_id: "m-eco", ordem: 2, nome: "Base", material_id: "mat-p3", espessura_mm: "3.0", largura_m: "0.200", altura_m: "0.050", quantidade: 2, decoracao: "nenhuma", fator_de_forma: "1.00" },
      { modelo_id: "m-pre", ordem: 1, nome: "Coluna", material_id: "mat-c6", espessura_mm: "6.0", largura_m: "0.060", altura_m: "0.240", quantidade: 1, decoracao: "nenhuma", fator_de_forma: "1.30" },
    ],
    trofeu_regras: { unica: true, altura_minima_m: "0.120", altura_maxima_m: "0.400", espessura_maxima_de_corte_mm: "10", multiplicador_base: "3.0" },
    materiais: [
      { id: "mat-c2", nome: "ACRILICO CRISTAL VIRGEM 2MM", espessura_mm: "2.00", status: "ativo", custo_unitario: "190", custo_medio: "188", estoque: "0" },
      { id: "mat-p3", nome: "ACRILICO PRETO VIRGEM 3MM", espessura_mm: "3.00", status: "ativo", custo_unitario: "190", custo_medio: "188", estoque: "4" },
      { id: "mat-c6", nome: "ACRILICO CRISTAL VIRGEM 6MM", espessura_mm: "6.00", status: "ativo", custo_unitario: "390", custo_medio: "388", estoque: "0" },
      { id: "mat-velho", nome: "ACRILICO VERDE 3MM", espessura_mm: "3.00", status: "inativo", custo_unitario: "100", custo_medio: "100", estoque: "0" },
    ],
  };
}

let buscar: ReturnType<typeof vi.fn>;
let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.permissoes = new Set(["orcamentos.create"]);
  h.erroDePermissao = false;
  h.rpc = [];
  h.erroNaTabela = null;
  h.consultas = [];
  catalogoNoBanco();
  buscar = vi.fn(async () => respostaClaude());
  vi.stubGlobal("fetch", buscar);
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  erros.mockRestore();
});

const chave = (nome: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "LOVABLE_API_KEY", valor: string) => vi.stubEnv(nome, valor);
const semChaves = () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("LOVABLE_API_KEY", "");
};
const ler = (data: unknown) => (lerFichaDoTrofeu as unknown as (e: { data: unknown }) => Promise<ResultadoDaFicha>)({ data });
const ok = (r: ResultadoDaFicha) => {
  if (r.estado !== "ok") throw new Error(`esperava ok, veio ${r.estado}`);
  return r;
};

describe("a permissão vem antes de tudo", () => {
  it("sem orcamentos.create: recusa, sem ler o banco e sem chamar a IA", async () => {
    h.permissoes = new Set();
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    await expect(ler({ imagem: IMAGEM })).rejects.toThrow("A leitura da ficha é de quem cria orçamentos.");
    expect(h.consultas).toEqual([]);
    expect(buscar).not.toHaveBeenCalled();
    expect(h.rpc).toEqual(["has_permission:orcamentos.create"]);
  });

  it("erro ao conferir o perfil também para tudo", async () => {
    h.erroDePermissao = true;
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    await expect(ler({ imagem: IMAGEM })).rejects.toThrow("Não foi possível conferir o seu perfil. Tente de novo.");
    expect(h.consultas).toEqual([]);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("a entrada é estrita", () => {
  it.each([
    ["campo que não existe", { texto: "FICHA-BEX v1", preco: 10 }, /campo não aceito/],
    ["nada enviado", {}, /Cole o bloco FICHA-BEX ou anexe a imagem/],
    ["texto curto e sem imagem", { texto: "oi" }, /Cole o bloco FICHA-BEX ou anexe a imagem/],
    ["tipo de imagem que não serve", { imagem: { tipo: "image/gif", base64: "A".repeat(300) } }, /PNG, JPEG ou WEBP/],
    ["imagem grande demais", { imagem: { tipo: "image/png", base64: "A".repeat(7_000_001) } }, /grande demais/],
    ["imagem que não é base64", { imagem: { tipo: "image/png", base64: "<script>".repeat(50) } }, /não pôde ser lida/],
    ["texto enorme", { texto: "x".repeat(12_001) }, /passa de 12\.000 caracteres/],
  ])("%s", async (_nome, entrada, frase) => {
    await expect(ler(entrada)).rejects.toThrow(frase);
    expect(h.rpc).toEqual([]);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("o bloco FICHA-BEX, sem imagem, não usa IA", () => {
  it("lê por regra, sem chave e sem rede, e devolve o catálogo para comparar", async () => {
    semChaves();
    const r = ok(await ler({ texto: BLOCO }));
    expect(buscar).not.toHaveBeenCalled();
    expect(r.origem).toBe("bloco");
    expect(r.motor).toBeNull();
    expect(r.ficha).toMatchObject({ linha: "economico", alturaCm: 18, quantidade: 12 });
    expect(r.catalogo.modelos.map((m) => m.nome)).toEqual(["Troféu econômico", "Troféu premium em camadas"]);
    expect(r.catalogo.modelos[0]).toMatchObject({ alturaReferenciaCm: 18 });
    expect(r.catalogo.modelos[0].pecas[0]).toMatchObject({ nome: "Placa principal", material: "ACRILICO CRISTAL VIRGEM 2MM", espessuraMm: 2, larguraCm: 20, alturaCm: 16, quantidade: 1 });
    expect(r.catalogo).toMatchObject({ alturaMinimaCm: 12, alturaMaximaCm: 40, espessuraMaximaDeCorteMm: 10 });
  });

  it("o cadastro de materiais só traz os ativos e nenhum dado de estoque ou custo", async () => {
    semChaves();
    const r = ok(await ler({ texto: BLOCO }));
    expect(r.catalogo.materiais.map((m) => m.nome)).not.toContain("ACRILICO VERDE 3MM");
    expect(r.catalogo.materiais).toContainEqual({ nome: "ACRILICO CRISTAL VIRGEM 2MM", espessuraMm: 2 });
    expect(r.catalogo.materiais.every((m) => Object.keys(m).sort().join() === "espessuraMm,nome")).toBe(true);
  });

  it("NUNCA devolve custo, multiplicador, fator de forma nem taxa, e nunca os lê do banco", async () => {
    semChaves();
    const r = await ler({ texto: BLOCO });
    expect(JSON.stringify(r)).not.toMatch(/custo|multiplicador|fator|minutos_de_mao|estoque|preco|preço/i);
    const colunas = h.consultas.map((c) => `${c.tabela}:${c.colunas}`).join(" | ");
    expect(colunas).not.toMatch(/custo_unitario|custo_medio|estoque|multiplicador|fator_de_forma|minutos_de_mao/);
    expect(h.consultas.find((c) => c.tabela === "trofeu_regras")?.colunas).toBe("altura_minima_m, altura_maxima_m, espessura_maxima_de_corte_mm");
  });

  it("marcador sem nada dentro devolve a frase, sem chamar IA", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    const r = await ler({ texto: "FICHA-BEX v1\n\n" });
    expect(r).toMatchObject({ estado: "falhou" });
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("a imagem vai à IA da agência", () => {
  it("Claude primeiro: chama a Anthropic com a chave no cabeçalho e devolve a ficha, sem a chave", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    chave("OPENAI_API_KEY", CHAVE_OPENAI);
    const r = ok(await ler({ imagem: IMAGEM }));
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(CHAVE_CLAUDE);
    expect(String(init.body)).toContain(IMAGEM.base64);
    expect(String(init.body)).not.toContain(CHAVE_CLAUDE);
    expect(r.origem).toBe("imagem");
    expect(r.motor).toBe("claude");
    expect(r.ficha.pecas[0]).toMatchObject({ nome: "Coluna", espessuraMm: 6 });
    expect(r.duvidas).toEqual(["texto da base cortado"]);
    expect(JSON.stringify(r)).not.toContain("NAO-PODE-VAZAR");
  });

  it("sem a chave do Claude, usa a da OpenAI", async () => {
    chave("OPENAI_API_KEY", CHAVE_OPENAI);
    buscar.mockImplementation(async () => respostaOpenAi());
    const r = ok(await ler({ imagem: IMAGEM }));
    const [url, init] = buscar.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CHAVE_OPENAI}`);
    expect(r.motor).toBe("openai");
    expect(JSON.stringify(r)).not.toContain("NAO-PODE-VAZAR");
  });

  it("sem nenhuma chave da agência é 'sem IA', mesmo com a chave do Lovable: o saldo do Lovable não é usado", async () => {
    semChaves();
    chave("LOVABLE_API_KEY", "lovable-chave");
    expect(await ler({ imagem: IMAGEM })).toEqual({ estado: "sem_ia" });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("imagem junto com o bloco: a imagem é lida pela IA e o texto vai junto como dado", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    const r = ok(await ler({ imagem: IMAGEM, texto: BLOCO }));
    expect(r.origem).toBe("imagem");
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(String((buscar.mock.calls[0] as [string, RequestInit])[1].body)).toContain("FICHA-BEX v1");
  });

  it("texto livre sem bloco (o pedido do cliente) também vai à IA, sem imagem", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    const r = ok(await ler({ texto: "Preciso de 12 troféus de 25 cm para o campeonato" }));
    expect(r.origem).toBe("texto");
    expect(String((buscar.mock.calls[0] as [string, RequestInit])[1].body)).not.toContain('"type":"image"');
  });
});

describe("cada falha do provedor vira um estado que a tela sabe dizer", () => {
  const resposta = (status: number, corpo = "{}") => async () => new Response(corpo, { status });

  it.each([
    [429, "{\"error\":{\"message\":\"Rate limit reached\"}}", { estado: "limite" }],
    [429, "{\"error\":{\"code\":\"insufficient_quota\"}}", { estado: "sem_saldo" }],
    [402, "{}", { estado: "sem_saldo" }],
    [400, "{\"error\":{\"message\":\"Your credit balance is too low\"}}", { estado: "sem_saldo" }],
    [401, "{}", { estado: "falhou", detalhe: "o provedor da IA recusou a chave da agência" }],
    [403, "{}", { estado: "falhou", detalhe: "o provedor da IA recusou a chave da agência" }],
    [500, "{}", { estado: "falhou", detalhe: "o serviço de IA respondeu HTTP 500" }],
  ])("HTTP %i → %j", async (status, corpo, esperado) => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    buscar.mockImplementation(resposta(status, corpo));
    expect(await ler({ imagem: IMAGEM })).toEqual(esperado);
  });

  it("rede que cai, resposta ilegível e resposta sem ferramenta não viram ficha", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    buscar.mockImplementation(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await ler({ imagem: IMAGEM })).toMatchObject({ estado: "falhou", detalhe: "o serviço de IA não respondeu a tempo" });
    buscar.mockImplementation(async () => new Response("<html>", { status: 200 }));
    expect(await ler({ imagem: IMAGEM })).toMatchObject({ estado: "falhou", detalhe: "resposta da IA ilegível" });
    buscar.mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "não sei" }] }), { status: 200 }));
    expect(await ler({ imagem: IMAGEM })).toMatchObject({ estado: "falhou", detalhe: "a IA não conseguiu ler dados de troféu nesta ficha" });
  });

  it("o detalhe da falha nunca leva o corpo do erro do provedor nem a chave", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    buscar.mockImplementation(resposta(500, `erro interno com ${CHAVE_CLAUDE} dentro`));
    const r = await ler({ imagem: IMAGEM });
    expect(JSON.stringify(r)).not.toContain("NAO-PODE-VAZAR");
    expect(erros.mock.calls.flat().join(" ")).not.toContain("NAO-PODE-VAZAR");
  });

  it("HTTP 400 de pedido inválido mostra só o TIPO do erro; o texto do provedor vai para o log do servidor, sem a chave", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    const mensagem = `tool_choice: type "tool" and "any" are not supported for this model. (chave ${CHAVE_CLAUDE})`;
    buscar.mockImplementation(resposta(400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: mensagem } })));
    const r = await ler({ imagem: IMAGEM });
    expect(r).toEqual({ estado: "falhou", detalhe: "o serviço de IA respondeu HTTP 400 (invalid_request_error)" });
    // a tela não ganha o texto livre do provedor...
    expect(JSON.stringify(r)).not.toContain("tool_choice");
    // ...mas o log do servidor, que é onde se acha o porquê, ganha, sem a chave
    const log = erros.mock.calls.flat().join(" ");
    expect(log).toContain("tool_choice");
    expect(log).toContain("invalid_request_error");
    expect(log).not.toContain(CHAVE_CLAUDE);
  });

  it("um tipo de erro que não é do vocabulário dos provedores não chega à tela", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    buscar.mockImplementation(resposta(400, JSON.stringify({ error: { type: "texto livre com dado do pedido", message: "x" } })));
    expect(await ler({ imagem: IMAGEM })).toEqual({ estado: "falhou", detalhe: "o serviço de IA respondeu HTTP 400" });
  });

  it("resposta 200 em que o modelo recusou ou foi cortado não vira ficha, e diz o motivo", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    const parcial = { type: "tool_use", name: "registrar_ficha_do_trofeu", input: { linha: "economico", altura_cm: 18, pecas: [] } };
    buscar.mockImplementation(async () => new Response(JSON.stringify({ stop_reason: "refusal", content: [parcial] }), { status: 200 }));
    expect(await ler({ imagem: IMAGEM })).toEqual({ estado: "falhou", detalhe: "a IA se recusou a ler esta imagem" });
    buscar.mockImplementation(async () => new Response(JSON.stringify({ stop_reason: "max_tokens", content: [parcial] }), { status: 200 }));
    expect(await ler({ imagem: IMAGEM })).toEqual({ estado: "falhou", detalhe: "a resposta da IA veio cortada" });
  });

  it("lerFichaComIa sem motor não chama a rede", async () => {
    const fake = vi.fn();
    expect(await lerFichaComIa({ texto: "x", imagem: null }, null, fake as unknown as typeof fetch)).toEqual({ estado: "sem_ia" });
    expect(fake).not.toHaveBeenCalled();
  });
});

describe("falha do catálogo", () => {
  it("vira frase em português, sem chamar a IA", async () => {
    chave("ANTHROPIC_API_KEY", CHAVE_CLAUDE);
    h.erroNaTabela = "materiais";
    await expect(ler({ imagem: IMAGEM })).rejects.toThrow("Não consegui ler a ficha agora. Tente de novo; se continuar, avise a gerência.");
    expect(buscar).not.toHaveBeenCalled();
    expect(erros.mock.calls.flat().join(" ")).not.toMatch(/NAO-PODE-VAZAR/);
  });

  it("regras ausentes também", async () => {
    h.tabelas.trofeu_regras = null;
    await expect(ler({ texto: BLOCO })).rejects.toThrow("Não consegui ler a ficha agora");
  });
});
