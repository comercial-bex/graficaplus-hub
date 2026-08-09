import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  apenasDigitos,
  formatarDocumento,
  tamanhoEsperado,
  validarDocumento,
  type TipoDocumento,
} from "@/domain/documentos";
import { consultarCNPJ, type DadosCNPJ } from "@/lib/api/cnpj.server";

type Props = {
  tipo: TipoDocumento;
  onTipoChange: (tipo: TipoDocumento) => void;
  valor: string;
  onValorChange: (valor: string) => void;
  /** Chamado com os dados da Receita quando a consulta do CNPJ dá certo. */
  onDadosEncontrados?: (dados: DadosCNPJ) => void;
  label?: string;
  disabled?: boolean;
};

/**
 * Campo de CPF/CNPJ com máscara, validação por dígito verificador e — só para
 * CNPJ — busca dos dados na base pública da Receita.
 *
 * A busca dispara sozinha quando o CNPJ chega a 14 dígitos válidos, porque é o
 * momento em que ela pode dar certo e poupa o clique. O botão fica disponível
 * para tentar de novo se a consulta falhar.
 *
 * CPF não tem consulta: dado de pessoa física não é público e não existe API
 * legítima para isso. O rótulo do campo diz isso, para ninguém ficar esperando.
 */
export function CampoDocumento({
  tipo,
  onTipoChange,
  valor,
  onValorChange,
  onDadosEncontrados,
  label,
  disabled,
}: Props) {
  const [consultando, setConsultando] = useState(false);
  const [ultimoConsultado, setUltimoConsultado] = useState<string | null>(null);

  const digitos = apenasDigitos(valor);
  const completo = digitos.length === tamanhoEsperado(tipo);
  const valido = completo && validarDocumento(digitos, tipo);
  const invalido = completo && !valido;

  async function buscar(cnpjDigitos: string) {
    setConsultando(true);
    setUltimoConsultado(cnpjDigitos);
    try {
      const resultado = await consultarCNPJ({ data: { cnpj: cnpjDigitos } });
      if (!resultado.ok) {
        toast.error(resultado.motivo);
        return;
      }
      onDadosEncontrados?.(resultado.dados);
      const situacao = resultado.dados.situacao;
      toast.success(
        situacao && situacao.toUpperCase() !== "ATIVA"
          ? `Dados preenchidos — atenção: situação "${situacao}"`
          : "Dados preenchidos pela Receita Federal",
      );
    } catch {
      toast.error("Não foi possível consultar agora. Preencha manualmente.");
    } finally {
      setConsultando(false);
    }
  }

  function alterarValor(entrada: string) {
    const limpo = apenasDigitos(entrada).slice(0, tamanhoEsperado(tipo));
    onValorChange(limpo);

    // Dispara ao completar um CNPJ válido, e só uma vez por número.
    if (
      tipo === "cnpj" &&
      limpo.length === 14 &&
      validarDocumento(limpo, "cnpj") &&
      limpo !== ultimoConsultado &&
      !consultando
    ) {
      void buscar(limpo);
    }
  }

  function alterarTipo(novo: TipoDocumento) {
    if (novo === tipo) return;
    onTipoChange(novo);
    // Trocar o tipo invalida o que estava digitado (tamanhos diferentes).
    onValorChange("");
    setUltimoConsultado(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label htmlFor="campo-documento">{label ?? "Documento"}</Label>
        <div
          className="inline-flex rounded-md border p-0.5"
          role="group"
          aria-label="Tipo de documento"
        >
          {(["cnpj", "cpf"] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={tipo === opcao}
              disabled={disabled}
              onClick={() => alterarTipo(opcao)}
              className={
                "px-3 py-1 text-xs rounded " +
                (tipo === opcao
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted")
              }
            >
              {opcao.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          id="campo-documento"
          inputMode="numeric"
          autoComplete="off"
          placeholder={tipo === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00"}
          value={formatarDocumento(digitos, tipo)}
          disabled={disabled}
          aria-invalid={invalido}
          onChange={(e) => alterarValor(e.target.value)}
        />
        {tipo === "cnpj" && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Buscar dados do CNPJ na Receita Federal"
            title="Buscar dados na Receita Federal"
            disabled={disabled || consultando || !valido}
            onClick={() => void buscar(digitos)}
          >
            {consultando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {invalido && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {tipo === "cnpj" ? "CNPJ" : "CPF"} inválido — confira os dígitos.
        </p>
      )}
      {valido && !consultando && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3 w-3 text-emerald-600" />
          {tipo === "cnpj"
            ? "CNPJ válido — os dados vêm da Receita Federal."
            : "CPF válido."}
        </p>
      )}
      {tipo === "cpf" && (
        <Badge variant="outline" className="text-xs font-normal">
          CPF é preenchido manualmente: dados de pessoa física não são públicos.
        </Badge>
      )}
    </div>
  );
}
