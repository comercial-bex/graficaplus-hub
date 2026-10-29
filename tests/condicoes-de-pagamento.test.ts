import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONDICAO_PADRAO_DA_CASA,
  condicaoCompleta,
  conferenciaAntesDeConverter,
  descricaoDaCondicao,
  modeloDaCondicao,
  parcelasDoOrcamento,
  valorDaEntrada,
} from "../src/domain/orcamentos/acordo";
import { parcelasDoAcordo } from "../src/lib/pdf/formato";
import { pedidoDeSinal } from "../src/domain/pagamento/sinal";
import { textoDoPdf } from "./apoio/pdf";
import type { DocumentoPDFProps } from "../src/lib/pdf/DocumentoPDF";

const ler = (caminho: string) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

/**
 * Condição de pagamento com entrada, obrigatória (decisão do dono, 28/10/2026):
 * à vista, 50% + 50%, entrada em % ou R$ e parcelado. A conta da tela é a da
 * conversão em OS, e a condição incompleta não manda nem converte.
 */

/** A conta do banco: round(total × pct ÷ 100, 2) em centavos inteiros (meio para cima no positivo). */
const entradaDoBanco = (totalCentavos: number, pct: number) => Math.round((totalCentavos * pct) / 100);

describe("a entrada", () => {
  it("50% + 50%: metade na aprovação, metade na entrega, centavo a centavo", () => {
    expect(valorDaEntrada(4397, { modelo: "metade_metade" })).toBe(2198.5);
    expect(parcelasDoOrcamento(4397, { modelo: "metade_metade", parcelas: 1 })).toEqual([
      { numero: 1, valor: 2198.5, vencimento: null, rotulo: "50% na aprovação" },
      { numero: 2, valor: 2198.5, vencimento: null, rotulo: "50% na entrega" },
    ]);
    // Total ímpar em centavos: a entrada arredonda para cima e o saldo leva a sobra.
    expect(parcelasDoOrcamento(0.03, { modelo: "metade_metade" }).map((p) => p.valor)).toEqual([0.02, 0.01]);
  });

  it("entrada em % ou em R$; o valor fixo manda e nunca passa do total", () => {
    expect(valorDaEntrada(1000, { modelo: "entrada", entrada_pct: 30 })).toBe(300);
    expect(valorDaEntrada(1000, { modelo: "entrada", entrada_valor: 250, entrada_pct: 30 })).toBe(250);
    expect(valorDaEntrada(1000, { modelo: "entrada", entrada_valor: 5000 })).toBe(1000);
    expect(valorDaEntrada(1000, { modelo: "entrada", entrada_pct: 150 })).toBe(1000);
    expect(valorDaEntrada(1000, { modelo: "entrada", entrada_pct: -5 })).toBe(0);
    for (const [total, pct] of [[1234.56, 33], [501.15, 50], [0.29, 10], [19999.99, 12.5]] as const) {
      expect(Math.round(valorDaEntrada(total, { modelo: "entrada", entrada_pct: pct }) * 100)).toBe(
        entradaDoBanco(Math.round(total * 100), pct),
      );
    }
  });

  it("entrada + saldo em parcelas: o saldo vence a partir do prazo de entrega quando não há 1º vencimento", () => {
    const lista = parcelasDoOrcamento(
      1000,
      { modelo: "entrada", entrada_pct: 30, parcelas: 2, intervalo_dias: 30 },
      { prazo: "2026-11-04" },
    );
    expect(lista).toEqual([
      { numero: 1, valor: 300, vencimento: null, rotulo: "Entrada na aprovação" },
      { numero: 2, valor: 350, vencimento: "2026-11-04", rotulo: "Saldo 1ª de 2" },
      { numero: 3, valor: 350, vencimento: "2026-12-04", rotulo: "Saldo 2ª de 2" },
    ]);
    // Com 1º vencimento combinado, é ele que manda.
    expect(
      parcelasDoOrcamento(1000, { modelo: "entrada", entrada_pct: 30, parcelas: 2, primeiro_vencimento: "2026-11-10" }, { prazo: "2026-11-04" })
        .slice(1)
        .map((p) => p.vencimento),
    ).toEqual(["2026-11-10", "2026-12-10"]);
  });

  it("à vista é tudo na aprovação; entrada de 100% não deixa saldo; entrada 0% é tudo na entrega", () => {
    expect(parcelasDoOrcamento(500, { modelo: "a_vista" })).toEqual([
      { numero: 1, valor: 500, vencimento: null, rotulo: "À vista, na aprovação" },
    ]);
    expect(parcelasDoOrcamento(500, { modelo: "entrada", entrada_pct: 100 })).toHaveLength(1);
    expect(parcelasDoOrcamento(500, { modelo: "entrada", entrada_pct: 0 })).toEqual([
      { numero: 1, valor: 500, vencimento: null, rotulo: "Saldo na entrega" },
    ]);
  });

  it("acordo antigo (sem modelo) e parcelado continuam como eram", () => {
    expect(parcelasDoOrcamento(792.43, { forma: "PIX", parcelas: 1 })).toEqual([
      { numero: 1, valor: 792.43, vencimento: null },
    ]);
    expect(parcelasDoOrcamento(300, { modelo: "parcelado", parcelas: 3, primeiro_vencimento: "2026-10-20" }).map((p) => [p.valor, p.vencimento, p.rotulo])).toEqual([
      [100, "2026-10-20", "1ª de 3"],
      [100, "2026-11-19", "2ª de 3"],
      [100, "2026-12-19", "3ª de 3"],
    ]);
    expect(modeloDaCondicao({ modelo: "lixo" as never })).toBeNull();
  });

  it("o PDF divide igual à tela, inclusive com entrada", () => {
    for (const condicao of [
      { modelo: "metade_metade" as const },
      { modelo: "entrada" as const, entrada_valor: 123.45, parcelas: 3, intervalo_dias: 15 },
      { modelo: "a_vista" as const },
      { parcelas: 4, primeiro_vencimento: "2026-11-01" },
    ]) {
      expect(parcelasDoAcordo(1357.9, condicao, { prazo: "2026-11-04" })).toEqual(
        parcelasDoOrcamento(1357.9, condicao, { prazo: "2026-11-04" }),
      );
    }
  });
});

