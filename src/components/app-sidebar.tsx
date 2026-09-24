import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Home,
  X,
  Download,
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
  Wrench,
  Calendar,
  ListChecks,
  Bot,
  History,
  UserPlus,
  Boxes,
  Calculator,
  ShoppingCart,
  Cuboid,
  Gauge,
  ShieldCheck,
  Workflow,
  Network,
  TrendingDown,
  BellRing,
  Repeat,
  Wallet,
  Landmark,
  type LucideIcon,
  FileCheck2,
  Ruler,
  Handshake,
  Activity,
  Hourglass,
  CalendarClock,
  Target,
  ReceiptText,
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
import { getRoutePermissions } from "@/lib/permissions";
import type { Permission } from "@/lib/permissions";
import { dicaMenu } from "@/lib/dicas";
import { Dica } from "@/components/bex/Dica";

type Item = { title: string; url: string; icon: LucideIcon };

const groups: { label: string; gate?: "financial" | "admin"; items: Item[] }[] = [
  {
    label: "Operação",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Quadro de produção", url: "/kanban", icon: Kanban },
      { title: "Ordens de Serviço", url: "/os", icon: ClipboardList },
    ],
  },
  {
    label: "Comercial",
    items: [
      { title: "Clientes", url: "/clientes", icon: Users },
      { title: "Parceiros", url: "/parceiros", icon: Handshake },
      { title: "Leads", url: "/leads", icon: UserPlus },
      { title: "Funil", url: "/funil", icon: Workflow },
      { title: "Orçamentos", url: "/orcamentos", icon: FileText },
      { title: "Aprovações", url: "/aprovacoes", icon: FileCheck2 },
      { title: "Metragem por cliente", url: "/metragem", icon: Ruler },
      { title: "Meta do mês", url: "/meta", icon: Target },
      { title: "Impressão 3D", url: "/impressao-3d", icon: Cuboid },
      { title: "Produtividade 3D", url: "/produtividade-3d", icon: Gauge },
      { title: "Custo por peça 3D", url: "/breakdown-3d", icon: Calculator },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { title: "Avisos ao cliente", url: "/avisos", icon: BellRing },
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
      // As três leituras da agenda ficam logo abaixo dela: quanto cabe,
      // onde emperra e o que já está errado no que foi reservado.
      { title: "Capacidade da oficina", url: "/capacidade", icon: Activity },
      { title: "Onde o trabalho para", url: "/onde-para", icon: Hourglass },
      { title: "Conflitos de agenda", url: "/conflitos-agenda", icon: CalendarClock },
      { title: "Manutenção", url: "/manutencao", icon: Wrench },
      { title: "Entregas & Instalações", url: "/entregas", icon: Truck },
      { title: "Perdas & desperdício", url: "/perdas", icon: TrendingDown },
      { title: "Ocorrências", url: "/ocorrencias", icon: AlertTriangle },
    ],
  },
  {
    label: "Catálogo & Estoque",
    items: [
      { title: "Produtos", url: "/produtos", icon: Package },
      { title: "Materiais", url: "/materiais", icon: Boxes },
      { title: "Compras", url: "/compras", icon: ShoppingCart },
      { title: "Planilha de custos", url: "/planilha-custos", icon: Calculator },
      { title: "Custos de mão de obra", url: "/custos-producao", icon: Users },
      { title: "Movimentações", url: "/movimentacoes", icon: History },
    ],
  },
  {
    label: "Financeiro",
    gate: "financial",
    items: [
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
      // Logo abaixo do Financeiro: é a leitura de cobrança que a gráfica abre
      // todo dia — quem deve, quanto venceu e onde se dá baixa.
      { title: "Contas a receber", url: "/a-receber", icon: ReceiptText },
      { title: "Fluxo de caixa", url: "/fluxo-caixa", icon: Wallet },
      { title: "Contas bancárias", url: "/contas-bancarias", icon: Landmark },
      { title: "Compromissos", url: "/compromissos", icon: Repeat },
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

// Atalhos fixos do celular: as três telas que a oficina e o balcão abrem o dia
// inteiro. Passam pelo mesmo filtro de permissão dos itens do menu.
const atalhosCelular: Item[] = [
  { title: "Início", url: "/dashboard", icon: Home },
  { title: "OS", url: "/os", icon: ClipboardList },
  { title: "Quadro", url: "/kanban", icon: Kanban },
];

/** Verdadeiro quando o app já roda instalado (ícone na tela inicial). Só no cliente. */
function estaInstalado(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone)
  );
}

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, canSeeFinancials, hasRole, hasPermission, signOut } = useAuth();
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");

  // No celular o menu é um Sheet por cima da tela: sem fechar ao escolher,
  // a navegação acontece atrás do painel e parece que o toque não funcionou.
  const fecharNoCelular = () => {
    if (isMobile) setOpenMobile(false);
  };

  // A permissão de cada item vem do mapa de rotas, não de um campo próprio:
  // enquanto eram duas listas, o menu mostrava link que o guarda barrava
  // (e escondia link que o guarda deixava passar). Item sem rota mapeada
  // fica oculto porque o guarda é deny-by-default e ele abriria em erro.
  const podeVer = (url: string) => {
    const exigidas = getRoutePermissions(url);
    return exigidas !== null && exigidas.some(hasPermission);
  };

  // Começa escondido para o SSR não decidir por um `window` que não existe;
  // no cliente a gente confere e mostra o item se ainda não está instalado.
  const [mostrarInstalar, setMostrarInstalar] = useState(false);
  useEffect(() => {
    setMostrarInstalar(!estaInstalado());
  }, []);

  const atalhosVisiveis = atalhosCelular.filter((a) => podeVer(a.url));

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
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-lg font-bold tracking-tight text-white">
                Bex <span className="text-[color:var(--bex-cyan)]">Print</span>
              </div>
            </div>
          )}
          {/* O X do Sheet fica escondido pelo componente base; sem este botão a única
              saída no celular é acertar a faixa estreita do overlay. */}
          {isMobile && (
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setOpenMobile(false)}
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {atalhosVisiveis.length > 0 && (
          <nav aria-label="Atalhos" className="flex gap-1.5 px-2 pb-2 md:hidden">
            {atalhosVisiveis.map((atalho) => (
              <Link
                key={atalho.url}
                to={atalho.url}
                onClick={fecharNoCelular}
                data-active={isActive(atalho.url)}
                className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border border-sidebar-border text-[11px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:border-[color:var(--bex-cyan)] data-[active=true]:bg-[color:var(--bex-cyan)]/10 data-[active=true]:text-[color:var(--bex-cyan)]"
              >
                <atalho.icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{atalho.title}</span>
              </Link>
            ))}
          </nav>
        )}
      </SidebarHeader>

      <SidebarContent className="py-2">
        {groups.map((group) => {
          if (group.gate === "financial" && !canSeeFinancials) return null;
          if (group.gate === "admin" && !hasRole("admin")) return null;
          const visibleItems = group.items.filter((item) => podeVer(item.url));
          if (visibleItems.length === 0) return null;
          return (
            <SidebarGroup key={group.label} className="mb-4">
              <SidebarGroupLabel className="px-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground md:text-[10px]">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {visibleItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <Dica texto={dicaMenu(item.url)} lado="right" className="w-full">
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.url)}
                          size={isMobile ? "lg" : "default"}
                          tooltip={collapsed ? item.title : undefined}
                          className="w-full rounded-md border-l-2 border-transparent text-sm font-medium data-[active=true]:border-l-[color:var(--bex-cyan)] data-[active=true]:bg-[color:var(--bex-cyan)]/5 data-[active=true]:text-[color:var(--bex-cyan)]"
                        >
                          <Link to={item.url} onClick={fecharNoCelular}>
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
          {mostrarInstalar && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:h-8"
              onClick={() => {
                // Quem escuta é src/components/pwa/instalar-app.tsx; fecha o menu
                // para o pedido de instalação não aparecer atrás do painel.
                window.dispatchEvent(new CustomEvent("bexprint:instalar"));
                fecharNoCelular();
              }}
            >
              <Download className="h-4 w-4" />
              {!collapsed && <span className="ml-2">Instalar no celular</span>}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:h-8"
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
