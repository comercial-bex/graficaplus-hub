import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { diasAntesDeHojeBr } from "@/lib/hoje-br";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEGRAUS, ehDegrau, podeSubir, type Degrau } from "@/domain/whatsapp/triagem/escada";
import { validarTextoEditavel } from "@/domain/whatsapp/triagem/textos";
import { lerTodasAsLinhas } from "@/domain/whatsapp/triagem/paginar";
import { explicarProblemaDeTexto } from "@/domain/whatsapp/triagem/tela";
import type { LinhaDa30Dias, LinhaDoDia } from "@/domain/whatsapp/triagem/metricas";

/**
 * A tela de configuração da triagem de boas-vindas (Onda B, PR B6), do lado do servidor.
 *
 * O padrão é o de `origem-do-contato.functions.ts`: o servidor confere a permissão
 * pela sessão de quem pediu e SÓ ENTÃO chama as funções do banco com a chave do
 * servidor (service_role), que conferem a permissão de novo com `has_permission`.
 * Ninguém grava nas tabelas da triagem pelo navegador.
 *
 *   whatsapp.manage       estado, porcentagem, números de teste e freios (quem liga o robô)
 *   configuracoes.manage  textos das etapas, quadro de respostas, link, tempos, horário e feriados
 *   desligar tudo         qualquer uma das duas: parar é sempre permitido
 *
 * Leitura: quem tem uma das duas. A tela nunca envia mensagem: o simulador roda
 * no navegador, na função pura do motor, sem chamar nada daqui.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- o cliente do servidor é usado por `rpc as any`: as funções da triagem não estão nos tipos gerados
type Banco = any;

async function admin(): Promise<Banco> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Banco;
}

async function tem(supabase: Banco, userId: string, permissao: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _permission: permissao,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/** A permissão em palavras simples, para a mensagem que o dono lê. O nome de código nunca aparece na tela. */
const PERMISSAO_EM_PALAVRAS: Record<string, string> = {
  "whatsapp.manage": "de gerenciar o WhatsApp",
  "configuracoes.manage": "de gerenciar as configurações",
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

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export type ConfigDaTela = {
  estado: Degrau;
  percentual: number;
  numeros_teste: string[];
  vale_a_partir_de: string | null;
  link_parceiro: string | null;
  avisar_grupo: boolean;
  agente_apos_triagem: boolean;
  espera_resposta_min: number;
  retomar_ate_horas: number;
  intervalo_minimo_s: number;
  max_mensagens: number;
  max_tentativas_por_passo: number;
  max_novas_por_hora: number;
  max_novas_por_dia: number;
  atraso_min_s: number;
  atraso_max_s: number;
  freio_falhas_envio: number;
  freio_erros_hora: number;
  desligada_por: string | null;
  desligada_em: string | null;
  atualizado_em: string | null;
};

export type PassoDaTela = {
  codigo: string;
  ramo: "cliente" | "parceiro";
  ordem: number;
  texto: string;
  variantes: string[];
  repeticao: string | null;
  ajuda_para_dono: string | null;
  ativo: boolean;
  versao: number;
  atualizado_em: string | null;
};

export type RespostaDaTela = {
  passo: string | null;
  intencao: string;
  frase: string;
  casamento: "igual" | "comeca" | "contem";
  ativo: boolean;
};

export type DiaDaTela = { dia_semana: number; abre: string; fecha: string; ativo: boolean };
export type FeriadoDaTela = {
  data: string;
  nome: string;
  fechado: boolean;
  abre: string | null;
  fecha: string | null;
};

export type PainelDaTriagem = {
  config: ConfigDaTela;
  /** whatsapp.manage: pode ligar, subir, descer, mudar porcentagem, números de teste e freios. */
  podeLigar: boolean;
  /** configuracoes.manage: pode editar textos, quadro, link, tempos, horário e feriados. */
  podeEditar: boolean;
  passos: PassoDaTela[];
  respostas: RespostaDaTela[];
  horarios: DiaDaTela[];
  feriados: FeriadoDaTela[];
  contagens: {
    triagensEm7Dias: number;
    porStatus: Record<string, number>;
    errosEm24h: number;
    textosBarradosEm24h: number;
  };
};

const COLUNAS_CONFIG =
  "estado, percentual, numeros_teste, vale_a_partir_de, link_parceiro, avisar_grupo, agente_apos_triagem, espera_resposta_min, retomar_ate_horas, intervalo_minimo_s, max_mensagens, max_tentativas_por_passo, max_novas_por_hora, max_novas_por_dia, atraso_min_s, atraso_max_s, freio_falhas_envio, freio_erros_hora, desligada_por, desligada_em, atualizado_em";

function hhmm(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 5) : "";
}

