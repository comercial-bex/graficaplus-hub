import { ImagePlus } from "lucide-react";
import { FotoAmpliavel } from "@/components/produtos/foto-ampliavel";
import { cn } from "@/lib/utils";

/**
 * A foto do produto em miniatura na lista (03/11/2026): com "Gerar fotos que
 * faltam" rodando, as fotos vão aparecendo aqui, uma a uma, sem abrir produto
 * por produto. A miniatura é decorativa (`alt=""`): o nome do produto está ao
 * lado. Sem foto, um quadro tracejado com o ícone de enviar.
 *
 * 17/11/2026: com foto, a miniatura se amplia (cartão ao passar o mouse, tela cheia
 * ao clicar ou tocar). Passe `nome` para a foto ampliada ter texto descritivo.
 */
export function MiniaturaDoProduto({
  url,
  nome,
  className,
}: {
  url?: string | null;
  nome?: string | null;
  className?: string;
}) {
  const endereco = (url ?? "").trim();
  if (endereco) {
    const cheia = /(^|\s)w-full(\s|$)/.test(className ?? "");
    return (
      <FotoAmpliavel
        url={endereco}
        alt={nome ? `Foto de ${nome}` : "Foto do produto"}
        className={cheia ? "block w-full" : undefined}
      >
        <img
          src={endereco}
          alt=""
          loading="lazy"
          data-miniatura="foto"
          className={cn("h-10 w-10 shrink-0 rounded-md border object-cover", className)}
        />
      </FotoAmpliavel>
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
