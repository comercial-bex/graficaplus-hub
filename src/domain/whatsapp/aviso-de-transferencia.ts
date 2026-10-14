import { primeiroNome } from "./equipe";
import type { Setor } from "./filas";

/**
 * A frase ao cliente quando a conversa muda de setor ou de pessoa (pedido do
 * dono em 14/10/2026: "o financeiro transferiu… vai cair lá na produção").
 *
 * É o que os sistemas de atendimento em número compartilhado fazem na
 * transferência (Digisac, Octadesk, os forks do Whaticket com "mensagem de
 * transferência"): o cliente não fica falando sozinho enquanto a conversa
 * troca de mão. Vai como mensagem de quem transferiu — o despachante põe a
 * assinatura dela no topo — e quem transfere pode editar ou desligar.
 */

const SETOR_NA_FRASE: Record<Setor, string> = {
  comercial: "o setor Comercial",
  producao: "o setor de Produção",
  financeiro: "o setor Financeiro",
  administrativo: "o setor Administrativo",
};

export function avisoParaFila(setor: Setor): string {
  return `Vou passar seu atendimento para ${SETOR_NA_FRASE[setor]}. Em instantes alguém de lá continua com você por aqui.`;
}

/** "Vou passar seu atendimento para o Yvens (Gerência)…" — sem setor, só o nome. */
export function avisoParaPessoa(nome: string | null | undefined, setor: string | null | undefined): string {
  const quem = primeiroNome(nome);
  const de = setor ? ` (${setor})` : "";
  return `Vou passar seu atendimento para ${quem}${de}, que continua com você por aqui.`;
}
