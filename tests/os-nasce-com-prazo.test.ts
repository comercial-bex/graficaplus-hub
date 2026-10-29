import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  conferenciaAntesDeConverter,
  prazoDaOsAoConverter,
  somarDiasUteis,
  textoDaOsSemDataDeEntrega,
} from "../src/domain/orcamentos/acordo";

/**
 * A OS 212 (Marcela, orçamento 150, 29/10/2026) nasceu sem prazo: o orçamento nunca teve data de entrega (o
 * botão "Sugerir entrega" é opcional) e a conversão copiava `orcamentos.prazo` como estava. A 2ª parcela do
 * 50% + 50% ficou sem vencimento e a OS nunca apareceria como atrasada. A conversão agora dá um prazo à OS,
 * e a tela diz ao vendedor qual será.
 */
const PASTA = "supabase/migrations";
const MIGRACAO = "20261029400000_os_nasce_com_prazo.sql";
const SQL = readFileSync(join(PASTA, MIGRACAO), "utf8");

// Quinta-feira. Os casos abaixo foram rodados no banco com esta mesma data (ensaio com rollback, 29/10).
const HOJE = "2026-10-29";

describe("o prazo com que a OS nasce (tela)", () => {
  it("herda o prazo do orçamento, quando ele existe", () => {
    expect(
      prazoDaOsAoConverter({ prazo: "2026-11-07", data_entrega_prometida: "2026-11-09", prazo_tipo: "normal" }, HOJE, 5),
    ).toEqual({ data: "2026-11-07", origem: "orcamento" });
  });

  it("sem prazo, herda a data de entrega prometida ao cliente", () => {
    expect(
      prazoDaOsAoConverter({ prazo: null, data_entrega_prometida: "2026-11-01", prazo_tipo: "normal" }, HOJE, 5),
    ).toEqual({ data: "2026-11-01", origem: "entrega_prometida" });
  });

  it("sem nenhuma das duas, pedido normal ganha o prazo padrão da casa (5 dias úteis)", () => {
    expect(
      prazoDaOsAoConverter({ prazo: null, data_entrega_prometida: null, prazo_tipo: "normal" }, HOJE, 5),
    ).toEqual({ data: "2026-11-05", origem: "padrao_da_casa" });
  });

  it("pedido expresso sem data nasce sem prazo, de propósito", () => {
    expect(
      prazoDaOsAoConverter({ prazo: null, data_entrega_prometida: null, prazo_tipo: "expresso" }, HOJE, 5),
    ).toEqual({ data: null, origem: "sem_prazo" });
  });

  it("os dias úteis pulam o fim de semana, como somar_dias_uteis do banco", () => {
    expect(somarDiasUteis("2026-10-29", 5)).toBe("2026-11-05"); // quinta + 5 úteis
    expect(somarDiasUteis("2026-10-30", 5)).toBe("2026-11-06"); // sexta + 5 úteis
    expect(somarDiasUteis("2026-10-31", 1)).toBe("2026-11-02"); // sábado + 1 útil = segunda
  });

  it("a tela conta o que vai acontecer", () => {
    expect(textoDaOsSemDataDeEntrega({ data: "2026-11-05", origem: "padrao_da_casa" })).toBe(
      "Sem data, o PDF não mostra a entrega e a OS nasce com o prazo padrão da casa, 05/11/2026.",
    );
    expect(textoDaOsSemDataDeEntrega({ data: "2026-11-07", origem: "orcamento" })).toBe(
      "O PDF não mostra a entrega. A OS nasce com o prazo da produção, 07/11/2026.",
    );
    expect(textoDaOsSemDataDeEntrega({ data: null, origem: "sem_prazo" })).toContain("nunca aparece como atrasada");
  });
});

describe("a tela não promete prazo para orçamento que já virou OS", () => {
  const COMPONENTE = readFileSync("src/components/orcamento/acordo-do-orcamento.tsx", "utf8");
  const ROTA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

  it("o quadro da entrega recebe se o orçamento já virou OS e então só informa", () => {
    expect(COMPONENTE).toContain("jaVirouOs = false,");
    expect(COMPONENTE).toContain("Sem data de entrega neste orçamento. A OS já foi criada: o prazo dela se define na própria OS.");
    // com a OS criada, o texto do prazo padrão ("a OS nasce com...") não aparece
    const texto = COMPONENTE.slice(COMPONENTE.indexOf(": jaVirouOs"), COMPONENTE.indexOf(": jaVirouOs") + 400);
    expect(texto.indexOf("A OS já foi criada")).toBeLessThan(texto.indexOf("textoDaOsSemDataDeEntrega"));
  });

  it("a rota passa a informação: OS ligada ao orçamento ou status convertido", () => {
    expect(ROTA).toContain('jaVirouOs={!!(orc as any).os_id || orc.status === "convertido"}');
  });
});

