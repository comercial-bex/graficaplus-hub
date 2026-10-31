import { cn } from "@/lib/utils";
import { DicaIcone } from "@/components/bex/Dica";

/** Barra de cabeçalho da tela: caminho, título e ações. */
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
  return (
    <header
      className={cn(
        // As ações descem para baixo do título quando falta lugar: lado a lado, o
        // título ficava com o que sobrava — "Nova OS" espremia o título em duas
        // letras no celular, e com o menu aberto numa tela média o WhatsApp
        // virava "What…" (visto ao vivo em 21/10/2026). O título guarda 16rem.
        // Sem régua embaixo (pele de 31/10/2026): o espaço separa.
        "mb-6 flex flex-wrap items-center justify-between gap-4 md:items-end",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-64">
        {breadcrumb && (
          <p className="mb-1.5 text-[13px] font-semibold text-muted-foreground">{breadcrumb}</p>
        )}
        <div className="flex min-w-0 items-center gap-2">
          {/* No celular o título quebra linha; cortar "Produção 3D — Jobs & Apo…" esconde o nome da tela. */}
          <h1 className="min-w-0 break-words text-2xl font-bold leading-tight tracking-tight text-foreground md:truncate md:text-[2rem]">
            {title}
          </h1>
          <DicaIcone texto={ajuda} rotulo={title} lado="bottom" className="h-5 w-5" />
        </div>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
