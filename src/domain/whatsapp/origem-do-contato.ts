/**
 * Origem do contato: funções puras da classificação interna.
 *
 * O tipo do contato ("cliente_final" ou "parceiro") é uma ETIQUETA INTERNA da
 * equipe. Não decide preço: o preço de parceiro só vale para quem tem cadastro
 * de parceiro. A ligação anúncio para conjunto para tipo mora em tabela
 * editável (conjuntos_anuncio, anuncios_origem), nunca em código.
 */
export type TipoDeContato = "cliente_final" | "parceiro";
export type OrigemDoTipo = "anuncio" | "palavra" | "telefone" | "manual";

export const TIPOS_DE_CONTATO: readonly TipoDeContato[] = ["cliente_final", "parceiro"];
export const ORIGENS_DO_TIPO: readonly OrigemDoTipo[] = ["anuncio", "palavra", "telefone", "manual"];

export type ConjuntoDeAnuncio = {
  conjunto_id: string;
  nome: string;
  tipo: TipoDeContato;
  produto_padrao: string | null;
  ativo: boolean;
};

export type AnuncioDeOrigem = {
  anuncio_id: string;
  conjunto_id: string | null;
  produto: string | null;
};

export function ehTipoDeContato(v: unknown): v is TipoDeContato {
  return v === "cliente_final" || v === "parceiro";
}

export function ehOrigemDoTipo(v: unknown): v is OrigemDoTipo {
  return v === "anuncio" || v === "palavra" || v === "telefone" || v === "manual";
}

/** Rótulo para a equipe. Nunca fala de preço. */
export function rotuloDoTipo(tipo: unknown): string {
  if (tipo === "parceiro") return "Parceiro";
  if (tipo === "cliente_final") return "Cliente final";
  return "Tipo a confirmar";
}

/**
 * Espelho de bex_normalizar_texto (banco): minúsculas, sem acento, tudo que
 * não é letra ou número vira um espaço, bordas aparadas.
 */
export function normalizarTexto(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palavra cadastrada com a intenção que ela revela. */
export type PalavraComTipo = { palavra: string; tipo: TipoDeContato };

function casaPalavra(textoNormalizado: string, palavra: unknown): boolean {
  const n = normalizarTexto(palavra);
  return n !== "" && textoNormalizado.includes(` ${n}`);
}

/**
 * A palavra casa quando começa uma palavra do texto (fronteira só à esquerda,
 * como no banco): "parceria" casa "parcerias", mas "ser parceiro" não casa
 * "meu parceiro indicou".
 */
export function textoTemPalavra(texto: unknown, palavras: readonly string[]): boolean {
  const t = ` ${normalizarTexto(texto)}`;
  if (t.trim() === "") return false;
  return palavras.some((p) => casaPalavra(t, p));
}

/**
 * Tipo que as palavras da tabela dão ao texto. Palavra de parceiro vence
 * palavra de cliente final se as duas casarem. Palavra de tipo desconhecido
 * é ignorada. Nulo quando nenhuma casa.
 */
export function tipoPelasPalavras(
  texto: unknown,
  palavras: readonly PalavraComTipo[],
): TipoDeContato | null {
  const t = ` ${normalizarTexto(texto)}`;
  if (t.trim() === "") return null;
  return palavraDoTipo(t, palavras, "parceiro") ? "parceiro" : palavraDoTipo(t, palavras, "cliente_final") ? "cliente_final" : null;
}

/** Só diz se alguma palavra daquele tipo casa. Usado pela prioridade com telefone de parceiro no meio. */
export function textoTemPalavraDoTipo(
  texto: unknown,
  palavras: readonly PalavraComTipo[],
  tipo: TipoDeContato,
): boolean {
  const t = ` ${normalizarTexto(texto)}`;
  return t.trim() !== "" && palavraDoTipo(t, palavras, tipo);
}

function palavraDoTipo(t: string, palavras: readonly PalavraComTipo[], tipo: TipoDeContato): boolean {
  return palavras.some((p) => p.tipo === tipo && casaPalavra(t, p.palavra));
}

/** Validação da palavra na tela, antes de enviar (o banco valida de novo). */
export function validarPalavra(v: unknown): { ok: true; palavra: string } | { ok: false; erro: string } {
  const palavra = normalizarTexto(v);
  if (!palavra) return { ok: false, erro: "Escreva a palavra." };
  if (palavra.replace(/ /g, "").length < 4) {
    return { ok: false, erro: "A palavra precisa ter pelo menos 4 letras, senão marca contato errado." };
  }
  return { ok: true, palavra };
}

/** Tipo efetivo do anúncio: sempre o do conjunto ativo dele. Sem conjunto ou conjunto inativo, nulo. */
export function tipoDoAnuncio(
  anuncio: Pick<AnuncioDeOrigem, "conjunto_id"> | null | undefined,
  conjuntos: readonly Pick<ConjuntoDeAnuncio, "conjunto_id" | "tipo" | "ativo">[],
): { tipo: TipoDeContato | null; motivo: "ok" | "sem_conjunto" | "conjunto_inativo" | "conjunto_desconhecido" } {
  if (!anuncio?.conjunto_id) return { tipo: null, motivo: "sem_conjunto" };
  const c = conjuntos.find((x) => x.conjunto_id === anuncio.conjunto_id);
  if (!c) return { tipo: null, motivo: "conjunto_desconhecido" };
  if (!c.ativo) return { tipo: null, motivo: "conjunto_inativo" };
  return { tipo: ehTipoDeContato(c.tipo) ? c.tipo : null, motivo: "ok" };
}

/** Produto efetivo: o do anúncio vence; vazio herda o padrão do conjunto. */
export function produtoDoAnuncio(
  anuncio: Pick<AnuncioDeOrigem, "produto"> | null | undefined,
  conjunto: Pick<ConjuntoDeAnuncio, "produto_padrao"> | null | undefined,
): string | null {
  const proprio = anuncio?.produto?.trim();
  if (proprio) return proprio;
  const padrao = conjunto?.produto_padrao?.trim();
  return padrao ? padrao : null;
}

/** Frase que diz de onde veio a etiqueta. Só para a equipe. */
export function frasesDaOrigemDoTipo(p: {
  tipo: TipoDeContato | null;
  origem: OrigemDoTipo | null;
  anuncioNome?: string | null;
  produto?: string | null;
}): { origem: string; produto: string | null } {
  const produto = p.produto?.trim() ? `Produto do anúncio: ${p.produto.trim()}` : null;
  if (!p.tipo) return { origem: "Ainda sem tipo. Marque quando souber.", produto };
  switch (p.origem) {
    case "anuncio": {
      const nome = p.anuncioNome?.trim();
      return { origem: nome ? `Marcado pelo anúncio ${nome}` : "Marcado pelo anúncio", produto };
    }
    case "palavra":
      return { origem: "Marcado pela palavra na primeira mensagem", produto };
    case "telefone":
      return { origem: "Marcado porque é parceiro cadastrado", produto };
    case "manual":
      return { origem: "Marcado por você", produto };
    default:
      return { origem: "Marcado pela equipe", produto };
  }
}

export const AVISO_DA_ETIQUETA = "Só uma etiqueta interna. O preço de parceiro exige cadastro como parceiro.";
