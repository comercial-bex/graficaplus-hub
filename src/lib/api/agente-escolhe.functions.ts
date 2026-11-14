import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hojeBr } from "@/lib/hoje-br";
import { DEGRAUS, ehDegrau, type Degrau } from "@/domain/whatsapp/triagem/escada";
import { lerTodasAsLinhas } from "@/domain/whatsapp/triagem/paginar";
import {
  AVISO_DA_PORCENTAGEM_MAXIMA,
  coberturaDaBase,
  PORCENTAGEM_MAXIMA_EM_PARCIAL,
  podeSubirOAgente,
} from "@/domain/agente/painel";
import { DIAS_DA_JANELA, diaAntes } from "@/domain/agente/metricas";
import type {
  LinhaDeMotivo,
  LinhaDeResposta,
  LinhaDoDiaDoAgente,
  LinhaSemResposta,
  MetricasDoAgente,
  ModoDeMetrica,
  PerguntaDaBase,
} from "@/domain/agente/metricas";
import type { RespostaDaBase } from "@/domain/agente-base/tipos";

/**
 * A tela do agente que escolhe respostas aprovadas (C4), do lado do servidor: painel, escada, Desligar tudo, simulador (só
 * leitura do que ele precisa), métricas e o selo da conversa.
 *
 * O padrão é o da tela da triagem: o servidor confere a permissão pela sessão de quem pediu e SÓ ENTÃO chama as funções do
 * banco com a chave do servidor (service_role), que conferem a permissão de novo com `has_permission`. Ninguém grava nas
 * tabelas do agente pelo navegador, nem o próprio servidor: toda escrita é por função (`agente_config_salvar`,
 * `agente_desligar`).
 *
 *   whatsapp.manage       sobe, desce, porcentagem e números de teste (quem liga o agente)
 *   desligar tudo         whatsapp.manage OU configuracoes.manage: parar nunca deveria esperar alguém com mais poder
 *   ler o painel          uma das duas
 *   selo da conversa      whatsapp.read, a permissão de quem abre a caixa de WhatsApp
 *
 * Esta tela NUNCA envia mensagem. O simulador roda no navegador, na função pura de decisão, e a frase que o dono digita não
 * volta ao servidor. As métricas só têm contagens: as views não trazem texto, nome, telefone nem id de conversa.
 *
 * O agente e as views nascem nas migrações C3 e C4, aplicadas à mão DEPOIS do código. Enquanto não existirem, o painel diz
 * "ainda não instalado" e as métricas dizem "as métricas ainda não foram instaladas": nunca zero, que se lê como "sem dados".
 *
 * NENHUM texto cru do banco chega à tela: toda falha passa por `falhou`, que registra só o código no log do servidor. A frase
 * própria do banco (as recusas `RAISE EXCEPTION` das funções do agente, escritas para o dono ler) passa SÓ quando está escrita
 * para a tela: sem parênteses e sem sublinhado (nome de função, de coluna ou de permissão); o resto vira uma frase genérica.
 * Toda frase própria, do banco ou deste arquivo, leva ao menos uma letra acentuada, senão `mensagemErro` a troca pela genérica.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- o cliente do servidor é usado por `rpc as any`: as funções do agente não estão nos tipos gerados
type Banco = any;

async function admin(): Promise<Banco> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Banco;
}

type ErroDoBanco = { message?: string; code?: string } | null | undefined;

/** A tabela ou a view ainda não existe: migração aplicada à mão, depois do código. */
export function naoInstalado(erro: ErroDoBanco): boolean {
  if (!erro) return false;
  return (
    erro.code === "42P01" ||
    erro.code === "PGRST205" ||
    /does not exist|schema cache|Could not find the (table|function)/i.test(erro.message ?? "")
  );
}

/** A frase do banco serve para a tela? Sem parênteses nem sublinhado: com eles é nome técnico ou mensagem de outra origem. */
export function fraseDoBancoServeParaATela(mensagem: string | undefined): mensagem is string {
  return !!mensagem && !/[()_]/.test(mensagem);
}

