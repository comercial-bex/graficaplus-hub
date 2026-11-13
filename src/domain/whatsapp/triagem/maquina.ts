import { chaveWhatsApp } from "@/domain/documentos";
import { aplicarDadosNovos, DADOS_VAZIOS, subirRamo } from "./gravacao";
import {
  extrairCep,
  extrairNome,
  extrairSobrenome,
  extrairTelefone,
  finalDoTelefone,
  pareceEndereco,
  telefoneDoChatUtilizavel,
} from "./extrair";
import { dentroDoHorario, horarioEmTexto } from "./horario";
import { ehSoMarcaDeEmoji, normalizarTexto } from "./normalizar";
import { detectarRobo } from "./portao";
import { ehPalavraDeParceiro, interpretar, type Interpretacao } from "./quadro";
import { atrasoHumanizado, escolherVariante, preencher } from "./textos";
import { verificarTexto } from "./verificador";
import {
  emMs,
  STATUS_ENCERRADOS,
  type AvisoParaOGrupo,
  type ContextoDaTriagem,
  type DadosColetados,
  type EntradaDeMensagem,
  type EnvioDaTriagem,
  type EstadoDaTriagem,
  type EventoDaTriagem,
  type MotivoDoAviso,
  type MotivoDoRamo,
  type PassoDaTriagem,
  type PassoDeTexto,
  type Ramo,
  type ResultadoDoPasso,
} from "./tipos";

/**
 * A máquina de estados da triagem de boas-vindas, em função pura.
 *
 * `proximoPasso(estado, entrada, agora, contexto)` devolve o novo estado, o que
 * enviar (se enviar), o que gravar, os eventos e o aviso do grupo. Não lê banco,
 * não envia nada e não tem relógio interno. A IA não participa.
 *
 * Princípios que o código garante, e que os testes de propriedade conferem:
 *  - nenhum texto sai sem passar por `verificarTexto` do ramo, já montado;
 *  - nunca passa do teto de mensagens (padrão 8), contando as automáticas de fora;
 *  - sempre existe saída: cada pergunta é feita no máximo 2 vezes e depois o fluxo
 *    segue com o que tem ou entrega à equipe; "parar" encerra em qualquer passo;
 *  - o ramo parceiro só abre por `leadTipo` parceiro (Onda A) ou palavra de
 *    parceiro na mensagem curta do passo do nome, e nunca desce;
 *  - nunca responde valor: pedido de preço recebe a frase de passar para a equipe.
 */

/* ------------------------------------------------------------------ */
/* Estado inicial e ramo                                               */
/* ------------------------------------------------------------------ */

export function estadoInicial(a: {
  triagemId: string;
  conversaId: string;
  modo?: "ensaio" | "real";
}): EstadoDaTriagem {
  return {
    triagemId: a.triagemId,
    conversaId: a.conversaId,
    modo: a.modo ?? "real",
    ramo: "cliente",
    ramoMotivo: "padrao",
    status: a.modo === "ensaio" ? "ensaio" : "ativa",
    passo: null,
    tentativasPasso: 0,
    mensagensEnviadas: 0,
    avisosAudio: 0,
    avisosArquivo: 0,
    audios: 0,
    figurinhas: 0,
    perguntasDePreco: 0,
    etapasEsgotadasSeguidas: 0,
    versao: 0,
    dados: { ...DADOS_VAZIOS },
    ultimaEntradaId: null,
    ultimaEntradaEm: null,
    ultimaEntradaNormalizada: null,
    ultimoEnvioEm: null,
    avisoGrupoDecidido: false,
    motivoFim: null,
  };
}

/**
 * Escolha do ramo. Cliente final por padrão. Parceiro só se o lead da conversa
 * já é parceiro (Onda A: anúncio mapeado ou telefone de parceiro) ou se a pessoa
 * escreveu a palavra de parceiro, em mensagem curta, ANTES de dar o nome. O ramo
 * só sobe: parceiro nunca desce para cliente final no meio da conversa.
 */
export function escolherRamo(a: {
  ramoAtual: Ramo;
  motivoAtual: MotivoDoRamo;
  leadTipo?: "parceiro" | "cliente" | null;
  texto: string | null;
  passo: PassoDaTriagem | null;
  nomeJaInformado: boolean;
  quadro: ContextoDaTriagem["quadro"];
}): { ramo: Ramo; motivo: MotivoDoRamo; subiu: boolean } {
  if (a.ramoAtual === "parceiro") return { ramo: "parceiro", motivo: a.motivoAtual, subiu: false };
  // só antes de qualquer pergunta respondida: nunca sobe depois do passo do nome
  const podeSubir = a.passo === null || (a.passo === "nome" && !a.nomeJaInformado);
  if (podeSubir && a.leadTipo === "parceiro")
    return { ramo: "parceiro", motivo: "anuncio_mapeado", subiu: true };
  // pedido misto ("quero ser parceiro e saber o valor") não troca o ramo: vai para a equipe com a pergunta de preço
  if (podeSubir && ehPalavraDeParceiro(a.texto, a.quadro)) {
    return { ramo: subirRamo(a.ramoAtual, "parceiro"), motivo: "palavra", subiu: true };
  }
  return { ramo: "cliente", motivo: a.motivoAtual, subiu: false };
}

/* ------------------------------------------------------------------ */
/* Tempo                                                               */
/* ------------------------------------------------------------------ */

