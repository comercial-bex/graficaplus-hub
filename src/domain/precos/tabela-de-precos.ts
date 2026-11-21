/**
 * Contas da tabela de preços (custo, venda final, venda parceiro, lucro,
 * concorrentes). Tudo por UNIDADE de venda do produto (m², un, m…), como o
 * cadastro guarda `custo_medio` e `preco_base`.
 *
 * Margem é sobre a VENDA (lucro ÷ preço), a mesma do semáforo do orçamento;
 * markup é sobre o custo. Misturar os dois já fez "30%" querer dizer duas coisas.
 */
import type { ChaveDaFalta } from "./onde-corrigir";

export const MAX_CONCORRENTES = 3;

export type PrecoDeParceiro = { valor: number; origem: "cadastro" | "nivel" };

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Piso de preço: o menor preço que ainda cumpre a margem mínima sobre a venda.
 * round(custo / (1 - margem_minima / 100), 2). Sem custo ou sem margem válida, sem piso.
 */
export function pisoDaMargem(custo: number | null, margemMinima: number | null): number | null {
  if (custo == null || custo <= 0 || margemMinima == null || margemMinima <= 0 || margemMinima >= 100) return null;
  return Math.round((custo / (1 - margemMinima / 100)) * 100) / 100;
}

/** Preço do parceiro: o do cadastro do produto, senão o do nível mais baixo do programa. */
export function precoDoParceiro(args: {
  precoParceiro: number | null;
  precoBase: number | null;
  descontoDoNivelPct: number | null;
}): PrecoDeParceiro | null {
  if (args.precoParceiro != null && args.precoParceiro > 0) return { valor: centavos(args.precoParceiro), origem: "cadastro" };
  if (args.precoBase != null && args.precoBase > 0 && args.descontoDoNivelPct != null) {
    return { valor: centavos(args.precoBase * (1 - args.descontoDoNivelPct / 100)), origem: "nivel" };
  }
  return null;
}

export function lucroPorUnidade(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null) return null;
  return centavos(preco - custo);
}

/** Margem sobre a venda, em %. Sem preço (ou preço zero) não há margem para mostrar. */
export function margemSobreVenda(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null || preco <= 0) return null;
  return Math.round(((preco - custo) / preco) * 1000) / 10;
}

export type PosicaoNoMercado = {
  menor: number;
  media: number;
  /** quanto o nosso preço está acima (+) ou abaixo (−) do mais barato, em % */
  contraOMenorPct: number;
  /** idem contra a média dos concorrentes */
  contraAMediaPct: number;
};

export function posicaoNoMercado(preco: number | null, concorrentes: number[]): PosicaoNoMercado | null {
  const validos = concorrentes.filter((p) => Number.isFinite(p) && p > 0);
  if (preco == null || preco <= 0 || validos.length === 0) return null;
  const menor = Math.min(...validos);
  const media = validos.reduce((s, p) => s + p, 0) / validos.length;
  const pct = (ref: number) => Math.round(((preco - ref) / ref) * 1000) / 10;
  return { menor, media: centavos(media), contraOMenorPct: pct(menor), contraAMediaPct: pct(media) };
}

/** Quanto abaixo do concorrente mais barato a casa mira (R$ 1,20 a R$ 1,50, dito pelo dono em 24/10/2026). */
export const FOLGA_SOBRE_O_CONCORRENTE = 1.5;

export type Sugestao = {
  chave: "bater" | "igualar" | "piso";
  rotulo: string;
  preco: number;
  margem: number | null;
  /** margem abaixo do mínimo cadastrado no produto */
  abaixoDoMinimo: boolean;
  /** a conta por extenso, para a dica */
  conta: string;
};

const R = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const P = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/**
 * Três caminhos para um preço, sempre com a conta à vista:
 *   bater   — o concorrente mais barato menos a folga (mira do dono);
 *   igualar — o mesmo preço dele;
 *   piso    — o menor preço que ainda respeita a margem mínima do produto
 *             (custo ÷ (1 − margem mínima)); só existe com custo e margem mínima.
 * Sem concorrente anotado só o piso é possível.
 */
