import { createHash } from "node:crypto";

export type NormalizedSlicerData = { totalTimeSeconds?: number; totalWeightG?: number; plates: Array<{ name: string; timeSeconds?: number; weightG?: number }>; raw: Record<string, unknown>; found: string[]; missing: string[] };
export interface SlicerImportAdapter { readonly name: string; canParse(fileName: string, mime?: string): boolean; parse(buffer: Buffer, fileName: string, mime?: string): NormalizedSlicerData; }
const LIMITS = { fileBytes: 80 * 1024 * 1024, zipEntries: 200, internalBytes: 25 * 1024 * 1024, inflatedBytes: 120 * 1024 * 1024 };
export function sha256(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function assertSafe(buffer: Buffer, fileName: string, mime?: string) {
  const lower = fileName.toLowerCase();
  if (buffer.byteLength > LIMITS.fileBytes) throw new Error("Arquivo do slicer excede o limite permitido");
  if (!/\.(3mf|gcode|gcode\.3mf)$/.test(lower)) throw new Error("Extensão de slicer inválida");
  if (mime && !["model/3mf", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml", "application/gcode", "text/plain", "application/octet-stream", "application/zip"].includes(mime)) throw new Error("MIME de slicer inválido");
}
function parseDurationToSeconds(text: string) { const h = /([0-9]+)\s*h/i.exec(text)?.[1]; const m = /([0-9]+)\s*m/i.exec(text)?.[1]; const s = /([0-9]+)\s*s/i.exec(text)?.[1]; return (Number(h ?? 0) * 3600) + (Number(m ?? 0) * 60) + Number(s ?? 0); }
export class GenericGCodeParser implements SlicerImportAdapter {
  readonly name = "GenericGCodeParser";
  canParse(fileName: string) { return fileName.toLowerCase().endsWith(".gcode"); }
  parse(buffer: Buffer, fileName: string, mime?: string): NormalizedSlicerData {
    assertSafe(buffer, fileName, mime);
    const text = buffer.toString("utf8", 0, Math.min(buffer.byteLength, LIMITS.internalBytes));
    const time = /(?:estimated printing time|total estimated time|TIME):?\s*([^\n;]+)/i.exec(text)?.[1];
    const grams = /(?:filament used \[g\]|filament used|total filament):?\s*([0-9]+(?:[\.,][0-9]+)?)/i.exec(text)?.[1];
    const normalized = { totalTimeSeconds: time ? parseDurationToSeconds(time) : undefined, totalWeightG: grams ? Number(grams.replace(",", ".")) : undefined, plates: [{ name: "plate-1", timeSeconds: time ? parseDurationToSeconds(time) : undefined, weightG: grams ? Number(grams.replace(",", ".")) : undefined }], raw: { preview: text.slice(0, 5000) }, found: [] as string[], missing: [] as string[] };
    for (const key of ["totalTimeSeconds", "totalWeightG"] as const) (normalized[key] ? normalized.found : normalized.missing).push(key);
    return normalized;
  }
}
export class BambuStudioParser extends GenericGCodeParser {
  readonly name = "BambuStudioParser";
  canParse(fileName: string) { return /\.(3mf|gcode\.3mf)$/i.test(fileName); }
  parse(buffer: Buffer, fileName: string, mime?: string): NormalizedSlicerData {
    assertSafe(buffer, fileName, mime);
    // 3MF é ZIP. O Node não expõe leitor ZIP completo sem dependência; registramos proteção e tentamos G-code embutido quando o payload já vier como texto exportado.
    if (buffer.byteLength > LIMITS.inflatedBytes) throw new Error("Contêiner 3MF excede limite de expansão");
    const text = buffer.toString("utf8");
    if (text.includes(";FLAVOR") || text.includes("BambuStudio")) return super.parse(buffer, fileName, mime);
    return { plates: [], raw: { sha256: sha256(buffer), note: "3MF recebido como contêiner privado; metadados devem ser normalizados no backend com leitor ZIP seguro." }, found: ["sha256"], missing: ["totalTimeSeconds", "totalWeightG", "plates"] };
  }
}
export function parseSlicerImport(buffer: Buffer, fileName: string, mime?: string) { const adapters = [new BambuStudioParser(), new GenericGCodeParser()]; const adapter = adapters.find((a) => a.canParse(fileName, mime)); if (!adapter) throw new Error("Nenhum parser disponível"); return { parser: adapter.name, sha256: sha256(buffer), data: adapter.parse(buffer, fileName, mime) }; }
