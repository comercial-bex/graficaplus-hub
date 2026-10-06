/**
 * Material parecido com um que já existe — para não cadastrar o mesmo duas vezes.
 *
 * Duplicidade de material não é só feio: o estoque se divide em dois saldos, a
 * ficha técnica de um produto aponta para um e a compra entra no outro, e o
 * custo médio de cada metade mente. Em 05/10/2026 o cadastro já tinha o mesmo
 * "metro quadrado" escrito de dois jeitos ("m2" em 9 materiais, "m²" em 3) — é
 * esse tipo de diferença que a conferência tem de enxergar através.
 *
 * Duas camadas:
 *   1. TEXTO (aqui, de graça, enquanto a pessoa digita): nome sem acento, sem
 *      caixa e sem pontuação, "440 g" igual a "440g", trigramas + palavras em
 *      comum. Pega "LONA 440G REFORCADA" × "Lona 440g reforçada" e "Adesivo
 *      vinil branco" × "Vinil adesivo branco brilho".
 *   2. IA (no servidor, só no botão "Conferir com IA" — gasta saldo do Lovable,
 *      decisão do dono): pega o que o texto não vê, como sinônimos ("PS" ×
 *      "poliestireno"). A IA recebe só nome, unidade, características e
 *      fornecedor — nunca custo.
 *
 * Medida diferente NÃO é duplicado: "Lona 280g" e "Lona 440g" são materiais
 * distintos. Quando os dois nomes têm números e os números não batem, o par
 * aparece como "mesmo material, outra medida", nunca como "já existe".
 *
 * Domínio puro: sem banco e sem rede.
 */

export type MaterialComparavel = {
  id: string;
  nome: string;
  unidade: string | null;
  caracteristicas?: string | null;
  fornecedor?: string | null;
};

export type NovoMaterial = {
  nome: string;
  unidade?: string | null;
  caracteristicas?: string | null;
  fornecedor?: string | null;
};

/* ------------------------------------------------------------------------- */
/* Unidades                                                                   */
/* ------------------------------------------------------------------------- */

/** As unidades que o cadastro oferece, na grafia que o sistema grava. */
export const UNIDADES_DE_MATERIAL = [
  { valor: "m²", rotulo: "m² (metro quadrado)" },
  { valor: "m", rotulo: "m (metro linear)" },
  { valor: "un", rotulo: "un (unidade)" },
  { valor: "kg", rotulo: "kg (quilo)" },
  { valor: "g", rotulo: "g (grama)" },
  { valor: "L", rotulo: "L (litro)" },
  { valor: "ml", rotulo: "ml (mililitro)" },
  { valor: "folha", rotulo: "folha" },
] as const;

/** As que aparecem sempre no filtro, mesmo sem material (pedido do dono). */
export const UNIDADES_SEMPRE_NO_FILTRO = ["m²", "un", "kg"];

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Uma grafia só para cada unidade. "m2", "M²" e "metro quadrado" são o mesmo
 * m²; "und" e "unidade" são un. O que não se reconhece volta como veio
 * (aparado), para não sumir do filtro.
 */
export function normalizarUnidade(unidade: string | null | undefined): string {
  const cru = (unidade ?? "").trim();
  const u = semAcento(cru).toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
  if (!u) return "un";
  if (["m2", "m²", "metro2", "metroquadrado", "metrosquadrados", "mq"].includes(u)) return "m²";
  if (["un", "und", "unid", "unidade", "unidades", "pc", "pç", "peca", "pecas", "pca"].includes(u)) return "un";
  if (["kg", "kgs", "quilo", "quilos", "kilo", "kilos", "quilograma"].includes(u)) return "kg";
  if (["g", "gr", "grs", "grama", "gramas"].includes(u)) return "g";
  if (["l", "lt", "lts", "litro", "litros"].includes(u)) return "L";
  if (["ml", "mililitro", "mililitros"].includes(u)) return "ml";
  if (["m", "mt", "mts", "metro", "metros", "metrolinear"].includes(u)) return "m";
  if (["folha", "folhas", "fl", "fls"].includes(u)) return "folha";
  return cru;
}

