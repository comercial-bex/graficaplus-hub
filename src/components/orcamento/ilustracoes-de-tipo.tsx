import type { ChaveDoTipo } from "@/domain/orcamentos/tipos-de-produto";
import { cn } from "@/lib/utils";

/**
 * Desenho de cada tipo de produto, no jeito do Holdprint (01/11/2026): um disco
 * cinza com um traço simples do produto e um detalhe na cor da marca. O dono
 * pediu "ícone visual": quem está aprendendo acha a lona, o adesivo e a placa
 * pelo desenho, antes de ler o nome.
 *
 * SVG inline de propósito: pinta com as cores do tema (traço = texto, detalhe =
 * `fill-primary`), funciona sem rede e não pesa no bundle. Sem `title=`: o
 * nome do tipo está sempre escrito ao lado.
 */

const TRACO = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Desenho({ chave }: { chave: ChaveDoTipo }) {
  switch (chave) {
    case "lona":
      return (
        <g {...TRACO}>
          <path d="M20 14 L32 10 L44 14" />
          <rect x="18" y="18" width="28" height="22" rx="1.5" />
          <circle cx="22" cy="22" r="1.2" className="fill-primary" stroke="none" />
          <circle cx="42" cy="22" r="1.2" className="fill-primary" stroke="none" />
          <path d="M22 36 L30 28 L35 33 L39 29 L42 32" className="fill-primary" stroke="none" />
          <path d="M22 36 L30 28 L35 33 L39 29 L42 32 L42 36 Z" />
          <path d="M18 46 L46 46" />
        </g>
      );
    case "adesivo":
      return (
        <g {...TRACO}>
          <path d="M18 18 H46 V36 L36 46 H18 Z" />
          <path d="M36 46 L36 36 H46" />
          <path d="M36 46 Q39 38 46 36 Z" className="fill-primary" stroke="none" />
          <circle cx="29" cy="29" r="5" className="fill-primary" stroke="none" />
        </g>
      );
    case "placa":
      return (
        <g {...TRACO}>
          <rect x="16" y="16" width="32" height="20" rx="2" />
          <path d="M32 36 V50" />
          <path d="M24 50 H40" />
          <rect x="21" y="21" width="22" height="4" rx="1" className="fill-primary" stroke="none" />
          <path d="M21 30 H35" />
        </g>
      );
    case "papel":
      return (
        <g {...TRACO}>
          <path d="M26 12 H40 L46 18 V40 H26 Z" />
          <path d="M40 12 V18 H46" />
          <path d="M22 18 V46 H40" />
          <path d="M18 24 V50 H36" />
          <rect x="30" y="24" width="11" height="3" rx="1" className="fill-primary" stroke="none" />
          <path d="M30 32 H41 M30 36 H38" />
        </g>
      );
    case "brinde":
      return (
        <g {...TRACO}>
          <path d="M20 20 H40 V40 A6 6 0 0 1 34 46 H26 A6 6 0 0 1 20 40 Z" />
          <path d="M40 25 H44 A5 5 0 0 1 44 35 H40" />
          <rect x="20" y="27" width="20" height="6" className="fill-primary" stroke="none" />
          <path d="M26 14 Q28 11 30 14 Q32 17 34 14" />
        </g>
      );
    case "acabamento":
      return (
        <g {...TRACO}>
          <circle cx="23" cy="41" r="5" />
          <circle cx="41" cy="41" r="5" />
          <path d="M26.5 37.5 L44 14" />
          <path d="M37.5 37.5 L20 14" />
          <circle cx="32" cy="30" r="2" className="fill-primary" stroke="none" />
          <path d="M14 20 H18 M46 20 H50" className="stroke-primary" />
        </g>
      );
    case "servico":
      return (
        <g {...TRACO}>
          <path d="M20 46 L20 18 M44 46 L44 18" />
          <path d="M20 24 H44 M20 31 H44 M20 38 H44" />
          <circle cx="32" cy="16" r="3.5" className="fill-primary" stroke="none" />
          <path d="M32 20 V30 M32 24 L26 29 M32 24 L38 29 M32 30 L28 38 M32 30 L36 38" />
        </g>
      );
    case "impressao_3d":
      return (
        <g {...TRACO}>
          <path d="M32 12 L48 21 V39 L32 48 L16 39 V21 Z" />
          <path d="M32 12 L48 21 L32 30 L16 21 Z" className="fill-primary" stroke="none" />
          <path d="M16 21 L32 30 L48 21 M32 30 V48" />
        </g>
      );
    default:
      return (
        <g {...TRACO}>
          <circle cx="24" cy="24" r="7" />
          <rect x="34" y="17" width="14" height="14" rx="2" className="fill-primary" stroke="none" />
          <path d="M24 34 L31 47 H17 Z" />
          <path d="M41 36 V46 M36 41 H46" />
        </g>
      );
  }
}

/**
 * O desenho dentro do disco. `tamanho` é a largura em px; o disco e o traço
 * escalam juntos. Decorativo (`aria-hidden`): o rótulo do tipo vem do texto.
 */
export function IlustracaoDoTipo({
  chave,
  tamanho = 64,
  marcado = false,
  className,
}: {
  chave: ChaveDoTipo;
  tamanho?: number;
  /** Disco na cor da marca, clarinho, quando o tipo está escolhido. */
  marcado?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={tamanho}
      height={tamanho}
      aria-hidden="true"
      focusable="false"
      data-ilustracao={chave}
      className={cn("shrink-0 text-foreground", className)}
    >
      <circle cx="32" cy="32" r="30" className={marcado ? "fill-primary/20" : "fill-muted"} />
      <Desenho chave={chave} />
    </svg>
  );
}
