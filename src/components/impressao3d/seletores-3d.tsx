import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Printer } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/bex/Dica";
import { amostraDaCor, type AmostraCor } from "@/lib/cor-filamento";
import { cn } from "@/lib/utils";

function Bolinha({ amostra, className }: { amostra: AmostraCor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-4 w-4 shrink-0 rounded-full border border-border", className)}
      style={{ background: amostra.css }}
    />
  );
}

export function SeletorImpressora({
  impressoras, valor, onChange, detalhe,
}: {
  impressoras: any[];
  valor: string | null | undefined;
  onChange: (id: string) => void;
  detalhe: (m: any) => string | undefined;
}) {
  return (
    <Select value={valor ?? ""} onValueChange={onChange}>
      <SelectTrigger aria-label="Impressora" className="h-11">
        <SelectValue placeholder="Escolha a impressora" />
      </SelectTrigger>
      <SelectContent>
        {impressoras.map((m) => (
          <SelectItem key={m.maquina_id} value={m.maquina_id}>
            <span className="flex items-center gap-2">
              <Printer className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{m.maquinas?.nome}</span>
              {detalhe(m) && <span className="text-xs text-muted-foreground">{detalhe(m)}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SeletorFilamento({
  filamentos, valor, onChange, detalhe,
}: {
  filamentos: any[];
  valor: string | null | undefined;
  onChange: (id: string) => void;
  detalhe: (m: any) => string;
}) {
  const [aberto, setAberto] = useState(false);
  const [cor, setCor] = useState<string | null>(null);

  const comCor = useMemo(
    () => filamentos.map((m) => ({ m, amostra: amostraDaCor(m.cor, m.materiais?.nome) })),
    [filamentos],
  );
  const paleta = useMemo(() => {
    const mapa = new Map<string, AmostraCor>();
    comCor.forEach(({ amostra }) => mapa.set(amostra.chave, amostra));
    return [...mapa.values()];
  }, [comCor]);
  const lista = cor ? comCor.filter((x) => x.amostra.chave === cor) : comCor;
  const atual = comCor.find((x) => x.m.material_id === valor);

  return (
    <div className="space-y-2">
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-label="Filamento" className="h-11 w-full justify-between font-normal">
            {atual ? (
              <span className="flex min-w-0 items-center gap-2">
                <Bolinha amostra={atual.amostra} />
                <span className="truncate">{atual.m.materiais?.nome}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Escolha o filamento</span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar filamento…" />
            <CommandList>
              <CommandEmpty>Nenhum filamento {cor ? "nessa cor" : "encontrado"}.</CommandEmpty>
              <CommandGroup>
                {lista.map(({ m, amostra }) => (
                  <CommandItem
                    key={m.material_id}
                    value={`${m.materiais?.nome} ${m.tipo ?? ""} ${m.cor ?? ""}`}
                    onSelect={() => { onChange(m.material_id); setAberto(false); }}
                  >
                    <Bolinha amostra={amostra} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{m.materiais?.nome}</div>
                      <div className="truncate text-xs text-muted-foreground">{detalhe(m)}</div>
                    </div>
                    {valor === m.material_id && <Check className="h-4 w-4" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {paleta.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por cor">
          {/* Botão só de bolinha: o nome da cor vai na Dica e no aria-label, nunca em
              title — o title não abre no toque e o leitor de tela quase nunca o lê. */}
          {paleta.map((a) => (
            <Dica key={a.chave} texto={a.nome}>
              <button
                type="button"
                aria-label={`Cor ${a.nome}`}
                aria-pressed={cor === a.chave}
                onClick={() => { setCor(cor === a.chave ? null : a.chave); setAberto(true); }}
                className={cn(
                  "rounded-full p-0.5 transition",
                  cor === a.chave ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "hover:scale-110",
                )}
              >
                <Bolinha amostra={a} className="h-5 w-5" />
              </button>
            </Dica>
          ))}
          {cor && (
            <button type="button" className="ml-1 text-xs text-muted-foreground underline" onClick={() => setCor(null)}>
              limpar cor
            </button>
          )}
        </div>
      )}
    </div>
  );
}
