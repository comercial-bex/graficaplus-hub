export const statusGeralOs = ["entrada", "design", "producao", "acabamento", "pronto", "entregue", "finalizado"] as const;
export type StatusGeralOs = (typeof statusGeralOs)[number];

export function proximosStatus(status: StatusGeralOs): StatusGeralOs[] {
  const index = statusGeralOs.indexOf(status);
  return index >= 0 && index < statusGeralOs.length - 1 ? [statusGeralOs[index + 1]] : [];
}
