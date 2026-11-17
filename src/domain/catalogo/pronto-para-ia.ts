/**
 * "Pronto para a IA": a nota de 0 a 10 da pasta do produto (fase 6 do plano de
 * 02/11/2026). Cada campo da pasta existe para a IA orçar sozinha depois, nas
 * palavras do dono; a nota diz, produto a produto, o que ainda falta para
 * isso. É contagem do que está preenchido, não opinião: nove checagens, cada
 * uma vale igual, e a que não cabe no produto sai da conta em vez de puxar a
 * nota para baixo. Serviço (acabamento, instalação, criação) não tem foto,
 * material principal, medida padrão nem pergunta de checklist: a medida vem do
 * item a que ele se aplica, e o que ele pergunta ao cliente é o próprio item.
 * Ajustado em 03/11/2026, quando a conta cobrava "perguntas do checklist" de 13
 * serviços que não têm o que perguntar.
 *
 * A fórmula de material NÃO entra na nota, de propósito (03/11/2026). Lona,
 * banner e adesivo já têm o ilhós pelo acabamento (2 por metro, a cada 50 cm,
 * cobrado por metro) e o bastão pela ficha; somar uma fórmula por cima contaria
 * o mesmo material duas vezes. A aba Fórmulas existe para o material que
 * depende de uma conta e não está em nenhum dos dois (letra caixa, moldura), e
 * cobrá-la em todo produto por área empurraria quem preenche para o erro.
 */

import { abasDaPasta, type AbaDaPasta } from "@/domain/catalogo/pasta-do-produto";

export type EntradaDaNota = {
  tipo: "produto" | "servico" | string | null;
  unidade: string | null;
  temFoto: boolean;
  temDescricao: boolean;
  temFamilia: boolean;
  temMedidaPadrao: boolean;
  temMaterialPrincipal: boolean;
  processos: number;
  /** Perguntas do Checklist (as que cobram). */
  perguntas: number;
  roteiroEscrito: boolean;
  roteiroRevisado: boolean;
};

export type ChaveDaChecagem =
  | "foto"
  | "descricao"
  | "familia"
  | "unidade"
  | "medida"
  | "material"
  | "processos"
  | "perguntas"
  | "roteiro";

/**
 * Onde cada checagem se resolve (17/11/2026): a aba da pasta, o id do campo ou cartão que recebe o
 * destaque vermelho e para onde a tela rola, e as frases que o dono lê. Mora aqui, num lugar só, para
 * a nota, a dica, o ponto vermelho da aba e o clique na lista de faltas nunca discordarem. O tipo
 * Record obriga toda chave nova a ganhar destino, e o teste confere que a aba e o campo existem.
 * Frases sem travessão, seta nem parênteses, que é como o dono lê.
 */
export type DestinoDaChecagem = {
  aba: AbaDaPasta;
  abaTitulo: string;
  /** O id do elemento da tela que recebe o destaque. */
  campo: string;
  /** "a foto": cabe em "Falta a foto". */
  falta: string;
  /** A linha vermelha ao lado do campo: o que fazer. */
  instrucao: string;
};

export const DESTINO_DA_CHECAGEM: Record<ChaveDaChecagem, DestinoDaChecagem> = {
  foto: {
    aba: "descricao",
    abaTitulo: "Descrição",
    campo: "pasta-foto",
    falta: "a foto",
    instrucao: "Falta a foto. Envie pelo menos uma foto do produto na galeria abaixo.",
  },
  descricao: {
    aba: "descricao",
    abaTitulo: "Descrição",
    campo: "pasta-descricao",
    falta: "a descrição",
    instrucao: "Falta a descrição. Escreva o que o cliente lê no orçamento.",
  },
  familia: {
    aba: "descricao",
    abaTitulo: "Descrição",
    campo: "pasta-familia",
    falta: "a família",
    instrucao: "Falta a família. Escolha ou escreva a família do produto.",
  },
  unidade: {
    aba: "descricao",
    abaTitulo: "Descrição",
    campo: "pasta-unidade",
    falta: "a unidade na proposta",
    instrucao: "Falta a unidade na proposta. Escolha como o produto é vendido.",
  },
  medida: {
    aba: "parametros",
    abaTitulo: "Parâmetros",
    campo: "pasta-largura",
    falta: "a medida padrão",
    instrucao: "Falta a medida padrão. Preencha a largura e a altura em metros.",
  },
  material: {
    aba: "parametros",
    abaTitulo: "Parâmetros",
    campo: "pasta-material",
    falta: "o material principal",
    instrucao: "Falta o material principal. Escolha o insumo que mais pesa no custo.",
  },
  processos: {
    aba: "processos",
    abaTitulo: "Processos",
    campo: "pasta-processos",
    falta: "os processos",
    instrucao: "Nenhum processo cadastrado. Adicione pelo menos um processo de produção.",
  },
  perguntas: {
    aba: "checklist",
    abaTitulo: "Checklist",
    campo: "pasta-perguntas",
    falta: "as perguntas do checklist",
    instrucao:
      "Nenhuma pergunta cobrada no checklist. Cadastre pelo menos uma pergunta que o cliente responde.",
  },
  roteiro: {
    aba: "ia",
    abaTitulo: "Orç.IA",
    campo: "pasta-como-medir",
    falta: "o roteiro da IA",
    instrucao: "Falta o roteiro da IA. Escreva como descobrir as medidas.",
  },
};

