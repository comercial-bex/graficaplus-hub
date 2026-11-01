import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apenasDigitos, formatarCEP } from "@/domain/documentos";
import { consultarCEP, type DadosCEP } from "@/lib/api/cep.server";

/**
 * CEP que preenche o endereço (01/11/2026). Dispara sozinho quando o CEP chega a 8 números, uma vez por
 * número, e o botão tenta de novo se a consulta falhar. Quem chama decide o que fazer com o resultado
 * (o cadastro só preenche o que está vazio).
 */
export function CampoDeCep({
  id,
  rotulo = "CEP",
  valor,
  onValorChange,
  onEncontrado,
}: {
  id: string;
  rotulo?: string;
  valor: string;
  onValorChange: (cep: string) => void;
  onEncontrado: (dados: DadosCEP) => void;
}) {
  const [consultando, setConsultando] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const digitos = apenasDigitos(valor);

  async function buscar(cep: string) {
    setConsultando(true);
    setUltimo(cep);
    try {
      const r = await consultarCEP({ data: { cep } });
      if (!r.ok) {
        toast.error(r.motivo);
        return;
      }
      onEncontrado(r.dados);
      toast.success("Endereço preenchido pelo CEP. Falta só o número.");
    } catch {
      toast.error("Não foi possível consultar o CEP agora. Preencha o endereço à mão.");
    } finally {
      setConsultando(false);
    }
  }

  function alterar(entrada: string) {
    const limpo = apenasDigitos(entrada).slice(0, 8);
    onValorChange(limpo.length === 8 ? formatarCEP(limpo) : limpo);
    if (limpo.length === 8 && limpo !== ultimo && !consultando) void buscar(limpo);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={9}
          placeholder="00000-000"
          value={valor}
          onChange={(e) => alterar(e.target.value)}
          className="h-11 text-base"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Buscar o endereço pelo CEP"
          disabled={consultando || digitos.length !== 8}
          onClick={() => void buscar(digitos)}
          className="h-11 w-11 shrink-0"
        >
          {consultando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
