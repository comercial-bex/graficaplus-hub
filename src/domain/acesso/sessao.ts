/**
 * Quando a tela deve reagir à sessão — e quando não deve.
 *
 * A biblioteca de login (auth-js 2.106) avisa "SIGNED_IN" TODA vez que a aba
 * volta a ficar visível (`_onVisibilityChanged` → `_recoverAndRefresh`), e
 * "TOKEN_REFRESHED" a cada hora. O app tratava qualquer aviso como troca de
 * conta: recarregava todas as consultas da tela e relia papéis e permissões.
 * Medido no painel em 07/10/2026: 59 chamadas ao banco a cada volta à aba, e
 * papéis e permissões lidos 3 vezes cada na abertura.
 *
 * A regra daqui: só a TROCA de pessoa (entrar, sair, entrar com outra conta)
 * recarrega tudo. Renovação de token e aba que volta não mudam quem está
 * logado — e o banco segue decidindo o acesso linha a linha de qualquer jeito.
 */

/**
 * `undefined` = a tela ainda não sabe quem está logado (antes do primeiro
 * aviso). `null` = ninguém logado.
 */
export type DonoDaSessao = string | null | undefined;

/** Mudou a pessoa logada? A primeira leitura não é mudança: é o começo. */
export function trocouDeConta(anterior: DonoDaSessao, atual: string | null): boolean {
  if (anterior === undefined) return false;
  return anterior !== atual;
}

/**
 * Dado com mais de um minuto é refeito quando a pessoa volta à aba; mais novo
 * que isso, não. Com o padrão do react-query (staleTime 0) a volta refazia
 * todas as consultas da tela, mesmo as lidas segundos antes.
 */
export const REFAZER_AO_VOLTAR_DEPOIS_DE_MS = 60_000;

export function refazerAoVoltar(dadoAtualizadoEmMs: number, agoraMs: number): boolean {
  // Nunca carregou (0) ou carregou há mais de um minuto.
  return agoraMs - dadoAtualizadoEmMs > REFAZER_AO_VOLTAR_DEPOIS_DE_MS;
}

/**
 * Cópia do acesso (papéis e permissões) guardada no aparelho, para o menu
 * abrir sem esperar a rede. É só para DESENHAR a tela: quem decide o que cada
 * um vê é o banco (RLS e has_permission), e a cópia é conferida logo depois
 * de abrir. Vale para a mesma pessoa e por até 7 dias.
 */
export const CHAVE_DO_ACESSO_GUARDADO = "bexprint:acesso:v1";
export const VALIDADE_DO_ACESSO_GUARDADO_MS = 7 * 24 * 60 * 60 * 1000;

export type AcessoGuardado = {
  donoId: string;
  papeis: string[];
  /** Chaves de minhas_permissoes(); null quando a função não respondeu. */
  efetivas: string[] | null;
  guardadoEmMs: number;
};

export function lerAcessoGuardado(
  texto: string | null,
  donoId: string,
  agoraMs: number,
): AcessoGuardado | null {
  if (!texto) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!bruto || typeof bruto !== "object") return null;
  const a = bruto as Partial<AcessoGuardado>;
  if (a.donoId !== donoId) return null;
  if (!Array.isArray(a.papeis) || !a.papeis.every((p) => typeof p === "string")) return null;
  if (a.efetivas !== null && !(Array.isArray(a.efetivas) && a.efetivas.every((p) => typeof p === "string")))
    return null;
  if (typeof a.guardadoEmMs !== "number") return null;
  if (agoraMs - a.guardadoEmMs > VALIDADE_DO_ACESSO_GUARDADO_MS || a.guardadoEmMs > agoraMs + 60_000)
    return null;
  // Sem papel nenhum não se guarda: a tela de "Aguardando liberação" tem de
  // vir da leitura do banco, nunca de uma cópia velha.
  if (a.papeis.length === 0) return null;
  return { donoId, papeis: a.papeis, efetivas: a.efetivas ?? null, guardadoEmMs: a.guardadoEmMs };
}

export function textoDoAcessoGuardado(a: AcessoGuardado): string {
  return JSON.stringify(a);
}

/**
 * A sessão que a biblioteca de login guardou no aparelho (localStorage, chave
 * `sb-<projeto>-auth-token`). Serve para desenhar o menu sem esperar a
 * renovação do token (1,1 s medido em 07/10/2026, toda vez que o token tinha
 * vencido). Os dados continuam esperando a sessão confirmada: cada consulta
 * passa pela biblioteca, que só manda com token válido. Se a confirmação
 * disser "ninguém logado", a tela volta para o login.
 */
export type SessaoSalva = { userId: string; user: { id: string } & Record<string, unknown> };

const CHAVE_DA_SESSAO = /^sb-[a-z0-9]+-auth-token$/;

export function sessaoSalvaNoAparelho(
  armazenamento: Pick<Storage, "length" | "key" | "getItem">,
): SessaoSalva | null {
  for (let i = 0; i < armazenamento.length; i++) {
    const chave = armazenamento.key(i);
    if (!chave || !CHAVE_DA_SESSAO.test(chave)) continue;
    try {
      const s = JSON.parse(armazenamento.getItem(chave) ?? "null") as {
        refresh_token?: unknown;
        user?: { id?: unknown } & Record<string, unknown>;
      } | null;
      const user = s?.user;
      if (typeof s?.refresh_token === "string" && s.refresh_token && user && typeof user.id === "string" && user.id) {
        return { userId: user.id, user: user as SessaoSalva["user"] };
      }
    } catch {
      /* texto estragado: segue procurando, e no fim espera a biblioteca */
    }
  }
  return null;
}

/**
 * Releitura de permissões quando a aba volta: no máximo uma por minuto.
 * Exceção dada ou tirada continua valendo no banco na hora; a tela só
 * redesenha o menu.
 */
export const RELER_PERMISSOES_A_CADA_MS = 60_000;

export function relerPermissoesAoVoltar(ultimaLeituraEmMs: number, agoraMs: number): boolean {
  return agoraMs - ultimaLeituraEmMs >= RELER_PERMISSOES_A_CADA_MS;
}
