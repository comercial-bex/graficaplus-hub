import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  centesimosDigitados,
  descontoEmCentavos,
  erroDoDesconto,
  fraseDaAlcada,
  lerSituacao,
  previaDoDesconto,
  textoDoInformado,
} from "../src/domain/orcamentos/desconto";
import { pendenciasParaEnviar } from "../src/domain/orcamentos/acordo";
import { dicaAcao, dicaCampo } from "../src/lib/dicas";

/**
 * Desconto no orçamento (06/10/2026).
 *
 * A regra é do banco: o gatilho de totais de `orcamentos` recusa desconto
 * acima da alçada sem `desconto.approve`, e a conversão em OS recusa o que
 * ficou pendente — o ensaio com vendedor, gestor, admin, financeiro e operador
 * está no relatório da migração 20261006230000. Aqui ficam: o espelho da conta
 * em centavos (que a tela mostra antes de perguntar ao banco), as frases que
 * os dois lados compartilham e as travas de contrato que impedem a tela e a
 * migração de se separarem.
 */

const MIGRACAO = readFileSync(
  "supabase/migrations/20261006230000_desconto_no_orcamento.sql",
  "utf8",
);
const QUADRO = readFileSync("src/components/orcamento/desconto-do-orcamento.tsx", "utf8");
const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

/** O corpo de uma função da migração, entre os delimitadores $fn$ / $function$. */
function corpo(nome: string): string {
  const inicio = MIGRACAO.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `a migração define ${nome}`).toBeGreaterThan(-1);
  const resto = MIGRACAO.slice(inicio);
  const m = /AS (\$\w*\$)([\s\S]*?)\1/.exec(resto);
  return m ? m[2] : "";
}

describe("o que se digita", () => {
  it("lê o jeito brasileiro e o ponto decimal, em centésimos exatos", () => {
    expect(centesimosDigitados("10")).toBe(1000);
    expect(centesimosDigitados("10,5")).toBe(1050);
    expect(centesimosDigitados("7,25")).toBe(725);
    expect(centesimosDigitados("10.5")).toBe(1050);
    expect(centesimosDigitados("R$ 70,00")).toBe(7000);
    expect(centesimosDigitados("15%")).toBe(1500);
    // ponto com três dígitos e sem vírgula é milhar, como se escreve dinheiro aqui
    expect(centesimosDigitados("1.500")).toBe(150_000);
    expect(centesimosDigitados("1.500,50")).toBe(150_050);
    expect(centesimosDigitados("")).toBe(0);
    expect(centesimosDigitados("abc")).toBeNull();
    expect(centesimosDigitados("-5")).toBe(-500);
  });

  it("a terceira casa arredonda como o numeric(12,2) do banco: meio para longe do zero", () => {
    // Em ponto flutuante 1,005 × 100 = 100,49999… e viraria 1,00.
    expect(centesimosDigitados("1,005")).toBe(101);
    expect(centesimosDigitados("1,004")).toBe(100);
    expect(centesimosDigitados("12,3456")).toBe(1235);
  });

  it("volta para o campo sem casas inúteis", () => {
    expect(textoDoInformado(1050)).toBe("10,5");
    expect(textoDoInformado(1000)).toBe("10");
    expect(textoDoInformado(150_050)).toBe("1500,5");
  });
});

/**
 * `round(subtotal × pct ÷ 100, 2)` do Postgres com aritmética exata (BigInt):
 * em centavos e centésimos, round(S × P ÷ 10.000), meio para longe do zero.
 */
function descontoDoBanco(subtotalCentavos: number, pctCentesimos: number): number {
  const x = BigInt(subtotalCentavos) * BigInt(pctCentesimos);
  return Number((2n * x + 10_000n) / 20_000n);
}

