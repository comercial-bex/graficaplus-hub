import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Check, Minus } from "lucide-react";
import { permissions, rolePermissions, type Permission } from "@/lib/permissions";
import type { AppRole } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/matriz-permissoes")({
  head: () => ({
    meta: [
      { title: "Matriz de permissões — BEX PRINT OS" },
      {
        name: "description",
        content: "Quais ações cada perfil pode executar em cada módulo do ERP da Bex Print.",
      },
      { property: "og:title", content: "Matriz de permissões — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Visão perfil × permissão por módulo, lida direto da matriz do banco.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MatrizPermissoesPage,
});

const ROLES: AppRole[] = [
  "admin",
  "gestor",
  "financeiro",
  "vendedor",
  "designer",
  "operador",
  "estoque",
  "instalador",
  "cliente",
];

const moduloLabels: Record<string, string> = {
  leads: "Leads",
  clientes: "Clientes",
  whatsapp: "WhatsApp",
  automacoes: "Automações",
  templates: "Templates",
  orcamentos: "Orçamentos",
  desconto: "Descontos",
  margem: "Margem",
  impressao3d: "Impressão 3D",
  os: "Ordens de Serviço",
  financeiro: "Financeiro",
  pagamentos: "Pagamentos",
  custos: "Custos",
  resultado: "Resultado",
  usuarios: "Usuários",
  permissoes: "Permissões",
  logs: "Logs",
  configuracoes: "Configurações",
};

function MatrizPermissoesPage() {
  const [busca, setBusca] = useState("");

  const { data: dbMatrix, isLoading } = useQuery({
    queryKey: ["role-permission-matrix"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permission_matrix" as never)
        .select("role, permission");
      if (error || !data) return null;
      const matrix: Record<string, Set<string>> = {};
      for (const row of data as unknown as { role: string; permission: string }[]) {
        (matrix[row.role] ??= new Set()).add(row.permission);
      }
      return matrix;
    },
  });

  const fonte = dbMatrix && Object.keys(dbMatrix).length > 0 ? "banco" : "catálogo local";

  const can = (role: AppRole, permission: Permission) => {
    if (dbMatrix && Object.keys(dbMatrix).length > 0) return dbMatrix[role]?.has(permission) ?? false;
    return (rolePermissions[role] as readonly Permission[]).includes(permission);
  };

  const grupos = useMemo(() => {
    const filtro = busca.trim().toLowerCase();
    const map = new Map<string, Permission[]>();
    for (const p of permissions) {
      const modulo = p.split(".")[0];
      const label = moduloLabels[modulo] ?? modulo;
      if (filtro && !p.toLowerCase().includes(filtro) && !label.toLowerCase().includes(filtro))
        continue;
      const list = map.get(label) ?? [];
      list.push(p);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [busca]);

  const totais = ROLES.map((r) => permissions.filter((p) => can(r, p)).length);

  return (
    <div>
      <SectionHeader
        breadcrumb="Administração"
        title="Matriz de permissões por perfil"
        description={`Cada linha é uma ação; cada coluna é um perfil. Fonte de verdade: ${fonte}.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar por módulo ou ação (ex.: pagamentos, os.close)"
          className="max-w-sm"
        />
        {isLoading && <span className="text-sm text-muted-foreground">Carregando matriz...</span>}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  Ação
                </th>
                {ROLES.map((r, i) => (
                  <th
                    key={r}
                    className="px-2 py-3 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {r}
                    <div className="mt-0.5 text-[9px] text-muted-foreground/60">{totais[i]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map(([modulo, perms]) => (
                <Fragment key={modulo}>
                  <tr className="bg-muted/40">
                    <td
                      colSpan={ROLES.length + 1}
                      className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--bex-cyan)]"
                    >
                      {modulo}
                    </td>
                  </tr>
                  {perms.map((p) => (
                    <tr key={p} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p}</td>
                      {ROLES.map((r) => (
                        <td key={r} className="px-2 py-2 text-center">
                          {can(r, p) ? (
                            <Check className="mx-auto h-4 w-4 text-[color:var(--bex-lime)]" />
                          ) : (
                            <Minus className="mx-auto h-3.5 w-3.5 text-muted-foreground/30" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {grupos.length === 0 && (
                <tr>
                  <td
                    colSpan={ROLES.length + 1}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    Nenhuma ação encontrada para "{busca}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
