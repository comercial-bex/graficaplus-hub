import { primeiroNome, rotuloDaPessoa } from "./equipe";
import { ehSetor, rotuloDoSetor, type Setor } from "./filas";

/**
 * A assinatura de quem responde, no topo da mensagem que o cliente recebe.
 *
 * Decisão do dono (13/10/2026), depois de responder a Cibele pela caixa:
 * "qualquer colaborador que responde pelo seu perfil deve aparecer para o
 * cliente como topo da mensagem". O número é um só para a gráfica inteira;
 * sem isso o cliente não sabe se falou com o comercial, o financeiro ou a
 * produção. É o que Chatwoot, Umbler Talk e Blip fazem em número compartilhado.
 *
 * O rótulo é o mesmo da caixa ("Harison · Direção", "Cibele · Financeiro"), em
 * negrito do WhatsApp. Só para mensagem escrita por uma pessoa: o aviso
 * automático e a assistente de IA não levam nome de ninguém.
 *
 * O SETOR DA CONVERSA (14/10/2026, pedido do dono: "o financeiro transferiu…
 * vai cair lá na produção, e assim vai"): quando quem responde é daquele
 * setor, a assinatura diz o setor da fila em que a conversa está — o Leonardo
 * (vendedor e operador) assina "Comercial" no comercial e "Produção" depois
 * que a conversa passa para a produção, em vez de "Comercial/Produção" nas
 * duas. Quem não é do setor da fila (a direção respondendo no comercial)
 * continua com o rótulo do papel. A fila é a de QUANDO a pessoa escreveu: o
 * aviso de transferência leva a fila de origem no payload.
 */
export const PAPEIS_DA_FILA: Record<Setor, readonly string[]> = {
  comercial: ["vendedor"],
  producao: ["operador", "designer", "estoque", "instalador"],
  financeiro: ["financeiro"],
  administrativo: ["admin", "gestor"],
};

export function assinaturaDaPessoa(p: {
  nome: string | null | undefined;
  papeis: readonly string[] | null | undefined;
  fila?: string | null;
}): string | null {
  if (!p.nome?.trim()) return null;
  const papeis = p.papeis ? [...p.papeis] : [];
  if (ehSetor(p.fila) && papeis.some((papel) => PAPEIS_DA_FILA[p.fila as Setor].includes(papel))) {
    return `*${primeiroNome(p.nome)} · ${rotuloDoSetor(p.fila)}*`;
  }
  return `*${rotuloDaPessoa({ nome: p.nome, papeis })}*`;
}

/**
 * Põe a assinatura na primeira linha. Texto vazio (arquivo sem legenda) vira
 * só a assinatura: o cliente sabe quem mandou o arquivo. Mensagem que já
 * começa com ela (reenvio) não ganha outra.
 */
export function assinarMensagem(texto: string | null | undefined, assinatura: string | null): string | undefined {
  const corpo = (texto ?? "").trim();
  if (!assinatura) return corpo || undefined;
  if (corpo.startsWith(assinatura)) return corpo;
  return corpo ? `${assinatura}\n${corpo}` : assinatura;
}
