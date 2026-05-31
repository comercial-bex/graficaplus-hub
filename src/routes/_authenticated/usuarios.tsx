import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { AppRole } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — BEX PRINT OS" }] }),
  component: UsuariosPage,
});

const ROLES: AppRole[] = ["admin","gestor","financeiro","vendedor","designer","operador","estoque","instalador","cliente"];

function UsuariosPage() {
  const qc = useQueryClient();
  const [novoRole, setNovoRole] = useState<Record<string, AppRole>>({});

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["usuarios-admin"],
    queryFn: async () => {
      const { data: usuarios } = await supabase.from("usuarios").select("*").order("nome");
      const { data: roles } = await supabase.from("user_roles").select("*");
      return (usuarios ?? []).map((u) => ({
        ...u,
        roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
      }));
    },
  });

  async function addRole(userId: string) {
    const role = novoRole[userId];
    if (!role) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) return toast.error(error.message);
    toast.success("Papel atribuído");
    qc.invalidateQueries({ queryKey: ["usuarios-admin"] });
  }

  async function removeRole(userId: string, role: string) {
    const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role as any);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["usuarios-admin"] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Usuários & Permissões</h1>
        <p className="text-muted-foreground">Atribua perfis para cada usuário</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Perfis</TableHead>
                <TableHead>Atribuir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {users.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && <span className="text-xs text-muted-foreground">Sem papel</span>}
                      {u.roles.map((r: string) => (
                        <Badge key={r} variant="secondary" className="cursor-pointer" onClick={() => removeRole(u.id, r)}>
                          {r} ×
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Select value={novoRole[u.id] ?? ""} onValueChange={(v: AppRole) => setNovoRole({ ...novoRole, [u.id]: v })}>
                        <SelectTrigger className="w-36"><SelectValue placeholder="Perfil" /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={() => addRole(u.id)}>+</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