/** A conversa pode ser respondida agora? Respeita o intervalo mínimo entre mensagens automáticas. */
export function prontoParaResponder(
  estado: EstadoDaTriagem,
  agora: Date | number,
  config: ContextoDaTriagem["config"],
): { pode: boolean; esperarMs: number } {
  if (estado.ultimoEnvioEm === null) return { pode: true, esperarMs: 0 };
  const falta = estado.ultimoEnvioEm + config.intervaloMinimoS * 1000 - emMs(agora);
  return falta > 0 ? { pode: false, esperarMs: falta } : { pode: true, esperarMs: 0 };
}

/** Agrupa mensagens que chegaram dentro da janela da primeira (rajada), em vez de descartá-las. */
export function agruparRajada(
  entradas: readonly EntradaDeMensagem[],
  janelaMs: number,
): EntradaDeMensagem[][] {
  const ordenadas = [...entradas].sort((x, y) => x.recebidaEm - y.recebidaEm);
  const grupos: EntradaDeMensagem[][] = [];
  for (const e of ordenadas) {
    const atual = grupos[grupos.length - 1];
    if (atual && e.recebidaEm - atual[0].recebidaEm <= janelaMs) atual.push(e);
    else grupos.push([e]);
  }
  return grupos;
}

/** Silêncio de 30 minutos com a etapa aberta: quem varre é a rodada do despachante. */
export function silenciouDemais(
  estado: EstadoDaTriagem,
  agora: Date | number,
  config: ContextoDaTriagem["config"],
): boolean {
  if (estado.passo === null || (estado.status !== "ativa" && estado.status !== "ensaio"))
    return false;
  const base = Math.max(estado.ultimaEntradaEm ?? 0, estado.ultimoEnvioEm ?? 0);
  return base > 0 && emMs(agora) - base >= config.esperaRespostaMin * 60_000;
}

/** Rodada de varredura: expira a triagem parada. Sem envio, sem lembrete. */
export function expirarTriagem(
  estado: EstadoDaTriagem,
  agora: Date | number,
  config: ContextoDaTriagem["config"],
): ResultadoDoPasso {
  const inicial = estado;
  const e: EstadoDaTriagem = { ...estado, dados: { ...estado.dados } };
  const eventos: EventoDaTriagem[] = [];
  let aviso: AvisoParaOGrupo | null = null;
  if (silenciouDemais(estado, agora, config)) {
    e.status = "expirada";
    e.motivoFim = "silencio";
    e.versao += 1;
    const temDado = !!(
      e.dados.nomeInformado ||
      e.dados.cep ||
      e.dados.primeiraVez ||
      e.dados.telefoneAlternativo ||
      e.dados.enderecoTexto ||
      e.dados.pediuPreco
    );
    if (temDado && !e.avisoGrupoDecidido) {
      e.avisoGrupoDecidido = true;
      aviso = { motivo: "expirada", marcas: marcasDe(e.dados) };
      eventos.push({
        tipo: "aviso_grupo",
        passo: e.passo,
        intencao: null,
        detalhe: { motivo: "expirada" },
      });
    }
    eventos.push({
      tipo: "pulou",
      passo: e.passo,
      intencao: null,
      detalhe: { motivo: "expirada_por_silencio" },
    });
  }
  return {
    estado: e,
    acao: "silencio",
    envio: null,
    gravar: {},
    eventos,
    avisarGrupo: aviso,
    bloquearContato: false,
    motivo: e === inicial ? null : "expirada",
  };
}

/* ------------------------------------------------------------------ */
/* Rascunho interno                                                    */
/* ------------------------------------------------------------------ */

type Rascunho = {
  e: EstadoDaTriagem;
  inicial: EstadoDaTriagem;
  eventos: EventoDaTriagem[];
  envio: EnvioDaTriagem | null;
  avisoMotivo: MotivoDoAviso | null;
  bloquear: boolean;
  motivo: string | null;
  agora: number;
  ctx: ContextoDaTriagem;
};

type Parte = { codigo: string; repeticao?: boolean };

function novoRascunho(estado: EstadoDaTriagem, agora: number, ctx: ContextoDaTriagem): Rascunho {
  return {
    e: { ...estado, dados: { ...estado.dados } },
    inicial: estado,
    eventos: [],
    envio: null,
    avisoMotivo: null,
    bloquear: false,
    motivo: null,
    agora,
    ctx,
  };
}

function marcasDe(d: DadosColetados): string[] {
  const m: string[] = [];
  if (d.pediuPreco) m.push("pediu_preco");
  if (d.pediuTabelaEspecial) m.push("perguntou_tabela_especial");
  if (d.mandouAudio) m.push("mandou_audio");
  if (d.pediuEquipe) m.push("pediu_equipe");
  if (d.pediuParceria) m.push("pediu_parceria");
  if (d.reclamou) m.push("reclamou");
  if (d.telefoneConfirmado === "pendente" || (d.telefoneConfirmado === null && d.nomeInformado))
    m.push("telefone_nao_confirmado");
  return m;
}

function diferenca(antes: DadosColetados, depois: DadosColetados): Partial<DadosColetados> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(depois) as (keyof DadosColetados)[]) {
    if (JSON.stringify(antes[k]) !== JSON.stringify(depois[k])) out[k] = depois[k];
  }
  return out as Partial<DadosColetados>;
}

