import { quadroDoBanco } from "../whatsapp/triagem/orquestrador";
import { ehDegrau } from "../whatsapp/triagem/escada";
import type { RespostaDoQuadro } from "../whatsapp/triagem/tipos";
import type { RegraDoBanco } from "../whatsapp/triagem/verificador";
import type { RamoDaBase, RespostaDaBase } from "../agente-base/tipos";
import { decidirDoAgente } from "./decidir";
import { portaoDoAgente } from "./portao";
import {
  CONFIG_PADRAO_DO_AGENTE,
  type ConfigDoAgente,
  type ContextoDoAgente,
  type DecisaoDoAgente,
  type EntradaDoAgente,
} from "./tipos";

/**
 * A ligação do agente com o mundo, escrita como função que recebe uma PORTA: banco, rede, relógio e espera entram por
 * ela. O servidor (`src/lib/api/agente-escolhe.server.ts`) entrega a porta de verdade e os testes entregam uma porta
 * de mentira. Mesmo padrão da triagem (`rodarTriagem`).
 *
 * O CAMINHO, em ordem:
 *   1. lê só o estado da configuração. Desligada (o estado de nascença): sai aqui, sem tocar em mais nada;
 *   2. `agente_contexto`: uma chamada que devolve configuração, conversa, dono, triagem, mensagem, contagens e as
 *      respostas aprovadas. Se o portão já diz silêncio, sai sem ler o quadro nem os termos;
 *   3. decide (função pura) e manda `agente_registrar`, que confere de novo e é quem grava e enfileira;
 *   4. se saiu mensagem de verdade, pede a rodada do despachante.
 *
 * NADA aqui lança: qualquer falha vira `{ acao: "erro" }` e um evento de erro com etapa e código curto, nunca texto.
 */

export type PortaDoAgente = {
  /** Estado da configuração do agente. Nulo quando não há linha. */
  estadoDaConfiguracao(): Promise<string | null>;
  lerContexto(conversaId: string, mensagemId: string): Promise<unknown>;
  lerQuadro(): Promise<unknown>;
  lerTermos(): Promise<RegraDoBanco[]>;
  registrar(
    conversaId: string,
    mensagemId: string,
    decisao: Record<string, unknown>,
  ): Promise<unknown>;
  despachar(): Promise<void>;
  registrarErro(a: {
    conversaId: string;
    mensagemId: string | null;
    etapa: string;
    codigo: string;
  }): Promise<void>;
  agora(): number;
};

export type ResultadoDoAgente =
  | { acao: "nada"; motivo: string }
  | {
      acao: "processada";
      /** O que o agente decidiu: escolher, entregar, barrar ou parar. */
      decisao: DecisaoDoAgente["acao"];
      motivo: string | null;
      enviou: boolean;
      ensaio: boolean;
    }
  | { acao: "erro"; etapa: string };

/* ------------------------------------------------------------------ */
/* Leitura defensiva do que o banco devolve                            */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;
const objeto = (v: unknown): Obj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, padrao: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : padrao;
const ms = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

export function configDoAgenteDoBanco(linha: unknown): ConfigDoAgente {
  const c = objeto(linha) ?? {};
  const p = CONFIG_PADRAO_DO_AGENTE;
  return {
    estado: ehDegrau(c.estado) ? c.estado : "desligada",
    percentual: num(c.percentual, p.percentual),
    numerosDeTeste: lista(c.numeros_teste).filter((n): n is string => typeof n === "string"),
    valeAPartirDe: ms(c.vale_a_partir_de),
    maxMensagens: num(c.max_mensagens, p.maxMensagens),
    atrasoMinS: num(c.atraso_min_s, p.atrasoMinS),
    atrasoMaxS: num(c.atraso_max_s, p.atrasoMaxS),
    maxPorHora: num(c.max_por_hora, p.maxPorHora),
    maxPorDia: num(c.max_por_dia, p.maxPorDia),
    avisarGrupo: c.avisar_grupo !== false,
  };
}

/** A base aprovada como o domínio a lê. Linha sem texto aprovado ou com forma estranha fica de fora. */
export function baseDoBanco(linhas: unknown): RespostaDaBase[] {
  return lista(linhas).flatMap((l) => {
    const r = objeto(l);
    const id = r ? txt(r.id) : null;
    const tema = r ? txt(r.tema) : null;
    const texto = r ? txt(r.texto_aprovado) : null;
    if (!r || !id || !tema || !texto) return [];
    const ramos = lista(r.ramos).filter(
      (x): x is RamoDaBase => x === "cliente" || x === "parceiro",
    );
    if (ramos.length === 0) return [];
    return [
      {
        id,
        tema,
        pergunta: txt(r.pergunta) ?? "",
        frases_gatilho: lista(r.frases_gatilho).filter((f): f is string => typeof f === "string"),
        ramos,
        produto_id: txt(r.produto_id),
        familia: txt(r.familia),
        resposta: texto,
        status: "aprovada" as const,
        texto_aprovado: texto,
        versao: num(r.versao, 1),
        aprovada_por: null,
        aprovada_em: null,
        origem: "dono" as const,
        contagem_ocorrencias: num(r.contagem_ocorrencias, 0),
        atualizado_em: "",
      },
    ];
  });
}

