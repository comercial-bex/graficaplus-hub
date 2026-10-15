import type { Permission } from "@/lib/permissions";

/**
 * Quem inclui e apaga item da OS: as mesmas chaves da regra "itens_os
 * permission all" do banco (kanban.move ou orcamentos.create — admin, gestor e
 * vendedor). Os outros veem a lista; a regra recusaria a gravação de qualquer
 * jeito (migração 20261008043700).
 */
export const CHAVES_QUE_EDITAM_ITENS: readonly Permission[] = ["kanban.move", "orcamentos.create"];

export function podeEditarItensDaOS(temPermissao: (p: Permission) => boolean): boolean {
  return CHAVES_QUE_EDITAM_ITENS.some((p) => temPermissao(p));
}
