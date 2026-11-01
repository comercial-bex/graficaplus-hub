/**
 * Quadro de orçamentos (31/10/2026), Onda 5 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: o "Painel de Negociação" do
 * Holdprint, com o total em dinheiro e a quantidade de cada coluna.
 *
 * Cada orçamento cai em UMA coluna só. Virar OS é ter `os_id`, não o status: a
 * conversão comum deixa o orçamento "aprovado" (o portal e o painel do parceiro
 * contam por ele), então `os_id` manda.
 */

export type ColunaDoQuadro = "rascunho" | "enviado" | "aprovado" | "os" | "rejeitado" | "expirado";

export interface OrcamentoDoQuadro {
  id: string;
  numero?: number | string | null;
  titulo?: string | null;
  status: string;
  os_id?: string | null;
  valor_total?: number | string | null;
  cliente_nome?: string | null;
  contato_nome?: string | null;
  created_at?: string | null;
}

export interface DefinicaoDeColuna {
  id: ColunaDoQuadro;
  titulo: string;
  /** O que a coluna quer dizer, em uma frase. */
  dica: string;
  /** Em andamento (true) ou já encerrada (false): as encerradas ficam mais discretas. */
  aberta: boolean;
}

export const COLUNAS_DO_QUADRO: readonly DefinicaoDeColuna[] = [
  { id: "rascunho", titulo: "Rascunhos", dica: "Ainda em montagem, nada foi ao cliente.", aberta: true },
  { id: "enviado", titulo: "Enviados", dica: "Com o cliente, esperando resposta.", aberta: true },
  { id: "aprovado", titulo: "Aprovados", dica: "O cliente aprovou e falta converter em OS.", aberta: true },
  { id: "os", titulo: "Viraram OS", dica: "Já estão na produção.", aberta: false },
  { id: "rejeitado", titulo: "Rejeitados", dica: "O cliente recusou ou pediu ajuste.", aberta: false },
  { id: "expirado", titulo: "Expirados", dica: "Passou a validade sem resposta.", aberta: false },
];

export function colunaDoOrcamento(o: Pick<OrcamentoDoQuadro, "status" | "os_id">): ColunaDoQuadro {
  if (o.os_id || o.status === "convertido") return "os";
  switch (o.status) {
    case "enviado":
      return "enviado";
    case "aprovado":
      return "aprovado";
    case "rejeitado":
      return "rejeitado";
    case "expirado":
      return "expirado";
    default:
      return "rascunho";
  }
}

export interface ColunaMontada extends DefinicaoDeColuna {
  itens: OrcamentoDoQuadro[];
  quantidade: number;
  /** Soma do valor da coluna; `null` quando a pessoa não vê preço (a soma seria chute). */
  total: number | null;
}

const valorDe = (o: OrcamentoDoQuadro) => {
  const v = Number(o.valor_total ?? 0);
  return Number.isFinite(v) ? v : 0;
};

export function montarQuadro(lista: OrcamentoDoQuadro[], opcoes: { mostrarValores: boolean }): ColunaMontada[] {
  const porColuna = new Map<ColunaDoQuadro, OrcamentoDoQuadro[]>(COLUNAS_DO_QUADRO.map((c) => [c.id, []]));
  for (const o of lista) porColuna.get(colunaDoOrcamento(o))!.push(o);
  return COLUNAS_DO_QUADRO.map((c) => {
    const itens = porColuna.get(c.id)!;
    return {
      ...c,
      itens,
      quantidade: itens.length,
      total: opcoes.mostrarValores ? itens.reduce((soma, o) => soma + valorDe(o), 0) : null,
    };
  });
}

/** Dias inteiros desde a criação; `null` se a data não existe ou não lê. */
export function idadeEmDias(criadoEm: string | null | undefined, agora: Date): number | null {
  if (!criadoEm) return null;
  const t = new Date(criadoEm).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

export function rotuloDaIdade(dias: number | null): string | null {
  if (dias === null) return null;
  if (dias === 0) return "criado hoje";
  return dias === 1 ? "criado há 1 dia" : `criado há ${dias} dias`;
}
