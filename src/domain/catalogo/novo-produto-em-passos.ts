/**
 * Novo produto em passos, com telas de ícones (25/10/2026).
 *
 * O cadastro completo (abas Dados, Preço…) continua existindo para quem quer tudo à mão. Este
 * caminho serve a quem cadastra um produto comum: escolhe o tipo, a variação, o material do
 * estoque, onde é feito e quanto custa, e confere no fim. Cada passo é uma pergunta e a resposta
 * é um cartão. O que é decisão (o nome, o preço) fica editável até a revisão.
 *
 * Este módulo é a regra, sem tela: quais passos cada tipo tem, que material combina, que custo e
 * preço sugerir e como o resultado vira o produto.
 */

export type NumeroDoPasso = 1 | 2 | 3 | 4 | 5 | 6;

export const PASSOS_DO_PRODUTO: readonly { n: NumeroDoPasso; titulo: string; pergunta: string }[] =
  [
    { n: 1, titulo: "Tipo", pergunta: "O que você vai cadastrar?" },
    { n: 2, titulo: "Variação", pergunta: "Qual é o tipo?" },
    { n: 3, titulo: "Material", pergunta: "Qual material do estoque?" },
    { n: 4, titulo: "Máquina", pergunta: "Onde é feito e como é cobrado?" },
    { n: 5, titulo: "Preço", pergunta: "Quanto custa e quanto cobrar?" },
    { n: 6, titulo: "Revisão", pergunta: "Está tudo certo?" },
  ];

export type VarianteDeProduto = {
  chave: string;
  titulo: string;
  detalhe?: string;
  /** nome sugerido do produto */
  nome: string;
  familia: string;
  /** código no SKU: LON-440 */
  codigo: string;
  /** palavras que o material do estoque precisa ter no nome (todas) */
  palavrasDoMaterial: readonly string[];
  /** palavras do nome da máquina sugerida */
  palavrasDaMaquina?: readonly string[];
  areaMinimaM2?: number;
};

export type TipoDeBase = {
  chave: string;
  titulo: string;
  detalhe: string;
  /** nome do ícone (lucide) — a tela resolve */
  icone: string;
  categoria: string;
  tipo: "produto" | "servico";
  unidade: string;
  prefixoDoSku: string;
  /** o produto leva material do estoque */
  usaMaterial: boolean;
  variantes: readonly VarianteDeProduto[];
  palavrasDoMaterial?: readonly string[];
  palavrasDaMaquina?: readonly string[];
};

const IMPRESSORA = ["plotter", "impressão"] as const;

