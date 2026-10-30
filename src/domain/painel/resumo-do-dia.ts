import type { Pendencia } from "@/hooks/usePendencias";
import { rotulosDoPapel, veTodosOsAvisos, VISIVEL_TAMBEM_PARA } from "@/lib/pendenciasGuia";

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
    { chave: "whatsapp_encerrado_sem_resposta", curto: "contatos encerrados sem resposta" },
    { chave: "orcamento_rascunho_esquecido", curto: "rascunhos esquecidos" },
    { chave: "orcamento_parado", curto: "orçamentos sem resposta" },
    { chave: "item_sem_medida_e_sem_ficha", curto: "itens sem medida" },
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
    { chave: "baixa_de_estoque_pendente", curto: "OS sem baixa de material" },
    { chave: "estoque_nunca_carregado", curto: "materiais sem entrada" },
    { chave: "reembolsos_para_a_gerencia", curto: "reembolsos a decidir" },
    { chave: "decisoes_do_dono", curto: "decisões do dono" },
  ],
  financeiro: [
    { chave: "parcela_vencida_sem_baixa", curto: "parcelas vencidas" },
    { chave: "conta_pagar_vencida", curto: "contas a pagar vencidas" },
    { chave: "pagamento_sem_parcela", curto: "pagamentos sem parcela" },
    { chave: "pagamento_acima_da_conta", curto: "pagamentos acima da conta" },
    { chave: "compra_reserva_sem_conferir", curto: "compras sem nota a conferir" },
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
  // Administrador, gestor e financeiro veem os avisos de todas as áreas, os da própria área primeiro.
  const proprios = rotulosDoPapel(papeis) as string[];
  const rotulos = veTodosOsAvisos(papeis)
    ? [...proprios, ...Object.keys(RESUMO_POR_ROTULO).filter((r) => !proprios.includes(r))]
    : proprios;
  for (const rotulo of rotulos) {
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
