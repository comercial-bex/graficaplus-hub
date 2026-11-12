/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: funções da migração 20261112110000 fora dos tipos gerados; é a forma que tests/rpc-assinaturas lê */
/**
 * A rodada da cobrança de orçamento no grupo da equipe.
 *
 * Quem chama: POST /api/whatsapp/cobrar (job `whatsapp-cobrar` do pg_cron, a cada 5 minutos, com o
 * token do despachante no cabeçalho `x-despachante-token`).
 *
 * O que faz, em ordem (contrato, seção SERVIDOR):
 *   1. lê `whatsapp_configuracoes`; desligada, sai sem ler mais nada;
 *   2. fora do horário útil, sai sem decidir nada;
 *   3. trava do destino: no modo ligada, o grupo da configuração tem de casar ^\d{10,}-group$,
 *      senão a rodada inteira é recusada com erro (nada é registrado);
 *   4. lê os fatos: `whatsapp_cobranca_pendencias(p_desde)` e `whatsapp_cobranca_equipe()`;
 *   5. decide com `src/domain/whatsapp/cobranca.ts` e agrupa;
 *   6. registra cada envio em `whatsapp_cobranca_registrar` (no ensaio, só o histórico; ligada,
 *      histórico e `notificacoes_fila`, que o despachante atual entrega).
 *
 * O destino NUNCA é parâmetro: a função do banco usa `grupo_equipe_destino()`. Nada vai ao cliente.
 * São três travas: o banco (registrar), esta rodada (passo 3) e o consumidor da fila
 * (`processarAvisosAoCliente`, que recusa `cobranca_orcamento` para destino que não é grupo).
 *
 * Falha de leitura NUNCA vira "zero pendências": a rodada devolve `ok: false` com o erro.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  agruparNaAbertura,
  configDaCobranca,
  corteDaCobranca,
  decidirCobranca,
  dentroDoHorarioUtil,
  quemCitar,
  type CobrancaFeita,
  type ItemDeCobranca,
  type LinhaDaConfiguracao,
  type ModoCobranca,
  type OrcamentoLigado,
  type Pendencia,
  type PessoaDaEquipe,
} from "@/domain/whatsapp/cobranca";
import { ehGrupoZapi } from "@/domain/whatsapp/zapi-envio";

export type ResultadoDaRodada = {
  ok: boolean;
  modo: ModoCobranca;
  /**
   * por que a rodada não decidiu nada: "desligada", "fora_do_horario", "sem_corte"
   * (modo sem data de corte gravada) ou "modo_mudou" (alguém trocou o modo no meio da rodada)
   */
  parada: string | null;
  pendencias: number;
  /** envios registrados nesta rodada (no ensaio, o que teria mandado) */
  registrados: number;
  /** envios que o banco recusou por já existir a cobrança (outra rodada ganhou) */
  jaRegistrados: number;
  /** quantas pendências não foram cobradas, por motivo (para conferir o ensaio) */
  naoCobradas: Record<string, number>;
  erros: string[];
};

export const DESTINO_RECUSADO = "cobrança recusada: o destino não é o grupo da equipe";

const COLUNAS_DA_CONFIGURACAO = [
  "horario_inicio",
  "horario_fim",
  "dias_semana",
  "grupo_equipe_id",
  "grupo_equipe_ativo",
  "cobranca_modo",
  "cobranca_min_pedido",
  "cobranca_min_orcamento",
  "cobranca_min_gestor",
  "cobranca_sabado",
  "cobranca_sabado_fim",
  "cobranca_ligada_em",
  "cobranca_ensaio_desde",
].join(", ");

/* ------------------------------------------------------------------ */
/* O que o banco devolve                                               */
/* ------------------------------------------------------------------ */

/** Uma linha de `whatsapp_cobranca_pendencias` (datas como o PostgREST manda: texto ISO). */
export type LinhaDaPendencia = {
  atendimento_id: string;
  numero: string | null;
  conversa_id: string;
  aberto_em: string;
  fechado_em: string | null;
  fila: string | null;
  conversa_status: string | null;
  resp_atendimento_id: string | null;
  resp_conversa_id: string | null;
  cliente_nome: string | null;
  pediu_por_palavra_em: string | null;
  pediu_por_marca_em: string | null;
  orcamentos:
    | {
        id: string;
        numero: number | string | null;
        status: string | null;
        criado_em: string;
        enviado_em: string | null;
        vendedor_id: string | null;
      }[]
    | null;
  envios_na_conversa: string[] | null;
  dispensado_em: string | null;
  lead_status: string | null;
  cobrancas: { nivel: number; modo: string; em: string }[] | null;
};

type LinhaDaEquipe = { id: string; nome: string | null; telefone: string | null; papeis: string[] | null };

