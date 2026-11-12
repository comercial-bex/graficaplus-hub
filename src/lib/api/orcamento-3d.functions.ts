import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  avisosDaCotacao,
  calcularPeca3D,
  cotacaoComCusto,
  cotacaoPublica,
  inputsDoItem3d,
  LIMITES_DA_PECA_3D,
  PRECO_MUDOU_3D,
  resultadosDoItem3d,
  type CotacaoComCusto3D,
  type CotacaoPublica3D,
  type EntradasDaPeca3D,
  type ResultadoDaPeca3D,
} from "@/domain/impressao3d/calcular-peca";
import { descreverFilamento } from "@/domain/impressao3d/arquivos";

/**
 * O preço da peça 3D calculado NO SERVIDOR (onda C da privacidade do custo, 11/11/2026).
 *
 * Antes, a calculadora fazia a conta inteira no navegador e, para isso, lia do banco o custo por grama de
 * cada filamento, o custo por hora de cada impressora e toda a base de preço (mão de obra, markup,
 * percentuais). A tela escondia o número, mas o dado chegava ao navegador de quem não pode ver custo.
 *
 * Agora quem NÃO tem `impressao3d.cost.read` manda só o que digita (peso, tempo, quantidade, impressora,
 * filamento). As taxas são lidas aqui, com a chave de serviço, a conta é a MESMA (`calcularPeca3D`, provada
 * igual à da calculadora de hoje, ao centavo) e volta só o preço. Quem tem a permissão recebe também a
 * decomposição.
 *
 * Regras que os testes travam (`tests/cotacao-3d-no-servidor.test.ts`):
 *   * a entrada é estrita: preço, custo, markup, percentual ou tarifa vindos do navegador são RECUSADOS;
 *   * a permissão é conferida ANTES de qualquer leitura com a chave de serviço;
 *   * custo por hora é `custo_hora_calculado`, nunca `custo_hora_manual` (a calculadora de hoje não lê o manual);
 *   * cadastro que falta ou consulta que falha vira ERRO em português, nunca preço com número de fábrica;
 *   * a resposta de quem não vê custo é montada por lista explícita de campos (`cotacaoPublica`).
 *
 * `salvarPeca3dNoOrcamento` recalcula aqui e grava pela RPC `salvar_item_3d_no_orcamento` com o cliente do
 * PRÓPRIO usuário (a função do banco confere `orcamentos.create` por `auth.uid()`). O navegador não manda
 * preço nem custo por este caminho.
 */

/** Quem abre a calculadora hoje (admin, gestor, vendedor): qualquer uma destas basta para cotar. */
const PERMISSOES_QUE_COTAM = [
  "orcamentos.create",
  "orcamentos.update",
  "impressao3d.quote.create",
  "impressao3d.quote.update",
] as const;
const PERMISSAO_DE_VER_CUSTO = "impressao3d.cost.read";

const SEM_PERMISSAO = "Seu perfil não cota peças 3D.";
const FALHA_GENERICA =
  "Não consegui calcular o preço agora. Tente de novo; se continuar, avise a gerência.";
const SEM_IMPRESSORA = "Impressora não encontrada ou desativada. Escolha outra.";
const SEM_FILAMENTO = "Filamento não encontrado. Escolha outro.";
const SEM_BASE = "A base de preço 3D não está cadastrada. Avise a gerência.";
const BASE_INCOMPLETA = "A base de preço 3D está incompleta. Avise a gerência.";
const CADASTRO_INCOMPLETO =
  "O cadastro da impressora ou do filamento está incompleto. Avise a gerência.";
const SO_COM_CUSTO =
  "Confira os dados da peça: horas de acabamento e embalagem só valem para quem vê o custo.";
const PRECO_MUDOU = PRECO_MUDOU_3D;

/** O que a consulta pede. `custo_hora_manual` fica DE FORA de propósito (ver o topo do arquivo). */
const COLUNAS_DA_IMPRESSORA =
  "maquina_id, custo_hora_calculado, potencia_media_w, ativa, maquinas(nome)";
const COLUNAS_DO_FILAMENTO = "material_id, custo_por_grama_calculado, tipo, cor, materiais(nome)";
const COLUNAS_DA_BASE =
  "tarifa_kwh_padrao, mo_custo_hora_padrao, markup_padrao, markup_atacado_padrao, pct_acabamento_padrao, pct_falha_padrao, custo_admin_padrao";

// ---------------------------------------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------------------------------------

type Limite = (typeof LIMITES_DA_PECA_3D)[keyof typeof LIMITES_DA_PECA_3D];

