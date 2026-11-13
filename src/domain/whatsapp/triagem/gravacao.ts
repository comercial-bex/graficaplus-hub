import { semAcento } from "./normalizar";
import type { DadosColetados, EnderecoDoCep, Ramo } from "./tipos";

/**
 * Seção 4 do projeto: o que gravar quando o contato responde, só as regras de
 * decisão. A resposta do contato fica sempre registrada na triagem; só uma parte
 * vira cadastro, e só se for melhor que o que já existe. Quem decide é regra
 * escrita, nunca COALESCE solto.
 */

export const DADOS_VAZIOS: DadosColetados = {
  nomeInformado: null,
  nomeCompleto: false,
  primeiraVez: null,
  cep: null,
  cepEndereco: null,
  enderecoTexto: null,
  enderecoRecusado: false,
  telefoneConfirmado: null,
  telefoneAlternativo: null,
  telefoneAlternativoVerificado: false,
  pediuPreco: false,
  pediuTabelaEspecial: false,
  pediuEquipe: false,
  pediuParceria: false,
  mandouAudio: false,
  reclamou: false,
};

const BOOLEANOS: (keyof DadosColetados)[] = [
  "nomeCompleto",
  "enderecoRecusado",
  "pediuPreco",
  "pediuTabelaEspecial",
  "pediuEquipe",
  "pediuParceria",
  "mandouAudio",
  "reclamou",
];

/**
 * Cada campo da triagem é de escrita única: a segunda resposta não sobrescreve a
 * primeira. Exceção: o telefone alternativo, corrigido dentro da própria etapa
 * `telefone_novo` (`permitirTrocaDoAlternativo`). Marcas booleanas só sobem.
 */
export function aplicarDadosNovos(
  atual: DadosColetados,
  novos: Partial<DadosColetados>,
  opcoes: { permitirTrocaDoAlternativo?: boolean } = {},
): DadosColetados {
  const saida: DadosColetados = { ...atual };
  const alvo = saida as Record<string, unknown>;
  for (const [chave, valor] of Object.entries(novos)) {
    if (valor === undefined || chave === "telefoneAlternativoVerificado") continue;
    const k = chave as keyof DadosColetados;
    if (BOOLEANOS.includes(k)) {
      alvo[k] = Boolean(atual[k]) || Boolean(valor);
      continue;
    }
    if (k === "telefoneAlternativo" && opcoes.permitirTrocaDoAlternativo) {
      alvo[k] = valor;
      continue;
    }
    if (atual[k] === null || atual[k] === undefined) alvo[k] = valor;
  }
  return saida;
}

/** O ramo só sobe: de cliente para parceiro. Parceiro nunca desce no meio da conversa. */
export function subirRamo(atual: Ramo, novo: Ramo): Ramo {
  return atual === "parceiro" ? "parceiro" : novo;
}

/* ------------------------------------------------------------------ */
/* Nome no lead                                                        */
/* ------------------------------------------------------------------ */

function palavrasDeLetras(nome: string): number {
  return nome.split(/\s+/).filter((p) => /\p{L}{2,}/u.test(p)).length;
}

