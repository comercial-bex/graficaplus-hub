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
 */
export function ConfirmarAcao({
  titulo,
  descricao,
  rotuloConfirmar = "Confirmar",
  destrutivo = false,
  aoConfirmar,
  children,
}: {
  titulo: string;
  descricao?: string;
  rotuloConfirmar?: string;
  destrutivo?: boolean;
  aoConfirmar: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {descricao ? <AlertDialogDescription>{descricao}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            onClick={aoConfirmar}
            className={cn(destrutivo && buttonVariants({ variant: "destructive" }))}
          >
            {rotuloConfirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
