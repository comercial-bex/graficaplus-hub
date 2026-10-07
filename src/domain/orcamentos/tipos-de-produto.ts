/**
 * O tipo de produto como o vendedor fala: lona, adesivo, placa, papel, brinde…
 *
 * O catálogo (`produtos.categoria`) tem oito categorias, e elas são a base.
 * Só que três delas misturam coisas que no balcão são produtos diferentes:
 * "Impressão grande formato" guarda a lona E a impressão A4 em papel;
 * "Brindes & gráfica rápida" guarda o copo térmico E o cartão de visita;
 * "Outros" guarda dois kits churrasco que são brinde. Por isso o tipo sai da
 * categoria e, nesses casos, é refinado pelo nome e pela unidade — cada regra
 * está aqui, e o teste confere produto por produto para onde cada um vai.
 *
 * Nada disto muda o que o banco grava: `orcamento_itens.tipo_produto` recebe
 * o rótulo do tipo (texto livre, como sempre foi) e `produto_id` continua
 * apontando para o produto. Sem coluna nova.
 */

export type ChaveDoTipo =
  | "lona"
  | "adesivo"
  | "placa"
  | "papel"
  | "brinde"
  | "acabamento"
  | "servico"
  | "impressao_3d"
  | "outros";

/** Nome do ícone do lucide-react, resolvido pela tela (import por nome). */
export type IconeDoTipo =
  | "Image"
  | "Sticker"
  | "PanelTop"
  | "Printer"
  | "Gift"
  | "Scissors"
  | "Wrench"
  | "Box"
  | "Shapes";

export type TamanhoComum = { nome: string; largura: number; altura: number };

export type TipoDeProduto = {
  chave: ChaveDoTipo;
  /** Como aparece no cartão. */
  rotulo: string;
  /**
   * O que vai gravado em `tipo_produto`: sai na coluna "Tipo Produto" do PDF,
   * que tem 46 pt de largura — "Papel e gráfica rápida" quebraria em quatro
   * linhas. Curto como o vendedor já escrevia ("Adesivo", "Lona", "Placa").
   */
  rotuloCurto: string;
  icone: IconeDoTipo;
  /** Uma linha, no cartão. */
  descricao: string;
  /** Unidade que um item digitado à mão deste tipo costuma ter. */
  unidadePadrao: string;
  /** Acabamentos que valem oferecer como chips (o campo continua livre). */
  acabamentos: string[];
  /** Medidas prontas quando o produto não tem tamanhos cadastrados. */
  tamanhosComuns: TamanhoComum[];
};

const TAMANHOS_LONA: TamanhoComum[] = [
  { nome: "0,80 × 1,20", largura: 0.8, altura: 1.2 },
  { nome: "1,00 × 1,00", largura: 1, altura: 1 },
  { nome: "2,00 × 1,00", largura: 2, altura: 1 },
  { nome: "3,00 × 2,00", largura: 3, altura: 2 },
];

const TAMANHOS_ADESIVO: TamanhoComum[] = [
  { nome: "0,30 × 0,30", largura: 0.3, altura: 0.3 },
  { nome: "0,50 × 0,50", largura: 0.5, altura: 0.5 },
  { nome: "1,00 × 1,00", largura: 1, altura: 1 },
  { nome: "2,00 × 1,00", largura: 2, altura: 1 },
];

const TAMANHOS_PLACA: TamanhoComum[] = [
  { nome: "0,50 × 0,30", largura: 0.5, altura: 0.3 },
  { nome: "1,00 × 0,50", largura: 1, altura: 0.5 },
  { nome: "2,00 × 1,00", largura: 2, altura: 1 },
];

const TAMANHOS_GENERICOS: TamanhoComum[] = [
  { nome: "1,00 × 1,00", largura: 1, altura: 1 },
  { nome: "2,00 × 1,00", largura: 2, altura: 1 },
  { nome: "3,00 × 2,00", largura: 3, altura: 2 },
];

