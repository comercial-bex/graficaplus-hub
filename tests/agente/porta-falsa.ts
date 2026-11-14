/* eslint-disable @typescript-eslint/no-explicit-any -- porta falsa: linhas do banco sem tipo, como o contrato JSON das funções */
import type { PortaDoAgente } from "../../src/domain/agente";
import { SEMENTES_DO_QUADRO } from "../../src/domain/whatsapp/triagem";
import type { RegraDoBanco } from "../../src/domain/whatsapp/triagem";
import { basePadrao } from "./montar";

/**
 * O banco do agente de mentira, para exercer o orquestrador sem Postgres. Reproduz só o CONTRATO que o orquestrador usa
 * de `agente_contexto` e `agente_registrar` (formato do instantâneo, texto lido da linha da base, idempotência por
 * mensagem, ensaio que só anota). Não é prova do banco: essa é do ensaio em docs/ensaio-agente-escolhe.md. É prova de que o
 * que o TypeScript manda é o que o banco espera, ida e volta.
 */

export type Linha = Record<string, any>;

export type BancoDoAgenteFalso = {
  estado: string | null;
  config: Linha;
  conversa: Linha;
  triagem: Linha | null;
  mensagens: Map<string, Linha>;
  base: Linha[];
  eventos: Linha[];
  enviados: { texto: string; chave: string; atraso_s: number; mensagem_id: string }[];
  chamadas: string[];
  registrosRecebidos: Record<string, unknown>[];
  erros: { etapa: string; codigo: string }[];
  despachos: number;
  humano: boolean;
  bloqueado: boolean;
  dono: string;
  /** `whatsapp_triagens.perguntas_de_preco`: o que a triagem já contou antes de o agente entrar. */
  perguntasDePrecoDaTriagem: number;
  /** Força `contagens.envio_pendente`: nulo deixa o falso calcular (resposta enfileirada que ainda não saiu). */
  envioPendente: boolean | null;
  forcar: {
    lerContexto?: () => unknown;
    registrar?: () => unknown;
    despachar?: () => Promise<void>;
    registrarErro?: () => Promise<void>;
    estadoDaConfiguracao?: () => unknown;
  };
  porta: PortaDoAgente;
  chega: (texto: string | null, o?: { tipo?: string }) => string;
};

export const CONVERSA = "11111111-2222-4333-8444-555555555555";
export const TRIAGEM = "aaaaaaaa-2222-4333-8444-555555555555";

