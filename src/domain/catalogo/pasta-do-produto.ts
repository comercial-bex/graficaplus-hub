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

export type LinhaDeProdutividade = { familias: string[]; produtividade_m2_h: number };

export type ProcessoParaTempo = {
  setup_min: number | null;
  produtividade_m2_h: number | null;
  produtividade_por_familia?: LinhaDeProdutividade[] | null;
};

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
  return p.produtividade_m2_h && p.produtividade_m2_h > 0 ? p.produtividade_m2_h : null;
}

/**
 * Minutos de um processo para uma área: o setup mais a área dividida pela
 * produtividade. Sem produtividade devolve null: dizer "0 min" esconderia que
 * falta o número, e o orçamento pareceria mais rápido do que é.
 */
export function minutosDoProcesso(
  p: ProcessoParaTempo,
  areaM2: number,
  familia?: string | null,
): number | null {
  const prod = produtividadeDe(p, familia);
  if (prod === null) return null;
  return Math.round(((p.setup_min ?? 0) + (Math.max(areaM2, 0) / prod) * 60) * 10) / 10;
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