export const TIPOS_DE_BASE: readonly TipoDeBase[] = [
  {
    chave: "adesivo",
    titulo: "Adesivo",
    detalhe: "vinil impresso, recorte, perfurado",
    icone: "Sticker",
    categoria: "adesivos",
    tipo: "produto",
    unidade: "m2",
    prefixoDoSku: "ADE",
    usaMaterial: true,
    palavrasDaMaquina: IMPRESSORA,
    variantes: [
      {
        chave: "branco",
        titulo: "Vinil branco",
        detalhe: "impresso",
        nome: "Adesivo vinil branco impresso",
        familia: "Adesivos impressos",
        codigo: "VIN",
        palavrasDoMaterial: ["vinil", "branco"],
      },
      {
        chave: "transparente",
        titulo: "Transparente",
        nome: "Adesivo transparente",
        familia: "Adesivos impressos",
        codigo: "TRP",
        palavrasDoMaterial: ["transparente"],
      },
      {
        chave: "fosco",
        titulo: "Fosco",
        nome: "Adesivo fosco",
        familia: "Adesivos impressos",
        codigo: "FOS",
        palavrasDoMaterial: ["fosco"],
      },
      {
        chave: "blackout",
        titulo: "Blackout",
        nome: "Adesivo blackout",
        familia: "Adesivos impressos",
        codigo: "BLK",
        palavrasDoMaterial: ["blackout"],
      },
      {
        chave: "perfurado",
        titulo: "Perfurado",
        detalhe: "one way, para vidro",
        nome: "Adesivo perfurado (one way)",
        familia: "Adesivos perfurados",
        codigo: "PERF",
        palavrasDoMaterial: ["perfurado"],
      },
      {
        chave: "recortado",
        titulo: "Com recorte",
        detalhe: "impresso e recortado",
        nome: "Adesivo vinil recortado",
        familia: "Adesivos com recorte",
        codigo: "REC",
        palavrasDoMaterial: ["vinil", "branco"],
        palavrasDaMaquina: ["recorte"],
      },
      {
        chave: "jateado",
        titulo: "Jateado",
        nome: "Adesivo jateado",
        familia: "Adesivos especiais",
        codigo: "JAT",
        palavrasDoMaterial: ["jateado"],
      },
    ],
  },
  {
    chave: "lona",
    titulo: "Lona",
    detalhe: "fachada, backlight, faixa",
    icone: "Layers",
    categoria: "impressao_grande_formato",
    tipo: "produto",
    unidade: "m2",
    prefixoDoSku: "LON",
    usaMaterial: true,
    palavrasDaMaquina: IMPRESSORA,
    variantes: [
      {
        chave: "280",
        titulo: "Brilho 280 g",
        detalhe: "a mais comum",
        nome: "Lona 280g impressa",
        familia: "Lonas frontlight",
        codigo: "280",
        palavrasDoMaterial: ["lona", "280"],
      },
      {
        chave: "440",
        titulo: "Reforçada 440 g",
        detalhe: "fachada",
        nome: "Lona 440g reforçada impressa",
        familia: "Lonas frontlight",
        codigo: "440",
        palavrasDoMaterial: ["lona", "440"],
      },
      {
        chave: "fosca",
        titulo: "Fosca",
        nome: "Lona fosca",
        familia: "Lonas frontlight",
        codigo: "FOS",
        palavrasDoMaterial: ["lona", "fosca"],
      },
      {
        chave: "backlight",
        titulo: "Backlight",
        detalhe: "luminosos",
        nome: "Lona backlight",
        familia: "Lonas backlight",
        codigo: "BCK",
        palavrasDoMaterial: ["lona", "backlight"],
      },
    ],
  },
  {
    chave: "banner",
    titulo: "Banner",
    detalhe: "com bastão e corda",
    icone: "Flag",
    categoria: "comunicacao_visual",
    tipo: "produto",
    unidade: "m2",
    prefixoDoSku: "BAN",
    usaMaterial: true,
    palavrasDaMaquina: IMPRESSORA,
    variantes: [
      {
        chave: "bastao",
        titulo: "Bastão e corda",
        nome: "Banner com bastão e corda",
        familia: "Banners",
        codigo: "BAS",
        palavrasDoMaterial: ["lona"],
        areaMinimaM2: 1,
      },
    ],
  },
  {
    chave: "placa",
    titulo: "Placa",
    detalhe: "ACM, PS, PVC com adesivo",
    icone: "Square",
    categoria: "comunicacao_visual",
    tipo: "produto",
    unidade: "m2",
    prefixoDoSku: "PLA",
    usaMaterial: true,
    palavrasDaMaquina: IMPRESSORA,
    variantes: [
      {
        chave: "acm",
        titulo: "ACM 3 mm",
        nome: "Placa ACM 3mm com adesivo",
        familia: "Placas",
        codigo: "ACM3",
        palavrasDoMaterial: ["acm"],
      },
      {
        chave: "ps",
        titulo: "PS 2 mm",
        nome: "Placa PS 2mm com adesivo",
        familia: "Placas",
        codigo: "PS2",
        palavrasDoMaterial: ["chapa", "ps"],
      },
      {
        chave: "pvc",
        titulo: "PVC expandido 3 mm",
        nome: "Placa PVC expandido 3mm",
        familia: "Placas",
        codigo: "PVC3",
        palavrasDoMaterial: ["pvc"],
      },
    ],
  },
  {
    chave: "acrilico",
    titulo: "Acrílico",
    detalhe: "corte a laser",
    icone: "Gem",
    categoria: "comunicacao_visual",
    tipo: "produto",
    unidade: "m2",
    prefixoDoSku: "ACR",
    usaMaterial: true,
    palavrasDaMaquina: ["laser"],
    variantes: [
      {
        chave: "cristal",
        titulo: "Cristal",
        nome: "Acrílico cristal recortado",
        familia: "Acrílico",
        codigo: "CRI",
        palavrasDoMaterial: ["acrilico", "cristal"],
      },
      {
        chave: "branco",
        titulo: "Branco",
        nome: "Acrílico branco recortado",
        familia: "Acrílico",
        codigo: "BRA",
        palavrasDoMaterial: ["acrilico", "branco"],
      },
      {
        chave: "preto",
        titulo: "Preto",
        nome: "Acrílico preto recortado",
        familia: "Acrílico",
        codigo: "PRE",
        palavrasDoMaterial: ["acrilico", "preto"],
      },
      {
        chave: "espelhado",
        titulo: "Espelhado",
        nome: "Acrílico espelhado recortado",
        familia: "Acrílico",
        codigo: "ESP",
        palavrasDoMaterial: ["acrilico", "esp"],
      },
    ],
  },
  {
    chave: "brinde",
    titulo: "Brinde",
    detalhe: "copo, caneta, chaveiro",
    icone: "Gift",
    categoria: "brindes",
    tipo: "produto",
    unidade: "un",
    prefixoDoSku: "BRI",
    usaMaterial: false,
    variantes: [
      {
        chave: "personalizado",
        titulo: "Personalizado",
        nome: "Brinde personalizado",
        familia: "Brindes personalizados",
        codigo: "PER",
        palavrasDoMaterial: [],
      },
    ],
  },
  {
    chave: "servico",
    titulo: "Serviço",
    detalhe: "instalação, arte, deslocamento",
    icone: "Wrench",
    categoria: "servico",
    tipo: "servico",
    unidade: "hora",
    prefixoDoSku: "SRV",
    usaMaterial: false,
    variantes: [
      {
        chave: "instalacao",
        titulo: "Instalação",
        nome: "Instalação em campo",
        familia: "Instalação e deslocamento",
        codigo: "INS",
        palavrasDoMaterial: [],
      },
      {
        chave: "arte",
        titulo: "Criação / arte final",
        nome: "Criação/arte final",
        familia: "Criação e serviços",
        codigo: "ART",
        palavrasDoMaterial: [],
      },
      {
        chave: "avulso",
        titulo: "Outro serviço",
        nome: "Serviço avulso",
        familia: "Criação e serviços",
        codigo: "AVU",
        palavrasDoMaterial: [],
      },
    ],
  },
];

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type MaterialDoEstoque = {
  id: string;
  nome: string;
  unidade: string;
  fornecedor?: string | null;
  custo_medio?: number | string | null;
  custo_unitario?: number | string | null;
  estoque?: number | string | null;
};

