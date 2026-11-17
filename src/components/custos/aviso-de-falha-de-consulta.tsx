import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";

/**
 * A leitura falhou. Isto aparece no lugar da lista, para uma falha nunca parecer lista vazia.
 * Letra de 16 px, role alert e botão para tentar de novo.
 */
export function AvisoDeFalhaDeConsulta({
  o_que,
  erro,
  carregando,
  aoTentarDeNovo,
}: {
  /** "as funções da mão de obra" */
  o_que: string;
  erro: unknown;
  carregando?: boolean;
  aoTentarDeNovo: () => void;
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-md border border-border p-4 text-base"
      data-testid="falha-de-consulta"
    >
      <p className="font-semibold">Não deu para carregar {o_que}.</p>
      <p>{mensagemErro(erro)} Isto é uma falha de leitura, não uma lista vazia.</p>
      <Button
        type="button"
        variant="outline"
        className="h-11 min-h-11 text-base"
        disabled={carregando}
        onClick={aoTentarDeNovo}
      >
        Tentar de novo
      </Button>
    </div>
  );
}