export function sugestoesDePreco(args: {
  custo: number | null;
  margemMinimaPct: number | null;
  menorConcorrente: number | null;
  folga?: number;
}): Sugestao[] {
  const { custo, margemMinimaPct, menorConcorrente } = args;
  const folga = args.folga ?? FOLGA_SOBRE_O_CONCORRENTE;
  const minimo = margemMinimaPct != null && margemMinimaPct > 0 ? margemMinimaPct : null;
  const abaixo = (m: number | null) => m != null && minimo != null && m < minimo;
  const saida: Sugestao[] = [];

  if (menorConcorrente != null && menorConcorrente > 0) {
    const bater = centavos(menorConcorrente - folga);
    if (bater > 0) {
      const m = margemSobreVenda(bater, custo);
      saida.push({
        chave: "bater",
        rotulo: `Bater (−${R(folga)})`,
        preco: bater,
        margem: m,
        abaixoDoMinimo: abaixo(m),
        conta: `${R(menorConcorrente)} do concorrente − ${R(folga)} = ${R(bater)}. Custo ${custo != null ? R(custo) : "—"}: lucro ${
          custo != null ? R(centavos(bater - custo)) : "—"
        } e margem ${P(m)}${minimo != null ? ` (mínimo do produto: ${P(minimo)})` : ""}.`,
      });
    }
    const m = margemSobreVenda(menorConcorrente, custo);
    saida.push({
      chave: "igualar",
      rotulo: "Igualar",
      preco: menorConcorrente,
      margem: m,
      abaixoDoMinimo: abaixo(m),
      conta: `Mesmo preço do concorrente mais barato (${R(menorConcorrente)}). Margem ${P(m)}${minimo != null ? ` (mínimo: ${P(minimo)})` : ""}.`,
    });
  }

  if (custo != null && custo > 0 && minimo != null && minimo < 100) {
    const piso = centavos(custo / (1 - minimo / 100));
    saida.push({
      chave: "piso",
      rotulo: "Piso da margem",
      preco: piso,
      margem: margemSobreVenda(piso, custo),
      abaixoDoMinimo: false,
      conta: `Custo ${R(custo)} ÷ (1 − ${P(minimo)}) = ${R(piso)}: o menor preço que ainda respeita a margem mínima${
        menorConcorrente != null ? `. Fica ${R(centavos(piso - menorConcorrente))} ${piso >= menorConcorrente ? "acima" : "abaixo"} do concorrente.` : "."
      }`,
    });
  }
  return saida;
}

// ------------------------------------------------------------------ composição
/**
 * Regra do negócio (a mesma de `custo_cheio_do_produto` no banco): o custo de
 * uma peça é MATÉRIA-PRIMA (a receita: lona, vinil, acrílico, tinta…) + MÁQUINA
 * (tempo × custo da hora) + MÃO DE OBRA (tempo × hora da função) + INDIRETO
 * (rateio administrativo por hora). O `custo_medio` do cadastro, na maioria
 * dos produtos, é só o material: a tabela mostra os dois lado a lado para a
 * margem não parecer maior do que é.
 */
export type Composicao = { material: number; maquina: number; maoDeObra: number; indireto: number };

