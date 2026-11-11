/**
 * Agente de cadastro de parceiros pelo WhatsApp — roteiro do dono (11/11/2026).
 *
 * Tudo aqui é puro e determinístico: a ordem dos passos, as perguntas e a validação
 * são regras fixas, para o roteiro nunca variar. Nesta versão só a tela de ensaio usa
 * isto; nada é enviado pelo WhatsApp nem gravado como parceiro.
 */
import {
  documentoValido,
  emailValido,
  nomeParecendoEndereco,
  sugerirEmail,
  ufValida,
  whatsappValido,
} from "@/domain/parceiros/cadastro-rapido";
import { normalizarComprovacao } from "@/domain/parceiros/ramo";
import { relogioLocal } from "@/domain/whatsapp/assistente";

export const PASSOS = [
  "consentimento", "nome", "telefone", "email", "empresa", "ramo", "cidade",
  "instagram", "documento", "volume", "promocoes", "conferencia", "fim",
] as const;
export type Passo = (typeof PASSOS)[number];

export type RamoDoAgente = "comunicacao_visual" | "agencia" | "designer" | "revendedor_brindes" | "outro";
export type Volume = "ate_5" | "6_20" | "mais_20";
export type Fonte = "anuncio" | "convite" | "texto" | "telefone";

export type Ficha = {
  aceiteLgpdEm: string | null;
  nome: string | null;
  telefoneConfirmado: boolean | null;
  telefoneCadastro: string | null;
  email: string | null;
  empresa: string | null;
  ramo: RamoDoAgente | null;
  ramoOutro: string | null;
  cidade: string | null;
  uf: string | null;
  instagramOuSite: string | null;
  documento: string | null;
  volume: Volume | null;
  aceitaPromocoes: boolean | null;
  aceitePromocoesEm: string | null;
};

export type Situacao = "coletando" | "minimo_completo" | "enviado" | "saiu" | "transferido" | "pausado";

export type EstadoDoAgente = {
  passo: Passo;
  ficha: Ficha;
  /** Passos opcionais já respondidos (inclusive com "não tenho"/"pular"). */
  respondidos: Passo[];
  situacao: Situacao;
  invalidas: number;
  aguardandoOutroNumero: boolean;
  aguardandoRamoOutro: boolean;
  aguardandoQualCorrigir: boolean;
  corrigindo: boolean;
  sugestaoDeEmail: string | null;
  lembreteEnviado: boolean;
  avisouForaDoHorario: boolean;
  telefoneConversa: string;
  fonte: Fonte;
};

export type MotivoDeTransferencia =
  | "pediu_atendente" | "assunto_da_equipe" | "midia" | "ininteligivel" | "texto_bloqueado";

export type Entrada = { tipo: "texto" | "midia"; texto?: string; agora: Date };

export type Resultado = {
  estado: EstadoDoAgente;
  respostas: string[];
  transferir: MotivoDeTransferencia | null;
  /** Momento em que o mínimo (nome, telefone confirmado, e-mail) ficou completo: hora de criar o pré-cadastro. */
  criarPreCadastro: boolean;
};

export const FRASE_TRANSFERENCIA = "Vou chamar alguém da equipe pra continuar contigo.";
export const FRASE_MIDIA = "Recebi, vou passar para a equipe.";
export const FRASE_SAIR = "Tranquilo, não vou mais te mandar mensagem por aqui. Se mudar de ideia, é só chamar.";
export const FRASE_FORA_DO_HORARIO = "A equipe responde no próximo dia útil, mas pode seguir comigo que eu vou anotando.";
export const FRASE_FIM = "Seu cadastro foi enviado, a equipe confirma e libera o acesso.";
export const LEMBRETE = "Oi! Ficou alguma dúvida? Quando puder, é só responder que a gente continua de onde parou.";
export const LEMBRETE_APOS_MS = 30 * 60_000;

const OPCIONAIS: Passo[] = ["empresa", "ramo", "cidade", "instagram", "documento", "volume", "promocoes"];