export function contextoDoAgenteDoBanco(snap: Obj, agora: number): ContextoDoAgente {
  const conversa = objeto(snap.conversa) ?? {};
  const triagem = objeto(snap.triagem);
  const m = objeto(snap.mensagem);
  const cont = objeto(snap.contagens) ?? {};
  const ramo: RamoDaBase = triagem?.ramo === "parceiro" ? "parceiro" : "cliente";
  const triagemId = triagem ? txt(triagem.id) : null;
  const entrada: EntradaDoAgente | null =
    m && txt(m.id)
      ? {
          id: String(m.id),
          tipo: txt(m.tipo) ?? "texto",
          texto: txt(m.texto),
          legenda: txt(m.legenda),
          origem: txt(m.origem),
          posteriorATriagem: m.posterior_a_triagem === true,
        }
      : null;
  const desde = ms(cont.ultima_automatica_em);
  return {
    config: configDoAgenteDoBanco(snap.config),
    conversaId: txt(conversa.id) ?? "",
    telefone: txt(conversa.telefone),
    telefoneNormalizado: txt(conversa.telefone_normalizado),
    ehDeGrupo: conversa.eh_de_grupo === true,
    humanoNaConversa: conversa.humano === true,
    bloqueado: conversa.bloqueado === true,
    dono: txt(snap.dono),
    triagem: triagemId ? { id: triagemId, ramo, liberou: triagem?.liberou === true } : null,
    mensagem: entrada,
    jaDecidida: snap.ja_decidida === true,
    enviadas: num(cont.enviadas, 0),
    enviadasNaHora: num(cont.enviadas_na_hora, 0),
    enviadasNoDia: num(cont.enviadas_no_dia, 0),
    perguntasDePreco: num(cont.perguntas_de_preco, 0),
    envioPendente: cont.envio_pendente === true,
    msDesdeUltimaAutomatica: desde === null ? null : Math.max(0, agora - desde),
    base: baseDoBanco(snap.base),
  };
}

/* ------------------------------------------------------------------ */
/* Do que o domínio decidiu para o que o banco aceita                   */
/* ------------------------------------------------------------------ */

const CODIGO = /^[a-z][a-z0-9_]{0,60}$/;

/**
 * O `p_decisao` de `agente_registrar`. SÓ códigos, ids e contagens. O texto da resposta NÃO vai: o banco lê o
 * `texto_aprovado` da linha pelo id e pela versão, de modo que o servidor nem consegue mandar um texto diferente.
 */
export function decisaoParaRegistrar(d: DecisaoDoAgente): Record<string, unknown> | null {
  switch (d.acao) {
    case "nada":
      return null;
    case "barrar":
    case "parar":
      return { acao: d.acao, motivo: d.motivo };
    case "entregar":
      return {
        acao: "entregar",
        motivo: d.motivo,
        sensivel: d.ehPreco,
        regras: d.regras.filter((r) => CODIGO.test(r)),
      };
    case "escolher":
      return {
        acao: "escolher",
        resposta_id: d.respostaId,
        versao: d.versao,
        tema: d.tema,
        sensivel: d.ehPreco,
        candidatas: d.candidatas,
        especificidade: d.especificidade,
        passar_para_equipe: d.passarParaEquipe,
        atraso_s: d.atrasoS,
      };
  }
}

/* ------------------------------------------------------------------ */
/* O caminho inteiro                                                   */
/* ------------------------------------------------------------------ */

class Falha extends Error {
  constructor(
    public etapa: string,
    causa: unknown,
  ) {
    super(etapa);
    this.cause = causa;
  }
}

async function noPasso<T>(etapa: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw new Falha(etapa, e);
  }
}

function codigoDoErro(e: unknown): string {
  const bruto =
    e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string"
      ? (e as { code: string }).code
      : e instanceof Error
        ? e.name
        : "erro";
  return (
    bruto
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 40) || "erro"
  );
}

