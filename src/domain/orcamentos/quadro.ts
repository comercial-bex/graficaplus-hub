/**
 * Quadro de orçamentos (31/10/2026), Onda 5 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: o "Painel de Negociação" do
 * Holdprint, com o total em dinheiro e a quantidade de cada coluna.
 *
 * Cada orçamento cai em UMA coluna só. Virar OS é ter `os_id`, não o status: a
 * conversão comum deixa o orçamento "aprovado" (o portal e o painel do parceiro
 * contam por ele), então `os_id` manda.
 */

export type ColunaDoQuadro =
  | "rascunho"
  | "emitido"
  | "enviado"
  | "em_negociacao"
  | "aceite_verbal"
  | "aprovado"
  | "os"
  | "rejeitado"
  | "expirado";

export interface OrcamentoDoQuadro {
  id: string;
  numero?: number | string | null;
  titulo?: string | null;
  status: string;
  os_id?: string | null;
  valor_total?: number | string | null;
  cliente_nome?: string | null;
  contato_nome?: string | null;
  created_at?: string | null;
  /** Em que pé está a conversa enquanto o orçamento está "enviado" (ver `orcamentos.etapa_comercial`). */
  etapa_comercial?: string | null;
  enviado_em?: string | null;
  validade_dias?: number | null;
}

export interface DefinicaoDeColuna {
  id: ColunaDoQuadro;
  titulo: string;
  /** O que a coluna quer dizer, em uma frase. */
  dica: string;
  /** Em andamento (true) ou já encerrada (false): as encerradas ficam mais discretas. */
  aberta: boolean;
}

export const COLUNAS_DO_QUADRO: readonly DefinicaoDeColuna[] = [
  { id: "rascunho", titulo: "Rascunhos", dica: "Ainda em montagem, nada foi ao cliente.", aberta: true },
  {
    id: "emitido",
    titulo: "Emitidos",
    dica: "Pronto: tem cliente e valor. Só falta enviar.",
    aberta: true,
  },
  { id: "enviado", titulo: "Enviados", dica: "Com o cliente, esperando resposta.", aberta: true },
  {
    id: "em_negociacao",
    titulo: "Em negociação",
    dica: "O cliente respondeu e estão acertando preço, prazo ou arte.",
    aberta: true,
  },
  {
    id: "aceite_verbal",
    titulo: "Aceite verbal",
    dica: "O cliente disse sim. Falta a aprovação formal e o sinal.",
    aberta: true,
  },
  { id: "aprovado", titulo: "Aprovados", dica: "O cliente aprovou e falta converter em OS.", aberta: true },
  { id: "os", titulo: "Viraram OS", dica: "Já estão na produção.", aberta: false },
  { id: "rejeitado", titulo: "Rejeitados", dica: "O cliente recusou ou pediu ajuste.", aberta: false },
  { id: "expirado", titulo: "Expirados", dica: "Passou a validade sem resposta.", aberta: false },
];

export function colunaDoOrcamento(
  o: Pick<OrcamentoDoQuadro, "status" | "os_id" | "etapa_comercial"> &
    Partial<Pick<OrcamentoDoQuadro, "valor_total" | "cliente_nome" | "contato_nome">>,
): ColunaDoQuadro {
  if (o.os_id || o.status === "convertido") return "os";
  switch (o.status) {
    case "enviado":
      // A etapa só vale enquanto o orçamento está enviado; o banco a limpa quando o status sai daí.
      if (o.etapa_comercial === "em_negociacao") return "em_negociacao";
      if (o.etapa_comercial === "aceite_verbal") return "aceite_verbal";
      return "enviado";
    case "aprovado":
      return "aprovado";
    case "rejeitado":
      return "rejeitado";
    case "expirado":
      return "expirado";
    case "rascunho":
      // Emitido não é um status novo: é o rascunho que já tem o que precisa para ir ao cliente.
      return Number(o.valor_total ?? 0) > 0 && (o.cliente_nome || o.contato_nome) ? "emitido" : "rascunho";
    default:
      return "rascunho";
  }
}

