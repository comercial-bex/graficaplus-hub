import { describe, expect, it } from "vitest";
import {
  alturasRapidas,
  ehItemDeArteDeTrofeu,
  ehItemDeTrofeu,
  entradaParaOServidor,
  ESCOLHAS_INICIAIS,
  escolhasDoGravado,
  faixaDaMargem,
  lerInteiro,
  lerNumero,
  OPCOES_DE_ARTE,
  podeSalvar,
  problemaDasEscolhas,
  rotuloDoDegrau,
  rotuloDoMultiplicador,
  separarAvisos,
  TIPO_DO_ITEM_ARTE,
  TIPO_DO_ITEM_TROFEU,
  type EscolhasDaTela,
} from "@/domain/trofeus/tela";

/**
 * 22/11/2026. O que a tela do orçamento de troféu decide sozinha, sem React: ler o que a pessoa digitou, dizer o que
 * falta antes de ir ao servidor, montar a entrada que o servidor aceita e liberar (ou não) o botão de salvar.
 */
const LIMITES = { alturaMinimaCm: 12, alturaMaximaCm: 40 };
const pronta = (parte: Partial<EscolhasDaTela> = {}): EscolhasDaTela => ({
  ...ESCOLHAS_INICIAIS,
  modeloId: "m1",
  alturaTexto: "18",
  ...parte,
});

describe("ler o que a pessoa digitou", () => {
  it("aceita vírgula e ponto decimais, e separador de milhar", () => {
    expect(lerNumero("22,5")).toBe(22.5);
    expect(lerNumero("22.5")).toBe(22.5);
    expect(lerNumero(" 18 ")).toBe(18);
    expect(lerNumero("1.250,5")).toBe(1250.5);
  });
  it("vazio e lixo viram nulo, nunca zero", () => {
    for (const t of ["", "  ", "abc", "1,2,3", "12cm", "--3", "NaN"]) expect(lerNumero(t), t).toBeNull();
  });
  it("inteiro só aceita inteiro", () => {
    expect(lerInteiro("5")).toBe(5);
    expect(lerInteiro("5,0")).toBe(5);
    expect(lerInteiro("2,5")).toBeNull();
    expect(lerInteiro("")).toBeNull();
  });
});

describe("o que falta antes de pedir o preço", () => {
  it("escolhas completas: nada falta", () => {
    expect(problemaDasEscolhas(pronta(), LIMITES)).toBeNull();
  });
  it("sem modelo, sem altura, altura fora do limite, quantidade quebrada", () => {
    expect(problemaDasEscolhas(pronta({ modeloId: null }), LIMITES)).toBe("Escolha o modelo do troféu.");
    expect(problemaDasEscolhas(pronta({ alturaTexto: "" }), LIMITES)).toBe("Informe a altura do troféu, em centímetros.");
    expect(problemaDasEscolhas(pronta({ alturaTexto: "8" }), LIMITES)).toBe("A altura vai de 12 a 40 cm.");
    expect(problemaDasEscolhas(pronta({ alturaTexto: "41" }), LIMITES)).toBe("A altura vai de 12 a 40 cm.");
    expect(problemaDasEscolhas(pronta({ quantidadeTexto: "0" }), LIMITES)).toBe("Informe a quantidade de troféus, em número inteiro.");
    expect(problemaDasEscolhas(pronta({ quantidadeTexto: "2,5" }), LIMITES)).toBe("Informe a quantidade de troféus, em número inteiro.");
  });
  it("12 e 40 cm ainda valem (o limite é inclusivo)", () => {
    expect(problemaDasEscolhas(pronta({ alturaTexto: "12" }), LIMITES)).toBeNull();
    expect(problemaDasEscolhas(pronta({ alturaTexto: "40" }), LIMITES)).toBeNull();
  });
  it("sem os limites ainda carregados, a altura só precisa ser um número", () => {
    expect(problemaDasEscolhas(pronta({ alturaTexto: "8" }), null)).toBeNull();
  });
  it("alterações e nomes: inteiros, e nomes não passam da quantidade", () => {
    expect(problemaDasEscolhas(pronta({ alteracoesTexto: "x" }), LIMITES)).toContain("alterações extras");
    expect(problemaDasEscolhas(pronta({ nomesTexto: "-1" }), LIMITES)).toContain("nomes individuais");
    expect(problemaDasEscolhas(pronta({ quantidadeTexto: "3", nomesTexto: "4" }), LIMITES)).toBe("Há mais nomes individuais do que troféus.");
    expect(problemaDasEscolhas(pronta({ quantidadeTexto: "3", nomesTexto: "3" }), LIMITES)).toBeNull();
  });
  it("multiplicador à mão: vazio vale (usa o da escada); fora de ×1 a ×10 não", () => {
    expect(problemaDasEscolhas(pronta({ multiplicadorTexto: "" }), LIMITES)).toBeNull();
    expect(problemaDasEscolhas(pronta({ multiplicadorTexto: "2,5" }), LIMITES)).toBeNull();
    for (const t of ["0,9", "10,5", "abc"]) expect(problemaDasEscolhas(pronta({ multiplicadorTexto: t }), LIMITES), t).toBe("O multiplicador vai de ×1 a ×10.");
  });
});

