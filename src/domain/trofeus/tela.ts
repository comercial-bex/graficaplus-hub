/**
 * O QUE A TELA DO ORÇAMENTO DE TROFÉU PRECISA SABER, SEM REACT (22/11/2026). Rótulos, leitura dos campos digitados
 * e as regras de "pode pedir o preço / pode salvar", para a tela só desenhar e os testes provarem. Nada aqui calcula
 * preço: o preço é do servidor (`cotarTrofeu`).
 */

/** Os rótulos que o item do orçamento leva (`salvar_trofeu_no_orcamento`) e que saem no PDF. */
export const TIPO_DO_ITEM_TROFEU = "Troféu de acrílico";
export const TIPO_DO_ITEM_ARTE = "Arte do troféu";

export const ehItemDeTrofeu = (i: { tipo_produto?: string | null }) => i.tipo_produto === TIPO_DO_ITEM_TROFEU;
export const ehItemDeArteDeTrofeu = (i: { tipo_produto?: string | null }) => i.tipo_produto === TIPO_DO_ITEM_ARTE;

/** O servidor recusa gravar quando o total mudou depois da conta; a tela reconhece a frase e pede a conta de novo. */
export const PRECO_MUDOU_TROFEU = "O preço mudou desde a última conta. Confira o novo valor e salve de novo.";

export const ROTULO_DA_LINHA: Record<string, string> = {
  economico: "Econômico",
  padrao: "Padrão",
  premium: "Premium",
};

export type TipoDeArteDaTela = "cliente_manda" | "adaptar_modelo" | "criacao_exclusiva";

export const OPCOES_DE_ARTE: { tipo: TipoDeArteDaTela; titulo: string; detalhe: string }[] = [
  { tipo: "cliente_manda", titulo: "O cliente manda a arte pronta", detalhe: "Sem cobrança de arte" },
  { tipo: "adaptar_modelo", titulo: "Adaptar o modelo", detalhe: "Nome e cores do cliente no modelo. Sem cobrança de arte" },
  { tipo: "criacao_exclusiva", titulo: "Criação exclusiva da arte", detalhe: "Designer cria do zero. Entra como linha própria no orçamento" },
];

/** Alturas de atalho, na ordem em que as lojas de troféu falam: 15, 20, 25 e 30 cm. Só as que cabem nos limites. */
export function alturasRapidas(minimoCm: number, maximoCm: number): number[] {
  return [15, 20, 25, 30].filter((h) => h >= minimoCm && h <= maximoCm);
}

