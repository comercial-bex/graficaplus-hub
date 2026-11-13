/**
 * A moldura da caixa do WhatsApp (/whatsapp), em regras puras. Dono: MOLDURA
 * (onda 1, 12/11/2026).
 *
 * A caixa tem três modos, escolhidos pela LARGURA ÚTIL da área (o contêiner
 * `@container/caixa` da tela), nunca pela janela: com o menu lateral aberto
 * (328 px) a mesma janela de 1280 px deixa 952 px para a caixa; recolhido
 * (trilho de 64 px), 1216 px. Até 11/11/2026 os pontos de quebra olhavam a
 * janela e a conversa ficava com 244 px a 1280 px com o menu aberto.
 *
 *   estreito  (menos de 840 px): uma peça por vez, lista OU conversa; os dados
 *             do contato abrem por cima, na tela inteira.
 *   medio     (840 a 1279 px): lista de 320 px e conversa (de 520 a 959 px);
 *             os dados do contato abrem numa gaveta por cima, à direita.
 *   largo     (1280 px ou mais): lista de 360 px, conversa e, quando abertos,
 *             os dados do contato encaixados à direita (360 px); a conversa
 *             nunca fica com menos de 560 px.
 *
 * Os mesmos números estão escritos nas classes `@min-[840px]/caixa` e
 * `@min-[1280px]/caixa` da tela (o Tailwind precisa do número no texto da
 * classe); tests/whatsapp-onda-1-contrato.test.ts confere que os dois batem.
 */

export type ModoDaCaixa = "estreito" | "medio" | "largo";

/** A partir de quantos px úteis cada modo começa. */
export const LIMITES_DA_CAIXA = { medio: 840, largo: 1280 } as const;

/** Largura da lista de conversas em cada modo (no estreito ela ocupa tudo). */
export const LARGURA_DA_LISTA = { medio: 320, largo: 360 } as const;

/** Largura dos dados do contato encaixados (só no modo largo). */
export const LARGURA_DA_GAVETA = 360;

/** O modo da caixa pela largura útil do contêiner, em px. */
export function modoPelaLargura(larguraUtil: number): ModoDaCaixa {
  if (!Number.isFinite(larguraUtil) || larguraUtil < LIMITES_DA_CAIXA.medio) return "estreito";
  if (larguraUtil < LIMITES_DA_CAIXA.largo) return "medio";
  return "largo";
}

/** A conversa nunca fica com menos que isto nos modos médio e largo (era 244 px a 1280 px com o menu aberto). */
export const LARGURA_MINIMA_DA_CONVERSA = 520;

/**
 * Quantos px a conversa tem, dada a largura útil da área. Serve ao teste que
 * prende "a conversa não é espremida" (tests/whatsapp-moldura.test.ts, da
 * MOLDURA) e a quem quiser conferir uma largura sem abrir o navegador.
 * `gavetaEncaixadaAberta` só conta no modo largo; nos outros a gaveta vai por
 * cima e não tira largura da conversa.
 */
export function larguraDaConversa(larguraUtil: number, gavetaEncaixadaAberta: boolean): number {
  const modo = modoPelaLargura(larguraUtil);
  if (modo === "estreito") return larguraUtil;
  if (modo === "medio") return larguraUtil - LARGURA_DA_LISTA.medio;
  return (
    larguraUtil - LARGURA_DA_LISTA.largo - (gavetaEncaixadaAberta ? LARGURA_DA_GAVETA : 0)
  );
}

/** O título-base da aba do navegador na caixa. O ponto médio (e não travessão) vem da decisão 12 do dono. */
export const TITULO_DA_CAIXA = "WhatsApp · BEX PRINT OS";

/**
 * O título da aba com as conversas não lidas: "(3) WhatsApp · BEX PRINT OS".
 * N é o número de CONVERSAS com mensagem não lida (não de mensagens), a mesma
 * conta do chip "Não lidas". Sem nenhuma, o título-base.
 */
export function tituloDaAba(naoLidas: number): string {
  const n = Number.isFinite(naoLidas) ? Math.floor(naoLidas) : 0;
  return n > 0 ? `(${n > 99 ? "99+" : n}) ${TITULO_DA_CAIXA}` : TITULO_DA_CAIXA;
}

/** Chave do `localStorage` que lembra os dados do contato abertos no modo largo ("1" ou "0"). */
export const CHAVE_DOS_DADOS_DO_CONTATO = "wa-dados-do-contato";

const FUSO_DA_CAIXA = "America/Belem";

/**
 * A hora da linha da lista, como no WhatsApp: "14:32" hoje, "Ontem" e depois
 * "12/11/2026". Sempre no fuso de Belém (o vitest roda em UTC e o servidor
 * também). Até 11/11/2026 a lista agrupava por dia ("Hoje", "Ontem"); sem os
 * grupos, a palavra vai na própria linha.
 */
export function horaDaLinha(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const chave = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO_DA_CAIXA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(x); // "2026-11-12"
  const dia = chave(d);
  const hoje = chave(agora);
  if (dia === hoje) {
    return d.toLocaleTimeString("pt-BR", { timeZone: FUSO_DA_CAIXA, hour: "2-digit", minute: "2-digit" });
  }
  // Ontem = o dia do calendário antes de hoje (sem somar 24 h: o fuso de Belém
  // não tem horário de verão, mas a conta por dia não depende disso).
  const [a, m, di] = hoje.split("-").map(Number);
  const ontem = new Date(Date.UTC(a, m - 1, di - 1)).toISOString().slice(0, 10);
  if (dia === ontem) return "Ontem";
  const [ad, md, dd] = dia.split("-");
  return `${dd}/${md}/${ad}`;
}
