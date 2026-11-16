import { cn } from "@/lib/utils";
import {
  mapaDeMargem,
  mesmaCelula,
  resumoDoMapa,
  ROTULO_DA_COLUNA_DO_MAPA,
  ROTULO_DA_LINHA_DO_MAPA,
  type CelulaDoMapa,
  type CustoRealDoProduto,
} from "@/domain/precos/custo-real";

type LinhaDoMapa = {
  real?: CustoRealDoProduto | null;
  margem_minima: number | null;
  preco: number | null;
};

/** Texto da célula, com a cor só de reforço: o grau vem sempre escrito. */
const COR_DA_LINHA = [
  "border-[#b42318] dark:border-[#ff8a80]",
  "border-[#8a5a00] dark:border-[#f5b942]",
  "border-[#146c43] dark:border-[#45d4a0]",
] as const;

/** Mostra de cima para baixo a margem boa, a justa e a abaixo do mínimo. */
const ORDEM_DAS_LINHAS = [2, 1, 0] as const;

/**
 * Grade de margem líquida contra vezes o custo. Cada célula é um botão de 44 px ou mais, mostra a contagem e filtra
 * a lista ao tocar. A célula de margem boa e três vezes o custo ou mais é a meta do dono.
 */
export function MapaDeMargem({
  linhas,
  celula,
  aoEscolher,
}: {
  linhas: LinhaDoMapa[];
  celula: CelulaDoMapa | null;
  aoEscolher: (c: CelulaDoMapa | null) => void;
}) {
  const mapa = mapaDeMargem(linhas);
  return (
    <section
      className="space-y-3 text-base"
      aria-label="Mapa de margem"
      data-testid="mapa-de-margem"
    >
      <p data-testid="resumo-do-mapa">{resumoDoMapa(mapa)}</p>
      <div className="space-y-2">
        <div className="hidden grid-cols-[8rem_repeat(3,minmax(0,1fr))] gap-2 sm:grid" aria-hidden>
          <span />
          {ROTULO_DA_COLUNA_DO_MAPA.map((c) => (
            <span key={c} className="font-semibold">
              {c}
            </span>
          ))}
        </div>
        {ORDEM_DAS_LINHAS.map((m) => (
          <div
            key={m}
            role="group"
            aria-label={ROTULO_DA_LINHA_DO_MAPA[m]}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_repeat(3,minmax(0,1fr))]"
          >
            <span className="font-semibold sm:self-center">{ROTULO_DA_LINHA_DO_MAPA[m]}</span>
            {([0, 1, 2] as const).map((v) => {
              const c: CelulaDoMapa = { margem: m, vezes: v };
              const n = mapa.celulas[m][v];
              const ativa = mesmaCelula(celula, c);
              const meta = m === 2 && v === 2;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={ativa}
                  aria-label={`${ROTULO_DA_LINHA_DO_MAPA[m]}, ${ROTULO_DA_COLUNA_DO_MAPA[v]}: ${n} ${n === 1 ? "produto" : "produtos"}${meta ? ", a meta" : ""}`}
                  onClick={() => aoEscolher(ativa ? null : c)}
                  data-testid={`celula-${m}-${v}`}
                  className={cn(
                    "min-h-16 rounded-xl border-2 bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    COR_DA_LINHA[m],
                    ativa && "ring-2 ring-primary",
                  )}
                >
                  <span className="block text-3xl font-bold">{n}</span>
                  <span className="block text-base sm:sr-only">{ROTULO_DA_COLUNA_DO_MAPA[v]}</span>
                  <span className="block text-base">
                    {n === 1 ? "produto" : "produtos"}
                    {meta ? ", a meta" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {mapa.semDados > 0 ? (
        <p data-testid="mapa-sem-dados">
          {mapa.semDados === 1
            ? "1 produto não entra na grade por falta de custo real ou de margem mínima."
            : `${mapa.semDados} produtos não entram na grade por falta de custo real ou de margem mínima.`}
        </p>
      ) : null}
    </section>
  );
}
