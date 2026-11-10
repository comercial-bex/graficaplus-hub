import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FRASE_DE_FALHA_DA_FAIXA,
  apelidoDoCampo,
  apelidoDoTermo,
  frasesDaFaixa,
  listaEmFrase,
  orcamentoPedeConferirVersao,
  type DiferencaDaVersao,
} from "../src/domain/orcamentos/o-que-mudou";

/**
 * A faixa "Mudou depois de enviado/aprovado" em português simples (10/11/2026). A RPC devolve contagens e
 * nomes de coluna; estas frases são o que a pessoa lê. Os números abaixo são os exemplos do relatório da
 * decisão 7 (orçamento 175: o cliente recebeu R$ 530,30 e hoje está em R$ 366,00).
 */

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const base: DiferencaDaVersao = {
  tem_versao: true,
  numero: 2,
  status: "enviada",
  retroativa: false,
  valor_da_versao: 530.3,
  valor_atual: 366,
  mudou: true,
  valor_mudou: true,
  o_que_mudou: {
    mudou: true,
    itens_novos: 1,
    itens_tirados: 1,
    itens_mudados: 0,
    campos: [],
    termos: [],
  },
};

describe("quando a faixa aparece", () => {
  it("só em orçamento enviado ou aprovado", () => {
    expect(frasesDaFaixa(base, "enviado")).not.toBeNull();
    expect(frasesDaFaixa(base, "aprovado")).not.toBeNull();
    for (const status of ["rascunho", "convertido", "rejeitado", "expirado", "", null, undefined]) {
      expect(frasesDaFaixa(base, status), String(status)).toBeNull();
    }
    expect(orcamentoPedeConferirVersao("enviado")).toBe(true);
    expect(orcamentoPedeConferirVersao("convertido")).toBe(false);
  });

  it("não aparece sem versão nem sem mudança", () => {
    expect(frasesDaFaixa({ tem_versao: false }, "enviado")).toBeNull();
    expect(frasesDaFaixa(null, "enviado")).toBeNull();
    expect(frasesDaFaixa(undefined, "enviado")).toBeNull();
    expect(
      frasesDaFaixa(
        { ...base, mudou: false, valor_mudou: false, o_que_mudou: { mudou: false, termos: [] } },
        "enviado",
      ),
    ).toBeNull();
  });

  it("mudança só nos termos do cabeçalho também acende (o cliente vê isso no documento)", () => {
    const f = frasesDaFaixa(
      {
        ...base,
        mudou: false,
        valor_mudou: false,
        valor_da_versao: 210,
        valor_atual: 210,
        o_que_mudou: { mudou: false, termos: ["condicao_pagamento.forma"] },
      },
      "enviado",
    );
    expect(f?.oQueMudou).toEqual(["Mudou: forma de pagamento."]);
    expect(f?.valor).toBe(`O valor continua ${brl(210)}.`);
  });
});

