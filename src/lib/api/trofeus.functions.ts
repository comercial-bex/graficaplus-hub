import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ErroDoTrofeu, LIMITES_DO_MULTIPLICADOR_MANUAL, type Decoracao, type LinhaDoTrofeu, type ModeloDeTrofeu, type TipoDeArte } from "@/domain/trofeus/conta";
import { montarFicha, type FichaDoTrofeu } from "@/domain/trofeus/ficha";
import { PRECO_MUDOU_TROFEU } from "@/domain/trofeus/tela";
import {
  cotacaoComCusto,
  cotacaoPublica,
  cotarTrofeuComABase,
  type BaseDaCotacao,
  type CotacaoDoTrofeu,
  type CotacaoComCustoDoTrofeu,
  type CotacaoPublicaDoTrofeu,
  type EntradaDaCotacao,
  type LinhaDasRegras,
  type LinhaDeCusto,
  type LinhaDeMaoDeObra,
  type LinhaDeMaquina,
  type LinhaDeMaterial,
  type LinhaDaPeca,
  type LinhaDoModelo,
} from "@/domain/trofeus/cotacao";

/**
 * O PREÇO DO TROFÉU DE ACRÍLICO calculado NO SERVIDOR (22/11/2026), no mesmo molde da peça 3D
 * (`orcamento-3d.functions.ts`): o vendedor manda o que escolhe (modelo, altura, quantidade, urgência, arte) e
 * recebe só o preço. O custo do acrílico, a hora do laser, a mão de obra e o multiplicador são lidos aqui, com a
 * chave de serviço, e NUNCA descem ao navegador de quem não vê custo. Quem tem `financeiro.read` recebe também a
 * decomposição (custo cheio, custo de produção, multiplicador, margem).
 *
 * Regras que os testes travam (`tests/trofeus-no-servidor.test.ts`):
 *   * a entrada é estrita: preço, custo, multiplicador, taxa ou margem vindos do navegador são RECUSADOS;
 *   * a permissão é conferida ANTES de qualquer leitura com a chave de serviço;
 *   * cadastro que falta ou consulta que falha vira ERRO em português, nunca preço com número de fábrica;
 *   * a resposta de quem não vê custo é montada por lista explícita de campos (`cotacaoPublica`).
 *
 * `salvarTrofeuNoOrcamento` recalcula aqui (a mesma conta) e grava pela RPC `salvar_trofeu_no_orcamento` com o cliente
 * do PRÓPRIO usuário (a função do banco confere `orcamentos.create` por `auth.uid()`). O navegador não manda preço nem
 * custo por este caminho: manda o que escolheu e, no máximo, o total que viu, que só é comparado.
 *
 * O MULTIPLICADOR À MÃO (o simulador do financeiro, etapa 3): só quem tem `financeiro.read` pode mandar
 * `multiplicadorManual`; abaixo do piso (×2,2) só `gestor` ou `admin` (o aval), e o uso fica no `logs_auditoria`. O
 * vendedor não tem como mexer no multiplicador. Um troféu gravado com preço ajustado só é editado por quem vê custo.
 *
 * `dadosDoTrofeu`, `escadaDoTrofeu` e `lerTrofeuGravado` alimentam a tela: modelos com o "a partir de", o preço por
 * quantidade e a reabertura de um troféu já gravado. Todas devolvem só preço e escolhas, nunca custo.
 */

/** Quem cota hoje o 3D (admin, gestor, vendedor): qualquer uma destas basta. */
const PERMISSOES_QUE_COTAM = ["orcamentos.create", "orcamentos.update"] as const;
/** A mesma chave que a RLS de `trofeu_regras` pede para ler os multiplicadores. */
const PERMISSAO_DE_VER_CUSTO = "financeiro.read";

const SEM_PERMISSAO = "Seu perfil não cota troféus.";
const FALHA_GENERICA = "Não consegui calcular o preço agora. Tente de novo; se continuar, avise a gerência.";
const SEM_MODELO = "Modelo de troféu não encontrado ou desativado. Escolha outro.";
const SEM_REGRAS = "As regras de preço do troféu não estão cadastradas. Avise a gerência.";
const MODELO_SEM_PECAS = "O modelo escolhido não tem peças cadastradas. Avise a gerência.";
const PRECO_MUDOU = PRECO_MUDOU_TROFEU;
const SO_QUEM_VE_CUSTO = "Só quem vê custo ajusta o multiplicador do troféu.";
const SO_GESTOR_ABAIXO_DO_PISO = "Preço abaixo do piso da casa: só o gestor dá esse aval.";
const PRECO_AJUSTADO = "Este troféu tem preço ajustado por quem vê custo: só eles alteram.";
const NAO_E_TROFEU = "Este item não é um troféu do orçamento.";

// ---------------------------------------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------------------------------------