/** O roteiro já escrito só precisa de revisão: o destino é o bloco com o botão de marcar. */
export const DESTINO_DA_REVISAO: DestinoDaChecagem = {
  aba: "ia",
  abaTitulo: "Orç.IA",
  campo: "pasta-revisao-roteiro",
  falta: "a revisão do roteiro da IA",
  instrucao:
    "O roteiro ainda não foi revisado. Leia, corrija o que não vale na nossa loja e marque como revisado.",
};

/** Dito na aba Checklist e no rótulo do campo da aba Orç.IA. */
export const AVISO_DAS_PERGUNTAS_NA_NOTA =
  "A nota conta as perguntas cadastradas nesta aba, as que cobram do cliente. O texto de Perguntas obrigatórias da aba Orç.IA não entra na nota, e as perguntas de informação, da aba Campos, também não.";

export type Checagem = {
  chave: ChaveDaChecagem;
  rotulo: string;
  /** Onde se preenche. */
  destino: DestinoDaChecagem;
  /** Falso quando a checagem não cabe neste produto: ela sai da conta. */
  cabe: boolean;
  pronta: boolean;
};

export type NotaDaPasta = {
  /** 0 a 10, inteiro. */
  nota: number;
  prontas: number;
  cabem: number;
  faltas: string[];
  checagens: Checagem[];
};

const ehArea = (u: string | null) => (u ?? "").trim().toLowerCase().replace("²", "2") === "m2";

export function checagensDaPasta(e: EntradaDaNota): Checagem[] {
  const servico = e.tipo === "servico";
  const area = ehArea(e.unidade);
  const lista: Omit<Checagem, "destino">[] = [
    { chave: "foto", rotulo: "foto", cabe: !servico, pronta: e.temFoto },
    { chave: "descricao", rotulo: "descrição", cabe: true, pronta: e.temDescricao },
    { chave: "familia", rotulo: "família", cabe: true, pronta: e.temFamilia },
    { chave: "unidade", rotulo: "unidade na proposta", cabe: true, pronta: !!(e.unidade ?? "").trim() },
    { chave: "medida", rotulo: "medida padrão", cabe: area && !servico, pronta: e.temMedidaPadrao },
    { chave: "material", rotulo: "material principal", cabe: !servico, pronta: e.temMaterialPrincipal },
    { chave: "processos", rotulo: "processos", cabe: true, pronta: e.processos > 0 },
    { chave: "perguntas", rotulo: "perguntas do checklist", cabe: !servico, pronta: e.perguntas > 0 },
    {
      chave: "roteiro",
      rotulo: e.roteiroEscrito ? "revisão do roteiro da IA" : "roteiro da IA",
      cabe: true,
      pronta: e.roteiroEscrito && e.roteiroRevisado,
    },
  ];
  return lista.map((c) => ({
    ...c,
    destino: c.chave === "roteiro" && e.roteiroEscrito ? DESTINO_DA_REVISAO : DESTINO_DA_CHECAGEM[c.chave],
  }));
}

/** A nota: prontas ÷ as que cabem, em décimos. Sem checagem que caiba (não acontece), 0. */
export function notaDaPasta(e: EntradaDaNota): NotaDaPasta {
  const checagens = checagensDaPasta(e);
  const cabem = checagens.filter((c) => c.cabe);
  const prontas = cabem.filter((c) => c.pronta);
  const nota = cabem.length === 0 ? 0 : Math.round((prontas.length / cabem.length) * 10);
  return {
    nota,
    prontas: prontas.length,
    cabem: cabem.length,
    faltas: cabem.filter((c) => !c.pronta).map((c) => c.rotulo),
    checagens,
  };
}

/** "Pronto para a IA: 8 de 10. Falta: foto, revisão do roteiro da IA." */
export function fraseDaNota(n: NotaDaPasta): string {
  const cabeca = `Pronto para a IA: ${n.nota} de 10.`;
  if (n.faltas.length === 0) return `${cabeca} Nada falta.`;
  return `${cabeca} Falta: ${n.faltas.join(", ")}.`;
}

export type Pendencia = DestinoDaChecagem & { chave: ChaveDaChecagem };

/** O que falta, com a aba e o campo de cada item. Só as checagens que cabem no produto. */
export function pendenciasDaPasta(n: NotaDaPasta): Pendencia[] {
  return n.checagens.filter((c) => c.cabe && !c.pronta).map((c) => ({ chave: c.chave, ...c.destino }));
}