function finalizar(r: Rascunho): ResultadoDoPasso {
  r.e.versao = r.inicial.versao + 1;
  let aviso: AvisoParaOGrupo | null = null;
  if (r.avisoMotivo && !r.inicial.avisoGrupoDecidido) {
    r.e.avisoGrupoDecidido = true;
    aviso = { motivo: r.avisoMotivo, marcas: marcasDe(r.e.dados) };
    r.eventos.push({
      tipo: "aviso_grupo",
      passo: r.e.passo,
      intencao: null,
      detalhe: { motivo: r.avisoMotivo },
    });
  }
  return {
    estado: r.e,
    acao: r.envio ? "enviar" : "silencio",
    envio: r.envio,
    gravar: diferenca(r.inicial.dados, r.e.dados),
    eventos: r.eventos,
    avisarGrupo: aviso,
    bloquearContato: r.bloquear,
    motivo: r.motivo,
  };
}

function dados(
  r: Rascunho,
  novos: Partial<DadosColetados>,
  opcoes?: { permitirTrocaDoAlternativo?: boolean },
): void {
  r.e.dados = aplicarDadosNovos(r.e.dados, novos, opcoes);
}

function primeiroNomeDe(nome: string | null): string | null {
  return nome ? nome.split(" ")[0] : null;
}

function limparRotulo(v: string | null | undefined): string | null {
  const t = (v ?? "")
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return t || null;
}

function variaveis(r: Rascunho): Record<string, string | null> {
  const d = r.e.dados;
  const ctx = r.ctx;
  const hor = horarioEmTexto(ctx.horario);
  const final = finalDoTelefone(ctx.telefoneDoChat.normalizado);
  const chave = chaveWhatsApp(ctx.telefoneDoChat.normalizado);
  const end =
    ctx.enderecoDoCep && d.cep && ctx.enderecoDoCep.cep.replace(/\D/g, "") === d.cep
      ? ctx.enderecoDoCep
      : null;
  return {
    primeiro_nome: primeiroNomeDe(d.nomeInformado),
    nome_completo: d.nomeInformado,
    telefone:
      ctx.config.exibirTelefone === "inteiro" && chave
        ? chave
        : final
          ? `terminado em ${final}`
          : null,
    cep: d.cep ? `${d.cep.slice(0, 5)}-${d.cep.slice(5)}` : null,
    bairro: limparRotulo(d.cepEndereco?.bairro ?? end?.bairro),
    cidade: limparRotulo(d.cepEndereco?.cidade ?? end?.cidade),
    abre: hor?.abre ?? null,
    fecha: hor?.fecha ?? null,
    dias: hor?.dias ?? null,
    // o link de parceiro nunca entra em texto de cliente final, nem por configuração errada
    link_parceiro: r.e.ramo === "parceiro" ? ctx.config.linkParceiro : null,
  };
}

function achar(ctx: ContextoDaTriagem, ramo: Ramo, codigo: string): PassoDeTexto | null {
  return (
    ctx.passos.find((p) => p.codigo === codigo && p.ramo === ramo && p.ativo !== false) ?? null
  );
}

type Composto = { texto: string; codigos: string[]; variaveis: string[]; problema: string | null };

function compor(r: Rascunho, partes: Parte[], ack: string | null): Composto {
  const valores = variaveis(r);
  const usadas = new Set<string>();
  const textos: string[] = [];
  const codigos: string[] = [];
  const renderizar = (codigo: string, repeticao: boolean): string | null => {
    const passo = achar(r.ctx, r.e.ramo, codigo);
    if (!passo) return null;
    const modelo =
      repeticao && passo.repeticao ? passo.repeticao : escolherVariante(passo, r.e.conversaId);
    for (const m of modelo.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) usadas.add(m[1]);
    return modelo;
  };
  let ackTexto = "";
  if (ack) {
    const m = renderizar(ack, false);
    ackTexto = m ? preencher(m, valores).texto : "";
  }
  for (const p of partes) {
    const modelo = renderizar(p.codigo, p.repeticao === true);
    if (modelo === null)
      return { texto: "", codigos, variaveis: [...usadas], problema: `texto_ausente:${p.codigo}` };
    const { texto, faltando } = preencher(modelo, { ...valores, ack: ackTexto });
    if (faltando.length > 0)
      return {
        texto: "",
        codigos,
        variaveis: [...usadas],
        problema: `variavel_faltando:${faltando.join(",")}`,
      };
    textos.push(texto);
    codigos.push(p.repeticao ? `${p.codigo}~repeticao` : p.codigo);
  }
  return { texto: textos.join("\n\n"), codigos, variaveis: [...usadas], problema: null };
}

function fim(
  r: Rascunho,
  status: EstadoDaTriagem["status"],
  motivoFim: string,
  aviso: MotivoDoAviso | null,
): void {
  r.e.status = status;
  r.e.motivoFim = motivoFim;
  r.motivo = motivoFim;
  if (aviso) r.avisoMotivo = aviso;
}

/**
 * Envia (ou decide não enviar). Garante o teto de mensagens: na última vaga a
 * mensagem de saída é a de entrega à equipe, e depois do teto o silêncio é total.
 */
