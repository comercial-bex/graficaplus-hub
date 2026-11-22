import type { CatalogoParaFicha, ModeloParaComparar } from "@/domain/trofeus/ficha-comparar";

/**
 * O catálogo de exemplo da leitura da ficha (22/11/2026): os mesmos nomes, espessuras e medidas do banco vivo. Os testes
 * da comparação e o harness do navegador usam este arquivo, para os dois enxergarem o mesmo cadastro.
 */

export const CRISTAL_2 = "ACRILICO CRISTAL VIRGEM 2MM";
export const CRISTAL_3 = "ACRILICO CRISTAL VIRGEM 3MM";
export const CRISTAL_6 = "ACRILICO CRISTAL VIRGEM 6MM";
export const PRETO_3 = "ACRILICO PRETO VIRGEM 3MM";
export const DOURADO_2 = "Acrilico esp dourado 2mm";

export const ECONOMICO: ModeloParaComparar = {
  id: "m-eco",
  nome: "Troféu econômico",
  linha: "economico",
  alturaReferenciaCm: 18,
  pecas: [
    { nome: "Placa principal", material: CRISTAL_2, espessuraMm: 2, larguraCm: 20, alturaCm: 16, quantidade: 1, decoracao: "vinil_laminado" },
    { nome: "Base", material: PRETO_3, espessuraMm: 3, larguraCm: 20, alturaCm: 5, quantidade: 2, decoracao: "nenhuma" },
  ],
};
export const PADRAO: ModeloParaComparar = {
  id: "m-pad",
  nome: "Troféu padrão em duas camadas",
  linha: "padrao",
  alturaReferenciaCm: 18,
  pecas: [
    { nome: "Placa principal", material: CRISTAL_2, espessuraMm: 2, larguraCm: 20, alturaCm: 17, quantidade: 1, decoracao: "vinil_laminado" },
    { nome: "Peça decorativa", material: CRISTAL_2, espessuraMm: 2, larguraCm: 10, alturaCm: 12, quantidade: 1, decoracao: "vinil_laminado" },
    { nome: "Base", material: PRETO_3, espessuraMm: 3, larguraCm: 20, alturaCm: 6, quantidade: 2, decoracao: "nenhuma" },
    { nome: "Placa frontal", material: PRETO_3, espessuraMm: 3, larguraCm: 20, alturaCm: 6, quantidade: 1, decoracao: "vinil_laminado" },
  ],
};
export const PREMIUM: ModeloParaComparar = {
  id: "m-pre",
  nome: "Troféu premium em camadas",
  linha: "premium",
  alturaReferenciaCm: 28,
  pecas: [
    { nome: "Placa principal", material: CRISTAL_3, espessuraMm: 3, larguraCm: 13, alturaCm: 13, quantidade: 1, decoracao: "vinil_laminado" },
    { nome: "Coluna", material: CRISTAL_6, espessuraMm: 6, larguraCm: 6, alturaCm: 24, quantidade: 1, decoracao: "nenhuma" },
    { nome: "Aro decorativo", material: DOURADO_2, espessuraMm: 2, larguraCm: 6, alturaCm: 24, quantidade: 1, decoracao: "nenhuma" },
    { nome: "Aro da base", material: DOURADO_2, espessuraMm: 2, larguraCm: 16, alturaCm: 12, quantidade: 1, decoracao: "nenhuma" },
    { nome: "Silhueta gravada", material: CRISTAL_3, espessuraMm: 3, larguraCm: 16, alturaCm: 10, quantidade: 1, decoracao: "gravacao_laser" },
    { nome: "Placa da edição", material: CRISTAL_3, espessuraMm: 3, larguraCm: 12, alturaCm: 10, quantidade: 1, decoracao: "vinil_laminado" },
    { nome: "Suporte interno", material: PRETO_3, espessuraMm: 3, larguraCm: 18, alturaCm: 5, quantidade: 1, decoracao: "nenhuma" },
    { nome: "Base em camadas", material: PRETO_3, espessuraMm: 3, larguraCm: 20, alturaCm: 7, quantidade: 3, decoracao: "nenhuma" },
    { nome: "Placa do campeão", material: PRETO_3, espessuraMm: 3, larguraCm: 20, alturaCm: 7, quantidade: 1, decoracao: "vinil_laminado" },
  ],
};

export const CATALOGO: CatalogoParaFicha = {
  modelos: [ECONOMICO, PADRAO, PREMIUM],
  materiais: [
    { nome: CRISTAL_2, espessuraMm: 2 },
    { nome: CRISTAL_3, espessuraMm: 3 },
    { nome: CRISTAL_6, espessuraMm: 6 },
    { nome: PRETO_3, espessuraMm: 3 },
    { nome: DOURADO_2, espessuraMm: 2 },
    { nome: "ACRILICO TRANSPARENTE 3MM CAMALEAO", espessuraMm: 3 },
    { nome: "ACRILICO BRANCO VIRGEM 3MM", espessuraMm: 3 },
  ],
  alturaMinimaCm: 12,
  alturaMaximaCm: 40,
  espessuraMaximaDeCorteMm: 10,
};
