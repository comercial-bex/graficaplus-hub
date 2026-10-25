import { Banknote, Barcode, CreditCard, FileClock, Landmark, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Dica } from "@/components/bex/Dica";
import { cn } from "@/lib/utils";
import { IconeAmex, IconeMastercard, IconePix, IconeVisa, SeloDeBandeira } from "./marcas";

/** A forma de pagamento como cartões com ícone: tocar escolhe, o ícone diz o que é. */
export const OUTRA_FORMA = "__outra__";

type Forma = { valor: string; rotulo: string; icone: ReactNode; dica: string };

const FORMAS: Forma[] = [
  { valor: "PIX", rotulo: "Pix", icone: <IconePix className="h-6 w-6 text-[#32BCAD]" />, dica: "Chave e copia e cola" },
  { valor: "Cartão de crédito", rotulo: "Crédito", icone: <CreditCard className="h-6 w-6 text-sky-400" aria-hidden />, dica: "Em até 12x" },
  { valor: "Cartão de débito", rotulo: "Débito", icone: <CreditCard className="h-6 w-6 text-violet-400" aria-hidden />, dica: "À vista" },
  { valor: "Dinheiro", rotulo: "Dinheiro", icone: <Banknote className="h-6 w-6 text-emerald-400" aria-hidden />, dica: "No balcão" },
  { valor: "Boleto", rotulo: "Boleto", icone: <Barcode className="h-6 w-6 text-amber-400" aria-hidden />, dica: "Com vencimento" },
  { valor: "Transferência bancária", rotulo: "Transferência", icone: <Landmark className="h-6 w-6 text-cyan-400" aria-hidden />, dica: "TED ou DOC" },
  { valor: "A faturar", rotulo: "A faturar", icone: <FileClock className="h-6 w-6 text-orange-400" aria-hidden />, dica: "Paga depois" },
  { valor: OUTRA_FORMA, rotulo: "Outra", icone: <Pencil className="h-6 w-6 text-muted-foreground" aria-hidden />, dica: "Escrever" },
];

export function FormaDePagamento({
  valor,
  desabilitado,
  onEscolher,
}: {
  /** o texto gravado em `condicao_pagamento.forma`, ou OUTRA_FORMA quando é texto livre */
  valor: string;
  desabilitado?: boolean;
  onEscolher: (forma: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Forma de pagamento">
      {FORMAS.map((f) => {
        const ativa = valor === f.valor;
        return (
          <button
            key={f.valor}
            type="button"
            role="radio"
            aria-checked={ativa}
            disabled={desabilitado}
            onClick={() => onEscolher(f.valor)}
            className={cn(
              "flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl border bg-card px-2 py-2 text-center transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              ativa ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border hover:border-primary/50",
            )}
          >
            {f.icone}
            <span className="text-xs font-semibold leading-none">{f.rotulo}</span>
            <span className="text-[10px] leading-none text-muted-foreground">{f.dica}</span>
          </button>
        );
      })}
    </div>
  );
}

export const BANDEIRAS = [
  { valor: "visa", rotulo: "Visa" },
  { valor: "mastercard", rotulo: "Mastercard" },
  { valor: "elo", rotulo: "Elo" },
  { valor: "amex", rotulo: "American Express" },
  { valor: "hipercard", rotulo: "Hipercard" },
] as const;

function MarcaDaBandeira({ valor }: { valor: string }) {
  if (valor === "visa") return <IconeVisa className="h-4 w-8 text-[#1A1F71] dark:text-blue-300" />;
  if (valor === "mastercard") return <IconeMastercard className="h-5 w-8 text-[#EB001B]" />;
  if (valor === "amex") return <IconeAmex className="h-5 w-8 text-[#2E77BC]" />;
  if (valor === "elo") return <SeloDeBandeira texto="Elo" className="text-yellow-400" />;
  return <SeloDeBandeira texto="Hiper" className="text-red-400" />;
}

/** Bandeira do cartão: opcional, serve para o cliente e a equipe saberem qual cartão foi combinado. */
export function BandeiraDoCartao({
  valor,
  desabilitado,
  onEscolher,
}: {
  valor: string | null;
  desabilitado?: boolean;
  onEscolher: (bandeira: string | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Bandeira (opcional)</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bandeira do cartão">
        {BANDEIRAS.map((b) => {
          const ativa = valor === b.valor;
          return (
            <Dica key={b.valor} texto={b.rotulo}>
              <button
                type="button"
                role="radio"
                aria-checked={ativa}
                aria-label={b.rotulo}
                disabled={desabilitado}
                onClick={() => onEscolher(ativa ? null : b.valor)}
                className={cn(
                  "flex h-9 min-w-14 items-center justify-center rounded-lg border bg-card px-2.5 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                  ativa ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50",
                )}
              >
                <MarcaDaBandeira valor={b.valor} />
              </button>
            </Dica>
          );
        })}
      </div>
    </div>
  );
}