export async function rodarAgente(
  porta: PortaDoAgente,
  a: { conversaId: string; mensagemId: string },
): Promise<ResultadoDoAgente> {
  let etapa = "interno";
  try {
    // PRIMEIRA LINHA: desligada (o estado de nascença) sai sem tocar em mais nada
    const estado = await noPasso("configuracao", () => porta.estadoDaConfiguracao());
    if (estado === null || estado === "desligada") {
      return { acao: "nada", motivo: estado === null ? "sem_configuracao" : "desligada" };
    }

    const bruto = await noPasso("contexto", () => porta.lerContexto(a.conversaId, a.mensagemId));
    const snap = objeto(bruto);
    if (!snap) throw new Falha("contexto", new Error("resposta_vazia"));
    const ctx = contextoDoAgenteDoBanco(snap, porta.agora());

    // conversa que não é do agente: sai sem ler o quadro nem os termos
    const previa = portaoDoAgente(ctx, []);
    if (previa.acao === "nada") return { acao: "nada", motivo: previa.motivo };

    const quadro: RespostaDoQuadro[] = quadroDoBanco(
      await noPasso("quadro", () => porta.lerQuadro()),
    );
    const termos = await noPasso("termos", () => porta.lerTermos());
    const decisao = decidirDoAgente(ctx, quadro, termos);
    if (decisao.acao === "nada") return { acao: "nada", motivo: decisao.motivo };

    const payload = decisaoParaRegistrar(decisao);
    if (!payload) return { acao: "nada", motivo: "sem_payload" };
    const resposta = objeto(
      await noPasso("registrar", () => porta.registrar(a.conversaId, a.mensagemId, payload)),
    );
    if (!resposta) throw new Falha("registrar", new Error("resposta_vazia"));
    if (resposta.duplicada === true) return { acao: "nada", motivo: "ja_decidida" };
    if (resposta.registrado === false) {
      return { acao: "nada", motivo: txt(resposta.motivo) ?? "registrar_recusou" };
    }
    const enviou = resposta.enviado === true;
    if (enviou) {
      try {
        await porta.despachar();
      } catch {
        // a mensagem já está na fila: a rodada de 2 minutos do despachante leva
      }
    }
    return {
      acao: "processada",
      decisao: decisao.acao,
      motivo: "motivo" in decisao ? decisao.motivo : "tema" in decisao ? decisao.tema : null,
      enviou,
      ensaio: resposta.ensaio === true,
    };
  } catch (e) {
    etapa = e instanceof Falha ? e.etapa : etapa;
    const causa = e instanceof Falha ? e.cause : e;
    try {
      await porta.registrarErro({
        conversaId: a.conversaId,
        mensagemId: a.mensagemId,
        etapa,
        codigo: codigoDoErro(causa),
      });
    } catch {
      // nem o rastro do erro pode derrubar o webhook
    }
    return { acao: "erro", etapa };
  }
}

/* ------------------------------------------------------------------ */
/* O consumidor da fila                                                */
/* ------------------------------------------------------------------ */

export type SituacaoDaLinhaDoAgente = {
  /** `agente_config.estado`; nulo se a leitura não achou linha. */
  estado: string | null;
  triagemLiberou: boolean;
  /** `_agente_degrau_permite`: o degrau atual da escada do agente deixa esta conversa. */
  degrauPermite: boolean;
  humanoNaConversa: boolean;
  bloqueado: boolean;
  /** `whatsapp_conversas.telefone` é um celular brasileiro? */
  telefoneAlcancavel: boolean;
  /**
   * A resposta que a linha carrega (`resposta_id` e `versao` do payload) ainda está aprovada, na mesma versão, sem produto e
   * limpa no validador? É o que `agente_conferir_envio` devolve em `resposta_aprovada`. Arquivada, editada ou com produto: não sai.
   */
  respostaAprovada: boolean;
};

/**
 * Antes de despachar uma linha do agente (payload com `triagem_id` e `agente: true`), o consumidor da fila confere se o
 * agente ainda pode falar nesta conversa. Qualquer dúvida cancela: entre enfileirar e enviar a equipe pode ter entrado,
 * o contato pode ter pedido para parar ou a escada pode ter descido.
 *
 * Fica de fora de propósito: "a conversa foi entregue à equipe". A resposta que promete avisar a equipe é enfileirada
 * junto da entrega e TEM de sair; e uma entrega por outro motivo só acontece com a fila do agente já vazia.
 */
export function linhaDoAgentePodeSair(s: SituacaoDaLinhaDoAgente): {
  sai: boolean;
  motivo: string;
} {
  if (s.estado === null || s.estado === "desligada")
    return { sai: false, motivo: "agente_desligado" };
  if (s.estado === "ensaio") return { sai: false, motivo: "agente_em_ensaio" };
  if (!s.triagemLiberou) return { sai: false, motivo: "triagem_nao_liberou" };
  if (!s.telefoneAlcancavel) return { sai: false, motivo: "sem_numero_alcancavel" };
  if (s.humanoNaConversa) return { sai: false, motivo: "humano_na_conversa" };
  if (s.bloqueado) return { sai: false, motivo: "bloqueado" };
  if (!s.respostaAprovada) return { sai: false, motivo: "resposta_mudou" };
  if (!s.degrauPermite) return { sai: false, motivo: "fora_do_degrau" };
  return { sai: true, motivo: "ok" };
}
