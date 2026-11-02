/**
 * A pasta do produto (01/11/2026).
 *
 * A ficha da lista de produtos responde "quanto custa e quanto cobra". A pasta
 * guarda o resto do que se sabe do produto: como se faz (processos), o material
 * que depende de uma conta (fórmulas), o que perguntar ao orçar (checklist) e o
 * roteiro da IA. Estas regras não têm tela, para o teste ler sem navegador.
 */

export type AbaDaPasta =
  | "descricao"
  | "preco"
  | "parametros"
  | "processos"
  | "formulas"
  | "checklist"
  | "ia"
  | "info"
  | "historico";

export function abasDaPasta(a: { canSeePrices: boolean }): { id: AbaDaPasta; titulo: string }[] {
  const abas: { id: AbaDaPasta; titulo: string }[] = [
    { id: "descricao", titulo: "Descrição" },
    { id: "parametros", titulo: "Parâmetros" },
    { id: "processos", titulo: "Processos" },
    { id: "formulas", titulo: "Fórmulas" },
    { id: "checklist", titulo: "Checklist" },
    { id: "ia", titulo: "Orç.IA" },
    { id: "info", titulo: "Info" },
    { id: "historico", titulo: "Histórico" },
  ];
  if (a.canSeePrices) abas.splice(1, 0, { id: "preco", titulo: "Preço" });
  return abas;
}

/**
 * O cadastro do produto (tabela `produtos`) editado na própria pasta, como na
 * ficha do Holdprint (02/11/2026): antes, nome, família, preço e máquina só se
 * mudavam na janela da lista, e a pasta mandava a pessoa voltar. Preço e custo
 * entram no que se grava só para quem os vê: quem lê a view operacional
 * carrega "0" e gravaria R$ 0 por cima do preço real.
 */
export type Cadastro = {
  nome: string;
  descricao: string;
  familia: string;
  categoria: string;
  tipo: "produto" | "servico";
  unidade: string;
  imagem_url: string;
  custo_medio: string;
  preco_base: string;
  margem_minima: string;
  area_minima_cobrada: string;
  tempo_producao_min: string;
  maquina_padrao_id: string;
  material_principal_id: string;
  observacoes_internas: string;
};

export const CADASTRO_VAZIO: Cadastro = {
  nome: "",
  descricao: "",
  familia: "",
  categoria: "outros",
  tipo: "produto",
  unidade: "un",
  imagem_url: "",
  custo_medio: "",
  preco_base: "",
  margem_minima: "",
  area_minima_cobrada: "",
  tempo_producao_min: "",
  maquina_padrao_id: "",
  material_principal_id: "",
  observacoes_internas: "",
};

/** O que vai para `produtos`: preço e custo só de quem os vê; vazio vira nulo onde o banco aceita. */
export function payloadDoCadastro(
  c: Cadastro,
  visao: { canSeePrices: boolean; canSeeFinancials: boolean },
): Record<string, unknown> {
  const numero = (s: string) => Number(String(s).replace(",", "."));
  const payload: Record<string, unknown> = {
    nome: c.nome.trim(),
    descricao: c.descricao.trim() || null,
    familia: c.familia.trim() || null,
    categoria: c.categoria,
    tipo: c.tipo,
    unidade: c.unidade,
    imagem_url: c.imagem_url.trim() || null,
    tempo_producao_min: c.tempo_producao_min.trim() ? numero(c.tempo_producao_min) : null,
    maquina_padrao_id: c.maquina_padrao_id || null,
    material_principal_id: c.material_principal_id || null,
    observacoes_internas: c.observacoes_internas.trim() || null,
  };
  if (visao.canSeePrices) payload.preco_base = numero(c.preco_base) || 0;
  if (visao.canSeeFinancials) {
    payload.custo_medio = numero(c.custo_medio) || 0;
    payload.margem_minima = numero(c.margem_minima) || 0;
    // Vazio = sem mínimo; nunca 0, que o CHECK recusa e significaria outra coisa.
    payload.area_minima_cobrada = numero(c.area_minima_cobrada) || null;
  }
  return payload;
}

/** O que a fórmula enxerga: as medidas do item que está sendo orçado. */
export type VariaveisDaFormula = {
  largura: number;
  altura: number;
  copias: number;
  quantidade: number;
};

export type ResultadoDaFormula = { ok: true; valor: number } | { ok: false; erro: string };

