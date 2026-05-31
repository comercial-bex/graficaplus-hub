import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: () => {
    const { user, roles } = useAuth();
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
          <p className="text-muted-foreground">Seu perfil e preferências</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Perfil</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">E-mail:</span> {user?.email}</div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Perfis:</span>
              {roles.length === 0 ? <span>Sem papel atribuído</span> :
                roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  },
});
