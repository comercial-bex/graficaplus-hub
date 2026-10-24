import { Box, Gift, Package, Palette, Printer, Scissors, Signpost, Sticker, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONE_DA_CATEGORIA = {
  impressao_grande_formato: Printer,
  adesivos: Sticker,
  comunicacao_visual: Signpost,
  brindes: Gift,
  acabamento: Scissors,
  instalacao: Wrench,
  servico: Palette,
  outros: Package,
} as const;

export function IconeDaCategoria({ categoria, className }: { categoria: string | null; className?: string }) {
  const Icone = (categoria && ICONE_DA_CATEGORIA[categoria as keyof typeof ICONE_DA_CATEGORIA]) || Box;
  return <Icone className={className} aria-hidden />;
}

/** A foto do produto quando existe; senão o ícone da categoria. A foto se troca na ficha do produto. */
export function IconeDoProduto({
  imagem,
  categoria,
  nome,
  tamanho = "md",
}: {
  imagem: string | null;
  categoria: string | null;
  nome: string;
  tamanho?: "sm" | "md" | "lg";
}) {
  const caixa = tamanho === "lg" ? "h-20 w-20 rounded-xl" : tamanho === "sm" ? "h-9 w-9 rounded-md" : "h-14 w-14 rounded-lg";
  const icone = tamanho === "lg" ? "h-9 w-9" : tamanho === "sm" ? "h-4 w-4" : "h-6 w-6";
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden border border-border bg-primary/10 text-primary", caixa)}>
      {imagem ? (
        <img src={imagem} alt={nome} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <IconeDaCategoria categoria={categoria} className={icone} />
      )}
    </div>
  );
}