/**
 * Registra só o código no log do servidor e levanta uma frase própria. Recusa escrita pelo banco com `RAISE EXCEPTION`
 * (código P0001, texto escrito em português para o dono) passa como está, desde que sirva para a tela (sem parênteses nem
 * sublinhado); o resto vira frase genérica.
 */
function falhou(acao: string, erro: ErroDoBanco, generica: string): never {
  console.error(`[agente-tela] ${acao}: ${erro?.code ?? "sem código"}`);
  if (erro?.code === "P0001" && fraseDoBancoServeParaATela(erro.message))
    throw new Error(erro.message);
  throw new Error(generica);
}

async function tem(supabase: Banco, userId: string, permissao: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _permission: permissao,
  });
  if (error) falhou("permissao", error, "Não consegui conferir a sua permissão. Tente de novo.");
  return data === true;
}

const PERMISSAO_EM_PALAVRAS: Record<string, string> = {
  "whatsapp.manage": "de gerenciar o WhatsApp",
  "configuracoes.manage": "de gerenciar as configurações",
  "whatsapp.read": "de ler o WhatsApp",
};

function emPalavras(permissao: string): string {
  return PERMISSAO_EM_PALAVRAS[permissao] ?? "necessária para esta ação";
}

async function exigir(supabase: Banco, userId: string, permissao: string) {
  if (!(await tem(supabase, userId, permissao))) {
    throw new Error(`Seu perfil não tem a permissão ${emPalavras(permissao)}.`);
  }
}

async function exigirUma(supabase: Banco, userId: string, permissoes: string[]) {
  for (const p of permissoes) if (await tem(supabase, userId, p)) return;
  throw new Error(
    `Seu perfil não tem a permissão ${permissoes.map(emPalavras).join(" nem a permissão ")}.`,
  );
}

const AS_DUAS = ["configuracoes.manage", "whatsapp.manage"];

/* ------------------------------------------------------------------ */
/* Leitura do painel                                                   */
/* ------------------------------------------------------------------ */

export type ConfigDoAgenteNaTela = {
  estado: Degrau;
  percentual: number;
  numeros_teste: string[];
  vale_a_partir_de: string | null;
  max_mensagens: number;
  max_por_hora: number;
  max_por_dia: number;
  avisar_grupo: boolean;
  desligada_por: string | null;
  desligada_em: string | null;
  atualizado_em: string | null;
};

const COLUNAS_CONFIG =
  "estado, percentual, numeros_teste, vale_a_partir_de, max_mensagens, max_por_hora, max_por_dia, avisar_grupo, desligada_por, desligada_em, atualizado_em";

/** As mesmas colunas que a tela de aprovação lê: o simulador usa o motor de casamento da base, que precisa delas. */
const COLUNAS_DA_BASE =
  "id, tema, pergunta, frases_gatilho, ramos, produto_id, familia, resposta, status, texto_aprovado, versao, aprovada_por, aprovada_em, origem, contagem_ocorrencias, atualizado_em";

export type TermoDoBanco = {
  regra: string;
  termo: string;
  tipo: string;
  sobre: string;
  ramo: string | null;
  ativo: boolean;
};

/** Uma linha do quadro de frases da triagem, como o agente de verdade a lê para entender a intenção. */
export type LinhaDoQuadro = {
  id: string | number;
  passo: string | null;
  intencao: string;
  frase: string;
  casamento: string;
};