/** O que o vendedor digita. Nada de taxa: qualquer outra chave é recusada (`.strict()`). */
const camposDaCotacao = {
  modeloId: z.string().uuid(),
  alturaCm: z.number().finite().min(1).max(200),
  quantidade: z.number().finite().int().min(1).max(100000),
  urgente: z.boolean().default(false),
  arte: z
    .object({
      tipo: z.enum(["cliente_manda", "adaptar_modelo", "criacao_exclusiva"]),
      alteracoesExtras: z.number().finite().int().min(0).max(100).default(0),
      nomesIndividuais: z.number().finite().int().min(0).max(100000).default(0),
    })
    .strict()
    .nullable()
    .default(null),
  /** O simulador de quem vê custo. O servidor recusa de quem não vê, e abaixo do piso só de gestor ou admin. */
  multiplicadorManual: z
    .number()
    .finite()
    .min(LIMITES_DO_MULTIPLICADOR_MANUAL.min)
    .max(LIMITES_DO_MULTIPLICADOR_MANUAL.max)
    .nullable()
    .default(null),
};

const entradaDaCotacao = z.object(camposDaCotacao).strict();

const entradaDoSalvar = z
  .object({
    ...camposDaCotacao,
    orcamentoId: z.string().uuid(),
    /** Editar um troféu já gravado neste orçamento; nulo para troféu novo. */
    itemId: z.string().uuid().nullable().default(null),
    /** O total (troféus mais arte) que a tela mostrou. Só é COMPARADO com a conta daqui; nunca é gravado. */
    precoVisto: z.number().finite().nullable().optional(),
  })
  .strict();

export type EntradaDeCotarTrofeu = z.input<typeof entradaDaCotacao>;
export type EntradaDeSalvarTrofeu = z.input<typeof entradaDoSalvar>;

const NOMES_DOS_CAMPOS: Record<string, string> = {
  modeloId: "modelo",
  alturaCm: "altura",
  quantidade: "quantidade",
  urgente: "urgência",
  arte: "arte",
  tipo: "tipo da arte",
  alteracoesExtras: "alterações extras da arte",
  nomesIndividuais: "nomes individuais",
  multiplicadorManual: "multiplicador",
  orcamentoId: "orçamento",
  itemId: "troféu gravado",
  precoVisto: "preço mostrado",
};

