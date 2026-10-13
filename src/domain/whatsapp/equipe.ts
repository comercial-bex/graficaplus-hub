/**
 * Quem é cada pessoa da equipe na caixa do WhatsApp: primeiro nome e setor.
 *
 * Pedido do dono (13/10/2026): "quando assume, aparece o nome de quem assumiu,
 * Yvens, Cibele, Léo: o primeiro nome, barra a função, se é financeiro, se é
 * comercial". É o que os sistemas de atendimento com número compartilhado
 * fazem por dentro (quem está com cada conversa) e por fora (assinatura na
 * mensagem ao cliente). Aqui é o rótulo; a assinatura que o cliente vê sai
 * dele, em assinatura.ts (decisão do dono, 13/10/2026).
 *
 * O setor vem do PAPEL no sistema (user_roles), não da fila: a fila é por onde
 * a conversa entra; o papel é o que a pessoa é na gráfica. Quem acumula função
 * (o Leonardo é vendedor e operador) aparece com os dois, do mais amplo ao mais
 * específico: "Comercial/Produção".
 */

export const SETOR_DO_PAPEL: Record<string, string> = {
  admin: "Direção",
  gestor: "Gerência",
  financeiro: "Financeiro",
  vendedor: "Comercial",
  designer: "Arte",
  operador: "Produção",
  estoque: "Estoque",
  instalador: "Instalação",
};

const ORDEM = Object.keys(SETOR_DO_PAPEL);

export type PessoaRotulavel = { id: string; nome: string | null; papeis?: string[] | null };

/** "Gerência", "Comercial/Produção"; null sem papel conhecido. */
export function setorDaPessoa(papeis: readonly string[] | null | undefined): string | null {
  if (!papeis || papeis.length === 0) return null;
  const rotulos = ORDEM.filter((p) => papeis.includes(p)).map((p) => SETOR_DO_PAPEL[p]);
  return rotulos.length ? rotulos.slice(0, 2).join("/") : null;
}

export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? "").trim().split(/\s+/)[0] || "Equipe";
}

/** "Yvens · Gerência"; só o nome quando o papel não é conhecido. */
export function rotuloDaPessoa(p: Pick<PessoaRotulavel, "nome" | "papeis">): string {
  const setor = setorDaPessoa(p.papeis);
  const nome = primeiroNome(p.nome);
  return setor ? `${nome} · ${setor}` : nome;
}

export function mapaDeRotulos(equipe: readonly PessoaRotulavel[] | undefined): Map<string, string> {
  return new Map((equipe ?? []).map((p) => [p.id, rotuloDaPessoa(p)]));
}

/** id → "Gerência", só para quem tem papel conhecido. */
export function mapaDeSetores(equipe: readonly PessoaRotulavel[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of equipe ?? []) {
    const s = setorDaPessoa(p.papeis);
    if (s) m.set(p.id, s);
  }
  return m;
}