/** Os tipos na ordem em que aparecem na tela: do que mais vende ao resto. */
export const TIPOS_DE_PRODUTO: readonly TipoDeProduto[] = [
  {
    chave: "lona",
    rotulo: "Lona e banner",
    rotuloCurto: "Lona",
    icone: "Image",
    descricao: "Lona, banner, faixa e fachada em lona. Vende por m².",
    unidadePadrao: "m2",
    acabamentos: ["bainha + ilhós", "bastão e corda", "refile", "ilhós a cada 50 cm"],
    tamanhosComuns: TAMANHOS_LONA,
  },
  {
    chave: "adesivo",
    rotulo: "Adesivo e recorte",
    rotuloCurto: "Adesivo",
    icone: "Sticker",
    descricao: "Vinil impresso, recortado, perfurado e jateado.",
    unidadePadrao: "m2",
    acabamentos: ["refile", "recorte no contorno", "laminação", "aplicação inclusa"],
    tamanhosComuns: TAMANHOS_ADESIVO,
  },
  {
    chave: "placa",
    rotulo: "Placa e acrílico",
    rotuloCurto: "Placa",
    icone: "PanelTop",
    descricao: "ACM, PS, PVC, acrílico, letra caixa e quadro.",
    unidadePadrao: "m2",
    acabamentos: ["furos para fixação", "fita dupla face", "cantos arredondados", "espaçadores"],
    tamanhosComuns: TAMANHOS_PLACA,
  },
  {
    chave: "papel",
    rotulo: "Papel e gráfica rápida",
    rotuloCurto: "Papel",
    icone: "Printer",
    descricao: "Impressão A4 e A3, cartão de visita e panfleto.",
    unidadePadrao: "un",
    acabamentos: ["frente e verso", "laminação fosca", "verniz UV", "corte reto"],
    tamanhosComuns: [],
  },
  {
    chave: "brinde",
    rotulo: "Brindes",
    rotuloCurto: "Brinde",
    icone: "Gift",
    descricao: "Copo, caneta, chaveiro, kit churrasco… personalizados.",
    unidadePadrao: "un",
    acabamentos: ["gravação a laser", "DTF", "silk 1 cor", "embalagem individual"],
    tamanhosComuns: [],
  },
  {
    chave: "acabamento",
    rotulo: "Acabamento",
    rotuloCurto: "Acabamento",
    icone: "Scissors",
    descricao: "Bainha, ilhós e laminação vendidos à parte.",
    unidadePadrao: "m",
    acabamentos: [],
    tamanhosComuns: [],
  },
  {
    chave: "servico",
    rotulo: "Instalação e serviços",
    rotuloCurto: "Serviço",
    icone: "Wrench",
    descricao: "Instalação em campo, deslocamento e criação de arte.",
    unidadePadrao: "h",
    acabamentos: [],
    tamanhosComuns: [],
  },
  {
    chave: "impressao_3d",
    rotulo: "Impressão 3D",
    rotuloCurto: "3D",
    icone: "Box",
    descricao: "Peça impressa em 3D. O preço sai do orçamento 3D.",
    unidadePadrao: "un",
    acabamentos: ["lixada", "pintada", "primer"],
    tamanhosComuns: [],
  },
  {
    chave: "outros",
    rotulo: "Outros",
    rotuloCurto: "Outros",
    icone: "Shapes",
    descricao: "O que não cabe nos tipos acima.",
    unidadePadrao: "un",
    acabamentos: [],
    tamanhosComuns: TAMANHOS_GENERICOS,
  },
];

const POR_CHAVE = new Map(TIPOS_DE_PRODUTO.map((t) => [t.chave, t]));

export function tipoPelaChave(chave: ChaveDoTipo | string | null | undefined): TipoDeProduto {
  return POR_CHAVE.get(chave as ChaveDoTipo) ?? POR_CHAVE.get("outros")!;
}

/**
 * O tipo cujo rótulo (curto ou do cartão) está em `tipo_produto` — para
 * reabrir um item. Texto digitado à mão que não bate com nenhum fica sem tipo.
 */