const numeroBr = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Traduz o primeiro problema do zod para uma frase curta. Nunca devolve o JSON cru do zod. */
function frasesDoZod(erro: z.ZodError): string {
  const p = erro.issues[0];
  if (!p) return "Confira os dados do troféu.";
  if (p.code === "unrecognized_keys") return `Confira os dados do troféu: campo não aceito (${p.keys.join(", ")}).`;
  const campo = NOMES_DOS_CAMPOS[String(p.path[p.path.length - 1] ?? "")] ?? "campo";
  let regra = "valor inválido";
  if (p.code === "too_small") regra = `deve ser pelo menos ${numeroBr(Number(p.minimum))}`;
  else if (p.code === "too_big") regra = `deve ser no máximo ${numeroBr(Number(p.maximum))}`;
  else if (p.code === "invalid_type") {
    if (p.received === "undefined") regra = "falta preencher";
    else if (p.expected === "integer") regra = "precisa ser um número inteiro";
    else if (p.expected === "number") regra = "precisa ser um número";
    else if (p.expected === "boolean") regra = "precisa ser sim ou não";
    else if (p.expected === "string") regra = "precisa ser um texto";
  } else if (p.code === "invalid_enum_value") regra = "opção desconhecida";
  else if (p.code === "not_finite") regra = "precisa ser um número";
  return `Confira os dados do troféu (${campo}): ${regra}.`;
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
interface Consulta extends PromiseLike<Resposta> {
  select(colunas: string): Consulta;
  eq(coluna: string, valor: unknown): Consulta;
  in(coluna: string, valores: unknown[]): Consulta;
  order(coluna: string): Consulta;
  maybeSingle(): PromiseLike<Resposta>;
}
interface BancoDeLeitura {
  from(tabela: string): Consulta & { insert(linha: Record<string, unknown>): PromiseLike<Resposta> };
}
interface BancoDoUsuario {
  rpc(funcao: string, argumentos: Record<string, unknown>): PromiseLike<Resposta>;
}

async function permissoesDe(usuario: BancoDoUsuario, userId: string) {
  const perguntar = async (permissao: string) => {
    const { data, error } = await usuario.rpc("has_permission", { _user_id: userId, _permission: permissao });
    if (error) {
      console.error("[trofeus] has_permission falhou:", permissao, error.message ?? "");
      throw new Error(FALHA_GENERICA);
    }
    return data === true;
  };
  const respostas = await Promise.all(PERMISSOES_QUE_COTAM.map(perguntar));
  if (!respostas.some(Boolean)) throw new Error(SEM_PERMISSAO);
  return { verCusto: await perguntar(PERMISSAO_DE_VER_CUSTO) };
}

/** Gestor ou admin: quem pode dar o aval de um preço abaixo do piso. Só se pergunta a quem já vê custo. */
async function podeDarAval(usuario: BancoDoUsuario, userId: string): Promise<boolean> {
  for (const papel of ["gestor", "admin"]) {
    const { data, error } = await usuario.rpc("has_role", { _user_id: userId, _role: papel });
    if (error) {
      console.error("[trofeus] has_role falhou:", papel, error.message ?? "");
      throw new Error(FALHA_GENERICA);
    }
    if (data === true) return true;
  }
  return false;
}

function linhas<T>(r: Resposta): T[] {
  return Array.isArray(r.data) ? (r.data as T[]) : [];
}

const COLUNAS_DO_MODELO = "id, nome, linha, descricao, altura_referencia_m, minutos_de_mao_de_obra, multiplicador_base, ativo, provisorio";
const COLUNAS_DA_PECA = "ordem, nome, material_id, espessura_mm, largura_m, altura_m, quantidade, fator_de_forma, decoracao";
const COLUNAS_DO_MATERIAL = "id, nome, unidade, custo_unitario, custo_medio, estoque";
const COLUNAS_DA_MAQUINA = "nome, tipo, setor, custo_hora, potencia_kw, velocidade_m2_h, velocidade_calculo_m2_h";

/** Lê tudo o que a conta precisa, com a chave de serviço. Só chamar DEPOIS de conferir a permissão. */
async function lerABase(modeloId: string, rotulo: string): Promise<BaseDaCotacao> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as BancoDeLeitura;

  const falha = (tabela: string, e: unknown) => {
    // Só o nome da tabela e a mensagem do banco: nenhuma taxa vai para o registro.
    console.error(`[${rotulo}] falha ao ler ${tabela}:`, e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? ""));
    return new Error(FALHA_GENERICA);
  };

  let primeira: Resposta[];
  try {
    primeira = await Promise.all([
      db.from("trofeu_regras").select("*").eq("unica", true).maybeSingle(),
      db.from("trofeu_modelos").select(COLUNAS_DO_MODELO).eq("id", modeloId).maybeSingle(),
      db.from("trofeu_pecas").select(COLUNAS_DA_PECA).eq("modelo_id", modeloId).order("ordem"),
      db.from("custos_tabela").select("codigo, valor").eq("ativo", true),
      db.from("custos_mao_de_obra").select("funcao, setor, custo_hora, encargos_pct").eq("ativo", true),
      db.from("maquinas").select(COLUNAS_DA_MAQUINA).eq("ativa", true).in("tipo", ["laser_co2", "plotter_impressao"]),
    ]);
  } catch (e) {
    throw falha("as taxas do troféu", e);
  }
  const nomes = ["trofeu_regras", "trofeu_modelos", "trofeu_pecas", "custos_tabela", "custos_mao_de_obra", "maquinas"];
  primeira.forEach((r, i) => {
    if (r.error) throw falha(nomes[i], r.error);
  });
  const [rRegras, rModelo, rPecas, rCustos, rMao, rMaquinas] = primeira;

  const regras = rRegras.data as LinhaDasRegras | null;
  const modelo = rModelo.data as LinhaDoModelo | null;
  if (!regras) throw new ErroDoTrofeu(SEM_REGRAS);
  if (!modelo || modelo.ativo !== true) throw new ErroDoTrofeu(SEM_MODELO);
  const pecas = linhas<LinhaDaPeca>(rPecas);
  if (pecas.length === 0) throw new ErroDoTrofeu(MODELO_SEM_PECAS);

  const ids = [
    ...new Set([
      ...pecas.map((p) => p.material_id),
      regras.material_vinil_id,
      regras.material_laminacao_id,
      regras.material_tinta_id,
      regras.material_cola_id,
    ].filter((x): x is string => typeof x === "string")),
  ];
  let rMateriais: Resposta;
  try {
    rMateriais = await db.from("materiais").select(COLUNAS_DO_MATERIAL).in("id", ids);
  } catch (e) {
    throw falha("materiais", e);
  }
  if (rMateriais.error) throw falha("materiais", rMateriais.error);

  return {
    regras,
    modelo,
    pecas,
    materiais: linhas<LinhaDeMaterial>(rMateriais),
    custos: linhas<LinhaDeCusto>(rCustos),
    maoDeObra: linhas<LinhaDeMaoDeObra>(rMao),
    maquinas: linhas<LinhaDeMaquina>(rMaquinas),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Funções do servidor
// ---------------------------------------------------------------------------------------------------------

type EntradaDaConta = {
  modeloId: string;
  alturaCm: number;
  quantidade: number;
  urgente: boolean;
  arte: EntradaDaCotacao["arte"];
  multiplicadorManual: number | null;
};

/** As frases da conta e do cadastro já são para quem usa ("A altura vai de 12 a 40 cm."): passam adiante. */
function traduzir(e: unknown, rotulo: string): Error {
  if (e instanceof ErroDoTrofeu) return new Error(e.message);
  if (e instanceof Error && e.message === FALHA_GENERICA) return e;
  console.error(`[${rotulo}] a conta lançou:`, e instanceof Error ? e.message : "");
  return new Error(FALHA_GENERICA);
}

/** Lê as taxas com a chave de serviço e faz a conta. Só chamar DEPOIS de conferir a permissão. */
async function cotarComAsTaxasDoBanco(data: EntradaDaConta, rotulo: string): Promise<{ base: BaseDaCotacao; cotacao: CotacaoDoTrofeu }> {
  const entrada: EntradaDaCotacao = {
    alturaCm: data.alturaCm,
    quantidade: data.quantidade,
    urgente: data.urgente,
    arte: data.arte,
    multiplicadorManual: data.multiplicadorManual,
  };
  try {
    const base = await lerABase(data.modeloId, rotulo);
    return { base, cotacao: cotarTrofeuComABase(base, entrada) };
  } catch (e) {
    throw traduzir(e, rotulo);
  }
}

async function bancoDeServico(): Promise<BancoDeLeitura> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as BancoDeLeitura;
}

