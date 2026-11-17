import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTOR_NAO_REGISTRADO,
  autorDaVersao,
  frasesDoQueMudou,
  lerHistorico,
  rotuloDaVersao,
} from "../src/domain/orcamentos/historico-de-versoes";

const ler = (c: string) => readFileSync(c, "utf8");

const v = (extra: Record<string, unknown> = {}) => ({
  id: "a", numero: 2, status: "enviada", criada_em: "2026-11-10T10:00:00Z", enviada_em: "2026-11-10T10:00:00Z",
  aprovada_em: null, autor: "Ana", valor_total: 448, qtd_itens: 3, retroativa: false, e_a_aprovada: false,
  o_que_mudou: { mudou: true, itens_novos: 1, itens_tirados: 0, itens_mudados: 2, campos: ["valor total"], termos: [], retrato_sem_itens: false },
  valor_anterior: 400, ...extra,
});

describe("ler o histórico", () => {
  it("o que não é lista é erro, não lista vazia", () => {
    expect(lerHistorico(null)).toBeNull();
    expect(lerHistorico({})).toBeNull();
    expect(lerHistorico("x")).toBeNull();
    expect(lerHistorico([])).toEqual([]);
  });

  it("lê os campos do contrato e descarta item sem id", () => {
    const r = lerHistorico([v(), { numero: 9 }, null])!;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ numero: 2, autor: "Ana", valor_total: 448, valor_anterior: 400, qtd_itens: 3 });
    expect(r[0].o_que_mudou?.itens_mudados).toBe(2);
  });

  it("versão 1 não tem o que mudou nem valor anterior", () => {
    const [p] = lerHistorico([v({ numero: 1, o_que_mudou: null, valor_anterior: null })])!;
    expect(p.o_que_mudou).toBeNull();
    expect(p.valor_anterior).toBeNull();
    expect(frasesDoQueMudou(p)).toEqual(["Primeira versão."]);
  });
});

describe("frases", () => {
  it("diz o que mudou em português simples", () => {
    const [p] = lerHistorico([v()])!;
    expect(frasesDoQueMudou(p)).toEqual(["1 item novo.", "2 itens mudados.", "Mudou: valor total."]);
  });

  it("sem mudança, e retrato antigo sem lista de itens", () => {
    const [a] = lerHistorico([v({ o_que_mudou: { mudou: false } })])!;
    expect(frasesDoQueMudou(a)).toEqual(["Nada mudou em relação à versão anterior."]);
    const [b] = lerHistorico([v({ retroativa: true, o_que_mudou: { mudou: true, retrato_sem_itens: true } })])!;
    expect(frasesDoQueMudou(b).join(" ")).toContain("não guardou a lista de itens");
  });

  it("autor nulo vira Autor não registrado e a aprovada tem rótulo próprio", () => {
    expect(autorDaVersao({ autor: null })).toBe(AUTOR_NAO_REGISTRADO);
    expect(rotuloDaVersao({ status: "enviada", e_a_aprovada: true })).toBe("Versão aprovada");
    expect(rotuloDaVersao({ status: "enviada", e_a_aprovada: false })).toBe("Enviada ao cliente");
  });

  it("nenhuma frase fixa usa travessão, seta ou parênteses", () => {
    const fonte = ler("src/domain/orcamentos/historico-de-versoes.ts") + ler("src/components/orcamento/historico-de-versoes.tsx");
    const textos = [...fonte.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1]).filter((t) => /\s/.test(t) && !t.includes("@/") && !t.includes("rounded"));
    for (const t of textos.filter((t) => /[ãçé]/.test(t))) expect(t, t).not.toMatch(/[—–→()]/);
  });
});

describe("o card na tela", () => {
  const card = ler("src/components/orcamento/historico-de-versoes.tsx");
  const rota = ler("src/routes/_authenticated/orcamentos.$id.tsx");

  it("chama a função do banco e tem estados de carregando, vazio e erro", () => {
    expect(card).toContain('"orcamento_historico_de_versoes", { p_orcamento: orcamentoId }');
    expect(card).toContain('data-estado="vazio"');
    expect(card).toContain('data-estado="erro"');
    expect(card).toContain("Tentar de novo");
    expect(card).toContain("TEXTO_HISTORICO_INDISPONIVEL");
  });

  it("função ausente nunca vira estado vazio", () => {
    expect(card).toContain("if (funcaoAusente(error)) throw new HistoricoIndisponivel()");
    expect(card).toContain("if (!lido) throw");
  });

  it("a rota mostra o card só para quem vê preço, no passo de revisão", () => {
    expect(rota).toContain("{canSeePrices && <HistoricoDeVersoes orcamentoId={id} />}");
  });
});