function numeroNoLimite(l: Limite) {
  let n = z.number().finite();
  if (l.inteiro) n = n.int();
  if (!l.zeroPermitido) return n.min(l.min).max(l.max);
  return n
    .min(0)
    .max(l.max)
    .refine((v) => v === 0 || v >= l.min, { params: { zeroOuMinimo: l.min } });
}

const L = LIMITES_DA_PECA_3D;

/** O que o vendedor digita. Nada de taxa: qualquer outra chave é recusada (`.strict()`). */
const camposDaCotacao = {
  maquinaId: z.string().uuid(),
  materialId: z.string().uuid(),
  gramasModelo: numeroNoLimite(L.gramasModelo),
  pesoSuporteG: numeroNoLimite(L.pesoSuporteG).default(0),
  pesoPurgaG: numeroNoLimite(L.pesoPurgaG).default(0),
  tempoMinutos: numeroNoLimite(L.tempoMinutos),
  quantidade: numeroNoLimite(L.quantidade),
  pecasPorPlaca: numeroNoLimite(L.pecasPorPlaca).default(1),
  /** Horas de pós-processamento POR PEÇA. Opcional: a tela do vendedor hoje não manda (vale zero). */
  moHoras: numeroNoLimite(L.moHoras).default(0),
  /** Embalagem uma vez por item, com o valor da base de preço. Opcional: hoje a tela do vendedor não manda. */
  embalagemIncluida: z.boolean().default(false),
};

const entradaDaCotacao = z.object(camposDaCotacao).strict();

const entradaDoSalvar = z
  .object({
    ...camposDaCotacao,
    orcamentoId: z.string().uuid(),
    /** Editar uma peça já gravada; nulo para peça nova. */
    orcamento3dId: z.string().uuid().nullable(),
    titulo: z.string().trim().min(1).max(200),
    filamentoTipoDetectado: z.string().trim().max(40).nullable().optional(),
    alturaCamadaMm: z.number().finite().min(0).max(10).nullable().optional(),
    infillPct: z.number().finite().min(0).max(100).nullable().optional(),
    /** O print ou o arquivo do fatiador já enviado ao Storage (`caminhoDoArquivo3d("slicer", ...)`). */
    slicerScreenshot: z
      .string()
      .regex(/^orcamentos-3d\/[0-9]+_slicer_[A-Za-z0-9._-]+$/)
      .nullable()
      .optional(),
    fotoArquivoId: z.string().uuid().nullable().optional(),
    clienteId: z.string().uuid().nullable().optional(),
    /** O preço que a tela mostrou. Só é COMPARADO com a conta daqui; nunca é gravado. */
    precoVisto: z.number().finite().nullable().optional(),
  })
  .strict();

export type EntradaDaCotacao3D = z.input<typeof entradaDaCotacao>;
export type EntradaDoSalvarPeca3D = z.input<typeof entradaDoSalvar>;

const NOMES_DOS_CAMPOS: Record<string, string> = {
  maquinaId: "impressora",
  materialId: "filamento",
  gramasModelo: "peso do modelo",
  pesoSuporteG: "peso do suporte",
  pesoPurgaG: "peso da purga",
  tempoMinutos: "tempo de impressão",
  quantidade: "quantidade",
  pecasPorPlaca: "peças por placa",
  moHoras: "horas de acabamento por peça",
  embalagemIncluida: "embalagem",
  orcamentoId: "orçamento",
  orcamento3dId: "peça gravada",
  titulo: "título",
  filamentoTipoDetectado: "tipo de filamento",
  alturaCamadaMm: "altura da camada",
  infillPct: "preenchimento",
  slicerScreenshot: "arquivo do fatiador",
  fotoArquivoId: "foto do modelo",
  clienteId: "cliente",
  precoVisto: "preço mostrado",
};

const numeroBr = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * Traduz o primeiro problema do zod para uma frase curta: "Confira os dados da peça (quantidade): precisa ser
 * um número inteiro." Nunca devolve o JSON cru do zod.
 */
