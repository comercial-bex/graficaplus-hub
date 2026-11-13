import {
  CONFIG_PADRAO_DA_TRIAGEM,
  type ConfigDaTriagem,
  type ContextoDaTriagem,
  type DadosColetados,
  type EntradaDeMensagem,
  type EnderecoDoCep,
  type EstadoDaTriagem,
  type EventoDaTriagem,
  type Feriado,
  type HorarioDaSemana,
  type PassoDaTriagem,
  type PassoDeTexto,
  type RespostaDoQuadro,
  type ResultadoDoPasso,
  type StatusDaTriagem,
  type TipoDeEntrada,
} from "./tipos";
import { DADOS_VAZIOS } from "./gravacao";
import { extrairCep, telefoneComCaraDeLid, triagemPodeFalarCom } from "./extrair";
import { md5 } from "./md5";
import { normalizarTexto } from "./normalizar";
import {
  entregaSemNumero,
  MOTIVO_SEM_NUMERO,
  processarRajada,
  prontoParaResponder,
  proximoPasso,
} from "./maquina";

export { entregaSemNumero, MOTIVO_SEM_NUMERO };

/**
 * A ligação da triagem com o mundo (Onda B, PR B5), escrita como função que
 * recebe uma PORTA: tudo que toca banco, rede, relógio ou espera entra por ela.
 * O servidor (`whatsapp-triagem.server.ts`) entrega a porta de verdade e os
 * testes entregam uma porta de mentira, então a ordem das chamadas e as falhas
 * são provadas sem banco.
 *
 * O CAMINHO, em ordem:
 *   1. lê só o estado da configuração. Desligada: sai aqui, sem tocar em mais nada
 *      (nem na conversa, nem em trava). É o estado de nascença;
 *   2. `triagem_ler_ou_abrir`: o portão do banco (equipe, grupo, robô, cliente
 *      cadastrado, bloqueado, volume, degrau da escada) e o instantâneo;
 *   3. se quem manda é a triagem (ou é ensaio), junta a rajada, consulta o CEP se
 *      a pessoa escreveu um, roda o motor puro e manda `triagem_aplicar`;
 *   4. se saiu mensagem de verdade, pede a rodada do despachante.
 *
 * NADA aqui lança: qualquer falha vira `{ acao: "erro" }` e um registro de erro
 * sem texto de mensagem. A mensagem do contato já está gravada quando isto roda,
 * e o 200 ao Z-API nunca depende da triagem. Falha na consulta do CEP é
 * silenciosa de propósito (não é erro de triagem e não conta no freio).
 *
 * REGRAS QUE ESTE ARQUIVO CARREGA (revisões de B5, 13/11/2026):
 *   - telefone com cara de lid, de fora, fixo ou vazio: a triagem NÃO escreve; entrega a conversa à equipe com o
 *     evento `pulou` (`entregaSemNumero`). Decide pelo formato, nunca por a conversa ter `chat_lid`;
 *   - ramo parceiro só por `leads.tipo_origem` anuncio ou palavra (`ramoDoLead`);
 *   - o ensaio não espera o intervalo mínimo;
 *   - `linhaDeTriagemPodeSair`: a despedida (status concluida, entregue_equipe, parada_pelo_contato) sai.
 *
 * PENDENTE (registrado em docs/ensaio-triagem-dados.md §8 e §8.1): responder pelo `chat_lid` (hoje essas conversas
 * vão para a equipe sem mensagem); idade máxima da mensagem na fila; prova sem sessão da página de parceiro; medir as
 * conversas de robô no ensaio; tempos e freios sem campo na tela.
 */

/** Espera máxima dentro do webhook para respeitar o intervalo mínimo entre mensagens automáticas. Só no envio real: o ensaio não espera. */
export const ESPERA_MAXIMA_MS = 20_000;
/** Pior caso da consulta de CEP: dois serviços em sequência, 2,5 s cada (`consultarCepRapido`). */
export const CEP_PIOR_CASO_MS = 5_000;
/** Tentativas de aplicar quando o banco devolve conflito de versão (leitura velha). */
const TENTATIVAS_DE_APLICAR = 2;

export type LinhaDeEntrada = {
  id: string;
  tipo: string;
  texto: string | null;
  legenda: string | null;
  origem: string | null;
  /** ISO. Usa recebido_em quando existir, senão created_at. */
  recebidaEm: string | null;
};