export function criarBanco(
  over: { estado?: string; ramo?: string; telefone?: string } = {},
): BancoDoAgenteFalso {
  let seq = 0;
  const b: BancoDoAgenteFalso = {
    estado: over.estado ?? "ligada",
    config: {
      estado: over.estado ?? "ligada",
      percentual: 0,
      numeros_teste: ["96999990001"],
      vale_a_partir_de: "2026-11-15T00:00:00Z",
      max_mensagens: 2,
      atraso_min_s: 3,
      atraso_max_s: 8,
      max_por_hora: 20,
      max_por_dia: 100,
      avisar_grupo: true,
    },
    conversa: {
      id: CONVERSA,
      telefone: over.telefone ?? "5596999990001",
      telefone_normalizado: "96999990001",
      eh_de_grupo: false,
    },
    triagem: {
      id: TRIAGEM,
      ramo: over.ramo ?? "cliente",
      status: "concluida",
      liberou: true,
      fim: Date.parse("2026-11-15T10:00:00Z"),
    },
    mensagens: new Map(),
    base: basePadrao().map((r) => ({ ...r })),
    eventos: [],
    enviados: [],
    chamadas: [],
    registrosRecebidos: [],
    erros: [],
    despachos: 0,
    humano: false,
    bloqueado: false,
    dono: "agente",
    perguntasDePrecoDaTriagem: 0,
    envioPendente: null,
    forcar: {},
    porta: undefined as unknown as PortaDoAgente,
    chega(texto, o = {}) {
      seq += 1;
      const id = `msg-${seq}`;
      b.mensagens.set(id, {
        id,
        tipo: o.tipo ?? "texto",
        texto,
        legenda: null,
        origem: "humano",
        criada: Date.parse("2026-11-15T10:00:00Z") + seq * 60_000,
      });
      return id;
    },
  };

  const decidida = (id: string) =>
    b.eventos.some(
      (e) => e.mensagem_id === id && ["escolheu", "entregou", "barrado", "ensaio"].includes(e.tipo),
    );

  b.porta = {
    async estadoDaConfiguracao() {
      b.chamadas.push("estado");
      if (b.forcar.estadoDaConfiguracao) return b.forcar.estadoDaConfiguracao() as string | null;
      return b.estado;
    },
    async lerContexto(conversaId, mensagemId) {
      b.chamadas.push("contexto");
      if (b.forcar.lerContexto) return b.forcar.lerContexto();
      const m = b.mensagens.get(mensagemId);
      const enviadas = b.eventos.filter((e) => e.tipo === "enviado").length;
      const posterior = !!(m && b.triagem && m.criada > b.triagem.fim);
      return {
        config: b.config,
        conversa: { ...b.conversa, id: conversaId, humano: b.humano, bloqueado: b.bloqueado },
        dono: b.dono,
        triagem: b.triagem
          ? {
              id: b.triagem.id,
              ramo: b.triagem.ramo,
              status: b.triagem.status,
              liberou: b.triagem.liberou,
            }
          : null,
        mensagem: m
          ? {
              id: m.id,
              tipo: m.tipo,
              texto: m.texto,
              legenda: m.legenda,
              origem: m.origem,
              posterior_a_triagem: posterior,
            }
          : null,
        ja_decidida: decidida(mensagemId),
        contagens: {
          enviadas,
          enviadas_na_hora: enviadas,
          enviadas_no_dia: enviadas,
          // como o banco: no envio real só contam os eventos reais; no degrau de ensaio contam também os de ensaio
          perguntas_de_preco:
            b.perguntasDePrecoDaTriagem +
            b.eventos.filter(
              (e) =>
                e.sensivel &&
                (b.estado === "ensaio"
                  ? ["escolheu", "entregou", "ensaio"]
                  : ["escolheu", "entregou"]
                ).includes(e.tipo),
            ).length,
          envio_pendente: b.envioPendente ?? b.enviados.length > enviadas,
          ultima_automatica_em: null,
        },
        base: b.base.filter((r) => r.status === "aprovada" && r.texto_aprovado),
      };
    },
    async lerQuadro() {
      b.chamadas.push("quadro");
      return SEMENTES_DO_QUADRO.map((q) => ({
        passo: q.passo,
        intencao: q.intencao,
        frase: q.frase,
        casamento: q.casamento,
      }));
    },
    async lerTermos() {
      b.chamadas.push("termos");
      return [] as RegraDoBanco[];
    },
    async registrar(conversaId, mensagemId, decisao) {
      b.chamadas.push("registrar");
      b.registrosRecebidos.push(decisao);
      if (b.forcar.registrar) return b.forcar.registrar();
      if (b.estado === "desligada") return { registrado: false, motivo: "desligada" };
      if (decidida(mensagemId))
        return { registrado: false, duplicada: true, motivo: "ja_decidida" };
      const ensaio = b.estado === "ensaio";
      let acao = String(decisao.acao);
      let motivo = (decisao.motivo as string | undefined) ?? null;
      if (acao !== "parar" && b.humano) {
        acao = "barrar";
        motivo = "humano_na_conversa";
      }
      if (ensaio) {
        b.eventos.push({
          tipo: "ensaio",
          acao,
          motivo,
          mensagem_id: mensagemId,
          sensivel: decisao.sensivel === true,
        });
        return { registrado: true, ensaio: true, enviado: false, acao, motivo };
      }
      if (acao === "escolher") {
        const r = b.base.find((x) => x.id === decisao.resposta_id);
        if (!r || r.status !== "aprovada" || r.versao !== decisao.versao) {
          b.eventos.push({
            tipo: "entregou",
            acao: "entregar",
            motivo: "resposta_mudou",
            mensagem_id: mensagemId,
          });
          return { registrado: true, enviado: false, acao: "entregar", motivo: "resposta_mudou" };
        }
        const chave = `triagem:${TRIAGEM}:agente:${mensagemId}`;
        b.enviados.push({
          texto: r.texto_aprovado,
          chave,
          atraso_s: Number(decisao.atraso_s),
          mensagem_id: mensagemId,
        });
        b.eventos.push({
          tipo: "escolheu",
          acao,
          mensagem_id: mensagemId,
          codigo: r.tema,
          sensivel: decisao.sensivel === true,
        });
        b.eventos.push({ tipo: "enviado", mensagem_id: mensagemId });
        return { registrado: true, enviado: true, ensaio: false, acao, tipo: "escolheu" };
      }
      b.eventos.push({
        tipo: acao === "entregar" ? "entregou" : "barrado",
        acao,
        motivo,
        mensagem_id: mensagemId,
        sensivel: decisao.sensivel === true,
      });
      return { registrado: true, enviado: false, ensaio: false, acao, motivo };
    },
    async despachar() {
      b.chamadas.push("despachar");
      b.despachos += 1;
      if (b.forcar.despachar) await b.forcar.despachar();
    },
    async registrarErro(a) {
      b.chamadas.push("erro");
      if (b.forcar.registrarErro) await b.forcar.registrarErro();
      b.erros.push({ etapa: a.etapa, codigo: a.codigo });
    },
    agora: () => Date.parse("2026-11-15T12:00:00Z"),
  };
  return b;
}