async function lerConfig(db: Banco): Promise<ConfigDaTela> {
  const { data, error } = await db
    .from("whatsapp_triagem_config")
    .select(COLUNAS_CONFIG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "A configuração da triagem não existe no banco. Aplique as migrações da triagem.",
    );
  return data as ConfigDaTela;
}

export const lerPainelDaTriagem = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainelDaTriagem> => {
    await exigirUma(context.supabase, context.userId, ["configuracoes.manage", "whatsapp.manage"]);
    const podeLigar = await tem(context.supabase, context.userId, "whatsapp.manage");
    const podeEditar = await tem(context.supabase, context.userId, "configuracoes.manage");
    const db = await admin();
    const config = await lerConfig(db);

    const [passos, respostas, horarios, feriados, triagens, erros, barrados] = await Promise.all([
      db
        .from("whatsapp_triagem_passos")
        .select(
          "codigo, ramo, ordem, texto, variantes, repeticao, ajuda_para_dono, ativo, versao, atualizado_em",
        )
        .order("ramo")
        .order("ordem"),
      lerTodasAsLinhas<RespostaDaTela>((de, ate) =>
        db
          .from("whatsapp_triagem_respostas")
          .select("passo, intencao, frase, casamento, ativo")
          .order("intencao")
          .order("frase")
          .order("passo", { nullsFirst: true })
          .order("casamento")
          .range(de, ate),
      ),
      db
        .from("whatsapp_horarios_atendimento")
        .select("dia_semana, abre, fecha, ativo")
        .order("dia_semana"),
      db.from("whatsapp_feriados").select("data, nome, fechado, abre, fecha").order("data"),
      lerTodasAsLinhas<{ status: string }>((de, ate) =>
        db
          .from("whatsapp_triagens")
          .select("status")
          .gte("iniciada_em", new Date(Date.now() - 7 * 86_400_000).toISOString())
          .order("id")
          .range(de, ate),
      ),
      db
        .from("whatsapp_triagem_eventos")
        .select("id", { count: "exact", head: true })
        .eq("tipo", "erro")
        .gte("criado_em", new Date(Date.now() - 86_400_000).toISOString()),
      db
        .from("whatsapp_triagem_eventos")
        .select("id", { count: "exact", head: true })
        .eq("tipo", "texto_barrado")
        .gte("criado_em", new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    for (const r of [passos, horarios, feriados, erros, barrados]) {
      if (r.error) throw new Error(r.error.message);
    }
    const porStatus: Record<string, number> = {};
    for (const t of triagens) porStatus[t.status] = (porStatus[t.status] ?? 0) + 1;

    return {
      config,
      podeLigar,
      podeEditar,
      passos: ((passos.data ?? []) as PassoDaTela[]).map((p) => ({
        ...p,
        variantes: p.variantes ?? [],
      })),
      respostas,
      horarios: ((horarios.data ?? []) as DiaDaTela[]).map((h) => ({
        ...h,
        abre: hhmm(h.abre),
        fecha: hhmm(h.fecha),
      })),
      feriados: ((feriados.data ?? []) as FeriadoDaTela[]).map((f) => ({
        ...f,
        abre: f.abre ? hhmm(f.abre) : null,
        fecha: f.fecha ? hhmm(f.fecha) : null,
      })),
      contagens: {
        triagensEm7Dias: triagens.length,
        porStatus,
        errosEm24h: erros.count ?? 0,
        textosBarradosEm24h: barrados.count ?? 0,
      },
    };
  });

/* ------------------------------------------------------------------ */
/* Escada: ligar, subir, descer, desligar tudo                         */
/* ------------------------------------------------------------------ */

/**
 * Muda o degrau. Sobe um por vez e desce sempre; para desligar de vez existe o
 * botão vermelho (`desligarTudo`), que também para as conversas abertas. Exige
 * whatsapp.manage. O servidor confere as mesmas exigências da tela antes de
 * chamar o banco, e o banco confere de novo (função e gatilho).
 */
export const mudarDegrauDaTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ para: z.enum(DEGRAUS) }).parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.manage");
    if (data.para === "desligada") {
      throw new Error(
        "Para desligar use o botão vermelho Desligar tudo: ele também para as conversas abertas.",
      );
    }
    const db = await admin();
    const atual = await lerConfig(db);
    if (!ehDegrau(atual.estado)) throw new Error("Estado da triagem desconhecido.");
    const de = DEGRAUS.indexOf(atual.estado);
    const para = DEGRAUS.indexOf(data.para);
    if (para === de) return { ok: true as const, estado: atual.estado };
    if (para > de) {
      const decisao = podeSubir({
        atual: atual.estado,
        percentual: atual.percentual,
        numerosDeTeste: atual.numeros_teste ?? [],
        linkDeParceiro: atual.link_parceiro,
      });
      if (!decisao.pode) throw new Error(decisao.motivo);
      if (decisao.para !== data.para) throw new Error("A triagem sobe um degrau por vez.");
    }
    const { data: r, error } = await db.rpc("triagem_config_salvar", {
      p_usuario: context.userId,
      p_config: { estado: data.para },
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, estado: ((r ?? {}) as { estado?: Degrau }).estado ?? data.para };
  });

