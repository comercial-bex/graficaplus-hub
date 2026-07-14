/**
 * OCR do print do fatiador (Bambu Studio, Orca, Cura, PrusaSlicer).
 * - Pré-processa a imagem (grayscale + contraste + inversão se fundo escuro)
 *   antes de rodar o Tesseract, o que aumenta muito o acerto em prints do
 *   Bambu Studio (tema dark).
 * - Extrai peso (g), tempo, peso de suporte/purga, peças na placa,
 *   tipo de filamento, altura de camada e infill %.
 */

export type OcrResult = {
  gramas?: number;
  minutos?: number; // tempo total em minutos
  pesoSuporteG?: number;
  pesoPurgaG?: number;
  pecasPorPlaca?: number;
  filamentoTipo?: string;
  alturaCamadaMm?: number;
  infillPct?: number;
  texto: string;
};

/** Converte um match numérico com vírgula ou ponto em número decimal. */
function toNumber(raw: string): number {
  // Se tem vírgula, ela é o decimal (formato pt-BR); pontos viram nada (milhar).
  // Se tem só ponto, ele é o decimal (formato en-US).
  const s = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return parseFloat(s);
}

/**
 * Extrai o peso em gramas. Prioriza:
 *   1. valor com decimal (X,YY g ou X.YY g) — cobre "6,52 g"
 *   2. label âncora: "filament used [g]", "material", "used filament"
 *   3. fallback: maior inteiro seguido de "g"
 * Rejeita "652 g" quando "6,52 g" existe na mesma imagem.
 */
function parseGramas(texto: string): number | undefined {
  const decimais = [...texto.matchAll(/(\d{1,3}[.,]\d{1,3})\s*g\b/gi)]
    .map((m) => toNumber(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);

  // Labels âncoras
  const ancora = texto.match(
    /(?:filament\s+used(?:\s*\[g\])?|used\s+filament|material|filamento\s+usado)[^\d]{0,20}(\d+[.,]?\d*)\s*g?/i,
  );
  const porAncora = ancora ? toNumber(ancora[1]) : undefined;

  if (decimais.length > 0) {
    return Math.max(...decimais);
  }
  if (porAncora !== undefined && Number.isFinite(porAncora) && porAncora > 0) {
    return porAncora;
  }
  // último recurso: inteiro com "g" — só aceita se < 1000 (peça implausível > 1kg via OCR ruim)
  const inteiros = [...texto.matchAll(/\b(\d{1,3})\s*g\b/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n > 0 && n < 1000);
  return inteiros.length ? Math.max(...inteiros) : undefined;
}

/** Extrai o tempo total em minutos. */
function parseTempoMinutos(texto: string): number | undefined {
  // 1) "Xh Ym" — prioriza linhas com âncora
  const ancora =
    texto.match(
      /(?:total|estimated|estimativa|tempo(?:\s+de\s+impress\w+)?)[^\d]{0,30}(\d+)\s*h\s*(\d+)\s*m/i,
    ) || [...texto.matchAll(/(\d+)\s*h\s*(\d+)\s*m/gi)].at(-1);
  if (ancora) {
    const h = parseInt(ancora[1], 10);
    const m = parseInt(ancora[2], 10);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  }
  // 2) HH:MM(:SS)
  const hms = texto.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (hms) return parseInt(hms[1], 10) * 60 + parseInt(hms[2], 10);
  // 3) só "Xh" ou "X,Yh"
  const soHoras = texto.match(/\b(\d+[.,]?\d*)\s*h\b/i);
  if (soHoras) return Math.round(toNumber(soHoras[1]) * 60);
  // 4) só "Xmin" / "Xm"
  const soMin = texto.match(/\b(\d+)\s*min\b/i);
  if (soMin) return parseInt(soMin[1], 10);
  return undefined;
}

/** Extrai gramas e tempo do texto bruto do OCR. */
export function parseSlicerText(texto: string): OcrResult {
  const t = texto.replace(/\u00a0/g, " ");

  const gramas = parseGramas(t);
  const minutos = parseTempoMinutos(t);

  // Peso de suporte
  const supMatch = t.match(/(?:support|suporte)[^\d]{0,20}(\d+[.,]?\d*)\s*g/i);
  const pesoSuporteG = supMatch ? toNumber(supMatch[1]) : undefined;

  // Peso de purga / prime tower / wipe tower
  const purMatch = t.match(
    /(?:purge|purga|prime\s*tower|wipe\s*tower|torre)[^\d]{0,20}(\d+[.,]?\d*)\s*g/i,
  );
  const pesoPurgaG = purMatch ? toNumber(purMatch[1]) : undefined;

  // Peças na placa (ex.: "5 objects", "5 peças", "plate x5")
  const pecasMatch =
    t.match(/(\d+)\s*(?:objects?|pe[çc]as?|parts?)\b/i) ||
    t.match(/\bplate\s*[x×]?\s*(\d+)\b/i);
  const pecasPorPlaca = pecasMatch ? parseInt(pecasMatch[1], 10) : undefined;

  // Tipo de filamento
  const tipoMatch = t.match(/\b(PLA\+?|PETG|ABS|ASA|TPU|PC|PA|Nylon|HIPS)\b/i);
  const filamentoTipo = tipoMatch ? tipoMatch[1].toUpperCase() : undefined;

  // Altura de camada (ex.: "0.2 mm layer height")
  const camMatch =
    t.match(/(?:layer\s*height|altura\s*(?:de\s*)?camada)[^\d]{0,10}(\d+[.,]?\d*)\s*mm/i) ||
    t.match(/(\d+[.,]?\d*)\s*mm\s*(?:layer|camada)/i);
  const alturaCamadaMm = camMatch ? toNumber(camMatch[1]) : undefined;

  // Infill
  const infillMatch = t.match(/(?:infill|preenchimento)[^\d]{0,10}(\d+[.,]?\d*)\s*%/i);
  const infillPct = infillMatch ? toNumber(infillMatch[1]) : undefined;

  return {
    gramas,
    minutos,
    pesoSuporteG,
    pesoPurgaG,
    pecasPorPlaca,
    filamentoTipo,
    alturaCamadaMm,
    infillPct,
    texto,
  };
}

/**
 * Pré-processa imagem via canvas: converte pra grayscale, aumenta contraste
 * e inverte se o fundo médio for escuro. Retorna um File PNG "limpo".
 */
export async function preprocessImage(file: File): Promise<File> {
  if (typeof window === "undefined") return file;
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = rej;
    el.src = URL.createObjectURL(file);
  });
  const targetW = Math.max(img.naturalWidth, 1400);
  const scale = targetW / img.naturalWidth;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return file;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  let soma = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    soma += g;
  }
  const media = soma / (px.length / 4);
  const inverter = media < 128;

  const contraste = 1.4;
  const centro = 128;
  for (let i = 0; i < px.length; i += 4) {
    let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    g = (g - centro) * contraste + centro;
    if (inverter) g = 255 - g;
    g = Math.max(0, Math.min(255, g));
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);

  const blob: Blob = await new Promise((res) =>
    canvas.toBlob((b) => res(b as Blob), "image/png", 0.95),
  );
  return new File([blob], "slicer-ocr.png", { type: "image/png" });
}