export type PainelDoAgente = {
  /** false: a migração C3 ainda não foi aplicada. A tela diz isso em vez de quebrar. */
  instalada: boolean;
  /** whatsapp.manage: pode ligar, subir, descer, mudar porcentagem e números de teste. */
  podeLigar: boolean;
  /**
   * `whatsapp_triagem_config.agente_apos_triagem` está ligada. É a chave antiga que libera a assistente de TEXTO LIVRE depois da
   * triagem, que o dono não quer. Enquanto ela estiver ligada a tela e o servidor não deixam o agente subir de degrau.
   */
  chaveAntigaLigada: boolean;
  config: ConfigDoAgenteNaTela | null;
  /** A base de respostas que ainda vale (rascunho e aprovada). A arquivada não entra. */
  base: RespostaDaBase[];
  /** O quadro de frases da triagem, linhas cruas: é de onde o agente lê a intenção (parar, preço, cortesia). */
  quadro: LinhaDoQuadro[];
  /** Termos proibidos que o dono acrescentou, linhas cruas; o navegador compila. Lista vazia se a leitura falhar. */
  termos: TermoDoBanco[];
  errosEm24h: number;
};

export const lerPainelDoAgente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainelDoAgente> => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const podeLigar = await tem(context.supabase, context.userId, "whatsapp.manage");
    const db = await admin();

    const lida = await db.from("agente_config").select(COLUNAS_CONFIG).maybeSingle();
    if (lida.error) {
      if (naoInstalado(lida.error)) {
        return {
          instalada: false,
          podeLigar,
          chaveAntigaLigada: false,
          config: null,
          base: [],
          quadro: [],
          termos: [],
          errosEm24h: 0,
        };
      }
      falhou("ler_config", lida.error, "Não consegui ler a configuração do agente. Tente de novo.");
    }
    if (!lida.data) {
      throw new Error(
        "A configuração do agente não existe no banco. Aplique a migração do agente.",
      );
    }

    const [base, quadro, termos, erros, chave] = await Promise.all([
      lerTodasAsLinhas<RespostaDaBase>((de, ate) =>
        db
          .from("agente_base_respostas")
          .select(COLUNAS_DA_BASE)
          .neq("status", "arquivada")
          .order("id")
          .range(de, ate),
      ),
      lerTodasAsLinhas<LinhaDoQuadro>((de, ate) =>
        db
          .from("whatsapp_triagem_respostas")
          .select("id, passo, intencao, frase, casamento")
          .eq("ativo", true)
          .order("id")
          .range(de, ate),
      ),
      db
        .from("whatsapp_triagem_termos_proibidos")
        .select("regra, termo, tipo, sobre, ramo, ativo")
        .eq("ativo", true),
      db
        .from("agente_eventos")
        .select("id", { count: "exact", head: true })
        .eq("tipo", "erro")
        .gte("criado_em", new Date(Date.now() - 86_400_000).toISOString()),
      db.from("whatsapp_triagem_config").select("agente_apos_triagem").maybeSingle(),
    ]);
    if (erros.error)
      falhou("ler_erros", erros.error, "Não consegui contar os erros do agente. Tente de novo.");
    // falha ao ler a chave NÃO vira "desligada": a tela diria que pode subir sem saber
    if (chave.error)
      falhou(
        "ler_chave_antiga",
        chave.error,
        "Não consegui ler a configuração do robô de boas-vindas. Tente de novo.",
      );

    return {
      instalada: true,
      podeLigar,
      chaveAntigaLigada:
        (chave.data as { agente_apos_triagem?: boolean } | null)?.agente_apos_triagem === true,
      config: lida.data as ConfigDoAgenteNaTela,
      base,
      quadro,
      // termo do dono que não leu: o agente de verdade tem a lista do código como piso, e o simulador também
      termos: termos.error ? [] : ((termos.data ?? []) as TermoDoBanco[]),
      errosEm24h: erros.count ?? 0,
    };
  });

/* ------------------------------------------------------------------ */
/* Escada: subir, descer, desligar tudo                                */
/* ------------------------------------------------------------------ */