/** Materiais do estoque que combinam com o tipo e a variação: todas as palavras no nome. */
export function materiaisDaVariante(
  materiais: readonly MaterialDoEstoque[],
  tipo: TipoDeBase,
  variante: VarianteDeProduto | null,
): MaterialDoEstoque[] {
  const palavras = [
    ...(tipo.palavrasDoMaterial ?? []),
    ...(variante?.palavrasDoMaterial ?? []),
  ].map(semAcento);
  if (palavras.length === 0) return [];
  return materiais.filter((m) => {
    const nome = semAcento(m.nome);
    return palavras.every((p) => nome.includes(p));
  });
}

/** Máquinas que combinam: pelo nome. A variação pode pedir uma máquina diferente do tipo (recorte). */
export function maquinasSugeridas<T extends { nome: string }>(
  maquinas: readonly T[],
  tipo: TipoDeBase,
  variante: VarianteDeProduto | null,
): T[] {
  const palavras = (variante?.palavrasDaMaquina ?? tipo.palavrasDaMaquina ?? []).map(semAcento);
  if (palavras.length === 0) return [];
  return maquinas.filter((m) => palavras.some((p) => semAcento(m.nome).includes(p)));
}

/** Custo por unidade de venda: o do material, 1 unidade de material por unidade vendida. */
export function custoDoMaterial(m: MaterialDoEstoque | null | undefined): number {
  if (!m) return 0;
  const c = Number(m.custo_medio ?? m.custo_unitario ?? 0);
  return Number.isFinite(c) && c > 0 ? Math.round(c * 100) / 100 : 0;
}

