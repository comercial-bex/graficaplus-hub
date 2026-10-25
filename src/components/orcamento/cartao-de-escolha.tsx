import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cartão de escolha: a opção como uma caixa grande de tocar, com o escolhido marcado em verde
 * (jeito das lojas de gráfica: tamanho, material, acabamento). É um botão `aria-pressed`, então
 * serve para escolha única (a tela desmarca as outras) e para marcar várias.
 */
export function CartaoDeEscolha({
  ativo,
  titulo,
  detalhe,
  destaque,
  icone,
  desabilitado = false,
  onEscolher,
  testId,
  className,
}: {
  ativo: boolean;
  titulo: ReactNode;
  /** linha menor, abaixo do título: medidas, o que muda no preço */
  detalhe?: ReactNode;
  /** texto à direita do título, por exemplo "+ R$ 4,00" */
  destaque?: ReactNode;
  /** desenho ou ícone no alto do cartão */
  icone?: ReactNode;
  desabilitado?: boolean;
  onEscolher: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      disabled={desabilitado}
      onClick={onEscolher}
      data-testid={testId}
      className={cn(
        "relative flex min-h-20 w-full flex-col items-start justify-between gap-2 rounded-xl border-2 p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
        ativo
          ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
          : "border-border bg-card hover:border-emerald-600/50 hover:bg-muted",
        className,
      )}
    >
      {ativo && (
        <span
          className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white"
          aria-hidden="true"
        >
          <Check className="h-3 w-3" />
        </span>
      )}
      {icone && <span className="flex h-12 w-full items-center justify-center">{icone}</span>}
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className="text-sm font-semibold leading-tight">{titulo}</span>
        {destaque && <span className="text-xs tabular-nums text-muted-foreground">{destaque}</span>}
      </span>
      {detalhe && <span className="-mt-1 text-xs text-muted-foreground">{detalhe}</span>}
    </button>
  );
}

/** Grade de cartões: 2 colunas no celular, 3 a partir de sm, 4 a partir de lg. */
export function GradeDeCartoes({
  children,
  rotulo,
  className,
}: {
  children: ReactNode;
  rotulo: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4", className)}
    >
      {children}
    </div>
  );
}

/**
 * Desenho da peça na proporção da medida, para o cartão de tamanho: um retângulo que cresce
 * até caber numa caixa de 40 px. Sem medida, não desenha nada.
 */
export function PreviaDaPeca({
  largura,
  altura,
}: {
  largura: number | null | undefined;
  altura: number | null | undefined;
}) {
  const l = Number(largura);
  const a = Number(altura);
  if (!(l > 0) || !(a > 0)) return null;
  const maior = Math.max(l, a);
  const w = Math.max(8, Math.round((l / maior) * 40));
  const h = Math.max(8, Math.round((a / maior) * 40));
  return (
    <span
      aria-hidden="true"
      className="rounded-[3px] border border-sky-500/70 bg-sky-100 dark:bg-sky-950/40"
      style={{ width: w, height: h }}
    />
  );
}
