import type {
  ModeloDeTrofeu,
  PecaDoModelo,
  RegrasDaArte,
  RegrasDoTrofeu,
  TaxasDoTrofeu,
} from "@/domain/trofeus/conta";

/**
 * Os três modelos das imagens do dono (JariCross econômico, JariCross em duas camadas e KR Combat) e as taxas
 * do banco de 22/11/2026, como a migração 20261122200000 as planta. Medidas e tempos são PROVISÓRIOS até a primeira
 * produção medir (o teste da migração confere que este arquivo e o SQL dizem o mesmo).
 */
export const MATERIAL = {
  cristal2: "mat-cristal-2mm",
  cristal3: "mat-cristal-3mm",
  cristal6: "mat-cristal-6mm",
  preto3: "mat-preto-3mm",
  dourado2: "mat-espelhado-dourado-2mm",
} as const;

export const TAXAS: TaxasDoTrofeu = {
  custoM2PorMaterial: {
    [MATERIAL.cristal2]: 158.0,
    [MATERIAL.cristal3]: 180.0,
    [MATERIAL.cristal6]: 400.76,
    [MATERIAL.preto3]: 194.5,
    [MATERIAL.dourado2]: 174.18,
  },
  pctPerdaMaterial: 8,
  pctFalhaProducao: 5,
  vinilM2: 6.58,
  laminacaoM2: 8,
  tintaMlM2: 12,
  custoMlTinta: 0.2317,
  plotterM2: 14.4313 / 10 + (1.0 * 1.1339) / 10,
  colaMlPorJuncao: 1,
  custoMlCola: 71.26 / 250,
  laserHora: 10.79 + 1.9 * 1.1339,
  velocidadeDeCorteMPorMin: { "2": 1.5, "3": 1.0, "6": 0.4 },
  gravacaoMinPorM2: 60,
  preparoDoLaserMin: 5,
  moHora: 9.2102 * 1.3282,
  adminHora: 12.5,
  ocupacaoAlvoPct: 50,
  impostoPct: 6,
  cartaoPct: 3.5,
};

export const REGRAS: RegrasDoTrofeu = {
  faixas: [
    { de: 1, fator: 1 },
    { de: 5, fator: 0.9 },
    { de: 20, fator: 0.8 },
    { de: 50, fator: 0.7333 },
  ],
  pisoDoMultiplicador: 2.2,
  multiplicadorDeUrgencia: 4,
  alturaMinimaM: 0.12,
  alturaMaximaM: 0.4,
};

export const REGRAS_DA_ARTE: RegrasDaArte = {
  horasDaCriacaoExclusiva: 3,
  multiplicador: 3,
  arredondarNaDezena: true,
  descontoAPartirDe: 20,
  descontoPct: 50,
  alteracaoExtra: 30,
  nomeIndividualPorPeca: 4,
};

const peca = (
  nome: string,
  materialId: string,
  espessuraMm: number,
  larguraM: number,
  alturaM: number,
  quantidade: number,
  fatorDeForma: number,
  decoracao: PecaDoModelo["decoracao"],
): PecaDoModelo => ({ nome, materialId, espessuraMm, larguraM, alturaM, quantidade, fatorDeForma, decoracao });

export const ECONOMICO: ModeloDeTrofeu = {
  id: "economico",
  nome: "Troféu econômico",
  linha: "economico",
  alturaDeReferenciaM: 0.18,
  multiplicadorBase: 3,
  minutosDeMaoDeObra: 15,
  pecas: [
    peca("Placa principal", MATERIAL.cristal2, 2, 0.2, 0.16, 1, 1.35, "vinil_laminado"),
    peca("Base", MATERIAL.preto3, 3, 0.2, 0.05, 2, 1, "nenhuma"),
  ],
};

export const PADRAO: ModeloDeTrofeu = {
  id: "padrao",
  nome: "Troféu padrão em duas camadas",
  linha: "padrao",
  alturaDeReferenciaM: 0.18,
  multiplicadorBase: 3,
  minutosDeMaoDeObra: 25,
  pecas: [
    peca("Placa principal", MATERIAL.cristal2, 2, 0.2, 0.17, 1, 1.2, "vinil_laminado"),
    peca("Peça decorativa", MATERIAL.cristal2, 2, 0.1, 0.12, 1, 1.5, "vinil_laminado"),
    peca("Base", MATERIAL.preto3, 3, 0.2, 0.06, 2, 1, "nenhuma"),
    peca("Placa frontal", MATERIAL.preto3, 3, 0.2, 0.06, 1, 1, "vinil_laminado"),
  ],
};

export const PREMIUM: ModeloDeTrofeu = {
  id: "premium",
  nome: "Troféu premium em camadas",
  linha: "premium",
  alturaDeReferenciaM: 0.28,
  multiplicadorBase: 3,
  minutosDeMaoDeObra: 60,
  pecas: [
    peca("Placa principal", MATERIAL.cristal3, 3, 0.13, 0.13, 1, 1.1, "vinil_laminado"),
    peca("Coluna", MATERIAL.cristal6, 6, 0.06, 0.24, 1, 1.3, "nenhuma"),
    peca("Aro decorativo", MATERIAL.dourado2, 2, 0.06, 0.24, 1, 1.6, "nenhuma"),
    peca("Aro da base", MATERIAL.dourado2, 2, 0.16, 0.12, 1, 1.4, "nenhuma"),
    peca("Silhueta gravada", MATERIAL.cristal3, 3, 0.16, 0.1, 1, 1.8, "gravacao_laser"),
    peca("Placa da edição", MATERIAL.cristal3, 3, 0.12, 0.1, 1, 1.2, "vinil_laminado"),
    peca("Suporte interno", MATERIAL.preto3, 3, 0.18, 0.05, 1, 1, "nenhuma"),
    peca("Base em camadas", MATERIAL.preto3, 3, 0.2, 0.07, 3, 1, "nenhuma"),
    peca("Placa do campeão", MATERIAL.preto3, 3, 0.2, 0.07, 1, 1, "vinil_laminado"),
  ],
};

export const MODELOS = [ECONOMICO, PADRAO, PREMIUM];
