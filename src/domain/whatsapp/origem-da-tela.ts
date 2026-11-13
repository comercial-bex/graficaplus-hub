/**
 * Origem dos contatos: lógica pura da tela de gestão (/configuracoes-origem).
 *
 * Nada aqui fala com o banco nem decide preço. O tipo do contato é uma
 * etiqueta interna, derivada do conjunto de anúncios.
 */
import { normalizarTexto, validarPalavra, type TipoDeContato } from "./origem-do-contato";

export type MotivoSemTipo = "ok" | "sem_conjunto" | "conjunto_inativo" | "conjunto_desconhecido";

export type AnuncioOrdenavel = {
  anuncio_id: string;
  ativo: boolean;
  ultima_vez: string | null;
  motivo_sem_tipo: MotivoSemTipo;
};

const DIA_EM_MS = 86_400_000;

/** "hoje", "ontem", "há 3 dias", "há 2 meses", "nunca". Data inválida também é "nunca". */
export function haQuantoTempo(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "nunca";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "nunca";
  const dias = Math.floor((agora.getTime() - t) / DIA_EM_MS);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

/** Anúncio sem conjunto utilizável: o tipo fica a confirmar e a equipe precisa agir. */
export function precisaDeConjunto(a: Pick<AnuncioOrdenavel, "motivo_sem_tipo">): boolean {
  return a.motivo_sem_tipo !== "ok";
}

/** Pausados saem da lista por padrão. */
export function filtrarAnuncios<T extends Pick<AnuncioOrdenavel, "ativo">>(lista: readonly T[], mostrarPausados: boolean): T[] {
  return lista.filter((a) => mostrarPausados || a.ativo);
}

/**
 * Sem conjunto primeiro, depois a última vez mais recente. Quem nunca chegou
 * vai para o fim do seu grupo. Empate resolve pelo id, para a ordem não pular.
 */
export function ordenarAnuncios<T extends AnuncioOrdenavel>(lista: readonly T[]): T[] {
  const tempo = (v: string | null) => {
    const t = v ? new Date(v).getTime() : Number.NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...lista].sort((a, b) => {
    const pa = precisaDeConjunto(a) ? 0 : 1;
    const pb = precisaDeConjunto(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ta = tempo(a.ultima_vez);
    const tb = tempo(b.ultima_vez);
    if (ta !== tb) return tb > ta ? 1 : -1;
    return a.anuncio_id < b.anuncio_id ? -1 : a.anuncio_id > b.anuncio_id ? 1 : 0;
  });
}

/** Texto da faixa de alerta de um anúncio sem tipo. Nulo quando está tudo certo. */
export function alertaDoAnuncio(motivo: MotivoSemTipo): string | null {
  switch (motivo) {
    case "sem_conjunto":
      return "Anúncio sem conjunto. O tipo fica a confirmar e a equipe vê Preço: tipo a confirmar no aviso. Escolha o conjunto para resolver.";
    case "conjunto_inativo":
      return "O conjunto deste anúncio está desativado. O tipo fica a confirmar. Ative o conjunto ou escolha outro.";
    case "conjunto_desconhecido":
      return "O conjunto deste anúncio não está cadastrado. O tipo fica a confirmar. Escolha um conjunto da lista.";
    default:
      return null;
  }
}

/** Valida o diálogo de conjunto antes de mandar ao servidor (o banco valida de novo). */
export function validarConjunto(v: {
  conjuntoId: string;
  nome: string;
  tipo: TipoDeContato | null;
}): { ok: true } | { ok: false; erros: Partial<Record<"conjuntoId" | "nome" | "tipo", string>> } {
  const erros: Partial<Record<"conjuntoId" | "nome" | "tipo", string>> = {};
  if (!/^\d{6,40}$/.test(v.conjuntoId.trim())) {
    erros.conjuntoId = "O id tem só números, de 6 a 40 dígitos. Copie da coluna Identificação do conjunto.";
  }
  if (!v.nome.trim()) erros.nome = "Dê um nome ao conjunto.";
  if (!v.tipo) erros.tipo = "Escolha para quem é o conjunto: cliente final ou parceiro.";
  return Object.keys(erros).length === 0 ? { ok: true } : { ok: false, erros };
}

/** Validação do id de anúncio digitado à mão. */
export function validarIdDoAnuncio(v: string): string | null {
  return /^\d{6,40}$/.test(v.trim())
    ? null
    : "O id tem só números, de 6 a 40 dígitos. Copie da coluna Identificação do anúncio.";
}

/**
 * Como a palavra digitada será guardada, para a pessoa conferir antes de
 * adicionar. Devolve também o erro e se a palavra já existe na lista.
 */
export function prever(
  digitada: string,
  existentes: readonly string[],
): { guardada: string | null; erro: string | null; repetida: boolean } {
  if (digitada.trim() === "") return { guardada: null, erro: null, repetida: false };
  const v = validarPalavra(digitada);
  if (!v.ok) return { guardada: null, erro: v.erro, repetida: false };
  const repetida = existentes.some((p) => normalizarTexto(p) === v.palavra);
  return { guardada: v.palavra, erro: null, repetida };
}

/** Texto do aviso de confirmação ao mudar o tipo de um conjunto que já existe. */
export const AVISO_MUDAR_TIPO_DO_CONJUNTO =
  "Isso vale para os próximos contatos dos anúncios deste conjunto. Contatos antigos continuam como estão.";
