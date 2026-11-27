import { describe, expect, it } from "vitest";
import { normalizarFichaDaIa } from "@/domain/trofeus/ficha-lida";
import { avisosDeMaquina, compararFichaComModelo, escolhasDaFicha, modeloSugerido, type CatalogoParaFicha, type ModeloParaComparar } from "@/domain/trofeus/ficha-comparar";
import { INSTRUCAO_DA_LEITURA } from "@/domain/trofeus/ficha-ia";
import { CATALOGO, CRISTAL_6, PRETO_3 } from "./apoio/trofeus-ficha";

/**
 * A ficha "JariCross 10 Anos" (26/11/2026, docs/trofeus/ficha-jaricross-10-anos.jpg), a que o dono anexou ao pedir o cadastro do produto
 * que faltava. NÃO é uma chamada à IA: não há chave de IA no ambiente de teste. `SAIDA_DA_IA` é o que a ferramenta deveria devolver para
 * ESSA imagem, transcrito à mão do que ela mostra. O que se trava é o caminho depois da IA: o filtro, a sugestão do modelo pelo nome que a
 * ficha escreve e a comparação com o cadastro, que tem de apontar a base de acrílico preto de 10 mm (sem cadastro, o preço não a inclui).
 */

const BRANCO_2 = "ACRILICO BRANCO VIRGEM 2MM";

/** O modelo como a migração 20261126300000 o cadastra: duas peças; a base de preto 10 mm ainda não tem material nem preço. */
const JARICROSS: ModeloParaComparar = {
  id: "m-jari",
  nome: "JariCross 10 Anos",
  linha: "economico",
  alturaReferenciaCm: 18,
  pecas: [
    { nome: "Placa principal (formato capacete)", material: CRISTAL_6, espessuraMm: 6, larguraCm: 20, alturaCm: 15, quantidade: 1, decoracao: "vinil_laminado" },
    { nome: "Placa frontal da base", material: BRANCO_2, espessuraMm: 2, larguraCm: 16, alturaCm: 4, quantidade: 1, decoracao: "vinil_laminado" },
  ],
};

const CATALOGO_COM_JARICROSS: CatalogoParaFicha = {
  ...CATALOGO,
  modelos: [...CATALOGO.modelos, JARICROSS],
  materiais: [...CATALOGO.materiais, { nome: BRANCO_2, espessuraMm: 2 }],
};

/** O que a IA devolve para a imagem: tabela de peças, medidas gerais, dados personalizados. Sem preço, sem quantidade (a ficha não diz). */
const SAIDA_DA_IA = {
  modelo_nome: "JariCross 10 Anos",
  linha: null,
  altura_cm: 18,
  largura_cm: 20,
  base_largura_cm: 22,
  base_altura_cm: 5,
  quantidade: null,
  urgente: null,
  arte: null,
  nomes_individuais: null,
  textos: [
    { chave: "evento", valor: "JariCross" },
    { chave: "edicao", valor: "10 Anos (Edição Limitada)" },
    { chave: "ano", valor: "2026" },
    { chave: "colocacao", valor: "1º Lugar (ou conforme categoria)" },
    { chave: "categoria", valor: "MX1 (ou outra definida pelo cliente)" },
    { chave: "textos_da_base", valor: "1º LUGAR CATEGORIA MX1" },
  ],
  pecas: [
    { nome: "Placa principal (formato capacete)", material: "Acrílico cristal (transparente)", espessura_mm: 6, largura_cm: 20, altura_cm: 15, quantidade: 1, decoracao: "vinil_laminado", maquina: "Laser CO2 (CNC Laser 10060)" },
    { nome: "Placa frontal da base", material: "Acrílico prata (escovado) ou branco", espessura_mm: 2, largura_cm: 16, altura_cm: 4, quantidade: 1, decoracao: "vinil_laminado", maquina: "Laser CO2 + Plotter" },
    { nome: "Base", material: "Acrílico preto (brilhante)", espessura_mm: 10, largura_cm: 22, altura_cm: 5, quantidade: 1, decoracao: "nenhuma", maquina: "Laser CO2 (CNC Laser 10060)" },
  ],
  observacoes: null,
  duvidas: [],
};

function lida() {
  const r = normalizarFichaDaIa(SAIDA_DA_IA);
  if (!r) throw new Error("a ficha do JariCross 10 Anos deveria ser lida");
  return r;
}

