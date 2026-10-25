/**
 * O orçamento do parceiro em passos (fase 1 de docs/plano-orcamento-em-passos.md).
 *
 * Quatro passos, na ordem em que a pessoa pensa: para quem é, o que vai ser
 * feito, o que o cliente precisa saber e conferir tudo. É o molde da calculadora
 * de custo (`passos-da-calculadora.ts`): a barra mostra o que cada passo já tem
 * e clicar vai direto ao passo — nada OBRIGA a ordem, só a sugere. O que foi
 * digitado fica guardado ao trocar de passo: os passos só mudam o que está à
 * vista, nunca o que foi preenchido.
 *
 * Esta fase não muda NENHUMA conta de preço nem o que vai ao banco. Prazo,
 * entrega, pagamento e expresso entram como campos próprios nas fases seguintes.
 */

export type PassoDoOrcamento = 1 | 2 | 3 | 4;

export const PASSOS_DO_ORCAMENTO: readonly {
  n: PassoDoOrcamento;
  titulo: string;
  pergunta: string;
}[] = [
  { n: 1, titulo: "Cliente", pergunta: "Para quem é o orçamento?" },
  { n: 2, titulo: "Itens", pergunta: "O que vai ser feito?" },
  { n: 3, titulo: "Condições", pergunta: "Quanto tempo vale e o que o cliente precisa saber?" },
  { n: 4, titulo: "Revisão", pergunta: "Está tudo certo?" },
];

export type SituacaoDoPasso = "vazio" | "preenchido" | "problema";

export type EstadoDoPasso = {
  n: PassoDoOrcamento;
  titulo: string;
  /** O que o passo já tem, em uma linha: "2 itens · R$ 180,00". */
  resumo: string;
  situacao: SituacaoDoPasso;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type EntradaDosPassos = {
  clienteNome: string;
  titulo: string;
  itens: number;
  /** Itens sem descrição: não saem no PDF nem no pedido. */
  itensSemDescricao: number;
  /** Itens com problema de preço ou de medida (`resumoDoOrcamento().pendencias`). */
  pendencias: number;
  vendaTotal: number;
  validadeDias: number;
  observacoes: string;
  /** O prazo com taxa escolhido ("expresso"); nulo no prazo normal. */
  prazoNome?: string | null;
};

export function estadoDosPassos(a: EntradaDosPassos): EstadoDoPasso[] {
  const nome = a.clienteNome.trim();
  const titulo = a.titulo.trim();
  const clienteOk = nome !== "" && titulo !== "";
  const problemasDosItens = a.itensSemDescricao + a.pendencias;
  const itensOk = a.itens > 0 && problemasDosItens === 0;

  const passo1: EstadoDoPasso = {
    n: 1,
    titulo: "Cliente",
    resumo: clienteOk ? nome : nome === "" ? "falta o cliente" : "falta o assunto",
    situacao: clienteOk ? "preenchido" : "vazio",
  };

  const passo2: EstadoDoPasso = {
    n: 2,
    titulo: "Itens",
    resumo:
      a.itens === 0
        ? "nenhum item"
        : problemasDosItens > 0
          ? `${problemasDosItens} ${problemasDosItens === 1 ? "item pede" : "itens pedem"} atenção`
          : `${a.itens} ${a.itens === 1 ? "item" : "itens"} · ${brl(a.vendaTotal)}`,
    situacao: a.itens === 0 ? "vazio" : problemasDosItens > 0 ? "problema" : "preenchido",
  };

  const temObservacao = a.observacoes.trim() !== "";
  const prazoComTaxa = (a.prazoNome ?? "").trim();
  const passo3: EstadoDoPasso = {
    n: 3,
    titulo: "Condições",
    resumo: `vale ${a.validadeDias} ${a.validadeDias === 1 ? "dia" : "dias"}${prazoComTaxa ? ` · ${prazoComTaxa}` : ""}${temObservacao ? " · com observações" : ""}`,
    situacao: temObservacao || prazoComTaxa ? "preenchido" : "vazio",
  };

  const tudoCerto = clienteOk && itensOk;
  const passo4: EstadoDoPasso = {
    n: 4,
    titulo: "Revisão",
    resumo: tudoCerto
      ? "pronto para enviar"
      : !clienteOk
        ? "falta o cliente"
        : a.itens === 0
          ? "sem itens"
          : "confira os itens",
    situacao: tudoCerto
      ? "preenchido"
      : a.itens > 0 && problemasDosItens > 0
        ? "problema"
        : "vazio",
  };

  return [passo1, passo2, passo3, passo4];
}

/**
 * Onde abrir. O orçamento do parceiro nasce com cliente e assunto já preenchidos
 * (o diálogo "Novo orçamento" pede os dois), então o passo 1 já está feito: sem
 * itens, abre nos itens; com itens, abre na revisão. Pedido feito só se confere.
 */
export function passoInicial(a: {
  itens: number;
  somenteLeitura: boolean;
  clientePreenchido: boolean;
}): PassoDoOrcamento {
  if (a.somenteLeitura) return 4;
  if (!a.clientePreenchido) return 1;
  return a.itens === 0 ? 2 : 4;
}

export function passoSeguinte(p: PassoDoOrcamento): PassoDoOrcamento {
  return p === 4 ? 4 : ((p + 1) as PassoDoOrcamento);
}

export function passoAnterior(p: PassoDoOrcamento): PassoDoOrcamento {
  return p === 1 ? 1 : ((p - 1) as PassoDoOrcamento);
}

/** O botão que avança, dizendo para onde vai. */
export function rotuloDoAvancar(p: PassoDoOrcamento): string {
  // O índice do passo n é n - 1: o seguinte está em `p`. No último não há seguinte.
  return p === 4 ? "Revisão" : `Avançar: ${PASSOS_DO_ORCAMENTO[p].titulo}`;
}

export function ehUltimo(p: PassoDoOrcamento): boolean {
  return p === 4;
}