describe("a descrição e a obrigatoriedade", () => {
  it("descreve cada modelo; acordo antigo continua '2x' (o PDF já dizia assim)", () => {
    expect(descricaoDaCondicao({ modelo: "a_vista" })).toBe("À vista, na aprovação");
    expect(descricaoDaCondicao({ modelo: "metade_metade" })).toBe("50% na aprovação e 50% na entrega");
    expect(descricaoDaCondicao({ modelo: "entrada", entrada_pct: 30 }, 1000)).toMatch(/^Entrada de 30% \(R\$\s300,00\) na aprovação e o saldo na entrega$/);
    expect(descricaoDaCondicao({ modelo: "entrada", entrada_valor: 250, parcelas: 2, intervalo_dias: 30 }, 1000)).toMatch(
      /Entrada de R\$\s250,00 na aprovação e o saldo em 2× a cada 30 dias/,
    );
    expect(descricaoDaCondicao({ modelo: "parcelado", parcelas: 3, intervalo_dias: 30 })).toBe("3× a cada 30 dias");
    expect(descricaoDaCondicao({ modelo: "parcelado", parcelas: 1 })).toBe("Parcela única na entrega");
    expect(descricaoDaCondicao({ parcelas: 2 })).toBe("2x");
  });

  it("condição completa = forma + divisão; o {parcelas: 1} de nascença não conta", () => {
    expect(condicaoCompleta(null)).toBe(false);
    expect(condicaoCompleta({ parcelas: 1 })).toBe(false);
    expect(condicaoCompleta({ modelo: "metade_metade" })).toBe(false);
    expect(condicaoCompleta({ forma: "PIX" })).toBe(false);
    expect(condicaoCompleta({ forma: "PIX", parcelas: 1 })).toBe(true);
    expect(condicaoCompleta({ forma: "Dinheiro", ...CONDICAO_PADRAO_DA_CASA })).toBe(true);
    expect(condicaoCompleta({ forma: "  ", modelo: "a_vista" })).toBe(false);
  });

  it("a conferência antes de converter cobra a condição completa, não só a forma", () => {
    const base = { temCliente: true, dataEntrega: "2026-11-04", verPreco: true, forma: "PIX", pixRecebido: true, itensSemArte: 0, descontoPendente: false };
    const soForma = conferenciaAntesDeConverter({ ...base, condicaoCompleta: false }).find((i) => i.chave === "pagamento");
    expect(soForma?.ok).toBe(false);
    expect(soForma?.nivel).toBe("obrigatorio");
    expect(soForma?.detalhe).toContain("a OS não é criada");
    expect(conferenciaAntesDeConverter({ ...base, condicaoCompleta: true }).find((i) => i.chave === "pagamento")?.ok).toBe(true);
  });

  it("o Pix do sinal pede o que a condição combinou para a aprovação", () => {
    expect(pedidoDeSinal({ total: 1000, condicao: { forma: "PIX", modelo: "a_vista" }, chaveConfigurada: true })).toMatchObject({ enviar: true, valor: 1000 });
    expect(pedidoDeSinal({ total: 1000, condicao: { forma: "PIX", modelo: "metade_metade" }, chaveConfigurada: true })).toMatchObject({ enviar: true, valor: 500 });
    const entrada = pedidoDeSinal({ total: 1000, condicao: { forma: "PIX", modelo: "entrada", entrada_pct: 30 }, chaveConfigurada: true });
    expect(entrada).toMatchObject({ enviar: true, valor: 300 });
    expect(entrada.nota).toContain("30%");
    expect(pedidoDeSinal({ total: 1000, condicao: { forma: "PIX", modelo: "entrada", entrada_pct: 0 }, chaveConfigurada: true }).enviar).toBe(false);
    // Parcelado e acordo antigo: a 1ª parcela, ou 50% da parcela única.
    expect(pedidoDeSinal({ total: 300, condicao: { forma: "PIX", modelo: "parcelado", parcelas: 3 }, chaveConfigurada: true }).valor).toBe(100);
    expect(pedidoDeSinal({ total: 155, condicao: { forma: "PIX", parcelas: 1 }, chaveConfigurada: true }).valor).toBe(77.5);
  });
});

