/**
 * Sinal de Click-to-WhatsApp no evento cru do Z-API.
 * Caminhos reais (conferidos em whatsapp_webhook_eventos):
 *  - externalAdReply.sourceApp / sourceType / sourceId (só em anúncios)
 *    sourceId é o id do ANÚNCIO (nunca do conjunto nem da campanha)
 *  - externalAdReply.title / body / sourceUrl / ctwaClid (o criativo do momento)
 *  - adContext.entryPointConversionApp / entryPointConversionSource
 *    (ctwa_ad, click_to_chat_link, post_cta...)
 * Só "instagram" e "facebook" viram canal; o resto deixa a origem como
 * "whatsapp". O anúncio, porém, é catalogado mesmo sem canal: o Z-API às vezes
 * manda sourceApp nulo (2 de 14 eventos medidos em 12/11/2026).
 *
 * Nada aqui decide tipo de contato nem preço. O tipo nasce no banco, pela
 * tabela editável anuncio para conjunto para tipo.
 */
export type SinalDeOrigem = {
  canal: "instagram" | "facebook" | null;
  tipo: "anuncio" | "outro" | null;
  anuncioId: string | null;
  titulo: string | null;
  corpo: string | null;
  link: string | null;
  ctwaClid: string | null;
  entrada: string | null;
};

/** Limites iguais aos do banco (_wa_registrar_anuncio corta de novo). */
export const LIMITES_DA_ORIGEM = {
  titulo: 200,
  corpo: 500,
  link: 500,
  ctwaClid: 300,
  entrada: 60,
} as const;

/** Id de anúncio da Meta: só dígitos. O resto é lixo ou outro tipo de id. */
const ID_DE_ANUNCIO = /^\d{6,40}$/;

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** Texto de exibição: sem controles nem quebras, espaços colapsados, cortado por caractere inteiro. */
export function limparTexto(v: unknown, limite: number): string | null {
  if (typeof v !== "string") return null;
  // Corta antes de limpar para um texto gigante não custar caro.
  const bruto = v.slice(0, limite * 4);
  // eslint-disable-next-line no-control-regex
  const limpo = bruto.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  if (!limpo) return null;
  const letras = Array.from(limpo);
  return letras.length > limite ? letras.slice(0, limite).join("").trim() || null : limpo;
}

/** Procura em externalAdReply, depois adContext, depois na raiz (campos de origem). */
function campo(p: Record<string, unknown>, chave: string): unknown {
  const ext = objeto(p.externalAdReply);
  const ctx = objeto(p.adContext);
  return ext[chave] ?? ctx[chave] ?? p[chave];
}

/** Campos do criativo: só dentro dos blocos de anúncio, nunca na raiz (title e body existem em outras mensagens). */
function campoDoCriativo(p: Record<string, unknown>, chave: string): unknown {
  const ext = objeto(p.externalAdReply);
  const ctx = objeto(p.adContext);
  return ext[chave] ?? ctx[chave];
}

export function idDeAnuncioValido(v: unknown): string | null {
  const t = texto(v);
  return t && ID_DE_ANUNCIO.test(t) ? t : null;
}

function linkValido(v: unknown): string | null {
  const t = limparTexto(v, LIMITES_DA_ORIGEM.link);
  if (!t || /\s/.test(t)) return null;
  return /^https?:\/\/[^\s/]+/i.test(t) ? t : null;
}

function entradaValida(v: unknown): string | null {
  const t = texto(v)?.toLowerCase();
  return t && /^[a-z0-9_]{1,60}$/.test(t) ? t : null;
}

const SEM_SINAL: SinalDeOrigem = {
  canal: null,
  tipo: null,
  anuncioId: null,
  titulo: null,
  corpo: null,
  link: null,
  ctwaClid: null,
  entrada: null,
};

export function canalDoSinal(payloadCru: unknown): SinalDeOrigem {
  const p = objeto(payloadCru);
  const app = (texto(campo(p, "sourceApp")) ?? texto(campo(p, "entryPointConversionApp")) ?? "").toLowerCase();
  const canal = app === "instagram" || app === "facebook" ? app : null;
  const ehAnuncio = texto(campo(p, "sourceType"))?.toLowerCase() === "ad";
  const anuncioId = idDeAnuncioValido(campo(p, "sourceId"));
  const entrada = entradaValida(campoDoCriativo(p, "entryPointConversionSource"));
  const ctwaClid = limparTexto(campoDoCriativo(p, "ctwaClid"), LIMITES_DA_ORIGEM.ctwaClid);

  // Anúncio sem canal ainda é anúncio: entra no catálogo, a origem do lead fica "whatsapp".
  if (!canal && !ehAnuncio && !anuncioId && !entrada && !ctwaClid) return { ...SEM_SINAL };
  const doAnuncio = ehAnuncio || anuncioId != null;

  return {
    canal,
    tipo: ehAnuncio ? "anuncio" : canal ? "outro" : null,
    anuncioId,
    titulo: doAnuncio ? limparTexto(campoDoCriativo(p, "title"), LIMITES_DA_ORIGEM.titulo) : null,
    corpo: doAnuncio ? limparTexto(campoDoCriativo(p, "body"), LIMITES_DA_ORIGEM.corpo) : null,
    link: doAnuncio ? linkValido(campoDoCriativo(p, "sourceUrl")) : null,
    ctwaClid,
    entrada,
  };
}

export type CamposDeOrigem = {
  canal_origem?: string;
  tipo_origem?: string;
  anuncio_id?: string;
  anuncio_titulo?: string;
  anuncio_corpo?: string;
  anuncio_link?: string;
  ctwa_clid?: string;
  entry_point?: string;
};

/**
 * Campos PLANOS para p_payload; só inclui o que existir. Nada aninhado:
 * tests/rpc-assinaturas desiste de conferir os parâmetros se houver objeto.
 * Pura e nunca lança: um evento estranho resulta em {}.
 */
export function camposDeOrigem(payloadCru: unknown): CamposDeOrigem {
  try {
    const s = canalDoSinal(payloadCru);
    return {
      ...(s.canal ? { canal_origem: s.canal } : {}),
      ...(s.tipo ? { tipo_origem: s.tipo } : {}),
      ...(s.anuncioId ? { anuncio_id: s.anuncioId } : {}),
      ...(s.titulo ? { anuncio_titulo: s.titulo } : {}),
      ...(s.corpo ? { anuncio_corpo: s.corpo } : {}),
      ...(s.link ? { anuncio_link: s.link } : {}),
      ...(s.ctwaClid ? { ctwa_clid: s.ctwaClid } : {}),
      ...(s.entrada ? { entry_point: s.entrada } : {}),
    };
  } catch {
    return {};
  }
}
