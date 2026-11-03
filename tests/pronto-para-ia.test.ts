import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checagensDaPasta,
  entradaDaNota,
  faixaDaNota,
  fraseDaNota,
  notaDaPasta,
  type EntradaDaNota,
} from "@/domain/catalogo/pronto-para-ia";

/** Fase 6 do plano de 02/11/2026: a nota "Pronto para a IA" da pasta do produto. */

const completa: EntradaDaNota = {
  tipo: "produto",
  unidade: "m2",
  temFoto: true,
  temDescricao: true,
  temFamilia: true,
  temMedidaPadrao: true,
  temMaterialPrincipal: true,
  processos: 2,
  perguntas: 3,
  formulas: 1,
  roteiroEscrito: true,
  roteiroRevisado: true,
};

describe("a nota pronto para a IA", () => {
  it("produto por área completo dá 10; as dez checagens cabem", () => {
    const n = notaDaPasta(completa);
    expect(n).toMatchObject({ nota: 10, prontas: 10, cabem: 10, faltas: [] });
    expect(fraseDaNota(n)).toBe("Pronto para a IA: 10 de 10. Nada falta.");
  });

  it("o que falta é dito pelo nome, e a nota é a proporção em décimos", () => {
    const n = notaDaPasta({ ...completa, temFoto: false, formulas: 0, roteiroRevisado: false });
    expect(n.nota).toBe(7);
    expect(n.faltas).toEqual(["foto", "fórmula de material", "revisão do roteiro da IA"]);
    expect(fraseDaNota(n)).toBe("Pronto para a IA: 7 de 10. Falta: foto, fórmula de material, revisão do roteiro da IA.");
  });

  it("roteiro em branco pede o roteiro, não a revisão", () => {
    const n = notaDaPasta({ ...completa, roteiroEscrito: false, roteiroRevisado: false });
    expect(n.faltas).toEqual(["roteiro da IA"]);
  });

  it("serviço: foto, material, medida, fórmula e perguntas não cabem e saem da conta; medida só cabe em produto por área", () => {
    const servico = notaDaPasta({
      ...completa,
      tipo: "servico",
      unidade: "hora",
      temFoto: false,
      temMaterialPrincipal: false,
      formulas: 0,
      temMedidaPadrao: false,
      perguntas: 0,
    });
    // Sobram descrição, família, unidade, processos e roteiro.
    expect(servico.cabem).toBe(5);
    expect(servico.nota).toBe(10);
    // Serviço vendido por m² (laminação) também não pede medida padrão: ela vem do item.
    const porM2 = checagensDaPasta({ ...completa, tipo: "servico", unidade: "m2" });
    expect(porM2.find((c) => c.chave === "medida")?.cabe).toBe(false);
    expect(porM2.find((c) => c.chave === "perguntas")?.cabe).toBe(false);
    const porPeca = checagensDaPasta({ ...completa, unidade: "un" });
    expect(porPeca.find((c) => c.chave === "medida")?.cabe).toBe(false);
    expect(porPeca.find((c) => c.chave === "formulas")?.cabe).toBe(false);
  });

  it("a cor da barra acompanha a nota", () => {
    expect(faixaDaNota(10)).toBe("boa");
    expect(faixaDaNota(8)).toBe("boa");
    expect(faixaDaNota(5)).toBe("media");
    expect(faixaDaNota(4)).toBe("baixa");
  });

  it("monta a entrada a partir das linhas das tabelas; campo de informação não conta como pergunta", () => {
    const e = entradaDaNota(
      { id: "p1", tipo: "produto", unidade: "m2", imagem_url: "", descricao: "Lona", material_principal_id: "m1" },
      "Lonas",
      {
        fichas: [{ produto_id: "p1", largura_padrao_m: "1", altura_padrao_m: 0.5, ia_como_medir: "meça", ia_revisado_em: null }],
        processos: [{ produto_id: "p1" }, { produto_id: "p2" }],
        perguntas: [
          { produto_id: "p1", finalidade: "cobranca" },
          { produto_id: "p1", finalidade: "informacao" },
        ],
        formulas: [],
      },
    );
    expect(e).toMatchObject({
      temFoto: false,
      temDescricao: true,
      temFamilia: true,
      temMedidaPadrao: true,
      temMaterialPrincipal: true,
      processos: 1,
      perguntas: 1,
      formulas: 0,
      roteiroEscrito: true,
      roteiroRevisado: false,
    });
    expect(notaDaPasta(e).faltas).toEqual(["foto", "fórmula de material", "revisão do roteiro da IA"]);
  });
});

describe("as telas", () => {
  const lista = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");
  const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");

  it("a lista mostra a nota por produto e a pasta diz o que falta", () => {
    expect(lista).toContain("<NotaProntoParaIa");
    expect(lista).toContain("Pronto para a IA");
    expect(pasta).toContain("fraseDaNota(");
    expect(pasta).toContain('data-testid="pronto-para-ia"');
  });
});
