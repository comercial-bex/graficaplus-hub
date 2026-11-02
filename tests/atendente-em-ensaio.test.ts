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
  previaDoOrcamento,
  produtosDaConversa,
  textoDoValor,
  turnosDaConversa,
  type LeituraDoAtendente,
  type TabelaDoAtendente,
} from "../src/domain/whatsapp/atendente";
import { responderNoEnsaio } from "../src/lib/api/atendente-ensaio.functions";

const ler = (c: string) => readFileSync(c, "utf8");
const banner: ProdutoParaIa = {
  id: "ban", nome: "Banner com bastão e corda", unidade: "m2", tipo: "produto", personalidade: "roteiro do banner", como_medir: "medir", perguntas: "perguntar",
  apelidos: ["banner de loja"], checklist: [],
};
const chaveiro: ProdutoParaIa = { id: "cha", nome: "CHAVEIRO ACRILICO", unidade: "un", tipo: "produto", personalidade: "roteiro do chaveiro", como_medir: "m", perguntas: "p", checklist: [] };
const lam = { id: "q", pergunta: "Precisa de laminação?", descricao: null, obrigatoria: false, tipo_resposta: "unica" as const, respostas: ["Sim", "Não"], acoes: [{ resposta: "Sim", processo_id: "p-lam" }], ordem: 0, ia_modo: "perguntar" as const };
const adesivo: ProdutoParaIa = { id: "ade", nome: "Adesivo", unidade: "m2", tipo: "produto", personalidade: "a", como_medir: "m", perguntas: "p", checklist: [lam] };
const tabela: TabelaDoAtendente = {
  precos: new Map([
    ["ban", { preco_base: 64.9, area_minima: 1, faixas: [] }],
    ["cha", { preco_base: null, area_minima: null, faixas: [] }],
    ["ade", { preco_base: 55, area_minima: null, faixas: [] }],
  ]),
  processos: [{ id: "p-lam", nome: "Laminação", medida_cobrada: "area", produto_servico_id: "s-lam" }],
  servicos: [{ id: "s-lam", nome: "Laminação de adesivo", unidade: "m2", preco_base: 28 }],
  acabamentos: new Map([["Laminação de adesivo", { id: "s-lam", nome: "Laminação de adesivo", medida: "area", preco: 28 }]]),
};
const produtos = [banner, chaveiro, adesivo];
const leitura = (over: Partial<LeituraDoAtendente> = {}): LeituraDoAtendente => ({
  resposta: "Certo, anotei.", acao: "responder", motivo_transferencia: null, confianca: 0.9, orcamento_pronto: false, itens: [], sem_produto: [], ...over,
});
const doBanner = { produto_id: "ban", nome: banner.nome, unidade: "m2", quantidade: 2, largura_m: 0.8, altura_m: 1.2, acabamentos: [], respostas: [] };

describe("a IA nunca escreve valor (02/11/2026)", () => {
  it("valor, data, pagamento e prazo escritos por ela são barrados", () => {
    expect(motivoParaBarrarAtendente("Fica R$ 50,00")).toContain("valor");
    expect(motivoParaBarrarAtendente("Fica 50 reais")).toContain("valor");
    expect(motivoParaBarrarAtendente("Fica pronto 10/11")).toContain("data");
    expect(motivoParaBarrarAtendente("Pode pagar no pix")).toContain("pagamento");
    expect(motivoParaBarrarAtendente("Faço um desconto")).toContain("pagamento");
    expect(motivoParaBarrarAtendente("Sai em 3 dias")).toContain("prazo");
    expect(motivoParaBarrarAtendente("Qual a medida da peça?")).toBeNull();
  });

  it("a IA que escreveu valor passa para a equipe, e o texto dela não sai", () => {
    const d = decidirAtendente(leitura({ resposta: "Fica R$ 10,00" }), produtos, tabela);
    expect(d.acao).toBe("transferir");
    expect(d.texto).not.toContain("R$");
  });

  it("a conta segue a do banco: área mínima, 2 banners de 0,96 m² cobram 2 m²", () => {
    const p = previaDoOrcamento([doBanner], produtos, tabela);
    expect(p.total).toBe(129.8);
    expect(p.pendencias).toEqual([]);
  });

  it("orçamento pronto leva o valor da tabela, depois da frase da IA", () => {
    const d = decidirAtendente(leitura({ orcamento_pronto: true, itens: [doBanner] }), produtos, tabela);
    expect(d.acao).toBe("responder");
    expect(d.texto.startsWith("Certo, anotei.")).toBe(true);
    expect(d.texto).toContain("R$ 129,80");
  });

  it("item sem preço não vira zero: passa para a equipe, com o motivo", () => {
    const it = { ...doBanner, produto_id: "cha", nome: chaveiro.nome, unidade: "un", largura_m: null, altura_m: null };
    const d = decidirAtendente(leitura({ orcamento_pronto: true, itens: [it] }), produtos, tabela);
    expect(d.acao).toBe("transferir");
    expect(d.motivo).toContain("sem preço de tabela");
  });

  it("m² sem medida é pendência, e fora do catálogo passa para a equipe", () => {
    expect(previaDoOrcamento([{ ...doBanner, largura_m: null }], produtos, tabela).pendencias[0]).toContain("falta a medida");
    expect(decidirAtendente(leitura({ sem_produto: ["Camiseta"] }), produtos, tabela).motivo).toContain("fora do catálogo");
  });

  it("resposta do checklist cobra pela área, e o acabamento igual não cobra de novo", () => {
    const it = { produto_id: "ade", nome: "Adesivo", unidade: "m2", quantidade: 1, largura_m: 0.5, altura_m: 0.5, acabamentos: ["Laminação de adesivo"], respostas: [{ pergunta_id: "q", pergunta: "Precisa de laminação?", resposta: "Sim" }] };
    const p = previaDoOrcamento([it], produtos, tabela);
    expect(p.linhas.map((l) => l.total)).toEqual([13.75, 7]);
    expect(textoDoValor(p)).toContain("*Total: R$ 20,75*");
  });

  it("baixa confiança e pedido de transferência vão para a equipe", () => {
    expect(decidirAtendente(leitura({ confianca: 0.4 }), produtos, tabela).motivo).toContain("confiança baixa");
    expect(decidirAtendente(leitura({ acao: "transferir", motivo_transferencia: "reclamação" }), produtos, tabela).motivo).toBe("reclamação");
  });

  it("arquivo recebido é dito antes da resposta", () => {
    expect(decidirAtendente(leitura(), produtos, tabela, "documento").texto).toContain("Recebi o arquivo");
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
    const l = interpretarAtendente({ resposta: "ok", acao: "responder", confianca: 1, orcamento_pronto: false, itens: [{ produto_id: "x", quantidade: 1 }], sem_produto: [] }, produtos);
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
    const r = await responderNoEnsaio({ historico: [], mensagem: "[audio enviada]", tipo: "audio", produtos, tabela, motor: { url: "u", chave: "c", modelo: "m" } }, buscar as never);
    expect(buscar).not.toHaveBeenCalled();
    expect(r.estado).toBe("ok");
  });

  it("sem chave diz que a IA não está ligada; saldo e limite não viram resposta vazia", async () => {
    const base = { historico: [], mensagem: "oi", tipo: "texto" as const, produtos, tabela };
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