export type PortaDaTriagem = {
  /** Estado da configuração (`desligada`, `ensaio`...). Nulo quando não há linha. */
  estadoDaConfiguracao(): Promise<string | null>;
  lerOuAbrir(
    conversaId: string,
    mensagemId: string,
    contexto: { eh_grupo: boolean },
  ): Promise<unknown>;
  lerEntradas(ids: string[]): Promise<LinhaDeEntrada[]>;
  /** Consulta de CEP com tempo curto. Pode devolver nulo ou lançar: o orquestrador ignora as duas coisas. */
  consultarCep(cep: string): Promise<EnderecoDoCep | null>;
  aplicar(triagemId: string, versao: number, resultado: Record<string, unknown>): Promise<unknown>;
  /** Pede a rodada do despachante para a mensagem que acabou de entrar na fila. */
  despachar(): Promise<void>;
  esperar(ms: number): Promise<void>;
  /** Deixa o rastro do erro: só etapa e código curto, nunca texto de mensagem. */
  registrarErro(a: {
    conversaId: string;
    mensagemId: string | null;
    etapa: string;
    codigo: string;
  }): Promise<void>;
  agora(): number;
};

export type ResultadoDaLigacao =
  | { acao: "nada"; motivo: string; dono?: string | null }
  | {
      acao: "processada";
      enviou: boolean;
      ensaio: boolean;
      status: StatusDaTriagem | null;
      passo: PassoDaTriagem | null;
      motivo: string | null;
    }
  | { acao: "erro"; etapa: string };

/* ------------------------------------------------------------------ */
/* Leitura defensiva do que o banco devolve                            */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;

