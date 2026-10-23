import { Check } from "lucide-react";
import { ETAPAS_QUADRO, ROTULO_ETAPA, etapaDe, rotuloDe, type Etapa } from "@/domain/os/etapas";
import { cn } from "@/lib/utils";

/**
 * Onde a OS está no caminho (23/10/2026): entrada → arte → fila → produção →
 * acabamento → saída. São as MESMAS seis etapas do quadro e, agrupadas, os
 * blocos da TV da oficina — quem olha o cartão, a ficha e a parede lê o mesmo
 * caminho.
 *
 * `compacta` (no cartão): seis barras finas e o nome da etapa atual.
 * Completa (na ficha): seis passos com nome, o atual marcado.
 * OS pausada ou cancelada não está em passo nenhum: a trilha diz isso em vez de
 * desenhar uma barra vazia.
 */
export function TrilhaDaOs({ status, compacta = false }: { status: string | null | undefined; compacta?: boolean }) {
  const etapa = etapaDe(status);
  const foraDoFluxo = etapa === "fora_do_fluxo" || !etapa;
  const atual = foraDoFluxo ? -1 : ETAPAS_QUADRO.indexOf(etapa as Exclude<Etapa, "fora_do_fluxo">);
  const detalhe = rotuloDe(status);
  const nomeAtual = atual >= 0 ? ROTULO_ETAPA[ETAPAS_QUADRO[atual]] : null;

  if (compacta) {
    return (
      <div className="space-y-1" role="img" aria-label={foraDoFluxo ? detalhe : `Etapa ${atual + 1} de ${ETAPAS_QUADRO.length}: ${nomeAtual}`}>
        <div className="flex gap-0.5" aria-hidden>
          {ETAPAS_QUADRO.map((e, i) => (
            <span
              key={e}
              className={cn(
                "h-1 flex-1 rounded-full",
                foraDoFluxo
                  ? "bg-muted-foreground/25"
                  : i < atual
                    ? "bg-[color:var(--bex-lime)]/70"
                    : i === atual
                      ? "bg-[color:var(--bex-cyan)]"
                      : "bg-border",
              )}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs md:text-[10px]">
          <span className="font-medium text-foreground/85">{foraDoFluxo ? detalhe : nomeAtual}</span>
          {!foraDoFluxo && detalhe !== nomeAtual && <span className="truncate text-muted-foreground">{detalhe}</span>}
        </div>
      </div>
    );
  }

  return (
    <ol className="flex items-start" aria-label="Etapas da OS">
      {ETAPAS_QUADRO.map((e, i) => {
        const feita = i < atual;
        const aqui = i === atual;
        return (
          <li key={e} className="relative flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-2.5 h-px w-full -translate-y-1/2",
                  foraDoFluxo ? "bg-border" : i <= atual ? "bg-[color:var(--bex-lime)]/50" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                feita && "border-[color:var(--bex-lime)]/60 bg-[color:var(--bex-lime)]/20 text-[color:var(--bex-lime)]",
                aqui && "border-[color:var(--bex-cyan)] bg-[color:var(--bex-cyan)] text-black",
                !feita && !aqui && "border-border bg-card text-muted-foreground/60",
              )}
              aria-current={aqui ? "step" : undefined}
            >
              {feita ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
            </span>
            <span className={cn("px-0.5 text-[10px] leading-tight", aqui ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {ROTULO_ETAPA[e]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
