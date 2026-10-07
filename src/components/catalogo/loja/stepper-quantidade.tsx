import { useEffect, useState } from "react";
import { AlertTriangle, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { somarPasso } from "@/domain/catalogo/carrinho";
import {
  conferirQuantidade,
  quantidadeInicial,
  type RegraDeQuantidade,
} from "@/domain/catalogo/quantidade";

/**
 * O seletor de quantidade da loja: "−", o número, "+". Os botões têm 44 px —
 * é dedo no iPad, não ponteiro de mouse. "+" e "−" andam no múltiplo que a
 * tabela do fornecedor exige e nunca descem do mínimo; quem digita um número
 * fora da regra vê a mesma frase que o banco devolveria ("é vendido de 10 em
 * 10: use 20") e um toque para corrigir.
 */
export function StepperQuantidade({
  valor,
  regra,
  rotulo,
  onChange,
  className,
}: {
  valor: number;
  regra: RegraDeQuantidade;
  rotulo: string;
  onChange: (quantidade: number) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  const conferencia = conferirQuantidade(valor, regra, rotulo);
  const minimo = quantidadeInicial(regra);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-stretch" role="group" aria-label={`Quantidade de ${rotulo}`}>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 shrink-0 rounded-r-none px-0"
          aria-label="Menos"
          disabled={valor <= minimo}
          onClick={() => onChange(somarPasso(valor, regra, -1))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          inputMode="numeric"
          value={texto}
          aria-label="Quantidade em peças"
          className="h-11 w-20 rounded-none border-x-0 text-center text-base font-semibold"
          onChange={(e) => {
            const t = e.target.value.replace(/\D/g, "").slice(0, 7);
            setTexto(t);
            const n = Number(t);
            if (t && n > 0) onChange(n);
          }}
          onBlur={() => {
            if (!texto) setTexto(String(valor));
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 shrink-0 rounded-l-none px-0"
          aria-label="Mais"
          onClick={() => onChange(somarPasso(valor, regra, 1))}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {!conferencia.ok && (
        <p className="flex items-start gap-1 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {conferencia.mensagem}
            {conferencia.sugestao != null && (
              <button
                type="button"
                className="ml-1 underline underline-offset-2"
                onClick={() => onChange(conferencia.sugestao!)}
              >
                Usar {conferencia.sugestao}
              </button>
            )}
          </span>
        </p>
      )}
      {conferencia.ok && conferencia.aviso && (
        <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {conferencia.aviso}
        </p>
      )}
    </div>
  );
}
