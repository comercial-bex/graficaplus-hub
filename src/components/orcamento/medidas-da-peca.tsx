import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { areaCobrada, areaTotal, areaUnitaria, temDimensoes } from "@/domain/orcamentos/area";
import type { TamanhoComum } from "@/domain/orcamentos/tipos-de-produto";

/**
 * As medidas da peça, desenhadas.
 *
 * Largura (X) e altura (Y) em metros, com a peça aparecendo na proporção
 * certa enquanto o vendedor digita — um banner deitado fica deitado, uma
 * faixa de rua fica comprida. Embaixo, a área da peça, a do lote e a que
 * entra na conta (com o mínimo do produto, quando houver). Os tamanhos
 * prontos vêm do produto; sem eles, os comuns do tipo.
 */

const metros = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = (v: number) => `${metros(v)} m²`;

const paraNumero = (texto: string) => {
  const n = Number(String(texto).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** O retângulo no desenho, em px do viewBox, mantendo a proporção da peça. */
function retangulo(largura: number, altura: number) {
  const CAIXA_L = 176;
  const CAIXA_A = 104;
  const MINIMO = 16;
  if (largura <= 0 || altura <= 0) return { w: CAIXA_L, h: CAIXA_A, vazio: true };
  // Proporção presa entre 1:6 e 6:1: faixa muito comprida ainda tem altura visível.
  const proporcao = Math.min(6, Math.max(1 / 6, largura / altura));
  let w = CAIXA_L;
  let h = CAIXA_L / proporcao;
  if (h > CAIXA_A) {
    h = CAIXA_A;
    w = CAIXA_A * proporcao;
  }
  return { w: Math.max(MINIMO, w), h: Math.max(MINIMO, h), vazio: false };
}

export function DesenhoDaPeca({
  largura,
  altura,
  className,
}: {
  largura: number;
  altura: number;
  className?: string;
}) {
  const { w, h, vazio } = retangulo(largura, altura);
  // Caixa de 176 × 104 ancorada em (36, 12); a peça fica centrada nela.
  const x = 36 + (176 - w) / 2;
  const y = 12 + (104 - h) / 2;
  const area = areaUnitaria({ largura, altura, quantidade: 1 });
  const cabeDentro = w >= 70 && h >= 28;

  return (
    <svg
      viewBox="0 0 270 160"
      role="img"
      aria-label={
        vazio
          ? "Desenho da peça: informe largura e altura"
          : `Peça de ${metros(largura)} m de largura por ${metros(altura)} m de altura, ${m2(area)}`
      }
      className={cn("h-auto w-full max-w-[320px] text-muted-foreground", className)}
    >
      {/* A peça */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        fill={vazio ? "transparent" : "color-mix(in oklab, var(--bex-cyan) 14%, transparent)"}
        stroke={vazio ? "currentColor" : "var(--bex-cyan)"}
        strokeWidth={vazio ? 1 : 1.5}
        strokeDasharray={vazio ? "5 4" : undefined}
      />
      {vazio ? (
        <text x={124} y={68} textAnchor="middle" fontSize="11" fill="currentColor">
          largura × altura
        </text>
      ) : cabeDentro ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 4}
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill="var(--foreground)"
        >
          {m2(area)}
        </text>
      ) : null}

      {/* Cota horizontal: Largura (X) */}
      <g stroke="currentColor" strokeWidth={1}>
        <line x1={x} y1={128} x2={x + w} y2={128} />
        <line x1={x} y1={123} x2={x} y2={133} />
        <line x1={x + w} y1={123} x2={x + w} y2={133} />
      </g>
      <text x={x + w / 2} y={146} textAnchor="middle" fontSize="11" fill="currentColor">
        Largura (X){vazio ? "" : ` ${metros(largura)} m`}
      </text>

      {/* Cota vertical: Altura (Y) */}
      <g stroke="currentColor" strokeWidth={1}>
        <line x1={224} y1={y} x2={224} y2={y + h} />
        <line x1={219} y1={y} x2={229} y2={y} />
        <line x1={219} y1={y + h} x2={229} y2={y + h} />
      </g>
      <text
        x={246}
        y={y + h / 2}
        textAnchor="middle"
        fontSize="11"
        fill="currentColor"
        transform={`rotate(-90 246 ${y + h / 2})`}
      >
        Altura (Y){vazio ? "" : ` ${metros(altura)} m`}
      </text>
    </svg>
  );
}

export function MedidasDaPeca({
  largura,
  altura,
  quantidade,
  areaMinima,
  tamanhos,
  origemDosTamanhos,
  onMudar,
  onAplicarTamanho,
  desabilitado = false,
}: {
  largura: string;
  altura: string;
  quantidade: number;
  /** Área mínima cobrada por peça, do cadastro do produto. */
  areaMinima: number | null;
  tamanhos: TamanhoComum[];
  origemDosTamanhos: "produto" | "tipo";
  onMudar: (campo: "largura" | "altura", valor: string) => void;
  onAplicarTamanho: (t: TamanhoComum) => void;
  desabilitado?: boolean;
}) {
  const dims = { largura: paraNumero(largura), altura: paraNumero(altura), quantidade };
  const temMedida = temDimensoes(dims);
  const daPeca = areaUnitaria(dims);
  const doLote = areaTotal(dims);
  const cobrada = areaCobrada(dims, areaMinima);
  const minimoAplicado = temMedida && cobrada > doLote + 0.0001;
  const qtd = quantidade > 0 ? quantidade : 1;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3" data-testid="medidas-da-peca">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium">Medidas da peça</h3>
        <DicaIcone texto={dicaCampo("/orcamentos", "medidas")} rotulo="Medidas" className="h-5 w-5" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
        <DesenhoDaPeca largura={dims.largura} altura={dims.altura} className="mx-auto" />

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="item-largura">Largura (X)</Label>
              <div className="relative">
                <Input
                  id="item-largura"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-11 pr-8 sm:h-9"
                  value={largura}
                  disabled={desabilitado}
                  onChange={(e) => onMudar("largura", e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  m
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="item-altura">Altura (Y)</Label>
              <div className="relative">
                <Input
                  id="item-altura"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-11 pr-8 sm:h-9"
                  value={altura}
                  disabled={desabilitado}
                  onChange={(e) => onMudar("altura", e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  m
                </span>
              </div>
            </div>
          </div>

          {/* A conta, viva: peça, lote e o que entra no preço. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Área da peça</dt>
            <dd className="tabular-nums">{temMedida ? m2(daPeca) : "—"}</dd>
            {qtd > 1 && (
              <>
                <dt className="text-muted-foreground">{qtd} peças</dt>
                <dd className="tabular-nums">{temMedida ? m2(doLote) : "—"}</dd>
              </>
            )}
            <dt className="flex items-center gap-1 text-muted-foreground">
              Área cobrada
              <DicaIcone texto={dicaCampo("/orcamentos", "area_cobrada")} rotulo="Área cobrada" className="h-5 w-5" />
            </dt>
            <dd className={cn("font-medium tabular-nums", minimoAplicado && "text-amber-600")}>
              {temMedida ? m2(cobrada) : "—"}
            </dd>
          </dl>

          {minimoAplicado && areaMinima != null && (
            <p className="flex items-start gap-1 text-xs text-amber-600">
              <span>
                Mínimo de {m2(areaMinima)} por peça aplicado: cobra {m2(cobrada)} em vez de {m2(doLote)}.
              </span>
              <DicaIcone texto={dicaCampo("/orcamentos", "area_minima")} rotulo="Área mínima" lado="left" className="h-5 w-5" />
            </p>
          )}
          {!minimoAplicado && areaMinima != null && areaMinima > 0 && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Área mínima deste produto: {m2(areaMinima)} por peça.
              <DicaIcone texto={dicaCampo("/orcamentos", "area_minima")} rotulo="Área mínima" className="h-5 w-5" />
            </p>
          )}
        </div>
      </div>

      {tamanhos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">
            {origemDosTamanhos === "produto" ? "Tamanhos deste produto:" : "Medidas comuns:"}
          </span>
          {tamanhos.map((t) => {
            const ativo = dims.largura === Number(t.largura) && dims.altura === Number(t.altura);
            return (
              <button
                key={`${t.nome}-${t.largura}x${t.altura}`}
                type="button"
                aria-pressed={ativo}
                disabled={desabilitado}
                onClick={() => onAplicarTamanho(t)}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium transition-colors sm:min-h-8",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ativo
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:border-primary/60",
                )}
              >
                {t.nome}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