function enviar(
  r: Rascunho,
  partes: Parte[],
  opcoes: { terminal?: boolean; ack?: string | null } = {},
): boolean {
  const cfg = r.ctx.config;
  const total = r.e.mensagensEnviadas + (r.ctx.automaticasDeFora ?? 0);
  if (total >= cfg.maxMensagens) {
    r.eventos.push({
      tipo: "pulou",
      passo: r.e.passo,
      intencao: null,
      detalhe: { motivo: "limite_de_mensagens", enviadas: total },
    });
    fim(r, "entregue_equipe", "limite_mensagens", "limite_mensagens");
    return false;
  }
  let usar = partes;
  let ack = opcoes.ack ?? null;
  let ultimaVaga = false;
  if (!opcoes.terminal && total === cfg.maxMensagens - 1) {
    usar = [{ codigo: "aviso_equipe" }];
    ack = null;
    ultimaVaga = true;
  }
  const c = compor(r, usar, ack);
  const v = c.problema ? null : verificarTexto(c.texto, r.e.ramo);
  if (c.problema || (v && !v.ok)) {
    r.eventos.push({
      tipo: "texto_barrado",
      passo: r.e.passo,
      intencao: null,
      detalhe: {
        codigos: c.codigos,
        variaveis: c.variaveis,
        regras: v ? v.problemas.map((p) => p.regra) : [c.problema ?? "erro"],
      },
    });
    fim(r, "entregue_equipe", "texto_barrado", "texto_barrado");
    return false;
  }
  const ordem = r.e.mensagensEnviadas + 1;
  const codigoFinal = c.codigos[c.codigos.length - 1];
  r.e.mensagensEnviadas = ordem;
  r.e.ultimoEnvioEm = r.agora;
  r.envio = {
    texto: c.texto,
    codigos: c.codigos,
    variaveis: c.variaveis,
    atrasoS: atrasoHumanizado(
      r.e.conversaId,
      codigoFinal.replace("~repeticao", ""),
      cfg.atrasoMinS,
      cfg.atrasoMaxS,
    ),
    chaveDeIdempotencia: `triagem:${r.e.triagemId}:${c.codigos.join("+")}:${ordem}`,
    ordem,
  };
  if (ultimaVaga) fim(r, "entregue_equipe", "limite_mensagens", "limite_mensagens");
  return true;
}

function silencio(r: Rascunho, motivo: string): ResultadoDoPasso {
  r.motivo = motivo;
  r.eventos.push({ tipo: "pulou", passo: r.e.passo, intencao: null, detalhe: { motivo } });
  return finalizar(r);
}

/* ------------------------------------------------------------------ */
/* Perguntar, repetir, falhar                                          */
/* ------------------------------------------------------------------ */

function codigoDaPergunta(r: Rascunho, passo: PassoDaTriagem, volta: boolean): string {
  switch (passo) {
    case "nome":
      return volta ? "nome_curto" : "nome";
    case "parceiro_nome":
      return volta ? "nome_curto" : "parceiro_nome";
    case "telefone":
      return telefoneDoChatUtilizavel(r.ctx.telefoneDoChat) ? "telefone" : "telefone_direto";
    default:
      return passo;
  }
}

function perguntar(
  r: Rascunho,
  passo: PassoDaTriagem,
  o: { prefixos?: string[]; repetir?: boolean; volta?: boolean; ack?: string | null } = {},
): void {
  r.e.passo = passo;
  const partes: Parte[] = (o.prefixos ?? []).map((codigo) => ({ codigo }));
  partes.push({
    codigo: codigoDaPergunta(r, passo, o.volta === true),
    repeticao: o.repetir === true,
  });
  enviar(r, partes, { ack: o.ack ?? null });
}

function abrir(
  r: Rascunho,
  passo: PassoDaTriagem,
  o: { prefixos?: string[]; ack?: string | null } = {},
): void {
  r.e.tentativasPasso = 1;
  perguntar(r, passo, o);
}

function sucesso(r: Rascunho): void {
  r.e.etapasEsgotadasSeguidas = 0;
}

function entregar(r: Rascunho, motivoFim: string, aviso: MotivoDoAviso): void {
  if (enviar(r, [{ codigo: "aviso_equipe" }], { terminal: true }))
    fim(r, "entregue_equipe", motivoFim, aviso);
}

function repetirOuEsgotar(r: Rascunho, passo: PassoDaTriagem): void {
  if (r.e.tentativasPasso < r.ctx.config.maxTentativasPorPasso) {
    r.e.tentativasPasso += 1;
    perguntar(r, passo, { repetir: true });
    return;
  }
  r.e.etapasEsgotadasSeguidas += 1;
  if (passo === "nome" || passo === "parceiro_nome" || r.e.etapasEsgotadasSeguidas >= 2) {
    entregar(r, "etapa_esgotada", "entregue_equipe");
    return;
  }
  switch (passo) {
    case "sobrenome":
      irParaPrimeiraVez(r);
      return;
    case "primeira_vez":
      dados(r, { primeiraVez: "nao_sei" });
      irParaCep(r, null);
      return;
    case "cep":
      irParaTelefone(r, null);
      return;
    case "telefone":
    case "telefone_novo":
      dados(r, { telefoneConfirmado: "pendente" });
      irParaFechamento(r);
      return;
    default:
      entregar(r, "etapa_esgotada", "entregue_equipe");
  }
}

function irParaPrimeiraVez(r: Rascunho): void {
  abrir(r, "primeira_vez");
}

function irParaCep(r: Rascunho, ack: string | null): void {
  const d = r.e.dados;
  if (d.cep || d.enderecoRecusado || d.enderecoTexto) irParaTelefone(r, ack);
  else abrir(r, "cep");
}

function irParaTelefone(r: Rascunho, ack: string | null): void {
  abrir(r, "telefone", { ack });
}

