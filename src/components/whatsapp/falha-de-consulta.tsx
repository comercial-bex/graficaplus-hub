import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";

/**
 * Consulta que caiu, dita como consulta que caiu.
 *
 * O defeito que esta base já pagou caro: tela que, com a leitura falhando,
 * mostra "Nenhuma conversa" — e a pessoa conclui que ninguém escreveu.
 */
export function FalhaDeConsulta({
  titulo,
  erro,
  onTentarDeNovo,
}: {
  titulo: string;
  erro: unknown;
  onTentarDeNovo?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{titulo}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{mensagemErro(erro)}</p>
        <p>Isto é uma falha de consulta, não uma lista vazia.</p>
        {onTentarDeNovo && (
          <Button variant="outline" size="sm" onClick={onTentarDeNovo}>
            Tentar de novo
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