export interface ColunaMontada extends DefinicaoDeColuna {
  itens: OrcamentoDoQuadro[];
  quantidade: number;
  /** Soma do valor da coluna; `null` quando a pessoa não vê preço (a soma seria chute). */
  total: number | null;
}

const valorDe = (o: OrcamentoDoQuadro) => {
  const v = Number(o.valor_total ?? 0);
  return Number.isFinite(v) ? v : 0;
};

export function montarQuadro(lista: OrcamentoDoQuadro[], opcoes: { mostrarValores: boolean }): ColunaMontada[] {
  const porColuna = new Map<ColunaDoQuadro, OrcamentoDoQuadro[]>(COLUNAS_DO_QUADRO.map((c) => [c.id, []]));
  for (const o of lista) porColuna.get(colunaDoOrcamento(o))!.push(o);
  return COLUNAS_DO_QUADRO.map((c) => {
    const itens = porColuna.get(c.id)!;
    return {
      ...c,
      itens,
      quantidade: itens.length,
      total: opcoes.mostrarValores ? itens.reduce((soma, o) => soma + valorDe(o), 0) : null,
    };
  });
}

/** As três etapas de um orçamento enviado, na ordem da conversa. */
export type EtapaDoEnviado = "enviado" | "em_negociacao" | "aceite_verbal";

export const ETAPAS_DO_ENVIADO: ReadonlyArray<{ id: EtapaDoEnviado; rotulo: string }> = [
  { id: "enviado", rotulo: "Enviado, sem resposta" },
  { id: "em_negociacao", rotulo: "Em negociação" },
  { id: "aceite_verbal", rotulo: "Aceite verbal" },
];

/** Colunas do quadro onde o orçamento ainda é um "enviado": é nelas que a etapa se muda. */
export const COLUNAS_DO_ENVIADO: readonly ColunaDoQuadro[] = ["enviado", "em_negociacao", "aceite_verbal"];

/** O que gravar em `etapa_comercial` para cada etapa: "enviado" é a ausência de etapa. */
export function etapaParaGravar(etapa: EtapaDoEnviado): "em_negociacao" | "aceite_verbal" | null {
  return etapa === "enviado" ? null : etapa;
}

export interface ValidadeDoOrcamento {
  /** Dias até vencer; negativo quando já venceu. */
  dias: number;
  vencido: boolean;
  /** Vence hoje ou nos próximos 3 dias, ou já venceu: pede atenção. */
  urgente: boolean;
}

/**
 * Quando o orçamento enviado perde a validade: a data do envio mais `validade_dias`. Sem data de
 * envio ou sem validade não há o que dizer (`null`), em vez de inventar um prazo.
 */
export function validadeDoOrcamento(
  o: Pick<OrcamentoDoQuadro, "enviado_em" | "validade_dias">,
  agora: Date,
): ValidadeDoOrcamento | null {
  if (!o.enviado_em || !Number.isFinite(Number(o.validade_dias)) || Number(o.validade_dias) <= 0) return null;
  const envio = new Date(o.enviado_em).getTime();
  if (!Number.isFinite(envio)) return null;
  const vence = envio + Number(o.validade_dias) * 86_400_000;
  const dias = Math.ceil((vence - agora.getTime()) / 86_400_000);
  return { dias, vencido: dias < 0, urgente: dias <= 3 };
}

export function rotuloDaValidade(v: ValidadeDoOrcamento | null): string | null {
  if (!v) return null;
  if (v.dias < 0) return v.dias === -1 ? "venceu ontem" : `venceu há ${Math.abs(v.dias)} dias`;
  if (v.dias === 0) return "vence hoje";
  return v.dias === 1 ? "vence amanhã" : `vence em ${v.dias} dias`;
}

/** Dias inteiros desde a criação; `null` se a data não existe ou não lê. */
export function idadeEmDias(criadoEm: string | null | undefined, agora: Date): number | null {
  if (!criadoEm) return null;
  const t = new Date(criadoEm).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

export function rotuloDaIdade(dias: number | null): string | null {
  if (dias === null) return null;
  if (dias === 0) return "criado hoje";
  return dias === 1 ? "criado há 1 dia" : `criado há ${dias} dias`;
}