describe("a conferência antes de converter conta o que vai acontecer com o prazo", () => {
  const base = {
    temCliente: true,
    dataEntrega: null as string | null,
    verPreco: true,
    forma: "PIX",
    condicaoCompleta: true,
    pixRecebido: true,
    itensSemArte: 0,
    descontoPendente: false,
  };
  const entrega = (o: Parameters<typeof conferenciaAntesDeConverter>[0]) =>
    conferenciaAntesDeConverter(o).find((i) => i.chave === "entrega")!;

  it("sem data, pedido normal: aviso, e diz o prazo padrão com que a OS nasce", () => {
    const i = entrega({ ...base, prazoDaOs: { data: "2026-11-05", origem: "padrao_da_casa" } });
    expect(i.ok).toBe(false);
    expect(i.nivel).toBe("aviso");
    expect(i.detalhe).toBe("O cliente não recebeu data de entrega. A OS nasce com o prazo padrão da casa, 05/11/2026.");
  });

  it("sem data, pedido expresso: obrigatório, a OS nasce sem prazo", () => {
    const i = entrega({ ...base, prazoDaOs: { data: null, origem: "sem_prazo" } });
    expect(i.nivel).toBe("obrigatorio");
    expect(i.detalhe).toBe("Sem data a OS nasce sem prazo (e sai nos alertas).");
  });

  it("com data: a OS herda, como antes", () => {
    const i = entrega({ ...base, dataEntrega: "2026-11-02", prazoDaOs: { data: "2026-11-02", origem: "entrega_prometida" } });
    expect(i.ok).toBe(true);
    expect(i.detalhe).toBe("A OS herda a data e entra na agenda.");
  });

  it("quem não informa o prazo da OS continua com a conferência de antes", () => {
    const i = entrega({ ...base });
    expect(i.nivel).toBe("obrigatorio");
    expect(i.detalhe).toBe("Sem data a OS nasce sem prazo (e sai nos alertas).");
  });
});

describe("o banco faz a mesma conta (migração de 29/10)", () => {
  it("é a última definição de converter_orcamento_em_os", () => {
    const ultima = readdirSync(PASTA)
      .filter((nome) => nome.endsWith(".sql"))
      .sort()
      .filter((nome) =>
        readFileSync(join(PASTA, nome), "utf8").includes("CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os("),
      )
      .pop();
    expect(ultima).toBe(MIGRACAO);
  });

  it("prazo do orçamento, senão a entrega prometida, senão o padrão da casa só para pedido normal", () => {
    expect(SQL).toContain("v_prazo := COALESCE(v_orc.prazo, v_orc.data_entrega_prometida);");
    expect(SQL).toContain("IF v_prazo IS NULL AND v_orc.prazo_tipo IS NOT DISTINCT FROM 'normal' THEN");
    expect(SQL).toContain("public.somar_dias_uteis(");
    expect(SQL).toContain("(now() AT TIME ZONE 'America/Belem')::date");
    expect(SQL).toContain("c.codigo = 'prazo_entrega_padrao_dias'");
    // 0 ou ausente volta a 5, como `usePrazoPadraoDias` na tela
    expect(SQL).toContain("COALESCE(NULLIF((SELECT max(c.valor) FROM public.custos_tabela c");
    expect(SQL).toContain(")::int, 0), 5)");
  });

  it("a mesma chave é lida pela tela e pelo banco", () => {
    const tela = readFileSync("src/components/orcamento/acordo-do-orcamento.tsx", "utf8");
    expect(tela).toContain('"prazo_entrega_padrao_dias"');
    expect(SQL).toContain("'prazo_entrega_padrao_dias'");
  });

  it("a OS nasce com o prazo calculado, não com o campo cru do orçamento", () => {
    expect(SQL).toContain("    v_prazo, v_orc.valor_total, v_orc.custo_estimado,");
    expect(SQL).not.toContain("    v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado,");
  });

  it("as parcelas em várias vezes partem do prazo da OS", () => {
    expect(SQL).toContain("WHEN v_modelo IN ('entrada', 'metade_metade') THEN COALESCE(v_prazo, v_hoje)");
  });

  it("o evento guarda o prazo e de onde ele veio", () => {
    expect(SQL).toContain("'prazo', v_prazo, 'prazo_origem', COALESCE(v_prazo_origem, 'sem_prazo')");
  });

  it("as travas anteriores continuam: condição de pagamento, Pix, item sem custo", () => {
    expect(SQL).toContain("-- (b4) Condição de pagamento obrigatória");
    expect(SQL).toContain("-- (b3) Sinal em Pix");
    expect(SQL).toContain("-- (b2) item livre sem custo não vira OS");
    expect(SQL).toContain("SECURITY DEFINER");
  });
});