export const PARTES_DO_CUSTO = [
  { chave: "material", rotulo: "Matéria-prima", ajuda: "O que a receita do produto consome: lona, vinil, acrílico, tinta e outros, vezes o custo de compra." },
  { chave: "maquina", rotulo: "Máquina", ajuda: "Horas da máquina vezes o custo da hora, mais a energia, que é a potência vezes a tarifa. Em produto por metro quadrado as horas saem da velocidade de cálculo da máquina, ou da velocidade do catálogo quando ela está vazia. Manutenção, limpeza e cabeçote da plotter entram à parte, nos extras." },
  { chave: "maoDeObra", rotulo: "Mão de obra", ajuda: "Horas de mão de obra vezes a hora da função do setor, com os encargos cadastrados nessa função. Em produto por metro quadrado as horas são as da máquina vezes o fator de mão de obra, que vale 1,5 quando ninguém o mudou." },
  { chave: "indireto", rotulo: "Indireto", ajuda: "Rateio do aluguel e dos outros custos fixos do espaço, como internet e software, dividido pelas horas do mês e cobrado pelas horas de mão de obra do produto." },
] as const satisfies ReadonlyArray<{ chave: keyof Composicao; rotulo: string; ajuda: string }>;

/**
 * O custo cheio só vale quando a matéria-prima está dentro dele: produto físico sem receita tem
 * máquina, mão de obra e rateio (R$ 3,91) mas material zero, e esse "cheio" faria a margem parecer
 * 88%. Serviço não tem material; produto com receita tem. Fora disso, vale o custo do cadastro.
 */
export function cheioConfiavel(a: { tipo: string | null; temReceita: boolean; cheio: number | null }): number | null {
  if (a.cheio == null) return null;
  return a.tipo === "servico" || a.temReceita ? a.cheio : null;
}

/** O custo e o preço de balcão foram copiados de um produto parecido (migração 20261025500000). */
export function custoProvisorio(observacoes: string | null | undefined): boolean {
  return /CUSTO E PREÇO DE BALCÃO PROVISÓRIOS/i.test(observacoes ?? "");
}

export function custoCheio(c: Composicao | null): number | null {
  if (!c) return null;
  const total = c.material + c.maquina + c.maoDeObra + c.indireto;
  return total > 0 ? centavos(total) : null;
}

/** Cada parte em % do custo cheio, para a barra empilhada. Soma 100 (o resto vai na maior). */
export function fatiasDoCusto(c: Composicao | null): Array<{ chave: keyof Composicao; valor: number; pct: number }> {
  const total = custoCheio(c);
  if (!c || total == null) return [];
  return PARTES_DO_CUSTO.map(({ chave }) => ({ chave, valor: centavos(c[chave]), pct: Math.round((c[chave] / total) * 1000) / 10 })).filter((f) => f.valor > 0);
}

/**
 * Serviço sem receita e com custo digitado: o digitado já é o custo inteiro, com tempo e rateio
 * (Refile: 0,6 min × R$ 24,17/h = R$ 0,24). Na composição ele mora em material, como no banco
 * (`custo_cheio_do_produto`, migração 20261102120500), e nada se soma por cima.
 */
export function servicoComCustoInteiro(a: { tipo: string | null; temReceita: boolean; custo: number | null }): boolean {
  return a.tipo === "servico" && !a.temReceita && (a.custo ?? 0) > 0;
}

export type NivelDaFicha = "completa" | "parcial" | "sem_ficha";
/** Uma falta da ficha: o texto que a pessoa lê e a chave que diz onde se corrige (`ondeCorrigirFalta`). */
export type FaltaDaFicha = { chave: ChaveDaFalta; texto: string };
export type FichaDoProduto = {
  nivel: NivelDaFicha;
  /** Só os textos, na mesma ordem de `itens`. Existe porque várias telas e testes leem a lista de frases. */
  faltas: string[];
  itens: FaltaDaFicha[];
};

/**
 * A ficha técnica do produto está de pé? Produto físico precisa de matéria-prima
 * na receita; todo item que se produz precisa de tempo e (se tem máquina) da
 * máquina padrão; serviço vive de tempo/mão de obra. Brinde de revenda
 * (comprado pronto) não tem receita nem máquina: a falta de receita ali é
 * dito como "custo digitado", não como erro.
 */
