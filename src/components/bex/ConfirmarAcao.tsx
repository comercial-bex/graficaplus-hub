import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Confirmação de ação no padrão do sistema (02/11/2026).
 *
 * Substitui o `window.confirm` do navegador: aquela caixa não herda o visual,
 * não anuncia direito para leitor de tela e some em navegadores embutidos.
 * Embrulhe o botão que dispara a ação; a ação só roda no "Confirmar".
 *
 * `grande` (opcional, desligado por padrão): letra de 16 px na explicação e botões de 44 px,
 * para as telas escritas para quem enxerga mal. Quem não passa continua com o tamanho de sempre.
 */
export function ConfirmarAcao({
  titulo,
  descricao,
  rotuloConfirmar = "Confirmar",
  destrutivo = false,
  grande = false,
  aoConfirmar,
  children,
}: {
  titulo: string;
  descricao?: string;
  rotuloConfirmar?: string;
  destrutivo?: boolean;
  grande?: boolean;
  aoConfirmar: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {descricao ? (
            <AlertDialogDescription className={cn(grande && "text-base text-foreground")}>
              {descricao}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={cn(grande && "h-11 min-h-11 text-base")}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            onClick={aoConfirmar}
            className={cn(
              destrutivo && buttonVariants({ variant: "destructive" }),
              grande && "h-11 min-h-11 text-base",
            )}
          >
            {rotuloConfirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