describe("o que a tela, o banco e o PDF dizem", () => {
  const tela = ler("src/components/orcamento/acordo-do-orcamento.tsx");
  const rota = ler("src/routes/_authenticated/orcamentos.$id.tsx");
  const sql = ler("supabase/migrations/20261028600000_condicao_de_pagamento_obrigatoria_com_entrada.sql");

  it("a tela oferece os quatro modelos, a entrada em % ou R$ e o padrão da casa", () => {
    expect(tela).toContain('aria-label="Como divide"');
    expect(tela).toContain("MODELOS_DE_CONDICAO.map(");
    expect(tela).toContain('aria-label="Entrada em"');
    expect(tela).toContain("Usar o padrão da casa: 50% na aprovação e 50% na entrega");
    expect(tela).toContain("Condição obrigatória: escolha a forma e como divide");
    // A pendência de envio e a conferência usam a mesma régua.
    expect(rota).toContain("temCondicao: dadosDoAcordo ? condicaoCompleta(dadosDoAcordo.condicao_pagamento) : true");
    expect(rota).toContain("condicaoCompleta: condicaoCompleta(dadosDoAcordo?.condicao_pagamento ?? null)");
  });

  it("o banco recusa orçamento sem condição e divide entrada + saldo", () => {
    expect(sql).toContain("(b4) Condição de pagamento obrigatória");
    expect(sql).toContain("Orçamento sem condição de pagamento");
    expect(sql).toContain("v_entrada := round(v_total * 0.5, 2);");
    expect(sql).toContain("VALUES (v_conta_id, v_n, v_entrada, v_hoje);");
    expect(sql).toContain("WHEN v_modelo IN ('entrada', 'metade_metade') THEN COALESCE(v_orc.prazo, v_hoje)");
    // O mesmo corpo vivo: o trecho do Pix recebido e dos jobs 3D continuam.
    expect(sql).toContain("(b3) Sinal em Pix");
    expect(sql).toContain("criar_jobs_3d_da_os");
  });

  it("o PDF escreve a condição por extenso e cada parcela com o seu nome", async () => {
    const props: DocumentoPDFProps = {
      tipo: "orcamento",
      numero: 142,
      data_solicitacao: "26/10/2026",
      data_validade: "02/11/2026",
      vendedor: "Fernando Augusto",
      empresa: { nome: "BEX PRINT", cor: "#37bff0" },
      cliente: { nome: "Felipe Clinica Reintegrar" },
      itens: [{ descricao: "Kit Pintura", unidade: "un", quantidade: 100, valor_unitario: 15.97, valor_total: 1597 }],
      subtotal: 1597,
      desconto: 0,
      total: 1597,
      pagamento: { forma: "PIX", parcelas: 2, condicao: "50% na aprovação e 50% na entrega" },
      parcelas: [
        { numero: 1, valor: 798.5, vencimento: null, rotulo: "50% na aprovação" },
        { numero: 2, valor: 798.5, vencimento: null, rotulo: "50% na entrega" },
      ],
      entrega: "Cliente retira na empresa",
      mostrarValores: true,
    };
    const texto = await textoDoPdf(props);
    // A coluna PAGAMENTO é estreita: o texto quebra a linha onde couber.
    expect(texto.replace(/\s+/g, " ")).toContain("Condições de Pagamento: 50% na aprovação e 50% na entrega");
    expect(texto.replace(/\s+/g, " ")).toContain("50% na aprovação R$ 798,50");
    expect(texto.replace(/\s+/g, " ")).toContain("50% na entrega R$ 798,50");
  }, 30_000);
});
