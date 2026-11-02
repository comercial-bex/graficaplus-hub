import { validadeDoOrcamento, type OrcamentoDoQuadro } from "@/domain/orcamentos/quadro";

/**
 * Orçamentos enviados que estão para vencer, para o aviso do painel inicial
 * (02/11/2026). O Holdprint mostra a "meta de aprovação" de cada negócio; o
 * quadro de orçamentos já mostra "vence em N dias" em cada cartão, mas quem
 * abre o sistema de manhã começa pelo painel, não pelo quadro. Este aviso
 * conta o que vence em até `janelaDias` e o que já passou da data sem ninguém
 * mexer, e manda para a coluna Enviado do quadro.
 */

export const JANELA_PADRAO_DIAS = 3;

export type OrcamentoParaValidade = Pick<OrcamentoDoQuadro, "enviado_em" | "validade_dias"> & {
  id?: string;
  status?: string | null;
};

export type ResumoDaValidade = {
  /** Vencem de hoje até `janelaDias` dias. */
  vencendo: number;
  /** Já passaram da validade e continuam como enviados. */
  vencidos: number;
  /** Enviados com validade conhecida, para o denominador. */
  comValidade: number;
};

export function resumoDaValidade(
  lista: readonly OrcamentoParaValidade[],
  agora: Date,
  janelaDias: number = JANELA_PADRAO_DIAS,
): ResumoDaValidade {
  const r: ResumoDaValidade = { vencendo: 0, vencidos: 0, comValidade: 0 };
  for (const o of lista) {
    // Só o que ainda espera resposta do cliente conta; rascunho e aprovado não vencem.
    if (o.status != null && o.status !== "enviado") continue;
    const v = validadeDoOrcamento(o, agora);
    if (!v) continue;
    r.comValidade += 1;
    if (v.dias < 0) r.vencidos += 1;
    else if (v.dias <= janelaDias) r.vencendo += 1;
  }
  return r;
}

/** A frase do aviso, ou nada quando não há o que avisar. */
export function fraseDaValidade(r: ResumoDaValidade, janelaDias: number = JANELA_PADRAO_DIAS): string | null {
  const partes: string[] = [];
  if (r.vencendo > 0) {
    partes.push(
      r.vencendo === 1
        ? `1 orçamento enviado vence em até ${janelaDias} dias`
        : `${r.vencendo} orçamentos enviados vencem em até ${janelaDias} dias`,
    );
  }
  if (r.vencidos > 0) {
    partes.push(r.vencidos === 1 ? "1 já passou da validade sem resposta" : `${r.vencidos} já passaram da validade sem resposta`);
  }
  return partes.length > 0 ? partes.join(" e ") : null;
}
