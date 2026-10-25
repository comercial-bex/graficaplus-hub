import type { Pendencia } from "@/hooks/usePendencias";
import { rotulosDoPapel, VISIVEL_TAMBEM_PARA } from "@/lib/pendenciasGuia";

/**
 * "Seu dia" (25/10/2026): os poucos números que decidem o começo do expediente de cada papel,
 * tirados da mesma contagem das pendências (nada novo no banco, o mesmo número do painel abaixo).
 *
 * Cada papel tem a sua lista, em ordem de importância para ele; sai no máximo QUATRO números, os de
 * maior gravidade primeiro, e só os que têm algo. Quem acumula papéis (o administrador vê tudo)
 * ainda recebe só quatro: mais que isso vira parede de números e ninguém lê.
 */

export const MAXIMO_DE_NUMEROS = 4;

/** As chaves de pendência que contam no resumo de cada rótulo, com o texto curto do cartão. */
export const RESUMO_POR_ROTULO: Record<string, { chave: string; curto: string }[]> = {
  atendimento: [
    { chave: "orcamento_aprovado_sem_os", curto: "aprovados sem OS" },
    { chave: "whatsapp_esperando_resposta", curto: "esperando no WhatsApp" },
    { chave: "orcamento_parado", curto: "orçamentos sem resposta" },
    { chave: "os_prazo_vencido", curto: "OS com prazo vencido" },
  ],
  producao: [
    { chave: "os_na_fila_de_producao", curto: "na fila de hoje" },
    { chave: "os_pronta_para_sair", curto: "prontas para sair" },
    { chave: "os_pronta_sem_entrega_agendada", curto: "prontas sem entrega agendada" },
    { chave: "apontamento_aberto_esquecido", curto: "apontamentos abertos" },
  ],
  gestao: [
    { chave: "os_parada", curto: "OS paradas" },
    { chave: "os_sem_material_reservado", curto: "esperando material" },
    { chave: "estoque_abaixo_minimo", curto: "materiais para repor" },
    { chave: "reembolsos_para_a_gerencia", curto: "reembolsos a decidir" },
  ],
  financeiro: [
    { chave: "parcela_vencida_sem_baixa", curto: "parcelas vencidas" },
    { chave: "conta_pagar_vencida", curto: "contas a pagar vencidas" },
    { chave: "comprovante_do_portal_a_conferir", curto: "comprovantes a conferir" },
    { chave: "produto_custo_provisorio", curto: "produtos com custo provisório" },
  ],
};

export type NumeroDoDia = {
  chave: string;
  curto: string;
  quantidade: number;
  severidade: Pendencia["severidade"];
  link: string;
};

const PESO: Record<Pendencia["severidade"], number> = { critico: 0, atencao: 1, ok: 2 };

/** Os números do dia de quem tem estes papéis, dado o que o banco devolveu. */
export function numerosDoDia(
  pendencias: readonly Pendencia[],
  papeis: readonly string[] | null | undefined,
): NumeroDoDia[] {
  const porChave = new Map(pendencias.map((p) => [p.chave, p]));
  const vistos = new Set<string>();
  const out: NumeroDoDia[] = [];
  for (const rotulo of rotulosDoPapel(papeis)) {
    for (const { chave, curto } of RESUMO_POR_ROTULO[rotulo] ?? []) {
      const p = porChave.get(chave);
      if (!p || p.quantidade <= 0 || vistos.has(chave)) continue;
      vistos.add(chave);
      out.push({ chave, curto, quantidade: p.quantidade, severidade: p.severidade, link: p.link });
    }
  }
  // O gestor também vê as pendências de custo e preço (além das da gerência).
  for (const [chave, quem] of Object.entries(VISIVEL_TAMBEM_PARA)) {
    const p = porChave.get(chave);
    if (!p || vistos.has(chave) || p.quantidade <= 0) continue;
    if (!quem.some((papel) => (papeis ?? []).includes(papel))) continue;
    const curto = RESUMO_POR_ROTULO.financeiro.find((x) => x.chave === chave)?.curto;
    if (!curto) continue;
    vistos.add(chave);
    out.push({ chave, curto, quantidade: p.quantidade, severidade: p.severidade, link: p.link });
  }
  return out
    .map((n, i) => ({ n, i }))
    .sort((a, b) => PESO[a.n.severidade] - PESO[b.n.severidade] || a.i - b.i)
    .map((x) => x.n)
    .slice(0, MAXIMO_DE_NUMEROS);
}
