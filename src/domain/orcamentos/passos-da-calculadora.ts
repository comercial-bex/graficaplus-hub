/**
 * A calculadora de custo em passos (20/10/2026).
 *
 * Medido antes: uma janela só, de 554 linhas e 24 campos — materiais, máquinas,
 * mão de obra, fechamento e resultado, todos abertos ao mesmo tempo. Quem a usa é
 * o financeiro, uma vez por item. Em passos, cada tela faz UMA pergunta
 * ("quais materiais?", "quais máquinas?", "quem trabalha?") e a última mostra o
 * preço. A barra no topo diz o que cada passo já tem, com o subtotal, para quem
 * pula direto ao resultado ver de onde o número saiu.
 *
 * Tudo que a pessoa digitou fica guardado ao trocar de passo: os passos só
 * mudam o que está à vista, nunca o que foi preenchido.
 */

export type PassoDaCalculadora = 1 | 2 | 3 | 4;

export const PASSOS: readonly { n: PassoDaCalculadora; titulo: string; pergunta: string }[] = [
  { n: 1, titulo: "Materiais", pergunta: "O que entra de material?" },
  { n: 2, titulo: "Máquinas", pergunta: "Quais máquinas e por quanto tempo?" },
  { n: 3, titulo: "Mão de obra", pergunta: "Quem trabalha e por quanto tempo?" },
  { n: 4, titulo: "Resultado", pergunta: "Custo, preço e até onde dá para baixar" },
];

export type SituacaoDoPasso = "vazio" | "preenchido" | "problema";

export type EstadoDoPasso = {
  n: PassoDaCalculadora;
  titulo: string;
  /** O que o passo já tem, em uma linha: "2 materiais · R$ 18,00". */
  resumo: string;
  situacao: SituacaoDoPasso;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const contar = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

export function estadoDosPassos(a: {
  materiais: number;
  processos: number;
  maoDeObra: number;
  custoMateriais: number;
  custoProcessos: number;
  custoMaoDeObra: number;
  custoTotal: number;
  /** Alguma linha de máquina recusa o material: não dá para aplicar. */
  temVetada: boolean;
}): EstadoDoPasso[] {
  // Linha posta mas sem custo (máquina escolhida e zero hora, função sem horas)
  // não ganha o check: no laboratório, "1 função · R$ 0,00" aparecia como
  // pronto e o resultado saía sem a mão de obra.
  const linha = (n: number, custo: number, singular: string, plural: string) =>
    n === 0 ? "nenhum" : custo > 0 ? `${contar(n, singular, plural)} · ${brl(custo)}` : `${contar(n, singular, plural)} sem custo`;
  const situacao = (n: number, custo: number): SituacaoDoPasso => (n > 0 && custo > 0 ? "preenchido" : "vazio");
  return [
    {
      n: 1,
      titulo: "Materiais",
      resumo: linha(a.materiais, a.custoMateriais, "material", "materiais"),
      situacao: situacao(a.materiais, a.custoMateriais),
    },
    {
      n: 2,
      titulo: "Máquinas",
      resumo: a.temVetada ? "máquina que não faz este material" : linha(a.processos, a.custoProcessos, "máquina", "máquinas"),
      situacao: a.temVetada ? "problema" : situacao(a.processos, a.custoProcessos),
    },
    {
      n: 3,
      titulo: "Mão de obra",
      resumo: linha(a.maoDeObra, a.custoMaoDeObra, "função", "funções"),
      situacao: situacao(a.maoDeObra, a.custoMaoDeObra),
    },
    {
      n: 4,
      titulo: "Resultado",
      resumo: a.custoTotal > 0 ? `custo ${brl(a.custoTotal)}` : "sem custo ainda",
      situacao: a.temVetada ? "problema" : a.custoTotal > 0 ? "preenchido" : "vazio",
    },
  ];
}

export function passoSeguinte(p: PassoDaCalculadora): PassoDaCalculadora {
  return p === 4 ? 4 : ((p + 1) as PassoDaCalculadora);
}

export function passoAnterior(p: PassoDaCalculadora): PassoDaCalculadora {
  return p === 1 ? 1 : ((p - 1) as PassoDaCalculadora);
}

/** O botão principal de cada passo: avançar nos três primeiros, aplicar no último. */
export function rotuloDoBotaoPrincipal(p: PassoDaCalculadora): string {
  if (p === 4) return "Aplicar ao item";
  return `Avançar: ${PASSOS[p].titulo}`;
}