export const VARIAVEIS_DA_FORMULA = [
  "largura",
  "altura",
  "area",
  "perimetro",
  "copias",
  "quantidade",
] as const;

const FUNCOES: Record<string, (...v: number[]) => number> = {
  teto: Math.ceil,
  piso: Math.floor,
  arred: Math.round,
  min: Math.min,
  max: Math.max,
};

/**
 * Calcula a fórmula sem `eval`: aceita números, as variáveis acima, + - * / e
 * parênteses, e as funções teto, piso, arred, min e max. O texto é digitado por
 * gente da casa e depois vira consumo de material: nada além de conta pode rodar.
 */
export function avaliarFormula(script: string, v: VariaveisDaFormula): ResultadoDaFormula {
  const vars: Record<string, number> = {
    largura: v.largura,
    altura: v.altura,
    area: v.largura * v.altura,
    perimetro: 2 * (v.largura + v.altura),
    copias: v.copias,
    quantidade: v.quantidade,
  };
  const fichas = script.match(/\d+(?:[.,]\d+)?|[a-zA-Zçãé_]+|\S/g) ?? [];
  if (fichas.length === 0) return { ok: false, erro: "A fórmula está vazia." };
  let i = 0;

  const fator = (): number => {
    const t = fichas[i];
    if (t === undefined) throw new Error("A fórmula terminou antes da hora.");
    if (t === "-") {
      i++;
      return -fator();
    }
    if (t === "(") {
      i++;
      const dentro = soma();
      if (fichas[i] !== ")") throw new Error("Falta fechar um parêntese.");
      i++;
      return dentro;
    }
    if (/^\d/.test(t)) {
      i++;
      return Number(t.replace(",", "."));
    }
    if (/^[a-zA-Zçãé_]/.test(t)) {
      i++;
      const nome = t.toLowerCase();
      if (fichas[i] === "(") {
        const f = FUNCOES[nome];
        if (!f) throw new Error(`Função desconhecida: ${t}.`);
        i++;
        const args = [soma()];
        // Na fórmula, a vírgula entre números separa argumentos só com espaço ou
        // ";": "min(1,5; 2)". "min(1,5)" é o número 1,5, como se escreve aqui.
        while (fichas[i] === ";") {
          i++;
          args.push(soma());
        }
        if (fichas[i] !== ")") throw new Error("Falta fechar um parêntese.");
        i++;
        return f(...args);
      }
      if (nome in vars) return vars[nome];
      throw new Error(`Variável desconhecida: ${t}.`);
    }
    throw new Error(`Não entendi "${t}".`);
  };

  const produto = (): number => {
    let r = fator();
    while (fichas[i] === "*" || fichas[i] === "/") {
      const op = fichas[i++];
      const d = fator();
      if (op === "/" && d === 0) throw new Error("Divisão por zero.");
      r = op === "*" ? r * d : r / d;
    }
    return r;
  };

  function soma(): number {
    let r = produto();
    while (fichas[i] === "+" || fichas[i] === "-") {
      const op = fichas[i++];
      const d = produto();
      r = op === "+" ? r + d : r - d;
    }
    return r;
  }

  try {
    const valor = soma();
    if (i < fichas.length) return { ok: false, erro: `Sobrou "${fichas[i]}" no fim da fórmula.` };
    if (!Number.isFinite(valor)) return { ok: false, erro: "O resultado não é um número." };
    return { ok: true, valor };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

export type BaseDeProdutividade = "m2_h" | "m_h" | "tempo_do_produto";

export const ROTULO_DA_BASE: Record<BaseDeProdutividade, string> = {
  m2_h: "m²/h",
  m_h: "metros de contorno/h",
  tempo_do_produto: "tempo do produto",
};

export type OrigemDaProdutividade =
  | "cadastro_maquina"
  | "referencia_mercado"
  | "medido"
  | "nao_se_aplica";

export const ROTULO_DA_ORIGEM: Record<OrigemDaProdutividade, string> = {
  cadastro_maquina: "Do cadastro da máquina",
  referencia_mercado: "Referência do setor",
  medido: "Medido na oficina",
  nao_se_aplica: "Vem do produto",
};

export type LinhaDeProdutividade = { familias: string[]; produtividade_m2_h: number };

export type ProcessoParaTempo = {
  base_produtividade?: BaseDeProdutividade | null;
  setup_min: number | null;
  produtividade_m2_h: number | null;
  produtividade_m_h?: number | null;
  produtividade_por_familia?: LinhaDeProdutividade[] | null;
};

/** O número geral do processo, na unidade da base dele. */
function produtividadeGeral(p: ProcessoParaTempo): number | null {
  const n = p.base_produtividade === "m_h" ? p.produtividade_m_h : p.produtividade_m2_h;
  return n && n > 0 ? Number(n) : null;
}

/** A produtividade da família do material vale mais que a geral do processo. */
export function produtividadeDe(
  p: ProcessoParaTempo,
  familia: string | null | undefined,
): number | null {
  const f = (familia ?? "").trim().toLowerCase();
  if (f) {
    const linha = (p.produtividade_por_familia ?? []).find((l) =>
      l.familias.some((x) => {
        const nome = x.trim().toLowerCase();
        return nome !== "" && f.includes(nome);
      }),
    );
    if (linha && linha.produtividade_m2_h > 0) return linha.produtividade_m2_h;
  }
  return produtividadeGeral(p);
}

export type TempoDoProcesso =
  | { tipo: "minutos"; minutos: number }
  /** Laser, recorte, 3D, instalação: depende do desenho, o número mora no produto ou no fatiador. */
  | { tipo: "do_produto"; minutos: number | null }
  /** Devia ter número e não tem. Dizer "0 min" esconderia a falta. */
  | { tipo: "falta" };

/**
 * O tempo de um processo para uma peça: a preparação mais a área (ou o contorno)
 * dividida pela produtividade. Refile, bainha e ilhós andam pelo contorno; a
 * impressão anda pela área.
 */
export function tempoDoProcesso(
  p: ProcessoParaTempo,
  peca: { largura: number; altura: number; copias?: number },
  opcoes: { familia?: string | null; tempoDoProduto?: number | null } = {},
): TempoDoProcesso {
  if (p.base_produtividade === "tempo_do_produto") {
    const t = opcoes.tempoDoProduto;
    return { tipo: "do_produto", minutos: t && t > 0 ? t : null };
  }
  const prod = produtividadeDe(p, opcoes.familia);
  if (prod === null) return { tipo: "falta" };
  const copias = Math.max(peca.copias ?? 1, 1);
  const medida =
    p.base_produtividade === "m_h"
      ? 2 * (peca.largura + peca.altura) * copias
      : peca.largura * peca.altura * copias;
  const minutos = (p.setup_min ?? 0) + (Math.max(medida, 0) / prod) * 60;
  return { tipo: "minutos", minutos: Math.round(minutos * 10) / 10 };
}

/** O que cada área ainda tem para preencher: a conta do painel de cobrança. */
export function faltaNaArea(linhas: { pronto: boolean }[]): {
  total: number;
  prontos: number;
  falta: number;
  pct: number;
} {
  const total = linhas.length;
  const prontos = linhas.filter((l) => l.pronto).length;
  return {
    total,
    prontos,
    falta: total - prontos,
    pct: total === 0 ? 100 : Math.round((prontos / total) * 100),
  };
}

/**
 * O custo cheio deixa o acabamento de fora só quando conta o tempo pela velocidade da máquina. Com
 * tempo cadastrado, os minutos já são a peça inteira; no serviço, o acabamento é o próprio produto.
 * Fora do caso da velocidade, somar as etapas contaria o mesmo tempo duas vezes.
 */
export function acabamentoFicaForaDoCusto(a: {
  tipo: string | null;
  unidade: string | null;
  maquina: { base_cobranca: string | null; velocidade_m2_h: number | null } | null;
}): boolean {
  if (a.tipo === "servico" || !a.maquina) return false;
  return (
    a.maquina.base_cobranca === "area" &&
    Number(a.maquina.velocidade_m2_h ?? 0) > 0 &&
    (a.unidade ?? "").toLowerCase().replace("²", "2") === "m2"
  );
}

export type EtapaParaCusto = ProcessoParaTempo & { nome: string; etapa: string | null };

export type CustoDasEtapas = {
  linhas: { nome: string; minutos: number; custo: number }[];
  /** Etapa sem número próprio: somar o tempo inteiro do produto contaria a peça duas vezes. */
  semNumero: string[];
  total: number;
};

/**
 * O que os acabamentos da sequência custam em gente numa peça. A impressão fica de fora porque o
 * custo cheio já a conta (máquina e mão de obra pela velocidade); o acabamento, não.
 */
export function custoDasEtapasDeAcabamento(
  etapas: EtapaParaCusto[],
  peca: { largura: number; altura: number; copias?: number },
  horaDaPessoa: number,
  opcoes: { familia?: string | null } = {},
): CustoDasEtapas {
  const linhas: CustoDasEtapas["linhas"] = [];
  const semNumero: string[] = [];
  for (const e of etapas) {
    if (e.etapa !== "acabamento") continue;
    const t = tempoDoProcesso(e, peca, { familia: opcoes.familia });
    if (t.tipo !== "minutos") {
      semNumero.push(e.nome);
      continue;
    }
    linhas.push({
      nome: e.nome,
      minutos: t.minutos,
      custo: Math.round(((t.minutos / 60) * horaDaPessoa + Number.EPSILON) * 100) / 100,
    });
  }
  const total = Math.round(linhas.reduce((s, l) => s + l.custo, 0) * 100) / 100;
  return { linhas, semNumero, total };
}

export type TipoDeResposta = "unica" | "multipla" | "numero" | "texto";

export const ROTULO_DO_TIPO: Record<TipoDeResposta, string> = {
  unica: "Lista de uma escolha",
  multipla: "Lista de várias escolhas",
  numero: "Número",
  texto: "Texto",
};

/** "Se a resposta for X, acrescenta o processo Y." */
export type AcaoDaResposta = { resposta: string; processo_id: string };

export type PerguntaEmEdicao = {
  pergunta: string;
  tipo_resposta: TipoDeResposta;
  respostas: string[];
  acoes: AcaoDaResposta[];
  resposta_padrao?: string;
  nao_perguntar?: boolean;
};

/** Pendência vira frase; ação de uma resposta que saiu da lista não fica para trás. */
export function pendenciaDaPergunta(p: PerguntaEmEdicao): string | null {
  if (!p.pergunta.trim()) return "Escreva a pergunta.";
  const comLista = p.tipo_resposta === "unica" || p.tipo_resposta === "multipla";
  if (comLista && p.respostas.filter((r) => r.trim()).length < 2)
    return "Dê pelo menos duas respostas.";
  const orfa = p.acoes.find((a) => !p.respostas.includes(a.resposta));
  if (orfa) return `A ação usa a resposta "${orfa.resposta}", que não está na lista.`;
  if (p.acoes.some((a) => !a.processo_id)) return "Escolha o processo de cada ação.";
  const padrao = (p.resposta_padrao ?? "").trim();
  if (p.nao_perguntar && !padrao) return "Sem perguntar, diga qual é a resposta.";
  if (padrao && comLista && !p.respostas.includes(padrao))
    return `A resposta já marcada, "${padrao}", não está na lista.`;
  return null;
}

/** Quebra o texto "Sim, Não" digitado em respostas, sem repetir e sem vazios. */
export function respostasDoTexto(texto: string): string[] {
  return [
    ...new Set(
      texto
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  ];
}

const NOMES_DOS_CAMPOS: Record<string, string> = {
  nome: "nome",
  descricao: "descrição",
  unidade: "unidade",
  ativo: "ativo",
  preco_base: "preço",
  custo_medio: "custo",
  margem_minima: "margem mínima",
  maquina_padrao_id: "máquina padrão",
  material_principal_id: "material principal",
  tempo_producao_min: "tempo de produção",
  area_minima_cobrada: "área mínima",
};

const NOMES_DAS_TABELAS: Record<string, string> = {
  produtos: "Cadastro",
  produto_ficha: "Pasta",
  produto_processos: "Processos",
  produto_formulas: "Fórmulas",
  produto_perguntas: "Checklist",
};

/** A linha do histórico em português: o registro guarda só o nome do que mudou, nunca o valor. */
export function frasesDoHistorico(
  acao: string,
  detalhes: { tabela?: string; campos?: string[] } | null,
): string {
  const onde = NOMES_DAS_TABELAS[detalhes?.tabela ?? ""] ?? "Produto";
  if (acao === "insert") return `${onde}: item incluído`;
  if (acao === "delete") return `${onde}: item removido`;
  const campos = (detalhes?.campos ?? []).map((c) => NOMES_DOS_CAMPOS[c] ?? c.replaceAll("_", " "));
  return campos.length ? `${onde}: alterou ${campos.join(", ")}` : `${onde}: alterado`;
}
