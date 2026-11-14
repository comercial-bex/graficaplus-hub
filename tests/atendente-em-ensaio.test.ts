import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ProdutoParaIa } from "../src/domain/orcamentos/orcamento-com-ia";
import {
  decidirAtendente,
  falaDaMensagem,
  interpretarAtendente,
  mascararDados,
  montarPerguntaDoAtendente,
  motivoParaBarrarAtendente,
  produtosDaConversa,
  turnosDaConversa,
  type LeituraDoAtendente,
  FERRAMENTA_DO_ATENDENTE,
} from "../src/domain/whatsapp/atendente";
import { compilarTermosDoBanco } from "../src/domain/whatsapp/triagem/verificador";
import { responderNoEnsaio } from "../src/lib/api/atendente-ensaio.functions";

const ler = (c: string) => readFileSync(c, "utf8");
const banner: ProdutoParaIa = {
  id: "ban", nome: "Banner com bastão e corda", unidade: "m2", tipo: "produto", personalidade: "roteiro do banner", como_medir: "medir", perguntas: "perguntar",
  apelidos: ["banner de loja"], checklist: [],
};
const chaveiro: ProdutoParaIa = { id: "cha", nome: "CHAVEIRO ACRILICO", unidade: "un", tipo: "produto", personalidade: "roteiro do chaveiro", como_medir: "m", perguntas: "p", checklist: [] };
const produtos = [banner, chaveiro];
const doBanner = { produto_id: "ban", nome: banner.nome, unidade: "m2", quantidade: 2, largura_m: 0.8, altura_m: 1.2, acabamentos: [], respostas: [] };
const leitura = (over: Partial<LeituraDoAtendente> = {}): LeituraDoAtendente => ({
  resposta: "Certo, anotei.", acao: "responder", motivo_transferencia: null, confianca: 0.9, itens: [], sem_produto: [], ...over,
});

describe("o atendente nunca fala preço, prazo nem data (C1, 14/11/2026)", () => {
  it.each([
    ["Fica R$ 50,00", "moeda"],
    ["Fica 50 reais", "valor_em_reais"],
    ["Fica pronto 10/11", "data_numerica"],
    ["Pode pagar no pix", "pix"],
    ["Faço um desconto", "desconto"],
    ["Sai em 3 dias", "prazo_em_numero"],
    ["Fica pronto amanhã", "prazo_relativo"],
    ["Qual a medida da peça?", null],
  ])("%j", (texto, regra) => {
    const motivo = motivoParaBarrarAtendente(texto);
    if (regra) expect(motivo).toContain(regra);
    else expect(motivo).toBeNull();
    // o motivo leva o nome da regra, nunca o trecho
    if (regra) expect(motivo).not.toContain("50");
  });

  it("a IA que escreveu valor passa para a equipe, e o texto dela não sai", () => {
    const d = decidirAtendente(leitura({ resposta: "Fica R$ 10,00" }));
    expect(d.acao).toBe("transferir");
    expect(d.texto).not.toContain("R$");
  });

  it("a decisão não tem valor nem prévia, e a ferramenta não tem orcamento_pronto", () => {
    const d = decidirAtendente(leitura({ itens: [doBanner] }));
    expect(d).toEqual({ acao: "responder", texto: "Certo, anotei.", motivo: null });
    expect(JSON.stringify(FERRAMENTA_DO_ATENDENTE)).not.toContain("orcamento_pronto");
    expect(interpretarAtendente({ resposta: "ok", acao: "responder", confianca: 1, orcamento_pronto: true, itens: [], sem_produto: [] }, produtos)).not.toHaveProperty("orcamento_pronto");
  });

  it("as instruções mandam a equipe orçar e proíbem perguntar o tipo do contato", () => {
    const sistema = montarPerguntaDoAtendente([], "oi", produtos)[0].content;
    expect(sistema).toContain("Quem passa preço, prazo e orçamento é sempre a equipe");
    expect(sistema).toContain("NUNCA pergunte se a pessoa é parceira");
    expect(sistema).toContain("Não monte orçamento");
    expect(sistema).not.toContain("o sistema acrescenta o valor");
  });

  it("termo extra da tabela também barra", () => {
    const { regras } = compilarTermosDoBanco([{ regra: "frete", termo: "frete", tipo: "trecho", sobre: "plano", ramo: "todos", ativo: true }]);
    expect(motivoParaBarrarAtendente("Entregamos com frete", regras)).toContain("frete");
    expect(motivoParaBarrarAtendente("Entregamos")).toBeNull();
  });

  it("fora do catálogo passa para a equipe", () => {
    expect(decidirAtendente(leitura({ sem_produto: ["Camiseta"] })).motivo).toContain("fora do catálogo");
  });

  it("baixa confiança e pedido de transferência vão para a equipe", () => {
    expect(decidirAtendente(leitura({ confianca: 0.4 })).motivo).toContain("confiança baixa");
    expect(decidirAtendente(leitura({ acao: "transferir", motivo_transferencia: "reclamação" })).motivo).toBe("reclamação");
  });

  it("arquivo recebido é dito antes da resposta", () => {
    expect(decidirAtendente(leitura(), "documento").texto).toContain("Recebi o arquivo");
  });
});

