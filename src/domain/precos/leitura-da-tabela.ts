/**
 * Leitura da Tabela de preços: o que fazer quando uma das consultas de apoio falha ou ainda
 * está chegando. A tabela só depende de `produtos` para existir; as outras seis consultas
 * enriquecem a linha. Falha de consulta nunca pode parecer lista vazia, então cada uma que
 * falha vira um aviso próprio e a tabela segue útil com o que chegou.
 */

export type ChaveDeLeitura = "niveis" | "ofertas" | "concorrentes" | "maoDeObra" | "familias" | "composicoes" | "receitas";

export type EstadoDaConsulta = { isLoading: boolean; isError: boolean; error?: unknown };

/** O que o dono perde quando aquela consulta falha, dito em frase corrida. */
export const PERDA_POR_LEITURA: Record<ChaveDeLeitura, { rotulo: string; perda: string }> = {
  niveis: {
    rotulo: "Nível de entrada dos parceiros",
    perda: "o preço de parceiro calculado pelo nível não aparece nos produtos sem preço de parceiro próprio",
  },
  ofertas: {
    rotulo: "Promoções dos parceiros",
    perda: "as promoções em vigor não aparecem nos cartões",
  },
  concorrentes: {
    rotulo: "Concorrentes anotados",
    perda: "a régua de mercado fica sem concorrentes e o contador Sem concorrente anotado não vale",
  },
  maoDeObra: {
    rotulo: "Mão de obra estimada",
    perda: "o aviso de mão de obra estimada pode estar faltando na ficha",
  },
  familias: {
    rotulo: "Famílias dos produtos",
    perda: "a família não aparece e a busca por família não encontra nada",
  },
  composicoes: {
    rotulo: "Composição do custo",
    perda: "o custo cheio e o selo da ficha técnica não valem",
  },
  receitas: {
    rotulo: "Receitas de matéria-prima",
    perda: "o custo cheio e o selo da ficha técnica não valem",
  },
};

export type AvisoDeLeitura = { chave: ChaveDeLeitura; rotulo: string; texto: string };

/** Um aviso por consulta que falhou, na ordem fixa das chaves. */
export function avisosDeLeitura(
  estados: Record<ChaveDeLeitura, EstadoDaConsulta>,
  mensagem: (erro: unknown) => string,
): AvisoDeLeitura[] {
  const ordem = Object.keys(PERDA_POR_LEITURA) as ChaveDeLeitura[];
  return ordem
    .filter((k) => estados[k].isError)
    .map((k) => ({
      chave: k,
      rotulo: PERDA_POR_LEITURA[k].rotulo,
      texto: `${PERDA_POR_LEITURA[k].rotulo} não carregou: ${PERDA_POR_LEITURA[k].perda}. ${mensagem(estados[k].error)}`,
    }));
}

export type EstadoDoContador = "pronto" | "carregando" | "indisponivel";

/** Contador (ou selo) que depende de várias consultas: falha vence carregamento só se nada mais está chegando. */
export function estadoDoContador(dependencias: EstadoDaConsulta[]): EstadoDoContador {
  if (dependencias.some((d) => d.isLoading)) return "carregando";
  if (dependencias.some((d) => d.isError)) return "indisponivel";
  return "pronto";
}

/** Reticências enquanto chega, traço quando a leitura falhou, o número só quando é confiável. */
export function textoDoContador(estado: EstadoDoContador, n: number): string {
  if (estado === "carregando") return "…";
  if (estado === "indisponivel") return "—";
  return String(n);
}