/** O botão vermelho. Qualquer uma das duas permissões pode parar: parar nunca deveria esperar alguém com mais poder. */
export const desligarTudoDaTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await exigirUma(context.supabase, context.userId, ["whatsapp.manage", "configuracoes.manage"]);
    const db = await admin();
    const { data, error } = await db.rpc("triagem_desligar", {
      p_motivo: "botao_desligar_tudo",
      p_usuario: context.userId,
    });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { pausadas?: number; canceladas_na_fila?: number };
    return {
      ok: true as const,
      pausadas: r.pausadas ?? 0,
      canceladasNaFila: r.canceladas_na_fila ?? 0,
    };
  });

/* ------------------------------------------------------------------ */
/* Configuração: número de teste, porcentagem, link, tempos, freios    */
/* ------------------------------------------------------------------ */

const inteiro = (min: number, max: number) => z.number().int().min(min).max(max);

const configSchema = z
  .object({
    percentual: inteiro(0, 100),
    numerosTeste: z.array(z.string().trim().min(8).max(20)).max(20),
    linkParceiro: z.string().trim().max(300).nullable(),
    avisarGrupo: z.boolean(),
    esperaRespostaMin: inteiro(5, 1440),
    retomarAteHoras: inteiro(1, 72),
    intervaloMinimoS: inteiro(5, 300),
    maxMensagens: inteiro(1, 12),
    maxTentativasPorPasso: inteiro(1, 3),
    maxNovasPorHora: inteiro(1, 100),
    maxNovasPorDia: inteiro(1, 1000),
    atrasoMinS: inteiro(1, 15),
    atrasoMaxS: inteiro(1, 15),
    freioFalhasEnvio: inteiro(1, 20),
    freioErrosHora: inteiro(1, 200),
  })
  .partial();

export type ConfigParaSalvar = z.input<typeof configSchema>;

/** Campos que mexem em quem recebe mensagem ou afrouxam freio: só quem pode ligar o robô (whatsapp.manage). */
const SO_PARA_QUEM_LIGA = new Set([
  "percentual",
  "numerosTeste",
  "intervaloMinimoS",
  "maxMensagens",
  "maxTentativasPorPasso",
  "maxNovasPorHora",
  "maxNovasPorDia",
  "freioFalhasEnvio",
  "freioErrosHora",
]);

const COLUNA_DO_CAMPO: Record<string, string> = {
  percentual: "percentual",
  numerosTeste: "numeros_teste",
  linkParceiro: "link_parceiro",
  avisarGrupo: "avisar_grupo",
  esperaRespostaMin: "espera_resposta_min",
  retomarAteHoras: "retomar_ate_horas",
  intervaloMinimoS: "intervalo_minimo_s",
  maxMensagens: "max_mensagens",
  maxTentativasPorPasso: "max_tentativas_por_passo",
  maxNovasPorHora: "max_novas_por_hora",
  maxNovasPorDia: "max_novas_por_dia",
  atrasoMinS: "atraso_min_s",
  atrasoMaxS: "atraso_max_s",
  freioFalhasEnvio: "freio_falhas_envio",
  freioErrosHora: "freio_erros_hora",
};

export const salvarConfigDaTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => configSchema.parse(d))
  .handler(async ({ data, context }) => {
    const campos = Object.keys(data);
    if (campos.length === 0) return { ok: true as const };
    if (campos.some((c) => SO_PARA_QUEM_LIGA.has(c))) {
      await exigir(context.supabase, context.userId, "whatsapp.manage");
    } else {
      await exigirUma(context.supabase, context.userId, [
        "configuracoes.manage",
        "whatsapp.manage",
      ]);
    }
    if (data.linkParceiro && !/^https:\/\/[^\s]+$/.test(data.linkParceiro)) {
      throw new Error("O link de parceiro precisa começar com https:// e não ter espaços.");
    }
    const config: Record<string, unknown> = {};
    for (const [campo, valor] of Object.entries(data)) {
      const coluna = COLUNA_DO_CAMPO[campo];
      if (coluna) config[coluna] = campo === "linkParceiro" && !valor ? null : valor;
    }
    const db = await admin();
    const { error } = await db.rpc("triagem_config_salvar", {
      p_usuario: context.userId,
      p_config: config,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ */
/* Textos das etapas                                                   */
/* ------------------------------------------------------------------ */

const passoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,40}$/),
  ramo: z.enum(["cliente", "parceiro"]),
  texto: z.string().max(2000),
  variantes: z.array(z.string().max(2000)).max(2),
  repeticao: z.string().max(2000).nullable(),
  ativo: z.boolean(),
});