function frasesDoZod(erro: z.ZodError): string {
  const p = erro.issues[0];
  if (!p) return "Confira os dados da peça.";
  if (p.code === "unrecognized_keys") {
    return `Confira os dados da peça: campo não aceito (${p.keys.join(", ")}).`;
  }
  const campo = NOMES_DOS_CAMPOS[String(p.path[0] ?? "")] ?? "campo";
  let regra = "valor inválido";
  if (p.code === "too_small") {
    regra =
      p.type === "string"
        ? "falta preencher"
        : `deve ser pelo menos ${numeroBr(Number(p.minimum))}`;
  } else if (p.code === "too_big") {
    regra =
      p.type === "string"
        ? "texto longo demais"
        : `deve ser no máximo ${numeroBr(Number(p.maximum))}`;
  } else if (p.code === "invalid_type") {
    if (p.received === "undefined") regra = "falta preencher";
    else if (p.expected === "integer") regra = "precisa ser um número inteiro";
    else if (p.expected === "number") regra = "precisa ser um número";
    else if (p.expected === "boolean") regra = "precisa ser sim ou não";
    else if (p.expected === "string") regra = "precisa ser um texto";
  } else if (p.code === "not_finite") regra = "precisa ser um número";
  else if (p.code === "custom" && typeof p.params?.zeroOuMinimo === "number") {
    regra = `deve ser zero ou pelo menos ${numeroBr(p.params.zeroOuMinimo)}`;
  }
  return `Confira os dados da peça (${campo}): ${regra}.`;
}

function validar<T extends z.ZodTypeAny>(esquema: T, d: unknown): z.output<T> {
  const r = esquema.safeParse(d);
  if (!r.success) throw new Error(frasesDoZod(r.error));
  return r.data;
}

// ---------------------------------------------------------------------------------------------------------
// Banco (tipos mínimos: só o que esta função usa)
// ---------------------------------------------------------------------------------------------------------

type ErroDoBanco = { message?: string } | null;
type Resposta = { data: unknown; error: ErroDoBanco };
interface Consulta {
  select(colunas: string): Consulta;
  eq(coluna: string, valor: unknown): Consulta;
  maybeSingle(): PromiseLike<Resposta>;
}
interface BancoDeLeitura {
  from(tabela: string): Consulta;
}
interface BancoDoUsuario {
  rpc(funcao: string, argumentos: Record<string, unknown>): PromiseLike<Resposta>;
}

type LinhaDaImpressora = {
  custo_hora_calculado?: unknown;
  potencia_media_w?: unknown;
  maquinas?: { nome?: string | null } | null;
};
type LinhaDoFilamento = {
  custo_por_grama_calculado?: unknown;
  tipo?: string | null;
  cor?: string | null;
  materiais?: { nome?: string | null } | null;
};
type LinhaDaBase = Record<string, unknown>;

async function permissoesDe(usuario: BancoDoUsuario, userId: string) {
  const perguntar = async (permissao: string) => {
    const { data, error } = await usuario.rpc("has_permission", {
      _user_id: userId,
      _permission: permissao,
    });
    if (error) {
      console.error("[orcamento-3d] has_permission falhou:", permissao, error.message ?? "");
      throw new Error(FALHA_GENERICA);
    }
    return data === true;
  };
  const respostas = await Promise.all(PERMISSOES_QUE_COTAM.map(perguntar));
  if (!respostas.some(Boolean)) throw new Error(SEM_PERMISSAO);
  return { verCusto: await perguntar(PERMISSAO_DE_VER_CUSTO) };
}

/**
 * Taxa do cadastro da impressora ou do filamento. Nula vale ZERO, como na calculadora de hoje
 * (`Number(x ?? 0)`), e vira aviso (`avisosDaCotacao`); texto que não é número vira ERRO.
 */
function taxaDoCadastro(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "string" && v.trim() === "") throw new Error(CADASTRO_INCOMPLETO);
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(CADASTRO_INCOMPLETO);
  return n;
}

/**
 * Valor da base de preço. Nulo ou não numérico é ERRO: a calculadora de hoje caía nos números de fábrica
 * (0,95; 40; 2; 5; 5) sem avisar ninguém, e é isso que este servidor não faz.
 */
function valorDaBase(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) throw new Error(BASE_INCOMPLETA);
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(BASE_INCOMPLETA);
  return n;
}

type Cotada = {
  entradas: EntradasDaPeca3D;
  resultado: ResultadoDaPeca3D;
  avisos: ReturnType<typeof avisosDaCotacao>;
  impressora: LinhaDaImpressora;
  filamento: LinhaDoFilamento;
};

/**
 * Quem NÃO vê custo não escolhe horas de acabamento nem embalagem: o preço com e sem elas difere por
 * (mão de obra por hora x markup) e (custo administrativo x markup), e duas cotações entregariam essas taxas.
 * A tela do vendedor nunca manda os dois; aqui o servidor recusa o que vier fora do padrão, sem ler taxa.
 */
