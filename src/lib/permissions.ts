import type { AppRole } from "@/lib/auth-context";

export const permissions = [
  "agenda.operate", "agenda.read", "agenda.reschedule", "agenda.schedule",
  "arquivos.approve", "arquivos.delete", "arquivos.finalize", "arquivos.read", "arquivos.register_approval", "arquivos.request_approval", "arquivos.upload", "arquivos.version",
  "automacoes.manage", "automacoes.read",
  "clientes.create", "clientes.delete", "clientes.read", "clientes.sensitive.read", "clientes.update",
  "compras.cancel", "compras.create", "compras.read", "compras.receive",
  "configuracoes.manage",
  "custos.create", "custos.read", "custos.update",
  "desconto.approve", "desconto.request",
  "entregas.manage", "entregas.read",
  "estoque.adjust", "estoque.cost.read", "estoque.entry", "estoque.exit", "estoque.inventory", "estoque.read", "estoque.reserve", "estoque.reverse",
  "financeiro.read", "financeiro.sensitive.read",
  "impressao3d.close", "impressao3d.cost.manage", "impressao3d.cost.read", "impressao3d.production.update", "impressao3d.quote.approve", "impressao3d.quote.create", "impressao3d.quote.update", "impressao3d.read", "impressao3d.reports.read", "impressao3d.settings.manage",
  "instalacao.update",
  "instalacoes.manage", "instalacoes.read",
  "kanban.move", "kanban.read",
  "leads.assign", "leads.convert", "leads.create", "leads.delete", "leads.read", "leads.update",
  "logs.read",
  "manutencao.manage", "manutencao.read",
  "maquinas.manage", "maquinas.read",
  "margem.read",
  "orcamentos.approve", "orcamentos.cancel", "orcamentos.convert", "orcamentos.create", "orcamentos.read", "orcamentos.send", "orcamentos.update",
  "os.assign", "os.close", "os.create", "os.read", "os.status.advance", "os.status.override", "os.update",
  "pagamentos.confirm", "pagamentos.create", "pagamentos.reverse", "pagamentos.update",
  "parceiro.painel", "parceiros.manage", "parceiros.read",
  "permissoes.manage",
  "portal.read",
  "precos.read",
  "producao.finish", "producao.pause", "producao.read", "producao.start",
  "qualidade.manage", "qualidade.read",
  "resultado.read",
  "retrabalho.manage", "retrabalho.read",
  "tarefas.assign", "tarefas.complete", "tarefas.create", "tarefas.read", "tarefas.reopen", "tarefas.update",
  "templates.manage",
  "usuarios.manage", "usuarios.read",
  "whatsapp.assign", "whatsapp.manage", "whatsapp.read", "whatsapp.reply", "whatsapp.transfer",
] as const;

export type Permission = (typeof permissions)[number];

const allPermissions = [...permissions];

/**
 * Fallback de permissões por perfil.
 *
 * NÃO é a fonte de verdade: `auth-context` lê `role_permission_matrix` do banco,
 * e a tela de Matriz de Permissões deixa o admin ligar e desligar permissão em
 * tempo de execução. Esta lista só entra quando a matriz não carrega — rede
 * ruim, sessão nova, primeiro render.
 *
 * Por isso ela é um RETRATO, não um espelho: vai divergir do banco assim que
 * alguém mudar uma permissão pela tela, e isso é esperado. O que não pode
 * acontecer é o retrato ficar anos atrasado, como estava: o fallback concedia
 * 29 permissões ao gestor enquanto o banco concedia 39, e as telas que exibiam
 * essa contagem mentiam no momento de dar acesso a alguém.
 *
 * Sincronizado com o banco em 05/09/2026.
 */
