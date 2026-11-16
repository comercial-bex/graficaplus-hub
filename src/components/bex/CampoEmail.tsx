import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  completarEmail,
  DOMINIOS_SUGERIDOS,
  erroDoEmail,
  sugerirEmailCorrigido,
} from "@/domain/contato/celular-e-email";

type Props = {
  id: string;
  rotulo: string;
  value: string;
  onChange: (valor: string) => void;
  mostrarErro?: boolean;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ajuda?: string;
};

/**
 * E-mail com os 5 domínios comuns em botões ("ana" + @gmail.com) e o aviso
 * "Você quis dizer …@gmail.com?" quando o domínio parece digitado errado.
 * Domínio de empresa continua aceito.
 */
export function CampoEmail({ id, rotulo, value, onChange, mostrarErro, required, disabled, className, ajuda }: Props) {
  const [tocado, setTocado] = useState(false);
  const limpo = value.trim();
  const vazio = !limpo;
  const erro = (tocado || mostrarErro) && (required || !vazio) ? erroDoEmail(value) : null;
  const sugestao = sugerirEmailCorrigido(value);
  const dominio = limpo.includes("@") ? limpo.slice(limpo.indexOf("@") + 1) : "";
  const mostrarBotoes = !vazio && !limpo.startsWith("@") && !dominio.includes(".");
  const idErro = `${id}-erro`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {rotulo}
        {required && <span className="ml-0.5 text-status-magenta" aria-hidden="true">*</span>}
      </label>
      <Input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="seunome@gmail.com"
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s/g, ""))}
        onBlur={() => setTocado(true)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? idErro : undefined}
        className={cn("aria-invalid:border-status-magenta aria-invalid:ring-2 aria-invalid:ring-status-magenta/20", className)}
      />
      {mostrarBotoes && (
        <div className="flex flex-wrap gap-1.5" aria-label="Completar o e-mail">
          {DOMINIOS_SUGERIDOS.map((d) => (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onChange(completarEmail(value, d))}
              className="min-h-8 rounded-full border border-border bg-muted px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              @{d}
            </button>
          ))}
        </div>
      )}
      {sugestao && (
        <p className="text-sm text-foreground">
          Você quis dizer{" "}
          <button
            type="button"
            onClick={() => onChange(sugestao)}
            className="rounded-sm font-semibold text-link underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sugestao}
          </button>
          ?
        </p>
      )}
      {erro && !sugestao ? (
        <p id={idErro} role="alert" className="flex items-start gap-1.5 text-sm text-status-magenta">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{erro}</span>
        </p>
      ) : erro ? (
        <span id={idErro} className="sr-only">{erro}</span>
      ) : ajuda && !sugestao ? (
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      ) : null}
    </div>
  );
}
