import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ErroDoTrofeu } from "@/domain/trofeus/conta";
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
 * Ainda NÃO há tela que chame estas funções (a página do orçamento de troféu é a etapa 3).
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
const PRECO_MUDOU = "O preço mudou desde a última conta. Confira o novo valor e salve de novo.";

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
  from(tabela: string): Consulta;
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

function linhas<T>(r: Resposta): T[] {
  return Array.isArray(r.data) ? (r.data as T[]) : [];
}

const COLUNAS_DO_MODELO = "id, nome, linha, altura_referencia_m, minutos_de_mao_de_obra, multiplicador_base, ativo, provisorio";
const COLUNAS_DA_PECA = "ordem, nome, material_id, espessura_mm, largura_m, altura_m, quantidade, fator_de_forma, decoracao";
const COLUNAS_DO_MATERIAL = "id, nome, unidade, custo_unitario, custo_medio";
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
};

/** Lê as taxas com a chave de serviço e faz a conta. Só chamar DEPOIS de conferir a permissão. */
async function cotarComAsTaxasDoBanco(data: EntradaDaConta, rotulo: string): Promise<{ base: BaseDaCotacao; cotacao: CotacaoDoTrofeu }> {
  const entrada: EntradaDaCotacao = { alturaCm: data.alturaCm, quantidade: data.quantidade, urgente: data.urgente, arte: data.arte };
  try {
    const base = await lerABase(data.modeloId, rotulo);
    return { base, cotacao: cotarTrofeuComABase(base, entrada) };
  } catch (e) {
    // As frases da conta e do cadastro já são para quem usa ("A altura vai de 12 a 40 cm."): passam adiante.
    if (e instanceof ErroDoTrofeu) throw new Error(e.message);
    if (e instanceof Error && e.message === FALHA_GENERICA) throw e;
    console.error(`[${rotulo}] a conta lançou:`, e instanceof Error ? e.message : "");
    throw new Error(FALHA_GENERICA);
  }
}

/**
 * O preço de um troféu (e, se pedida, da arte). Sem `financeiro.read`: só preço unitário, total, a arte, o total
 * geral e os avisos do que ainda é estimativa. Com a permissão: o mesmo e a decomposição.
 */
export const cotarTrofeu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDaCotacao, d))
  .handler(async ({ data, context }): Promise<CotacaoPublicaDoTrofeu | CotacaoComCustoDoTrofeu> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    const { verCusto } = await permissoesDe(usuario, context.userId);
    const { cotacao } = await cotarComAsTaxasDoBanco(data, "cotarTrofeu");
    return verCusto ? cotacaoComCusto(cotacao) : cotacaoPublica(cotacao);
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

/**
 * Grava o troféu e as linhas de arte no orçamento: recalcula aqui (a mesma conta da cotação) e chama
 * `salvar_trofeu_no_orcamento` com o cliente do PRÓPRIO usuário. Devolve só o que foi gravado (preço), nunca custo.
 */
export const salvarTrofeuNoOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => validar(entradaDoSalvar, d))
  .handler(async ({ data, context }): Promise<TrofeuGravado> => {
    const usuario = context.supabase as unknown as BancoDoUsuario;
    await permissoesDe(usuario, context.userId);
    const { cotacao } = await cotarComAsTaxasDoBanco(data, "salvarTrofeuNoOrcamento");
    const publica = cotacaoPublica(cotacao);

    if (data.precoVisto != null && Math.abs(publica.totalGeral - data.precoVisto) > 0.005) throw new Error(PRECO_MUDOU);

    const r = cotacao.resultado;
    const descricao = `${cotacao.modelo.nome} ${cm(data.alturaCm)} cm`;
    const especificacao = [`Altura ${cm(data.alturaCm)} cm`, `${r.pecas} peças em acrílico`, data.urgente ? "Prazo de urgência" : null]
      .filter((x): x is string => x != null)
      .join(" · ");
    // Sem custo, multiplicador nem margem aqui: `parametros` não é lido pelo vendedor, mas o que não existe não vaza.
    const parametros = {
      origem: "trofeu",
      altura_cm: data.alturaCm,
      urgente: data.urgente,
      arte: data.arte ? { tipo: data.arte.tipo, alteracoes_extras: data.arte.alteracoesExtras, nomes_individuais: data.arte.nomesIndividuais } : null,
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
    return {
      orcamentoId: typeof g.orcamento_id === "string" ? g.orcamento_id : data.orcamentoId,
      itemId: g.item_id,
      arteItemIds: g.arte_item_ids.filter((x): x is string => typeof x === "string"),
      valorUnitario: Number(g.valor_unitario),
      valorTotal: Number(g.valor_total),
      valorArte: Number(g.valor_arte ?? 0),
    };
  });
