import { mensagemErro } from "@/lib/erros";
import { podeRenovar, type OrcamentoRenovavel } from "@/domain/orcamentos/renovacao";

/**
 * O que a equipe pode fazer com o status de um orçamento (17/11/2026, onda 1 de orçamentos).
 *
 * Antes havia um Select que gravava qualquer status por UPDATE direto: dava para aprovar sem a regra do banco,
 * recusar um rascunho e reabrir um orçamento recusado. Agora cada passo é um botão com confirmação, e a
 * aprovação e a renovação passam por funções do banco (`aprovar_orcamento`, `renovar_orcamento_vencido`).
 *
 * Este arquivo só decide o que aparece e traduz o erro. Quem manda é o banco; a tela nunca cai em UPDATE
 * direto quando uma função ainda não existe: mostra que o recurso não está disponível.
 */

export const ROTULO_DE_STATUS_DESCONHECIDO = "Situação não reconhecida";

export const MENSAGEM_FUNCAO_AUSENTE = "Este recurso ainda não está disponível. Avise o gestor.";
export const MENSAGEM_PERFIL_NAO_ALTERA = "Seu perfil não pode alterar este orçamento, ou ele mudou de situação. Atualize a tela e confira.";
export const MENSAGEM_PERFIL_NAO_APAGA = "Seu perfil não pode apagar este orçamento, ou ele já mudou de situação. Atualize a tela e confira.";
export const MENSAGEM_APAGAR_BLOQUEADO = "Este orçamento não pode ser apagado. Fale com o gestor.";

/** O rótulo nunca some: status que a tela não conhece aparece como veio do banco. */
export function rotuloDoStatus(rotulos: Record<string, string>, status: string | null | undefined): string {
  if (!status) return ROTULO_DE_STATUS_DESCONHECIDO;
  return rotulos[status] ?? status;
}

type ErroDoBanco = { code?: unknown; message?: unknown; details?: unknown };

/** A função do banco ainda não foi aplicada (42883 no Postgres, PGRST202 no PostgREST). */
export function funcaoAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as ErroDoBanco;
  const codigo = typeof e.code === "string" ? e.code : "";
  if (codigo === "42883" || codigo === "PGRST202") return true;
  const texto = typeof e.message === "string" ? e.message : "";
  return /could not find the function|function .* does not exist/i.test(texto);
}

/** O código de máquina que as funções de equipe põem no DETAIL do erro, quando há. */
export function codigoDoErro(erro: unknown): string {
  if (!erro || typeof erro !== "object") return "";
  const d = (erro as ErroDoBanco).details;
  return typeof d === "string" ? d.trim() : "";
}

/**
 * Mensagem para a tela quando uma função de equipe recusa. O texto pronto vem do banco em `message`; o
 * `details` é só o código e nunca vai para a tela (o `mensagemErro` comum o juntaria ao texto).
 */
export function mensagemDaFuncao(erro: unknown, padrao: string): string {
  if (funcaoAusente(erro)) return MENSAGEM_FUNCAO_AUSENTE;
  const texto = erro && typeof erro === "object" ? (erro as ErroDoBanco).message : undefined;
  return mensagemErro({ message: typeof texto === "string" ? texto : "" }, padrao);
}

/** Exclusão: o gatilho do banco barra com 23001 e mensagem pronta; qualquer outra trava vira o texto neutro. */
export function mensagemDaExclusao(erro: unknown): string {
  const e = (erro && typeof erro === "object" ? erro : {}) as ErroDoBanco;
  const codigo = typeof e.code === "string" ? e.code : "";
  const texto = typeof e.message === "string" ? e.message : "";
  if (codigo === "23001" || codigo === "23503") {
    return /^Este orçamento não pode ser apagado/.test(texto) ? texto : MENSAGEM_APAGAR_BLOQUEADO;
  }
  if (funcaoAusente(erro)) return MENSAGEM_FUNCAO_AUSENTE;
  return mensagemErro({ message: texto }, "Não foi possível apagar o orçamento. Tente de novo.");
}

export interface OrcamentoDasAcoes extends OrcamentoRenovavel {
  os_id?: string | null;
  created_at?: string | null;
}

export interface PermissoesDasAcoes {
  aprovar: boolean;
  alterar: boolean;
  /** Renovar exige criar E enviar (o banco confere as duas). */
  renovar: boolean;
  /** Admin ou gestor. */
  apagar: boolean;
}

export interface AcoesDoOrcamento {
  aprovar: boolean;
  recusar: boolean;
  expirar: boolean;
  renovar: boolean;
  apagar: boolean;
}

/** Quais botões aparecem. Orçamento que já virou OS não tem nenhum: o caminho dele é a OS. */
export function acoesDoOrcamento(o: OrcamentoDasAcoes, p: PermissoesDasAcoes, agora: Date): AcoesDoOrcamento {
  const fechado = o.status === "convertido" || !!o.os_id;
  if (fechado) return { aprovar: false, recusar: false, expirar: false, renovar: false, apagar: false };
  const enviado = o.status === "enviado";
  return {
    aprovar: enviado && p.aprovar,
    recusar: enviado && p.alterar,
    expirar: enviado && p.alterar,
    renovar: p.renovar && podeRenovar(o, agora),
    apagar: o.status === "rascunho" && p.apagar,
  };
}