describe("o que a pessoa lê", () => {
  it("enviado, valor mudou, item novo e item tirado", () => {
    const f = frasesDaFaixa(base, "enviado");
    expect(f?.titulo).toBe("Mudou depois de enviado");
    expect(f?.valor).toBe(
      `O cliente recebeu ${brl(530.3)} e hoje o orçamento está em ${brl(366)}.`,
    );
    expect(f?.oQueMudou).toEqual(["Mudou: 1 item novo, 1 item tirado."]);
    expect(f?.oQueFazer).toBe("Envie de novo para o cliente ver o orçamento certo.");
  });

  it("item mudado: apelidos sem repetir (largura e altura são medida) e o número de itens", () => {
    const f = frasesDaFaixa(
      {
        ...base,
        o_que_mudou: {
          itens_novos: 0,
          itens_tirados: 0,
          itens_mudados: 2,
          campos: ["quantidade", "valor_total", "valor_unitario"],
          termos: [],
        },
      },
      "enviado",
    );
    expect(f?.oQueMudou).toEqual(["Mudou: quantidade e preço em 2 itens."]);

    const medida = frasesDaFaixa(
      {
        ...base,
        o_que_mudou: { itens_mudados: 1, campos: ["altura", "largura", "area_total"], termos: [] },
      },
      "enviado",
    );
    expect(medida?.oQueMudou).toEqual(["Mudou: medida e área em 1 item."]);
  });

  it("aprovado com valor diferente: o cliente aprovou X, hoje está Y, e para virar OS tem de voltar ao valor", () => {
    const f = frasesDaFaixa({ ...base, status: "aprovada" }, "aprovado");
    expect(f?.titulo).toBe("Mudou depois de aprovado");
    expect(f?.valor).toBe(
      `O cliente aprovou ${brl(530.3)} e hoje o orçamento está em ${brl(366)}.`,
    );
    expect(f?.oQueFazer).toBe(
      "Para virar OS, volte ao valor aprovado ou peça nova aprovação do cliente.",
    );
  });

  it("aprovado com o mesmo valor: diz que não impede de virar OS (a conversão só olha o valor)", () => {
    const f = frasesDaFaixa(
      { ...base, status: "aprovada", valor_atual: 530.3, valor_mudou: false },
      "aprovado",
    );
    expect(f?.valor).toBe(`O valor continua ${brl(530.3)}.`);
    expect(f?.oQueFazer).toBe(
      "O valor é o mesmo, então esta mudança não impede de virar OS. Confira com o cliente se ele sabe da mudança.",
    );
  });

  it("item e termo juntos viram duas frases", () => {
    const f = frasesDaFaixa(
      {
        ...base,
        o_que_mudou: {
          itens_novos: 1,
          itens_tirados: 0,
          itens_mudados: 0,
          campos: [],
          termos: ["validade_dias", "condicao_pagamento.parcelas", "condicao_pagamento.forma"],
        },
      },
      "enviado",
    );
    expect(f?.oQueMudou).toEqual([
      "Mudou: 1 item novo.",
      "Também mudou: validade e forma de pagamento.",
    ]);
  });

  it("plural e singular de itens", () => {
    const f = frasesDaFaixa(
      { ...base, o_que_mudou: { itens_novos: 3, itens_tirados: 2, itens_mudados: 0, termos: [] } },
      "enviado",
    );
    expect(f?.oQueMudou).toEqual(["Mudou: 3 itens novos, 2 itens tirados."]);
  });

  it("versão retroativa diz que é o retrato de 22/10", () => {
    const f = frasesDaFaixa({ ...base, retroativa: true, numero: 1 }, "enviado");
    expect(f?.valor).toContain("A versão 1 é um retrato de 22/10, quando o controle começou.");
  });

  it("banco ainda sem a comparação nova: tolera a ausência e ao menos diz que são os itens", () => {
    const semDetalhe: DiferencaDaVersao = {
      ...base,
      valor_mudou: false,
      valor_atual: 530.3,
      o_que_mudou: undefined,
    };
    expect(frasesDaFaixa(semDetalhe, "enviado")?.oQueMudou).toEqual([
      "Os itens mudaram sem mudar o total.",
    ]);
    expect(frasesDaFaixa({ ...base, o_que_mudou: null }, "enviado")?.oQueMudou).toEqual([]);
  });
});