/** Executa OCR completo: pré-processa → Tesseract → parseia texto. */
export async function runSlicerOcr(file: File): Promise<OcrResult> {
  const Tesseract = (await import("tesseract.js")).default;
  const clean = await preprocessImage(file);
  const { data } = await Tesseract.recognize(clean, "por+eng");
  return parseSlicerText(data.text ?? "");
}

/** Formata minutos em "Xh Ym". */
export function formatMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Faz parse de string livre de tempo em minutos totais.
 * Aceita: "2h 3m", "2:03", "2:03:45", "123min", "1,5h", "90m", "2h", "90".
 * Retorna undefined se não conseguir extrair nada.
 */
export function parseTempoLivre(input: string): number | undefined {
  const s = input.trim().toLowerCase();
  if (!s) return undefined;

  // HH:MM[:SS]
  const hms = s.match(/^(\d{1,3}):(\d{2})(?::\d{2})?$/);
  if (hms) return parseInt(hms[1], 10) * 60 + parseInt(hms[2], 10);

  // "Xh Ym" | "Xh" | "Ym"
  const hMatch = s.match(/(\d+[.,]?\d*)\s*h/);
  const mMatch = s.match(/(\d+)\s*(?:min|m)\b/);
  if (hMatch || mMatch) {
    const h = hMatch ? toNumber(hMatch[1]) : 0;
    const m = mMatch ? parseInt(mMatch[1], 10) : 0;
    return Math.round(h * 60 + m);
  }

  // só número → assume minutos
  const num = s.match(/^(\d+[.,]?\d*)$/);
  if (num) return Math.round(toNumber(num[1]));

  return undefined;
}