async function lerConfigEBase(
  db: Banco,
): Promise<{ config: ConfigDoAgenteNaTela; base: RespostaDaBase[] }> {
  const lida = await db.from("agente_config").select(COLUNAS_CONFIG).maybeSingle();
  if (lida.error) {
    if (naoInstalado(lida.error)) {
      throw new Error("O agente ainda não foi instalado no banco. Avise quem cuida do sistema.");
    }
    falhou("ler_config", lida.error, "Não consegui ler a configuração do agente. Tente de novo.");
  }
  if (!lida.data) throw new Error("A configuração do agente não existe no banco.");
  const base = await lerTodasAsLinhas<RespostaDaBase>((de, ate) =>
    db
      .from("agente_base_respostas")
      .select(COLUNAS_DA_BASE)
      .neq("status", "arquivada")
      .order("id")
      .range(de, ate),
  );
  return { config: lida.data as ConfigDoAgenteNaTela, base };
}

/**
 * Muda o degrau. Sobe um por vez e desce sempre; para desligar de vez existe o botão vermelho (`desligarTudoDoAgente`), que
 * também cancela o que está na fila. Exige whatsapp.manage. O servidor confere as mesmas exigências da tela antes de chamar
 * o banco (inclusive zero respostas aprovadas), e o banco confere de novo (função e gatilho).
 */
export const mudarDegrauDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ para: z.enum(DEGRAUS) }).parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.manage");
    if (data.para === "desligada") {
      throw new Error(
        "Para desligar use o botão vermelho Desligar tudo: ele também cancela as mensagens que ainda não saíram.",
      );
    }
    const db = await admin();
    const { config, base } = await lerConfigEBase(db);
    if (!ehDegrau(config.estado)) throw new Error("Não reconheci o estado atual do agente.");
    const de = DEGRAUS.indexOf(config.estado);
    const para = DEGRAUS.indexOf(data.para);
    if (para === de) return { ok: true as const, estado: config.estado };
    // descer de ligada para parcial com porcentagem acima do teto falaria com todos sem a confirmação do degrau ligada
    if (data.para === "parcial" && config.percentual > PORCENTAGEM_MAXIMA_EM_PARCIAL)
      throw new Error(AVISO_DA_PORCENTAGEM_MAXIMA);
    if (para > de) {
      // a chave antiga de texto livre: lida AGORA, no servidor, porque a tela pode estar com a leitura velha
      const chave = await db
        .from("whatsapp_triagem_config")
        .select("agente_apos_triagem")
        .maybeSingle();
      if (chave.error)
        falhou(
          "ler_chave_antiga",
          chave.error,
          "Não consegui ler a configuração do robô de boas-vindas. Tente de novo.",
        );
      const decisao = podeSubirOAgente({
        atual: config.estado,
        percentual: config.percentual,
        numerosDeTeste: config.numeros_teste ?? [],
        cobertura: coberturaDaBase(base),
        chaveAntigaLigada:
          (chave.data as { agente_apos_triagem?: boolean } | null)?.agente_apos_triagem === true,
      });
      if (!decisao.pode) throw new Error(decisao.motivo);
      if (decisao.para !== data.para)
        throw new Error("O agente só sobe um degrau de cada vez, na ordem.");
    }
    const { data: r, error } = await db.rpc("agente_config_salvar", {
      p_usuario: context.userId,
      p_config: { estado: data.para },
    });
    if (error)
      falhou("mudar_degrau", error, "Não consegui mudar o degrau do agente. Tente de novo.");
    return { ok: true as const, estado: ((r ?? {}) as { estado?: Degrau }).estado ?? data.para };
  });

/** O botão vermelho. Qualquer uma das duas permissões pode parar. Desliga e cancela o que o agente tem na fila. */
export const desligarTudoDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const db = await admin();
    const { data, error } = await db.rpc("agente_desligar", {
      p_motivo: "botao_desligar_tudo",
      p_usuario: context.userId,
    });
    if (error) falhou("desligar", error, "Não consegui desligar o agente. Tente de novo agora.");
    const r = (data ?? {}) as { canceladas_na_fila?: number };
    return { ok: true as const, canceladasNaFila: r.canceladas_na_fila ?? 0 };
  });

const configSchema = z
  .object({
    percentual: z.number().int().min(0).max(100),
    numerosTeste: z.array(z.string().trim().min(8).max(20)).max(20),
  })
  .partial();