export function tipoPeloRotulo(rotulo: string | null | undefined): TipoDeProduto | null {
  const alvo = normalizar(rotulo ?? "");
  if (!alvo) return null;
  return (
    TIPOS_DE_PRODUTO.find((t) => normalizar(t.rotuloCurto) === alvo || normalizar(t.rotulo) === alvo) ??
    null
  );
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** O mínimo que a regra precisa saber de um produto do catálogo. */
export type ProdutoClassificavel = {
  nome: string;
  categoria: string;
  unidade: string;
  sku?: string | null;
};

/** Unidade de área nas grafias do cadastro ("m2", "m²"). */
function ehArea(unidade: string): boolean {
  const u = normalizar(unidade).replace("²", "2");
  return u === "m2";
}

/**
 * Em qual tipo o produto entra. A categoria decide; nos três casos em que ela
 * mistura, o nome e a unidade desempatam. Toda regra aqui tem linha no teste.
 */
export function chaveDoTipo(p: ProdutoClassificavel): ChaveDoTipo {
  const nome = normalizar(p.nome);
  const sku = normalizar(p.sku ?? "");

  // Peça 3D vive no orçamento 3D; aqui só entra como serviço de referência.
  if (sku === "srv-3d" || /impressao 3d/.test(nome)) return "impressao_3d";

  switch (p.categoria) {
    case "adesivos":
      return "adesivo";
    case "acabamento":
      return "acabamento";
    case "instalacao":
    case "servico":
      return "servico";
    case "impressao_grande_formato":
      // A categoria guarda a lona (m²) e a impressão A4/A3 em papel (un).
      return ehArea(p.unidade) || /lona|banner|faixa/.test(nome) ? "lona" : "papel";
    case "comunicacao_visual":
      // Banner e fachada são lona; o resto é chapa rígida.
      return /lona|banner|faixa|fachada/.test(nome) ? "lona" : "placa";
    case "brindes":
      // Cartão e panfleto (milheiro) são gráfica rápida, não brinde.
      return normalizar(p.unidade) === "mil" || /cartao|panfleto|flyer|folder/.test(nome)
        ? "papel"
        : "brinde";
    case "outros":
      return /kit|churrasco|copo|caneta|chaveiro|brinde|personaliz/.test(nome) ? "brinde" : "outros";
    default:
      return "outros";
  }
}

export function tipoDoProduto(p: ProdutoClassificavel): TipoDeProduto {
  return tipoPelaChave(chaveDoTipo(p));
}

/** Os tipos com os produtos de cada um, na ordem da tela; tipo vazio não entra. */
export function agruparPorTipo<P extends ProdutoClassificavel>(
  produtos: readonly P[],
): { tipo: TipoDeProduto; produtos: P[] }[] {
  const grupos = new Map<ChaveDoTipo, P[]>();
  for (const p of produtos) {
    const chave = chaveDoTipo(p);
    const lista = grupos.get(chave) ?? [];
    lista.push(p);
    grupos.set(chave, lista);
  }
  return TIPOS_DE_PRODUTO.filter((t) => grupos.has(t.chave)).map((t) => ({
    tipo: t,
    produtos: grupos.get(t.chave)!,
  }));
}

/**
 * O que o formulário pergunta para uma unidade de venda.
 *
 * Produto em m² pede largura × altura; os outros pedem só a quantidade, com o
 * rótulo certo — "milheiros" para o cartão de visita, "metros" para a bainha,
 * "horas" para a instalação. A pergunta errada ("Qtd: 1000" para um milheiro)
 * é como nascia item de cartão com mil milheiros.
 */
export type CamposDoItem = {
  /** Pede largura × altura e mostra a peça desenhada. */
  medidas: boolean;
  /** Rótulo do campo de quantidade. */
  rotuloQuantidade: string;
  /** Como a unidade se escreve na tela. */
  unidadeLegivel: string;
  /** O que a quantidade conta, para o resumo: "peças", "milheiros"… */
  nomeDaQuantidade: { singular: string; plural: string };
  /** Passo do contador: inteiro para peças, decimal para metro e hora. */
  passo: number;
};

export function camposDaUnidade(unidade: string | null | undefined): CamposDoItem {
  const u = normalizar(unidade ?? "un").replace("²", "2");
  if (u === "m2" || u === "metro2" || u === "metroquadrado") {
    return {
      medidas: true,
      rotuloQuantidade: "Quantidade de peças",
      unidadeLegivel: "m²",
      nomeDaQuantidade: { singular: "peça", plural: "peças" },
      passo: 1,
    };
  }
  if (u === "mil" || u === "milheiro") {
    return {
      medidas: false,
      rotuloQuantidade: "Milheiros (1.000 folhas cada)",
      unidadeLegivel: "mil",
      nomeDaQuantidade: { singular: "milheiro", plural: "milheiros" },
      passo: 1,
    };
  }
  if (u === "m" || u === "metro") {
    return {
      medidas: false,
      rotuloQuantidade: "Metros lineares",
      unidadeLegivel: "m",
      nomeDaQuantidade: { singular: "metro", plural: "metros" },
      passo: 0.5,
    };
  }
  if (u === "h" || u === "hora" || u === "horas") {
    return {
      medidas: false,
      rotuloQuantidade: "Horas",
      unidadeLegivel: "h",
      nomeDaQuantidade: { singular: "hora", plural: "horas" },
      passo: 0.5,
    };
  }
  if (u === "km") {
    return {
      medidas: false,
      rotuloQuantidade: "Quilômetros",
      unidadeLegivel: "km",
      nomeDaQuantidade: { singular: "km", plural: "km" },
      passo: 1,
    };
  }
  if (u === "kg") {
    return {
      medidas: false,
      rotuloQuantidade: "Quilos",
      unidadeLegivel: "kg",
      nomeDaQuantidade: { singular: "kg", plural: "kg" },
      passo: 0.1,
    };
  }
  if (u === "lote") {
    return {
      medidas: false,
      rotuloQuantidade: "Lotes",
      unidadeLegivel: "lote",
      nomeDaQuantidade: { singular: "lote", plural: "lotes" },
      passo: 1,
    };
  }
  return {
    medidas: false,
    rotuloQuantidade: "Quantidade",
    unidadeLegivel: u === "peca" ? "pç" : u || "un",
    nomeDaQuantidade: { singular: u === "peca" ? "peça" : "unidade", plural: u === "peca" ? "peças" : "unidades" },
    passo: 1,
  };
}

/**
 * A unidade de um item FORA do catálogo quando o vendedor escolhe o tipo.
 *
 * Item novo pega a unidade do tipo: lona e adesivo vendem por m², e é a
 * unidade m² que faz a tela pedir largura × altura. Sem isso o formulário
 * começa em "un" e a lona avulsa nunca mostrava a medida. Na edição de um
 * item livre, a unidade que ele já tinha fica — foi alguém que escolheu.
 * Vindo de um produto do catálogo, a unidade era do produto e não serve mais.
 */
export function unidadeAoEscolherTipo(
  tipo: Pick<TipoDeProduto, "unidadePadrao">,
  atual: { unidade: string; tinhaProduto: boolean; editando: boolean },
): string {
  if (atual.tinhaProduto || !atual.editando || !atual.unidade.trim()) return tipo.unidadePadrao;
  return atual.unidade;
}

/**
 * Lê o campo livre de acabamento como lista: "bainha + ilhós, refile" vira
 * dois termos. É o que deixa os chips marcarem o que já está escrito.
 */
export function acabamentosDoTexto(texto: string | null | undefined): string[] {
  return (texto ?? "")
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Liga ou desliga um acabamento no texto, preservando o que foi digitado. */
export function alternarAcabamento(texto: string | null | undefined, termo: string): string {
  const atuais = acabamentosDoTexto(texto);
  const alvo = normalizar(termo);
  const semEle = atuais.filter((a) => normalizar(a) !== alvo);
  const estava = semEle.length !== atuais.length;
  return (estava ? semEle : [...atuais, termo]).join(", ");
}

export function temAcabamento(texto: string | null | undefined, termo: string): boolean {
  const alvo = normalizar(termo);
  return acabamentosDoTexto(texto).some((a) => normalizar(a) === alvo);
}