export function fichaVazia(): Ficha {
  return {
    aceiteLgpdEm: null, nome: null, telefoneConfirmado: null, telefoneCadastro: null, email: null,
    empresa: null, ramo: null, ramoOutro: null, cidade: null, uf: null, instagramOuSite: null,
    documento: null, volume: null, aceitaPromocoes: null, aceitePromocoesEm: null,
  };
}

export function iniciarAgente(telefoneConversa: string, fonte: Fonte = "texto"): { estado: EstadoDoAgente; respostas: string[] } {
  return {
    estado: {
      passo: "consentimento", ficha: fichaVazia(), respondidos: [], situacao: "coletando", invalidas: 0,
      aguardandoOutroNumero: false, aguardandoRamoOutro: false, aguardandoQualCorrigir: false, corrigindo: false,
      sugestaoDeEmail: null, lembreteEnviado: false, avisouForaDoHorario: false,
      telefoneConversa: telefoneConversa.replace(/\D/g, ""), fonte,
    },
    respostas: [SAUDACAO],
  };
}

export const SAUDACAO =
  "Oi! Aqui é a assistente da Bex Print. Que bom que tu quer ser parceiro! Vou fazer umas perguntas rápidas pro teu cadastro. " +
  "Teus dados servem só pra isso, como explica nossa política: bexprint.com.br/privacidade. Posso seguir? (sim) — se não quiser, manda SAIR.";

export function minimoCompleto(f: Ficha): boolean {
  return !!f.nome && f.telefoneConfirmado !== null && !!f.telefoneCadastro && !!f.email;
}