describe("a conta do desconto é a do banco (desconto_em_reais)", () => {
  it("percentual: igual ao Postgres em todo subtotal de R$ 0,01 a R$ 2.000,00 × 37 percentuais", () => {
    const percentuais = [
      1, 5, 33, 50, 99, 100, 250, 333, 499, 500, 501, 750, 999, 1000, 1001, 1234, 1250, 1500, 1666,
      2000, 2500, 3333, 3750, 3848, 4000, 4500, 5000, 5555, 6000, 6666, 7000, 7500, 8000, 8888,
      9000, 9999, 10000,
    ];
    const erros: string[] = [];
    for (let s = 1; s <= 200_000; s++) {
      for (const p of percentuais) {
        const tela = descontoEmCentavos(s, 0, "percentual", p);
        const banco = Math.min(descontoDoBanco(s, p), s);
        if (tela !== banco && erros.length < 5)
          erros.push(`R$ ${s / 100} a ${p / 100}%: tela ${tela}, banco ${banco}`);
      }
    }
    expect(erros).toEqual([]);
  });

  it("nunca passa do que sobra depois do crédito do parceiro, nem fica negativo", () => {
    expect(descontoEmCentavos(30_080, 4_512, "valor", 30_000)).toBe(25_568);
    expect(descontoEmCentavos(30_080, 4_512, "percentual", 10_000)).toBe(25_568);
    expect(descontoEmCentavos(70_000, 0, "valor", -500)).toBe(0);
  });

  it("os números do ensaio de 06/10/2026 batem", () => {
    // #75: R$ 700,00 a 10% → R$ 70,00; total R$ 630,00
    expect(previaDoDesconto(70_000, 0, "percentual", 1000)).toEqual({
      erro: null,
      descontoCentavos: 7000,
      totalCentavos: 63_000,
      pct: 10,
    });
    // #65: R$ 300,80 com crédito de R$ 45,12 e 5% → R$ 15,04; total R$ 240,64
    expect(previaDoDesconto(30_080, 4_512, "percentual", 500).totalCentavos).toBe(24_064);
    // #62: 10% de R$ 57,60 → R$ 5,76
    expect(previaDoDesconto(5_760, 0, "percentual", 1000).descontoCentavos).toBe(576);
  });
});

describe("as frases são as mesmas nos dois lados", () => {
  it("cada mensagem de entrada da tela está, palavra por palavra, em desconto_erro_de_entrada", () => {
    const sql = corpo("desconto_erro_de_entrada");
    for (const caso of [
      erroDoDesconto(70_000, 0, "valor", -1),
      erroDoDesconto(0, 0, "valor", 100),
      erroDoDesconto(70_000, 0, "percentual", 12_000),
    ]) {
      expect(caso).not.toBeNull();
      expect(sql).toContain(caso as string);
    }
    const passou = erroDoDesconto(70_000, 0, "valor", 80_000);
    expect(passou).toBe("O desconto de R$ 800,00 passa do valor do orçamento (R$ 700,00).");
    expect(sql).toContain("'O desconto de R$ '");
    expect(sql).toContain("' passa do valor do orçamento (R$ '");
    expect(erroDoDesconto(70_000, 0, "valor", 0)).toBeNull();
  });

  it("toda mensagem do banco tem acento — sem ele, mensagemErro a troca por 'Não foi possível…'", () => {
    const mensagens = [
      ...MIGRACAO.matchAll(/RAISE EXCEPTION '([^']+)'/g),
      ...corpo("desconto_erro_de_entrada").matchAll(/RETURN '([^']+)';/g),
    ]
      .map((m) => m[1])
      .filter((t) => t !== "%");
    expect(mensagens.length).toBeGreaterThan(8);
    for (const m of mensagens) expect(m, m).toMatch(/[ãõçáéíóúâêôà]/i);
  });
});

describe("a resposta do banco", () => {
  it("lê o que veio e não inventa o que não veio (custo só para quem vê o financeiro)", () => {
    const vendedor = lerSituacao({
      orcamento_id: "x",
      modo: "percentual",
      informado: 10,
      subtotal: 700,
      desconto: 70,
      total: 630,
      regra: "margem",
      alcada: "vendedor",
      pode_aplicar: true,
    });
    expect(vendedor).toMatchObject({
      modo: "percentual",
      subtotal: 700,
      total: 630,
      alcada: "vendedor",
      pode_aplicar: true,
    });
    expect(vendedor.minimo).toBeUndefined();
    expect(vendedor.piso).toBeUndefined();
    expect(lerSituacao({ alcada: "qualquer" }).alcada).toBe("sem_desconto");
    expect(lerSituacao({ minimo: 430.62, piso: 243.9 })).toMatchObject({
      minimo: 430.62,
      piso: 243.9,
    });
  });

  it("a frase da alçada fala com quem está olhando", () => {
    expect(
      fraseDaAlcada({ alcada: "vendedor", regra: "limite_fixo", pode_aprovar: false }),
    ).toContain("até 10%");
    expect(fraseDaAlcada({ alcada: "gerente", regra: "margem", pode_aprovar: false })).toContain(
      "precisa de quem aprova",
    );
    expect(fraseDaAlcada({ alcada: "gerente", regra: "margem", pode_aprovar: true })).toContain(
      "você aprova",
    );
  });
});

describe("pendências antes de mandar ao cliente", () => {
  const base = {
    temClienteOuContato: true,
    dataEntrega: "2026-10-10",
    verPreco: true,
    temCondicao: true,
    itens: [{ arquivo_id: "a" }],
  };
  it("desconto esperando aprovação entra na lista — o cliente veria um desconto que ninguém deu", () => {
    expect(pendenciasParaEnviar({ ...base, descontoPendente: true })).toEqual([
      "aprovação do desconto",
    ]);
    expect(pendenciasParaEnviar({ ...base, descontoPendente: false })).toEqual([]);
    expect(pendenciasParaEnviar({ ...base, verPreco: false, descontoPendente: true })).toEqual([]);
  });
});

