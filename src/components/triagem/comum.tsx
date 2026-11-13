import { AlertTriangle } from "lucide-react";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Peças comuns da tela do robô de boas-vindas. O dono enxerga mal: letra de
 * 16 px no mínimo, alvo de toque de 44 px e contraste de 4,5 para 1, por isso
 * só cores do tema (texto, fundo e borda semânticos) e nenhum texto menor.
 */

/** Campo de texto e botão da tela: 16 px e alvo de 44 px. */
export const CAMPO = "min-h-11 text-base md:text-base";
export const BOTAO = "min-h-11 text-base";
export const SELETOR =
  "min-h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-70";
export const AREA_DE_TEXTO =
  "min-h-28 w-full rounded-md border border-input bg-card px-3 py-2 text-base leading-relaxed text-foreground shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-70";

export function ErroDaTela({
  erro,
  aoTentar,
  titulo,
}: {
  erro: unknown;
  aoTentar: () => void;
  titulo: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive bg-destructive/10 p-4 text-base text-foreground"
    >
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" /> {titulo}
      </p>
      <p className="mt-1">{mensagemErro(erro, "Não foi possível carregar. Tente de novo.")}</p>
      <Button type="button" variant="outline" className={cn(BOTAO, "mt-3")} onClick={aoTentar}>
        Tentar de novo
      </Button>
    </div>
  );
}

export function ErroDeGravacao({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-base font-medium text-destructive">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{mensagem}</span>
    </p>
  );
}

/** Faixa de aviso: o que o robô faz e o que a pessoa precisa saber antes de mexer. */
export function Aviso({
  children,
  tom = "neutro",
}: {
  children: React.ReactNode;
  tom?: "neutro" | "atencao";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 text-base text-foreground",
        tom === "atencao" ? "border-warning bg-warning/15" : "border-border bg-card",
      )}
    >
      {children}
    </div>
  );
}