function sa(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const SIM = /^(1|sim|s|isso|pode|bora|claro|ok|certo|ta certo|esta certo|beleza|blz|positivo|uhum|aham)\b/;
const NAO = /^(2|nao|n|negativo|nem)\b/;
const PULAR = /^(nao tenho|nao tem|pular|pula|prefiro nao|nao quero|nenhum|nenhuma|-)$/;

export function ehSair(t: string): boolean {
  return /^(sair|parar|pare|cancelar|stop)$/.test(sa(t));
}
export function pedeAtendente(t: string): boolean {
  return /\b(atendente|humano|pessoa|alguem da equipe|falar com (alguem|voces|vcs))\b/.test(sa(t));
}
export function assuntoDaEquipe(t: string): boolean {
  return /\b(preco|precos|valor|valores|quanto custa|quanto (e|fica|sai)|desconto|credito|prazo|pagamento|pagar|pix|boleto|parcel|reclama|problema|insatisfeit|orcamento)/.test(sa(t));
}
export function perguntaDoPrograma(t: string): boolean {
  return /\b(como funciona|beneficio|vantage|nivel|niveis|programa)\b/.test(sa(t)) && /\?/.test(t);
}

/** Nenhuma resposta do agente pode citar valor, percentual, data ou desconto. */
export function textoBloqueado(t: string): boolean {
  return /R\$|\d\s*%|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|desconto/i.test(t);
}

export function finalDoTelefone(tel: string): string {
  return tel.replace(/\D/g, "").slice(-4);
}

/** "5596991234567" → "96991234567"; aceita só 10 ou 11 dígitos depois de tirar o 55. */
export function telefoneNormalizado(v: string): string | null {
  let d = v.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return whatsappValido(d) ? d : null;
}

export function lerRamo(t: string): RamoDoAgente | null {
  const s = sa(t);
  if (/^1\b|grafica|comunicacao visual/.test(s)) return "comunicacao_visual";
  if (/^2\b|agencia/.test(s)) return "agencia";
  if (/^3\b|designer|design/.test(s)) return "designer";
  if (/^4\b|brinde/.test(s)) return "revendedor_brindes";
  if (/^5\b|outro/.test(s)) return "outro";
  return null;
}

export function lerVolume(t: string): Volume | null {
  const s = sa(t);
  if (/^1\b|ate 5/.test(s)) return "ate_5";
  if (/^2\b|6 a 20|de 6/.test(s)) return "6_20";
  if (/^3\b|mais de 20/.test(s)) return "mais_20";
  return null;
}

export function lerCidadeUf(t: string): { cidade: string; uf: string } | null {
  const m = t.trim().match(/^(.{2,}?)\s*(?:[-/,]|\s)\s*([A-Za-z]{2})\.?$/);
  if (!m || !ufValida(m[2])) return null;
  return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
}

export function lerInstagramOuSite(t: string): string | null {
  const v = t.trim().split(/\s+/).find((p) => /^@[A-Za-z0-9._]{2,}$/.test(p) || /instagram\.com\/|^https?:\/\/|^[^\s@]+\.[a-z]{2,}(\/|$)/i.test(p));
  return v ? normalizarComprovacao(v) : null;
}

const ROTULO_DO_PASSO: Record<string, string> = {
  nome: "nome", telefone: "número", email: "e-mail", empresa: "empresa", ramo: "ramo",
  cidade: "cidade", instagram: "instagram", documento: "documento", volume: "volume", promocoes: "promoções",
};

function pergunta(e: EstadoDoAgente): string {
  switch (e.passo) {
    case "nome": return "Massa! Qual é o teu nome?";
    case "telefone": return `O número que tu tá usando agora (final ${finalDoTelefone(e.telefoneConversa)}) é o mesmo que a gente pode usar no teu cadastro? 1 Sim / 2 Não, é outro`;
    case "email": return "Qual teu e-mail? É por ele que tu entra no painel.";
    case "empresa": return "Qual o nome da tua empresa ou marca? (se não tiver, manda \"não tenho\")";
    case "ramo": return "Tu trabalha com quê? 1 Gráfica/comunicação visual, 2 Agência, 3 Designer, 4 Revenda de brindes, 5 Outro";
    case "cidade": return "De qual cidade e estado tu é? (ex.: Macapá/AP)";
    case "instagram": return "Tem Instagram ou site do teu trabalho? Manda o @ ou o link (ou \"não tenho\").";
    case "documento": return "Se quiser, manda teu CNPJ ou CPF (ou \"pular\").";
    case "volume": return "Mais ou menos quantos pedidos tu faz por mês? 1 Até 5, 2 De 6 a 20, 3 Mais de 20 (ou \"pular\")";
    case "promocoes": return "Posso te mandar novidades e promoções por aqui? (sim/não)";
    case "conferencia": return resumo(e.ficha) + "\n1 Está certo / 2 Corrigir";
    default: return "";
  }
}

const ROTULO_RAMO: Record<RamoDoAgente, string> = {
  comunicacao_visual: "Gráfica/comunicação visual", agencia: "Agência", designer: "Designer",
  revendedor_brindes: "Revenda de brindes", outro: "Outro",
};
const ROTULO_VOLUME: Record<Volume, string> = { ate_5: "Até 5 por mês", "6_20": "De 6 a 20 por mês", mais_20: "Mais de 20 por mês" };

export function resumo(f: Ficha): string {
  const l = (r: string, v: string | null | undefined) => `• ${r}: ${v || "—"}`;
  return [
    "Confere teus dados:",
    l("Nome", f.nome),
    l("WhatsApp", f.telefoneCadastro),
    l("E-mail", f.email),
    l("Empresa", f.empresa),
    l("Ramo", f.ramo ? (f.ramo === "outro" && f.ramoOutro ? `Outro: ${f.ramoOutro}` : ROTULO_RAMO[f.ramo]) : null),
    l("Cidade", f.cidade ? `${f.cidade}/${f.uf}` : null),
    l("Instagram/site", f.instagramOuSite),
    l("CNPJ/CPF", f.documento),
    l("Pedidos", f.volume ? ROTULO_VOLUME[f.volume] : null),
    l("Promoções", f.aceitaPromocoes == null ? null : f.aceitaPromocoes ? "Sim" : "Não"),
  ].join("\n");
}

function preenchido(e: EstadoDoAgente, p: Passo): boolean {
  const f = e.ficha;
  switch (p) {
    case "consentimento": return !!f.aceiteLgpdEm;
    case "nome": return !!f.nome;
    case "telefone": return !!f.telefoneCadastro;
    case "email": return !!f.email;
    default: return e.respondidos.includes(p);
  }
}

function proximoPasso(e: EstadoDoAgente): Passo {
  if (e.corrigindo) return "conferencia";
  return PASSOS.find((p) => p !== "conferencia" && p !== "fim" && !preenchido(e, p)) ?? "conferencia";
}

/** Aproveita o que veio a mais na mesma mensagem (e-mail, @, CNPJ/CPF, cidade/UF). */
function aproveitarExtras(e: EstadoDoAgente, texto: string): void {
  const f = e.ficha;
  const email = texto.match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}/)?.[0];
  if (email && !f.email && emailValido(email) && !sugerirEmail(email)) f.email = email.toLowerCase();
  const insta = texto.match(/(^|\s)(@[A-Za-z0-9._]{2,})(?=\s|$)/)?.[2];
  if (insta && !e.respondidos.includes("instagram")) { f.instagramOuSite = normalizarComprovacao(insta); e.respondidos.push("instagram"); }
  const doc = texto.match(/\d[\d.\-/]{9,}\d/)?.[0];
  if (doc && !e.respondidos.includes("documento") && documentoValido(doc)) { f.documento = doc.replace(/\D/g, ""); e.respondidos.push("documento"); }
}

