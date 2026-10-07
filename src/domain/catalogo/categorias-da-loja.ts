/**
 * As categorias da loja: a prateleira "de gente" por cima das seções da tabela
 * do fornecedor.
 *
 * O DONO (06/10/2026): "dividir os produtos por categorias: canetas, copos,
 * brindes…". A tabela da LUGA vem com 50 seções do jeito que a fábrica
 * organiza ("SÓ BASE DE PVC - COURO ECOLÓGICO", "CADERNETA TIPO MOLESKINE
 * 'GRANDE' PERSONALIZADO E CAPA FANTASIA"). O cliente no iPad não escolhe por
 * aí. Cada seção aponta para UMA categoria desta lista — gravada em
 * `fornecedor_secoes.categoria` (migração 20261006230000). Seção que ainda não
 * foi apontada (fornecedor novo, planilha nova) cai aqui numa categoria pelo
 * título, e no pior caso em "Outros" — nunca some da loja.
 *
 * A lista é fechada de propósito: é o CHECK da coluna e são os azulejos da
 * loja. Categoria nova entra aqui e na migração, junto.
 *
 * Domínio puro.
 */

export const CATEGORIAS = [
  { chave: "canetas", rotulo: "Canetas", descricao: "Plásticas, semimetal e metal" },
  {
    chave: "copos",
    rotulo: "Copos, canecas e garrafas",
    descricao: "Canecas, taças, squeezes e térmicos",
  },
  { chave: "chaveiros", rotulo: "Chaveiros", descricao: "Metal, resina, emborrachado e ímã" },
  { chave: "cadernos", rotulo: "Cadernos e cadernetas", descricao: "Tipo moleskine e de negócios" },
  {
    chave: "agendas",
    rotulo: "Agendas e planners",
    descricao: "Diárias, compactas, de bolso e escolares",
  },
  { chave: "calendarios", rotulo: "Calendários", descricao: "De mesa em PVC, folhinhas e refis" },
  {
    chave: "sacolas",
    rotulo: "Sacolas, pastas e ecobags",
    descricao: "Para carregar e para presentear",
  },
  {
    chave: "utilidades",
    rotulo: "Casa e utilidades",
    descricao: "Churrasco, trena, régua e espelho",
  },
  {
    chave: "sublimacao",
    rotulo: "Sublimação e insumos",
    descricao: "Chapas, tintas, filmes e máquinas",
  },
  { chave: "encadernacao", rotulo: "Encadernação", descricao: "Wire-o, miolos e couro sintético" },
  { chave: "outros", rotulo: "Outros", descricao: "O que não cabe nas outras prateleiras" },
] as const;

export type Categoria = (typeof CATEGORIAS)[number]["chave"];

export const CHAVES_DE_CATEGORIA: readonly Categoria[] = CATEGORIAS.map((c) => c.chave);

export const ROTULO_DA_CATEGORIA: Record<Categoria, string> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.chave, c.rotulo]),
) as Record<Categoria, string>;

export function ehCategoria(valor: unknown): valor is Categoria {
  return typeof valor === "string" && (CHAVES_DE_CATEGORIA as readonly string[]).includes(valor);
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * A categoria deduzida do TÍTULO da seção — a rede de segurança para seção que
 * ninguém apontou ainda. A ordem importa: "KIT CHURRASCO E CANTIL" é utilidade,
 * não copo; "AGENDA EM WIRE-O" é agenda, não encadernação; "ECOBAGS E
 * SUBLIMÁTICAS" é sacola, não insumo. O teste confere que as 50 seções da LUGA
 * caem aqui na MESMA categoria que a migração gravou.
 */
const REGRAS_PELO_TITULO: [RegExp, Categoria][] = [
  [/CHURRASCO|TRENA|REGUA|ESCOVA|ESPELHO/, "utilidades"],
  [/CANETA|LAPIS/, "canetas"],
  [/CANECA|COPO|SQUEEZE|GARRAFA|LITRINHO|TACA|LONG DRINK|CANTIL/, "copos"],
  [/CHAVEIRO/, "chaveiros"],
  // \b: "ENCADERNAÇÃO" também tem "CADERN" dentro, e é encadernação.
  [/\bCADERN/, "cadernos"],
  [/AGENDA|PLANNER/, "agendas"],
  [/CALENDARIO|FOLHINHA|REFIL|MANTA MAGN|PVC/, "calendarios"],
  [/SACOLA|PASTA|ECOBAG|MOCHILA|BOLSA|NECESSAIRE/, "sacolas"],
  [/SUBLIM|TINTA|FILME|FLEX|PROMOTOR|ADESIV|PAPEIS|MAQUINA/, "sublimacao"],
  [/WIRE-O|MIOLO|COURO|ENCADERNA/, "encadernacao"],
];

export function categoriaPeloTitulo(titulo: string | null | undefined): Categoria {
  const alvo = semAcento(titulo ?? "");
  for (const [regra, categoria] of REGRAS_PELO_TITULO) {
    if (regra.test(alvo)) return categoria;
  }
  return "outros";
}

/** A categoria gravada no banco, ou a deduzida do título, ou "Outros". */
export function categoriaDaSecao(
  secao: { categoria?: string | null; titulo?: string | null } | null | undefined,
): Categoria {
  if (!secao) return "outros";
  if (ehCategoria(secao.categoria)) return secao.categoria;
  return categoriaPeloTitulo(secao.titulo);
}

/**
 * "Combina com": o que costuma ir junto no mesmo pedido de brinde. Regra fixa,
 * sem IA — quem leva caneta leva caderno e agenda; quem leva caneca leva
 * chaveiro e sacola. A ordem é a ordem de sugestão.
 */
export const COMBINA_COM: Record<Categoria, Categoria[]> = {
  canetas: ["cadernos", "agendas", "chaveiros"],
  copos: ["chaveiros", "sacolas", "utilidades"],
  chaveiros: ["canetas", "copos", "sacolas"],
  cadernos: ["canetas", "agendas", "sacolas"],
  agendas: ["canetas", "cadernos", "calendarios"],
  calendarios: ["agendas", "canetas", "chaveiros"],
  sacolas: ["copos", "cadernos", "canetas"],
  utilidades: ["chaveiros", "copos", "canetas"],
  sublimacao: ["copos", "sacolas", "encadernacao"],
  encadernacao: ["cadernos", "agendas", "sublimacao"],
  outros: ["canetas", "chaveiros", "copos"],
};
