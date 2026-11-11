import { useUnidadeDeMedida } from "@/components/orcamento/campo-de-medida";
import { linhaDoLote } from "@/domain/encaixe/linha-do-lote";

/**
 * A linha viva sob a quantidade do item (10/11/2026): "40 peças de 4 × 4 cm = 0,064 m²", e, quando o mínimo do
 * produto muda a conta, "Cobrado: 4,00 m², porque o mínimo do produto é 0,10 m² por peça."
 *
 * Responde, no instante em que a quantidade é digitada, quantos metros quadrados dá o lote, sem abrir simulador. Não
 * lê preço, custo nem estoque. A medida é escrita na unidade em que a pessoa digitou (mm, cm ou m) e acompanha a
 * troca de unidade feita nas medidas da peça. Letra de 16 px na cor do texto.
 */
export function LinhaDoLote({
  largura,
  altura,
  quantidade,
  unidade,
  areaMinima,
}: {
  /** metros */
  largura: number | null | undefined;
  /** metros */
  altura: number | null | undefined;
  quantidade: number | null | undefined;
  /** A unidade de venda do item, não a de digitação. */
  unidade: string | null | undefined;
  areaMinima: number | null | undefined;
}) {
  const [unidadeDeMedida] = useUnidadeDeMedida();
  const linha = linhaDoLote({ largura, altura, quantidade, unidade, areaMinima, unidadeDeMedida });
  if (!linha) return null;
  return (
    <div className="space-y-1" role="status" data-testid="linha-do-lote">
      <p className="text-base font-medium tabular-nums text-foreground">{linha.texto}</p>
      {linha.cobrado && (
        <p className="text-base text-foreground" data-testid="linha-do-lote-cobrado">
          {linha.cobrado}
        </p>
      )}
    </div>
  );
}
