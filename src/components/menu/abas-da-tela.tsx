import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { abasDaTela, podeAbrirRota } from "@/lib/menu";

type Abas = NonNullable<ReturnType<typeof abasDaTela>>;

/**
 * A barra de abas das telas que moram atrás de uma entrada só do menu (o hub).
 *
 * Fica no layout, em cima de toda tela, e não página por página: assim
 * nenhuma tela de hub esquece a barra, e a regra de quem vê cada aba é a mesma
 * do menu — a permissão da rota. Com uma tela só, não há barra.
 */
export function AbasDaTela() {
  const { hasPermission } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const abas = abasDaTela(pathname, (url) => podeAbrirRota(url, hasPermission));
  if (!abas) return null;
  return <BarraDeAbas abas={abas} />;
}

export function BarraDeAbas({ abas }: { abas: Abas }) {
  return (
    // No celular as abas rolam de lado: a linha de dentro tem a largura do
    // conteúdo (w-max) e começa na esquerda, então nada é espremido nem fica
    // fora do alcance da rolagem.
    <nav
      aria-label={`Telas de ${abas.item.title}`}
      className="-mx-4 mb-4 overflow-x-auto border-b border-border px-4 md:mx-0 md:mb-6 md:px-0"
    >
      <div className="flex w-max gap-1">
        {abas.telas.map((t) => {
          const ativa = t.url === abas.ativa;
          return (
            <Link
              key={t.url}
              to={t.url}
              aria-current={ativa ? "page" : undefined}
              data-active={ativa}
              className="relative inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-t-md px-3 text-sm font-medium text-muted-foreground transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:text-foreground data-[active=true]:after:bg-primary md:h-10"
            >
              {t.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