function exigirSoOQueOVendedorManda(
  d: { moHoras: number; embalagemIncluida: boolean },
  verCusto: boolean,
) {
  if (!verCusto && (d.moHoras !== 0 || d.embalagemIncluida)) throw new Error(SO_COM_CUSTO);
}

/** Lê as taxas com a chave de serviço e faz a conta. Só chamar DEPOIS de conferir a permissão. */
async function cotarComAsTaxasDoBanco(
  d: z.output<typeof entradaDaCotacao>,
  rotulo: string,
): Promise<Cotada> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as BancoDeLeitura;

  let respostas: [Resposta, Resposta, Resposta];
  try {
    respostas = await Promise.all([
      db.from("config_precificacao_3d").select(COLUNAS_DA_BASE).eq("id", true).maybeSingle(),
      db
        .from("maquinas_3d_config")
        .select(COLUNAS_DA_IMPRESSORA)
        .eq("maquina_id", d.maquinaId)
        .eq("ativa", true)
        .maybeSingle(),
      db
        .from("materiais_3d_filamento")
        .select(COLUNAS_DO_FILAMENTO)
        .eq("material_id", d.materialId)
        .maybeSingle(),
    ]);
  } catch (e) {
    console.error(`[${rotulo}] leitura das taxas lançou:`, e instanceof Error ? e.message : "");
    throw new Error(FALHA_GENERICA);
  }
  const [base, maquina, filamento] = respostas;
  for (const [tabela, r] of [
    ["config_precificacao_3d", base],
    ["maquinas_3d_config", maquina],
    ["materiais_3d_filamento", filamento],
  ] as const) {
    if (r.error) {
      // Só o nome da tabela e a mensagem do banco: nenhuma taxa vai para o registro.
      console.error(`[${rotulo}] falha ao ler ${tabela}:`, r.error.message ?? "");
      throw new Error(FALHA_GENERICA);
    }
  }
  const impressora = maquina.data as LinhaDaImpressora | null;
  const fil = filamento.data as LinhaDoFilamento | null;
  const cfg = base.data as LinhaDaBase | null;
  if (!impressora) throw new Error(SEM_IMPRESSORA);
  if (!fil) throw new Error(SEM_FILAMENTO);
  if (!cfg) throw new Error(SEM_BASE);

  const custoHoraMaquina = taxaDoCadastro(impressora.custo_hora_calculado);
  const potenciaW = taxaDoCadastro(impressora.potencia_media_w);
  const custoPorGrama = taxaDoCadastro(fil.custo_por_grama_calculado);
  const entradas: EntradasDaPeca3D = {
    gramasModelo: d.gramasModelo,
    pesoSuporteG: d.pesoSuporteG,
    pesoPurgaG: d.pesoPurgaG,
    tempoMinutos: d.tempoMinutos,
    quantidade: d.quantidade,
    pecasPorPlaca: d.pecasPorPlaca,
    moHoras: d.moHoras,
    embalagemIncluida: d.embalagemIncluida,
    custoPorGrama,
    custoHoraMaquina,
    potenciaW,
    tarifaKwh: valorDaBase(cfg.tarifa_kwh_padrao),
    moCustoHora: valorDaBase(cfg.mo_custo_hora_padrao),
    // Só pesa com a embalagem ligada; desligada, a base pode não ter o valor.
    embalagemValor: d.embalagemIncluida ? valorDaBase(cfg.custo_admin_padrao) : 0,
    pctAcabamento: valorDaBase(cfg.pct_acabamento_padrao),
    pctFalha: valorDaBase(cfg.pct_falha_padrao),
    markup: valorDaBase(cfg.markup_padrao),
    // Só entra no preço de atacado de quem vê custo; nulo cai no 1,5 da calculadora de hoje, que a
    // decomposição devolve à vista (`markupAtacado`).
    markupAtacado: Number(cfg.markup_atacado_padrao ?? 1.5),
  };

  let resultado: ResultadoDaPeca3D;
  try {
    resultado = calcularPeca3D(entradas);
  } catch (e) {
    console.error(`[${rotulo}] a conta lançou:`, e instanceof Error ? e.message : "");
    throw new Error(FALHA_GENERICA);
  }
  return {
    entradas,
    resultado,
    avisos: avisosDaCotacao({ custoHoraMaquina, potenciaW, custoPorGrama }),
    impressora,
    filamento: fil,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Funções do servidor
// ---------------------------------------------------------------------------------------------------------

/**
 * O preço de uma peça 3D. Sem `impressao3d.cost.read`: só preço, unitário, quantidade, placas, peças por
 * placa, se o piso por peça valeu e os avisos de cadastro zerado. Com a permissão: o mesmo e a decomposição.
 */
export const cotarPeca3d = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDaCotacao, d))
  .handler(async ({ data, context }): Promise<CotacaoPublica3D | CotacaoComCusto3D> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    const { verCusto } = await permissoesDe(usuario, context.userId);
    exigirSoOQueOVendedorManda(data, verCusto);
    const c = await cotarComAsTaxasDoBanco(data, "cotarPeca3d");
    return verCusto
      ? cotacaoComCusto(c.resultado, c.avisos)
      : cotacaoPublica(c.resultado, c.avisos);
  });