function objeto(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}
function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function txt(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
function num(v: unknown, padrao: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : padrao;
}
function bool(v: unknown): boolean {
  return v === true;
}
function ms(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const PASSOS: readonly PassoDaTriagem[] = [
  "nome",
  "sobrenome",
  "primeira_vez",
  "cep",
  "telefone",
  "telefone_novo",
  "fechamento",
  "parceiro_nome",
  "parceiro_link",
];
const STATUS: readonly StatusDaTriagem[] = [
  "ativa",
  "concluida",
  "expirada",
  "pausada_humano",
  "pausada_desligada",
  "parada_pelo_contato",
  "entregue_equipe",
  "pulada",
  "ensaio",
];

/** `leads.tipo` guarda cliente_final ou parceiro; o motor fala cliente ou parceiro. */
function tipoDoLead(v: unknown): "parceiro" | "cliente" | null {
  if (v === "parceiro") return "parceiro";
  if (v === "cliente_final" || v === "cliente") return "cliente";
  return null;
}

/**
 * O ramo parceiro só abre por anúncio mapeado ou por palavra escrita. Lead de tipo parceiro
 * cuja origem é `telefone` (número já conhecido) ou `manual` (a equipe marcou à mão) não
 * decide o ramo: cai no ramo cliente, que não fala de parceria nem de tabela. A origem
 * também é o motivo que o banco guarda no ramo.
 */
export function ramoDoLead(lead: Obj | null): {
  leadTipo: "parceiro" | "cliente" | null;
  leadOrigem: "anuncio" | "palavra" | null;
} {
  const tipo = lead ? tipoDoLead(lead.tipo) : null;
  const origem = lead ? lead.tipo_origem : null;
  if (tipo !== "parceiro") return { leadTipo: tipo, leadOrigem: null };
  if (origem === "anuncio" || origem === "palavra") return { leadTipo: "parceiro", leadOrigem: origem };
  return { leadTipo: "cliente", leadOrigem: null };
}

export function estadoDoBanco(linha: unknown): EstadoDaTriagem | null {
  const t = objeto(linha);
  const id = t ? txt(t.id) : null;
  const conversaId = t ? txt(t.conversa_id) : null;
  if (!t || !id || !conversaId) return null;
  const passo = PASSOS.find((p) => p === t.passo) ?? null;
  const status = STATUS.find((s) => s === t.status) ?? "ativa";
  const endereco = objeto(t.cep_endereco);
  const dados: DadosColetados = {
    ...DADOS_VAZIOS,
    nomeInformado: txt(t.nome_informado),
    nomeCompleto: bool(t.nome_completo),
    primeiraVez:
      t.primeira_vez === "sim" ||
      t.primeira_vez === "nao" ||
      t.primeira_vez === "ja_cliente" ||
      t.primeira_vez === "nao_sei"
        ? t.primeira_vez
        : null,
    cep: txt(t.cep),
    cepEndereco: endereco
      ? {
          cep: txt(endereco.cep) ?? txt(t.cep) ?? "",
          rua: txt(endereco.rua),
          bairro: txt(endereco.bairro),
          cidade: txt(endereco.cidade),
          estado: txt(endereco.estado),
        }
      : null,
    enderecoTexto: txt(t.endereco_texto),
    enderecoRecusado: bool(t.endereco_recusado),
    telefoneConfirmado:
      t.telefone_confirmado === "sim" ||
      t.telefone_confirmado === "alternativo" ||
      t.telefone_confirmado === "pendente"
        ? t.telefone_confirmado
        : null,
    telefoneAlternativo: txt(t.telefone_alternativo),
    telefoneAlternativoVerificado: false,
    pediuPreco: bool(t.pediu_preco),
    pediuTabelaEspecial: bool(t.pediu_tabela_especial),
    pediuEquipe: bool(t.pediu_equipe),
    pediuParceria: bool(t.pediu_parceria),
    mandouAudio: bool(t.mandou_audio),
    reclamou: bool(t.reclamou),
  };
  return {
    triagemId: id,
    conversaId,
    modo: t.modo === "ensaio" ? "ensaio" : "real",
    ramo: t.ramo === "parceiro" ? "parceiro" : "cliente",
    ramoMotivo:
      t.ramo_motivo === "anuncio_mapeado" || t.ramo_motivo === "palavra" ? t.ramo_motivo : "padrao",
    status,
    passo,
    tentativasPasso: num(t.tentativas_passo, 0),
    mensagensEnviadas: num(t.mensagens_enviadas, 0),
    avisosAudio: num(t.avisos_audio, 0),
    avisosArquivo: num(t.avisos_arquivo, 0),
    audios: num(t.audios, 0),
    figurinhas: num(t.figurinhas, 0),
    perguntasDePreco: num(t.perguntas_de_preco, 0),
    etapasEsgotadasSeguidas: num(t.etapas_esgotadas_seguidas, 0),
    versao: num(t.versao, 0),
    dados,
    ultimaEntradaId: txt(t.ultima_entrada_id),
    ultimaEntradaEm: ms(t.ultima_entrada_em),
    // o banco guarda só o md5; quem preenche o texto é `comHashDaUltimaEntrada`
    ultimaEntradaNormalizada: null,
    ultimoEnvioEm: ms(t.ultimo_envio_em),
    avisoGrupoDecidido: bool(t.aviso_grupo_decidido),
    motivoFim: txt(t.motivo_fim),
  };
}

export function configDoBanco(linha: unknown): ConfigDaTriagem {
  const c = objeto(linha) ?? {};
  const p = CONFIG_PADRAO_DA_TRIAGEM;
  return {
    maxMensagens: num(c.max_mensagens, p.maxMensagens),
    maxTentativasPorPasso: num(c.max_tentativas_por_passo, p.maxTentativasPorPasso),
    intervaloMinimoS: num(c.intervalo_minimo_s, p.intervaloMinimoS),
    esperaRespostaMin: num(c.espera_resposta_min, p.esperaRespostaMin),
    retomarAteHoras: num(c.retomar_ate_horas, p.retomarAteHoras),
    atrasoMinS: num(c.atraso_min_s, p.atrasoMinS),
    atrasoMaxS: num(c.atraso_max_s, p.atrasoMaxS),
    respostaRapidaDemaisMs: num(c.resposta_rapida_demais_ms, p.respostaRapidaDemaisMs),
    exibirTelefone: c.exibir_telefone === "inteiro" ? "inteiro" : "final",
    linkParceiro: txt(c.link_parceiro),
    dddPadrao: txt(c.ddd_padrao),
  };
}

export function passosDoBanco(linhas: unknown): PassoDeTexto[] {
  return lista(linhas).flatMap((l) => {
    const p = objeto(l);
    const codigo = p ? txt(p.codigo) : null;
    const texto = p ? txt(p.texto) : null;
    if (!p || !codigo || !texto) return [];
    return [
      {
        codigo,
        ramo: p.ramo === "parceiro" ? ("parceiro" as const) : ("cliente" as const),
        texto,
        variantes: lista(p.variantes).filter((v): v is string => typeof v === "string"),
        repeticao: txt(p.repeticao),
        ativo: p.ativo !== false,
      },
    ];
  });
}

const INTENCOES_DO_QUADRO = new Set([
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
]);

export function quadroDoBanco(linhas: unknown): RespostaDoQuadro[] {
  return lista(linhas).flatMap((l) => {
    const r = objeto(l);
    const frase = r ? txt(r.frase) : null;
    const intencao = r ? txt(r.intencao) : null;
    const casamento = r ? r.casamento : null;
    if (!r || !frase || !intencao || !INTENCOES_DO_QUADRO.has(intencao)) return [];
    if (casamento !== "igual" && casamento !== "comeca" && casamento !== "contem") return [];
    return [
      {
        passo: txt(r.passo),
        intencao: intencao as RespostaDoQuadro["intencao"],
        frase,
        casamento,
      },
    ];
  });
}

export function horarioDoBanco(h: unknown): ContextoDaTriagem["horario"] {
  const o = objeto(h) ?? {};
  const semana: HorarioDaSemana[] = lista(o.semana).flatMap((d) => {
    const x = objeto(d);
    const abre = x ? txt(x.abre) : null;
    const fecha = x ? txt(x.fecha) : null;
    if (!x || typeof x.diaSemana !== "number" || !abre || !fecha) return [];
    return [{ diaSemana: x.diaSemana, abre, fecha, ativo: x.ativo === true }];
  });
  const feriados: Feriado[] = lista(o.feriados).flatMap((f) => {
    const x = objeto(f);
    const data = x ? txt(x.data) : null;
    if (!x || !data) return [];
    return [
      {
        data: data.slice(0, 10),
        fechado: x.fechado !== false,
        abre: txt(x.abre),
        fecha: txt(x.fecha),
      },
    ];
  });
  return { semana, feriados };
}

export function contextoDoBanco(snap: Obj): ContextoDaTriagem {
  const conversa = objeto(snap.conversa) ?? {};
  const lead = objeto(snap.lead);
  const ramoDoContato = ramoDoLead(lead);
  return {
    config: configDoBanco(snap.config),
    quadro: quadroDoBanco(snap.quadro),
    passos: passosDoBanco(snap.passos),
    horario: horarioDoBanco(snap.horario),
    // ehLid decide pelo FORMATO do telefone, nunca por `tem_chat_lid`: quase toda conversa tem um lid guardado
    // junto do telefone real, e o motor só mostra o "número terminado em" quando o telefone é de verdade
    telefoneDoChat: {
      normalizado: txt(conversa.telefone_normalizado),
      ehLid: telefoneComCaraDeLid(txt(conversa.telefone_normalizado)),
    },
    humanoNaConversa: false,
    automaticasDeFora: num(snap.automaticas_de_fora, 0),
    leadTipo: ramoDoContato.leadTipo,
    leadOrigem: ramoDoContato.leadOrigem,
  };
}

/* ------------------------------------------------------------------ */
/* Entradas                                                            */
/* ------------------------------------------------------------------ */

const TIPO_DA_ENTRADA: Record<string, TipoDeEntrada> = {
  texto: "texto",
  audio: "audio",
  imagem: "imagem",
  documento: "documento",
  video: "video",
  sticker: "figurinha",
  localizacao: "localizacao",
  contato: "contato",
};

/** Mensagem do banco no formato do motor. `sistema` e tipo desconhecido não entram. */
export function entradaDaLinha(l: LinhaDeEntrada): EntradaDeMensagem | null {
  const tipo = TIPO_DA_ENTRADA[l.tipo];
  const quando = l.recebidaEm ? Date.parse(l.recebidaEm) : NaN;
  if (!tipo || !Number.isFinite(quando)) return null;
  return {
    id: l.id,
    tipo,
    texto: tipo === "texto" ? (l.texto ?? l.legenda) : (l.legenda ?? l.texto),
    recebidaEm: quando,
    origem: l.origem,
  };
}

/**
 * O banco guarda só o md5 da última mensagem normalizada. Se o md5 da primeira
 * mensagem desta rodada for igual, o motor recebe o texto normalizado dela (a
 * comparação de "texto repetido" é de igualdade); se não for, recebe nulo.
 */
export function comHashDaUltimaEntrada(
  estado: EstadoDaTriagem,
  hashGuardado: string | null,
  primeira: EntradaDeMensagem | undefined,
): EstadoDaTriagem {
  if (!hashGuardado || !primeira || primeira.tipo !== "texto") return estado;
  const norm = normalizarTexto(primeira.texto);
  return norm && md5(norm) === hashGuardado
    ? { ...estado, ultimaEntradaNormalizada: norm }
    : estado;
}

/* ------------------------------------------------------------------ */
/* Do resultado do motor para o que o banco aceita                     */
/* ------------------------------------------------------------------ */

const CHAVE_PROIBIDA =
  /^(texto|text|mensagem|conteudo|body|nome|telefone|phone|cep|endereco|email|resposta|frase)$/;
const CODIGO = /^[a-z][a-z0-9_]{0,40}$/;
const VARIAVEL = /^[a-z_]{1,40}$/;

function codigoLimpo(c: string): string {
  return c.replace(/~/g, "_").replace(/\+/g, "_");
}

/**
 * O detalhe de um evento nunca leva texto, nome, telefone ou CEP: o banco recusa
 * a chave e o evento vira `erro`, que pesa no freio automático. Aqui se tira a
 * chave proibida e se deixa só o que o banco aceita.
 */
export function limparDetalhe(d: EventoDaTriagem["detalhe"]): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d ?? {})) {
    if (CHAVE_PROIBIDA.test(k)) continue;
    if (k === "codigos" && Array.isArray(v)) {
      saida[k] = v.map((c) => codigoLimpo(String(c))).filter((c) => CODIGO.test(c));
    } else if (k === "variaveis" && Array.isArray(v)) {
      saida[k] = v.map(String).filter((c) => VARIAVEL.test(c));
    } else if (typeof v === "string") {
      saida[k] = v.slice(0, 80);
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      saida[k] = v;
    } else if (Array.isArray(v)) {
      saida[k] = v
        .filter((x) => typeof x === "string")
        .map((x) => String(x).slice(0, 60))
        .slice(0, 12);
    }
  }
  return saida;
}