export const rolePermissions = {
  admin: allPermissions,
  gestor: ["arquivos.approve", "clientes.create", "clientes.read", "clientes.sensitive.read", "clientes.update", "compras.cancel", "compras.create", "compras.read", "compras.receive", "custos.read", "estoque.cost.read", "financeiro.read", "instalacao.update", "kanban.move", "leads.assign", "leads.convert", "leads.create", "leads.read", "leads.update", "logs.read", "maquinas.read", "orcamentos.approve", "orcamentos.convert", "orcamentos.create", "orcamentos.read", "orcamentos.send", "orcamentos.update", "os.read", "os.status.advance", "parceiros.manage", "parceiros.read", "producao.read", "qualidade.manage", "qualidade.read", "resultado.read", "tarefas.assign", "tarefas.complete", "tarefas.create", "tarefas.read", "tarefas.reopen", "tarefas.update", "precos.read"],
  financeiro: ["clientes.read", "compras.read", "custos.read", "financeiro.read", "financeiro.sensitive.read", "impressao3d.cost.read", "impressao3d.read", "impressao3d.reports.read", "orcamentos.read", "os.read", "pagamentos.confirm", "pagamentos.create", "pagamentos.reverse", "pagamentos.update", "resultado.read", "precos.read"],
  vendedor: ["clientes.create", "clientes.read", "clientes.update", "impressao3d.quote.create", "impressao3d.quote.update", "impressao3d.read", "leads.assign", "leads.convert", "leads.create", "leads.read", "leads.update", "orcamentos.create", "orcamentos.read", "orcamentos.send", "orcamentos.update", "os.read", "parceiros.read", "whatsapp.read", "whatsapp.reply", "precos.read"],
  designer: ["arquivos.finalize", "arquivos.read", "arquivos.request_approval", "arquivos.upload", "arquivos.version", "clientes.read", "os.read", "os.status.advance", "os.update", "tarefas.complete", "tarefas.read", "tarefas.update"],
  operador: ["agenda.operate", "agenda.read", "arquivos.read", "impressao3d.production.update", "impressao3d.read", "maquinas.read", "os.read", "os.status.advance", "os.update", "producao.finish", "producao.pause", "producao.read", "producao.start", "qualidade.manage", "qualidade.read", "tarefas.complete", "tarefas.read", "tarefas.update"],
  estoque: ["compras.create", "compras.read", "compras.receive", "custos.read", "estoque.adjust", "estoque.cost.read", "estoque.entry", "estoque.exit", "estoque.inventory", "estoque.read", "estoque.reserve", "estoque.reverse", "os.read", "tarefas.complete", "tarefas.read", "tarefas.update"],
  instalador: ["arquivos.read", "clientes.read", "entregas.manage", "entregas.read", "instalacoes.manage", "instalacoes.read", "os.read", "os.status.advance", "tarefas.complete", "tarefas.read", "tarefas.update"],
  cliente: ["portal.read"],
  // O painel do parceiro fica FORA do layout da equipe (/parceiro). Esta chave não
  // abre nenhuma rota de /_authenticated — o teste de papéis garante isso.
  parceiro: ["parceiro.painel"],
} satisfies Record<AppRole, readonly Permission[]>;

export const permissionLabels = Object.fromEntries(
  permissions.map((permission) => [permission, permission.replaceAll(".", " › ")]),
) as Record<Permission, string>;