export type CotacaoDoTrofeuComAval = CotacaoComCustoDoTrofeu & {
  /** Quem pediu pode aplicar um multiplicador abaixo do piso (gestor ou admin). O simulador usa para liberar o botão. */
  podeDarAval: boolean;
};

/**
 * O preço de um troféu (e, se pedida, da arte). Sem `financeiro.read`: só preço unitário, total, a arte, o total
 * geral e os avisos do que ainda é estimativa. Com a permissão: o mesmo, a decomposição e se pode dar o aval.
 */
export const cotarTrofeu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDaCotacao, d))
  .handler(async ({ data, context }): Promise<CotacaoPublicaDoTrofeu | CotacaoDoTrofeuComAval> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    const { verCusto } = await permissoesDe(usuario, context.userId);
    if (data.multiplicadorManual != null && !verCusto) throw new Error(SO_QUEM_VE_CUSTO);
    const { cotacao } = await cotarComAsTaxasDoBanco(data, "cotarTrofeu");
    if (!verCusto) return cotacaoPublica(cotacao);
    return { ...cotacaoComCusto(cotacao), podeDarAval: await podeDarAval(usuario, context.userId) };
  });

/** O preço por quantidade: o unitário em cada degrau da escada, na mesma altura. Público, como o preço. */
const entradaDaEscada = z
  .object({
    modeloId: z.string().uuid(),
    alturaCm: camposDaCotacao.alturaCm,
    urgente: z.boolean().default(false),
  })
  .strict();

export type DegrauDaEscada = { aPartirDe: number; precoUnitario: number };

export const escadaDoTrofeu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDaEscada, d))
  .handler(async ({ data, context }): Promise<DegrauDaEscada[]> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    await permissoesDe(usuario, context.userId);
    try {
      const base = await lerABase(data.modeloId, "escadaDoTrofeu");
      const degraus = (Array.isArray(base.regras.faixas) ? (base.regras.faixas as { de?: unknown }[]) : [])
        .map((f) => Number(f.de))
        .filter((n) => Number.isInteger(n) && n > 0);
      return [...new Set(degraus)]
        .sort((a, b) => a - b)
        .map((de) => ({
          aPartirDe: de,
          precoUnitario: cotarTrofeuComABase(base, { alturaCm: data.alturaCm, quantidade: de, urgente: data.urgente, arte: null, multiplicadorManual: null }).resultado
            .precoUnitario,
        }));
    } catch (e) {
      throw traduzir(e, "escadaDoTrofeu");
    }
  });

export type ModeloParaEscolher = {
  id: string;
  nome: string;
  linha: string;
  descricao: string | null;
  alturaDeReferenciaCm: number;
  provisorio: boolean;
  /** O preço de 1 troféu na altura de referência. Nulo quando o cadastro está incompleto: `indisponivel` diz por quê. */
  aPartirDe: number | null;
  indisponivel: string | null;
};

export type DadosDoTrofeu = {
  modelos: ModeloParaEscolher[];
  alturaMinimaCm: number;
  alturaMaximaCm: number;
};