/** Contagem por unidade (já normalizada), na ordem do mais usado. */
export function contarPorUnidade(lista: { unidade: string | null }[]): { unidade: string; total: number }[] {
  const mapa = new Map<string, number>();
  for (const u of UNIDADES_SEMPRE_NO_FILTRO) mapa.set(u, 0);
  for (const m of lista) {
    const u = normalizarUnidade(m.unidade);
    mapa.set(u, (mapa.get(u) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([unidade, total]) => ({ unidade, total }))
    .sort((a, b) => b.total - a.total || a.unidade.localeCompare(b.unidade, "pt-BR"));
}

/* ------------------------------------------------------------------------- */
/* Texto                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * O nome do jeito que se compara: sem acento, minúsculo, sem pontuação, com
 * vírgula decimal virando ponto e o número colado na unidade ("440 g" →
 * "440g", "2,5 mm" → "2.5mm").
 */
export function normalizarTexto(texto: string | null | undefined): string {
  return semAcento(texto ?? "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(\d)\s+(mm|cm|m|g|gr|kg|ml|l|mic|micras|um)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palavras que não distinguem material nenhum. */
const VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "com", "para", "p", "em", "a", "o"]);

/**
 * As palavras que se comparam. Número com unidade vira só o número ("280g" →
 * "280"): "lona brilho 280" tem de casar palavra por palavra com "Lona 280g
 * brilho".
 */
function palavras(texto: string): string[] {
  return normalizarTexto(texto)
    .split(" ")
    .filter((p) => p.length > 0 && !VAZIAS.has(p))
    .map((p) => (/^\d+(?:\.\d+)?[a-z]+$/.test(p) ? String(Number(p.match(/^\d+(?:\.\d+)?/)![0])) : p));
}

function trigramas(texto: string): Set<string> {
  const t = ` ${normalizarTexto(texto)} `;
  const conjunto = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) conjunto.add(t.slice(i, i + 3));
  return conjunto;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comuns = 0;
  for (const x of a) if (b.has(x)) comuns += 1;
  return (2 * comuns) / (a.size + b.size);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let comuns = 0;
  for (const x of sa) if (sb.has(x)) comuns += 1;
  return comuns / (sa.size + sb.size - comuns);
}

/**
 * Os números de um nome: "lona 440g 3.2m" → {"440", "3.2"}. Só o número: quem
 * digita "lona 280" quer a "Lona 280g", e "280" × "280g" não é outra medida.
 */
function medidas(texto: string): Set<string> {
  return new Set(
    (normalizarTexto(texto).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))),
  );
}

/* ------------------------------------------------------------------------- */
/* Comparação                                                                 */
/* ------------------------------------------------------------------------- */

export type Motivo = "mesmo_nome" | "nome_parecido" | "outra_medida" | "parecido";
export type Nivel = "igual" | "provavel" | "parecido";

export type Parecido = {
  material: MaterialComparavel;
  /** 0 a 1 */
  nota: number;
  motivo: Motivo;
  nivel: Nivel;
};

export const ROTULO_DO_NIVEL: Record<Nivel, string> = {
  igual: "Já existe",
  provavel: "Muito parecido",
  parecido: "Parecido",
};

export const ROTULO_DO_MOTIVO: Record<Motivo, string> = {
  mesmo_nome: "mesmo nome",
  nome_parecido: "nome quase igual",
  outra_medida: "mesmo material, outra medida",
  parecido: "nomes parecidos",
};