describe("a entrada que vai ao servidor", () => {
  it("só as chaves que o servidor aceita, com número de verdade", () => {
    const entrada = entradaParaOServidor(
      pronta({ alturaTexto: "22,5", quantidadeTexto: "5", urgente: true, arteTipo: "criacao_exclusiva", alteracoesTexto: "2", nomesTexto: "3", multiplicadorTexto: "2,5" }),
    );
    expect(entrada).toEqual({
      modeloId: "m1",
      alturaCm: 22.5,
      quantidade: 5,
      urgente: true,
      arte: { tipo: "criacao_exclusiva", alteracoesExtras: 2, nomesIndividuais: 3 },
      multiplicadorManual: 2.5,
    });
    expect(Object.keys(entrada).sort()).toEqual(["alturaCm", "arte", "modeloId", "multiplicadorManual", "quantidade", "urgente"]);
  });
  it("sem multiplicador digitado, manda nulo (o servidor usa a escada)", () => {
    expect(entradaParaOServidor(pronta()).multiplicadorManual).toBeNull();
  });
  it("nunca leva preço, custo, taxa nem total (a tela não os tem para mandar)", () => {
    const texto = JSON.stringify(entradaParaOServidor(pronta()));
    for (const proibido of ["preco", "custo", "taxa", "total", "margem"]) expect(texto, proibido).not.toContain(proibido);
  });
});

describe("reabrir um troféu gravado", () => {
  it("as escolhas voltam para os campos, com vírgula decimal", () => {
    const e = escolhasDoGravado({
      modeloId: "m2",
      alturaCm: 22.5,
      quantidade: 5,
      urgente: true,
      arte: { tipo: "adaptar_modelo", alteracoesExtras: 1, nomesIndividuais: 4 },
      multiplicadorManual: 2.5,
    });
    expect(e).toEqual({
      modeloId: "m2",
      alturaTexto: "22,5",
      quantidadeTexto: "5",
      urgente: true,
      arteTipo: "adaptar_modelo",
      alteracoesTexto: "1",
      nomesTexto: "4",
      multiplicadorTexto: "2,5",
    });
  });
  it("ida e volta: gravado → campos → entrada do servidor devolve as mesmas escolhas", () => {
    const gravado = {
      modeloId: "m2",
      alturaCm: 28,
      quantidade: 20,
      urgente: false,
      arte: { tipo: "criacao_exclusiva" as const, alteracoesExtras: 0, nomesIndividuais: 20 },
      multiplicadorManual: null,
    };
    const entrada = entradaParaOServidor(escolhasDoGravado(gravado));
    expect(entrada).toEqual({ ...gravado });
  });
  it("sem arte gravada volta para 'o cliente manda'", () => {
    expect(escolhasDoGravado({ modeloId: "m", alturaCm: 18, quantidade: 1, urgente: false, arte: null, multiplicadorManual: null }).arteTipo).toBe("cliente_manda");
  });
});

