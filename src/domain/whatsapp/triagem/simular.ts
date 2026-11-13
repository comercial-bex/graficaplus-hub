import {
  CONFIG_PADRAO_DA_TRIAGEM,
  type ContextoDaTriagem,
  type EntradaDeMensagem,
  type EstadoDaTriagem,
  type ResultadoDoPasso,
  type TipoDeEntrada,
} from "./tipos";
import { triagemPodeFalarCom } from "./extrair";
import { entregaSemNumero, estadoInicial, processarRajada, proximoPasso } from "./maquina";
import { SEMENTES_DO_QUADRO } from "./quadro-sementes";
import { PASSOS_SEMENTE } from "./textos-sementes";
import { HORARIO_SEMENTE } from "./horario";

/**
 * Simulador da triagem: roda a função pura com mensagens digitadas, sem enviar
 * nada. É o que a tela de configuração (B6) usa para o dono testar os textos, e
 * o que os testes usam para executar o roteiro do plano de ligar.
 */

export type FalaSimulada = { de: "contato" | "robo"; texto: string };

export type SessaoSimulada = {
  estado: EstadoDaTriagem;
  ctx: ContextoDaTriagem;
  /** Relógio da sessão, em ms desde 1970. */
  agora: number;
  conversa: FalaSimulada[];
  proximoId: number;
  resultados: ResultadoDoPasso[];
};

/** 2026-11-16 (segunda-feira) 10:00 em Belém, dentro do horário de atendimento. */
export const SEGUNDA_AS_10H = Date.parse("2026-11-16T13:00:00Z");
/** 2026-11-14 (sábado) 20:00 em Belém, fora do horário de atendimento. */
export const SABADO_AS_20H = Date.parse("2026-11-14T23:00:00Z");

export function contextoPadrao(sobrescrever: Partial<ContextoDaTriagem> = {}): ContextoDaTriagem {
  return {
    config: { ...CONFIG_PADRAO_DA_TRIAGEM, linkParceiro: "https://exemplo.com.br/convite" },
    quadro: SEMENTES_DO_QUADRO,
    passos: PASSOS_SEMENTE,
    horario: HORARIO_SEMENTE,
    telefoneDoChat: { normalizado: "96991112233", ehLid: false },
    ...sobrescrever,
  };
}

export function iniciarSessao(
  o: {
    conversaId?: string;
    agora?: number;
    ctx?: Partial<ContextoDaTriagem>;
    modo?: "ensaio" | "real";
  } = {},
): SessaoSimulada {
  const conversaId = o.conversaId ?? "11111111-2222-4333-8444-555555555555";
  return {
    estado: estadoInicial({
      triagemId: "triagem-" + conversaId.slice(-6),
      conversaId,
      modo: o.modo,
    }),
    ctx: contextoPadrao(o.ctx),
    agora: o.agora ?? SEGUNDA_AS_10H,
    conversa: [],
    proximoId: 1,
    resultados: [],
  };
}

function entradaDe(
  s: SessaoSimulada,
  texto: string | null,
  tipo: TipoDeEntrada,
  origem?: string,
): EntradaDeMensagem {
  return { id: `m${s.proximoId}`, tipo, texto, recebidaEm: s.agora, origem: origem ?? null };
}

/** O contato digita; o relógio anda `esperaS` segundos antes (padrão 30 s, acima do intervalo mínimo). */
export function digitar(
  sessao: SessaoSimulada,
  texto: string | null,
  o: { tipo?: TipoDeEntrada; esperaS?: number; origem?: string; id?: string | null } = {},
): { sessao: SessaoSimulada; resultado: ResultadoDoPasso } {
  const agora = sessao.agora + (o.esperaS ?? 30) * 1000;
  const base = { ...sessao, agora };
  const e = entradaDe(base, texto, o.tipo ?? "texto", o.origem);
  const entrada = o.id === undefined ? e : { ...e, id: o.id };
  const resultado = proximoPasso(sessao.estado, entrada, agora, sessao.ctx);
  return { sessao: seguir(base, texto ?? `[${o.tipo ?? "texto"}]`, resultado), resultado };
}

/**
 * `digitar` do jeito que o robô de verdade se comporta: com um telefone que não é celular brasileiro (lid,
 * número de fora) ele NÃO escreve, entrega a conversa à equipe com o evento e fica em silêncio. É o que o
 * orquestrador faz antes de chamar o motor. A tela usa esta; os testes do motor seguem com `digitar`, que
 * exercita o ramo `telefone_direto` do motor puro.
 */
export function digitarComoRobo(
  sessao: SessaoSimulada,
  texto: string | null,
  o: { tipo?: TipoDeEntrada; esperaS?: number; origem?: string; id?: string | null } = {},
): { sessao: SessaoSimulada; resultado: ResultadoDoPasso } {
  if (triagemPodeFalarCom(sessao.ctx.telefoneDoChat.normalizado)) return digitar(sessao, texto, o);
  const agora = sessao.agora + (o.esperaS ?? 30) * 1000;
  const base = { ...sessao, agora };
  // quem já foi entregue à equipe não muda de novo: o aviso é uma vez só
  const resultado =
    sessao.estado.status === "entregue_equipe"
      ? ({
          estado: sessao.estado,
          acao: "silencio",
          envio: null,
          gravar: {},
          eventos: [],
          avisarGrupo: null,
          bloquearContato: false,
          motivo: "ja_entregue_a_equipe",
        } satisfies ResultadoDoPasso)
      : entregaSemNumero(sessao.estado);
  return { sessao: seguir(base, texto ?? `[${o.tipo ?? "texto"}]`, resultado), resultado };
}

/** Várias mensagens de uma vez, na mesma janela. */
export function digitarEmRajada(
  sessao: SessaoSimulada,
  textos: string[],
  o: { esperaS?: number } = {},
): { sessao: SessaoSimulada; resultado: ResultadoDoPasso } {
  const agora = sessao.agora + (o.esperaS ?? 30) * 1000;
  const entradas = textos.map((t, i) => ({
    id: `m${sessao.proximoId + i}`,
    tipo: "texto" as const,
    texto: t,
    recebidaEm: agora + i * 1000,
    origem: null,
  }));
  const fim = agora + (textos.length - 1) * 1000;
  const resultado = processarRajada(sessao.estado, entradas, fim, sessao.ctx);
  const base = { ...sessao, agora: fim, proximoId: sessao.proximoId + textos.length - 1 };
  return { sessao: seguir(base, textos.join(" | "), resultado), resultado };
}

function seguir(base: SessaoSimulada, fala: string, resultado: ResultadoDoPasso): SessaoSimulada {
  return {
    ...base,
    estado: resultado.estado,
    proximoId: base.proximoId + 1,
    conversa: [
      ...base.conversa,
      { de: "contato", texto: fala },
      ...(resultado.envio ? [{ de: "robo" as const, texto: resultado.envio.texto }] : []),
    ],
    resultados: [...base.resultados, resultado],
  };
}

export function avancarRelogio(sessao: SessaoSimulada, segundos: number): SessaoSimulada {
  return { ...sessao, agora: sessao.agora + segundos * 1000 };
}

export function textosDoRobo(sessao: SessaoSimulada): string[] {
  return sessao.conversa.filter((f) => f.de === "robo").map((f) => f.texto);
}
