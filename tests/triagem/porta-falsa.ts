import {
  SEMENTES_DO_QUADRO,
  PASSOS_SEMENTE,
  HORARIO_SEMENTE,
} from "../../src/domain/whatsapp/triagem";
import type {
  LinhaDeEntrada,
  PortaDaTriagem,
} from "../../src/domain/whatsapp/triagem/orquestrador";

/**
 * O banco da triagem de mentira, para exercer o orquestrador sem Postgres.
 * Reproduz só o contrato que o orquestrador usa de `triagem_ler_ou_abrir` e
 * `triagem_aplicar` (formato do instantâneo, versão, conflito, idempotência da
 * entrada e da chave de envio, escrita única dos dados). Não é prova do banco:
 * essa é do ensaio em docs/ensaio-triagem-dados.md. É prova de que o que o
 * TypeScript manda é o que o banco espera, ida e volta.
 */

export type Linha = Record<string, unknown>;

export type BancoFalso = {
  cfgEstado: string | null;
  linhaDeConfig: Linha;
  triagem: Linha | null;
  mensagens: Map<string, LinhaDeEntrada>;
  relogio: number;
  chamadas: string[];
  aplicacoes: { versao: number; resultado: Record<string, any> }[];
  enviados: {
    texto: string;
    chave: string;
    atraso_s: number;
    passo: string | null;
    ordem: number;
  }[];
  eventos: {
    tipo: string;
    passo: string | null;
    intencao: string | null;
    detalhe: Record<string, unknown>;
  }[];
  errosRegistrados: { etapa: string; codigo: string }[];
  esperas: number[];
  despachos: number;
  cepsConsultados: string[];
  /** Respostas fixas para forçar caminhos: se existir, vale no lugar do comportamento normal. */
  forcar: {
    lerOuAbrir?: () => unknown;
    aplicar?: () => unknown;
    cep?: () => Promise<unknown>;
    conflitos?: number;
    estadoDaConfiguracao?: () => unknown;
    despachar?: () => Promise<void>;
    registrarErro?: () => Promise<void>;
  };
  extras: {
    telefone?: string | null;
    temLid?: boolean;
    leadTipo?: string | null;
    /** `leads.tipo_origem`: anuncio, palavra, telefone ou manual. Padrão anuncio. */
    leadOrigem?: string | null;
    pendentes?: string[];
    automaticasDeFora?: number;
  };
  porta: PortaDaTriagem;
  /** Chega uma mensagem de entrada na conversa; devolve o id. */
  chega: (
    texto: string | null,
    o?: { tipo?: string; origem?: string | null; depoisDeMs?: number },
  ) => string;
};

export const CONVERSA = "11111111-2222-4333-8444-555555555555";
export const TRIAGEM = "aaaaaaaa-2222-4333-8444-555555555555";
const T0 = Date.parse("2026-11-16T13:00:00Z"); // segunda 10h em Belém

function linhasDeHorario() {
  return (HORARIO_SEMENTE.semana ?? []).map((d) => ({
    diaSemana: d.diaSemana,
    abre: d.abre,
    fecha: d.fecha,
    ativo: d.ativo,
  }));
}