describe("atalhos, avisos e rótulos", () => {
  it("alturas de atalho: 15, 20, 25 e 30 cm, só as que cabem", () => {
    expect(alturasRapidas(12, 40)).toEqual([15, 20, 25, 30]);
    expect(alturasRapidas(18, 28)).toEqual([20, 25]);
    expect(alturasRapidas(31, 40)).toEqual([]);
  });
  it("os avisos se separam em estoque (não impede nada) e estimativas", () => {
    const r = separarAvisos(["Estoque de X abaixo do necessário.", "O consumo de tinta ainda é uma estimativa."]);
    expect(r.estoque).toEqual(["Estoque de X abaixo do necessário."]);
    expect(r.estimativas).toEqual(["O consumo de tinta ainda é uma estimativa."]);
  });
  it("faixa da margem: 40+ boa, 25+ apertada, 0+ muito baixa, abaixo disso a casa perde", () => {
    expect(faixaDaMargem(42.6)).toBe("boa");
    expect(faixaDaMargem(40)).toBe("boa");
    expect(faixaDaMargem(25.5)).toBe("atencao");
    expect(faixaDaMargem(10)).toBe("baixa");
    expect(faixaDaMargem(0)).toBe("baixa");
    expect(faixaDaMargem(-3)).toBe("negativa");
  });
  it("rótulos: ×2,5 e os degraus da escada", () => {
    expect(rotuloDoMultiplicador(2.5)).toBe("×2,5");
    expect(rotuloDoMultiplicador(2.2)).toBe("×2,2");
    expect(rotuloDoDegrau(1)).toBe("1 troféu");
    expect(rotuloDoDegrau(20)).toBe("a partir de 20 troféus");
  });
  it("os três tipos de arte, com a criação exclusiva avisando que vira linha própria", () => {
    expect(OPCOES_DE_ARTE.map((o) => o.tipo)).toEqual(["cliente_manda", "adaptar_modelo", "criacao_exclusiva"]);
    expect(OPCOES_DE_ARTE[2].detalhe).toContain("linha própria");
  });
  it("os rótulos do item são os que a função do banco grava", () => {
    expect(TIPO_DO_ITEM_TROFEU).toBe("Troféu de acrílico");
    expect(TIPO_DO_ITEM_ARTE).toBe("Arte do troféu");
    expect(ehItemDeTrofeu({ tipo_produto: "Troféu de acrílico" })).toBe(true);
    expect(ehItemDeTrofeu({ tipo_produto: "3D" })).toBe(false);
    expect(ehItemDeTrofeu({})).toBe(false);
    expect(ehItemDeArteDeTrofeu({ tipo_produto: "Arte do troféu" })).toBe(true);
    expect(ehItemDeArteDeTrofeu({ tipo_produto: "Troféu de acrílico" })).toBe(false);
  });
});

describe("pode salvar no orçamento?", () => {
  const ok = { problema: null, esperandoDigitar: false, temCotacaoAtual: true, salvando: false, abaixoDoPiso: false, podeDarAval: false, avalConfirmado: false, podeEditar: true };
  it("com a cotação de agora e nada pendente: sim", () => {
    expect(podeSalvar(ok)).toEqual({ pode: true, motivo: null });
  });
  it("sem cotação, ou ainda esperando a pessoa parar de digitar: não, e diz que está calculando", () => {
    expect(podeSalvar({ ...ok, temCotacaoAtual: false })).toEqual({ pode: false, motivo: "Calculando o preço…" });
    expect(podeSalvar({ ...ok, esperandoDigitar: true })).toEqual({ pode: false, motivo: "Calculando o preço…" });
  });
  it("com problema nas escolhas: não, e diz qual", () => {
    expect(podeSalvar({ ...ok, problema: "Escolha o modelo do troféu." })).toEqual({ pode: false, motivo: "Escolha o modelo do troféu." });
  });
  it("troféu com preço ajustado por quem vê custo: o vendedor não grava por cima", () => {
    expect(podeSalvar({ ...ok, podeEditar: false }).pode).toBe(false);
  });
  it("abaixo do piso: sem poder de aval não grava; com poder, só depois de confirmar", () => {
    expect(podeSalvar({ ...ok, abaixoDoPiso: true, podeDarAval: false })).toEqual({ pode: false, motivo: "Preço abaixo do piso: só o gestor dá esse aval." });
    expect(podeSalvar({ ...ok, abaixoDoPiso: true, podeDarAval: true, avalConfirmado: false }).motivo).toBe("Confirme o aval do gestor para vender abaixo do piso.");
    expect(podeSalvar({ ...ok, abaixoDoPiso: true, podeDarAval: true, avalConfirmado: true })).toEqual({ pode: true, motivo: null });
  });
  it("salvando: o botão trava", () => {
    expect(podeSalvar({ ...ok, salvando: true }).pode).toBe(false);
  });
});