/** Preço de balcão que cumpre a margem mínima sobre o custo; 0 sem custo ou margem fora de 0–99. */
export function precoQueCumpreAMargem(custo: number, margemMinimaPct: number): number {
  if (!(custo > 0) || !(margemMinimaPct >= 0) || margemMinimaPct >= 100) return 0;
  return Math.ceil((custo / (1 - margemMinimaPct / 100)) * 100) / 100;
}

/** SKU no padrão 3 letras-código ("LON-440"), sem repetir um que já existe. */
export function skuSugerido(
  tipo: Pick<TipoDeBase, "prefixoDoSku">,
  variante: Pick<VarianteDeProduto, "codigo"> | null,
  existentes: readonly (string | null | undefined)[],
): string {
  const ja = new Set(existentes.map((s) => (s ?? "").toUpperCase()));
  const base = `${tipo.prefixoDoSku}-${variante?.codigo ?? "NOVO"}`.toUpperCase();
  if (!ja.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!ja.has(`${base}${i}`)) return `${base}${i}`;
  return base;
}

/** Os passos que este tipo percorre: sem material, o passo 3 não existe. */
export function passosDoTipo(tipo: TipoDeBase | null): NumeroDoPasso[] {
  if (!tipo) return [1];
  return tipo.usaMaterial ? [1, 2, 3, 4, 5, 6] : [1, 2, 4, 5, 6];
}

export type RespostasDoProduto = {
  tipo: TipoDeBase | null;
  variante: VarianteDeProduto | null;
  material: MaterialDoEstoque | null;
  maquinaId: string;
  unidade: string;
  areaMinima: string;
  custo: string;
  margemMinima: string;
  preco: string;
  nome: string;
  sku: string;
  familia: string;
  marca: string;
};

export const RESPOSTAS_VAZIAS: RespostasDoProduto = {
  tipo: null,
  variante: null,
  material: null,
  maquinaId: "",
  unidade: "m2",
  areaMinima: "",
  custo: "",
  margemMinima: "40",
  preco: "",
  nome: "",
  sku: "",
  familia: "",
  marca: "",
};

/** Por que o passo ainda não pode avançar (texto para a tela), ou nada quando pode. */
export function pendenciaDoPasso(passo: NumeroDoPasso, r: RespostasDoProduto): string | null {
  switch (passo) {
    case 1:
      return r.tipo ? null : "Escolha o tipo do produto.";
    case 2:
      return r.variante ? null : "Escolha a variação.";
    case 3:
      return null; // material é opcional: sem ele o produto nasce sem ficha, e o painel avisa
    case 4:
      return r.unidade ? null : "Escolha como o produto é cobrado.";
    case 5:
      return Number(r.margemMinima) >= 0 && Number(r.margemMinima) < 100
        ? null
        : "A margem mínima precisa estar entre 0 e 99.";
    case 6:
      if (!r.nome.trim()) return "Dê um nome ao produto.";
      if (!r.sku.trim()) return "Preencha o código (SKU).";
      return null;
  }
}

/** Os dados do produto, na forma da tabela `produtos`. */
export function produtoDasRespostas(r: RespostasDoProduto) {
  const num = (t: string) => Number(String(t).replace(",", "."));
  const area = num(r.areaMinima);
  const observacoes = [r.marca.trim() ? `Marca: ${r.marca.trim()}` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    sku: r.sku.trim().toUpperCase() || null,
    familia: r.familia.trim() || null,
    nome: r.nome.trim(),
    categoria: r.tipo?.categoria ?? "outros",
    tipo: r.tipo?.tipo ?? "produto",
    unidade: r.unidade,
    custo_medio: Number.isFinite(num(r.custo)) ? num(r.custo) : 0,
    preco_base: Number.isFinite(num(r.preco)) ? num(r.preco) : 0,
    margem_minima: Number.isFinite(num(r.margemMinima)) ? num(r.margemMinima) : 40,
    area_minima_cobrada: area > 0 ? area : null,
    maquina_padrao_id: r.maquinaId || null,
    material_principal_id: r.material?.id ?? null,
    observacoes_internas: observacoes || null,
    ativo: true,
  };
}