function invalida(e: EstadoDoAgente, msg: string, out: string[]): MotivoDeTransferencia | null {
  e.invalidas += 1;
  if (e.invalidas >= 2) { out.push(FRASE_TRANSFERENCIA); e.situacao = "transferido"; return "ininteligivel"; }
  out.push(msg);
  return null;
}

function foraDoHorario(agora: Date): boolean {
  const { diaIso, minuto } = relogioLocal(agora);
  return diaIso > 5 || minuto < 8 * 60 || minuto >= 18 * 60;
}

/** Uma mensagem da pessoa → o que o agente responde e o que gravou. */
export function responder(anterior: EstadoDoAgente, entrada: Entrada): Resultado {
  const e: EstadoDoAgente = structuredClone(anterior);
  const out: string[] = [];
  const minimoAntes = minimoCompleto(e.ficha);
  const fim = (transferir: MotivoDeTransferencia | null = null): Resultado => {
    for (const r of out) if (textoBloqueado(r)) {
      e.situacao = "transferido";
      return { estado: e, respostas: [FRASE_TRANSFERENCIA], transferir: "texto_bloqueado", criarPreCadastro: false };
    }
    const criar = !minimoAntes && minimoCompleto(e.ficha);
    if (criar && e.situacao === "coletando") e.situacao = "minimo_completo";
    return { estado: e, respostas: out, transferir, criarPreCadastro: criar };
  };

  if (e.situacao === "saiu" || e.situacao === "transferido" || e.situacao === "enviado") return fim();
  if (e.situacao === "pausado") e.situacao = minimoCompleto(e.ficha) ? "minimo_completo" : "coletando";

  if (entrada.tipo === "midia") { out.push(FRASE_MIDIA); e.situacao = "transferido"; return fim("midia"); }
  const texto = (entrada.texto ?? "").trim();
  const s = sa(texto);

  if (ehSair(texto)) { out.push(FRASE_SAIR); e.situacao = "saiu"; return fim(); }
  if (pedeAtendente(texto) || assuntoDaEquipe(texto)) { out.push(FRASE_TRANSFERENCIA); e.situacao = "transferido"; return fim(texto && pedeAtendente(texto) ? "pediu_atendente" : "assunto_da_equipe"); }

  if (!e.avisouForaDoHorario && foraDoHorario(entrada.agora)) { out.push(FRASE_FORA_DO_HORARIO); e.avisouForaDoHorario = true; }

  if (perguntaDoPrograma(texto) && e.passo !== "consentimento") {
    out.push("Os detalhes do programa estão em bexprint.com.br/seja-parceiro, e a equipe te explica tudo depois do cadastro.");
    out.push(pergunta(e));
    return fim();
  }

  const ok = () => { e.invalidas = 0; };
  let erro: MotivoDeTransferencia | null = null;

  if (e.aguardandoQualCorrigir) {
    const alvo = (Object.keys(ROTULO_DO_PASSO) as Passo[]).find((p) => s.replace(/-/g, "").includes(sa(ROTULO_DO_PASSO[p]).replace(/-/g, "")) || (p === "telefone" && /numero|telefone|whats/.test(s)));
    if (!alvo) { erro = invalida(e, "Qual dado tu quer corrigir? (nome, número, e-mail, empresa, ramo, cidade, instagram, documento, volume ou promoções)", out); return fim(erro); }
    ok(); e.aguardandoQualCorrigir = false; e.corrigindo = true; e.passo = alvo;
    if (alvo === "telefone") { e.ficha.telefoneCadastro = null; e.ficha.telefoneConfirmado = null; }
    out.push(pergunta(e));
    return fim();
  }

  switch (e.passo) {
    case "consentimento":
      if (SIM.test(s)) { e.ficha.aceiteLgpdEm = entrada.agora.toISOString(); ok(); }
      else { erro = invalida(e, "Pra seguir, responde \"sim\". Se não quiser, manda SAIR.", out); return fim(erro); }
      break;
    case "nome": {
      const nome = texto.replace(/^(meu nome e|me chamo|sou o|sou a|eu sou)\s+/i, "").split(/[,\n]/)[0].trim();
      if (nome.length < 2 || nomeParecendoEndereco(nome) || /\d/.test(nome) || /@/.test(nome)) { erro = invalida(e, "Me diz só o teu nome, por favor.", out); return fim(erro); }
      e.ficha.nome = nome; ok(); aproveitarExtras(e, texto.slice(nome.length));
      break;
    }
    case "telefone":
      if (e.aguardandoOutroNumero) {
        const tel = telefoneNormalizado(texto);
        if (!tel) { erro = invalida(e, "Esse número não parece certo. Manda com DDD, assim: (96) 99999-9999.", out); return fim(erro); }
        e.ficha.telefoneCadastro = tel; e.ficha.telefoneConfirmado = false; e.aguardandoOutroNumero = false; ok();
      } else if (SIM.test(s)) {
        e.ficha.telefoneCadastro = telefoneNormalizado(e.telefoneConversa) ?? e.telefoneConversa;
        e.ficha.telefoneConfirmado = true; ok();
      } else if (NAO.test(s)) {
        const tel = telefoneNormalizado(texto.replace(/^\s*2\s*/, ""));
        if (tel && texto.replace(/\D/g, "").length > 2) { e.ficha.telefoneCadastro = tel; e.ficha.telefoneConfirmado = false; }
        else { e.aguardandoOutroNumero = true; ok(); out.push("Beleza! Manda o número certo com DDD."); return fim(); }
        ok();
      } else { erro = invalida(e, "Responde 1 pra Sim ou 2 se for outro número.", out); return fim(erro); }
      break;
    case "email": {
      if (e.sugestaoDeEmail && SIM.test(s)) { e.ficha.email = e.sugestaoDeEmail; e.sugestaoDeEmail = null; ok(); break; }
      const email = texto.match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}/)?.[0]?.toLowerCase();
      if (!email || !emailValido(email)) { erro = invalida(e, "Esse e-mail não parece certo. Confere e manda de novo?", out); return fim(erro); }
      const sugestao = sugerirEmail(email);
      if (sugestao && e.sugestaoDeEmail !== email) { e.sugestaoDeEmail = sugestao; ok(); out.push(`Tu quis dizer ${sugestao}? (sim, ou manda o certo)`); return fim(); }
      e.ficha.email = email; e.sugestaoDeEmail = null; ok(); aproveitarExtras(e, texto.replace(email, ""));
      break;
    }
    case "empresa":
      if (!PULAR.test(s)) {
        if (texto.length < 2 || nomeParecendoEndereco(texto)) { erro = invalida(e, "Me diz só o nome da empresa ou marca (ou \"não tenho\").", out); return fim(erro); }
        e.ficha.empresa = texto;
      }
      e.respondidos.push("empresa"); ok();
      break;
    case "ramo":
      if (e.aguardandoRamoOutro) {
        if (texto.length < 2) { erro = invalida(e, "Me conta em poucas palavras com o que tu trabalha.", out); return fim(erro); }
        e.ficha.ramoOutro = texto; e.aguardandoRamoOutro = false; e.respondidos.push("ramo"); ok();
      } else {
        const r = lerRamo(texto);
        if (!r) { erro = invalida(e, "Escolhe um número de 1 a 5.", out); return fim(erro); }
        e.ficha.ramo = r; ok();
        if (r === "outro") { e.aguardandoRamoOutro = true; out.push("Qual é o teu ramo?"); return fim(); }
        e.respondidos.push("ramo");
      }
      break;
    case "cidade": {
      const c = PULAR.test(s) ? null : lerCidadeUf(texto);
      if (!c && !PULAR.test(s)) { erro = invalida(e, "Manda a cidade e a sigla do estado, assim: Macapá/AP.", out); return fim(erro); }
      if (c) { e.ficha.cidade = c.cidade; e.ficha.uf = c.uf; }
      e.respondidos.push("cidade"); ok();
      break;
    }
    case "instagram":
      if (!PULAR.test(s)) {
        const v = lerInstagramOuSite(texto);
        if (!v) { erro = invalida(e, "Manda o @ do Instagram ou o link do site (ou \"não tenho\").", out); return fim(erro); }
        e.ficha.instagramOuSite = v;
      }
      e.respondidos.push("instagram"); ok();
      break;
    case "documento":
      if (!PULAR.test(s)) {
        if (!documentoValido(texto)) { erro = invalida(e, "Esse CNPJ/CPF não confere. Confere os números ou manda \"pular\".", out); return fim(erro); }
        e.ficha.documento = texto.replace(/\D/g, "");
      }
      e.respondidos.push("documento"); ok();
      break;
    case "volume":
      if (!PULAR.test(s)) {
        const v = lerVolume(texto);
        if (!v) { erro = invalida(e, "Escolhe 1, 2 ou 3 (ou \"pular\").", out); return fim(erro); }
        e.ficha.volume = v;
      }
      e.respondidos.push("volume"); ok();
      break;
    case "promocoes":
      if (SIM.test(s)) e.ficha.aceitaPromocoes = true;
      else if (NAO.test(s)) e.ficha.aceitaPromocoes = false;
      else { erro = invalida(e, "Responde sim ou não.", out); return fim(erro); }
      e.ficha.aceitePromocoesEm = entrada.agora.toISOString();
      e.respondidos.push("promocoes"); ok();
      break;
    case "conferencia":
      if (SIM.test(s)) { ok(); e.passo = "fim"; e.situacao = "enviado"; out.push(FRASE_FIM); return fim(); }
      if (NAO.test(s) || /corrig/.test(s)) {
        ok(); e.aguardandoQualCorrigir = true;
        out.push("Qual dado tu quer corrigir? (nome, número, e-mail, empresa, ramo, cidade, instagram, documento, volume ou promoções)");
        return fim();
      }
      erro = invalida(e, "Responde 1 se está certo ou 2 pra corrigir.", out); return fim(erro);
    default:
      return fim();
  }

  e.passo = proximoPasso(e);
  if (e.passo === "conferencia") e.corrigindo = false;
  out.push(pergunta(e));
  return fim();
}

/** Silêncio: um único lembrete depois de ~30 min; depois a conversa fica pausada. */
export function verificarSilencio(anterior: EstadoDoAgente, msDesdeUltimaMensagem: number): { estado: EstadoDoAgente; respostas: string[] } {
  if (anterior.situacao !== "coletando" && anterior.situacao !== "minimo_completo") return { estado: anterior, respostas: [] };
  if (msDesdeUltimaMensagem < LEMBRETE_APOS_MS) return { estado: anterior, respostas: [] };
  if (anterior.lembreteEnviado) return { estado: { ...anterior, situacao: "pausado" }, respostas: [] };
  return { estado: { ...anterior, lembreteEnviado: true }, respostas: [LEMBRETE] };
}

export { OPCIONAIS };
