import { ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A foto do produto em miniatura na lista (03/11/2026): com "Gerar fotos que
 * faltam" rodando, as fotos vão aparecendo aqui, uma a uma, sem abrir produto
 * por produto. Decorativa: o nome do produto está ao lado, então sem texto
 * alternativo; sem foto, um quadro tracejado com o ícone de enviar.
 */
export function MiniaturaDoProduto({ url, className }: { url?: string | null; className?: string }) {
  const endereco = (url ?? "").trim();
  if (endereco) {
    return (
      <img
        src={endereco}
        alt=""
        loading="lazy"
        data-miniatura="foto"
        className={cn("h-10 w-10 shrink-0 rounded-md border object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-miniatura="vazia"
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/40",
        className,
      )}
    >
      <ImagePlus className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}
