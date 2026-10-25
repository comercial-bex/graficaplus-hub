import { cn } from "@/lib/utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { brl } from "@/domain/parceiros/preco";
import { rotuloDaPorcentagem, taxaDoPrazo, type PrazoDeEntrega } from "@/domain/parceiros/prazo";

/**
 * A escolha do prazo de produção — Normal ou Expresso —, igual no orçamento da
 * equipe e no do parceiro. O expresso é uma taxa em % sobre o valor dos produtos
 * (decisão do dono, 24/10/2026); o valor em reais é só uma estimativa para a
 * pessoa ver o peso da escolha: quem cobra é o banco.
 *
 * `baseDaTaxa` nulo = quem está na tela não vê preço: mostra só a porcentagem.
 */
export function EscolhaDoPrazo({
  prazos,
  escolhido,
  baseDaTaxa,
  desabilitado,
  onEscolher,
  ajuda,
}: {
  prazos: PrazoDeEntrega[];
  escolhido: string;
  baseDaTaxa: number | null;
  desabilitado: boolean;
  onEscolher: (chave: string) => void;
  ajuda: string;
}) {
  // Um prazo só (o normal) não é escolha: a tela não pergunta.
  if (prazos.length < 2) return null;
  return (
    <fieldset className="space-y-2" data-testid="escolha-do-prazo">
      <legend className="text-sm font-medium">Prazo de produção</legend>
      <RadioGroup
        value={escolhido}
        onValueChange={onEscolher}
        disabled={desabilitado}
        className="grid gap-2"
      >
        {prazos.map((pz) => {
          const valor = baseDaTaxa === null ? 0 : taxaDoPrazo(baseDaTaxa, pz.taxa_percentual);
          return (
            <label
              key={pz.chave}
              htmlFor={`prazo-${pz.chave}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                escolhido === pz.chave
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-muted",
                desabilitado && "cursor-default",
              )}
            >
              <RadioGroupItem id={`prazo-${pz.chave}`} value={pz.chave} className="mt-1" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{pz.nome}</span>
                  <span className="text-sm tabular-nums">
                    {pz.taxa_percentual > 0
                      ? `+${rotuloDaPorcentagem(pz.taxa_percentual)} sobre os produtos${valor > 0 ? ` · ${brl(valor)}` : ""}`
                      : "sem taxa"}
                  </span>
                </span>
                {pz.descricao && (
                  <span className="block text-xs text-muted-foreground">{pz.descricao}</span>
                )}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">{ajuda}</p>
    </fieldset>
  );
}
