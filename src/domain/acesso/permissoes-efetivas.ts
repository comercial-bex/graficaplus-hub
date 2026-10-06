import { rolePermissions, type Permission } from "@/lib/permissions";

/**
 * O que vale para quem está logado, e de onde a tela tirou isso.
 *
 * Três fontes, nesta ordem:
 *   1. banco   — `minhas_permissoes()`: papéis + exceções da pessoa, a mesma
 *                conta que as policies fazem (has_permission). É a certa.
 *   2. matriz  — `role_permission_matrix`: só os papéis, sem exceção. É o
 *                caminho de antes; vale quando a função 1 ainda não existe no
 *                banco (front publicado antes da migração) ou falhou.
 *   3. reserva — `rolePermissions`, o retrato escrito no código, quando nem a
 *                matriz carregou (rede ruim, primeiro instante da sessão).
 *
 * A tela só esconde e mostra: quem decide de verdade é o banco, linha a linha.
 * Uma fonte pior que a 1 pode mostrar um botão que o banco recusa, nunca abrir
 * um dado que ele fecha.
 */

export type FonteDasPermissoes = "banco" | "matriz" | "reserva";

export type EstadoDasPermissoes = {
  /** De quem é este estado (id de login); evita herdar o da conta anterior. */
  donoId: string | null;
  /** Chaves de minhas_permissoes(); null = não carregou. */
  efetivas: ReadonlySet<string> | null;
  /** Papel → chaves, da matriz do banco (só quando a fonte 1 falhou). */
  matriz: Readonly<Record<string, readonly string[]>>;
};

export const SEM_PERMISSOES: EstadoDasPermissoes = { donoId: null, efetivas: null, matriz: {} };

export function fonteDasPermissoes(e: EstadoDasPermissoes): FonteDasPermissoes {
  if (e.efetivas) return "banco";
  if (Object.keys(e.matriz).length > 0) return "matriz";
  return "reserva";
}

export function temPermissao(
  e: EstadoDasPermissoes,
  papeis: readonly string[],
  permissao: Permission,
): boolean {
  if (e.efetivas) return e.efetivas.has(permissao);
  if (Object.keys(e.matriz).length > 0) return papeis.some((p) => e.matriz[p]?.includes(permissao));
  return papeis.some((p) =>
    (rolePermissions[p as keyof typeof rolePermissions] as readonly string[] | undefined)?.includes(
      permissao,
    ),
  );
}

/**
 * O próximo estado depois de uma releitura.
 *
 * Se a função do banco respondeu, ela manda. Se falhou, e a MESMA pessoa já
 * tinha a resposta certa, fica com a de antes: trocar uma lista com exceções
 * por uma sem (a matriz) faria o menu de alguém mudar sozinho a cada queda de
 * rede. Sem resposta anterior da mesma pessoa, vale a matriz.
 */
export function proximoEstado(
  anterior: EstadoDasPermissoes,
  donoId: string,
  efetivas: ReadonlySet<string> | null,
  matriz: Readonly<Record<string, readonly string[]>> | null,
): EstadoDasPermissoes {
  if (efetivas) return { donoId, efetivas, matriz: {} };
  if (anterior.donoId === donoId && anterior.efetivas) return anterior;
  return { donoId, efetivas: null, matriz: matriz ?? {} };
}
