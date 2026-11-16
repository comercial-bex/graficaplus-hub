import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({}) }));

import { BlocoDeCustosFixos } from "../../src/components/custos/custos-fixos-da-grafica";
import {
  CODIGOS_DE_CUSTO_FIXO,
  contagemDePendentes,
  estaPendente,
  formatarCustoFixo,
  fraseDaConfirmacao,
  fraseDoContador,
  itensDeCustoFixo,
  lerValorDeCusto,
  maoDeObraPorHora,
  mensagemDoSalvarCusto,
  podeEditarCustosFixos,
  type LinhaDeCustoFixo,
} from "../../src/domain/custos/custos-fixos";
import { permissions, rolePermissions } from "../../src/lib/permissions";
import { CHAVES_CONFERIDAS_NA_TELA } from "../../src/domain/acesso/uso-na-tela";
import {
  ehPlotterI1600,
  TEXTO_DA_VELOCIDADE_DA_PLOTTER,
} from "../../src/domain/maquinas/velocidade-de-calculo";

const linha = (codigo: string, o: Partial<LinhaDeCustoFixo> = {}): LinhaDeCustoFixo => ({
  id: `id-${codigo}`,
  codigo,
  valor: null,
  unidade: null,
  observacao: null,
  confirmado_em: null,
  confirmado_por: null,
  ...o,
});

describe("os códigos do contrato com o banco", () => {
  it("são os nove da migração, e os de pessoal só aparecem", () => {
    expect([...CODIGOS_DE_CUSTO_FIXO].sort()).toEqual(
      [
        "aluguel_espaco_mensal",
        "outros_fixos_admin_mes",
        "plotter_horas_mes_reais",
        "energia_comercial_tarifa_kwh",
        "tinta_consumo_ml_m2",
        "plotter_manutencao_mensal",
        "plotter_cabecote_custo",
        "plotter_cabecote_vida_m2",
        "plotter_limpeza_mensal",
      ].sort(),
    );
  });
});

describe("pendente", () => {
  it("valor vazio ou sem confirmação é pendente; só os dois juntos fecham", () => {
    expect(estaPendente({ valor: null, confirmado_em: "2026-11-15T10:00:00Z" })).toBe(true);
    expect(estaPendente({ valor: 2000, confirmado_em: null })).toBe(true);
    expect(estaPendente({ valor: 2000, confirmado_em: "2026-11-15T10:00:00Z" })).toBe(false);
    expect(estaPendente(null)).toBe(true);
  });
  it("custo que não existe no banco aparece como pendente, não some", () => {
    const itens = itensDeCustoFixo([
      linha("aluguel_espaco_mensal", { valor: 2000, confirmado_em: "2026-11-15T10:00:00Z" }),
    ]);
    expect(itens).toHaveLength(11);
    expect(contagemDePendentes(itens)).toEqual({ pendentes: 8, total: 9 });
    expect(fraseDoContador({ pendentes: 8, total: 9 })).toBe("8 de 9 pendentes.");
    expect(fraseDoContador({ pendentes: 0, total: 9 })).toBe(
      "Os 9 custos fixos estão confirmados.",
    );
  });
});

describe("valor digitado", () => {
  it("aceita vírgula, ponto de milhar e 4 casas", () => {
    expect(lerValorDeCusto("2000", false)).toBe(2000);
    expect(lerValorDeCusto("2.000,50", false)).toBe(2000.5);
    expect(lerValorDeCusto("1,1339", false)).toBe(1.1339);
    expect(lerValorDeCusto("R$ 2.000", false)).toBe(2000);
  });
  it("recusa vazio, texto, negativo e zero, menos onde zero é resposta", () => {
    expect(lerValorDeCusto("", false)).toBeNull();
    expect(lerValorDeCusto("abc", false)).toBeNull();
    expect(lerValorDeCusto("-5", false)).toBeNull();
    expect(lerValorDeCusto("0", false)).toBeNull();
    expect(lerValorDeCusto("0", true)).toBe(0);
  });
});

describe("textos", () => {
  it("formata a unidade por extenso, sem barra solta", () => {
    expect(formatarCustoFixo(2000, "R$/mês")).toBe("R$ 2.000,00 por mês");
    expect(formatarCustoFixo(1.1339, "R$/kWh")).toContain("por quilowatt hora");
    expect(formatarCustoFixo(32.82, "%")).toBe("32,82 por cento");
    expect(formatarCustoFixo(160, "h/mês")).toBe("160 horas por mês");
    expect(formatarCustoFixo(null, "R$")).toBe("Sem valor");
  });
  it("quem confirmou e quando, com o fuso de Macapá", () => {
    expect(
      fraseDaConfirmacao(
        linha("a", { valor: 1, confirmado_em: "2026-11-15T12:00:00Z", confirmado_por: "u1" }),
        { u1: "Cibele" },
      ),
    ).toBe("Confirmado por Cibele em 15/11/2026.");
    expect(fraseDaConfirmacao(linha("a", { valor: 1 }), {})).toContain("Falta confirmar");
    expect(fraseDaConfirmacao(linha("a"), {})).toContain("Falta preencher");
    expect(fraseDaConfirmacao(null, {})).toContain("Falta preencher");
  });
  it("mão de obra por hora com encargos", () => {
    expect(maoDeObraPorHora(9.2102, 32.82)).toBe(12.23);
    expect(maoDeObraPorHora(null, 32.82)).toBeNull();
  });
  it("função ou coluna ausente vira frase humana, erro de regra passa como está", () => {
    expect(
      mensagemDoSalvarCusto(
        "Could not find the function public.confirmar_custo_fixo(p_codigo, p_valor) in the schema cache",
      ),
    ).toContain("Avise o suporte");
    expect(mensagemDoSalvarCusto('column "confirmado_em" does not exist')).toContain(
      "Avise o suporte",
    );
    expect(mensagemDoSalvarCusto("Sem permissão para confirmar custos.")).toBe(
      "Sem permissão para confirmar custos.",
    );
  });
});