/** Os modelos ativos com o "a partir de", e os limites de altura. Sem custo nem multiplicador. */
export const dadosDoTrofeu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DadosDoTrofeu> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    await permissoesDe(usuario, context.userId);
    const db = await bancoDeServico();
    let rModelos: Resposta;
    let rRegras: Resposta;
    try {
      [rModelos, rRegras] = await Promise.all([
        db.from("trofeu_modelos").select("id").eq("ativo", true).order("nome"),
        db.from("trofeu_regras").select("altura_minima_m, altura_maxima_m").eq("unica", true).maybeSingle(),
      ]);
    } catch (e) {
      console.error("[dadosDoTrofeu] leitura lançou:", e instanceof Error ? e.message : "");
      throw new Error(FALHA_GENERICA);
    }
    if (rModelos.error || rRegras.error) {
      console.error("[dadosDoTrofeu] falha ao ler:", rModelos.error?.message ?? rRegras.error?.message ?? "");
      throw new Error(FALHA_GENERICA);
    }
    const limites = rRegras.data as { altura_minima_m?: unknown; altura_maxima_m?: unknown } | null;
    if (!limites) throw new Error(SEM_REGRAS);
    const minimo = Number(limites.altura_minima_m);
    const maximo = Number(limites.altura_maxima_m);
    if (!(minimo > 0) || !(maximo >= minimo)) throw new Error(SEM_REGRAS);

    const ids = linhas<{ id: string }>(rModelos).map((m) => m.id);
    const modelos = await Promise.all(
      ids.map(async (id): Promise<ModeloParaEscolher> => {
        try {
          const base = await lerABase(id, "dadosDoTrofeu");
          const referenciaM = Number(base.modelo.altura_referencia_m);
          const cotacao = cotarTrofeuComABase(base, {
            alturaCm: referenciaM * 100,
            quantidade: 1,
            urgente: false,
            arte: null,
            multiplicadorManual: null,
          });
          return {
            id,
            nome: base.modelo.nome,
            linha: String(base.modelo.linha),
            descricao: typeof base.modelo.descricao === "string" ? base.modelo.descricao : null,
            alturaDeReferenciaCm: Math.round(referenciaM * 1000) / 10,
            provisorio: base.modelo.provisorio === true,
            aPartirDe: cotacao.resultado.precoUnitario,
            indisponivel: null,
          };
        } catch (e) {
          const frase = traduzir(e, "dadosDoTrofeu").message;
          return {
            id,
            nome: "Modelo de troféu",
            linha: "",
            descricao: null,
            alturaDeReferenciaCm: 0,
            provisorio: true,
            aPartirDe: null,
            indisponivel: frase,
          };
        }
      }),
    );
    return { modelos, alturaMinimaCm: Math.round(minimo * 1000) / 10, alturaMaximaCm: Math.round(maximo * 1000) / 10 };
  });

export type TrofeuGravado = {
  orcamentoId: string;
  itemId: string;
  arteItemIds: string[];
  valorUnitario: number;
  valorTotal: number;
  valorArte: number;
};

const cm = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

type ItemGravado = { id: string; orcamento_id: string; quantidade: unknown; origem_calculo: string | null; parametros: unknown };

async function lerItemGravado(itemId: string, rotulo: string): Promise<ItemGravado | null> {
  const db = await bancoDeServico();
  let r: Resposta;
  try {
    r = await db.from("orcamento_itens").select("id, orcamento_id, quantidade, origem_calculo, parametros").eq("id", itemId).maybeSingle();
  } catch (e) {
    console.error(`[${rotulo}] leitura do item lançou:`, e instanceof Error ? e.message : "");
    throw new Error(FALHA_GENERICA);
  }
  if (r.error) {
    console.error(`[${rotulo}] falha ao ler orcamento_itens:`, r.error.message ?? "");
    throw new Error(FALHA_GENERICA);
  }
  return (r.data as ItemGravado | null) ?? null;
}