describe("contrato entre a migração, a tela e as dicas", () => {
  it("a guarda é o gatilho de totais, com a chave desconto.approve", () => {
    const gatilho = corpo("tg_parceiro_credito_no_total");
    expect(gatilho).toContain("public.has_permission(v_uid, 'desconto.approve')");
    // aprovação só o gatilho escreve: o que vem da API é trocado pelo valor antigo
    expect(gatilho).toContain("NEW.desconto_aprovado_por := OLD.desconto_aprovado_por;");
    // total = subtotal − desconto − crédito, em centavos
    expect(gatilho).toContain(
      "NEW.valor_total := GREATEST(round(v_sub - v_desc - v_credito, 2), 0);",
    );
    // desconto pendente não vira OS
    expect(corpo("converter_orcamento_em_os")).toContain(
      "IF (v_desconto->>'pendente')::boolean THEN",
    );
  });

  it("custo, mínimo e piso não saem para quem não vê o financeiro", () => {
    const leitura = corpo("desconto_do_orcamento");
    expect(leitura).toContain("IF NOT public.can_see_financials(v_uid) THEN");
    expect(leitura).toContain("v_s - 'custo' - 'minimo' - 'piso' - 'desconto_ate_piso'");
    // e "abaixo do piso" vira "gerente": separar deixaria achar o piso por tentativa
    expect(leitura).toContain("jsonb_set(v_s, '{alcada}', to_jsonb('gerente'::text))");
  });

  it("função nova fecha o anon; as internas não abrem para ninguém", () => {
    for (const interna of [
      "desconto_em_reais(numeric, numeric, text, numeric)",
      "desconto_erro_de_entrada(numeric, numeric, text, numeric)",
      "desconto_avaliar(uuid, numeric, numeric, numeric)",
      "desconto_situacao_interna(uuid, text, numeric)",
      "tg_parceiro_credito_no_total()",
    ]) {
      expect(MIGRACAO).toContain(
        `REVOKE ALL ON FUNCTION public.${interna} FROM PUBLIC, anon, authenticated;`,
      );
    }
    for (const daTela of ["desconto_do_orcamento", "definir_desconto_do_orcamento"]) {
      expect(MIGRACAO).toContain(
        `REVOKE ALL ON FUNCTION public.${daTela}(uuid, text, numeric) FROM PUBLIC, anon;`,
      );
      expect(MIGRACAO).toContain(
        `GRANT EXECUTE ON FUNCTION public.${daTela}(uuid, text, numeric) TO authenticated;`,
      );
    }
  });

  it("a view de resultado continua rodando com a permissão de quem lê", () => {
    // CREATE OR REPLACE VIEW sem o WITH zera a opção e a view passa a ignorar a RLS.
    expect(MIGRACAO).toContain(
      "CREATE OR REPLACE VIEW public.vw_resultado_os WITH (security_invoker = true) AS",
    );
  });

  it("a trava de 10% sai da OS (a régua é a do orçamento, conferida antes)", () => {
    expect(corpo("os_bloqueios_para")).not.toContain("'desconto_alto'");
  });

  it("o quadro só fala com o banco pelas duas funções e nunca lê coluna de custo", () => {
    expect(QUADRO).toContain('("desconto_do_orcamento"');
    expect(QUADRO).toContain('("definir_desconto_do_orcamento"');
    expect(QUADRO).not.toMatch(/\.from\(/);
    expect(QUADRO).not.toMatch(/custo_(unitario|medio|estimado|cheio)/);
  });

  it("a tela mostra o quadro só para quem vê preço, antes do Pagamento", () => {
    const quadro = TELA.indexOf("<DescontoDoOrcamento");
    const pagamento = TELA.indexOf("<Pagamento");
    expect(quadro).toBeGreaterThan(-1);
    expect(quadro).toBeLessThan(pagamento);
    // logo antes do quadro, o portão de preço
    expect(TELA.slice(0, quadro).trimEnd().endsWith("{canSeePrices && (")).toBe(true);
    expect(TELA).toContain("useDescontoDoOrcamento(id, canSeePrices)");
  });

  it("toda dica que o quadro usa existe em dicas.ts", () => {
    const campos = [...QUADRO.matchAll(/dicaCampo\("\/orcamentos", "([a-z_]+)"\)/g)].map(
      (m) => m[1],
    );
    const acoes = [...QUADRO.matchAll(/dicaAcao\("\/orcamentos", "([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(campos.length).toBeGreaterThan(6);
    for (const c of campos) expect(dicaCampo("/orcamentos", c), c).toBeTruthy();
    for (const a of acoes) expect(dicaAcao("/orcamentos", a), a).toBeTruthy();
  });
});
