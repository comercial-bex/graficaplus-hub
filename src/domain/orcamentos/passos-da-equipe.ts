import type { EstadoDoPasso, PassoDoOrcamento } from "@/domain/parceiros/passos-do-orcamento";

/**
 * O orçamento da equipe (vendas e atendimento) nos MESMOS quatro passos do
 * parceiro (docs/plano-orcamento-em-passos.md): cliente, itens, condições e
 * revisão. A barra é a mesma, o jeito de navegar é o mesmo, e é na revisão que
 * mora o que só a equipe faz: mandar ao cliente e converter em OS.
 *
 * Os passos não bloqueiam nada. O que falta para mandar ao cliente já vinha de
 * `pendenciasParaEnviar` (domain/orcamentos/acordo.ts); aqui só se diz em QUAL
 * passo cada pendência se resolve, para o aviso do topo levar a pessoa até lá.
 */

export const PASSOS_DA_EQUIPE: readonly {
  n: PassoDoOrcamento;
  titulo: string;
  pergunta: string;
}[] = [
  { n: 1, titulo: "Cliente", pergunta: "Para quem é o orçamento e a que preço?" },
  { n: 2, titulo: "Itens", pergunta: "O que vai ser feito?" },
  { n: 3, titulo: "Condições", pergunta: "Quando entrega e como o cliente paga?" },
  { n: 4, titulo: "Revisão", pergunta: "Está tudo certo para enviar?" },
];

/** Em qual passo cada pendência de `pendenciasParaEnviar` se resolve. */
export function passoDaPendencia(pendencia: string): PassoDoOrcamento {
  if (pendencia === "cliente ou contato") return 1;
  if (pendencia === "itens" || pendencia.startsWith("layout")) return 2;
  if (
    pendencia === "data de entrega" ||
    pendencia === "condição de pagamento" ||
    pendencia === "aprovação do desconto"
  ) {
    return 3;
  }
  return 4;
}

export type EntradaDosPassosDaEquipe = {
  clienteNome: string | null;
  itens: number;
  /** Total do orçamento; nulo para quem não vê preço. */
  total: number | null;
  /** O que falta antes de mandar ao cliente (`pendenciasParaEnviar`). */
  pendencias: string[];
  /** Orçamento já virou OS: nada mais se altera. */
  fechado: boolean;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function estadoDosPassosDaEquipe(a: EntradaDosPassosDaEquipe): EstadoDoPasso[] {
  const doPasso = (p: PassoDoOrcamento) => a.pendencias.filter((x) => passoDaPendencia(x) === p);
  const cliente = (a.clienteNome ?? "").trim();

  const p1 = doPasso(1);
  const p2 = doPasso(2);
  const p3 = doPasso(3);
  const faltaItens = p2.includes("itens");
  const descontoPendente = p3.includes("aprovação do desconto");

  const passo1: EstadoDoPasso = {
    n: 1,
    titulo: "Cliente",
    resumo: p1.length > 0 ? "falta o cliente" : cliente || "contato informado",
    situacao: p1.length > 0 ? "vazio" : "preenchido",
  };

  const layouts = p2.filter((x) => x.startsWith("layout"));
  const passo2: EstadoDoPasso = {
    n: 2,
    titulo: "Itens",
    resumo: faltaItens
      ? "nenhum item"
      : `${plural(a.itens, "item", "itens")}${a.total !== null ? ` · ${brl(a.total)}` : ""}${layouts.length > 0 ? " · falta layout" : ""}`,
    situacao: faltaItens ? "vazio" : "preenchido",
  };

  const faltas3 = p3.filter((x) => x !== "aprovação do desconto").map((x) => `falta ${x}`);
  const passo3: EstadoDoPasso = {
    n: 3,
    titulo: "Condições",
    resumo: descontoPendente
      ? "desconto espera aprovação"
      : faltas3.length > 0
        ? faltas3[0] + (faltas3.length > 1 ? ` (+${faltas3.length - 1})` : "")
        : "entrega e pagamento definidos",
    situacao: descontoPendente ? "problema" : p3.length > 0 ? "vazio" : "preenchido",
  };

  const passo4: EstadoDoPasso = {
    n: 4,
    titulo: "Revisão",
    resumo: a.fechado
      ? "virou OS"
      : a.pendencias.length === 0
        ? "pronto para enviar"
        : `${plural(a.pendencias.length, "pendência", "pendências")}`,
    situacao:
      a.fechado || a.pendencias.length === 0
        ? "preenchido"
        : descontoPendente
          ? "problema"
          : "vazio",
  };

  return [passo1, passo2, passo3, passo4];
}

/**
 * Onde o orçamento abre. Convertido em OS ou com tudo certo, na revisão; sem
 * itens, nos itens; com itens mas faltando algo, no primeiro passo que falta.
 * Vale só na primeira carga (a tela guarda a escolha), para salvar o primeiro
 * item não fazer a tela pular de passo.
 */
export function passoInicialDaEquipe(a: {
  fechado: boolean;
  itens: number;
  pendencias: string[];
}): PassoDoOrcamento {
  if (a.fechado) return 4;
  if (a.itens === 0) return 2;
  if (a.pendencias.length === 0) return 4;
  const primeira = Math.min(...a.pendencias.map(passoDaPendencia));
  // Falta só layout: o passo 2 já é onde os layouts se resolvem.
  return primeira as PassoDoOrcamento;
}

/** O botão que avança: o passo seguinte; na revisão, quem avança é a ação (enviar ou converter). */
export {
  ehUltimo,
  passoAnterior,
  passoSeguinte,
  rotuloDoAvancar,
} from "@/domain/parceiros/passos-do-orcamento";
