import { useState } from "react";
import { FileText, ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACEITA_NO_CAMPO,
  ROTULO_DO_TIPO,
  problemaDoArquivo,
  tamanhoLegivel,
  type TipoDeAnexo,
} from "@/domain/financeiro/contas-a-pagar-anexos";
import type { ArquivoParaEnviar } from "./use-conta-a-pagar";

/**
 * Escolher arquivos antes de enviar: cada um com o tipo (fatura/boleto ou comprovante) e o
 * botão de tirar da lista. Arquivo que não serve é recusado na hora, com o nome e o porquê;
 * não entra na lista para depois falhar no envio. Este campo não grava nada.
 */
export function CampoDeAnexos({
  id,
  itens,
  onChange,
  tipoPadrao = "fatura",
  tipoFixo,
  disabled = false,
}: {
  id: string;
  itens: ArquivoParaEnviar[];
  onChange: (itens: ArquivoParaEnviar[]) => void;
  tipoPadrao?: TipoDeAnexo;
  /** Quando o contexto já diz o tipo (o comprovante no diálogo de pagar), sem seletor. */
  tipoFixo?: TipoDeAnexo;
  disabled?: boolean;
}) {
  const [recusados, setRecusados] = useState<string[]>([]);

  function escolher(lista: FileList | null) {
    if (!lista) return;
    const novos: ArquivoParaEnviar[] = [];
    const ruins: string[] = [];
    for (const arquivo of Array.from(lista)) {
      const problema = problemaDoArquivo(arquivo);
      if (problema) ruins.push(problema);
      else novos.push({ arquivo, tipo: tipoFixo ?? tipoPadrao });
    }
    setRecusados(ruins);
    if (novos.length > 0) onChange([...itens, ...novos]);
  }

  return (
    <div className="space-y-2">
      <Input
        id={id}
        type="file"
        multiple={!tipoFixo}
        accept={ACEITA_NO_CAMPO}
        disabled={disabled}
        aria-describedby={`${id}-ajuda`}
        onChange={(e) => {
          escolher(e.target.files);
          e.target.value = "";
        }}
      />
      <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
        PDF, JPG ou PNG, até 10 MB cada.
      </p>
      {recusados.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-xs text-destructive">
          {recusados.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {itens.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {itens.map((item, i) => {
            const Icone = item.arquivo.type === "application/pdf" ? FileText : ImageIcon;
            return (
              <li
                key={`${item.arquivo.name}-${i}`}
                className="flex flex-wrap items-center gap-2 p-2"
              >
                <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">{item.arquivo.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tamanhoLegivel(item.arquivo.size)}
                </span>
                {tipoFixo ? (
                  <span className="text-xs text-muted-foreground">{ROTULO_DO_TIPO[tipoFixo]}</span>
                ) : (
                  <Select
                    value={item.tipo}
                    disabled={disabled}
                    onValueChange={(v) =>
                      onChange(
                        itens.map((x, j) => (j === i ? { ...x, tipo: v as TipoDeAnexo } : x)),
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-[210px]"
                      aria-label={`Tipo de ${item.arquivo.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fatura">{ROTULO_DO_TIPO.fatura}</SelectItem>
                      <SelectItem value="comprovante">{ROTULO_DO_TIPO.comprovante}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11"
                  disabled={disabled}
                  aria-label={`Tirar ${item.arquivo.name} da lista`}
                  onClick={() => onChange(itens.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
