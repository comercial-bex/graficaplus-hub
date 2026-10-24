/**
 * Sugestão de orçamento para um job do Flexi (fase 2 de docs/plano-importacao-flexi.md).
 *
 * Aqui só se SUGERE. Quem confirma é uma pessoa: vínculo errado vira baixa de
 * estoque errada na fase 3, e a conferência de hoje (24/10/2026) mostrou que
 * a medida sozinha acerta quase tudo — mas "quase" não serve para estoque.
 *
 * Duas fontes, nesta ordem:
 *   1. NÚMERO NO NOME. `O115` é o orçamento 115; `OS108` é a OS 108. Sem espaço
 *      entre a letra e o número: "O 80x120" é uma medida, não o orçamento 80.
 *   2. MEDIDA + CÓPIAS + DATA. O job tem sangria, então a medida confere com
 *      folga: 3 cm ou 2% do lado, o que for maior (a lona de 5 m × 1,3 m saiu
 *      com 503,8 × 131 cm). Vale girada. A data do orçamento tem que estar a
 *      até 7 dias da saída — o job de 21/10 da lona 80×120 foi impresso um dia
 *      ANTES de o orçamento 107 existir, então "depois" também vale.
 *
 * "Otimizar Distribuição" é o PAI de um aninhamento: tem a medida da chapa, não
 * a de um pedido. Não recebe sugestão. Os filhos, sim — cada um é um pedido.
 */

import type { JobFlexi } from "./jobs";

export type ItemCandidato = {
  itemId: string;
  orcamentoId: string;
  orcamentoNumero: number;
  orcamentoTitulo: string;
  orcamentoStatus: string;
  orcamentoCriadoEm: string;
  osId: string | null;
  descricao: string;
  larguraM: number | null;
  alturaM: number | null;
  quantidade: number;
};

export type Candidato = {
  itemId: string;
  orcamentoId: string;
  orcamentoNumero: number;
  titulo: string;
  descricao: string;
  status: string;
  larguraCm: number | null;
  alturaCm: number | null;
  quantidade: number;
  confianca: number;
  motivos: string[];
};

export type Sugestao = {
  origem: "numero_no_nome" | "medida";
  /** `sugerido` tem um candidato principal; `revisar` pede que a pessoa escolha. */
  estado: "sugerido" | "revisar";
  principal: Candidato | null;
  candidatos: Candidato[];
};

export type JobParaVincular = Pick<
  JobFlexi,
  "nome" | "larguraCm" | "alturaCm" | "copias" | "impressoEm"
>;

export const JANELA_EM_DIAS = 7;
export const MAXIMO_DE_CANDIDATOS = 5;