describe("a ficha JariCross 10 Anos, depois da IA", () => {
  it("o filtro guarda o nome do modelo, as três peças com a espessura de cada uma e as medidas gerais", () => {
    const { ficha, avisos } = lida();
    expect(avisos).toEqual([]);
    expect(ficha.modeloNome).toBe("JariCross 10 Anos");
    expect(ficha.alturaCm).toBe(18);
    expect(ficha.larguraCm).toBe(20);
    expect(ficha.base).toEqual({ larguraCm: 22, alturaCm: 5 });
    expect(ficha.pecas.map((p) => [p.nome, p.espessuraMm, p.larguraCm, p.alturaCm, p.quantidade, p.decoracao])).toEqual([
      ["Placa principal (formato capacete)", 6, 20, 15, 1, "vinil_laminado"],
      ["Placa frontal da base", 2, 16, 4, 1, "vinil_laminado"],
      ["Base", 10, 22, 5, 1, "nenhuma"],
    ]);
    expect(ficha.textos.map((t) => t.chave)).toEqual(["evento", "edicao", "ano", "colocacao", "categoria", "textos_da_base"]);
    // A ficha não diz quantos troféus são: fica vazio, e a calculadora mantém os 55 que a pessoa digitou.
    expect(ficha.quantidade).toBeNull();
    expect(escolhasDaFicha(ficha, "m-jari")).toEqual({ modeloId: "m-jari", alturaTexto: "18" });
  });

  it("sugere o modelo cadastrado PELO NOME da ficha, e não o econômico que a linha ou o número de peças apontariam", () => {
    const { ficha } = lida();
    expect(modeloSugerido(ficha, CATALOGO_COM_JARICROSS.modelos)).toBe("m-jari");
    // sem o nome, a ficha cairia no modelo da linha/peças (as três peças → econômico), que é o que o orçamento usava
    expect(modeloSugerido({ ...ficha, modeloNome: null }, CATALOGO_COM_JARICROSS.modelos)).not.toBe("m-jari");
  });

  it("o nome casa sem ligar para acento, maiúscula nem espaço, e um nome parecido demais não escolhe sozinho", () => {
    const { ficha } = lida();
    for (const escrito of ["JARICROSS 10 ANOS", "Jari Cross 10 anos", "jaricross - 10 anos", "Troféu JariCross 10 Anos"]) {
      expect(modeloSugerido({ ...ficha, modeloNome: escrito }, CATALOGO_COM_JARICROSS.modelos), escrito).toBe("m-jari");
    }
    const gemeos: ModeloParaComparar[] = [JARICROSS, { ...JARICROSS, id: "m-jari-2", nome: "JariCross 10 Anos 2027" }];
    // "JariCross 10 Anos" casa exatamente com um: é ele. Já "JariCross 10" (curto, contido nos dois) não decide.
    expect(modeloSugerido({ ...ficha, modeloNome: "JariCross 10 Anos" }, gemeos)).toBe("m-jari");
    expect(modeloSugerido({ ...ficha, modeloNome: "JariCross 10" , linha: null, pecas: [] }, gemeos)).toBeNull();
  });

  it("a comparação com o modelo cadastrado aponta a BASE de preto 10 mm: o preço não a inclui", () => {
    const { ficha } = lida();
    const d = compararFichaComModelo(ficha, JARICROSS, CATALOGO_COM_JARICROSS);
    expect(d.filter((x) => x.nivel === "impede")).toEqual([]);
    const sobreABase = d.filter((x) => x.texto.includes("Base"));
    expect(sobreABase.length).toBeGreaterThan(0);
    expect(sobreABase.map((x) => x.texto).join(" ")).toContain("o preço não inclui esta peça");
    // a placa principal (cristal 6 mm, 20 × 15) bate com o modelo: nada a dizer sobre ela
    expect(d.some((x) => x.texto.includes('"Placa principal (formato capacete)"'))).toBe(false);
  });

  it("as máquinas da ficha (laser CO2 e plotter) não geram aviso de máquina que a casa não tem", () => {
    expect(avisosDeMaquina(lida().ficha)).toEqual([]);
  });
});

describe("o que a instrução manda a IA ler desta ficha", () => {
  it("o nome do modelo é pedido, e o aviso de rodapé da ficha não vira pedido (senão 'fresa' e 'laser de fibra' acusariam máquina que ninguém pediu)", () => {
    expect(INSTRUCAO_DA_LEITURA).toMatch(/modelo_nome/);
    expect(INSTRUCAO_DA_LEITURA).toMatch(/Avisos de rodapé/);
    // o rodapé da ficha do dono, copiado em observacoes, dispararia o aviso de máquina; é por isso que a instrução o proíbe
    const comRodape = normalizarFichaDaIa({ ...SAIDA_DA_IA, observacoes: "Outros processos (UV, DTF, fresa, laser de fibra) sob consulta." });
    expect(comRodape && avisosDeMaquina(comRodape.ficha).length).toBeGreaterThan(0);
  });

  it("a base de preto 10 mm é o que falta no cadastro: o catálogo de teste, como o do banco, não tem esse material", () => {
    const nomes = CATALOGO_COM_JARICROSS.materiais.map((m) => `${m.nome}|${m.espessuraMm}`);
    expect(nomes.some((n) => /PRETO/i.test(n) && n.endsWith("|10"))).toBe(false);
    expect(nomes).toContain(`${PRETO_3}|3`);
  });
});