const objeto = (v: unknown): Record<string, unknown> => (v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numeroOuNulo = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Grava o troféu e as linhas de arte no orçamento: recalcula aqui (a mesma conta da cotação) e chama
 * `salvar_trofeu_no_orcamento` com o cliente do PRÓPRIO usuário. Devolve só o que foi gravado (preço), nunca custo.
 */
export const salvarTrofeuNoOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDoSalvar, d))
  .handler(async ({ data, context }): Promise<TrofeuGravado> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    const { verCusto } = await permissoesDe(usuario, context.userId);
    if (data.multiplicadorManual != null && !verCusto) throw new Error(SO_QUEM_VE_CUSTO);

    const { base, cotacao } = await cotarComAsTaxasDoBanco(data, "salvarTrofeuNoOrcamento");
    const publica = cotacaoPublica(cotacao);
    const r = cotacao.resultado;

    // O aval: preço abaixo do piso só passa com gestor ou admin. Só se pergunta quando a conta precisa.
    if (r.abaixoDoPiso && !(await podeDarAval(usuario, context.userId))) throw new Error(SO_GESTOR_ABAIXO_DO_PISO);

    // Editar um troféu que alguém com custo ajustou: quem não vê custo não o sobrescreve com o preço da escada.
    if (data.itemId) {
      const antes = await lerItemGravado(data.itemId, "salvarTrofeuNoOrcamento");
      if (antes && numeroOuNulo(objeto(antes.parametros).multiplicador_manual) != null && !verCusto) throw new Error(PRECO_AJUSTADO);
    }

    if (data.precoVisto != null && Math.abs(publica.totalGeral - data.precoVisto) > 0.005) throw new Error(PRECO_MUDOU);

    const descricao = `${cotacao.modelo.nome} ${cm(data.alturaCm)} cm`;
    const especificacao = [`Altura ${cm(data.alturaCm)} cm`, `${r.pecas} peças em acrílico`, data.urgente ? "Prazo de urgência" : null]
      .filter((x): x is string => x != null)
      .join(" · ");
    // Sem custo nem margem aqui: `parametros` não é lido pelo vendedor, mas o que não existe não vaza. O multiplicador
    // só entra quando alguém com custo o escolheu à mão (e o aval, quando ficou abaixo do piso).
    const parametros = {
      origem: "trofeu",
      altura_cm: data.alturaCm,
      urgente: data.urgente,
      arte: data.arte ? { tipo: data.arte.tipo, alteracoes_extras: data.arte.alteracoesExtras, nomes_individuais: data.arte.nomesIndividuais } : null,
      ...(r.multiplicadorManual ? { multiplicador_manual: r.multiplicador, ...(r.abaixoDoPiso ? { aval_de: context.userId } : {}) } : {}),
    };
    const arte = (cotacao.arte?.linhas ?? []).map((l) => ({ descricao: l.descricao, valor: l.valor, custo: l.custo }));

    // Cliente do usuário, NÃO a chave de serviço: a RPC confere `orcamentos.create` por auth.uid().
    const { data: gravado, error } = await usuario.rpc("salvar_trofeu_no_orcamento", {
      p_orcamento_id: data.orcamentoId,
      p_item_id: data.itemId,
      p_modelo_id: data.modeloId,
      p_descricao: descricao,
      p_quantidade: data.quantidade,
      p_valor_unitario: r.precoUnitario,
      p_custo_unitario: r.custoCheio,
      p_especificacao: especificacao,
      p_parametros: parametros,
      p_arte: arte,
    });
    // As mensagens da RPC já são frases para quem usa ("Este orçamento já virou OS..."): passam adiante.
    if (error) throw new Error(error.message || "Não consegui salvar o troféu. Tente de novo.");

    const g = (gravado ?? {}) as Record<string, unknown>;
    if (typeof g.item_id !== "string" || !Array.isArray(g.arte_item_ids)) {
      throw new Error("O banco não confirmou a gravação do troféu. Confira o orçamento antes de tentar de novo.");
    }

    // O registro do preço ajustado à mão (e do aval). A gravação já aconteceu: se o registro falhar, não desfaz o
    // orçamento, mas o erro vai para o log do servidor para alguém ver.
    if (r.multiplicadorManual) await registrarPrecoAjustado({ base, data, cotacao, userId: context.userId, itemId: g.item_id });

    return {
      orcamentoId: typeof g.orcamento_id === "string" ? g.orcamento_id : data.orcamentoId,
      itemId: g.item_id,
      arteItemIds: g.arte_item_ids.filter((x): x is string => typeof x === "string"),
      valorUnitario: Number(g.valor_unitario),
      valorTotal: Number(g.valor_total),
      valorArte: Number(g.valor_arte ?? 0),
    };
  });

async function registrarPrecoAjustado(a: {
  base: BaseDaCotacao;
  data: EntradaDaConta & { orcamentoId: string };
  cotacao: CotacaoDoTrofeu;
  userId: string;
  itemId: string;
}) {
  try {
    const padrao = cotarTrofeuComABase(a.base, {
      alturaCm: a.data.alturaCm,
      quantidade: a.data.quantidade,
      urgente: a.data.urgente,
      arte: null,
      multiplicadorManual: null,
    }).resultado;
    const db = await bancoDeServico();
    const { error } = await db.from("logs_auditoria").insert({
      usuario_id: a.userId,
      entidade: "orcamento_itens",
      entidade_id: a.itemId,
      acao: "trofeu_multiplicador_manual",
      detalhes: {
        orcamento_id: a.data.orcamentoId,
        modelo_id: a.data.modeloId,
        quantidade: a.data.quantidade,
        multiplicador_aplicado: a.cotacao.resultado.multiplicador,
        multiplicador_da_escada: padrao.multiplicador,
        piso: a.cotacao.pisoDoMultiplicador,
        abaixo_do_piso: a.cotacao.resultado.abaixoDoPiso,
        preco_unitario_gravado: a.cotacao.resultado.precoUnitario,
        preco_unitario_da_escada: padrao.precoUnitario,
      },
    });
    if (error) console.error("[salvarTrofeuNoOrcamento] o registro do preço ajustado falhou:", error.message ?? "");
  } catch (e) {
    console.error("[salvarTrofeuNoOrcamento] o registro do preço ajustado lançou:", e instanceof Error ? e.message : "");
  }
}

// ---------------------------------------------------------------------------------------------------------
// Reabrir um troféu já gravado
// ---------------------------------------------------------------------------------------------------------

const entradaDoGravado = z.object({ itemId: z.string().uuid() }).strict();

