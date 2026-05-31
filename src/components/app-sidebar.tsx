import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, FileText, ClipboardList, Kanban, FolderOpen,
  DollarSign, Settings, Shield, Printer, LogOut, MessageCircle, Palette,
  Factory, Package, Truck, AlertTriangle, BarChart3, Calculator, Wrench,
  Calendar, ListChecks, Bot, History, UserPlus, Boxes,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

type Item = { title: string; url: string; icon: any };

const groups: { label: string; gate?: "financial" | "admin"; items: Item[] }[] = [
  {
    label: "Operação",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Kanban Produção", url: "/kanban", icon: Kanban },
      { title: "Ordens de Serviço", url: "/os", icon: ClipboardList },
    ],
  },
  {
    label: "Comercial",
    items: [
      { title: "Clientes", url: "/clientes", icon: Users },
      { title: "Leads", url: "/leads", icon: UserPlus },
      { title: "Orçamentos", url: "/orcamentos", icon: FileText },
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
      { title: "Arquivos", url: "/arquivos", icon: FolderOpen },
      { title: "Máquinas", url: "/maquinas", icon: Factory },
      { title: "Agenda de máquinas", url: "/maquinas-agenda", icon: Calendar },
      { title: "Manutenção", url: "/manutencao", icon: Wrench },
      { title: "Entregas & Instalações", url: "/entregas", icon: Truck },
      { title: "Ocorrências", url: "/ocorrencias", icon: AlertTriangle },
    ],
  },
  {
    label: "Catálogo & Estoque",
    items: [
      { title: "Produtos", url: "/produtos", icon: Package },
      { title: "Precificação", url: "/precificacao", icon: Calculator, },
      { title: "Materiais", url: "/materiais", icon: Boxes },
      { title: "Movimentações", url: "/movimentacoes", icon: History },
    ],
  },
  {
    label: "Financeiro",
    gate: "financial",
    items: [
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
    ],
  },
  {
    label: "Análise",
    items: [
      { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
    ],
  },
  {
    label: "Administração",
    gate: "admin",
    items: [
      { title: "Usuários", url: "/usuarios", icon: Shield },
      { title: "Logs & Auditoria", url: "/logs", icon: History },
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, canSeeFinancials, hasRole, signOut } = useAuth();
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground shrink-0">
            <Printer className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-bold text-sidebar-foreground">BEX PRINT</div>
              <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">OS</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => {
          if (group.gate === "financial" && !canSeeFinancials) return null;
          if (group.gate === "admin" && !hasRole("admin")) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                        <Link to={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-2 space-y-2">
          {!collapsed && user && (
            <div className="text-xs text-sidebar-foreground/70 truncate">{user.email}</div>
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
