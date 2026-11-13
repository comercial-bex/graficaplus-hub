import type { DialogoDaConversa, Disponivel } from "@/domain/whatsapp/acoes-de-trabalho";
import type { ModoDaCaixa } from "@/domain/whatsapp/moldura";

/**
 * Quais ações o cabeçalho da conversa mostra e onde (botão ou menu de três
 * pontos). Dono: CONVERSA (onda 1, 12/11/2026). Regra pura, sem tela, para o
 * teste prender "toda ação de hoje continua existindo" (contrato, seção 6.1).
 *
 * Botões de 44 px à vista (quando cabem): Assumir, Resolver (ou Reabrir) e
 * Orçamento. O resto mora no menu de três pontos, e a conversa estreita manda
 * tudo para lá.
 */

/**
 * Quanta coisa cabe à vista, medido pela largura DA CONVERSA (contêiner dela,
 * não a janela). Revisão da onda 1 (12/11/2026): a 375 px o cabeçalho tinha
 * Voltar, Assumir (112), Resolver (115), lupa e três pontos, somando 407 px em
 * 373: o nome ficava com 0 px e o menu de três pontos saía da tela (com ele,
 * Transferir, Arquivar, Criar OS e o resto ficavam inalcançáveis). Agora:
 *
 *   "so_menu"  estreito ou conversa abaixo de 520 px: à vista só (Voltar), foto,
 *              nome, lupa e três pontos. Assumir, Resolver e Orçamento vão para o menu.
 *   "icones"   de 520 a 759 px: Assumir, Resolver e Orçamento só com o ícone de
 *              44 px (o rótulo vai na Dica e no aria-label).
 *   "texto"    760 px ou mais: os três com ícone e texto.
 *
 * Com 520 px o nome ainda tem uns 190 px; com 760 e os três botões de texto,
 * uns 200 px (a conta está no teste).
 */
export const LARGURA_MINIMA_PARA_ICONES = 520;
export const LARGURA_MINIMA_PARA_TEXTO = 760;
/** Compatibilidade: o Orçamento sai do menu e vai para a vista a partir daqui. */
export const LARGURA_MINIMA_PARA_ORCAMENTO_NO_BOTAO = LARGURA_MINIMA_PARA_ICONES;

export type ApresentacaoDosBotoes = "so_menu" | "icones" | "texto";

/** Como os botões de ação aparecem, dado o modo da área e a largura da conversa. */
export function apresentacaoDosBotoes(
  modo: ModoDaCaixa,
  larguraDaConversa: number | null,
): ApresentacaoDosBotoes {
  if (modo === "estreito") return "so_menu";
  // Sem a medida ainda, trata como larga (não pisca o botão para o menu).
  if (larguraDaConversa === null) return "texto";
  if (larguraDaConversa < LARGURA_MINIMA_PARA_ICONES) return "so_menu";
  return larguraDaConversa < LARGURA_MINIMA_PARA_TEXTO ? "icones" : "texto";
}

export type EntradaDoCabecalho = {
  temPermissaoDeResponder: boolean;
  /** Situação da conversa: aberta, pendente, resolvida, arquivada... */
  status: string;
  responsavelId: string | null;
  meuId: string | null;
  modo: ModoDaCaixa;
  /** Largura da conversa em px (null = ainda não medida: trata como larga). */
  larguraDaConversa: number | null;
  iaLigada: boolean;
  /** `conversa.modo` ("auto" = a assistente responde). */
  modoDaConversa: string | null | undefined;
  disponivel: Record<DialogoDaConversa, Disponivel>;
};

export type AcoesDoCabecalho = {
  /** "direto" assume na hora; "confirmar" pede confirmação (é de outra pessoa). */
  assumir: "nenhum" | "direto" | "confirmar";
  /** O botão da situação: Resolver (conversa em andamento) ou Reabrir. */
  situacao: "resolver" | "reabrir" | null;
  /** Como os botões de ação aparecem (ver `apresentacaoDosBotoes`). */
  apresentacao: ApresentacaoDosBotoes;
  /** Assumir e Resolver/Reabrir moram no menu de três pontos (conversa estreita). */
  situacaoNoMenu: boolean;
  orcamentoNoBotao: boolean;
  orcamentoNoMenu: boolean;
  transferir: boolean;
  /** "marcar" (aberta) ou "tirar" (pendente). */
  pendente: "marcar" | "tirar" | null;
  arquivar: boolean;
  devolverAAssistente: boolean;
};

export function acoesDoCabecalho(e: EntradaDoCabecalho): AcoesDoCabecalho {
  const emAndamento = e.status === "aberta" || e.status === "pendente";
  const p = e.temPermissaoDeResponder;
  const assumir: AcoesDoCabecalho["assumir"] = !p
    ? "nenhum"
    : !e.responsavelId
      ? "direto"
      : e.responsavelId !== e.meuId
        ? "confirmar"
        : "nenhum";
  const apresentacao = apresentacaoDosBotoes(e.modo, e.larguraDaConversa);
  const cabeNoBotao = apresentacao !== "so_menu";
  const orcamentoLiberado = e.disponivel.orcamento.pode;
  const comAssistente = e.modoDaConversa === "auto" && !e.responsavelId;
  return {
    apresentacao,
    situacaoNoMenu: !cabeNoBotao,
    assumir,
    situacao: !p ? null : emAndamento ? "resolver" : "reabrir",
    orcamentoNoBotao: orcamentoLiberado && cabeNoBotao,
    // Sem permissão o item continua no menu, desabilitado e com o motivo: a ação não "some".
    orcamentoNoMenu: !(orcamentoLiberado && cabeNoBotao),
    transferir: p,
    pendente: !p ? null : e.status === "aberta" ? "marcar" : e.status === "pendente" ? "tirar" : null,
    arquivar: p && e.status !== "arquivada",
    devolverAAssistente: p && e.iaLigada && emAndamento && !comAssistente,
  };
}
