import { lerNumero } from "./planilha-csv";
import { custoHoraComEncargos } from "@/domain/financeiro/encargos";

/**
 * O que fazer quando alguém sai de um campo de custo na planilha.
 *
 * Campo vazio não é zero: tirar o foco de um campo apagado restaura o valor anterior e não grava nada. Zero só
 * grava quando alguém digitou o zero.
 */
export type DecisaoDeCampo =
  | { acao: "gravar"; valor: number }
  | { acao: "manter" }
  | { acao: "recusar"; mensagem: string };

export function decidirCampo(
  texto: string | null | undefined,
  atual: number | null | undefined,
  opcoes: { maximo?: number; mensagemDoMaximo?: string } = {},
): DecisaoDeCampo {
  if (texto == null || texto.trim() === "") return { acao: "manter" };
  const n = lerNumero(texto);
  if (n == null)
    return { acao: "recusar", mensagem: "Não entendi esse número. O valor anterior foi mantido." };
  if (n < 0)
    return {
      acao: "recusar",
      mensagem: "O valor não pode ser negativo. O valor anterior foi mantido.",
    };
  if (opcoes.maximo != null && n > opcoes.maximo) {
    return {
      acao: "recusar",
      mensagem:
        opcoes.mensagemDoMaximo ?? "O valor passou do máximo. O valor anterior foi mantido.",
    };
  }
  if (atual != null && Number.isFinite(Number(atual)) && Number(atual) === n)
    return { acao: "manter" };
  return { acao: "gravar", valor: n };
}

/** Texto para devolver ao campo quando o valor anterior volta. */
export function textoDoValor(valor: number | null | undefined): string {
  return valor == null || !Number.isFinite(Number(valor)) ? "" : String(Number(valor));
}

/**
 * Custo do material que as contas do banco usam: `COALESCE(custo_medio, custo_unitario, 0)`, como em
 * custo_cheio_do_produto e recalcular_custo_produto (migrações 20261116100000 e 20261116130000, e a função viva lida
 * na auditoria de 17/11). O médio manda quando existe, mesmo que o último preço de compra seja outro.
 */
export function custoVigenteDoMaterial(m: { custo_unitario?: unknown; custo_medio?: unknown }): {
  valor: number;
  origem: "medio" | "ultima_compra" | "nenhum";
} {
  const lido = (v: unknown) =>
    v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const medio = lido(m.custo_medio);
  if (medio != null) return { valor: medio, origem: medio > 0 ? "medio" : "nenhum" };
  const unitario = lido(m.custo_unitario);
  if (unitario != null)
    return { valor: unitario, origem: unitario > 0 ? "ultima_compra" : "nenhum" };
  return { valor: 0, origem: "nenhum" };
}

/* Encargos: o banco guarda FRAÇÃO (0,3282), a tela mostra e edita PORCENTAGEM (32,82). */

export const LIMITE_DE_ENCARGOS_EM_PORCENTAGEM = 100;

export function fracaoParaPorcentagem(fracao: unknown): number {
  const n = Number(fracao);
  return Number.isFinite(n) ? Number((n * 100).toFixed(4)) : 0;
}

export function porcentagemParaFracao(porcentagem: number): number {
  return Number((porcentagem / 100).toFixed(6));
}

/** "32,82 %" a partir da fração guardada. */
export function textoDeEncargos(fracao: unknown): string {
  return `${fracaoParaPorcentagem(fracao).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} %`;
}

export const MENSAGEM_DE_ENCARGOS_ACIMA_DO_LIMITE =
  "Encargo acima de 100 % quase sempre é engano. Para 32,82 %, digite 32,82. O valor anterior foi mantido.";

/** Lê o que foi digitado em porcentagem e devolve a fração para gravar. `atualFracao` é o que está no banco. */
export function decidirEncargos(
  texto: string | null | undefined,
  atualFracao: unknown,
): DecisaoDeCampo {
  const d = decidirCampo(texto, fracaoParaPorcentagem(atualFracao), {
    maximo: LIMITE_DE_ENCARGOS_EM_PORCENTAGEM,
    mensagemDoMaximo: MENSAGEM_DE_ENCARGOS_ACIMA_DO_LIMITE,
  });
  return d.acao === "gravar" ? { acao: "gravar", valor: porcentagemParaFracao(d.valor) } : d;
}

/** Hora cheia: base x (1 + fração). */
export function horaCheia(custoHora: unknown, encargosFracao: unknown): number {
  return custoHoraComEncargos(custoHora, encargosFracao);
}

/** Um campo de processo: só número maior que zero conta como medida. */
export function ehMedicaoNova(produtividade: string, original: string | undefined): boolean {
  const n = lerNumero(produtividade);
  if (n == null || n <= 0) return false;
  const o = lerNumero(original ?? "");
  return o == null || o !== n;
}