export type TrofeuParaEditar = {
  itemId: string;
  orcamentoId: string;
  modeloId: string;
  alturaCm: number;
  quantidade: number;
  urgente: boolean;
  arte: { tipo: "cliente_manda" | "adaptar_modelo" | "criacao_exclusiva"; alteracoesExtras: number; nomesIndividuais: number } | null;
  /** O preço foi ajustado à mão por quem vê custo. */
  precoAjustado: boolean;
  /** O multiplicador escolhido: só quem vê custo o recebe. */
  multiplicadorManual: number | null;
  /** Quem pediu pode alterar: o vendedor não altera um preço que o gestor ajustou. */
  podeEditar: boolean;
};

const TIPOS_DE_ARTE = ["cliente_manda", "adaptar_modelo", "criacao_exclusiva"] as const;

/** As escolhas de um troféu gravado, para reabrir a calculadora. `parametros` não é legível pelo navegador: sai por aqui. */
export const lerTrofeuGravado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDoGravado, d))
  .handler(async ({ data, context }): Promise<TrofeuParaEditar> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    const { verCusto } = await permissoesDe(usuario, context.userId);
    const item = await lerItemGravado(data.itemId, "lerTrofeuGravado");
    if (!item || item.origem_calculo !== "trofeu") throw new Error(NAO_E_TROFEU);

    const p = objeto(item.parametros);
    const modeloId = typeof p.modelo_id === "string" ? p.modelo_id : null;
    const alturaCm = numeroOuNulo(p.altura_cm);
    const quantidade = numeroOuNulo(item.quantidade) ?? Number(item.quantidade);
    if (!modeloId || alturaCm == null || !Number.isInteger(quantidade) || quantidade < 1) {
      throw new Error("Este troféu foi gravado sem as escolhas. Refaça o troféu no orçamento.");
    }
    const a = objeto(p.arte);
    const tipo = TIPOS_DE_ARTE.find((t) => t === a.tipo);
    const manual = numeroOuNulo(p.multiplicador_manual);
    return {
      itemId: item.id,
      orcamentoId: item.orcamento_id,
      modeloId,
      alturaCm,
      quantidade,
      urgente: p.urgente === true,
      arte: tipo
        ? { tipo, alteracoesExtras: numeroOuNulo(a.alteracoes_extras) ?? 0, nomesIndividuais: numeroOuNulo(a.nomes_individuais) ?? 0 }
        : null,
      precoAjustado: manual != null,
      multiplicadorManual: verCusto ? manual : null,
      podeEditar: manual == null || verCusto,
    };
  });

// ---------------------------------------------------------------------------------------------------------
// A ficha de produção do troféu na OS (etapa 4)
// ---------------------------------------------------------------------------------------------------------

const entradaDaFicha = z.object({ osId: z.string().uuid() }).strict();

const SEM_PERMISSAO_DA_OS = "Seu perfil não abre a OS.";

type ItemDaOs = { id: string; descricao: string | null; quantidade: unknown; parametros: unknown; ordem?: unknown };

const DECORACOES_DA_FICHA: readonly Decoracao[] = ["nenhuma", "vinil_laminado", "gravacao_laser"];
const LINHAS_DA_FICHA: readonly LinhaDoTrofeu[] = ["economico", "padrao", "premium"];

/**
 * O que a produção precisa de cada troféu da OS: peças, material, espessura, medida na altura escolhida, quantidade no
 * pedido, decoração, a arte e o tempo de laser. SEM preço nem custo: o operador não os vê, e a lista de campos é a da
 * ficha (`montarFicha`). O navegador não lê `itens_os.parametros` (sem GRANT), então a leitura é daqui, com a chave de
 * serviço, depois de conferir `os.read`. Devolve lista vazia quando a OS não tem troféu.
 */
