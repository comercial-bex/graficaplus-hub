/**
 * Simulador de preço: quanto custa uma peça real com os números da casa, por
 * quanto a casa venderia e quanto sobra.
 *
 * NÃO tem conta própria. O custo sai do motor do orçamento
 * (`calcularOrcamento`, em `domain/orcamentos/cost-engine`), a hora de gente
 * com encargos sai de `custoHoraComEncargos` (`domain/financeiro/encargos`) e
 * o preço de tabela por quantidade sai de `faixaAplicada`
 * (`domain/orcamentos/faixas`). Uma segunda fórmula aqui seria um segundo
 * preço para a mesma peça — o defeito que a calculadora solta tinha.
 *
 * Como cada parâmetro da casa entra (os mesmos de `custos_tabela`):
 *
 *   material      consumo × custo, com perda + falha da casa em cada linha da
 *                 ficha — a Meta do mês também soma as duas sobre o material.
 *                 A perda entra como no orçamento: para sobrar 1 m² bom com
 *                 13% de perda, compra-se 1 ÷ 0,87 m².
 *   máquina       horas × custo/hora da máquina + horas × kW × tarifa de
 *                 energia (o custo/hora da máquina é depreciação ou locação,
 *                 sem energia — ver `custo_hora_sugerido`).
 *   mão de obra   as MESMAS horas × (R$/h + encargos), como no custo cheio
 *                 do produto: a hora de máquina é hora de alguém operando.
 *   rateio        horas × custo administrativo por hora — a regra de
 *                 `custo_cheio_do_produto`.
 *   preço         custo × (1 + markup de varejo ou de atacado).
 *   taxas         imposto + taxa do cartão, sobre o PREÇO.
 */

import {
  calcularOrcamento,
  precoParaMargem,
  type EntradaCalculo,
  type ResultadoCalculo,
} from "@/domain/orcamentos/cost-engine";
import { custoHoraComEncargos } from "@/domain/financeiro/encargos";
import { faixaAplicada, faixasVigentes, type FaixaPreco } from "@/domain/orcamentos/faixas";
import type { ValoresDosParametros } from "./parametros";

export type Tabela = "varejo" | "atacado";
export type Pagamento = "media" | "pix" | "cartao";

/**
 * Quanto da taxa do cartão incide.
 *
 * "media" é a suposição que a casa já usa: a Meta do mês
 * (`ponto_de_equilibrio`) soma imposto + METADE da taxa do cartão, como se
 * metade das vendas fosse no cartão. Para uma venda só, quem simula escolhe
 * como o cliente paga.
 */
export const PARTE_NO_CARTAO: Record<Pagamento, number> = { media: 0.5, pix: 0, cartao: 1 };

export const ROTULO_PAGAMENTO: Record<Pagamento, string> = {
  media: "Média da casa (metade no cartão)",
  pix: "PIX ou dinheiro",
  cartao: "Cartão",
};

export type LinhaDeMaterial = {
  chave: string;
  material_id: string | null;
  nome: string;
  unidade: string;
  /** Consumo por unidade vendida: 1,05 m² de lona por m² de faixa, 14 ml de tinta… */
  porUnidade: number;
  custoUnitario: number;
  /**
   * A linha é o custo digitado no cadastro do produto, não um material da
   * ficha. Não leva perda: é uma estimativa de quem cadastrou, e a regra da
   * casa (`produto_custo_cheio`) também a usa como está.
   */
  semFicha?: boolean;
};

export type MaquinaEscolhida = {
  id: string;
  nome: string;
  custoHora: number;
  potenciaKw: number;
  setupMin: number;
};

export type EntradaDaSimulacao = {
  quantidade: number;
  materiais: LinhaDeMaterial[];
  maquina: MaquinaEscolhida | null;
  /** Tempo de produção por unidade vendida: vale para a máquina, a gente e o rateio. */
  minutosPorUnidade: number;
  /** Terceiros, frete, embalagem — por unidade vendida. */
  outrosPorUnidade: number;
  tabela: Tabela;
  pagamento: Pagamento;
  parametros: ValoresDosParametros;
};