function irParaFechamento(r: Rascunho): void {
  r.e.passo = "fechamento";
  r.e.tentativasPasso = 0;
  const hor = horarioEmTexto(r.ctx.horario);
  const dentro = dentroDoHorario(r.agora, r.ctx.horario);
  const codigo = dentro
    ? "fechamento_dentro"
    : hor
      ? "fechamento_fora"
      : "fechamento_fora_sem_horario";
  if (enviar(r, [{ codigo }], { terminal: true })) fim(r, "concluida", "concluida", "concluida");
}

function irParaParceiroLink(r: Rascunho): void {
  r.e.passo = "parceiro_link";
  r.e.tentativasPasso = 0;
  if (!r.ctx.config.linkParceiro) {
    // sem link configurado não existe cadastro para mandar: a equipe continua
    entregar(r, "sem_link_de_parceiro", "parceiro");
    return;
  }
  const dentro = dentroDoHorario(r.agora, r.ctx.horario);
  const temHorario = horarioEmTexto(r.ctx.horario) !== null;
  const codigo = dentro || !temHorario ? "parceiro_link" : "parceiro_link_fora";
  if (enviar(r, [{ codigo }], { terminal: true }))
    fim(r, "concluida", "parceiro_link_enviado", "parceiro");
}

/* ------------------------------------------------------------------ */
/* Tratamento por tipo de entrada                                      */
/* ------------------------------------------------------------------ */

const PASSOS_COM_AVISO_DE_AUDIO: readonly (PassoDaTriagem | null)[] = [
  null,
  "nome",
  "sobrenome",
  "primeira_vez",
  "parceiro_nome",
];

function passoAtualOuNome(r: Rascunho): PassoDaTriagem {
  return r.e.passo ?? (r.e.ramo === "parceiro" ? "parceiro_nome" : "nome");
}

function tratarAudio(r: Rascunho): void {
  r.e.audios += 1;
  dados(r, { mandouAudio: true });
  const passo = r.e.passo;
  if (!PASSOS_COM_AVISO_DE_AUDIO.includes(passo)) {
    // etapa avançada: áudio é fim de triagem, sem aviso de que o robô só lê texto
    entregar(r, "audio_em_etapa_avancada", "audio");
    return;
  }
  if (r.e.audios >= 2) {
    // segundo áudio: silêncio, a triagem entrega à equipe com a marca mandou_audio
    fim(r, "entregue_equipe", "segundo_audio", "audio");
    r.eventos.push({ tipo: "pausa", passo, intencao: null, detalhe: { motivo: "segundo_audio" } });
    return;
  }
  r.e.avisosAudio += 1;
  if (passo === null) {
    r.e.tentativasPasso = 1;
    r.e.passo = passoAtualOuNome(r);
    enviar(r, [{ codigo: codigoDaPergunta(r, r.e.passo, false) }, { codigo: "aviso_audio" }]);
    return;
  }
  perguntar(r, passo, { prefixos: ["aviso_audio"], volta: true });
}

function tratarArquivo(r: Rascunho): void {
  const passo = r.e.passo;
  if (passo === null) {
    // primeira mensagem é arquivo: boas-vindas normais; o arquivo já é guardado pelo fluxo atual
    abrirPrimeiraMensagem(r, []);
    return;
  }
  if (r.e.avisosArquivo >= 1) {
    r.motivo = "arquivo_ja_avisado";
    r.eventos.push({
      tipo: "pulou",
      passo,
      intencao: null,
      detalhe: { motivo: "arquivo_ja_avisado" },
    });
    return;
  }
  r.e.avisosArquivo += 1;
  perguntar(r, passo, { prefixos: ["aviso_arquivo"], volta: true });
}

function tratarFigurinha(r: Rascunho): void {
  r.e.figurinhas += 1;
  const passo = r.e.passo;
  if (passo === null) {
    abrirPrimeiraMensagem(r, []);
    return;
  }
  if (r.e.figurinhas >= 2) {
    r.motivo = "segunda_figurinha";
    r.eventos.push({
      tipo: "pulou",
      passo,
      intencao: null,
      detalhe: { motivo: "segunda_figurinha" },
    });
    return;
  }
  // figurinha conta como mensagem sem sentido: é uma tentativa
  repetirOuEsgotar(r, passo);
}

function abrirPrimeiraMensagem(r: Rascunho, prefixos: string[]): void {
  const passo: PassoDaTriagem = r.e.ramo === "parceiro" ? "parceiro_nome" : "nome";
  abrir(r, passo, { prefixos });
}

/* ------------------------------------------------------------------ */
/* Tratamento de texto                                                 */
/* ------------------------------------------------------------------ */

function tratarPreco(r: Rascunho, interp: Interpretacao): void {
  dados(r, { pediuPreco: true, ...(interp.termoSensivel ? { pediuTabelaEspecial: true } : {}) });
  r.e.perguntasDePreco += 1;
  const passo = passoAtualOuNome(r);
  if (r.e.perguntasDePreco >= 2) {
    entregar(r, "pediu_valor_de_novo", "entregue_equipe");
    return;
  }
  // nunca responde valor: devolve a frase de passar para a equipe e volta ao passo
  const prefixo = r.e.ramo === "parceiro" ? "parceiro_valor" : "ack_preco";
  if (r.e.passo === null) abrir(r, passo, { prefixos: [prefixo] });
  else perguntar(r, passo, { prefixos: [prefixo], volta: true });
}

