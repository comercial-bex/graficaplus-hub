import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = ComponentProps<typeof Input> & {
  id: string;
  rotulo: string;
  /** Mensagem embaixo do campo. Quando existe, o campo fica marcado como inválido. */
  erro?: string;
  /** Botão à direita, dentro do campo (o olho da senha). */
  acao?: ReactNode;
};

/**
 * Campo da tela de entrada: rótulo visível, erro embaixo do campo e ligação
 * por aria-describedby, para o leitor de tela ler o erro junto com o campo.
 *
 * As cores vêm dos tokens do tema (card, input, ring, status-magenta): o
 * mesmo campo serve ao tema claro e ao escuro.
 */
export const CampoDeAcesso = forwardRef<HTMLInputElement, Props>(
  ({ id, rotulo, erro, acao, className, ...props }, ref) => {
    const idDoErro = `${id}-erro`;
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          {rotulo}
        </label>
        <div className="relative">
          {/* <Input> já é text-base abaixo de md: menor que 16px o iOS dá zoom ao focar */}
          <Input
            ref={ref}
            id={id}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? idDoErro : undefined}
            className={cn(
              "h-12 rounded-lg px-4 shadow-none placeholder:text-muted-foreground/60",
              "aria-invalid:border-status-magenta aria-invalid:ring-2 aria-invalid:ring-status-magenta/20",
              acao && "pr-12",
              className,
            )}
            {...props}
          />
          {acao && <div className="absolute inset-y-0 right-1 flex items-center">{acao}</div>}
        </div>
        {erro && (
          <p
            id={idDoErro}
            role="alert"
            className="flex items-start gap-1.5 text-sm text-status-magenta"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{erro}</span>
          </p>
        )}
      </div>
    );
  },
);
CampoDeAcesso.displayName = "CampoDeAcesso";
