import { entraNoSorteio } from "./textos";
import { normalizarTexto } from "./normalizar";
import { interpretar } from "./quadro";
import type { ConfigDaTriagem, RespostaDoQuadro } from "./tipos";

/**
 * O portão da triagem (seção 1.2 do projeto, com as correções das críticas) e a
 * detecção de robô de empresa. Funções puras: o banco (B4) aplica o mesmo portão
 * dentro da transação; esta versão serve de contrato, de simulador e de teste.
 */

export type EstadoDaConfiguracao = "desligada" | "ensaio" | "teste" | "parcial" | "ligada";

export type EntradaDoPortao = {
  /** Mensagem de entrada de pessoa: não eco do celular, não modelo de empresa, não duplicada. */
  ehDePessoa: boolean;
  /** Sufixo de grupo (@g.us) no chatId do evento. */
  ehDeGrupo: boolean;
  texto: string | null;
  origem: string | null;
};

export type ConversaDoPortao = {
  criadaEm: number;
  clienteVinculado: boolean;
  temResponsavel: boolean;
  arquivada: boolean;
  modoHumano: boolean;
  /** Saída de gente (humano ou celular) ou aviso automático de pedido/cobrança antes de abrir. */
  saidasAnteriores: number;
};

export type TelefoneDoPortao = {
  bloqueado: boolean;
  /** `_wa_telefone_da_equipe`: celular de quem trabalha na Bex Print. */
  ehDaEquipe: boolean;
  /** Telefone ou lid casa com cliente, telefone_2, cliente_contatos, lead ganho ou conversa antiga atendida. */
  jaEConhecido: boolean;
  ehDeTeste: boolean;
};

export type VolumeDoPortao = {
  novasNaHora: number;
  novasNoDia: number;
  maxPorHora: number;
  maxPorDia: number;
};

export type MotivoDoPortao =
  | "desligada"
  | "antes_da_data"
  | "nao_e_pessoa"
  | "grupo"
  | "equipe"
  | "cliente_vinculado"
  | "tem_responsavel"
  | "arquivada"
  | "modo_humano"
  | "ja_atendida"
  | "cliente_conhecido"
  | "bloqueado"
  | "robo"
  | "sem_onda_a"
  | "fora_dos_numeros_de_teste"
  | "fora_do_sorteio"
  | "freio_de_volume";

export type DecisaoDoPortao = {
  abre: boolean;
  motivo: MotivoDoPortao | null;
  modo: "ensaio" | "real" | null;
};

export function portaoDaTriagem(a: {
  estado: EstadoDaConfiguracao;
  percentual: number;
  valeAPartirDe: number | null;
  conversaId: string;
  entrada: EntradaDoPortao;
  conversa: ConversaDoPortao;
  telefone: TelefoneDoPortao;
  volume: VolumeDoPortao;
  quadro: readonly RespostaDoQuadro[];
  /** O contato veio de anúncio e a Onda A (leads.tipo e mapa de anúncios) ainda não foi aplicada. */
  veioDeAnuncioSemOndaA?: boolean;
}): DecisaoDoPortao {
  const nao = (motivo: MotivoDoPortao): DecisaoDoPortao => ({ abre: false, motivo, modo: null });
  if (a.estado === "desligada") return nao("desligada");
  if (a.valeAPartirDe === null || a.conversa.criadaEm < a.valeAPartirDe)
    return nao("antes_da_data");
  if (!a.entrada.ehDePessoa) return nao("nao_e_pessoa");
  if (a.entrada.ehDeGrupo) return nao("grupo");
  // só o degrau de teste ignora a exclusão da equipe, e só para número de teste
  const equipeIgnorada = a.estado === "teste" && a.telefone.ehDeTeste;
  if (a.telefone.ehDaEquipe && !equipeIgnorada) return nao("equipe");
  if (a.conversa.clienteVinculado) return nao("cliente_vinculado");
  if (a.conversa.temResponsavel) return nao("tem_responsavel");
  if (a.conversa.arquivada) return nao("arquivada");
  if (a.conversa.modoHumano) return nao("modo_humano");
  if (a.conversa.saidasAnteriores > 0) return nao("ja_atendida");
  if (a.telefone.jaEConhecido) return nao("cliente_conhecido");
  if (a.telefone.bloqueado) return nao("bloqueado");
  if (detectarRobo({ texto: a.entrada.texto, origem: a.entrada.origem, quadro: a.quadro }).suspeito)
    return nao("robo");
  if (a.veioDeAnuncioSemOndaA) return nao("sem_onda_a");
  if (a.estado === "teste" && !a.telefone.ehDeTeste) return nao("fora_dos_numeros_de_teste");
  if (
    a.estado === "parcial" &&
    !a.telefone.ehDeTeste &&
    !entraNoSorteio(a.conversaId, a.percentual)
  )
    return nao("fora_do_sorteio");
  if (a.volume.novasNaHora >= a.volume.maxPorHora || a.volume.novasNoDia >= a.volume.maxPorDia)
    return nao("freio_de_volume");
  return { abre: true, motivo: null, modo: a.estado === "ensaio" ? "ensaio" : "real" };
}

/* ------------------------------------------------------------------ */
/* Robô de empresa                                                     */
/* ------------------------------------------------------------------ */

export type MotivoDeRobo =
  | "origem_automacao"
  | "texto_longo"
  | "link"
  | "negrito_no_comeco"
  | "frase_de_robo"
  | "resposta_rapida_demais"
  | "texto_repetido";

/**
 * Sinais estruturais de que o outro lado é uma automação, além das frases do
 * quadro. Evita o laço de duas automações trocando mensagens até o teto.
 */
export function detectarRobo(a: {
  texto: string | null;
  origem?: string | null;
  quadro?: readonly RespostaDoQuadro[];
  /** Milissegundos entre o nosso último envio e esta mensagem; negativo ou nulo ignora. */
  msDesdeNossoEnvio?: number | null;
  ultimaEntradaNormalizada?: string | null;
  config?: Pick<ConfigDaTriagem, "respostaRapidaDemaisMs">;
}): { suspeito: boolean; motivo: MotivoDeRobo | null } {
  const sim = (motivo: MotivoDeRobo) => ({ suspeito: true, motivo });
  const texto = a.texto ?? "";
  if (a.origem === "automacao") return sim("origem_automacao");
  if (texto.length > 300) return sim("texto_longo");
  if (/https?:\/\/|www\./i.test(texto)) return sim("link");
  if (/^\s*\*[^*\s]/.test(texto)) return sim("negrito_no_comeco");
  const norm = normalizarTexto(texto);
  // "responda PARAR para sair", "digite 1 para...": instrução de menu, nunca de pessoa
  if (
    /\b(responda|digite)\s+\w+\s+para\b|\bpara\s+(sair|cancelar|parar|descadastrar)\b[^.]{0,40}\b(responda|digite)\b/i.test(
      texto,
    )
  )
    return sim("frase_de_robo");
  if (a.quadro && interpretar(texto, null, a.quadro).intencao === "automatica")
    return sim("frase_de_robo");
  const limite = a.config?.respostaRapidaDemaisMs ?? 2500;
  if (
    a.msDesdeNossoEnvio != null &&
    a.msDesdeNossoEnvio >= 0 &&
    a.msDesdeNossoEnvio < limite &&
    norm.length >= 15
  ) {
    return sim("resposta_rapida_demais");
  }
  if (norm.length >= 10 && a.ultimaEntradaNormalizada && norm === a.ultimaEntradaNormalizada)
    return sim("texto_repetido");
  return { suspeito: false, motivo: null };
}
