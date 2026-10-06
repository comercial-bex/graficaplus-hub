import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { ptBR } from "date-fns/locale/pt-BR";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dataLocal } from "@/domain/os/prazo";
import { isoLocal } from "@/domain/orcamentos/acordo";

/**
 * Campo de data que diz quando está VAZIO.
 *
 * O `<input type="date">` do Safari desenha a data de hoje em cinza quando o
 * campo está vazio. Na tela do orçamento isso aparecia como "Prazo final
 * 05/10/2026" com "sem prazo definido" logo embaixo — a pessoa achava que a
 * data estava lá e o PDF saía sem ela. Aqui o vazio é "Sem data", escrito.
 *
 * O valor é "aaaa-mm-dd" (coluna `date`), montado pelas partes locais: passar
 * por `toISOString()` gravaria o dia anterior no fuso de Macapá.
 */
export function CampoData({
  id,
  valor,
  onMudar,
  desabilitado,
  vazio = "Sem data",
}: {
  id?: string;
  valor: string | null;
  onMudar: (iso: string | null) => void;
  desabilitado?: boolean;
  vazio?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const data = dataLocal(valor);

  return (
    <div className="flex items-center gap-1">
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={desabilitado}
            className={cn("h-10 w-full justify-start font-normal", !data && "text-muted-foreground")}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            {data ? data.toLocaleDateString("pt-BR") : vazio}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={data ?? undefined}
            defaultMonth={data ?? undefined}
            onSelect={(d) => {
              onMudar(d ? isoLocal(d) : null);
              setAberto(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {data && !desabilitado && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label="Tirar a data"
          title="Tirar a data"
          onClick={() => onMudar(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
