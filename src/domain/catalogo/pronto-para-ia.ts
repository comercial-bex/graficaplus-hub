/**
 * "Pronto para a IA": a nota de 0 a 10 da pasta do produto (fase 6 do plano de
 * 02/11/2026). Cada campo da pasta existe para a IA orçar sozinha depois, nas
 * palavras do dono; a nota diz, produto a produto, o que ainda falta para
 * isso. É contagem do que está preenchido, não opinião: dez checagens, cada
 * uma vale igual, e a que não cabe no produto sai da conta em vez de puxar a
 * nota para baixo. Serviço (acabamento, instalação, criação) não tem foto,
 * material principal, medida padrão, fórmula de material nem pergunta de
 * checklist: a medida vem do item a que ele se aplica, e o que ele pergunta ao
 * cliente é o próprio item. Ajustado em 03/11/2026, quando a conta cobrava
 * "perguntas do checklist" de 13 serviços que não têm o que perguntar.
 */

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
  formulas: number;
  roteiroEscrito: boolean;
  roteiroRevisado: boolean;
};

export type Checagem = {
  chave:
    | "foto"
    | "descricao"
    | "familia"
    | "unidade"
    | "medida"
    | "material"
    | "processos"
    | "perguntas"
    | "formulas"
    | "roteiro";
  rotulo: string;
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
  return [
    { chave: "foto", rotulo: "foto", cabe: !servico, pronta: e.temFoto },
    { chave: "descricao", rotulo: "descrição", cabe: true, pronta: e.temDescricao },
    { chave: "familia", rotulo: "família", cabe: true, pronta: e.temFamilia },
    { chave: "unidade", rotulo: "unidade na proposta", cabe: true, pronta: !!(e.unidade ?? "").trim() },
    { chave: "medida", rotulo: "medida padrão", cabe: area && !servico, pronta: e.temMedidaPadrao },
    { chave: "material", rotulo: "material principal", cabe: !servico, pronta: e.temMaterialPrincipal },
    { chave: "processos", rotulo: "processos", cabe: true, pronta: e.processos > 0 },
    { chave: "perguntas", rotulo: "perguntas do checklist", cabe: !servico, pronta: e.perguntas > 0 },
    { chave: "formulas", rotulo: "fórmula de material", cabe: area && !servico, pronta: e.formulas > 0 },
    {
      chave: "roteiro",
      rotulo: e.roteiroEscrito ? "revisão do roteiro da IA" : "roteiro da IA",
      cabe: true,
      pronta: e.roteiroEscrito && e.roteiroRevisado,
    },
  ];
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

/** "Pronto para a IA: 7 de 10. Falta: foto, fórmula de material." */
export function fraseDaNota(n: NotaDaPasta): string {
  const cabeca = `Pronto para a IA: ${n.nota} de 10.`;
  if (n.faltas.length === 0) return `${cabeca} Nada falta.`;
  return `${cabeca} Falta: ${n.faltas.join(", ")}.`;
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
  formulas: readonly { produto_id: string }[];
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
    formulas: linhas.formulas.filter((x) => x.produto_id === p.id).length,
    roteiroEscrito: !!(ficha?.ia_como_medir ?? "").trim(),
    roteiroRevisado: !!ficha?.ia_revisado_em,
  };
}