export function criarBanco(
  o: {
    estado?: string | null;
    modo?: "ensaio" | "real";
    limpar?: boolean;
    linhaDeConfig?: Linha;
  } = {},
): BancoFalso {
  const b: BancoFalso = {
    cfgEstado: o.estado === undefined ? "teste" : o.estado,
    linhaDeConfig: {
      max_mensagens: 8,
      max_tentativas_por_passo: 2,
      intervalo_minimo_s: 20,
      espera_resposta_min: 30,
      retomar_ate_horas: 24,
      atraso_min_s: 3,
      atraso_max_s: 8,
      resposta_rapida_demais_ms: 2500,
      exibir_telefone: "final",
      link_parceiro: "https://exemplo.com.br/cadastro",
      ddd_padrao: null,
      ...o.linhaDeConfig,
    },
    triagem: null,
    mensagens: new Map(),
    relogio: T0,
    chamadas: [],
    aplicacoes: [],
    enviados: [],
    eventos: [],
    errosRegistrados: [],
    esperas: [],
    despachos: 0,
    cepsConsultados: [],
    forcar: {},
    extras: {},
    porta: undefined as unknown as PortaDaTriagem,
    chega: undefined as unknown as BancoFalso["chega"],
  };
  const modoPadrao = o.modo ?? (b.cfgEstado === "ensaio" ? "ensaio" : "real");
  let n = 0;

  b.chega = (texto, op = {}) => {
    n += 1;
    b.relogio += op.depoisDeMs ?? 30_000;
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    b.mensagens.set(id, {
      id,
      tipo: op.tipo ?? "texto",
      texto,
      legenda: null,
      origem: op.origem ?? null,
      recebidaEm: new Date(b.relogio).toISOString(),
    });
    return id;
  };

  const eventoDeEntrada = new Set<string>();

  function snapshot(dono: string, ensaio: boolean, mensagemId: string): Linha {
    const t = b.triagem as Linha;
    return {
      dono,
      ensaio,
      motivo: null,
      triagem: { ...t },
      config: { ...b.linhaDeConfig },
      conversa: {
        id: CONVERSA,
        criada_em: new Date(T0).toISOString(),
        telefone_normalizado: b.extras.telefone === undefined ? "96991112233" : b.extras.telefone,
        telefone_valido_br: true,
        tem_chat_lid: b.extras.temLid ?? false,
        atendimento_id: null,
      },
      lead: b.extras.leadTipo
        ? {
            id: "lead-1",
            tipo: b.extras.leadTipo,
            tipo_origem: b.extras.leadOrigem === undefined ? "anuncio" : b.extras.leadOrigem,
          }
        : null,
      passos: PASSOS_SEMENTE.map((p, i) => ({
        codigo: p.codigo,
        ramo: p.ramo,
        ordem: i,
        texto: p.texto,
        variantes: p.variantes ?? [],
        repeticao: p.repeticao ?? null,
        versao: 1,
        ativo: true,
      })),
      quadro: SEMENTES_DO_QUADRO.map((r) => ({
        passo: r.passo,
        intencao: r.intencao,
        frase: r.frase,
        casamento: r.casamento,
      })),
      horario: { semana: linhasDeHorario(), feriados: [], dentro: true, texto: {} },
      pendentes: b.extras.pendentes ?? [],
      automaticas_de_fora: b.extras.automaticasDeFora ?? 0,
      agora: new Date(b.relogio).toISOString(),
      _mensagem: mensagemId,
    };
  }

  b.porta = {
    async estadoDaConfiguracao() {
      b.chamadas.push("estadoDaConfiguracao");
      if (b.forcar.estadoDaConfiguracao) return b.forcar.estadoDaConfiguracao() as string | null;
      return b.cfgEstado;
    },

    async lerOuAbrir(_conversa, mensagemId, contexto) {
      b.chamadas.push("lerOuAbrir");
      void contexto;
      if (b.forcar.lerOuAbrir) return b.forcar.lerOuAbrir();
      if (!b.triagem) {
        b.triagem = {
          id: TRIAGEM,
          conversa_id: CONVERSA,
          modo: modoPadrao,
          status: modoPadrao === "ensaio" ? "ensaio" : "ativa",
          ramo: "cliente",
          ramo_motivo: "padrao",
          passo: null,
          tentativas_passo: 0,
          mensagens_enviadas: 0,
          avisos_audio: 0,
          avisos_arquivo: 0,
          audios: 0,
          figurinhas: 0,
          perguntas_de_preco: 0,
          etapas_esgotadas_seguidas: 0,
          versao: 1,
          nome_informado: null,
          nome_completo: false,
          primeira_vez: null,
          cep: null,
          cep_endereco: null,
          endereco_texto: null,
          endereco_recusado: false,
          telefone_confirmado: null,
          telefone_alternativo: null,
          pediu_preco: false,
          pediu_tabela_especial: false,
          pediu_equipe: false,
          pediu_parceria: false,
          mandou_audio: false,
          reclamou: false,
          ultima_entrada_id: null,
          ultima_entrada_hash: null,
          ultima_entrada_em: null,
          ultimo_envio_em: null,
          aviso_grupo_decidido: false,
          motivo_fim: null,
        };
      }
      const t = b.triagem;
      if (!["ativa", "ensaio", "expirada"].includes(String(t.status))) {
        return {
          dono: "ninguem",
          motivo: `triagem_${t.status}`,
          triagem_id: t.id,
          status: t.status,
        };
      }
      if (eventoDeEntrada.has(mensagemId))
        return { dono: "ninguem", motivo: "entrada_repetida", triagem_id: t.id };
      const ensaio = t.modo === "ensaio" || b.cfgEstado === "ensaio";
      return snapshot(ensaio ? "assistente" : "triagem", ensaio, mensagemId);
    },

    async lerEntradas(ids) {
      b.chamadas.push("lerEntradas");
      return ids.flatMap((id) =>
        b.mensagens.has(id) ? [b.mensagens.get(id) as LinhaDeEntrada] : [],
      );
    },

    async consultarCep(cep) {
      b.chamadas.push("consultarCep");
      b.cepsConsultados.push(cep);
      if (b.forcar.cep) return (await b.forcar.cep()) as never;
      return { cep, rua: "Rua A", bairro: "Centro", cidade: "Macapá", estado: "AP" };
    },

    async aplicar(triagemId, versao, resultado) {
      b.chamadas.push("aplicar");
      b.aplicacoes.push({ versao, resultado: resultado as Record<string, any> });
      if (b.forcar.aplicar) return b.forcar.aplicar();
      const t = b.triagem as Linha;
      if (b.forcar.conflitos && b.forcar.conflitos > 0) {
        b.forcar.conflitos -= 1;
        return { ok: false, conflito: true, versao: Number(t.versao) + 1 };
      }
      if (t.id !== triagemId) throw new Error("triagem desconhecida");
      if (t.versao !== versao) return { ok: false, conflito: true, versao: t.versao };
      const r = resultado as Record<string, any>;
      if (r.mensagem_id) eventoDeEntrada.add(String(r.mensagem_id));
      for (const m of (r.mensagens_ids ?? []) as string[]) eventoDeEntrada.add(m);
      const e = (r.estado ?? {}) as Record<string, unknown>;
      for (const k of [
        "status",
        "passo",
        "ramo",
        "ramo_motivo",
        "tentativas_passo",
        "mensagens_enviadas",
        "avisos_audio",
        "avisos_arquivo",
        "audios",
        "figurinhas",
        "perguntas_de_preco",
        "etapas_esgotadas_seguidas",
        "motivo_fim",
      ]) {
        if (k in e) t[k] = e[k];
      }
      if ("ultima_entrada_hash" in e) {
        if (!/^[0-9a-f]{32}$/.test(String(e.ultima_entrada_hash)))
          throw new Error("check ultima_entrada_hash");
        t.ultima_entrada_hash = e.ultima_entrada_hash;
      }
      const g = (r.gravar ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(g)) {
        // escrita única: só entra se estava vazio; as marcas só sobem
        if (typeof t[k] === "boolean") t[k] = Boolean(t[k]) || v === true;
        else if (
          t[k] === null ||
          t[k] === undefined ||
          (k === "telefone_confirmado" && t[k] === "pendente")
        )
          t[k] = v;
      }
      for (const ev of (r.eventos ?? []) as Linha[]) {
        // as regras do banco para o detalhe do evento
        const d = (ev.detalhe ?? {}) as Record<string, unknown>;
        const texto = JSON.stringify(d);
        if (
          /"(texto|text|mensagem|conteudo|body|nome|telefone|phone|cep|endereco|email|resposta|frase)":/.test(
            texto,
          )
        ) {
          throw new Error(`check de evento sem conteúdo: ${texto}`);
        }
        for (const c of (d.codigos ?? []) as string[])
          if (!/^[a-z][a-z0-9_]{0,40}$/.test(c)) throw new Error(`código inválido ${c}`);
        for (const v of (d.variaveis ?? []) as string[])
          if (!/^[a-z_]{1,40}$/.test(v)) throw new Error(`variável inválida ${v}`);
        b.eventos.push({
          tipo: String(ev.tipo),
          passo: (ev.passo as string | null) ?? null,
          intencao: (ev.intencao as string | null) ?? null,
          detalhe: d,
        });
      }
      let enviado = false;
      let ensaio = false;
      const envio = r.envio as Record<string, any> | undefined;
      if (envio) {
        if (!String(envio.chave).startsWith(`triagem:${t.id}:`))
          throw new Error("chave de idempotência fora do padrão");
        if (t.modo === "ensaio" || b.cfgEstado === "ensaio") {
          ensaio = true;
          b.eventos.push({
            tipo: "envio_ensaio",
            passo: envio.passo ?? null,
            intencao: null,
            detalhe: { ordem: envio.ordem },
          });
        } else if (!b.enviados.some((x) => x.chave === envio.chave)) {
          b.enviados.push({
            texto: envio.texto,
            chave: envio.chave,
            atraso_s: envio.atraso_s,
            passo: envio.passo,
            ordem: envio.ordem,
          });
          enviado = true;
          t.ultimo_envio_em = new Date(b.relogio).toISOString();
        }
      }
      t.ultima_entrada_id = r.mensagem_id ?? t.ultima_entrada_id;
      t.ultima_entrada_em = new Date(b.relogio).toISOString();
      t.versao = Number(t.versao) + 1;
      if (r.aviso_grupo) t.aviso_grupo_decidido = true;
      return { ok: true, versao: t.versao, enviado, ensaio, barrado: false };
    },

    async despachar() {
      b.chamadas.push("despachar");
      b.despachos += 1;
      if (b.forcar.despachar) await b.forcar.despachar();
    },

    async esperar(ms) {
      b.chamadas.push("esperar");
      b.esperas.push(ms);
      b.relogio += ms;
    },

    async registrarErro(a) {
      b.chamadas.push("registrarErro");
      b.errosRegistrados.push({ etapa: a.etapa, codigo: a.codigo });
      if (b.forcar.registrarErro) await b.forcar.registrarErro();
    },

    agora: () => b.relogio,
  };
  return b;
}