const TIPOS_DE_EVENTO_DO_MOTOR = new Set([
  "interpretada",
  "pulou",
  "pausa",
  "texto_barrado",
  "gate",
  "erro",
]);

function gravarParaBanco(g: Partial<DadosColetados>): Record<string, unknown> {
  const m: Record<string, string> = {
    nomeInformado: "nome_informado",
    nomeCompleto: "nome_completo",
    primeiraVez: "primeira_vez",
    cep: "cep",
    cepEndereco: "cep_endereco",
    enderecoTexto: "endereco_texto",
    enderecoRecusado: "endereco_recusado",
    telefoneConfirmado: "telefone_confirmado",
    telefoneAlternativo: "telefone_alternativo",
    pediuPreco: "pediu_preco",
    pediuTabelaEspecial: "pediu_tabela_especial",
    pediuEquipe: "pediu_equipe",
    pediuParceria: "pediu_parceria",
    mandouAudio: "mandou_audio",
    reclamou: "reclamou",
  };
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    const coluna = m[k];
    if (coluna && v !== undefined) saida[coluna] = v;
  }
  return saida;
}

/** O `p_resultado` de `triagem_aplicar`. Só código e dado do contato na coluna certa; nenhum texto vai em evento. */
export function resultadoParaAplicar(
  res: ResultadoDoPasso,
  a: { mensagemId: string; outrasMensagens: string[] },
): Record<string, unknown> {
  const e = res.estado;
  const estado: Record<string, unknown> = {
    status: e.status,
    passo: e.passo,
    ramo: e.ramo,
    ramo_motivo: e.ramoMotivo,
    tentativas_passo: e.tentativasPasso,
    mensagens_enviadas: e.mensagensEnviadas,
    avisos_audio: e.avisosAudio,
    avisos_arquivo: e.avisosArquivo,
    audios: e.audios,
    figurinhas: e.figurinhas,
    perguntas_de_preco: e.perguntasDePreco,
    etapas_esgotadas_seguidas: e.etapasEsgotadasSeguidas,
  };
  if (e.motivoFim) estado.motivo_fim = e.motivoFim;
  if (e.ultimaEntradaNormalizada) estado.ultima_entrada_hash = md5(e.ultimaEntradaNormalizada);

  const saida: Record<string, unknown> = {
    mensagem_id: a.mensagemId,
    mensagens_ids: a.outrasMensagens,
    estado,
    gravar: gravarParaBanco(res.gravar),
    eventos: res.eventos
      .filter((ev) => TIPOS_DE_EVENTO_DO_MOTOR.has(ev.tipo))
      .map((ev) => ({
        tipo: ev.tipo,
        passo: ev.passo,
        intencao: ev.intencao,
        detalhe: limparDetalhe(ev.detalhe),
      })),
  };
  if (res.envio) {
    saida.envio = {
      texto: res.envio.texto,
      chave: res.envio.chaveDeIdempotencia,
      atraso_s: res.envio.atrasoS,
      passo: e.passo,
      ordem: res.envio.ordem,
      codigos: res.envio.codigos.map(codigoLimpo).filter((c) => CODIGO.test(c)),
      variaveis: res.envio.variaveis.filter((v) => VARIAVEL.test(v)),
    };
  }
  if (res.avisarGrupo) {
    saida.aviso_grupo = {
      motivo: res.avisarGrupo.motivo,
      marcas: res.avisarGrupo.marcas.filter((m) => /^[a-z_]{1,30}$/.test(m)),
    };
  }
  if (res.bloquearContato) saida.bloquear_contato = true;
  return saida;
}

