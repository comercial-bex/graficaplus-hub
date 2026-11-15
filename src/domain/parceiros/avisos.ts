import { celularValido } from "./chamado-do-parceiro";
export type PublicoAviso = "ativos" | "sem_compra" | "com_credito" | "terceirizados";
export type DestinatarioAviso = {
  id: string;
  nome: string;
  telefone: string | null;
  credito: number;
  comprou: boolean;
  ultimo_aviso: string | null;
  status?: string;
  usuario_id?: string | null;
  nao_receber_avisos_em?: string | null;
};
export const RODAPE_AVISO = "Para não receber estes avisos, responda SAIR.";
export function quantidadePermitida(ids: string[]): boolean {
  return ids.length > 0 && ids.length <= 50;
}
export function motivoDoIntervalo(ultimo: string | null, agora = new Date()): string | null {
  if (!ultimo) return null;
  const tempo = new Date(ultimo).getTime();
  if (!Number.isFinite(tempo)) return "Data do último aviso inválida.";
  return tempo > agora.getTime() - 7 * 86400000 ? "Já recebeu aviso há menos de 7 dias." : null;
}
export function pertenceAoPublico(p: DestinatarioAviso, publico: PublicoAviso): boolean {
  if (p.status !== "ativo" || p.nao_receber_avisos_em || !celularValido(p.telefone)) return false;
  return (
    publico === "ativos" ||
    (publico === "sem_compra" && !p.comprou) ||
    (publico === "com_credito" && p.credito > 0) ||
    (publico === "terceirizados" && !p.usuario_id && p.comprou)
  );
}
export function montarTextoAviso(texto: string, p: DestinatarioAviso): string {
  const valores: Record<string, string> = {
    nome: p.nome.trim().split(/\s+/)[0] || "Parceiro",
    credito: "R$ " + Number(p.credito).toFixed(2).replace(".", ","),
    link: "https://bexprint.com.br/login?como=parceiro",
  };
  return (
    texto.trim().replace(/\{\{(nome|credito|link)\}\}/g, (_, chave: string) => valores[chave]) +
    "\n\n" +
    RODAPE_AVISO
  );
}