/**
 * Salva o texto de uma etapa. A recusa de termo proibido é dupla de propósito:
 * o servidor confere com a mesma função do motor (e devolve a explicação em
 * português simples) e o gatilho do banco confere de novo. Texto reprovado não
 * chega a ser gravado, e a versão só sobe quando grava.
 */
export const salvarTextoDoPasso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => passoSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const textos: { rotulo: string; texto: string }[] = [
      { rotulo: "o texto principal", texto: data.texto },
      ...data.variantes
        .filter((v) => v.trim())
        .map((v, i) => ({ rotulo: `a variante ${i + 1}`, texto: v })),
      ...(data.repeticao?.trim()
        ? [{ rotulo: "o texto de repetição", texto: data.repeticao }]
        : []),
    ];
    for (const t of textos) {
      const problemas = validarTextoEditavel(t.texto, data.ramo);
      if (problemas.length > 0) {
        throw new Error(
          `Não salvei: ${t.rotulo} ${problemas.map(explicarProblemaDeTexto).join(" ")}`,
        );
      }
    }
    const db = await admin();
    const { data: r, error } = await db.rpc("triagem_passo_salvar", {
      p_usuario: context.userId,
      p_codigo: data.codigo,
      p_ramo: data.ramo,
      p_texto: data.texto,
      p_variantes: data.variantes.filter((v) => v.trim()),
      p_repeticao: data.repeticao?.trim() ? data.repeticao : null,
      p_ativo: data.ativo,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, versao: ((r ?? {}) as { versao?: number }).versao ?? null };
  });

/* ------------------------------------------------------------------ */
/* Quadro de respostas                                                 */
/* ------------------------------------------------------------------ */

const INTENCOES_QUE_SE_CADASTRAM = [
  "sim",
  "nao",
  "mudar",
  "primeira_vez",
  "ja_cliente",
  "pular",
  "recusar",
  "parar",
  "falar_com_equipe",
  "parceiro",
  "pergunta_preco",
  "saudacao",
  "agradecimento",
  "automatica",
  "reclamacao",
] as const;

const respostaSchema = z.object({
  passo: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,40}$/)
    .nullable(),
  intencao: z.enum(INTENCOES_QUE_SE_CADASTRAM),
  frase: z.string().trim().min(1, "Escreva a frase.").max(120),
  casamento: z.enum(["igual", "comeca", "contem"]),
  ativo: z.boolean(),
});

export type RespostaParaSalvar = z.input<typeof respostaSchema>;

export const salvarRespostaDoQuadro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => respostaSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const db = await admin();
    const { data: r, error } = await db.rpc("triagem_resposta_salvar", {
      p_usuario: context.userId,
      p_passo: data.passo,
      p_intencao: data.intencao,
      p_frase: data.frase,
      p_casamento: data.casamento,
      p_ativo: data.ativo,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, frase: ((r ?? {}) as { frase?: string }).frase ?? data.frase };
  });

/* ------------------------------------------------------------------ */
/* Horário e feriados                                                  */
/* ------------------------------------------------------------------ */

const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use hora e minuto, por exemplo 08:00.");

export const salvarHorarioDoDia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ dia: inteiro(0, 6), abre: HORA, fecha: HORA, ativo: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await exigirUma(context.supabase, context.userId, ["configuracoes.manage", "whatsapp.manage"]);
    if (data.fecha <= data.abre)
      throw new Error("A hora de fechar precisa ser depois da hora de abrir.");
    const db = await admin();
    const { error } = await db.rpc("whatsapp_horario_salvar", {
      p_usuario: context.userId,
      p_dia: data.dia,
      p_abre: data.abre,
      p_fecha: data.fecha,
      p_ativo: data.ativo,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const feriadoSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a data como dia/mês/ano."),
  nome: z.string().trim().max(80),
  fechado: z.boolean(),
  abre: HORA.nullable(),
  fecha: HORA.nullable(),
  remover: z.boolean(),
});