/** Nota de 0 a 1 de que os dois são o mesmo material, e por quê. */
export function compararMateriais(
  novo: NovoMaterial,
  existente: MaterialComparavel,
): { nota: number; motivo: Motivo } {
  const a = normalizarTexto(novo.nome);
  const b = normalizarTexto(existente.nome);
  if (!a || !b) return { nota: 0, motivo: "parecido" };

  const mesmaUnidade =
    !novo.unidade || normalizarUnidade(novo.unidade) === normalizarUnidade(existente.unidade);

  if (a === b) return { nota: mesmaUnidade ? 1 : 0.9, motivo: "mesmo_nome" };

  let nota = 0.6 * dice(trigramas(a), trigramas(b)) + 0.4 * jaccard(palavras(a), palavras(b));

  // Mesmas palavras em outra ordem ("adesivo vinil" × "vinil adesivo") é o
  // caso clássico de duplicidade por digitação.
  const pa = palavras(a);
  const pb = new Set(palavras(b));
  const todasAsPalavras = pa.length > 0 && pa.every((p) => pb.has(p));
  if (todasAsPalavras) nota = Math.max(nota, 0.78);

  // Características ajudam a desempatar, nunca a criar parecença sozinhas.
  if (novo.caracteristicas && existente.caracteristicas) {
    nota += 0.1 * jaccard(palavras(novo.caracteristicas), palavras(existente.caracteristicas));
  }
  if (!mesmaUnidade) nota *= 0.85;
  nota = Math.min(1, nota);

  // Números diferentes (280g × 440g, 2mm × 3mm): outro material da mesma família.
  const ma = medidas(a);
  const mb = medidas(b);
  if (ma.size > 0 && mb.size > 0 && ![...ma].some((m) => mb.has(m))) {
    return { nota: Math.min(nota, 0.7), motivo: "outra_medida" };
  }
  return { nota, motivo: nota >= 0.8 || todasAsPalavras ? "nome_parecido" : "parecido" };
}

export function nivelDaNota(nota: number, motivo: Motivo): Nivel {
  if (motivo === "mesmo_nome") return "igual";
  if (motivo !== "outra_medida" && nota >= 0.75) return "provavel";
  return "parecido";
}

/** Os já cadastrados mais parecidos com o que está sendo digitado. */
export function materiaisParecidos(
  novo: NovoMaterial,
  lista: MaterialComparavel[],
  { limite = 5, minimo = 0.45 }: { limite?: number; minimo?: number } = {},
): Parecido[] {
  if (normalizarTexto(novo.nome).length < 3) return [];
  return lista
    .map((material) => {
      const { nota, motivo } = compararMateriais(novo, material);
      return { material, nota, motivo, nivel: nivelDaNota(nota, motivo) };
    })
    .filter((p) => p.nota >= minimo)
    .sort((x, y) => y.nota - x.nota)
    .slice(0, limite);
}

/* ------------------------------------------------------------------------- */
/* A conferência por IA (o pedido e a leitura da resposta)                    */
/* ------------------------------------------------------------------------- */

export type ConferenciaIa =
  | {
      estado: "ok";
      duplicados: { id: string; nome: string; motivo: string; certeza: "alta" | "media" }[];
      nome_sugerido: string | null;
    }
  | { estado: "sem_ia" }
  | { estado: "limite" }
  | { estado: "sem_saldo" }
  | { estado: "falhou"; detalhe: string };

export const MAX_CANDIDATOS_IA = 60;

/** O que vai para a IA: tudo se a lista for curta, senão os mais parecidos por texto. */
export function candidatosParaIa(
  novo: NovoMaterial,
  lista: MaterialComparavel[],
  maximo = MAX_CANDIDATOS_IA,
): MaterialComparavel[] {
  if (lista.length <= maximo) return lista;
  return materiaisParecidos(novo, lista, { limite: maximo, minimo: 0 }).map((p) => p.material);
}