function semOCep(texto: string): string {
  return texto.replace(/(?<!\d)\d{2}\.?\d{3}[-\s]?\d{3}(?!\d)/g, " ");
}

function guardarCep(r: Rascunho, cep: string): void {
  const e = r.ctx.enderecoDoCep;
  const confere = !!e && e.cep.replace(/\D/g, "") === cep;
  dados(r, { cep, ...(confere && e ? { cepEndereco: e } : {}) });
}

function ackDoCep(r: Rascunho): string {
  const e = r.ctx.enderecoDoCep;
  const ok =
    !!e &&
    !!limparRotulo(e.bairro) &&
    !!limparRotulo(e.cidade) &&
    !!r.e.dados.cep &&
    e.cep.replace(/\D/g, "") === r.e.dados.cep;
  return ok ? "ack_cep_ok" : "ack_cep_sem_consulta";
}

function substituirNome(r: Rascunho, nome: string, completo: boolean): void {
  // única exceção da escrita única: completar o sobrenome dentro da própria etapa
  r.e.dados = { ...r.e.dados, nomeInformado: nome, nomeCompleto: completo };
}

function tratarTexto(r: Rascunho, texto: string, interp: Interpretacao): void {
  const passo = r.e.passo;
  if (passo === null) {
    abrirPrimeiraMensagem(r, []);
    return;
  }
  const quadro = r.ctx.quadro;
  const cfg = r.ctx.config;

  // polegar ou ok sozinho só vale nas etapas de confirmação; nas outras é ignorado
  if (ehSoMarcaDeEmoji(interp.normalizado) && passo !== "telefone" && passo !== "telefone_novo") {
    r.motivo = "emoji_ignorado";
    r.eventos.push({ tipo: "pulou", passo, intencao: null, detalhe: { motivo: "emoji_ignorado" } });
    return;
  }

  switch (passo) {
    case "nome": {
      const cep = extrairCep(texto);
      if (cep.ok) guardarCep(r, cep.cep); // resposta fora de ordem: guarda o CEP e segue pedindo o nome
      const lido = extrairNome(cep.ok ? semOCep(texto) : texto, quadro);
      if (!lido.ok) return repetirOuEsgotar(r, "nome");
      sucesso(r);
      dados(r, { nomeInformado: lido.nome, nomeCompleto: lido.completo });
      if (lido.completo) irParaPrimeiraVez(r);
      else abrir(r, "sobrenome");
      return;
    }
    case "sobrenome": {
      const cep = extrairCep(texto);
      if (cep.ok) guardarCep(r, cep.cep);
      const lido = extrairSobrenome(
        cep.ok ? semOCep(texto) : texto,
        primeiroNomeDe(r.e.dados.nomeInformado) ?? "",
        quadro,
      );
      if (!lido.ok) return repetirOuEsgotar(r, "sobrenome");
      sucesso(r);
      substituirNome(r, lido.nome, true);
      irParaPrimeiraVez(r);
      return;
    }
    case "parceiro_nome": {
      const lido = extrairNome(texto, quadro);
      if (!lido.ok) return repetirOuEsgotar(r, "parceiro_nome");
      sucesso(r);
      dados(r, { nomeInformado: lido.nome, nomeCompleto: lido.completo });
      irParaParceiroLink(r);
      return;
    }
    case "primeira_vez": {
      const cep = extrairCep(texto);
      if (cep.ok) guardarCep(r, cep.cep);
      if (interp.palavras > 8) return entregar(r, "texto_livre", "entregue_equipe");
      if (interp.intencao === "primeira_vez") {
        sucesso(r);
        dados(r, { primeiraVez: "sim" });
        irParaCep(r, null);
        return;
      }
      if (interp.intencao === "ja_cliente") {
        sucesso(r);
        dados(r, { primeiraVez: "ja_cliente" });
        // quem já é cliente não recebe pedido de CEP
        irParaTelefone(r, "ack_ja_cliente");
        return;
      }
      return repetirOuEsgotar(r, "primeira_vez");
    }
    case "cep": {
      const cep = extrairCep(texto);
      if (cep.ok) {
        sucesso(r);
        guardarCep(r, cep.cep);
        irParaTelefone(r, ackDoCep(r));
        return;
      }
      if (interp.intencao === "recusar" || interp.intencao === "pular") {
        sucesso(r);
        // pulou ou recusou: nunca se pergunta de novo
        dados(r, { enderecoRecusado: true });
        irParaTelefone(r, "ack_cep_pulado");
        return;
      }
      if (pareceEndereco(texto)) {
        sucesso(r);
        dados(r, { enderecoTexto: texto.replace(/\s+/g, " ").trim().slice(0, 200) });
        irParaTelefone(r, "ack_endereco");
        return;
      }
      return repetirOuEsgotar(r, "cep");
    }
    case "telefone": {
      const usavel = telefoneDoChatUtilizavel(r.ctx.telefoneDoChat);
      const tel = extrairTelefone(texto, { dddPadrao: cfg.dddPadrao });
      if (tel.ok) {
        sucesso(r);
        const doChat = usavel && tel.chave === chaveWhatsApp(r.ctx.telefoneDoChat.normalizado);
        if (doChat) dados(r, { telefoneConfirmado: "sim" });
        else dados(r, { telefoneConfirmado: "alternativo", telefoneAlternativo: tel.chave });
        irParaFechamento(r);
        return;
      }
      if (interp.palavras > 8) return entregar(r, "texto_livre", "entregue_equipe");
      if (usavel && interp.intencao === "sim") {
        sucesso(r);
        dados(r, { telefoneConfirmado: "sim" });
        irParaFechamento(r);
        return;
      }
      if (usavel && (interp.intencao === "nao" || interp.intencao === "mudar")) {
        sucesso(r);
        abrir(r, "telefone_novo");
        return;
      }
      return repetirOuEsgotar(r, "telefone");
    }
    case "telefone_novo": {
      const tel = extrairTelefone(texto, { dddPadrao: cfg.dddPadrao });
      if (tel.ok) {
        sucesso(r);
        dados(
          r,
          { telefoneConfirmado: "alternativo", telefoneAlternativo: tel.chave },
          { permitirTrocaDoAlternativo: true },
        );
        irParaFechamento(r);
        return;
      }
      if (interp.palavras > 8) return entregar(r, "texto_livre", "entregue_equipe");
      return repetirOuEsgotar(r, "telefone_novo");
    }
    default:
      r.motivo = "passo_sem_resposta";
  }
}