describe("a permissão custos.fixos.update", () => {
  it("existe na lista, é conferida na tela e é de admin; a concessão ao gestor e ao financeiro vem da migração", () => {
    expect(permissions).toContain("custos.fixos.update");
    expect(CHAVES_CONFERIDAS_NA_TELA).toContain("custos.fixos.update");
    expect(rolePermissions.admin).toContain("custos.fixos.update");
  });
  it("edita admin, quem tem custos.fixos.update e quem tem custos.update", () => {
    expect(podeEditarCustosFixos({ ehAdmin: true, permissoes: [] })).toBe(true);
    expect(podeEditarCustosFixos({ ehAdmin: false, permissoes: ["custos.fixos.update"] })).toBe(
      true,
    );
    expect(podeEditarCustosFixos({ ehAdmin: false, permissoes: ["custos.update"] })).toBe(true);
    expect(podeEditarCustosFixos({ ehAdmin: false, permissoes: ["custos.read"] })).toBe(false);
  });
});

const bloco = (
  o: { podeEditar?: boolean; editando?: string | null; linhas?: LinhaDeCustoFixo[] } = {},
) =>
  renderToStaticMarkup(
    createElement(BlocoDeCustosFixos, {
      itens: itensDeCustoFixo(
        o.linhas ?? [
          linha("aluguel_espaco_mensal", {
            valor: 2000,
            confirmado_em: "2026-11-15T12:00:00Z",
            confirmado_por: "u1",
          }),
          linha("mo_custo_hora", { valor: 9.2102, confirmado_em: "2026-11-01T12:00:00Z" }),
          linha("mo_encargos_pct", { valor: 32.82, confirmado_em: "2026-11-01T12:00:00Z" }),
        ],
      ),
      nomes: { u1: "Cibele" },
      podeEditar: o.podeEditar ?? true,
      editandoCodigo: o.editando ?? null,
      rascunho: "",
      ocupado: false,
      aoEditar: () => {},
      aoMudar: () => {},
      aoSalvar: () => {},
      aoCancelar: () => {},
    }),
  );

describe("a tela de custos fixos", () => {
  it("mostra título, contador, três grupos, selos e quem confirmou", () => {
    const h = bloco();
    expect(h).toContain("Custos fixos da gráfica");
    expect(h).toContain("8 de 9 pendentes.");
    for (const g of ["Espaço e energia", "Plotter", "Pessoal"]) expect(h).toContain(`>${g}<`);
    expect(h).toContain('data-estado="pendente"');
    expect(h).toContain('data-estado="confirmado"');
    expect(h).toContain("Pendente");
    expect(h).toContain("Confirmado por Cibele em 15/11/2026.");
    expect(h).toContain("R$ 2.000,00 por mês");
    expect(h).toContain("O custo da mão de obra é");
  });
  it("texto fixo da plotter", () => {
    expect(bloco()).toContain(TEXTO_DA_VELOCIDADE_DA_PLOTTER);
    expect(TEXTO_DA_VELOCIDADE_DA_PLOTTER).toBe(
      "A máquina faz 14 metros quadrados por hora e o sistema calcula com 10 por margem de segurança.",
    );
  });
  it("quem edita vê o botão de 44 px; os de pessoal só leitura não têm botão", () => {
    const h = bloco();
    expect((h.match(/>Editar /g) ?? []).length).toBe(9);
    expect(h).not.toContain("Editar Mão de obra");
    expect(h).toContain("h-11 min-h-11");
  });
  it("quem só lê não vê botão e recebe o recado", () => {
    const h = bloco({ podeEditar: false });
    expect(h).not.toContain(">Editar ");
    expect(h).toContain('data-testid="so-leitura-dos-custos"');
  });
  it("em edição, oferece salvar e confirmar e salvar sem confirmar", () => {
    const h = bloco({ editando: "aluguel_espaco_mensal" });
    expect(h).toContain("Salvar e confirmar");
    expect(h).toContain("Salvar sem confirmar");
    expect(h).toContain('inputMode="decimal"');
  });
  it("letra de 16 px, sem parênteses, travessão ou seta", () => {
    const h = bloco({ editando: "aluguel_espaco_mensal" });
    expect(h).not.toMatch(/[\s"]text-(xs|sm)[\s"]/);
    const texto = h.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
    expect(texto).not.toMatch(/[()—–→←]/);
  });
});

describe("a ficha da plotter", () => {
  it("reconhece a i1600 pelo nome ou pelo modelo e só ela", () => {
    expect(ehPlotterI1600({ nome: "Plotter Impressão i1600 180" })).toBe(true);
    expect(ehPlotterI1600({ nome: "Plotter", modelo: "i1600" })).toBe(true);
    expect(ehPlotterI1600({ nome: "Plotter de recorte" })).toBe(false);
    expect(ehPlotterI1600({})).toBe(false);
  });
});

describe("bloco some quando a RLS não deixa ler nenhum custo fixo", () => {
  it("zero linha legível não mostra o bloco; com linha mostra", async () => {
    const { haCustoFixoParaMostrar, lerLinhaDeCustoFixo } = await import("@/domain/custos/custos-fixos");
    expect(haCustoFixoParaMostrar([])).toBe(false);
    expect(
      haCustoFixoParaMostrar([lerLinhaDeCustoFixo({ id: "1", codigo: "mo_custo_hora", valor: 9 })]),
    ).toBe(true);
  });
});
