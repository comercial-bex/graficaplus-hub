/**
 * De onde veio o lead e o cliente. A pergunta "de onde veio esse cliente" é a que decide
 * onde gastar em divulgação, então a lista é uma só para o lead (tela de Leads) e para o
 * cliente (cadastro). O Holdprint chama de "Origem do cliente" e filtra a lista de contas
 * por ela; aqui o filtro da lista de clientes usa a mesma lista.
 *
 * O que já está gravado fora da lista (por exemplo `convite_parceiro`, que o sistema grava
 * sozinho) continua valendo e aparece como está: a lista é o que se oferece, não o que se aceita.
 */
export const ORIGENS: readonly string[] = [
  "Indicação",
  "Instagram",
  "Facebook",
  "Google",
  "WhatsApp",
  "Balcão",
  "Cliente antigo",
  "Outra",
];

/** A origem lida do banco, do jeito que vai para a tela: vazia vira "Não informada". */
export function rotuloDaOrigem(origem: string | null | undefined): string {
  const texto = (origem ?? "").trim();
  return texto || "Não informada";
}

/** A lista para oferecer num campo de origem: a de sempre, mais a que já está gravada se for de fora dela. */
export function origensParaOferecer(atual: string | null | undefined): string[] {
  const t = (atual ?? "").trim();
  return t && !ORIGENS.includes(t) ? [...ORIGENS, t] : [...ORIGENS];
}

export type Canal = "whatsapp" | "instagram" | "facebook" | "outros";

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Canal do lead para o quadro: ignora maiúsculas, acentos e espaços. O resto é "outros". */
export function canalDaOrigem(origem: string | null | undefined): Canal {
  const t = semAcento((origem ?? "").trim().toLowerCase());
  if (t === "whatsapp") return "whatsapp";
  if (t === "instagram") return "instagram";
  if (t === "facebook") return "facebook";
  return "outros";
}

/** Rótulo para o quadro "Por origem": WhatsApp/Instagram/Facebook unificados; o resto como está. */
export function origemAgrupada(origem: string | null | undefined): string {
  const canal = canalDaOrigem(origem);
  if (canal === "whatsapp") return "WhatsApp";
  if (canal === "instagram") return "Instagram";
  if (canal === "facebook") return "Facebook";
  return rotuloDaOrigem(origem);
}