/* ------------------------------------------------------------------ */
/* Ponto de entrada                                                    */
/* ------------------------------------------------------------------ */

export function proximoPasso(
  estado: EstadoDaTriagem,
  entrada: EntradaDeMensagem,
  agora: Date | number,
  ctx: ContextoDaTriagem,
): ResultadoDoPasso {
  const tAgora = emMs(agora);
  const r = novoRascunho(estado, tAgora, ctx);
  const cfg = ctx.config;
  const ehTexto = entrada.tipo === "texto";
  const texto = ehTexto ? (entrada.texto ?? "") : "";
  const interp = ehTexto ? interpretar(texto, estado.passo, ctx.quadro) : null;
  const normalizado = interp?.normalizado ?? normalizarTexto(texto);

  // idempotência: o mesmo webhook entregue duas vezes não processa duas vezes
  if (entrada.id && entrada.id === estado.ultimaEntradaId) return silencio(r, "entrada_duplicada");

  const registrar = () => {
    r.e.ultimaEntradaId = entrada.id;
    r.e.ultimaEntradaEm = entrada.recebidaEm;
    r.e.ultimaEntradaNormalizada = normalizado || null;
  };

  // triagem já encerrada: a automação se cala para sempre
  if (STATUS_ENCERRADOS.includes(estado.status)) {
    registrar();
    return silencio(r, "triagem_encerrada");
  }

  // gente da equipe entrou na conversa: pausa, nunca retoma sozinha
  if (ctx.humanoNaConversa) {
    registrar();
    r.eventos.push({
      tipo: "pausa",
      passo: estado.passo,
      intencao: null,
      detalhe: { motivo: "humano" },
    });
    fim(r, "pausada_humano", "humano_na_conversa", null);
    return finalizar(r);
  }

  // robô de empresa: sinais estruturais e frases do quadro; nunca responde, evita laço de automações
  const robo = detectarRobo({
    texto: ehTexto ? texto : null,
    origem: entrada.origem,
    quadro: ctx.quadro,
    msDesdeNossoEnvio:
      estado.ultimoEnvioEm === null ? null : entrada.recebidaEm - estado.ultimoEnvioEm,
    ultimaEntradaNormalizada: estado.ultimaEntradaNormalizada,
    config: cfg,
  });
  // quem repete a mesma frase é pessoa que não foi entendida: vai para a equipe com aviso,
  // nunca some em silêncio. O ramo terminal já impede o laço entre duas automações.
  if (robo.suspeito && robo.motivo === "texto_repetido" && interp?.intencao !== "parar") {
    registrar();
    r.eventos.push({
      tipo: "gate",
      passo: estado.passo,
      intencao: null,
      detalhe: { motivo: "texto_repetido_entregue" },
    });
    if (interp?.intencao === "pergunta_preco") dados(r, { pediuPreco: true });
    entregar(r, "texto_repetido", "entregue_equipe");
    return finalizar(r);
  }
  if (robo.suspeito && robo.motivo !== "texto_repetido") {
    registrar();
    r.eventos.push({
      tipo: "gate",
      passo: estado.passo,
      intencao: null,
      detalhe: { motivo: "suspeita_de_robo", sinal: robo.motivo },
    });
    fim(r, "pulada", `suspeita_de_robo:${robo.motivo}`, null);
    return finalizar(r);
  }

  registrar();
  if (interp) {
    r.eventos.push({
      tipo: "interpretada",
      passo: estado.passo,
      intencao: interp.intencao,
      detalhe: { tentativa: estado.tentativasPasso, ambigua: interp.ambigua },
    });
  }

  // parar vale em qualquer passo, mesmo expirada, e grava o bloqueio
  if (interp?.intencao === "parar") {
    r.bloquear = true;
    enviar(r, [{ codigo: "aviso_parar" }], { terminal: true });
    fim(r, "parada_pelo_contato", "parou", null);
    r.avisoMotivo = null;
    return finalizar(r);
  }

  // pedido de gente
  if (interp && (interp.intencao === "falar_com_equipe" || interp.intencao === "reclamacao")) {
    if (interp.intencao === "falar_com_equipe") dados(r, { pediuEquipe: true });
    else dados(r, { reclamou: true });
    entregar(
      r,
      interp.intencao === "falar_com_equipe" ? "pediu_equipe" : "reclamou",
      interp.intencao === "falar_com_equipe" ? "pedido_equipe" : "entregue_equipe",
    );
    return finalizar(r);
  }

  // silêncio longo: retoma com a pergunta de reabertura, sem interpretar a resposta tardia
  const expirada = estado.status === "expirada" || silenciouDemais(estado, tAgora, cfg);
  if (expirada && estado.passo !== null) {
    const limite = cfg.retomarAteHoras * 3_600_000;
    if (estado.ultimoEnvioEm === null || tAgora - estado.ultimoEnvioEm > limite) {
      fim(r, "expirada", "expirada_sem_retomada", null);
      r.eventos.push({
        tipo: "pulou",
        passo: estado.passo,
        intencao: null,
        detalhe: { motivo: "expirada_alem_do_limite" },
      });
      return finalizar(r);
    }
    r.e.status = estado.modo === "ensaio" ? "ensaio" : "ativa";
    r.e.motivoFim = null;
    perguntar(r, estado.passo, { prefixos: ["reabertura"], volta: true });
    r.motivo = "reaberta_depois_do_silencio";
    return finalizar(r);
  }

  // ramo: só sobe, e só por leadTipo da Onda A ou palavra curta no passo do nome
  const escolha = escolherRamo({
    ramoAtual: r.e.ramo,
    motivoAtual: r.e.ramoMotivo,
    leadTipo: ctx.leadTipo,
    texto: ehTexto ? texto : null,
    passo: estado.passo,
    nomeJaInformado: r.e.dados.nomeInformado !== null,
    quadro: ctx.quadro,
  });
  const ramoAnterior = r.e.ramo;
  r.e.ramo = escolha.ramo;
  r.e.ramoMotivo = escolha.motivo;
  const subiuAgora = ramoAnterior === "cliente" && r.e.ramo === "parceiro";

  if (subiuAgora && estado.passo !== null) {
    // trocou de ramo no passo do nome: recomeça pelo nome, agora no texto de parceiro
    r.e.tentativasPasso = 0;
    abrir(r, "parceiro_nome");
    return finalizar(r);
  }

  switch (entrada.tipo) {
    case "audio":
      tratarAudio(r);
      break;
    case "figurinha":
      tratarFigurinha(r);
      break;
    case "imagem":
    case "documento":
    case "video":
    case "contato":
      tratarArquivo(r);
      break;
    case "localizacao":
      if (estado.passo === "cep") {
        sucesso(r);
        dados(r, { enderecoTexto: "localizacao" });
        irParaTelefone(r, "ack_endereco");
      } else {
        tratarArquivo(r);
      }
      break;
    case "texto": {
      if (!interp) break;
      if (interp.intencao === "pergunta_preco") {
        tratarPreco(r, interp);
        break;
      }
      if (interp.intencao === "parceiro" && r.e.ramo === "cliente") {
        // palavra de parceiro fora do passo do nome: só avisa a equipe, não troca o texto nem manda link
        dados(r, { pediuParceria: true, ...(interp.tambemPreco ? { pediuPreco: true } : {}) });
        entregar(r, "pediu_parceria", "pediu_parceria");
        break;
      }
      tratarTexto(r, texto, interp);
      break;
    }
  }
  return finalizar(r);
}