export type PecaGravada3D = {
  orcamentoId: string;
  orcamento3dId: string;
  itemId: string;
  valorUnitario: number;
  valorTotal: number;
};

/**
 * Grava a peça no orçamento: recalcula aqui (a mesma conta da cotação) e chama `salvar_item_3d_no_orcamento`
 * com o cliente do PRÓPRIO usuário, no formato que a calculadora grava hoje. Devolve só o preço gravado.
 */
export const salvarPeca3dNoOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDoSalvar, d))
  .handler(async ({ data, context }): Promise<PecaGravada3D> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    const { verCusto } = await permissoesDe(usuario, context.userId);
    exigirSoOQueOVendedorManda(data, verCusto);
    const {
      entradas,
      resultado: r,
      impressora,
      filamento,
    } = await cotarComAsTaxasDoBanco(data, "salvarPeca3dNoOrcamento");

    if (data.precoVisto != null && Math.abs(r.preco.toNumber() - data.precoVisto) > 0.005) {
      throw new Error(PRECO_MUDOU);
    }

    const inputs = inputsDoItem3d(entradas, r, {
      clienteId: data.clienteId ?? null,
      filamentoTipoDetectado: data.filamentoTipoDetectado || null,
      alturaCamadaMm: data.alturaCamadaMm ?? null,
      infillPct: data.infillPct ?? null,
      slicerScreenshot: data.slicerScreenshot ?? null,
      impressora: impressora.maquinas?.nome ?? null,
      filamento: filamento.materiais?.nome ?? null,
    });
    const resultados = resultadosDoItem3d(entradas, r);
    const descricao = descreverFilamento({ tipo: filamento.tipo, cor: filamento.cor });
    const tempoSegundos = Math.round(r.horasTotais * 3600);

    // Cliente do usuário, NÃO a chave de serviço: a RPC confere `orcamentos.create` por auth.uid().
    const { data: gravado, error } = await usuario.rpc("salvar_item_3d_no_orcamento", {
      p_orcamento_id: data.orcamentoId,
      p_orcamento_3d_id: data.orcamento3dId,
      p_titulo: data.titulo,
      p_quantidade: r.qtd,
      p_maquina_id: data.maquinaId,
      p_material_id: data.materialId,
      p_gramas: entradas.gramasModelo,
      p_tempo_segundos: tempoSegundos,
      p_custo_por_grama: r.cpg,
      p_inputs: inputs,
      p_resultados: resultados,
      p_custo_material: r.material.toNumber(),
      p_custo_maquina: r.maquina.toNumber(),
      p_custo_energia: r.energia.toNumber(),
      p_custo_mao_obra: r.maoDeObra.toNumber(),
      p_custo_acabamento: r.acabamento.toNumber(),
      p_custo_risco: r.risco.toNumber(),
      p_custo_indireto: r.indireto.toNumber(),
      p_custo_operacional: r.operacional.toNumber(),
      p_preco: r.preco.toNumber(),
      p_markup: entradas.markup,
      p_margem: r.margem.toNumber(),
      p_lucro: r.lucro.toNumber(),
      p_foto_arquivo_id: data.fotoArquivoId ?? null,
      p_material_descricao: descricao,
    });
    // As mensagens da RPC já são frases para quem usa ("Este orçamento já virou OS..."): passam adiante.
    if (error) throw new Error(error.message || "Não consegui salvar a peça. Tente de novo.");

    const g = (gravado ?? {}) as Record<string, unknown>;
    if (typeof g.orcamento_3d_id !== "string" || typeof g.item_id !== "string") {
      throw new Error(
        "O banco não confirmou a gravação da peça. Confira o orçamento antes de tentar de novo.",
      );
    }
    return {
      orcamentoId: typeof g.orcamento_id === "string" ? g.orcamento_id : data.orcamentoId,
      orcamento3dId: g.orcamento_3d_id,
      itemId: g.item_id,
      valorUnitario: Number(g.valor_unitario),
      valorTotal: Number(g.valor_total),
    };
  });
