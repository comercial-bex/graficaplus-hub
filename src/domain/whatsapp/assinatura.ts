import { rotuloDaPessoa } from "./equipe";

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
 */
export function assinaturaDaPessoa(p: {
  nome: string | null | undefined;
  papeis: readonly string[] | null | undefined;
}): string | null {
  if (!p.nome?.trim()) return null;
  return `*${rotuloDaPessoa({ nome: p.nome, papeis: p.papeis ? [...p.papeis] : null })}*`;
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
