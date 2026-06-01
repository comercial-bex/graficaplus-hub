export const CATEGORIAS = [
  { value: "impressao_grande_formato", label: "Impressão grande formato" },
  { value: "adesivos", label: "Adesivos & recorte" },
  { value: "comunicacao_visual", label: "Comunicação visual" },
  { value: "brindes", label: "Brindes & gráfica rápida" },
  { value: "acabamento", label: "Acabamento" },
  { value: "instalacao", label: "Instalação" },
  { value: "servico", label: "Serviço" },
  { value: "outros", label: "Outros" },
] as const;

export const UNIDADES = ["un", "m2", "m", "hora", "peca", "kg", "lote"] as const;

export const TIPOS = [
  { value: "produto", label: "Produto" },
  { value: "servico", label: "Serviço" },
] as const;

export type Produto = {
  id: string;
  sku: string | null;
  nome: string;
  descricao: string | null;
  categoria: string;
  tipo: "produto" | "servico";
  unidade: string;
  preco_base: number | null;
  custo_medio: number;
  margem_minima: number;
  tempo_producao_min: number | null;
  imagem_url: string | null;
  observacoes_internas: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

export function categoriaLabel(v: string) {
  return CATEGORIAS.find((c) => c.value === v)?.label ?? v;
}

export function calcMargem(custo: number, preco: number) {
  if (!preco || preco <= 0) return null;
  return ((preco - custo) / preco) * 100;
}

export function calcMarkup(custo: number, preco: number) {
  if (!custo || custo <= 0) return null;
  return preco / custo;
}

export function margemStatus(
  margem: number | null,
  minima: number,
): "ok" | "alerta" | "ruim" | "vazio" {
  if (margem === null) return "vazio";
  if (margem >= minima) return "ok";
  if (margem >= minima - 10) return "alerta";
  return "ruim";
}

export function formatBRL(v: number | null | undefined) {
  if (v === null || v === undefined || isNaN(Number(v))) return "—";
  return `R$ ${Number(v).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

export function toCSV(rows: Produto[]) {
  const headers = [
    "sku",
    "nome",
    "categoria",
    "tipo",
    "unidade",
    "custo_medio",
    "preco_base",
    "margem_minima",
    "tempo_producao_min",
    "descricao",
    "ativo",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows
    .map((r) =>
      [
        r.sku,
        r.nome,
        r.categoria,
        r.tipo,
        r.unidade,
        r.custo_medio,
        r.preco_base,
        r.margem_minima,
        r.tempo_producao_min,
        r.descricao,
        r.ativo,
      ]
        .map(esc)
        .join(","),
    )
    .join("\n");
  return `${headers.join(",")}\n${body}`;
}
