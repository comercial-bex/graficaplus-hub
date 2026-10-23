/**
 * Para que a OS existe (23/10/2026). `venda` é o padrão; as outras três são OS
 * interna — trabalho com máquina, material e hora de gente, sem cliente nem
 * receita. A fonte é `ordens_servico.finalidade` (lida por `os_finalidade_v`).
 */
export type FinalidadeDaOS = "venda" | "mostruario" | "uso_interno" | "reposicao";

export const ROTULO_DA_FINALIDADE: Record<FinalidadeDaOS, string> = {
  venda: "Venda",
  mostruario: "Mostruário",
  uso_interno: "Uso interno",
  reposicao: "Reposição",
};