describe("os apelidos", () => {
  const COLUNAS_DO_ITEM_NO_RETRATO = [
    "descricao",
    "quantidade",
    "unidade",
    "valor_unitario",
    "valor_total",
    "ordem",
    "produto_id",
    "desconto",
    "origem_calculo",
    "largura",
    "altura",
    "acabamento",
    "preco_m2",
    "area_unitaria",
    "area_total",
    "area_minima",
    "area_cobrada",
    "tipo_produto",
    "especificacao",
    "respostas",
    "gerado_por_item_id",
    "instala_item_id",
  ];
  const TERMOS = [
    "cliente_id",
    "validade_dias",
    "prazo",
    "prazo_tipo",
    "data_entrega_prometida",
    "preco_modo",
    "desconto_modo",
    "desconto_informado",
    "desconto_percentual",
    "desconto_valor",
    "precisa_entrega",
    "precisa_instalacao",
    "titulo",
    "observacao_cliente",
    "condicao_pagamento.forma",
    "condicao_pagamento.bandeira",
    "condicao_pagamento.modelo",
    "condicao_pagamento.entrada_pct",
    "condicao_pagamento.entrada_valor",
    "condicao_pagamento.parcelas",
    "condicao_pagamento.intervalo_dias",
    "condicao_pagamento.primeiro_vencimento",
  ];

  it("nenhuma coluna do retrato aparece na tela com o nome do banco", () => {
    for (const c of COLUNAS_DO_ITEM_NO_RETRATO) {
      expect(apelidoDoCampo(c), c).not.toMatch(/_/);
      expect(apelidoDoCampo(c), c).not.toBe("dados do item");
    }
    for (const t of TERMOS) {
      expect(apelidoDoTermo(t), t).not.toMatch(/[_.]/);
      expect(apelidoDoTermo(t), t).not.toBe("condições do orçamento");
    }
  });

  it("coluna desconhecida vira texto genérico, sem vazar o nome interno nem falar de custo", () => {
    expect(apelidoDoCampo("custo_unitario")).toBe("dados do item");
    expect(apelidoDoCampo("coluna_que_nasceu_amanha")).toBe("dados do item");
    expect(apelidoDoTermo("termo_que_nasceu_amanha")).toBe("condições do orçamento");
  });

  it("listaEmFrase junta com vírgula e 'e', sem repetir", () => {
    expect(listaEmFrase([])).toBe("");
    expect(listaEmFrase(["preço"])).toBe("preço");
    expect(listaEmFrase(["preço", "preço"])).toBe("preço");
    expect(listaEmFrase(["a", "b"])).toBe("a e b");
    expect(listaEmFrase(["a", "b", "c"])).toBe("a, b e c");
  });
});

describe("a falha da conferência não some em silêncio", () => {
  it("a frase diz que não deu para conferir, no mesmo estilo do aviso do preço especial", () => {
    expect(FRASE_DE_FALHA_DA_FAIXA).toContain(
      "Não consegui conferir se este orçamento mudou depois de enviado",
    );
  });
});

describe("a faixa na tela", () => {
  const FAIXA = readFileSync("src/components/orcamento/faixa-de-mudanca.tsx", "utf8");
  const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

  it("é legível: 16 px, cor do texto sobre fundo de aviso, sem title nem cor de marca como letra", () => {
    expect(FAIXA).toContain("text-base text-foreground");
    expect(FAIXA).toContain("border-warning/60 bg-warning/15");
    expect(FAIXA).not.toMatch(/\btitle=/);
    expect(FAIXA).not.toMatch(/text-(primary|accent|warning|xs|sm)\b/);
    expect(FAIXA).not.toContain("#fd4746");
  });

  it("o ícone usa a cor do texto (o amarelo sobre o fundo translúcido dá menos de 3 para 1)", () => {
    expect(FAIXA).toContain(
      'className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden="true"',
    );
  });

  it("falha da consulta aparece como alerta, só onde a faixa valeria", () => {
    expect(FAIXA).toContain('role="alert"');
    expect(FAIXA).toContain("erro && orcamentoPedeConferirVersao(statusDoOrcamento)");
    expect(TELA).toContain("const { data: versao, error: versaoErro } = useQuery({");
  });

  it("a tela não repete as frases nem formata o valor da versão", () => {
    expect(TELA).not.toContain("Mudou depois de");
    expect(TELA).not.toContain("brlVersao");
    expect(TELA).not.toContain("text-xs text-warning");
  });
});
