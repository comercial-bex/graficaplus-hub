/**
 * Produto sem foto (21/11/2026). O app não gera mais foto por IA (o dono cortou o gasto de crédito):
 * a tela só avisa quem está sem imagem e a foto entra por envio. A conta mora aqui, num lugar só,
 * para o aviso da lista, a marca de cada linha e os testes nunca discordarem.
 *
 * Entra na conta: produto ativo, que não é serviço (serviço usa o ícone da categoria) e sem endereço de
 * foto preenchido. Endereço só com espaços conta como vazio.
 */
export type ProdutoParaAvisoDeFoto = {
  id: string;
  nome: string;
  ativo?: boolean | null;
  tipo?: string | null;
  imagem_url?: string | null;
};

export function precisaDeFoto(p: Pick<ProdutoParaAvisoDeFoto, "ativo" | "tipo" | "imagem_url">): boolean {
  return p.ativo !== false && p.tipo !== "servico" && !(p.imagem_url ?? "").trim();
}

export function produtosSemFoto<P extends ProdutoParaAvisoDeFoto>(produtos: readonly P[]): P[] {
  return produtos.filter(precisaDeFoto);
}

/** "3 produtos ativos estão sem foto." / "Todos os produtos ativos têm foto." */
export function fraseDoAvisoDeFoto(semFoto: number, ativosComFoto: boolean = true): string {
  if (semFoto === 0) return ativosComFoto ? "Todos os produtos ativos têm foto." : "";
  return semFoto === 1 ? "1 produto ativo está sem foto." : `${semFoto} produtos ativos estão sem foto.`;
}
