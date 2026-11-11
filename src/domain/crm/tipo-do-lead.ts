export type TipoDoLead = "parceiro" | "cliente";

/** Frase do anúncio de parceiros; específica para "meu parceiro indicou" não marcar parceiro. */
export function textoDeParceiro(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("quero ser parceir");
}

export function tipoDoLead({ anuncioId, anunciosDeParceiro = [], telefoneEhDeParceiro = false, textoInicial, tipoGravado }: {
  anuncioId?: string | null;
  textoInicial?: string | null;
  anunciosDeParceiro?: readonly string[];
  telefoneEhDeParceiro?: boolean;
  tipoGravado?: unknown;
}): TipoDoLead {
  if (tipoGravado === "parceiro" || tipoGravado === "cliente") return tipoGravado;
  return (anuncioId != null && anunciosDeParceiro.includes(anuncioId)) || telefoneEhDeParceiro || textoDeParceiro(textoInicial)
    ? "parceiro" : "cliente";
}

/** As telas usam apenas o tipo persistido; ausência nunca infere parceiro. */
export function ehLeadParceiro(tipo: unknown): boolean {
  return tipoDoLead({ tipoGravado: tipo }) === "parceiro";
}

export function filtrarParceiros<T extends { tipo?: unknown }>(leads: T[], somente: boolean): T[] {
  return somente ? leads.filter((l) => ehLeadParceiro(l.tipo)) : leads;
}

export function colunaTipoAusente(erro: { code?: string; message?: string } | null): boolean {
  return !!erro && ["42703", "PGRST204"].includes(erro.code ?? "") &&
    /\btipo\b/i.test(erro.message ?? "");
}