/**
 * Histórico do cliente (01/11/2026): as notas que a equipe registrou e, no fim, quando o cadastro nasceu,
 * da mais nova para a mais velha, como a aba Histórico do Holdprint.
 */

export interface NotaDoCliente {
  id: string;
  texto: string;
  autor_id: string | null;
  created_at: string;
}

export interface LinhaDoHistorico {
  id: string;
  tipo: "nota" | "cadastro";
  texto: string;
  /** Quem registrou; `null` no cadastro, que o sistema narra sozinho. */
  autorId: string | null;
  quando: string;
}

const instante = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Notas da mais nova para a mais velha, e o cadastro por último (foi o primeiro que aconteceu). */
export function linhaDoTempoDoCliente(
  notas: readonly NotaDoCliente[],
  cadastradoEm: string | null | undefined,
): LinhaDoHistorico[] {
  const linhas: LinhaDoHistorico[] = [...notas]
    .sort((a, b) => instante(b.created_at) - instante(a.created_at))
    .map((n) => ({ id: n.id, tipo: "nota" as const, texto: n.texto, autorId: n.autor_id, quando: n.created_at }));
  if (cadastradoEm) {
    linhas.push({ id: "cadastro", tipo: "cadastro", texto: "Cliente cadastrado", autorId: null, quando: cadastradoEm });
  }
  return linhas;
}

/** "01/11/2026 14:30", na hora de Macapá, qualquer que seja o fuso de quem olha. */
export function quandoPorExtenso(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Belem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** O que dizer quando o banco recusa a nota: sem permissão tem mensagem própria. */
export function mensagemDaNota(erro: unknown): string {
  const codigo = (erro as { code?: string } | null)?.code;
  if (codigo === "42501") return "Só admin, gestor e vendedor registram nota no cliente.";
  const texto = (erro as { message?: string } | null)?.message;
  return texto ? `Não consegui registrar a nota: ${texto}` : "Não consegui registrar a nota.";
}
