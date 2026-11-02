/**
 * Famílias dentro de um tipo, na escolha do produto (01/11/2026).
 *
 * O Holdprint tem categoria, família e produto em três passos. Aqui a família
 * (`produtos.familia`, 17 no catálogo) entra como FILTRO acima dos produtos do
 * tipo, e só quando ajuda: tipo com 2 ou mais famílias e mais de 6 produtos.
 * Em "Adesivo e recorte" (18 produtos em 5 famílias) ela corta a grade pela
 * metade; em "Placa e acrílico" (7 em 2) não vale o toque a mais.
 */

export const MINIMO_DE_PRODUTOS_PARA_FILTRAR = 7;
export const MINIMO_DE_FAMILIAS_PARA_FILTRAR = 2;

export type FamiliaNaEscolha = { familia: string; quantidade: number };

type ComFamilia = { familia?: string | null };

const nomeDaFamilia = (p: ComFamilia) => (p.familia ?? "").trim();

/** As famílias do grupo, da maior para a menor; produto sem família não vira chip. */
export function familiasDoGrupo<P extends ComFamilia>(produtos: readonly P[]): FamiliaNaEscolha[] {
  const contagem = new Map<string, number>();
  for (const p of produtos) {
    const f = nomeDaFamilia(p);
    if (f) contagem.set(f, (contagem.get(f) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([familia, quantidade]) => ({ familia, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.familia.localeCompare(b.familia, "pt-BR"));
}

export function mostrarFiltroDeFamilia<P extends ComFamilia>(produtos: readonly P[]): boolean {
  return (
    produtos.length >= MINIMO_DE_PRODUTOS_PARA_FILTRAR &&
    familiasDoGrupo(produtos).length >= MINIMO_DE_FAMILIAS_PARA_FILTRAR
  );
}

/** `null` = todas. Família marcada que não existe mais no grupo devolve a lista inteira. */
export function filtrarPorFamilia<P extends ComFamilia>(produtos: readonly P[], familia: string | null): P[] {
  if (!familia) return [...produtos];
  const lista = produtos.filter((p) => nomeDaFamilia(p) === familia);
  return lista.length > 0 ? lista : [...produtos];
}
