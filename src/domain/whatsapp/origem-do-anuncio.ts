/**
 * Sinal de Click-to-WhatsApp no evento cru do Z-API.
 * Caminhos reais (conferidos em whatsapp_webhook_eventos):
 *  - externalAdReply.sourceApp / sourceType / sourceId (só em anúncios)
 *  - adContext.entryPointConversionApp (anúncio, botão de perfil, post…)
 * Só "instagram" e "facebook" contam; o resto deixa a origem como "whatsapp".
 */
export type SinalDeOrigem = {
  canal: "instagram" | "facebook" | null;
  tipo: "anuncio" | "outro" | null;
  anuncioId: string | null;
};

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function campo(p: Record<string, unknown>, chave: string): unknown {
  const ext = objeto(p.externalAdReply);
  const ctx = objeto(p.adContext);
  return ext[chave] ?? ctx[chave] ?? p[chave];
}

export function canalDoSinal(payloadCru: unknown): SinalDeOrigem {
  const p = objeto(payloadCru);
  const app = (texto(campo(p, "sourceApp")) ?? texto(campo(p, "entryPointConversionApp")) ?? "").toLowerCase();
  const canal = app === "instagram" || app === "facebook" ? app : null;
  if (!canal) return { canal: null, tipo: null, anuncioId: null };
  const anuncio = texto(campo(p, "sourceType"))?.toLowerCase() === "ad";
  return {
    canal,
    tipo: anuncio ? "anuncio" : "outro",
    anuncioId: texto(campo(p, "sourceId")),
  };
}

/** Campos planos para p_payload; só inclui o que existir. */
export function camposDeOrigem(payloadCru: unknown): {
  canal_origem?: string;
  tipo_origem?: string;
  anuncio_id?: string;
} {
  const s = canalDoSinal(payloadCru);
  if (!s.canal) return {};
  return {
    canal_origem: s.canal,
    ...(s.tipo ? { tipo_origem: s.tipo } : {}),
    ...(s.anuncioId ? { anuncio_id: s.anuncioId } : {}),
  };
}
