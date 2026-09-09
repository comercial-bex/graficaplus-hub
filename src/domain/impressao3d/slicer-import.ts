import { createHash } from "node:crypto";
import { lerEntradasZip } from "./zip-leitura";

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
/**
 * "3h 42m 15s" -> 13335. E "3600", sem letra nenhuma, -> 3600.
 *
 * O Cura escreve `;TIME:3600` em segundos puros. A versão anterior procurava
 * h/m/s, não achava nenhum e devolvia ZERO — e tempo zero faz o custo de
 * máquina e de energia saírem zerados, vendendo a peça abaixo do custo.
 */
export function parseDurationToSeconds(text: string) {
  const h = /([0-9]+)\s*h/i.exec(text)?.[1];
  const m = /([0-9]+)\s*m(?!s)/i.exec(text)?.[1];
  const s = /([0-9]+)\s*s/i.exec(text)?.[1];
  if (h === undefined && m === undefined && s === undefined) {
    const puro = /([0-9]+(?:\.[0-9]+)?)/.exec(text)?.[1];
    return puro ? Math.round(Number(puro)) : 0;
  }
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

/**
 * Separador `=` OU `:`. Os fatiadores de verdade escrevem
 * `; total filament used [g] = 42.5`; só o formato com dois-pontos era aceito,
 * então o peso vinha `undefined` do arquivo mais comum.
 */
export const RE_TEMPO = /(?:estimated printing time|total estimated time|\bTIME\b)[^\n=:]*[:=]\s*([^\n;]+)/i;
/**
 * Gramas só quando a UNIDADE é grama.
 *
 * O Cura escreve `;Filament used: 12.5m` — doze metros e meio de filamento. Ler
 * isso como 12,5 g subestima o material em cerca de três vezes (12,5 m de PLA
 * 1,75 mm pesam ~37 g), e a peça sai orçada com um terço do filamento que
 * gasta. Por isso a unidade é obrigatória: `[g]` na chave ou `g` no valor.
 */
const RE_GRAMAS_CHAVE = /(?:total\s+)?filament\s+used\s*\[g\]\s*[:=]\s*([0-9]+(?:[.,][0-9]+)?)/i;
const RE_GRAMAS_VALOR = /(?:total\s+)?filament\s+used\s*[:=]\s*([0-9]+(?:[.,][0-9]+)?)\s*g\b/i;

export function lerGramas(texto: string): number | undefined {
  const bruto = RE_GRAMAS_CHAVE.exec(texto)?.[1] ?? RE_GRAMAS_VALOR.exec(texto)?.[1];
  if (bruto === undefined) return undefined;
  const valor = Number(bruto.replace(",", "."));
  return Number.isFinite(valor) && valor > 0 ? valor : undefined;
}
export class GenericGCodeParser implements SlicerImportAdapter {
  readonly name: string = "GenericGCodeParser";
  canParse(fileName: string, _mime?: string) { return fileName.toLowerCase().endsWith(".gcode"); }
  parse(buffer: Buffer, fileName: string, mime?: string): NormalizedSlicerData {
    assertSafe(buffer, fileName, mime);
    const text = buffer.toString("utf8", 0, Math.min(buffer.byteLength, LIMITS.internalBytes));
    const time = RE_TEMPO.exec(text)?.[1];
    const gramsNum = lerGramas(text);
    const segundos = time ? parseDurationToSeconds(time) : undefined;
    const normalized = { totalTimeSeconds: segundos && segundos > 0 ? segundos : undefined, totalWeightG: gramsNum, plates: [{ name: "plate-1", timeSeconds: segundos && segundos > 0 ? segundos : undefined, weightG: gramsNum }], raw: { preview: text.slice(0, 5000) }, found: [] as string[], missing: [] as string[] };
    for (const key of ["totalTimeSeconds", "totalWeightG"] as const) (normalized[key] ? normalized.found : normalized.missing).push(key);
    return normalized;
  }
}
/** `<metadata key="weight" value="128.47"/>` → 128.47 */
function metadadoDoPlate(xml: string, chave: string): string | undefined {
  const re = new RegExp(`key="${chave}"\\s+value="([^"]*)"`, "i");
  return re.exec(xml)?.[1] ?? new RegExp(`value="([^"]*)"\\s+key="${chave}"`, "i").exec(xml)?.[1];
}

export class BambuStudioParser extends GenericGCodeParser {
  readonly name = "BambuStudioParser";
  canParse(fileName: string) { return /\.(3mf|gcode\.3mf)$/i.test(fileName); }

  /**
   * 3MF é ZIP. A versão anterior fazia `buffer.toString("utf8")` e procurava
   * ";FLAVOR" como texto — em conteúdo deflate-comprimido isso nunca aparece,
   * então TODO 3MF real caía no caminho de erro e devolvia peso e tempo
   * indefinidos, sem avisar. Como é a exportação nativa da Bambu Lab, na
   * prática o importador não funcionava para o arquivo mais comum.
   *
   * Agora lê o ZIP de verdade. A fonte preferida é `Metadata/slice_info.config`,
   * que traz tempo e peso POR PLACA — é o dado que o orçamento precisa, porque
   * cada placa é uma impressão com seu próprio consumo. Os comentários do
   * G-code entram como reserva quando o slice_info não vier.
   */
  parse(buffer: Buffer, fileName: string, mime?: string): NormalizedSlicerData {
    assertSafe(buffer, fileName, mime);
    if (buffer.byteLength > LIMITS.inflatedBytes) throw new Error("Contêiner 3MF excede limite de expansão");

    // G-code exportado direto (não empacotado) continua atendido pelo genérico.
    if (buffer.byteLength >= 4 && buffer.toString("latin1", 0, 2) !== "PK") {
      return super.parse(buffer, fileName, mime);
    }

    const entradas = lerEntradasZip(buffer, {
      maxEntradas: LIMITS.zipEntries,
      maxBytesPorEntrada: LIMITS.internalBytes,
      maxBytesTotais: LIMITS.inflatedBytes,
    });

    const plates: NormalizedSlicerData["plates"] = [];
    const raw: Record<string, unknown> = { sha256: sha256(buffer), entradas: entradas.length };

    const infoEntrada = entradas.find((e) => /slice_info\.config$/i.test(e.nome));
    if (infoEntrada) {
      const xml = infoEntrada.ler().toString("utf8");
      raw.slice_info = xml.slice(0, 5000);
      // Um bloco <plate> por placa; cada um com prediction (segundos) e weight (g).
      const blocos = xml.match(/<plate\b[\s\S]*?<\/plate>/gi) ?? [];
      blocos.forEach((bloco, i) => {
        const indice = metadadoDoPlate(bloco, "index") ?? String(i + 1);
        const segundos = Number(metadadoDoPlate(bloco, "prediction") ?? NaN);
        const gramas = Number(metadadoDoPlate(bloco, "weight") ?? NaN);
        plates.push({
          name: `plate-${indice}`,
          timeSeconds: Number.isFinite(segundos) && segundos > 0 ? segundos : undefined,
          weightG: Number.isFinite(gramas) && gramas > 0 ? gramas : undefined,
        });
      });
    }

    // Sem slice_info utilizável, tenta os comentários do G-code de cada placa.
    if (plates.every((p) => p.timeSeconds === undefined && p.weightG === undefined)) {
      plates.length = 0;
      const gcodes = entradas.filter((e) => /\.gcode$/i.test(e.nome)).slice(0, 32);
      for (const entrada of gcodes) {
        const texto = entrada.ler().toString("utf8");
        const t = RE_TEMPO.exec(texto)?.[1];
        const g = lerGramas(texto);
        const segundos = t ? parseDurationToSeconds(t) : undefined;
        plates.push({
          name: entrada.nome.replace(/^.*\//, "").replace(/\.gcode$/i, ""),
          timeSeconds: segundos && segundos > 0 ? segundos : undefined,
          weightG: g,
        });
      }
    }

    const somar = (campo: "timeSeconds" | "weightG") => {
      const valores = plates.map((p) => p[campo]).filter((v): v is number => typeof v === "number");
      return valores.length > 0 ? valores.reduce((a, b) => a + b, 0) : undefined;
    };

    const normalized: NormalizedSlicerData = {
      totalTimeSeconds: somar("timeSeconds"),
      totalWeightG: somar("weightG"),
      plates,
      raw,
      found: [],
      missing: [],
    };
    for (const key of ["totalTimeSeconds", "totalWeightG"] as const) {
      (normalized[key] ? normalized.found : normalized.missing).push(key);
    }
    (plates.length > 0 ? normalized.found : normalized.missing).push("plates");
    return normalized;
  }
}
export function parseSlicerImport(buffer: Buffer, fileName: string, mime?: string) { const adapters = [new BambuStudioParser(), new GenericGCodeParser()]; const adapter = adapters.find((a) => a.canParse(fileName, mime)); if (!adapter) throw new Error("Nenhum parser disponível"); return { parser: adapter.name, sha256: sha256(buffer), data: adapter.parse(buffer, fileName, mime) }; }