/** "22,5" ou "22.5" viram 22,5. Texto vazio ou ilegível vira nulo, nunca zero. */
export function lerNumero(texto: string): number | null {
  let s = String(texto ?? "").trim();
  if (s === "") return null;
  if (s.includes(",")) s = s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function lerInteiro(texto: string): number | null {
  const n = lerNumero(texto);
  return n != null && Number.isInteger(n) ? n : null;
}

export type EscolhasDaTela = {
  modeloId: string | null;
  alturaTexto: string;
  quantidadeTexto: string;
  urgente: boolean;
  arteTipo: TipoDeArteDaTela;
  alteracoesTexto: string;
  nomesTexto: string;
  /** Só o simulador de quem vê custo preenche; vazio é "usar o multiplicador da escada". */
  multiplicadorTexto: string;
};

export const ESCOLHAS_INICIAIS: EscolhasDaTela = {
  modeloId: null,
  alturaTexto: "",
  quantidadeTexto: "1",
  urgente: false,
  arteTipo: "cliente_manda",
  alteracoesTexto: "0",
  nomesTexto: "0",
  multiplicadorTexto: "",
};

export type LimitesDaTela = { alturaMinimaCm: number; alturaMaximaCm: number };

/**
 * A primeira coisa que impede de pedir o preço, em frase. Nulo quer dizer que dá para perguntar ao servidor. A
 * conferência de verdade (altura, material, cadastro) continua sendo do servidor: isto só evita uma ida à toa.
 */
export function problemaDasEscolhas(e: EscolhasDaTela, limites: LimitesDaTela | null): string | null {
  if (!e.modeloId) return "Escolha o modelo do troféu.";
  const altura = lerNumero(e.alturaTexto);
  if (altura == null) return "Informe a altura do troféu, em centímetros.";
  if (limites && (altura < limites.alturaMinimaCm || altura > limites.alturaMaximaCm)) {
    return `A altura vai de ${limites.alturaMinimaCm} a ${limites.alturaMaximaCm} cm.`;
  }
  const quantidade = lerInteiro(e.quantidadeTexto);
  if (quantidade == null || quantidade < 1) return "Informe a quantidade de troféus, em número inteiro.";
  const alteracoes = lerInteiro(e.alteracoesTexto);
  if (alteracoes == null || alteracoes < 0) return "As alterações extras da arte se contam em número inteiro.";
  const nomes = lerInteiro(e.nomesTexto);
  if (nomes == null || nomes < 0) return "Os nomes individuais se contam em número inteiro.";
  if (nomes > quantidade) return "Há mais nomes individuais do que troféus.";
  if (e.multiplicadorTexto.trim() !== "") {
    const m = lerNumero(e.multiplicadorTexto);
    if (m == null || m < 1 || m > 10) return "O multiplicador vai de ×1 a ×10.";
  }
  return null;
}

export type EntradaParaOServidor = {
  modeloId: string;
  alturaCm: number;
  quantidade: number;
  urgente: boolean;
  arte: { tipo: TipoDeArteDaTela; alteracoesExtras: number; nomesIndividuais: number };
  multiplicadorManual: number | null;
};

/** As escolhas viram o que o servidor aceita (e só isso). Chamar só depois de `problemaDasEscolhas` dar nulo. */
export function entradaParaOServidor(e: EscolhasDaTela): EntradaParaOServidor {
  const manual = e.multiplicadorTexto.trim() === "" ? null : lerNumero(e.multiplicadorTexto);
  return {
    modeloId: e.modeloId as string,
    alturaCm: lerNumero(e.alturaTexto) as number,
    quantidade: lerInteiro(e.quantidadeTexto) as number,
    urgente: e.urgente,
    arte: {
      tipo: e.arteTipo,
      alteracoesExtras: lerInteiro(e.alteracoesTexto) ?? 0,
      nomesIndividuais: lerInteiro(e.nomesTexto) ?? 0,
    },
    multiplicadorManual: manual,
  };
}

/** O contrário: um troféu gravado volta para os campos da tela. */
export function escolhasDoGravado(g: {
  modeloId: string;
  alturaCm: number;
  quantidade: number;
  urgente: boolean;
  arte: { tipo: TipoDeArteDaTela; alteracoesExtras: number; nomesIndividuais: number } | null;
  multiplicadorManual: number | null;
}): EscolhasDaTela {
  const texto = (n: number) => String(n).replace(".", ",");
  return {
    modeloId: g.modeloId,
    alturaTexto: texto(g.alturaCm),
    quantidadeTexto: String(g.quantidade),
    urgente: g.urgente,
    arteTipo: g.arte?.tipo ?? "cliente_manda",
    alteracoesTexto: String(g.arte?.alteracoesExtras ?? 0),
    nomesTexto: String(g.arte?.nomesIndividuais ?? 0),
    multiplicadorTexto: g.multiplicadorManual != null ? texto(g.multiplicadorManual) : "",
  };
}

/** Os avisos do servidor separados em dois blocos: o do estoque (não impede nada) e o das estimativas. */
export function separarAvisos(avisos: string[]): { estoque: string[]; estimativas: string[] } {
  return {
    estoque: avisos.filter((a) => a.startsWith("Estoque de ")),
    estimativas: avisos.filter((a) => !a.startsWith("Estoque de ")),
  };
}

export type FaixaDaMargem = "boa" | "atencao" | "baixa" | "negativa";

/** A cor da margem líquida no simulador: ≥ 40% boa, ≥ 25% atenção, ≥ 0 baixa, abaixo disso a casa perde dinheiro. */
export function faixaDaMargem(margemPct: number): FaixaDaMargem {
  if (margemPct >= 40) return "boa";
  if (margemPct >= 25) return "atencao";
  if (margemPct >= 0) return "baixa";
  return "negativa";
}

export const ROTULO_DA_MARGEM: Record<FaixaDaMargem, string> = {
  boa: "Margem boa",
  atencao: "Margem apertada",
  baixa: "Margem muito baixa",
  negativa: "A casa perde dinheiro neste preço",
};

/** "×2,5": o multiplicador como a casa fala. */
export function rotuloDoMultiplicador(m: number): string {
  return `×${m.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}`;
}

/** "a partir de 5": o degrau da escada como linha da tabela de preço por quantidade. */
export function rotuloDoDegrau(aPartirDe: number): string {
  return aPartirDe <= 1 ? "1 troféu" : `a partir de ${aPartirDe} troféus`;
}

export type SituacaoDoSalvar = { pode: boolean; motivo: string | null };

/**
 * Pode gravar no orçamento? Só com a cotação de AGORA (digitou de novo, a anterior some) e, se o preço ficou abaixo
 * do piso, só com o aval confirmado de quem pode dar (a trava de verdade é do servidor).
 */
export function podeSalvar(s: {
  problema: string | null;
  esperandoDigitar: boolean;
  temCotacaoAtual: boolean;
  salvando: boolean;
  abaixoDoPiso: boolean;
  podeDarAval: boolean;
  avalConfirmado: boolean;
  podeEditar: boolean;
}): SituacaoDoSalvar {
  if (!s.podeEditar) return { pode: false, motivo: "Este troféu tem preço ajustado por quem vê custo: só eles alteram." };
  if (s.problema) return { pode: false, motivo: s.problema };
  if (s.esperandoDigitar || !s.temCotacaoAtual) return { pode: false, motivo: "Calculando o preço…" };
  if (s.salvando) return { pode: false, motivo: "Salvando…" };
  if (s.abaixoDoPiso && !s.podeDarAval) return { pode: false, motivo: "Preço abaixo do piso: só o gestor dá esse aval." };
  if (s.abaixoDoPiso && !s.avalConfirmado) return { pode: false, motivo: "Confirme o aval do gestor para vender abaixo do piso." };
  return { pode: true, motivo: null };
}
