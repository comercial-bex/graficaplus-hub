import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  abasDaPasta,
  avaliarFormula,
  frasesDoHistorico,
  minutosDoProcesso,
  pendenciaDaPergunta,
  produtividadeDe,
  respostasDoTexto,
} from "../src/domain/catalogo/pasta-do-produto";

const medidas = { largura: 2, altura: 1, copias: 3, quantidade: 4 };
const conta = (s: string) => avaliarFormula(s, medidas);

describe("a pasta do produto (01/11/2026)", () => {
  it("as abas: preço só para quem vê preço", () => {
    expect(abasDaPasta({ canSeePrices: true }).map((a) => a.id)).toEqual([
      "descricao", "preco", "parametros", "processos", "formulas", "checklist", "ia", "info", "historico",
    ]);
    expect(abasDaPasta({ canSeePrices: false }).map((a) => a.id)).not.toContain("preco");
  });

  it("a fórmula faz conta com as medidas do item", () => {
    expect(conta("perimetro / 0,5")).toEqual({ ok: true, valor: 12 });
    expect(conta("area * copias")).toEqual({ ok: true, valor: 6 });
    expect(conta("(largura + altura) * 2 - 1")).toEqual({ ok: true, valor: 5 });
    expect(conta("teto(perimetro / 3,5)")).toEqual({ ok: true, valor: 2 });
    expect(conta("max(area; 3) + min(1; quantidade)")).toEqual({ ok: true, valor: 4 });
    expect(conta("-area + 5")).toEqual({ ok: true, valor: 3 });
  });

  it("a fórmula errada diz o que está errado, e nada além de conta roda", () => {
    expect(conta("")).toEqual({ ok: false, erro: "A fórmula está vazia." });
    expect(conta("area / 0")).toEqual({ ok: false, erro: "Divisão por zero." });
    expect(conta("(area")).toEqual({ ok: false, erro: "Falta fechar um parêntese." });
    expect(conta("preco * 2").ok).toBe(false);
    expect(conta("alert(1)").ok).toBe(false);
    expect(conta("constructor.constructor").ok).toBe(false);
    expect(conta("2 3").ok).toBe(false);
  });

  it("o tempo do processo é o setup mais a área pela produtividade", () => {
    const p = { setup_min: 5, produtividade_m2_h: 60 };
    expect(minutosDoProcesso(p, 10)).toBe(15);
  });

  it("sem produtividade o tempo fica em branco, não em zero", () => {
    expect(minutosDoProcesso({ setup_min: 5, produtividade_m2_h: null }, 10)).toBeNull();
  });

  it("a produtividade da família do material vale mais que a geral", () => {
    const p = {
      setup_min: 0,
      produtividade_m2_h: 100,
      produtividade_por_familia: [
        { familias: ["Lonas"], produtividade_m2_h: 90 },
        { familias: ["Vinil", "Adesivos"], produtividade_m2_h: 120 },
      ],
    };
    expect(produtividadeDe(p, "Lonas frontlight")).toBe(90);
    expect(produtividadeDe(p, "Adesivos impressos")).toBe(120);
    expect(produtividadeDe(p, "Placas")).toBe(100);
    expect(produtividadeDe(p, null)).toBe(100);
  });

  it("a pergunta do checklist só grava inteira", () => {
    const base = { pergunta: "Vai embalar?", tipo_resposta: "unica" as const, respostas: ["Sim", "Não"], acoes: [] };
    expect(pendenciaDaPergunta(base)).toBeNull();
    expect(pendenciaDaPergunta({ ...base, pergunta: " " })).toBe("Escreva a pergunta.");
    expect(pendenciaDaPergunta({ ...base, respostas: ["Sim"] })).toBe("Dê pelo menos duas respostas.");
    expect(pendenciaDaPergunta({ ...base, tipo_resposta: "numero", respostas: [] })).toBeNull();
    expect(pendenciaDaPergunta({ ...base, acoes: [{ resposta: "Talvez", processo_id: "p" }] })).toContain("Talvez");
    expect(pendenciaDaPergunta({ ...base, acoes: [{ resposta: "Sim", processo_id: "" }] })).toBe("Escolha o processo de cada ação.");
  });

  it("as respostas digitadas viram lista sem repetir", () => {
    expect(respostasDoTexto("Sim, Não, , Sim")).toEqual(["Sim", "Não"]);
  });

  it("o histórico fala português e não guarda valor", () => {
    expect(frasesDoHistorico("update", { tabela: "produtos", campos: ["preco_base", "nome"] })).toBe("Cadastro: alterou preço, nome");
    expect(frasesDoHistorico("insert", { tabela: "produto_perguntas", campos: [] })).toBe("Checklist: item incluído");
    expect(frasesDoHistorico("delete", { tabela: "produto_formulas" })).toBe("Fórmulas: item removido");
  });
});

describe("o contrato da pasta", () => {
  const sql = readFileSync("supabase/migrations/20261101300000_pasta_do_produto.sql", "utf8");
  const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
  const lista = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");

  it("as tabelas novas nascem fechadas ao público e o histórico não guarda valor", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.%I FROM anon");
    expect(sql).toContain("jsonb_build_object('tabela', TG_TABLE_NAME, 'campos', to_jsonb(v_mudou))");
  });

  it("produtividade nasce vazia e o roteiro da IA nasce desligado", () => {
    expect(sql).toContain("INSERT INTO public.processos (nome, etapa, tipo_maquina)");
    expect(sql).toContain("ia_habilitado boolean NOT NULL DEFAULT false");
  });

  it("a pasta é aberta pela lista e confere a gravação", () => {
    expect(lista).toContain('to="/produtos/$id"');
    expect(pasta).toContain(".select(");
    expect(pasta).toContain("Nada foi gravado");
  });
});