// Uma rota abre com QUALQUER uma das permissões listadas. A lista de cada rota
// espelha o que o RLS exige das tabelas que a tela lê — antes daqui até o banco
// havia três listas divergentes (esta, o campo `permission` de cada item do menu
// e as policies), e o efeito prático era tela que abre e vem vazia, ou botão que
// aparece e o backend recusa. O menu agora deriva desta mesma tabela.
export const routePermissions: { path: string; permissions: readonly Permission[] }[] = [
  { path: "/dashboard", permissions: ["os.read"] },
  { path: "/clientes", permissions: ["clientes.read"] },
  { path: "/funil", permissions: ["leads.read"] },
  { path: "/leads", permissions: ["leads.read"] },
  { path: "/whatsapp-monitor", permissions: ["whatsapp.read", "whatsapp.manage"] },
  { path: "/whatsapp", permissions: ["whatsapp.read"] },
  { path: "/respostas-rapidas", permissions: ["templates.manage"] },
  { path: "/automacoes", permissions: ["automacoes.read"] },
  { path: "/orcamentos", permissions: ["orcamentos.read", "orcamentos.create"] },
  { path: "/parceiros", permissions: ["parceiros.read"] },
  { path: "/impressao-3d", permissions: ["impressao3d.read"] },
  { path: "/produtividade-3d", permissions: ["impressao3d.reports.read", "impressao3d.read"] },
  { path: "/breakdown-3d", permissions: ["impressao3d.cost.read", "impressao3d.reports.read"] },
  { path: "/producao-3d", permissions: ["impressao3d.production.update", "impressao3d.read"] },
  { path: "/orcamento-3d-novo", permissions: ["impressao3d.quote.create"] },
  { path: "/orcamento-3d", permissions: ["impressao3d.read"] },
  { path: "/filamentos-3d", permissions: ["impressao3d.settings.manage"] },
  { path: "/impressoras-3d", permissions: ["impressao3d.settings.manage"] },
  { path: "/configuracoes-3d", permissions: ["impressao3d.settings.manage"] },
  { path: "/os", permissions: ["os.read"] },
  { path: "/kanban", permissions: ["os.status.advance", "kanban.move"] },
  { path: "/financeiro", permissions: ["financeiro.read"] },
  { path: "/materiais", permissions: ["custos.read", "estoque.read"] },
  { path: "/movimentacoes", permissions: ["estoque.read", "estoque.cost.read"] },
  { path: "/compras", permissions: ["compras.read"] },
  { path: "/entregas", permissions: ["entregas.read", "instalacoes.read", "instalacao.update", "os.read"] },
  { path: "/arquivos", permissions: ["arquivos.read", "arquivos.approve"] },
  { path: "/maquinas-agenda", permissions: ["agenda.read", "os.read"] },
  { path: "/maquinas", permissions: ["maquinas.read", "os.read"] },
  // Capacidade lê `maquinas` (horas produtivas, custo/hora) e as reservas da OS.
  // O custo por hora já vem nulo da RPC para quem não é financeiro, então a
  // permissão de leitura de máquina basta para abrir a tela.
  { path: "/capacidade", permissions: ["maquinas.read", "os.read"] },
  // Onde o trabalho para é o histórico de status da OS: quem lê OS lê isso.
  { path: "/onde-para", permissions: ["os.read"] },
  // Conflitos de agenda lê `maquinas_agenda` e `maquinas` — as mesmas duas
  // tabelas de /maquinas-agenda, por isso carrega agenda.read junto.
  { path: "/conflitos-agenda", permissions: ["agenda.read", "maquinas.read", "os.read"] },
  { path: "/perdas", permissions: ["os.read"] },
  { path: "/planilha-custos", permissions: ["custos.read"] },
  { path: "/precificacao", permissions: ["custos.read"] },
  { path: "/custos-producao", permissions: ["custos.read"] },
  // Contas a receber chama `contas_a_receber()`, que exige can_see_financials —
  // e no front canSeeFinancials É hasPermission("financeiro.read"). Pedir a
  // mesma permissão aqui faz o guarda e a RPC concordarem: quem entra, carrega.
  // Dar baixa pede `pagamentos.confirm`, que é do financeiro e do admin; o
  // gestor entra, acompanha a cobrança e não vê o botão de baixa.
  { path: "/a-receber", permissions: ["financeiro.read"] },
  { path: "/contas-bancarias", permissions: ["financeiro.read"] },
  { path: "/fluxo-caixa", permissions: ["financeiro.read"] },
  { path: "/compromissos", permissions: ["financeiro.read"] },
  { path: "/avisos", permissions: ["os.read", "orcamentos.read"] },
  { path: "/manutencao", permissions: ["manutencao.read", "os.read"] },
  { path: "/design", permissions: ["arquivos.read", "arquivos.approve"] },
  { path: "/produtos", permissions: ["custos.read"] },
  { path: "/aprovacoes", permissions: ["orcamentos.read", "arquivos.approve"] },
  { path: "/metragem", permissions: ["orcamentos.read", "os.read"] },
  // "/metragem" ANTES de "/meta": o casamento é exato ou por "/meta/", então
  // hoje não há conflito — mas a ordem deixa a regra escrita caso o find()
  // volte a ser um startsWith solto, como já foi.
  // O vendedor entra com precos.read e vê só o ranking de produto; o bloco do
  // ponto de equilíbrio se esconde sozinho sem canSeeFinancials.
  { path: "/meta", permissions: ["precos.read", "financeiro.read"] },
  { path: "/ocorrencias", permissions: ["os.read"] },
  { path: "/relatorios", permissions: ["resultado.read"] },
  { path: "/portal-cliente", permissions: ["portal.read", "clientes.read"] },
  { path: "/pos-venda", permissions: ["os.read", "orcamentos.read"] },
  { path: "/logs", permissions: ["logs.read"] },
  { path: "/usuarios", permissions: ["usuarios.read"] },
  { path: "/matriz-permissoes", permissions: ["usuarios.read"] },
  { path: "/casos-de-uso", permissions: ["os.read"] },
  { path: "/mapa-sistema", permissions: ["os.read"] },
  // Mais específico antes do genérico: getRoutePermissions usa find() e casa por
  // prefixo, então "/configuracoes-empresa" precisa ser avaliado antes de
  // "/configuracoes" para não depender do detalhe da barra no startsWith.
  { path: "/configuracoes-empresa", permissions: ["configuracoes.manage"] },
  { path: "/configuracoes", permissions: ["configuracoes.manage"] },
];

export function hasPermission(roles: AppRole[], permission: Permission) {
  return roles.some((role) => (rolePermissions[role] as readonly Permission[] | undefined)?.includes(permission));
}

export function getRoutePermissions(pathname: string): readonly Permission[] | null {
  const normalized = pathname.replace(/^\/_authenticated/, "") || "/dashboard";
  return (
    routePermissions.find(({ path }) => normalized === path || normalized.startsWith(`${path}/`))?.permissions ?? null
  );
}
