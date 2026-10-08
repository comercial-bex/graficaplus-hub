import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "../lib/auth-context";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { supabase } from "../integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { trocouDeConta, type DonoDaSessao } from "../domain/acesso/sessao";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

// Chunk com hash antigo: o PWA fica dias aberto com o HTML velho e, depois de um
// deploy, a rota ainda não visitada pede um /assets/*.js que já não existe.
const ERRO_CHUNK_ANTIGO = /dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported/i;
const CHAVE_RECARGA = "bexprint:recarregado_por_versao_nova";

/**
 * Recarrega UMA vez por minuto. Se o erro volta logo depois da recarga, não é
 * versão nova — insistir vira laço: a aba recarrega sem parar e para de
 * responder. A marca expira em 1 min para o próximo deploy (dias depois, na
 * mesma sessão) recarregar de novo. Devolve se recarregou.
 */
function recarregarUmaVez(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE_RECARGA) ?? 0);
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem(CHAVE_RECARGA, String(Date.now()));
  } catch {
    /* sem storage: recarrega mesmo assim (não há como guardar o laço) */
  }
  window.location.reload();
  return true;
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const versaoNova = ERRO_CHUNK_ANTIGO.test((error as Error)?.message ?? "");
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  useEffect(() => {
    if (!versaoNova) return;
    // Se o erro voltar logo depois da recarga, fica na tela com o botão.
    recarregarUmaVez();
  }, [versaoNova]);
  if (versaoNova) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Saiu uma versão nova do sistema. Recarregando…</h1>
          <p className="mt-2 text-sm text-muted-foreground">Se a tela não voltar sozinha, toque abaixo.</p>
          <div className="mt-6">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Recarregar agora
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Esta página não carregou</h1>
        <p className="mt-2 text-sm text-muted-foreground">Algo deu errado. Tente novamente.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Tentar novamente
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium">
            Início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0b0b0f" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      // Barra de status opaca: o conteúdo começa abaixo do relógio/bateria no iPhone instalado.
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
      { name: "apple-mobile-web-app-title", content: "Bex Print" },
      { title: "BEX PRINT OS" },
      { name: "description", content: "ERP de Gráfica, Comunicação Visual e Produção" },
      { property: "og:title", content: "BEX PRINT OS" },
      { name: "twitter:title", content: "BEX PRINT OS" },
      { property: "og:description", content: "ERP de Gráfica, Comunicação Visual e Produção" },
      { name: "twitter:description", content: "ERP de Gráfica, Comunicação Visual e Produção" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/364d017d-fa85-467d-8559-3c62ce5818c2/id-preview-2e273d89--ac34095e-c679-402e-90c7-5e6cc505cfc3.lovable.app-1780249271256.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/364d017d-fa85-467d-8559-3c62ce5818c2/id-preview-2e273d89--ac34095e-c679-402e-90c7-5e6cc505cfc3.lovable.app-1780249271256.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const temaInicial = `(function(){try{var t=localStorage.getItem('bexprint:tema');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d?'#050506':'#F7F9FC'}catch(e){document.documentElement.classList.add('dark')}})()`;
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: temaInicial }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthInvalidator() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    // Só a TROCA de pessoa (entrar, sair, outra conta) recarrega tudo. A
    // biblioteca de login avisa "SIGNED_IN" a cada volta à aba e
    // "TOKEN_REFRESHED" a cada hora; recarregar a cada aviso fazia o painel
    // repetir todas as consultas — 59 chamadas ao banco por volta, medido em
    // 07/10/2026. Ver src/domain/acesso/sessao.ts.
    let dono: DonoDaSessao = undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      const atual = sessao?.user?.id ?? null;
      const trocou = trocouDeConta(dono, atual);
      dono = atual;
      if (!trocou) return;
      router.invalidate();
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Vite avisa quando um chunk de hash antigo falha ao carregar (deploy novo com
  // HTML velho na tela). Recarregar a página traz o HTML novo com os chunks certos.
  useEffect(() => {
    // Com a mesma trava da tela de erro: antes este caminho recarregava sem
    // limite, e um arquivo que seguisse falhando (deploy no meio da
    // propagação, rede instável) deixava a aba presa recarregando. Sem
    // recarregar, o erro segue para a tela de erro, que tem o botão.
    const aoFalharChunk = (e: Event) => {
      if (recarregarUmaVez()) e.preventDefault();
    };
    window.addEventListener("vite:preloadError", aoFalharChunk);
    return () => window.removeEventListener("vite:preloadError", aoFalharChunk);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      {/* provider único das dicas: cada tela só usa Tooltip, sem repetir o provider */}
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <AuthProvider>
          <AuthInvalidator />
          <Outlet />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>

  );
}