const DIA_MS = 24 * 60 * 60 * 1000;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** `O115` → orçamento 115; `OS108` → OS 108. Ver o cabeçalho sobre o espaço. */
export function numeroNoNome(nome: string): { orcamento: number | null; os: number | null } {
  const orc = nome.match(/(?<![a-z0-9])o[-#]?(\d{1,5})(?!\d|\s*[x×])/i);
  const os = nome.match(/(?<![a-z0-9])os[\s\-#]?(\d{1,5})(?!\d|\s*[x×])/i);
  return { orcamento: orc ? Number(orc[1]) : null, os: os ? Number(os[1]) : null };
}

/** Folga da medida: 3 cm ou 2% do lado, o que for maior. */
export function tolerancia(cm: number): number {
  return Math.max(3, cm * 0.02);
}

const bate = (a: number, b: number) => Math.abs(a - b) <= tolerancia(Math.max(a, b));

/** A medida do job confere com a do item, na posição normal ou girada. */
export function medidaConfere(
  job: JobParaVincular,
  item: Pick<ItemCandidato, "larguraM" | "alturaM">,
): boolean {
  if (!item.larguraM || !item.alturaM) return false;
  const l = item.larguraM * 100;
  const a = item.alturaM * 100;
  return (
    (bate(job.larguraCm, l) && bate(job.alturaCm, a)) ||
    (bate(job.larguraCm, a) && bate(job.alturaCm, l))
  );
}

/** O job é o pai de um aninhamento ("Otimizar Distribuição")? */
export function ehPaiDeAninhamento(nome: string): boolean {
  return semAcento(nome).trim().startsWith("otimizar");
}

function copiasConferem(copias: number, quantidade: number): "igual" | "perto" | "nao" {
  if (copias === quantidade) return "igual";
  // Sobra de poucas cópias é normal (54 impressas para 50 pedidas).
  if (copias > quantidade && copias <= quantidade + Math.max(2, Math.ceil(quantidade * 0.1)))
    return "perto";
  return "nao";
}

const arred2 = (n: number) => Math.round(n * 100) / 100;

function paraCandidato(item: ItemCandidato, confianca: number, motivos: string[]): Candidato {
  return {
    itemId: item.itemId,
    orcamentoId: item.orcamentoId,
    orcamentoNumero: item.orcamentoNumero,
    titulo: item.orcamentoTitulo,
    descricao: item.descricao,
    status: item.orcamentoStatus,
    larguraCm: item.larguraM ? Math.round(item.larguraM * 1000) / 10 : null,
    alturaCm: item.alturaM ? Math.round(item.alturaM * 1000) / 10 : null,
    quantidade: item.quantidade,
    confianca: Math.min(1, Math.max(0, arred2(confianca))),
    motivos,
  };
}

function diasEntre(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DIA_MS;
}

const AJUSTE_DO_STATUS: Record<string, number> = {
  aprovado: 0.1,
  convertido: 0.1,
  enviado: 0,
  rascunho: -0.05,
  rejeitado: -0.25,
  expirado: -0.25,
};

export function sugerirParaJob(job: JobParaVincular, itens: ItemCandidato[]): Sugestao | null {
  if (ehPaiDeAninhamento(job.nome)) return null;

  const { orcamento } = numeroNoNome(job.nome);
  if (orcamento !== null) {
    const doOrcamento = itens.filter((i) => i.orcamentoNumero === orcamento);
    if (doOrcamento.length > 0) {
      const confere = doOrcamento.filter((i) => medidaConfere(job, i));
      if (confere.length === 1) {
        const c = paraCandidato(confere[0], 0.95, [
          `número ${orcamento} no nome`,
          "medida confere",
        ]);
        return { origem: "numero_no_nome", estado: "sugerido", principal: c, candidatos: [c] };
      }
      const lista = (confere.length > 0 ? confere : doOrcamento)
        .slice(0, MAXIMO_DE_CANDIDATOS)
        .map((i) =>
          paraCandidato(i, medidaConfere(job, i) ? 0.6 : 0.4, [
            `número ${orcamento} no nome`,
            medidaConfere(job, i) ? "medida confere" : "medida não confere",
          ]),
        );
      return { origem: "numero_no_nome", estado: "revisar", principal: null, candidatos: lista };
    }
    // O número não existe entre os candidatos: segue para a medida, sem confiar nele.
  }

  const candidatos: Candidato[] = [];
  for (const item of itens) {
    if (!medidaConfere(job, item)) continue;
    const dias = diasEntre(job.impressoEm, item.orcamentoCriadoEm);
    if (dias > JANELA_EM_DIAS) continue;

    const motivos = ["medida confere"];
    let confianca = 0.5;

    const copias = copiasConferem(job.copias, item.quantidade);
    if (copias === "igual") {
      confianca += 0.2;
      motivos.push("mesma quantidade");
    } else if (copias === "perto") {
      confianca += 0.1;
      motivos.push(`${job.copias - item.quantidade} cópia(s) a mais`);
    } else if (job.copias < item.quantidade && job.copias / item.quantidade >= 0.25) {
      // O pedido pode sair em mais de um job (1 + 2 = 3 banners no orçamento 56).
      confianca += 0.05;
      motivos.push(`parte da quantidade (${job.copias} de ${item.quantidade})`);
    } else if (job.copias < item.quantidade) {
      // 1 cópia de 50 antes do pedido é, quase sempre, prova de cor: não vira sugestão sozinha.
      confianca -= 0.05;
      motivos.push(`bem menos que o pedido (${job.copias} de ${item.quantidade}): pode ser prova`);
    } else {
      motivos.push(`quantidade diferente (${item.quantidade} no orçamento, ${job.copias} no job)`);
    }

    // A data pesa bastante: o mesmo tamanho de banner se repete de semana em semana.
    if (dias <= 2) {
      confianca += 0.2;
      motivos.push("data próxima");
    } else if (dias <= 4) {
      confianca += 0.1;
      motivos.push(`${Math.round(dias)} dias de diferença`);
    } else {
      motivos.push(`${Math.round(dias)} dias de diferença`);
    }

    const ajuste = AJUSTE_DO_STATUS[item.orcamentoStatus] ?? 0;
    confianca += ajuste;
    if (ajuste < 0) motivos.push(`orçamento ${item.orcamentoStatus}`);

    candidatos.push(paraCandidato(item, confianca, motivos));
  }

  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => b.confianca - a.confianca || a.orcamentoNumero - b.orcamentoNumero);
  const lista = candidatos.slice(0, MAXIMO_DE_CANDIDATOS);
  const [primeiro, segundo] = lista;

  // Só vira "sugerido" quem se destaca. Dois parecidos = a pessoa escolhe.
  if (primeiro.confianca >= 0.7 && (!segundo || primeiro.confianca - segundo.confianca >= 0.15)) {
    return { origem: "medida", estado: "sugerido", principal: primeiro, candidatos: lista };
  }
  if (primeiro.confianca >= 0.4) {
    return { origem: "medida", estado: "revisar", principal: null, candidatos: lista };
  }
  return null;
}
