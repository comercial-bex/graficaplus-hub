/**
 * OCR do print do fatiador (Bambu Studio, Orca, Cura, PrusaSlicer).
 * - Pré-processa a imagem (grayscale + contraste + inversão se fundo escuro)
 *   antes de rodar o Tesseract, o que aumenta muito o acerto em prints do
 *   Bambu Studio (tema dark).
 * - Extrai peso (g) e tempo (horas/minutos) do texto lido.
 */

export type OcrResult = {
  gramas?: number;
  horas?: number;
  minutos?: number;
  texto: string;
};

/** Extrai gramas e tempo do texto bruto do OCR. */
export function parseSlicerText(texto: string): OcrResult {
  const t = texto.replace(/\u00a0/g, " ");

  // gramas — pega o maior "NN,NN g" (linha do total do modelo)
  const gramas = [...t.matchAll(/(\d+[.,]?\d*)\s*g\b/gi)]
    .map((m) => parseFloat(m[1].replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000)
    .sort((a, b) => b - a)[0];

  // tempo — várias formas: "2h 3m", "2:03:45", "total: 2h 3m", "estimated time 2h 3m"
  let horas: number | undefined;
  let minutos: number | undefined;

  // 1) HH:MM:SS ou HH:MM
  const hms = t.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (hms) {
    horas = parseInt(hms[1], 10);
    minutos = parseInt(hms[2], 10);
  }
  // 2) "Xh Ym" — prioriza linhas com "total" ou "estimated"
  const totalMatch =
    t.match(/(?:total|estimated|estimativa|tempo)[^\d]{0,30}(\d+)\s*h\s*(\d+)\s*m/i) ||
    [...t.matchAll(/(\d+)\s*h\s*(\d+)\s*m/gi)].at(-1);
  if (totalMatch) {
    horas = parseInt(totalMatch[1], 10);
    minutos = parseInt(totalMatch[2], 10);
  }
  // 3) só "Xh"
  if (horas === undefined) {
    const soHoras = t.match(/\b(\d+)\s*h\b/i);
    if (soHoras) horas = parseInt(soHoras[1], 10);
  }
  // 4) só "Xmin" / "Xm"
  if (minutos === undefined) {
    const soMin = t.match(/\b(\d+)\s*min\b/i);
    if (soMin) minutos = parseInt(soMin[1], 10);
  }

  return { gramas, horas, minutos, texto };
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
  // upscale pequenos prints (Tesseract prefere >= 300dpi ≈ >= 1000px)
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

  // média para decidir inversão
  let soma = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    soma += g;
  }
  const media = soma / (px.length / 4);
  const inverter = media < 128;

  // grayscale + contraste + inversão condicional
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