/** A ferramenta que a IA é obrigada a chamar: resposta sempre estruturada. */
export const FERRAMENTA_DA_IA = {
  type: "function",
  function: {
    name: "registrar_conferencia",
    description: "Registra quais materiais já cadastrados são o MESMO material que o novo.",
    parameters: {
      type: "object",
      properties: {
        duplicados: {
          type: "array",
          description: "Só os que são o mesmo material (mesma matéria-prima, mesma medida). Vazio se nenhum.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "o id exato do material da lista" },
              motivo: { type: "string", description: "por que é o mesmo, em uma frase curta em português" },
              certeza: { type: "string", enum: ["alta", "media"] },
            },
            required: ["id", "motivo", "certeza"],
          },
        },
        nome_sugerido: {
          type: "string",
          description: "Nome padronizado para o novo material (ex.: 'Lona 440g brilho'), ou vazio se o nome já está bom.",
        },
      },
      required: ["duplicados", "nome_sugerido"],
    },
  },
} as const;

/** As mensagens do pedido. Sem custo, sem estoque: só o que identifica o material. */
export function montarPerguntaDaIa(novo: NovoMaterial, candidatos: MaterialComparavel[]) {
  const linha = (m: MaterialComparavel) =>
    JSON.stringify({
      id: m.id,
      nome: m.nome,
      unidade: normalizarUnidade(m.unidade),
      caracteristicas: m.caracteristicas || undefined,
      fornecedor: m.fornecedor || undefined,
    });
  return [
    {
      role: "system",
      content:
        "Você confere cadastro de materiais de uma gráfica (lona, vinil, acrílico, ACM, PS, PVC, tinta, filamento). " +
        "Diga quais materiais da lista são O MESMO material que o novo — mesma matéria-prima e mesma medida " +
        "(gramatura, espessura, cor). Sinônimos e abreviações contam (PS = poliestireno, ACM = alumínio composto). " +
        "Medida diferente NÃO é o mesmo material (Lona 280g ≠ Lona 440g). Use só ids da lista. " +
        "Responda chamando a função registrar_conferencia.",
    },
    {
      role: "user",
      content:
        `Material novo: ${JSON.stringify({
          nome: novo.nome,
          unidade: normalizarUnidade(novo.unidade),
          caracteristicas: novo.caracteristicas || undefined,
          fornecedor: novo.fornecedor || undefined,
        })}\n\nJá cadastrados (um por linha):\n` + candidatos.map(linha).join("\n"),
    },
  ];
}

/**
 * Lê os argumentos da função que a IA chamou, sem confiar neles: id que não
 * está entre os candidatos é descartado (a IA não inventa material), e
 * resposta torta vira "falhou", nunca "nenhum duplicado".
 */
export function interpretarArgumentosDaIa(
  argumentos: unknown,
  candidatos: MaterialComparavel[],
): ConferenciaIa {
  let cru: unknown = argumentos;
  if (typeof argumentos === "string") {
    try {
      cru = JSON.parse(argumentos);
    } catch {
      return { estado: "falhou", detalhe: "resposta da IA ilegível" };
    }
  }
  const objeto = (cru ?? null) as { duplicados?: unknown; nome_sugerido?: unknown } | null;
  if (!objeto || typeof objeto !== "object" || !Array.isArray(objeto.duplicados)) {
    return { estado: "falhou", detalhe: "resposta da IA fora do formato" };
  }
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const duplicados = (objeto.duplicados as unknown[])
    .map((d) => d as Record<string, unknown>)
    .filter((d) => typeof d?.id === "string" && porId.has(d.id as string))
    .map((d) => ({
      id: d.id as string,
      nome: porId.get(d.id as string)!.nome,
      motivo: typeof d.motivo === "string" && d.motivo.trim() ? d.motivo.trim().slice(0, 200) : "mesmo material",
      certeza: (d.certeza === "alta" ? "alta" : "media") as "alta" | "media",
    }));
  const sugerido = objeto.nome_sugerido;
  return {
    estado: "ok",
    duplicados,
    nome_sugerido: typeof sugerido === "string" && sugerido.trim() ? sugerido.trim().slice(0, 120) : null,
  };
}
