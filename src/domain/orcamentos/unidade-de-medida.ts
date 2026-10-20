/**
 * A unidade em que a pessoa digita a medida (mm, cm ou m).
 *
 * O sistema guarda largura e altura SEMPRE em metros (ver `area.ts`). Até
 * 20/10/2026 a tela só aceitava metros: quem orça acrílico de 27 × 26 cm tinha de
 * converter de cabeça para 0,27 × 0,26 — e digitar "80" querendo dizer 80 cm virava
 * 80 METROS, sem nenhum aviso (a área saía 4.000 m²). Agora a pessoa escolhe a
 * unidade, digita como o cliente falou, e o sistema converte e mostra a conta.
 *
 * Só a DIGITAÇÃO muda de unidade. O que vai para o banco, para a área e para o PDF
 * continua em metros, com a precisão de 1 mm (3 casas).
 */

export type UnidadeDeMedida = "mm" | "cm" | "m";

export const UNIDADES_DE_MEDIDA: readonly UnidadeDeMedida[] = ["mm", "cm", "m"];

/** Quantos dessa unidade cabem em 1 metro. */
const POR_METRO: Record<UnidadeDeMedida, number> = { mm: 1000, cm: 100, m: 1 };

export const ROTULO_DA_UNIDADE: Record<UnidadeDeMedida, string> = {
  mm: "milímetros",
  cm: "centímetros",
  m: "metros",
};

/** O passo do campo: de 1 em 1 mm, de 0,5 em 0,5 cm, de 1 em 1 cm. */
export const PASSO_DA_UNIDADE: Record<UnidadeDeMedida, string> = { mm: "1", cm: "0.5", m: "0.01" };

export function ehUnidadeDeMedida(valor: unknown): valor is UnidadeDeMedida {
  return valor === "mm" || valor === "cm" || valor === "m";
}

/** "80", "80,5" e "80.5" viram número; vazio e lixo viram null. */
export function lerNumero(texto: string | null | undefined): number | null {
  const limpo = String(texto ?? "").trim().replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

const arredondar = (valor: number, casas: number) => {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
};

/**
 * O que a pessoa digitou, em METROS, com a precisão de 1 mm. Vazio ou inválido
 * vira null; negativo também (medida não é negativa).
 */
export function paraMetros(texto: string | null | undefined, unidade: UnidadeDeMedida): number | null {
  const n = lerNumero(texto);
  if (n === null || n < 0) return null;
  return arredondar(n / POR_METRO[unidade], 3);
}

/**
 * Os metros guardados, escritos na unidade escolhida, sem zeros sobrando:
 * 0,8 m → "80" (cm), "800" (mm) ou "0.8" (m). Sem número, texto vazio. Ponto
 * decimal, porque é o que o campo numérico do navegador entende.
 */
export function deMetros(metros: number | string | null | undefined, unidade: UnidadeDeMedida): string {
  const n = typeof metros === "string" ? lerNumero(metros) : (metros ?? null);
  if (n === null || !Number.isFinite(n) || n <= 0) return "";
  // Casas que a unidade precisa para não perder o milímetro: mm 0, cm 1, m 3.
  const casas = unidade === "mm" ? 0 : unidade === "cm" ? 1 : 3;
  return String(arredondar(n * POR_METRO[unidade], casas));
}

/** "80 cm", "1,5 m", "27 mm": a medida como se fala, com a vírgula do Brasil. */
export function medidaLegivel(metros: number, unidade: UnidadeDeMedida): string {
  const texto = deMetros(metros, unidade);
  return `${texto === "" ? "0" : texto.replace(".", ",")} ${unidade}`;
}

/** Acima disto, uma medida em metros quase sempre é cm digitado no campo de m. */
export const MAXIMO_PLAUSIVEL_M = 20;
/** Abaixo disto, quase sempre é m digitado no campo de cm ou de mm. */
export const MINIMO_PLAUSIVEL_M = 0.01;

/**
 * Aviso de unidade trocada — o erro que mais custa: "80" no campo de metros é
 * uma peça de 80 m. Só avisa, nunca barra: faixa de 25 m existe, e adesivo de 8 mm
 * também.
 */
export function avisoDeMedidaSuspeita(
  rotulo: string,
  metros: number | null,
  unidade: UnidadeDeMedida,
): string | null {
  if (metros === null || metros <= 0) return null;
  if (metros > MAXIMO_PLAUSIVEL_M) {
    return `${rotulo} de ${medidaLegivel(metros, unidade)}? Isso é mais de ${MAXIMO_PLAUSIVEL_M} metros. Confira a unidade (mm, cm ou m).`;
  }
  if (metros < MINIMO_PLAUSIVEL_M) {
    return `${rotulo} de ${medidaLegivel(metros, unidade)}? Isso é menos de 1 cm. Confira a unidade (mm, cm ou m).`;
  }
  return null;
}

/** Onde a escolha fica lembrada neste aparelho (só a unidade, nunca medida). */
export const CHAVE_DA_UNIDADE = "bex:unidade-de-medida";

/** A unidade lembrada; sem lembrança (ou armazenamento bloqueado), metros — como era. */
export function lerUnidadeLembrada(armazenamento: Pick<Storage, "getItem"> | null | undefined): UnidadeDeMedida {
  try {
    const guardada = armazenamento?.getItem(CHAVE_DA_UNIDADE);
    return ehUnidadeDeMedida(guardada) ? guardada : "m";
  } catch {
    return "m";
  }
}

export function lembrarUnidade(
  armazenamento: Pick<Storage, "setItem"> | null | undefined,
  unidade: UnidadeDeMedida,
): void {
  try {
    armazenamento?.setItem(CHAVE_DA_UNIDADE, unidade);
  } catch {
    // Modo privado ou site bloqueado: a escolha vale só nesta tela, e a tela funciona.
  }
}

/**
 * O texto que o campo mostra, dado o que a pessoa digitou e o que vem de fora.
 *
 * Mantém o texto enquanto ele ainda diz o mesmo valor que está guardado: reescrever
 * a cada tecla a partir dos metros comeria a vírgula de "80," antes do "5" de
 * "80,5". Refaz o texto quando o valor de fora deixa de ser o que ele diz (tamanho
 * pronto aplicado, item aberto para editar, formulário limpo) e SEMPRE quando a
 * unidade troca — trocar de cm para m mantém a peça e muda como ela é escrita.
 */
export function textoDoCampo(args: {
  texto: string;
  /** O valor guardado, em metros ("" quando vazio). */
  metrosDeFora: string;
  unidade: UnidadeDeMedida;
  trocouDeUnidade: boolean;
}): string {
  const deFora = paraMetros(args.metrosDeFora, "m");
  if (args.trocouDeUnidade || paraMetros(args.texto, args.unidade) !== deFora) {
    return deMetros(deFora, args.unidade);
  }
  return args.texto;
}