export type ResultadoDaSimulacao = {
  calculo: ResultadoCalculo;
  quantidade: number;
  horas: number;
  /** frações: 0,6 = 60% */
  markupPct: number;
  taxasVendaPct: number;
  /** perda + falha da casa, aplicada em cada material da ficha */
  perdaPct: number;
  /** R$/h da mão de obra já com encargos */
  maoDeObraHora: number;
  rateioAdministrativo: number;
  outros: number;
  custoUnitario: number;
  precoSugeridoUnitario: number;
  /** O que a conta não tem — dito, em vez de somado como zero em silêncio. */
  avisos: string[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O teto da perda: o motor recusa 100% (a quantidade real iria ao infinito). */
const PERDA_MAXIMA = 0.9;

export function simular(e: EntradaDaSimulacao): ResultadoDaSimulacao {
  const p = e.parametros;
  const avisos: string[] = [];

  const quantidade = Math.max(0, num(e.quantidade));
  if (quantidade <= 0) avisos.push("Informe a quantidade: sem ela não há o que custear.");

  const minutos = Math.max(0, num(e.minutosPorUnidade));
  const horas = (minutos * quantidade) / 60;

  const perda = Math.min(
    Math.max(0, num(p.pct_perda_material) + num(p.pct_falha_producao)) / 100,
    PERDA_MAXIMA,
  );
  const markup = Math.max(0, num(e.tabela === "atacado" ? p.markup_atacado : p.markup_padrao)) / 100;
  const taxas =
    Math.max(0, num(p.impostos_venda) + num(p.taxa_cartao) * PARTE_NO_CARTAO[e.pagamento]) / 100;
  const encargos = Math.max(0, num(p.mo_encargos_pct)) / 100;
  const rateio = horas * Math.max(0, num(p.custo_admin_hora));
  const outros = Math.max(0, num(e.outrosPorUnidade)) * quantidade;

  const materiais = e.materiais.filter((m) => num(m.porUnidade) > 0);
  if (materiais.length === 0) avisos.push("Nenhum material na conta.");
  for (const m of materiais) {
    if (num(m.custoUnitario) <= 0) {
      avisos.push(`${m.nome} está sem custo: entra na conta como R$ 0,00.`);
    }
  }
  if (minutos <= 0) {
    avisos.push("Sem tempo de produção: máquina, mão de obra e rateio ficaram fora da conta.");
  } else if (e.maquina && num(e.maquina.custoHora) <= 0) {
    avisos.push(
      `A máquina ${e.maquina.nome} está sem custo por hora: o tempo dela entra só com a energia.`,
    );
  }
  if (minutos > 0 && num(p.mo_custo_hora) <= 0) {
    avisos.push("A casa está sem custo de mão de obra por hora: as horas de gente entram como zero.");
  }

  const entrada: EntradaCalculo = {
    quantidade: quantidade > 0 ? quantidade : 1,
    materiais: materiais.map((m) => ({
      descricao: m.nome,
      quantidade: num(m.porUnidade) * quantidade,
      unidade: m.unidade,
      custoUnitario: Math.max(0, num(m.custoUnitario)),
      perdaPct: m.semFicha ? 0 : perda,
    })),
    processos:
      e.maquina && horas > 0
        ? [
            {
              descricao: e.maquina.nome,
              horas,
              custoHora: Math.max(0, num(e.maquina.custoHora)),
              setupMin: Math.max(0, num(e.maquina.setupMin)),
              potenciaKw: Math.max(0, num(e.maquina.potenciaKw)),
              tarifaKwh: Math.max(0, num(p.energia_tarifa_kwh)),
            },
          ]
        : [],
    maoDeObra:
      horas > 0
        ? [
            {
              descricao: "Mão de obra",
              horas,
              custoHora: Math.max(0, num(p.mo_custo_hora)),
              encargosPct: encargos,
            },
          ]
        : [],
    outrosCustos: rateio + outros,
    taxasVendaPct: taxas,
    markupPadraoPct: markup,
  };

  const calculo = calcularOrcamento(entrada);

  return {
    calculo,
    quantidade,
    horas,
    markupPct: markup,
    taxasVendaPct: taxas,
    perdaPct: perda,
    maoDeObraHora: custoHoraComEncargos(p.mo_custo_hora, encargos),
    rateioAdministrativo: r2(rateio),
    outros: r2(outros),
    custoUnitario: quantidade > 0 ? r2(calculo.custoTotal / quantidade) : 0,
    precoSugeridoUnitario: quantidade > 0 ? r2(calculo.precoFinal / quantidade) : 0,
    avisos,
  };
}

// --------------------------------------------------------------- o produto real

export type MaterialDoCatalogo = {
  id: string;
  nome: string;
  unidade: string | null;
  custo_medio: number | string | null;
  custo_unitario: number | string | null;
};

export type LinhaDaFicha = { material_id: string; quantidade_por_unidade: number | string | null };

export type MaquinaDoCatalogo = {
  id: string;
  nome: string;
  custo_hora: number | string | null;
  potencia_kw: number | string | null;
  setup_min: number | string | null;
};

/**
 * O custo que a casa usa para o material: o médio; sem ele, o da última compra.
 *
 * É a ordem de `custo_cheio_do_produto` e da calculadora do orçamento. Zero
 * volta como zero — e o simulador avisa —, nunca como um valor de reserva.
 */
export function custoDoMaterial(m: Pick<MaterialDoCatalogo, "custo_medio" | "custo_unitario">): number {
  const medio = num(m.custo_medio);
  if (medio > 0) return medio;
  return Math.max(0, num(m.custo_unitario));
}

export type OrigemDoMaterial = "ficha" | "custo_do_produto" | "nenhuma";

/**
 * As linhas de material de um produto do catálogo.
 *
 * A ficha técnica (`produto_materiais`) manda quando existe. Sem ela, o custo
 * digitado no produto é a única estimativa que alguém afirmou — é a mesma
 * regra de `produto_custo_cheio`. Sem os dois, nenhuma linha: zero ali faria a
 * peça parecer de graça.
 */
export function materiaisDoProduto(
  produto: { unidade: string | null; custo_medio: number | string | null },
  ficha: LinhaDaFicha[],
  catalogo: MaterialDoCatalogo[],
  novaChave: () => string,
): { linhas: LinhaDeMaterial[]; origem: OrigemDoMaterial } {
  if (ficha.length > 0) {
    const porId = new Map(catalogo.map((m) => [m.id, m]));
    return {
      origem: "ficha",
      linhas: ficha.map((f) => {
        const m = porId.get(f.material_id);
        return {
          chave: novaChave(),
          material_id: f.material_id,
          nome: m?.nome ?? "Material fora do catálogo",
          unidade: m?.unidade ?? "un",
          porUnidade: num(f.quantidade_por_unidade),
          custoUnitario: m ? custoDoMaterial(m) : 0,
        };
      }),
    };
  }
  const custo = num(produto.custo_medio);
  if (custo > 0) {
    return {
      origem: "custo_do_produto",
      linhas: [
        {
          chave: novaChave(),
          material_id: null,
          nome: "Material (custo digitado no produto)",
          unidade: produto.unidade ?? "un",
          porUnidade: 1,
          custoUnitario: custo,
          semFicha: true,
        },
      ],
    };
  }
  return { origem: "nenhuma", linhas: [] };
}

export function maquinaEscolhida(m: MaquinaDoCatalogo | null | undefined): MaquinaEscolhida | null {
  if (!m) return null;
  return {
    id: m.id,
    nome: m.nome,
    custoHora: Math.max(0, num(m.custo_hora)),
    potenciaKw: Math.max(0, num(m.potencia_kw)),
    setupMin: Math.max(0, num(m.setup_min)),
  };
}

// ------------------------------------------------------- comparar com a tabela

export type PrecoDeTabela =
  | { tem: true; unitario: number; origem: "faixa" | "preco_base"; aPartirDe?: number }
  | { tem: false; motivo: string };

/**
 * O preço que a casa cobra hoje por esta quantidade.
 *
 * A faixa de quantidade manda quando a quantidade já alcançou uma; abaixo da
 * primeira faixa, vale o preço base, se houver. Sem nenhum dos dois, a tela
 * diz por quê, em vez de comparar com zero.
 */
export function precoDeTabela(
  produto: { preco_base: number | string | null; unidade?: string | null } | null,
  faixas: FaixaPreco[],
  quantidade: number,
  hoje = new Date(),
): PrecoDeTabela {
  if (!produto) return { tem: false, motivo: "Escolha um produto para comparar com o preço de tabela." };
  const vigentes = faixasVigentes(faixas, hoje);
  const faixa = faixaAplicada(vigentes, quantidade, hoje);
  if (faixa) {
    return {
      tem: true,
      unitario: num(faixa.preco_unitario),
      origem: "faixa",
      aPartirDe: num(faixa.quantidade_minima),
    };
  }
  const base = num(produto.preco_base);
  if (base > 0) return { tem: true, unitario: base, origem: "preco_base" };
  if (vigentes.length > 0) {
    return {
      tem: false,
      motivo: `O produto é vendido por faixa e a menor começa em ${vigentes[0].quantidade_minima} ${produto.unidade ?? "un"}.`,
    };
  }
  return { tem: false, motivo: "O produto não tem preço de tabela cadastrado." };
}

/** Lucro e margem de um preço qualquer, com as taxas sobre o próprio preço. */
export function margemNoPreco(precoTotal: number, custoTotal: number, taxasVendaPct: number) {
  const preco = num(precoTotal);
  const taxas = preco * num(taxasVendaPct);
  const lucro = preco - num(custoTotal) - taxas;
  return { taxas: r2(taxas), lucro: r2(lucro), margemPct: preco > 0 ? lucro / preco : 0 };
}

/**
 * Preço que entrega a margem mínima do produto (em %, como está no cadastro).
 * `null` quando margem + taxas passam de 100%: não existe preço que dê isso.
 */
export function precoDaMargemMinima(
  custoTotal: number,
  margemMinimaPct: number,
  taxasVendaPct: number,
): number | null {
  try {
    return precoParaMargem(num(custoTotal), num(margemMinimaPct) / 100, num(taxasVendaPct));
  } catch {
    return null;
  }
}

/**
 * A memória da linha para a tela: "10,5 m2 × R$ 16,23 + 13% de perda e falha".
 * O texto do motor (`detalhe`) imprime o número cru (4.166666 h), por isso a
 * tela usa este.
 */
export function descreverLinhaDeMaterial(l: LinhaDeMaterial, quantidade: number, perdaPct: number): string {
  const consumo = num(l.porUnidade) * Math.max(0, num(quantidade));
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const perda = !l.semFicha && perdaPct > 0 ? ` + ${Math.round(perdaPct * 100)}% de perda e falha` : "";
  return `${fmt(consumo)} ${l.unidade} × ${brl(num(l.custoUnitario))}${perda}`;
}