export const fichaDoTrofeuDaOs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDaFicha, d))
  .handler(async ({ data, context }): Promise<FichaDoTrofeu[]> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    const { data: pode, error: erroDePermissao } = await usuario.rpc("has_permission", { _user_id: context.userId, _permission: "os.read" });
    if (erroDePermissao) {
      console.error("[fichaDoTrofeuDaOs] has_permission falhou:", erroDePermissao.message ?? "");
      throw new Error("Não consegui abrir a ficha agora. Tente de novo; se continuar, avise a gerência.");
    }
    if (pode !== true) throw new Error(SEM_PERMISSAO_DA_OS);

    const db = await bancoDeServico();
    const falhou = (tabela: string, e: unknown) => {
      console.error(`[fichaDoTrofeuDaOs] falha ao ler ${tabela}:`, e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? ""));
      return new Error("Não consegui abrir a ficha agora. Tente de novo; se continuar, avise a gerência.");
    };
    const ler = async (tabela: string, consulta: PromiseLike<Resposta>): Promise<Resposta> => {
      let r: Resposta;
      try {
        r = await consulta;
      } catch (e) {
        throw falhou(tabela, e);
      }
      if (r.error) throw falhou(tabela, r.error);
      return r;
    };

    const rItens = await ler("itens_os", db.from("itens_os").select("id, descricao, quantidade, parametros, ordem").eq("os_id", data.osId).order("ordem"));
    const trofeus = linhas<ItemDaOs>(rItens).filter((i) => objeto(i.parametros).origem === "trofeu" && typeof objeto(i.parametros).modelo_id === "string");
    if (trofeus.length === 0) return [];

    const modeloIds = [...new Set(trofeus.map((i) => String(objeto(i.parametros).modelo_id)))];
    const [rModelos, rPecas, rRegras] = await Promise.all([
      ler("trofeu_modelos", db.from("trofeu_modelos").select(COLUNAS_DO_MODELO).in("id", modeloIds)),
      ler("trofeu_pecas", db.from("trofeu_pecas").select(`modelo_id, ${COLUNAS_DA_PECA}`).in("modelo_id", modeloIds).order("ordem")),
      ler("trofeu_regras", db.from("trofeu_regras").select("velocidade_de_corte, gravacao_min_por_m2, preparo_do_laser_min, provisorios").eq("unica", true).maybeSingle()),
    ]);
    const pecas = linhas<LinhaDaPeca & { modelo_id: string }>(rPecas);
    const materiaisIds = [...new Set(pecas.map((p) => p.material_id))];
    const rMateriais = await ler("materiais", db.from("materiais").select("id, nome").in("id", materiaisIds));
    const nomes: Record<string, string> = {};
    for (const m of linhas<{ id: string; nome: string }>(rMateriais)) nomes[m.id] = m.nome;

    const regras = (rRegras.data ?? null) as { velocidade_de_corte?: unknown; gravacao_min_por_m2?: unknown; preparo_do_laser_min?: unknown; provisorios?: unknown } | null;
    const velocidades: Record<string, number> = {};
    for (const [mm, v] of Object.entries(objeto(regras?.velocidade_de_corte))) if (typeof v === "number" || typeof v === "string") velocidades[mm] = Number(v);
    const gravacao = Number(regras?.gravacao_min_por_m2 ?? 0);
    const preparo = Number(regras?.preparo_do_laser_min ?? 0);

    const fichas: FichaDoTrofeu[] = [];
    for (const item of trofeus) {
      const p = objeto(item.parametros);
      const modeloLinha = linhas<LinhaDoModelo>(rModelos).find((m) => m.id === p.modelo_id);
      const alturaCm = numeroOuNulo(p.altura_cm);
      const quantidade = Number(item.quantidade);
      const linha = LINHAS_DA_FICHA.find((l) => l === modeloLinha?.linha);
      if (!modeloLinha || !linha || alturaCm == null || !Number.isInteger(quantidade) || quantidade < 1) continue;
      const pecasDoModelo = pecas.filter((x) => x.modelo_id === modeloLinha.id).sort((a, b) => Number(a.ordem) - Number(b.ordem));
      if (pecasDoModelo.length === 0) continue;
      const modelo: ModeloDeTrofeu = {
        id: modeloLinha.id,
        nome: modeloLinha.nome,
        linha,
        alturaDeReferenciaM: Number(modeloLinha.altura_referencia_m),
        minutosDeMaoDeObra: Number(modeloLinha.minutos_de_mao_de_obra ?? 0),
        multiplicadorBase: Number(modeloLinha.multiplicador_base ?? 3),
        pecas: pecasDoModelo.map((x) => ({
          nome: x.nome,
          materialId: x.material_id,
          espessuraMm: Number(x.espessura_mm),
          larguraM: Number(x.largura_m),
          alturaM: Number(x.altura_m),
          quantidade: Number(x.quantidade),
          fatorDeForma: Number(x.fator_de_forma),
          decoracao: DECORACOES_DA_FICHA.find((d) => d === x.decoracao) ?? "nenhuma",
        })),
      };
      if (!(modelo.alturaDeReferenciaM > 0)) continue;
      const a = objeto(p.arte);
      const tipo = TIPOS_DE_ARTE.find((t) => t === a.tipo) as TipoDeArte | undefined;
      fichas.push(
        montarFicha({
          itemId: item.id,
          descricao: item.descricao ?? modelo.nome,
          quantidade,
          alturaCm,
          urgente: p.urgente === true,
          arte: tipo ? { tipo, alteracoesExtras: numeroOuNulo(a.alteracoes_extras) ?? 0, nomesIndividuais: numeroOuNulo(a.nomes_individuais) ?? 0 } : null,
          modelo,
          nomesDosMateriais: nomes,
          velocidadeDeCorteMPorMin: velocidades,
          gravacaoMinPorM2: gravacao,
          preparoDoLaserMin: preparo,
          provisorio: modeloLinha.provisorio === true,
        }),
      );
    }
    return fichas;
  });
