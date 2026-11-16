import { pisoDaMargem } from "./tabela-de-precos";
import { formatBRL } from "@/lib/produtos-catalogo";

type Situacao = "ok" | "alerta" | "ruim" | "vazio";

/** Complemento da margem na tela, sem parênteses: ", abaixo do mínimo" ou ", perto do mínimo". */
export function complementoDaMargem(situacao: Situacao): string {
  if (situacao === "ruim") return ", abaixo do mínimo";
  if (situacao === "alerta") return ", perto do mínimo";
  return "";
}

/** Frase do piso de preço, ou null quando não há custo ou margem mínima para calcular. */
export function fraseDoPiso(custo: number | null, margemMinima: number | null): string | null {
  const piso = pisoDaMargem(custo, margemMinima);
  if (piso == null) return null;
  return `${formatBRL(piso)}, o menor preço que cumpre a margem mínima de ${String(Number(margemMinima)).replace(".", ",")}%`;
}

/** Aviso de margem do diálogo de produto, sem parênteses. */
export function avisoDeMargem(situacao: Situacao, minima: number): string | null {
  if (situacao === "ruim") return `Margem abaixo do mínimo de ${minima}%. Reveja o preço ou o custo.`;
  if (situacao === "alerta") return `Margem perto do mínimo de ${minima}%.`;
  return null;
}
