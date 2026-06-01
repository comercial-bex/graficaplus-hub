import type { AppRole } from "@/lib/auth-context";

export const permissions = [
  "clientes.read",
  "orcamentos.create",
  "financeiro.read",
  "custos.read",
  "kanban.move",
  "arquivos.approve",
  "estoque.cost.read",
  "instalacao.update",
] as const;

export type Permission = (typeof permissions)[number];

export const rolePermissions = {
  admin: [...permissions],
  gestor: [...permissions],
  financeiro: [
    "clientes.read",
    "orcamentos.create",
    "financeiro.read",
    "custos.read",
    "estoque.cost.read",
  ],
  vendedor: ["clientes.read", "orcamentos.create"],
  designer: ["clientes.read", "kanban.move", "arquivos.approve"],
  operador: ["clientes.read", "kanban.move"],
  estoque: ["clientes.read", "estoque.cost.read"],
  instalador: ["clientes.read", "instalacao.update"],
  cliente: [],
} satisfies Record<AppRole, readonly Permission[]>;

export const permissionLabels = {
  "clientes.read": "visualizar clientes",
  "orcamentos.create": "criar orçamentos",
  "financeiro.read": "visualizar financeiro",
  "custos.read": "visualizar custos",
  "kanban.move": "movimentar Kanban",
  "arquivos.approve": "aprovar arquivos",
  "estoque.cost.read": "visualizar custos de estoque",
  "instalacao.update": "atualizar instalações",
} satisfies Record<Permission, string>;

export const routePermissions: { path: string; permission: Permission }[] = [
  { path: "/clientes", permission: "clientes.read" },
  { path: "/orcamentos", permission: "orcamentos.create" },
  { path: "/financeiro", permission: "financeiro.read" },
  { path: "/precificacao", permission: "custos.read" },
  { path: "/kanban", permission: "kanban.move" },
  { path: "/arquivos", permission: "arquivos.approve" },
  { path: "/materiais", permission: "estoque.cost.read" },
  { path: "/movimentacoes", permission: "estoque.cost.read" },
  { path: "/entregas", permission: "instalacao.update" },
];

export function hasPermission(roles: AppRole[], permission: Permission) {
  return roles.some((role) => (rolePermissions[role] as readonly Permission[] | undefined)?.includes(permission));
}

export function getRoutePermission(pathname: string) {
  return routePermissions.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`))
    ?.permission;
}