export type ConfigDoAgenteParaSalvar = z.input<typeof configSchema>;

/** Porcentagem e números de teste: mexem em quem recebe resposta, então só whatsapp.manage (o banco confere de novo). */
export const salvarConfigDoAgente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => configSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (Object.keys(data).length === 0) return { ok: true as const };
    await exigir(context.supabase, context.userId, "whatsapp.manage");
    const config: Record<string, unknown> = {};
    if (data.percentual !== undefined) config.percentual = data.percentual;
    if (data.numerosTeste !== undefined) config.numeros_teste = data.numerosTeste;
    const db = await admin();
    // Em parcial a porcentagem vai só até 50: 100 é o degrau ligada, que o dono sobe de propósito, com a confirmação própria dele
    if (data.percentual !== undefined && data.percentual > PORCENTAGEM_MAXIMA_EM_PARCIAL) {
      const lida = await db.from("agente_config").select("estado").maybeSingle();
      if (lida.error)
        falhou(
          "ler_config",
          lida.error,
          "Não consegui ler a configuração do agente. Tente de novo.",
        );
      if ((lida.data as { estado?: string } | null)?.estado === "parcial") {
        throw new Error(AVISO_DA_PORCENTAGEM_MAXIMA);
      }
    }
    const { error } = await db.rpc("agente_config_salvar", {
      p_usuario: context.userId,
      p_config: config,
    });
    if (error) falhou("salvar_config", error, "Não consegui salvar. Tente de novo.");
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ */
/* Métricas: só leitura                                                */
/* ------------------------------------------------------------------ */

/** Contagem que o banco devolve como texto ou número vira número; o que não for número vira 0 e não some a linha. */
export function numero(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

const modoDe = (v: unknown): ModoDeMetrica => (v === "ensaio" ? "ensaio" : "real");
const ramoDe = (v: unknown): "cliente" | "parceiro" => (v === "parceiro" ? "parceiro" : "cliente");

/** View que ainda não existe é migração não aplicada: a tela diz isso, em vez de mostrar "sem dados". */
export function erroDeMetricaDoAgente(e: ErroDoBanco): Error {
  console.error(`[agente-tela] metricas: ${e?.code ?? "sem código"}`);
  return new Error(
    naoInstalado(e)
      ? "As métricas do agente ainda não foram instaladas no banco. Avise quem cuida do sistema."
      : "Não consegui ler as métricas do agente. Tente de novo.",
  );
}

export type MetricasDoAgenteDaTela = MetricasDoAgente & {
  /** O dia de hoje em Macapá, o mesmo que as views usam. A tela corta a janela por ele. */
  hoje: string;
};

/**
 * Lê as quatro views `agente_metricas_*` com a chave do servidor, depois de conferir a permissão da tela do agente (uma das
 * duas). Erro de leitura VIRA ERRO (a tela mostra "não consegui carregar" com botão), nunca lista vazia. A pergunta de cada
 * resposta vem da base que o dono escreveu, não do rastro.
 */
export const lerMetricasDoAgente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MetricasDoAgenteDaTela> => {
    await exigirUma(context.supabase, context.userId, AS_DUAS);
    const db = await admin();
    const hoje = hojeBr();
    const desde = diaAntes(hoje, DIAS_DA_JANELA - 1);
    const [dias, motivos, respostas, semResposta, base] = await Promise.all([
      db
        .from("agente_metricas_dia")
        .select("*")
        .gte("dia", desde)
        .order("dia", { ascending: false })
        .limit(500),
      db.from("agente_metricas_motivos_30_dias").select("*").limit(500),
      db.from("agente_metricas_respostas").select("*").limit(1000),
      db
        .from("agente_metricas_sem_resposta_dia")
        .select("*")
        .gte("dia", desde)
        .order("dia", { ascending: false })
        .limit(500),
      db
        .from("agente_base_respostas")
        .select("id, pergunta, tema")
        .neq("status", "arquivada")
        .limit(1000),
    ]);
    for (const r of [dias, motivos, respostas, semResposta])
      if (r.error) throw erroDeMetricaDoAgente(r.error);
    if (base.error)
      falhou("ler_base", base.error, "Não consegui ler a base de respostas. Tente de novo.");

    return {
      hoje,
      dias: ((dias.data ?? []) as Record<string, unknown>[]).map(
        (l): LinhaDoDiaDoAgente => ({
          dia: String(l.dia),
          modo: modoDe(l.modo),
          ramo: ramoDe(l.ramo),
          decisoes: numero(l.decisoes),
          escolhidas: numero(l.escolhidas),
          entregues: numero(l.entregues),
          barradas: numero(l.barradas),
          sensiveis: numero(l.sensiveis),
        }),
      ),
      motivos: ((motivos.data ?? []) as Record<string, unknown>[]).map(
        (l): LinhaDeMotivo => ({
          modo: modoDe(l.modo),
          ramo: ramoDe(l.ramo),
          acao: l.acao === "barrar" || l.acao === "parar" ? l.acao : "entregar",
          motivo: String(l.motivo ?? ""),
          n: numero(l.n),
        }),
      ),
      respostas: ((respostas.data ?? []) as Record<string, unknown>[]).map(
        (l): LinhaDeResposta => ({
          resposta_id: String(l.resposta_id),
          tema: String(l.tema ?? ""),
          status: String(l.status ?? ""),
          versao: numero(l.versao),
          usos_real_30_dias: numero(l.usos_real_30_dias),
          usos_ensaio_30_dias: numero(l.usos_ensaio_30_dias),
          usos_total: numero(l.usos_total),
          ultimo_uso: typeof l.ultimo_uso === "string" ? l.ultimo_uso : null,
        }),
      ),
      semResposta: ((semResposta.data ?? []) as Record<string, unknown>[]).map(
        (l): LinhaSemResposta => ({
          dia: String(l.dia),
          modo: modoDe(l.modo),
          ramo: ramoDe(l.ramo),
          perguntas_sem_resposta: numero(l.perguntas_sem_resposta),
        }),
      ),
      base: ((base.data ?? []) as PerguntaDaBase[]).map((b) => ({
        id: String(b.id),
        pergunta: String(b.pergunta ?? ""),
        tema: String(b.tema ?? ""),
      })),
    };
  });