/** As pendências agrupadas pela aba onde se resolvem: base do ponto vermelho com a contagem. */
export function pendenciasPorAba(n: NotaDaPasta): Partial<Record<AbaDaPasta, Pendencia[]>> {
  const por: Partial<Record<AbaDaPasta, Pendencia[]>> = {};
  for (const p of pendenciasDaPasta(n)) (por[p.aba] ??= []).push(p);
  return por;
}

/**
 * Abrir a pasta já na aba da falta (17/11/2026). A aba e o campo viajam na URL (?aba=...&campo=...).
 * Só vale aba que existe e campo que o mapa de destinos conhece, e o campo só vale na aba dele:
 * qualquer outra coisa cai em Descrição, sem erro e sem campo.
 */
export type BuscaDaPasta = { aba?: AbaDaPasta; campo?: string };

const TODOS_OS_DESTINOS: DestinoDaChecagem[] = [...Object.values(DESTINO_DA_CHECAGEM), DESTINO_DA_REVISAO];

export function buscaDaPasta(busca: Record<string, unknown>): BuscaDaPasta {
  const abas = abasDaPasta({ canSeePrices: true }).map((a) => a.id);
  const aba = typeof busca.aba === "string" ? abas.find((a) => a === busca.aba) : undefined;
  if (!aba) return {};
  const campo = typeof busca.campo === "string" ? busca.campo : undefined;
  const campoValido = campo && TODOS_OS_DESTINOS.some((d) => d.aba === aba && d.campo === campo);
  return campoValido ? { aba, campo } : { aba };
}

/** A aba que a pasta mostra ao abrir: a pedida, se o usuário a vê, senão Descrição. */
export function abaInicialDaPasta(busca: BuscaDaPasta, abasVisiveis: AbaDaPasta[]): AbaDaPasta {
  return busca.aba && abasVisiveis.includes(busca.aba) ? busca.aba : "descricao";
}

/** O destino da primeira falta da nota, ou nulo quando nada falta (ou a nota não existe). */
export function buscaDaPrimeiraFalta(n: NotaDaPasta | null): { aba: AbaDaPasta; campo: string } | null {
  if (!n) return null;
  const primeira = pendenciasDaPasta(n)[0];
  return primeira ? { aba: primeira.aba, campo: primeira.campo } : null;
}

/**
 * O texto do tooltip da nota: a nota, quantos itens estão prontos e, item a item, o que falta e em que
 * aba corrigir. Sem a nota (a leitura das fichas falhou) diz isso, em vez de mostrar 0.
 */
export function dicaDaNota(n: NotaDaPasta | null): string {
  if (!n) {
    return "A nota não aparece porque não deu para ler as fichas agora. Isso não quer dizer que o produto está sem nada preenchido. Recarregue a página para tentar de novo.";
  }
  const cabeca = `Pronto para a IA: ${n.nota} de 10, com ${n.prontas} de ${n.cabem} itens prontos.`;
  const faltas = pendenciasDaPasta(n);
  if (faltas.length === 0) return `${cabeca} Nada falta.`;
  return `${cabeca} ${faltas.map((f) => `Falta ${f.falta}, na aba ${f.abaTitulo}.`).join(" ")}`;
}

/** Cor da barra: 8+ verde, 5 a 7 âmbar, abaixo vermelho. Só a cor; o número está sempre escrito. */
export function faixaDaNota(nota: number): "boa" | "media" | "baixa" {
  if (nota >= 8) return "boa";
  if (nota >= 5) return "media";
  return "baixa";
}

export type LinhasParaNota = {
  fichas: readonly { produto_id: string; largura_padrao_m: number | string | null; altura_padrao_m: number | string | null; ia_como_medir: string | null; ia_revisado_em: string | null }[];
  processos: readonly { produto_id: string }[];
  perguntas: readonly { produto_id: string; finalidade?: string | null }[];
};

/** Monta a entrada da nota de um produto a partir das linhas das tabelas satélites. */
export function entradaDaNota(
  p: {
    id: string;
    tipo: string | null;
    unidade: string | null;
    imagem_url?: string | null;
    descricao?: string | null;
    material_principal_id?: string | null;
  },
  familia: string | null | undefined,
  linhas: LinhasParaNota,
): EntradaDaNota {
  const ficha = linhas.fichas.find((f) => f.produto_id === p.id);
  const n = (v: unknown) => Number(v) > 0;
  return {
    tipo: p.tipo,
    unidade: p.unidade,
    temFoto: !!(p.imagem_url ?? "").trim(),
    temDescricao: !!(p.descricao ?? "").trim(),
    temFamilia: !!(familia ?? "").trim(),
    temMedidaPadrao: !!ficha && n(ficha.largura_padrao_m) && n(ficha.altura_padrao_m),
    temMaterialPrincipal: !!p.material_principal_id,
    processos: linhas.processos.filter((x) => x.produto_id === p.id).length,
    perguntas: linhas.perguntas.filter((x) => x.produto_id === p.id && x.finalidade !== "informacao").length,
    roteiroEscrito: !!(ficha?.ia_como_medir ?? "").trim(),
    roteiroRevisado: !!ficha?.ia_revisado_em,
  };
}
