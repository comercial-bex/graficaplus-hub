/**
 * Os modelos do mercado (01/11/2026): nomes de produto que uma gráfica vende, sem
 * preço, sem custo e sem máquina. Ficam fora de `produtos` para não aparecer no
 * orçamento a R$ 0,00. Quem for vender traz o modelo, e ele nasce inativo.
 */

export type ModeloDoMercado = { id: string; familia: string; nome: string; produto_id: string | null };

const UNIDADE_POR_AREA = ["Adesivos", "Banners", "Chapas", "Envelopamentos", "Estruturas e fachadas", "Faixas", "Impressão", "Lonas", "Serigrafia", "Sublimação", "Toldos"];

const CATEGORIA_POR_FAMILIA: Record<string, string> = {
  Adesivos: "adesivos",
  Banners: "impressao_grande_formato",
  Brindes: "brindes",
  Chapas: "comunicacao_visual",
  Envelopamentos: "adesivos",
  Especiais: "comunicacao_visual",
  "Estruturas e fachadas": "comunicacao_visual",
  Faixas: "impressao_grande_formato",
  Impressão: "impressao_grande_formato",
  "Letra caixa": "comunicacao_visual",
  Lonas: "impressao_grande_formato",
  Papéis: "brindes",
  Serigrafia: "comunicacao_visual",
  Serviços: "servico",
  Sublimação: "impressao_grande_formato",
  Têxtil: "brindes",
  Toldos: "comunicacao_visual",
  Totens: "comunicacao_visual",
};

/** O produto que nasce do modelo: inativo, porque ainda não tem preço, custo nem máquina. */
export function produtoDoModelo(m: Pick<ModeloDoMercado, "familia" | "nome">) {
  const servico = m.familia === "Serviços";
  return {
    nome: m.nome,
    familia: m.familia,
    categoria: CATEGORIA_POR_FAMILIA[m.familia] ?? "outros",
    tipo: servico ? "servico" : "produto",
    unidade: UNIDADE_POR_AREA.includes(m.familia) ? "m2" : "un",
    ativo: false,
    observacoes_internas: "Trazido dos modelos do mercado. Defina máquina, custo e preço antes de ativar.",
  };
}

const PALAVRAS_VAZIAS = new Set(["com", "sem", "para", "por", "dos", "das", "impressao", "digital", "direta", "personalizado", "personalizada", "impresso", "impressa"]);

function palavras(texto: string): Set<string> {
  return new Set(
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(back|front) light\b/g, "$1light")
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p)),
  );
}

/** O produto nosso mais parecido, para melhorar o que já existe em vez de duplicar. */
export function parecidoNoCatalogo(nome: string, produtos: readonly { nome: string }[]): string | null {
  const alvo = palavras(nome);
  let melhor: { nome: string; pontos: number } | null = null;
  for (const p of produtos) {
    const dele = palavras(p.nome);
    const iguais = [...alvo].filter((x) => dele.has(x)).length;
    const minimo = Math.min(alvo.size, dele.size) <= 1 ? 1 : 2;
    if (iguais >= minimo && (!melhor || iguais > melhor.pontos)) melhor = { nome: p.nome, pontos: iguais };
  }
  return melhor?.nome ?? null;
}

export function filtrarModelos<M extends Pick<ModeloDoMercado, "familia" | "nome">>(
  modelos: readonly M[],
  familia: string | null,
  busca: string,
): M[] {
  const termos = [...palavras(busca)];
  return modelos.filter((m) => {
    if (familia && m.familia !== familia) return false;
    if (termos.length === 0) return busca.trim().length < 3 || m.nome.toLowerCase().includes(busca.trim().toLowerCase());
    const dele = [...palavras(m.nome)];
    return termos.every((t) => dele.some((d) => d.startsWith(t)));
  });
}
