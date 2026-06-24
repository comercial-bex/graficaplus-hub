import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { getRoutePermission, permissionLabels } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading, hasPermission } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const requiredPermission = getRoutePermission(pathname);
  const canAccessRoute = requiredPermission !== null && hasPermission(requiredPermission);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b bg-card px-4 sticky top-0 z-10">
            <SidebarTrigger />
            <div className="flex-1" />
          </header>
          <main className="flex-1 p-6 overflow-auto">
            {canAccessRoute ? (
              <Outlet />
            ) : (
              <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">Acesso restrito</h1>
                <p className="text-muted-foreground">
                  Seu perfil precisa da permissão para {requiredPermission ? permissionLabels[requiredPermission] : "uma permissão configurada"} para
                  acessar esta rota.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
