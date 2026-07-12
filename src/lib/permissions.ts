import type { AppRole } from "@/lib/auth-context";

export const permissions = [
  "leads.read", "leads.create", "leads.update", "leads.assign", "leads.convert", "leads.delete",
  "clientes.read", "clientes.create", "clientes.update", "clientes.delete", "clientes.sensitive.read",
  "whatsapp.read", "whatsapp.reply", "whatsapp.assign", "whatsapp.transfer", "whatsapp.manage", "automacoes.read", "automacoes.manage", "templates.manage",
  "orcamentos.read", "orcamentos.create", "orcamentos.update", "orcamentos.send", "orcamentos.approve", "orcamentos.cancel", "orcamentos.convert", "desconto.request", "desconto.approve", "margem.read",
  "impressao3d.read", "impressao3d.quote.create", "impressao3d.quote.update", "impressao3d.quote.approve", "impressao3d.cost.read", "impressao3d.cost.manage", "impressao3d.production.update", "impressao3d.close", "impressao3d.settings.manage", "impressao3d.reports.read",
  "os.read", "os.create", "os.update", "os.assign", "os.status.advance", "os.status.override", "os.close",
  "financeiro.read", "financeiro.sensitive.read", "pagamentos.create", "pagamentos.update", "pagamentos.confirm", "pagamentos.reverse", "custos.read", "resultado.read",
  "usuarios.read", "usuarios.manage", "permissoes.manage", "logs.read", "configuracoes.manage",
] as const;

export type Permission = (typeof permissions)[number];

const allPermissions = [...permissions];

export const rolePermissions = {
  admin: allPermissions,
  gestor: ["leads.read", "leads.create", "leads.update", "leads.assign", "leads.convert", "clientes.read", "clientes.create", "clientes.update", "clientes.sensitive.read", "whatsapp.read", "whatsapp.reply", "whatsapp.assign", "whatsapp.transfer", "orcamentos.read", "orcamentos.create", "orcamentos.update", "orcamentos.send", "orcamentos.approve", "orcamentos.convert", "margem.read", "impressao3d.read", "impressao3d.quote.create", "impressao3d.quote.update", "impressao3d.quote.approve", "impressao3d.cost.read", "impressao3d.reports.read", "os.read", "os.create", "os.update", "os.assign", "os.status.advance", "financeiro.read", "logs.read"],
  financeiro: ["clientes.read", "orcamentos.read", "os.read", "financeiro.read", "financeiro.sensitive.read", "pagamentos.create", "pagamentos.update", "pagamentos.confirm", "pagamentos.reverse", "custos.read", "resultado.read", "impressao3d.read", "impressao3d.cost.read", "impressao3d.reports.read"],
  vendedor: ["leads.read", "leads.create", "leads.update", "leads.assign", "leads.convert", "clientes.read", "clientes.create", "clientes.update", "whatsapp.read", "whatsapp.reply", "orcamentos.read", "orcamentos.create", "orcamentos.update", "orcamentos.send", "impressao3d.read", "impressao3d.quote.create", "impressao3d.quote.update"],
  designer: ["clientes.read", "os.read", "os.update", "os.status.advance"],
  operador: ["os.read", "os.update", "os.status.advance", "impressao3d.read", "impressao3d.production.update"],
  estoque: ["os.read", "custos.read"],
  instalador: ["clientes.read", "os.read", "os.status.advance"],
  cliente: ["clientes.read"],
} satisfies Record<AppRole, readonly Permission[]>;

export const permissionLabels = Object.fromEntries(
  permissions.map((permission) => [permission, permission.replaceAll(".", " › ")]),
) as Record<Permission, string>;

export const routePermissions: { path: string; permission: Permission }[] = [
  { path: "/dashboard", permission: "os.read" },
  { path: "/clientes", permission: "clientes.read" },
  { path: "/leads", permission: "leads.read" },
  { path: "/whatsapp", permission: "whatsapp.read" },
  { path: "/respostas-rapidas", permission: "templates.manage" },
  { path: "/automacoes", permission: "automacoes.read" },
  { path: "/orcamentos", permission: "orcamentos.read" },
  { path: "/impressao-3d", permission: "impressao3d.read" },
  { path: "/orcamento-3d-novo", permission: "impressao3d.quote.create" },
  { path: "/filamentos-3d", permission: "impressao3d.settings.manage" },
  { path: "/impressoras-3d", permission: "impressao3d.settings.manage" },
  { path: "/os", permission: "os.read" },
  { path: "/kanban", permission: "os.status.advance" },
  { path: "/financeiro", permission: "financeiro.read" },
  { path: "/precificacao", permission: "custos.read" },
  { path: "/materiais", permission: "custos.read" },
  { path: "/movimentacoes", permission: "custos.read" },
  { path: "/entregas", permission: "os.status.advance" },
  { path: "/arquivos", permission: "os.update" },
  { path: "/maquinas", permission: "os.read" },
  { path: "/maquinas-agenda", permission: "os.read" },
  { path: "/manutencao", permission: "os.update" },
  { path: "/design", permission: "os.update" },
  { path: "/produtos", permission: "custos.read" },
  { path: "/ocorrencias", permission: "os.update" },
  { path: "/relatorios", permission: "resultado.read" },
  { path: "/logs", permission: "logs.read" },
  { path: "/usuarios", permission: "usuarios.read" },
  { path: "/configuracoes", permission: "configuracoes.manage" },
];

export function hasPermission(roles: AppRole[], permission: Permission) {
  return roles.some((role) => (rolePermissions[role] as readonly Permission[] | undefined)?.includes(permission));
}

export function getRoutePermission(pathname: string) {
  const normalized = pathname.replace(/^\/_authenticated/, "") || "/dashboard";
  return routePermissions.find(({ path }) => normalized === path || normalized.startsWith(`${path}/`))?.permission ?? null;
}
