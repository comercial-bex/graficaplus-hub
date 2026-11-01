import { cn } from "@/lib/utils";
import { DicaIcone } from "@/components/bex/Dica";

/**
 * O caminho da tela, no desenho do Holdprint que o dono aprovou (31/10/2026):
 * "Home / Financeiro / Contas a pagar". O `breadcrumb` que as telas já passam
 * ("Financeiro", "Print OS · Comercial") vira os degraus do meio; o título é o
 * último degrau.
 */
export function trilhaDaTela(title: string, breadcrumb?: string): string[] {
  const meio = (breadcrumb ?? "")
    .split("·")
    .map((parte) => parte.trim())
    .filter(Boolean);
  return ["Home", ...meio, title];
}

/** Barra de cabeçalho da tela: título grande, caminho e ações, num cartão branco. */
export function SectionHeader({
  breadcrumb,
  title,
  description,
  ajuda,
  actions,
  className,
}: {
  breadcrumb?: string;
  title: string;
  description?: string;
  /** Explicação do que a tela faz, mostrada no "?" ao lado do título. */
  ajuda?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const trilha = trilhaDaTela(title, breadcrumb);
  return (
    <header className={cn("mb-6 rounded-xl border border-border bg-card px-5 py-4 shadow-sm", className)}>
      <div
        className={cn(
          // As ações descem para baixo do título quando falta lugar: lado a lado, o
          // título ficava com o que sobrava — "Nova OS" espremia o título em duas
          // letras no celular, e com o menu aberto numa tela média o WhatsApp
          // virava "What…" (visto ao vivo em 21/10/2026). O título guarda 16rem.
          "flex flex-wrap items-center justify-between gap-4",
        )}
      >
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="truncate text-2xl font-extrabold text-foreground md:text-[1.75rem] md:leading-9">{title}</h1>
            <DicaIcone texto={ajuda} rotulo={title} lado="bottom" className="h-5 w-5" />
          </div>
          <nav aria-label="Onde você está" className="mt-1">
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              {trilha.map((parte, i) => {
                const ultimo = i === trilha.length - 1;
                return (
                  <li key={`${i}-${parte}`} className="flex min-w-0 items-center gap-1.5">
                    {i > 0 && <span aria-hidden="true">/</span>}
                    <span className={cn("truncate", ultimo && "font-medium text-foreground")} aria-current={ultimo ? "page" : undefined}>
                      {parte}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
          {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