export function fichaDoProduto(a: {
  tipo: string | null;
  categoria: string | null;
  temReceita: boolean;
  minutos: number | null;
  temMaquina: boolean;
  composicao: Composicao | null;
}): FichaDoProduto {
  const itens: FaltaDaFicha[] = [];
  const servico = a.tipo === "servico";
  const revenda = a.categoria === "brindes" || a.categoria === "outros";
  if (servicoComCustoInteiro({ tipo: a.tipo, temReceita: a.temReceita, custo: a.composicao?.material ?? null })) {
    return { nivel: "completa", faltas: [], itens };
  }
  if (!servico && !a.temReceita) {
    itens.push(
      revenda
        ? { chave: "custo_digitado", texto: "custo digitado à mão (sem matéria-prima na receita)" }
        : { chave: "sem_materia_prima", texto: "sem matéria-prima na receita" },
    );
  }
  if (!(a.minutos && a.minutos > 0)) itens.push({ chave: "sem_tempo", texto: "sem tempo de produção" });
  if (!servico && !revenda && !a.temMaquina) itens.push({ chave: "sem_maquina", texto: "sem máquina padrão" });
  if (a.composicao && a.composicao.maoDeObra <= 0 && a.minutos && a.minutos > 0) {
    itens.push({ chave: "sem_mao_de_obra", texto: "sem custo de mão de obra" });
  }
  const faltas = itens.map((i) => i.texto);
  const nivel: NivelDaFicha = faltas.length === 0 ? "completa" : a.temReceita || (a.minutos ?? 0) > 0 ? "parcial" : "sem_ficha";
  return { nivel, faltas, itens };
}

// ----------------------------------------------------------- barra de comparação
export type Marcador = {
  chave: string;
  rotulo: string;
  valor: number;
  tipo: "custo" | "piso" | "nos" | "parceiro" | "concorrente";
};

export type MarcadorPosicionado = Marcador & { posPct: number };

/**
 * Posiciona marcadores numa mesma régua (0–100%), do menor ao maior valor com
 * folga de 8% dos dois lados. Valores iguais ficam no mesmo ponto — a tela
 * empilha os rótulos. Sem pelo menos dois valores distintos não há régua.
 */
export function escalaDePrecos(marcadores: Marcador[]): { marcadores: MarcadorPosicionado[]; minimo: number; maximo: number } | null {
  const validos = marcadores.filter((m) => Number.isFinite(m.valor) && m.valor > 0);
  if (validos.length < 2) return null;
  const valores = validos.map((m) => m.valor);
  const menor = Math.min(...valores);
  const maior = Math.max(...valores);
  if (maior === menor) return null;
  const folga = (maior - menor) * 0.08;
  const de = menor - folga;
  const ate = maior + folga;
  return {
    minimo: menor,
    maximo: maior,
    marcadores: validos.map((m) => ({ ...m, posPct: Math.round(((m.valor - de) / (ate - de)) * 1000) / 10 })),
  };
}

/** Ordem em que as categorias aparecem na tela (a do cadastro); desconhecida vai no fim. */
export function agruparPorCategoria<T extends { categoria: string | null }>(itens: T[], ordem: readonly string[]): Array<{ categoria: string; itens: T[] }> {
  const mapa = new Map<string, T[]>();
  for (const i of itens) {
    const c = i.categoria ?? "outros";
    mapa.set(c, [...(mapa.get(c) ?? []), i]);
  }
  const pos = (c: string) => (ordem.indexOf(c) === -1 ? ordem.length : ordem.indexOf(c));
  return [...mapa.entries()].sort((a, b) => pos(a[0]) - pos(b[0]) || a[0].localeCompare(b[0])).map(([categoria, lista]) => ({ categoria, itens: lista }));
}

/** O banco guarda mais de uma linha de composição por produto em alguns casos: vale a mais recente. */
export function composicaoMaisRecente<T extends { produto_id: string; updated_at: string }>(linhas: T[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const l of linhas) {
    const atual = mapa.get(l.produto_id);
    if (!atual || l.updated_at > atual.updated_at) mapa.set(l.produto_id, l);
  }
  return mapa;
}