describe("o que vai para a IA", () => {
  it("só o produto falado vai com o roteiro; o resto vai só com o nome", () => {
    const m = montarPerguntaDoAtendente([], "quanto fica um banner de loja?", produtos);
    const lista = JSON.parse(m[1].content.split("\n")[1]);
    expect(lista.find((p: { id: string }) => p.id === "ban").o_que_e).toBe("roteiro do banner");
    expect(lista.find((p: { id: string }) => p.id === "cha").o_que_e).toBeUndefined();
    expect(produtosDaConversa("acrilico", produtos).map((p) => p.id)).toEqual(["cha"]);
    expect(m[1].content).not.toMatch(/preco|custo/i);
  });

  it("o plural acha o produto: copos térmicos é o copo térmico", () => {
    const copo = { ...chaveiro, id: "cop", nome: "COPO TERMICO 500ML" };
    expect(produtosDaConversa("preciso de 20 copos térmicos", [copo, banner]).map((p) => p.id)).toEqual(["cop"]);
    expect(produtosDaConversa("2 banners", [copo, banner]).map((p) => p.id)).toEqual(["ban"]);
  });

  it("telefone, e-mail e documento saem mascarados", () => {
    expect(mascararDados("meu zap 96 99123-4567")).toBe("meu zap [telefone]");
    expect(mascararDados("email joao@x.com.br")).toBe("email [e-mail]");
    expect(mascararDados("cpf 123.456.789-09")).toBe("cpf [documento]");
    expect(falaDaMensagem({ tipo: "audio", texto: null, legenda: null })).toBe("[audio enviada]");
  });

  it("produto inventado pela IA não entra", () => {
    const l = interpretarAtendente({ resposta: "ok", acao: "responder", confianca: 1, itens: [{ produto_id: "x", quantidade: 1 }], sem_produto: [] }, produtos);
    expect(l?.itens).toEqual([]);
    expect(l?.sem_produto[0]).toContain("x");
    expect(interpretarAtendente("isto não é json", produtos)).toBeNull();
  });
});

describe("a réplica", () => {
  const msg = (direcao: string, texto: string | null, tipo = "texto") => ({ direcao, tipo, texto, legenda: null });
  it("mensagens seguidas do cliente são um turno, com a resposta real da equipe ao lado", () => {
    const t = turnosDaConversa([
      msg("entrada", "oi"), msg("entrada", "quanto fica um banner?"),
      msg("saida", "Qual a medida?"),
      msg("entrada", null, "audio"),
      msg("saida", "Pode escrever?"), msg("saida", "Obrigado"),
    ]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ mensagem: "oi\nquanto fica um banner?", respostaDaEquipe: "Qual a medida?" });
    expect(t[1]).toMatchObject({ tipo: "audio", respostaDaEquipe: "Pode escrever?\nObrigado" });
    expect(t[1].historico.map((h) => h.de)).toEqual(["cliente", "grafica"]);
  });

  it("mensagem da equipe antes do cliente vira contexto, e o limite vale", () => {
    const t = turnosDaConversa([msg("saida", "Bom dia"), msg("entrada", "a"), msg("saida", "b"), msg("entrada", "c")], 1);
    expect(t).toHaveLength(1);
    expect(t[0].historico).toEqual([{ de: "grafica", texto: "Bom dia" }]);
  });
});

describe("o ensaio não fala com ninguém", () => {
  const servidor = ler("src/lib/api/atendente-ensaio.functions.ts");
  it("não escreve em mensagem, fila de envio nem orçamento", () => {
    for (const proibido of ["whatsapp_fila_envio", "whatsapp_ia_enviar", 'from("orcamentos")', 'from("orcamento_itens")']) expect(servidor).not.toContain(proibido);
    expect(servidor).not.toMatch(/whatsapp_mensagens"\)\s*\.(insert|update|upsert)/);
  });

  it("áudio não vai para a IA", async () => {
    const buscar = vi.fn();
    const r = await responderNoEnsaio({ historico: [], mensagem: "[audio enviada]", tipo: "audio", produtos, motor: { url: "u", chave: "c", modelo: "m" } }, buscar as never);
    expect(buscar).not.toHaveBeenCalled();
    expect(r.estado).toBe("ok");
  });

  it("sem chave diz que a IA não está ligada; saldo e limite não viram resposta vazia", async () => {
    const base = { historico: [], mensagem: "oi", tipo: "texto" as const, produtos };
    expect((await responderNoEnsaio({ ...base, motor: null })).estado).toBe("sem_ia");
    const resposta = (status: number) => vi.fn(async () => new Response("{}", { status })) as never;
    const motor = { url: "u", chave: "c", modelo: "m" };
    expect((await responderNoEnsaio({ ...base, motor }, resposta(402))).estado).toBe("sem_saldo");
    expect((await responderNoEnsaio({ ...base, motor }, resposta(429))).estado).toBe("limite");
  });

  it("a tabela da réplica é de quem lê as conversas", () => {
    const m = ler("supabase/migrations/20261102200000_atendente_em_ensaio.sql");
    expect(m).toContain("'whatsapp.read'");
    expect(m).toContain("REVOKE ALL ON public.atendente_ensaios FROM anon");
  });

  it("a assistente de verdade continua atrás de ia_ativa", () => {
    expect(ler("src/lib/api/whatsapp-assistente.server.ts")).toContain('if (!config.ia_ativa) return { acao: "nada", motivo: "ia_desligada" }');
  });
});
