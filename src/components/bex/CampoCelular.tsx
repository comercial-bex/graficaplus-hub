import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { erroDoCelular, mascaraCelular, precisaAvisoDdd55 } from "@/domain/contato/celular-e-email";

type Props = {
  id: string;
  rotulo: string;
  /** Valor gravado: "(DD) 9XXXX-XXXX" (ou parcial enquanto digita). */
  value: string;
  onChange: (valor: string) => void;
  /** Força mostrar o erro (ex.: depois de tentar enviar). Sem isso, aparece ao sair do campo. */
  mostrarErro?: boolean;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ajuda?: string;
};

/**
 * Celular brasileiro: +55 fixo à esquerda e um campo só para DDD + número.
 * Colou "+55 96 99999-9999"? O 55 sai sozinho. Grava "(96) 99999-9999".
 */
export function CampoCelular({ id, rotulo, value, onChange, mostrarErro, required, disabled, className, ajuda }: Props) {
  const [tocado, setTocado] = useState(false);
  const [ddd55Confirmado, setDdd55Confirmado] = useState(false);
  const aviso55 = !ddd55Confirmado && precisaAvisoDdd55(value);
  const vazio = !value.replace(/\D/g, "");
  const erro = (tocado || mostrarErro) && (required || !vazio) ? erroDoCelular(value) : null;
  const idErro = `${id}-erro`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {rotulo}
        {required && <span className="ml-0.5 text-status-magenta" aria-hidden="true">*</span>}
      </label>
      <div className="flex">
        <span
          className="inline-flex select-none items-center rounded-l-md border border-r-0 border-input bg-muted px-3 font-mono text-sm text-muted-foreground"
          aria-label="Código do Brasil, +55"
        >
          +55
        </span>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="(96) 99999-9999"
          required={required}
          disabled={disabled}
          value={mascaraCelular(value)}
          onChange={(e) => onChange(mascaraCelular(e.target.value))}
          onBlur={() => setTocado(true)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? idErro : undefined}
          className={cn(
            "rounded-l-none aria-invalid:border-status-magenta aria-invalid:ring-2 aria-invalid:ring-status-magenta/20",
            className,
          )}
        />
      </div>
      {aviso55 && (
        <div role="status" className="space-y-1 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
          <p>55 é o código do Brasil e já está no campo. O seu DDD é outro? (ex.: 96 no Amapá)</p>
          <button
            type="button"
            onClick={() => setDdd55Confirmado(true)}
            className="rounded-sm font-semibold text-link underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Meu DDD é 55 mesmo
          </button>
        </div>
      )}
      {erro ? (
        <p id={idErro} role="alert" className="flex items-start gap-1.5 text-sm text-status-magenta">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{erro}</span>
        </p>
      ) : ajuda ? (
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      ) : null}
    </div>
  );
}
