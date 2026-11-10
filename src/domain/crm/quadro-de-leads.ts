import { canalDaOrigem, type Canal } from "./origens";

export type LeadDoQuadro = {
  lead_id: string;
  origem: string | null;
  estagio: string;
  orcamentos: number;
  valor_orcado: number;
  valor_potencial: number;
};

export type AbaDoQuadro = "todos" | Canal;

export const ABAS: { chave: AbaDoQuadro; rotulo: string }[] = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "whatsapp", rotulo: "WhatsApp" },
  { chave: "instagram", rotulo: "Instagram" },
  { chave: "facebook", rotulo: "Facebook" },
  { chave: "outros", rotulo: "Outros" },
];

export type ValorDoCartao = { valor: number; fonte: "orcado" | "potencial" } | null;

/** Orçado quando há orçamento com valor > 0; senão potencial > 0; senão nada. */
export function valorDoCartao(
  l: Pick<LeadDoQuadro, "orcamentos" | "valor_orcado" | "valor_potencial">,
): ValorDoCartao {
  const orcado = Number(l.valor_orcado) || 0;
  if (l.orcamentos > 0 && orcado > 0) return { valor: orcado, fonte: "orcado" };
  const potencial = Number(l.valor_potencial) || 0;
  if (potencial > 0) return { valor: potencial, fonte: "potencial" };
  return null;
}

export function leadsDaAba<T extends LeadDoQuadro>(leads: T[], aba: AbaDoQuadro): T[] {
  return aba === "todos" ? leads : leads.filter((l) => canalDaOrigem(l.origem) === aba);
}

export function contagemPorAba(leads: LeadDoQuadro[]): Record<AbaDoQuadro, number> {
  const c: Record<AbaDoQuadro, number> = {
    todos: leads.length,
    whatsapp: 0,
    instagram: 0,
    facebook: 0,
    outros: 0,
  };
  for (const l of leads) c[canalDaOrigem(l.origem)] += 1;
  return c;
}

const somar = (leads: LeadDoQuadro[]) =>
  leads.reduce((s, l) => s + (valorDoCartao(l)?.valor ?? 0), 0);

export type ColunaDoQuadro<T> = { chave: string; leads: T[]; quantidade: number; soma: number };

/** Colunas na ordem das etapas dadas, com quantidade e soma; totais da aba e em aberto. */
export function montarQuadro<T extends LeadDoQuadro>(leads: T[], etapas: readonly string[]) {
  const colunas: ColunaDoQuadro<T>[] = etapas.map((chave) => {
    const daEtapa = leads.filter((l) => l.estagio === chave);
    return { chave, leads: daEtapa, quantidade: daEtapa.length, soma: somar(daEtapa) };
  });
  const visiveis = colunas.flatMap((c) => c.leads);
  return {
    colunas,
    vazio: visiveis.length === 0,
    totalDaAba: somar(visiveis),
    emAberto: somar(visiveis.filter((l) => !["entregue", "perdido"].includes(l.estagio))),
  };
}