/* ------------------------------------------------------------------ */
/* O selo "Agente" da conversa                                         */
/* ------------------------------------------------------------------ */

export type RegistroDoAgenteNaConversa = {
  /** false: a migração do agente ainda não foi aplicada. O selo não aparece, sem erro. */
  instalado: boolean;
  respostas: number;
  entregou: boolean;
};

/**
 * Quantas respostas o agente escolheu e colocou na fila nesta conversa (o evento `enviado` marca a fila, não a entrega ao contato)
 * e se a entregou à equipe. Só eventos REAIS: o evento `ensaio` nunca
 * conta, porque nada saiu. Exige whatsapp.read, a permissão de quem abre a conversa. Só tipos e contagens saem daqui.
 * Erro de leitura LANÇA (a conversa não trava por causa do enfeite: o selo some, e a consulta fica em erro).
 */
export const lerRegistroDoAgenteNaConversa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RegistroDoAgenteNaConversa> => {
    await exigir(context.supabase, context.userId, "whatsapp.read");
    const db = await admin();
    const { data: linhas, error } = await db
      .from("agente_eventos")
      .select("tipo")
      .eq("conversa_id", data.conversaId)
      .in("tipo", ["enviado", "entregou"])
      .limit(200);
    if (error) {
      if (naoInstalado(error)) return { instalado: false, respostas: 0, entregou: false };
      falhou("selo", error, "Não consegui ler o registro do agente.");
    }
    const tipos = ((linhas ?? []) as { tipo: string }[]).map((l) => l.tipo);
    return {
      instalado: true,
      respostas: tipos.filter((t) => t === "enviado").length,
      entregou: tipos.includes("entregou"),
    };
  });
