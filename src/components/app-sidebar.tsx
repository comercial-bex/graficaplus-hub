import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  ClipboardList,
  Kanban,
  FolderOpen,
  DollarSign,
  Settings,
  Shield,
  Printer,
  LogOut,
  MessageCircle,
  Palette,
  Factory,
  Package,
  Truck,
  AlertTriangle,
  BarChart3,
  Calculator,
  Wrench,
  Calendar,
  ListChecks,
  Bot,
  History,
  UserPlus,
  Boxes,
  Cuboid,
  ShieldCheck,
  Workflow,
  Network,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import type { Permission } from "@/lib/permissions";
import { dicaMenu } from "@/lib/dicas";
import { Dica } from "@/components/bex/Dica";

type Item = { title: string; url: string; icon: LucideIcon; permission?: Permission };

const groups: { label: string; gate?: "financial" | "admin"; items: Item[] }[] = [
  {
    label: "Operação",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Kanban Produção", url: "/kanban", icon: Kanban, permission: "os.status.advance" },
      { title: "Ordens de Serviço", url: "/os", icon: ClipboardList },
    ],
  },
  {
    label: "Comercial",
    items: [
      { title: "Clientes", url: "/clientes", icon: Users, permission: "clientes.read" },
      { title: "Leads", url: "/leads", icon: UserPlus },
      { title: "Orçamentos", url: "/orcamentos", icon: FileText, permission: "orcamentos.create" },
      { title: "Impressão 3D", url: "/impressao-3d", icon: Cuboid, permission: "impressao3d.read" },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
      { title: "Respostas rápidas", url: "/respostas-rapidas", icon: ListChecks },
      { title: "Automações", url: "/automacoes", icon: Bot },
    ],
  },
  {
    label: "Produção",
    items: [
      { title: "Design & Arte", url: "/design", icon: Palette },
      { title: "Arquivos", url: "/arquivos", icon: FolderOpen, permission: "os.update" },
      { title: "Máquinas", url: "/maquinas", icon: Factory },
      { title: "Agenda de máquinas", url: "/maquinas-agenda", icon: Calendar },
      { title: "Manutenção", url: "/manutencao", icon: Wrench },
      {
        title: "Entregas & Instalações",
        url: "/entregas",
        icon: Truck,
        permission: "os.status.advance",
      },
      { title: "Perdas & desperdício", url: "/perdas", icon: TrendingDown, permission: "os.update" },
      { title: "Ocorrências", url: "/ocorrencias", icon: AlertTriangle },
    ],
  },
  {
    label: "Catálogo & Estoque",
    items: [
      { title: "Produtos", url: "/produtos", icon: Package },
      { title: "Precificação", url: "/precificacao", icon: Calculator, permission: "custos.read" },
      { title: "Materiais", url: "/materiais", icon: Boxes, permission: "custos.read" },
      {
        title: "Custos de mão de obra",
        url: "/custos-producao",
        icon: Users,
        permission: "custos.read",
      },
      {
        title: "Movimentações",
        url: "/movimentacoes",
        icon: History,
        permission: "custos.read",
      },
    ],
  },
  {
    label: "Financeiro",
    gate: "financial",
    items: [
      { title: "Financeiro", url: "/financeiro", icon: DollarSign, permission: "financeiro.read" },
      { title: "Fluxo de caixa", url: "/fluxo-caixa", icon: Wallet, permission: "financeiro.read" },
    ],
  },
  {
    label: "Análise",
    items: [
      { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
      { title: "Portal do cliente", url: "/portal-cliente", icon: Users },
      { title: "Pós-venda / NPS", url: "/pos-venda", icon: ListChecks },
    ],
  },


  {
    label: "Administração",
    gate: "admin",
    items: [
      { title: "Usuários", url: "/usuarios", icon: Shield },
      { title: "Matriz de permissões", url: "/matriz-permissoes", icon: ShieldCheck },
      { title: "Casos de uso", url: "/casos-de-uso", icon: Workflow },
      { title: "Mapa do sistema", url: "/mapa-sistema", icon: Network },
      { title: "Logs & Auditoria", url: "/logs", icon: History },
      { title: "Dados da empresa", url: "/configuracoes-empresa", icon: Building2 },
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, canSeeFinancials, hasRole, hasPermission, signOut } = useAuth();
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 font-bold text-sm"
            style={{ background: "var(--gradient-cmyk)", color: "#050506" }}
          >
            B
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-lg font-bold tracking-tight text-white">
                Bex <span className="text-[color:var(--bex-cyan)]">Print</span>
              </div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-sidebar-foreground/50">
                Print OS · v4.2
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        {groups.map((group) => {
          if (group.gate === "financial" && !canSeeFinancials) return null;
          if (group.gate === "admin" && !hasRole("admin")) return null;
          const visibleItems = group.items.filter(
            (item) => !item.permission || hasPermission(item.permission),
          );
          if (visibleItems.length === 0) return null;
          return (
            <SidebarGroup key={group.label} className="mb-4">
              <SidebarGroupLabel className="px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {visibleItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <Dica
                        texto={dicaMenu(item.url)}
                        lado="right"
                        className="w-full"
                      >
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.url)}
                          tooltip={collapsed ? item.title : undefined}
                          className="w-full rounded-md border-l-2 border-transparent text-sm font-medium data-[active=true]:border-l-[color:var(--bex-cyan)] data-[active=true]:bg-[color:var(--bex-cyan)]/5 data-[active=true]:text-[color:var(--bex-cyan)]"
                        >
                          <Link to={item.url}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </Dica>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="space-y-2 px-2 py-2">
          {!collapsed && user && (
            <div className="flex items-center gap-3 rounded-lg bg-foreground/5 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--bex-magenta)] text-xs font-bold text-[color:var(--primary-foreground)]">
                {(user.email ?? "?").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-white">{user.email}</p>
                <p className="truncate text-[10px] text-muted-foreground">Usuário do sistema</p>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Sair</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