function temSimboloOuEmoji(nome: string): boolean {
  return /[^\p{L}\p{N}\s.'’-]/u.test(nome) || /\p{Extended_Pictographic}/u.test(nome);
}

export type DecisaoDeNome = {
  gravar: boolean;
  motivo:
    | "marcador"
    | "igual_ao_perfil_e_melhor"
    | "editado_pela_equipe"
    | "nao_e_melhor"
    | "triagem_nao_concluida"
    | "sem_nome";
};

/**
 * Só atualiza `leads.nome` quando a triagem CONCLUIU (a pessoa confirmou o fluxo, não
 * a primeira resposta solta) e o valor atual é o marcador "Lead WhatsApp <telefone>"
 * ou igual ao nome do perfil e o novo é melhor. Nome que a equipe editou, isto é,
 * diferente das duas referências, nunca é tocado. Nome de uma palavra só substitui
 * marcador, nunca um nome de duas palavras.
 */
export function decidirNomeDoLead(a: {
  nomeAtualDoLead: string | null;
  nomeDoPerfil: string | null;
  nomeInformado: string | null;
  triagemConcluida: boolean;
}): DecisaoDeNome {
  const novo = (a.nomeInformado ?? "").trim();
  if (!novo) return { gravar: false, motivo: "sem_nome" };
  if (!a.triagemConcluida) return { gravar: false, motivo: "triagem_nao_concluida" };
  const atual = (a.nomeAtualDoLead ?? "").trim();
  const ehMarcador = /^lead whatsapp\b/i.test(atual) || atual === "";
  if (ehMarcador) return { gravar: true, motivo: "marcador" };
  const perfil = (a.nomeDoPerfil ?? "").trim();
  const igualAoPerfil =
    perfil !== "" && semAcento(atual).toLowerCase() === semAcento(perfil).toLowerCase();
  if (!igualAoPerfil) return { gravar: false, motivo: "editado_pela_equipe" };
  if (palavrasDeLetras(novo) < 2 && palavrasDeLetras(atual) >= 2)
    return { gravar: false, motivo: "nao_e_melhor" };
  const melhor = palavrasDeLetras(novo) > palavrasDeLetras(atual) || temSimboloOuEmoji(atual);
  return melhor
    ? { gravar: true, motivo: "igual_ao_perfil_e_melhor" }
    : { gravar: false, motivo: "nao_e_melhor" };
}

/* ------------------------------------------------------------------ */
/* Endereço, telefone alternativo e bloqueio                           */
/* ------------------------------------------------------------------ */

export type EnderecoParaCopiar = Partial<{
  cep: string;
  rua: string;
  bairro: string;
  cidade: string;
  estado: string;
}>;

/**
 * Na conversão do lead em cliente: copia CEP e endereço da triagem só para as
 * colunas VAZIAS do cliente. Cliente que já existia nunca tem endereço sobrescrito.
 */
export function enderecoParaCopiar(a: {
  clienteJaExistia: boolean;
  cliente: Partial<Record<keyof EnderecoParaCopiar, string | null>>;
  cep: string | null;
  endereco: EnderecoDoCep | null;
  enderecoRecusado: boolean;
}): EnderecoParaCopiar {
  if (a.clienteJaExistia || a.enderecoRecusado || !a.cep) return {};
  const vazio = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";
  const fonte: EnderecoParaCopiar = {
    cep: a.cep,
    ...(a.endereco?.rua ? { rua: a.endereco.rua } : {}),
    ...(a.endereco?.bairro ? { bairro: a.endereco.bairro } : {}),
    ...(a.endereco?.cidade ? { cidade: a.endereco.cidade } : {}),
    ...(a.endereco?.estado ? { estado: a.endereco.estado } : {}),
  };
  const out: EnderecoParaCopiar = {};
  for (const [k, v] of Object.entries(fonte) as [keyof EnderecoParaCopiar, string][]) {
    if (vazio(a.cliente[k])) out[k] = v;
  }
  return out;
}

/**
 * O número alternativo não tem prova de posse: qualquer pessoa pode informar o
 * celular de um terceiro. Nunca vai para `clientes` nem para `cliente_contatos`
 * sozinho, e enquanto não for confirmado por gente não recebe aviso nenhum.
 */
export function podeCopiarTelefoneAlternativo(a: { confirmadoPorGente: boolean }): {
  copiar: boolean;
  motivo: string;
} {
  return a.confirmadoPorGente
    ? { copiar: true, motivo: "confirmado_por_gente" }
    : { copiar: false, motivo: "alternativo_nao_verificado" };
}

/** Chaves do bloqueio: por conversa, por lid e por telefone, para o parar valer também em contato só com lid. */
export function chavesDeBloqueio(a: {
  conversaId: string;
  chatLid?: string | null;
  telefoneNormalizado?: string | null;
}): string[] {
  const chaves = [`conversa:${a.conversaId}`];
  if (a.chatLid) chaves.push(`lid:${a.chatLid}`);
  if (a.telefoneNormalizado) chaves.push(`telefone:${a.telefoneNormalizado}`);
  return chaves;
}