/* ------------------------------------------------------------------ */
/* CEP                                                                 */
/* ------------------------------------------------------------------ */

const PASSOS_ANTES_DO_CEP: readonly (PassoDaTriagem | null)[] = [
  "nome",
  "sobrenome",
  "primeira_vez",
  "cep",
];

/** Qual CEP vale consultar nesta rodada? O que a pessoa escreveu no passo do CEP (ou em rajada até ele). */
export function cepParaConsultar(
  estado: Pick<EstadoDaTriagem, "passo" | "ramo">,
  entradas: readonly EntradaDeMensagem[],
): string | null {
  if (estado.ramo !== "cliente") return null;
  const vale =
    estado.passo === "cep" || (entradas.length > 1 && PASSOS_ANTES_DO_CEP.includes(estado.passo));
  if (!vale) return null;
  for (const e of entradas) {
    if (e.tipo !== "texto") continue;
    const cep = extrairCep(e.texto);
    if (cep.ok) return cep.cep;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* O caminho inteiro                                                   */
/* ------------------------------------------------------------------ */

function codigoDoErro(e: unknown): string {
  const bruto =
    e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string"
      ? (e as { code: string }).code
      : e instanceof Error
        ? e.name
        : "erro";
  const limpo = bruto
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 40);
  return limpo || "erro";
}

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

type Tentativa = { conflito: true } | ResultadoDaLigacao;

async function umaTentativa(
  porta: PortaDaTriagem,
  a: { conversaId: string; mensagemId: string; ehGrupo: boolean },
): Promise<Tentativa> {
  const bruto = await noPasso("ler_ou_abrir", () =>
    porta.lerOuAbrir(a.conversaId, a.mensagemId, { eh_grupo: a.ehGrupo }),
  );
  const snap = objeto(bruto);
  if (!snap) throw new Falha("ler_ou_abrir", new Error("resposta_vazia"));
  const dono = txt(snap.dono);
  const triagem = objeto(snap.triagem);
  // ensaio não é dono, mas a triagem interpreta e anota o que faria
  if (!triagem || !(dono === "triagem" || snap.ensaio === true)) {
    return { acao: "nada", motivo: txt(snap.motivo) ?? `dono_${dono ?? "desconhecido"}`, dono };
  }
  const estadoBase = estadoDoBanco(triagem);
  if (!estadoBase) throw new Falha("ler_ou_abrir", new Error("triagem_ilegivel"));
  const ctxBase = contextoDoBanco(snap);

  const ids = [
    ...new Set([
      ...lista(snap.pendentes).filter((x): x is string => typeof x === "string"),
      a.mensagemId,
    ]),
  ];
  const linhas = await noPasso("ler_entradas", () => porta.lerEntradas(ids));
  const entradas = linhas
    .map(entradaDaLinha)
    .filter((e): e is EntradaDeMensagem => e !== null)
    .sort((x, y) => x.recebidaEm - y.recebidaEm || String(x.id).localeCompare(String(y.id)));
  if (!entradas.some((e) => e.id === a.mensagemId)) {
    return { acao: "nada", motivo: "mensagem_nao_e_texto_ou_midia", dono };
  }

  // telefone sem cara de celular brasileiro (lid, número de fora): nada de mensagem, a equipe assume
  const semNumero = !triagemPodeFalarCom(ctxBase.telefoneDoChat.normalizado);

  // intervalo mínimo entre duas mensagens automáticas: espera em vez de descartar a resposta. O ENSAIO não espera: nada
  // sai de verdade nele, e a espera (até 20 s dentro do webhook) atrasaria a resposta da assistente, que segue
  // respondendo durante o ensaio e roda depois da triagem.
  const pronto = prontoParaResponder(estadoBase, porta.agora(), ctxBase.config);
  if (!pronto.pode && snap.ensaio !== true && !semNumero) {
    await porta.esperar(Math.min(pronto.esperarMs, ESPERA_MAXIMA_MS));
  }

  // CEP: tempo curto e falha silenciosa; sem endereço o motor grava só o CEP
  let enderecoDoCep: EnderecoDoCep | null = null;
  const cep = semNumero ? null : cepParaConsultar(estadoBase, entradas);
  if (cep) {
    try {
      enderecoDoCep = await porta.consultarCep(cep);
    } catch {
      enderecoDoCep = null;
    }
  }
  const ctx: ContextoDaTriagem = { ...ctxBase, enderecoDoCep };
  const estado = comHashDaUltimaEntrada(estadoBase, txt(triagem.ultima_entrada_hash), entradas[0]);

  const agora = porta.agora();
  const { res, payload } = await noPasso("motor", async () => {
    const r = semNumero
      ? entregaSemNumero(estado)
      : entradas.length > 1
        ? processarRajada(estado, entradas, agora, ctx)
        : proximoPasso(estado, entradas[0], agora, ctx);
    return {
      res: r,
      payload: resultadoParaAplicar(r, {
        mensagemId: a.mensagemId,
        outrasMensagens: entradas
          .map((e) => e.id)
          .filter((id): id is string => !!id && id !== a.mensagemId),
      }),
    };
  });

  const resposta = objeto(
    await noPasso("aplicar", () =>
      porta.aplicar(estado.triagemId, num(triagem.versao, 0), payload),
    ),
  );
  if (!resposta) throw new Falha("aplicar", new Error("resposta_vazia"));
  if (resposta.conflito === true) return { conflito: true };
  if (resposta.ok === false)
    return { acao: "nada", motivo: txt(resposta.motivo) ?? "aplicar_recusou", dono };
  if (resposta.duplicada === true)
    return { acao: "nada", motivo: txt(resposta.motivo) ?? "entrada_repetida", dono };
  if (typeof resposta.pausada === "string") {
    return { acao: "nada", motivo: txt(resposta.motivo) ?? String(resposta.pausada), dono };
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
    enviou,
    ensaio: resposta.ensaio === true,
    status: res.estado.status,
    passo: res.estado.passo,
    motivo: res.motivo,
  };
}

/**
 * A função que o webhook chama depois de gravar a mensagem e antes da assistente.
 * Nunca lança.
 */
export async function rodarTriagem(
  porta: PortaDaTriagem,
  a: { conversaId: string; mensagemId: string; ehGrupo?: boolean },
): Promise<ResultadoDaLigacao> {
  let etapa = "interno";
  try {
    // PRIMEIRA LINHA: desligada (o estado de nascença) sai sem tocar em mais nada
    const estado = await noPasso("configuracao", () => porta.estadoDaConfiguracao());
    if (estado === null || estado === "desligada") {
      return { acao: "nada", motivo: estado === null ? "sem_configuracao" : "desligada" };
    }
    for (let i = 0; i < TENTATIVAS_DE_APLICAR; i++) {
      const r = await umaTentativa(porta, {
        conversaId: a.conversaId,
        mensagemId: a.mensagemId,
        ehGrupo: !!a.ehGrupo,
      });
      if (!("conflito" in r)) return r;
    }
    // dois conflitos seguidos: a próxima mensagem (ou a varredura) resolve; nada se perde
    return { acao: "nada", motivo: "conflito_de_versao" };
  } catch (e) {
    if (e instanceof Falha) etapa = e.etapa;
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
/* Regras de dono e de despacho                                        */
/* ------------------------------------------------------------------ */

/**
 * Quem manda na conversa é UMA fonte: `triagem_dono_da_conversa`. A assistente
 * só responde quando o dono é ela. Resposta que não seja exatamente
 * `assistente` (inclusive erro de leitura) é silêncio: na dúvida, ninguém fala.
 */
export function assistentePodeResponder(dono: unknown): { pode: boolean; motivo: string } {
  if (dono === "assistente") return { pode: true, motivo: "dono_assistente" };
  if (dono === "triagem" || dono === "ninguem") return { pode: false, motivo: `dono_${dono}` };
  return { pode: false, motivo: "dono_indefinido" };
}

export type SituacaoDaLinhaDeTriagem = {
  /** `whatsapp_triagens.status`; nulo se a triagem sumiu. */
  statusDaTriagem: string | null;
  modoDaTriagem: string | null;
  /** `_triagem_degrau_permite`: o degrau atual da escada deixa esta conversa continuar. */
  degrauPermite: boolean;
  /** `_triagem_humano_na_conversa`: gente respondeu, assumiu ou arquivou. */
  humanoNaConversa: boolean;
  /**
   * O telefone da conversa (`whatsapp_conversas.telefone`, o mesmo que o despachante usa) é um celular
   * brasileiro? Lid, número de fora e fixo não são: a triagem nunca manda para eles.
   */
  telefoneAlcancavel: boolean;
};

/**
 * Status em que a triagem JÁ TERMINOU e a mensagem que está na fila é a última dela. `triagem_aplicar` grava o
 * status final na MESMA transação em que enfileira a mensagem de fechamento, o link de parceiro, o aviso de
 * equipe ou o aviso de parar; então, quando a linha chega ao consumidor, o status já é um destes. Cancelar por
 * eles apagaria justamente a despedida. O banco concorda: `triagem_enviar` só barra `pausada_humano`,
 * `pausada_desligada` e `pulada`, e a varredura só cancela fila dessas três.
 */
export const STATUS_TERMINAIS_QUE_FALAM = ["concluida", "entregue_equipe", "parada_pelo_contato"] as const;

/**
 * Antes de despachar uma linha de triagem, o consumidor da fila confere a
 * triagem. Qualquer dúvida cancela: a janela entre enfileirar e enviar é onde
 * a equipe pode ter respondido, a escada ter descido ou a triagem ter parado.
 *
 *   ativa                                  pergunta: sai
 *   concluida, entregue_equipe,
 *   parada_pelo_contato                    despedida: sai (é a última mensagem da triagem)
 *   pausada_humano, pausada_desligada,
 *   pulada, expirada, ensaio, sumiu        cancela
 *
 * Nos dois casos que saem, gente na conversa e degrau desligado continuam cancelando: a equipe que entrou
 * depois do fechamento enfileirado fala por si, e "Desligar tudo" vale também para a despedida.
 */
export function linhaDeTriagemPodeSair(s: SituacaoDaLinhaDeTriagem): {
  sai: boolean;
  motivo: string;
} {
  if (s.statusDaTriagem === null) return { sai: false, motivo: "triagem_nao_existe" };
  if (s.modoDaTriagem !== "real") return { sai: false, motivo: "triagem_em_ensaio" };
  const terminal = (STATUS_TERMINAIS_QUE_FALAM as readonly string[]).includes(s.statusDaTriagem);
  if (s.statusDaTriagem !== "ativa" && !terminal) {
    return { sai: false, motivo: `triagem_${s.statusDaTriagem}` };
  }
  if (!s.telefoneAlcancavel) return { sai: false, motivo: MOTIVO_SEM_NUMERO };
  if (s.humanoNaConversa) return { sai: false, motivo: "humano_na_conversa" };
  if (!s.degrauPermite) return { sai: false, motivo: "fora_do_degrau" };
  return { sai: true, motivo: terminal ? "ok_despedida" : "ok" };
}