function data(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Linha do banco para a `Pendencia` da regra. Data inválida obrigatória lança (dado quebrado não decide). */
export function pendenciaDaLinha(l: LinhaDaPendencia): Pendencia {
  const abertoEm = data(l.aberto_em);
  if (!abertoEm) throw new Error(`atendimento ${l.atendimento_id} sem data de abertura válida`);
  const orcamentos: OrcamentoLigado[] = [];
  for (const o of l.orcamentos ?? []) {
    const criadoEm = data(o.criado_em);
    if (!criadoEm) continue;
    orcamentos.push({
      id: o.id,
      numero: Number(o.numero ?? 0),
      status: o.status ?? "",
      criadoEm,
      enviadoEm: data(o.enviado_em),
      vendedorId: o.vendedor_id ?? null,
    });
  }
  const cobrancas: CobrancaFeita[] = [];
  for (const c of l.cobrancas ?? []) {
    const em = data(c.em);
    if (!em || (c.nivel !== 1 && c.nivel !== 2) || (c.modo !== "ensaio" && c.modo !== "ligada")) continue;
    cobrancas.push({ nivel: c.nivel, modo: c.modo, em });
  }
  return {
    atendimentoId: l.atendimento_id,
    numero: l.numero ?? "",
    conversaId: l.conversa_id,
    abertoEm,
    fechadoEm: data(l.fechado_em),
    fila: l.fila ?? "",
    conversaStatus: l.conversa_status ?? "",
    responsavelId: l.resp_atendimento_id ?? null,
    responsavelConversaId: l.resp_conversa_id ?? null,
    clienteNome: l.cliente_nome ?? null,
    pediuPorPalavraEm: data(l.pediu_por_palavra_em),
    pediuPorMarcaEm: data(l.pediu_por_marca_em),
    orcamentos,
    enviosNaConversa: (l.envios_na_conversa ?? []).map(data).filter((d): d is Date => d !== null),
    dispensadoEm: data(l.dispensado_em),
    leadStatus: l.lead_status ?? null,
    cobrancas,
  };
}

function pessoaDaLinha(l: LinhaDaEquipe): PessoaDaEquipe {
  return { id: l.id, nome: l.nome ?? "", telefone: l.telefone ?? null, papeis: l.papeis ?? [] };
}

/** O que vai em `p_itens` (sem chave aninhada na chamada: tests/rpc-assinaturas). */
function itemParaRegistro(i: ItemDeCobranca) {
  return {
    atendimento_id: i.pendencia.atendimentoId,
    conversa_id: i.pendencia.conversaId,
    orcamento_id: i.decisao.orcamento?.id ?? null,
    nivel: i.decisao.nivel,
    motivo: i.decisao.motivo,
    minutos_uteis: i.decisao.minutosUteis,
    // Sem o telefone: o histórico guarda só quem foi citado (o número é refeito do usuário na hora
    // do envio). `citados` com `mencao` deixaria o telefone do colega legível para quem lê o histórico.
    citados: i.citados.map((c) => ({ id: c.id, nome: c.nome, papel: c.papel, sem_telefone: c.mencao === null })),
  };
}

/* ------------------------------------------------------------------ */
/* A rodada                                                            */
/* ------------------------------------------------------------------ */

async function decidirERegistrar(agora: Date): Promise<ResultadoDaRodada> {
  const resultado: ResultadoDaRodada = {
    ok: true,
    modo: "desligada",
    parada: null,
    pendencias: 0,
    registrados: 0,
    jaRegistrados: 0,
    naoCobradas: {},
    erros: [],
  };
  const falhou = (erro: string): ResultadoDaRodada => {
    console.error("[whatsapp-cobranca]", erro);
    return { ...resultado, ok: false, erros: [...resultado.erros, erro] };
  };

  // 1. A configuração. Erro de leitura é erro, nunca "desligada".
  const { data: linha, error: erroConfig } = await (supabaseAdmin as any)
    .from("whatsapp_configuracoes")
    .select(COLUNAS_DA_CONFIGURACAO)
    .limit(1)
    .maybeSingle();
  if (erroConfig) return falhou(`falha ao ler a configuração da cobrança: ${erroConfig.message}`);
  if (!linha) return falhou("sem linha em whatsapp_configuracoes: a cobrança não sabe o modo");

  const config = linha as LinhaDaConfiguracao;
  const cfg = configDaCobranca(config);
  resultado.modo = cfg.modo;

  // 2. Desligada: nada mais é lido.
  if (cfg.modo === "desligada") return { ...resultado, parada: "desligada" };

  // 3. Fora do horário útil o relógio para e nada sai.
  if (!dentroDoHorarioUtil(agora, cfg.horario)) return { ...resultado, parada: "fora_do_horario" };

  // 4. SEGUNDA TRAVA do destino (a primeira é o banco). No modo ligada o grupo tem de estar
  //    ligado e no formato de grupo do Z-API. Qualquer outra coisa recusa a rodada inteira.
  if (cfg.modo === "ligada") {
    const grupoDaLinha = config.grupo_equipe_ativo === true ? (config.grupo_equipe_id ?? "").trim() : "";
    if (!ehGrupoZapi(cfg.grupoDestino) || !ehGrupoZapi(grupoDaLinha) || cfg.grupoDestino !== grupoDaLinha) {
      return falhou(DESTINO_RECUSADO);
    }
  }

  // Sem data de corte o banco não devolve nada (p_desde nulo): dizer, em vez de parecer vazio.
  const corte = corteDaCobranca(cfg);
  if (!corte) return { ...resultado, parada: "sem_corte" };

  // 5. Os fatos. Falha de qualquer uma é erro, nunca "zero pendências".
  const [pendResp, equipeResp] = await Promise.all([
    (supabaseAdmin.rpc as any)("whatsapp_cobranca_pendencias", { p_desde: corte.toISOString() }),
    (supabaseAdmin.rpc as any)("whatsapp_cobranca_equipe"),
  ]);
  if (pendResp?.error) return falhou(`falha ao ler as pendências: ${pendResp.error.message}`);
  if (equipeResp?.error) return falhou(`falha ao ler a equipe: ${equipeResp.error.message}`);
  if (!Array.isArray(pendResp?.data)) return falhou("as pendências vieram num formato inesperado");
  if (!Array.isArray(equipeResp?.data)) return falhou("a equipe veio num formato inesperado");

  const linhas = pendResp.data as LinhaDaPendencia[];
  const equipe = (equipeResp.data as LinhaDaEquipe[]).map(pessoaDaLinha);
  resultado.pendencias = linhas.length;

  // 6. Decide pela regra.
  const itens: ItemDeCobranca[] = [];
  for (const l of linhas) {
    let pendencia: Pendencia;
    try {
      pendencia = pendenciaDaLinha(l);
    } catch (e) {
      resultado.erros.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    const decisao = decidirCobranca(pendencia, cfg, agora);
    if (!decisao.cobrar) {
      resultado.naoCobradas[decisao.motivo] = (resultado.naoCobradas[decisao.motivo] ?? 0) + 1;
      continue;
    }
    itens.push({ pendencia, decisao, citados: quemCitar(pendencia, decisao, equipe) });
  }

  // 7. Registra. No ensaio o banco só guarda o histórico; ligada, também enfileira para o grupo.
  for (const envio of agruparNaAbertura(itens)) {
    const registro = envio.itens.map(itemParaRegistro);
    const { data: resposta, error } = await (supabaseAdmin.rpc as any)("whatsapp_cobranca_registrar", {
      p_modo: cfg.modo,
      p_itens: registro,
      p_texto: envio.texto,
      p_mencionar: envio.mencionar,
      p_agrupada: envio.agrupada,
    });
    const atendimentos = envio.itens.map((i) => i.pendencia.numero || i.pendencia.atendimentoId).join(", ");
    if (error) {
      resultado.erros.push(`falha ao registrar a cobrança de ${atendimentos}: ${error.message}`);
      continue;
    }
    const r = (resposta ?? {}) as { registrada?: boolean; motivo?: string | null };
    if (r.registrada === true) {
      resultado.registrados++;
    } else if (r.motivo === "ja_registrada") {
      resultado.jaRegistrados++;
    } else if (r.motivo === "modo_mudou") {
      // O modo trocou no meio: nada desta rodada vale mais.
      return { ...resultado, parada: "modo_mudou" };
    } else {
      resultado.erros.push(`o banco não registrou a cobrança de ${atendimentos}: ${r.motivo ?? "sem motivo"}`);
    }
  }

  if (resultado.erros.length > 0) {
    console.error("[whatsapp-cobranca]", resultado.erros.join(" | "));
    return { ...resultado, ok: false };
  }
  return resultado;
}

/**
 * Grava como a rodada terminou (`whatsapp_cobranca_rodada_gravar`), para o cartão do Monitor dizer
 * "última rodada às HH:MM: ok" ou "falhou: motivo". Sem isto a falha ficava só na resposta do
 * net.http_post, que ninguém lê. Desligada e sem erro não grava (nada rodou, e seria uma escrita
 * na configuração a cada 5 minutos à toa). Falha ao gravar vai para o log e nunca derruba a rodada.
 */
async function gravarARodada(r: ResultadoDaRodada): Promise<void> {
  if (r.modo === "desligada" && r.ok) return;
  try {
    const { error } = await (supabaseAdmin.rpc as any)("whatsapp_cobranca_rodada_gravar", {
      p_ok: r.ok,
      p_parada: r.parada,
      p_erro: r.ok ? null : r.erros.join(" | ") || "falha sem detalhe",
    });
    if (error) console.error("[whatsapp-cobranca] resultado da rodada não gravado:", error.message);
  } catch (e) {
    console.error("[whatsapp-cobranca] resultado da rodada não gravado:", e instanceof Error ? e.message : e);
  }
}

export async function rodadaDeCobranca(agora: Date = new Date()): Promise<ResultadoDaRodada> {
  const resultado = await decidirERegistrar(agora);
  await gravarARodada(resultado);
  return resultado;
}