export type FeriadoParaSalvar = z.input<typeof feriadoSchema>;

export const salvarFeriadoDaTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => feriadoSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigirUma(context.supabase, context.userId, ["configuracoes.manage", "whatsapp.manage"]);
    if (!data.remover && !data.nome) throw new Error("Dê um nome ao feriado.");
    if (!data.remover && !data.fechado) {
      if (!data.abre || !data.fecha || data.fecha <= data.abre) {
        throw new Error(
          "Feriado com atendimento precisa de hora de abrir e de fechar, e fechar depois de abrir.",
        );
      }
    }
    const db = await admin();
    const { error } = await db.rpc("whatsapp_feriado_salvar", {
      p_usuario: context.userId,
      p_data: data.data,
      p_nome: data.nome || "Feriado",
      p_fechado: data.fechado,
      p_abre: data.fechado ? null : data.abre,
      p_fecha: data.fechado ? null : data.fecha,
      p_remover: data.remover,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ */
/* Métricas (B10): só leitura                                          */
/* ------------------------------------------------------------------ */

export type MetricasDaTriagem = {
  dias: LinhaDoDia[];
  janela: LinhaDa30Dias[];
};

const NUMERICAS_DIA = [
  "triadas",
  "puladas",
  "em_andamento",
  "concluidas",
  "entregues_equipe",
  "abandonadas",
  "pausadas_humano",
  "pausadas_desligada",
  "paradas_pelo_contato",
  "enviou_boas_vindas",
  "respondeu_nome",
  "pediu_preco",
  "concluidas_com_tempo",
  "soma_segundos_ate_concluir",
] as const;

const NUMERICAS_JANELA = [
  "triadas",
  "puladas",
  "concluidas",
  "entregues_equipe",
  "abandonadas",
  "pausadas_humano",
  "triagens_com_pausa_humano",
  "enviou_boas_vindas",
  "respondeu_nome",
  "pediu_preco",
  "concluidas_com_tempo",
] as const;

/** Contagem que o banco devolve como texto ou número vira número; o que não for número vira 0 e não some a linha. */
export function numero(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** View que ainda não existe é migração não aplicada: a tela diz isso, em vez de mostrar "sem dados". */
export function erroDeMetrica(e: { message?: string; code?: string }): Error {
  const falta =
    e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "");
  return new Error(
    falta
      ? "As métricas da triagem ainda não foram instaladas no banco. Avise quem cuida do sistema."
      : (e.message ?? "Não foi possível ler as métricas da triagem."),
  );
}

/**
 * Lê as views `triagem_metricas_dia` e `triagem_metricas_30_dias` com a chave do servidor, depois de
 * conferir a mesma permissão da tela da triagem (uma das duas). As views só têm
 * contagens e tempos: nada de nome, CEP, telefone ou texto. Erro de leitura
 * VIRA ERRO (a tela mostra "não consegui carregar"), nunca lista vazia.
 */
export const lerMetricasDaTriagem = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MetricasDaTriagem> => {
    await exigirUma(context.supabase, context.userId, ["configuracoes.manage", "whatsapp.manage"]);
    const db = await admin();
    const desde = diasAntesDeHojeBr(29); // dia de Macapá, o mesmo recorte de 30 dias das views
    const [dias, janela] = await Promise.all([
      db.from("triagem_metricas_dia").select("*").gte("dia", desde).order("dia", { ascending: false }).limit(200),
      db.from("triagem_metricas_30_dias").select("*").limit(10),
    ]);
    for (const r of [dias, janela]) if (r.error) throw erroDeMetrica(r.error);

    return {
      dias: ((dias.data ?? []) as Record<string, unknown>[]).map((l) => {
        const saida: Record<string, unknown> = { dia: String(l.dia), ramo: l.ramo === "parceiro" ? "parceiro" : "cliente" };
        for (const k of NUMERICAS_DIA) saida[k] = numero(l[k]);
        return saida as unknown as LinhaDoDia;
      }),
      janela: ((janela.data ?? []) as Record<string, unknown>[]).map((l) => {
        const saida: Record<string, unknown> = { ramo: l.ramo === "parceiro" ? "parceiro" : "cliente" };
        for (const k of NUMERICAS_JANELA) saida[k] = numero(l[k]);
        saida.mediana_segundos_ate_concluir =
          l.mediana_segundos_ate_concluir === null || l.mediana_segundos_ate_concluir === undefined
            ? null
            : numero(l.mediana_segundos_ate_concluir);
        return saida as unknown as LinhaDa30Dias;
      }),
    };
  });