/**
 * Rajada: três mensagens seguidas viram UMA rodada. Cada mensagem é aplicada em
 * ordem ao estado, sem enviar nada no meio, e só a resposta do último passo sai.
 * Assim "Maria", "Souza" e "primeira vez" não se perdem nem geram três respostas.
 */
export function processarRajada(
  estado: EstadoDaTriagem,
  entradas: readonly EntradaDeMensagem[],
  agora: Date | number,
  ctx: ContextoDaTriagem,
): ResultadoDoPasso {
  const lista = [...entradas].sort((a, b) => a.recebidaEm - b.recebidaEm);
  if (lista.length === 0) {
    const r = novoRascunho(estado, emMs(agora), ctx);
    return silencio(r, "rajada_vazia");
  }
  let atual = estado;
  let gravar: Partial<DadosColetados> = {};
  const eventos: EventoDaTriagem[] = [];
  let aviso: AvisoParaOGrupo | null = null;
  let bloquear = false;
  let ultimo: ResultadoDoPasso | null = null;
  for (let i = 0; i < lista.length; i++) {
    const res = proximoPasso(atual, lista[i], agora, ctx);
    gravar = { ...gravar, ...res.gravar };
    eventos.push(...res.eventos);
    aviso = aviso ?? res.avisarGrupo;
    bloquear = bloquear || res.bloquearContato;
    ultimo = res;
    const encerrou =
      STATUS_ENCERRADOS.includes(res.estado.status) || res.estado.status === "expirada";
    if (encerrou) break;
    if (i < lista.length - 1) {
      // mensagem intermediária: o passo anda, mas o envio é desfeito e não conta no teto
      const e = { ...res.estado };
      if (res.envio) {
        e.mensagensEnviadas = atual.mensagensEnviadas;
        e.ultimoEnvioEm = atual.ultimoEnvioEm;
      }
      atual = e;
    } else {
      atual = res.estado;
    }
  }
  const final = ultimo as ResultadoDoPasso;
  const dadosFinais = diferenca(estado.dados, final.estado.dados);
  return {
    ...final,
    estado: { ...final.estado, versao: estado.versao + 1 },
    gravar: dadosFinais,
    eventos,
    avisarGrupo: aviso,
    bloquearContato: bloquear,
  };
}
