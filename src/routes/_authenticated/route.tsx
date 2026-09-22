import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { InstalarApp } from "@/components/pwa/instalar-app";
import { getRoutePermissions, permissionLabels } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

// Nome da tela pelo 1º segmento da URL — no celular o cabeçalho é a única
// referência de "onde estou", já que o menu fica recolhido.
const NOMES_DE_TELA: Record<string, string> = {
  dashboard: "Início",
  os: "Ordens de serviço",
  kanban: "Quadro de produção",
  orcamentos: "Orçamentos",
  clientes: "Clientes",
  produtos: "Produtos",
  materiais: "Materiais",
  financeiro: "Financeiro",
  parceiros: "Parceiros",
  usuarios: "Usuários",
  relatorios: "Relatórios",
  maquinas: "Máquinas",
  whatsapp: "WhatsApp",
};

function nomeDaTela(pathname: string) {
  const segmento = pathname.split("/").filter(Boolean)[0] ?? "";
  if (!segmento) return "Início";
  return NOMES_DE_TELA[segmento] ?? segmento.charAt(0).toUpperCase() + segmento.slice(1);
}

function AuthenticatedLayout() {
  const { user, loading, hasPermission, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const noInicio = pathname === "/dashboard" || pathname === "/dashboard/";
  const requiredPermissions = getRoutePermissions(pathname);
  const canAccessRoute = requiredPermissions !== null && requiredPermissions.some(hasPermission);

  // O parceiro revendedor não usa o sistema da equipe: o painel dele mora em
  // /parceiro. Sem o desvio, o login o mandaria ao /dashboard e ele cairia no
  // "Acesso restrito" — a primeira tela de um parceiro novo seria um erro.
  const somenteParceiro = roles.length > 0 && roles.every((r) => r === "parceiro");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!loading && user && somenteParceiro) navigate({ to: "/parceiro" });
  }, [loading, user, somenteParceiro, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }
  if (!user || somenteParceiro) return null;

  // Quem acabou de se cadastrar entra sem papel nenhum. Sem este desvio, o guarda
  // deny-by-default responde "Acesso restrito" — conta criada com sucesso e uma
  // tela de erro na cara, que lê como defeito do sistema.
  if (roles.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <div className="h-1.5" style={{ background: "var(--gradient-cmyk)" }} />
        <div className="mx-auto max-w-lg px-6 py-20 text-center space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Aguardando liberação</h1>
          <p className="text-muted-foreground">
            Sua conta está criada e o acesso ainda não foi liberado. Um administrador precisa
            escolher o que você pode ver — avise a equipe se estiver demorando.
          </p>
          <p className="text-sm text-muted-foreground">
            Conectado como <span className="font-medium text-foreground">{user.email}</span>
          </p>
          <button
            type="button"
            onClick={() => signOut()}
            className="text-sm underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-2 md:gap-3 border-b border-border bg-card/60 backdrop-blur-xl px-2 md:px-4 sticky top-0 z-10 relative">
            {/* No celular o gatilho do menu é o alvo principal: 44px */}
            <SidebarTrigger className="h-11 w-11 md:h-7 md:w-7" />
            {!noInicio && (
              <button
                type="button"
                onClick={() => router.history.back()}
                aria-label="Voltar"
                className="md:hidden inline-flex h-11 items-center gap-0.5 rounded-md pl-1 pr-2 text-sm text-muted-foreground hover:bg-muted"
              >
                <ChevronLeft className="h-5 w-5" /> Voltar
              </button>
            )}
            <h1 className="md:hidden min-w-0 flex-1 truncate text-base font-semibold leading-tight">
              {nomeDaTela(pathname)}
            </h1>
            <div className="hidden md:flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--bex-lime)] animate-pulse" />
              Print OS Online
            </div>
            <div className="hidden md:block flex-1" />
            <div className="hidden sm:block font-mono text-[10px] uppercase tracking-wider text-muted-foreground truncate max-w-[200px]">
              {user.email}
            </div>
            {/* CMYK footer line */}
            <div
              className="absolute bottom-0 left-0 right-0 h-[2px]"
              style={{ background: "var(--gradient-cmyk)" }}
            />
          </header>
          {/* Celular: margem menor e sem o fundo de pontos (contraste em tela barata ao sol) */}
          <main className="flex-1 p-4 md:p-6 overflow-auto md:bex-grid">
            {canAccessRoute ? (
              <Outlet />
            ) : (
              <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">Acesso restrito</h1>
                <p className="text-muted-foreground">
                  Esta tela não é do seu papel. Se você precisa dela, fale com a gerência.
                </p>
                <Link
                  to="/dashboard"
                  className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto"
                >
                  Ir para o início
                </Link>
                {/* Slugs de permissão só para quem administra o mapa de rotas */}
                <details className="mt-2 w-full text-left text-sm text-muted-foreground">
                  <summary className="cursor-pointer text-center">Detalhes técnicos</summary>
                  <p className="mt-2">
                    {requiredPermissions
                      ? `Esta rota exige ${requiredPermissions.map((p) => permissionLabels[p]).join(" ou ")}.`
                      : "Esta rota não tem permissão configurada, então ninguém consegue abri-la. Cadastre-a no mapa de rotas."}
                  </p>
                </details>
              </div>
            )}
          </main>
        </div>
      </div>
      {/* Só no layout autenticado: rotas públicas do cliente ficam sem faixa e sem SW */}
      <InstalarApp />
    </SidebarProvider>
  );
}
