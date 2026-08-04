import type { Permission } from "@/lib/permissions";

export type EtapaFluxo = {
  id: string;
  etapa: string;
  descricao: string;
  rotas: { label: string; url: string }[];
  entidades: string[];
  validacoes: string[];
  transferencias: string[];
  perfis: string[];
  permissoes: Permission[];
};

/** Fluxo ponta a ponta: entrada → orçamento → OS → produção → entrega. */
export const casosDeUso: EtapaFluxo[] = [
  {
    id: "entrada",
    etapa: "Entrada",
    descricao:
      "Captação por WhatsApp, telefone ou indicação. O contato vira lead e é qualificado antes de virar cliente.",
    rotas: [
      { label: "WhatsApp", url: "/whatsapp" },
      { label: "Leads", url: "/leads" },
      { label: "Clientes", url: "/clientes" },
    ],
    entidades: ["whatsapp_conversas", "whatsapp_mensagens", "leads", "clientes"],
    validacoes: [
      "Telefone normalizado (E.164) antes de criar o lead",
      "Deduplicação por telefone/e-mail contra clientes existentes",
      "CPF/CNPJ validado apenas na conversão em cliente",
    ],
    transferencias: [
      "Webhook WhatsApp → whatsapp_conversas (fila de envio e logs)",
      "RPC converter_lead_em_cliente → cria cliente e opcionalmente o 1º orçamento",
    ],
    perfis: ["vendedor", "gestor", "admin"],
    permissoes: ["leads.read", "leads.convert", "clientes.create"],
  },
  {
    id: "orcamento",
    etapa: "Orçamento",
    descricao:
      "Orçamento 2D (lona, adesivo, chapas) ou 3D (motor de custo por filamento/energia/máquina). Pode ser feito sem cliente cadastrado, usando contato avulso.",
    rotas: [
      { label: "Orçamentos", url: "/orcamentos" },
      { label: "Novo orçamento 3D", url: "/orcamento-3d-novo" },
      { label: "Precificação", url: "/precificacao" },
    ],
    entidades: [
      "orcamentos",
      "orcamento_itens",
      "orcamento_versoes",
      "orcamentos_3d",
      "orcamento_3d_calculos",
      "produtos",
      "produto_precificacao",
    ],
    validacoes: [
      "Item precisa de quantidade > 0 e preço unitário definido",
      "Desconto acima do limite exige permissão desconto.approve",
      "Margem mínima checada contra produto_precificacao",
      "Cliente é opcional no orçamento, obrigatório na conversão em OS",
    ],
    transferencias: [
      "Trigger sync_orcamento_3d_para_funil → espelha orçamento 3D no funil geral",
      "RPC aprovar_orcamento → congela versão aprovada e gera evento de negócio",
      "Geração de PDF → bucket documentos-pdf + documentos_gerados",
    ],
    perfis: ["vendedor", "gestor", "financeiro", "admin"],
    permissoes: ["orcamentos.create", "orcamentos.send", "orcamentos.approve"],
  },
  {
    id: "os",
    etapa: "Ordem de Serviço",
    descricao:
      "Orçamento aprovado vira OS integral, com itens, materiais previstos, parcelas e responsáveis.",
    rotas: [
      { label: "Ordens de Serviço", url: "/os" },
      { label: "Financeiro", url: "/financeiro" },
    ],
    entidades: [
      "ordens_servico",
      "itens_os",
      "os_materiais_previstos",
      "parcelas_receber",
      "pagamentos",
    ],
    validacoes: [
      "Cliente obrigatório no momento da conversão",
      "Orçamento precisa estar aprovado e na versão vigente",
      "Parcelas somam exatamente o valor total da OS",
    ],
    transferencias: [
      "RPC converter_orcamento_em_os / converter_orcamento_3d_em_os",
      "Função gerar_materiais_previstos_os → explode receitas de produto_materiais",
      "Criação automática de parcelas_receber e contas_receber",
    ],
    perfis: ["vendedor", "gestor", "financeiro", "admin"],
    permissoes: ["orcamentos.convert", "os.create", "pagamentos.create"],
  },
  {
    id: "producao",
    etapa: "Produção",
    descricao:
      "Arte, fila de máquinas, apontamentos e baixa de estoque. Impressão 3D tem jobs e fechamentos próprios.",
    rotas: [
      { label: "Kanban Produção", url: "/kanban" },
      { label: "Design & Arte", url: "/design" },
      { label: "Agenda de máquinas", url: "/maquinas-agenda" },
      { label: "Produção 3D", url: "/producao-3d" },
      { label: "Movimentações", url: "/movimentacoes" },
    ],
    entidades: [
      "os_tarefas",
      "apontamentos_producao",
      "maquinas_agenda",
      "producao_3d_jobs",
      "producao_3d_apontamentos",
      "movimentacoes_estoque",
      "qualidade_inspecoes",
    ],
    validacoes: [
      "Baixa de estoque bloqueada se algum material ficar negativo",
      "Transição de status segue a máquina de estados; exceção exige os.status.override + motivo",
      "Arte precisa de aprovação registrada antes de liberar produção",
      "Checklist de qualidade obrigatório antes de 'pronto'",
    ],
    transferencias: [
      "RPC avancar_os_status / forcar_transicao_os → grava eventos_negocio e logs_auditoria",
      "RPC baixar_estoque_os → movimentacoes_estoque + custos reais da OS",
      "Automações → fila de WhatsApp para avisar o cliente a cada etapa",
    ],
    perfis: ["designer", "operador", "estoque", "gestor", "admin"],
    permissoes: ["os.status.advance", "os.update", "impressao3d.production.update"],
  },
  {
    id: "entrega",
    etapa: "Entrega & Pós-venda",
    descricao:
      "Expedição, instalação, quitação financeira, fechamento da OS com resultado e pesquisa de NPS.",
    rotas: [
      { label: "Entregas & Instalações", url: "/entregas" },
      { label: "Pós-venda / NPS", url: "/pos-venda" },
      { label: "Portal do cliente", url: "/portal-cliente" },
      { label: "Relatórios", url: "/relatorios" },
    ],
    entidades: [
      "entregas_instalacoes",
      "os_resultados",
      "os_resultado_snapshots",
      "pos_venda_pesquisas",
      "pos_venda_respostas",
      "documentos_gerados",
    ],
    validacoes: [
      "fechar_os retorna bloqueios quando há parcela em aberto, material não baixado ou tarefa pendente",
      "Comprovante de entrega/assinatura obrigatório para instalação",
      "Resultado só é congelado com custos reais lançados",
    ],
    transferencias: [
      "RPC fechar_os → snapshot de resultado + próximos passos de pós-venda",
      "Geração automática de pesquisa NPS na finalização",
      "Portal do cliente lê documentos_gerados com acesso isolado por usuário",
    ],
    perfis: ["instalador", "financeiro", "gestor", "admin"],
    permissoes: ["os.close", "pagamentos.confirm", "resultado.read"],
  },
];

/** Nós do mapa visual do sistema. */
export type MapaNode = {
  id: string;
  label: string;
  tipo: "modulo" | "entidade" | "integracao";
  camada: "entrada" | "comercial" | "operacao" | "producao" | "financeiro" | "posvenda";
  rota?: string;
};

export const mapaNodes: MapaNode[] = [
  { id: "whatsapp", label: "WhatsApp", tipo: "integracao", camada: "entrada", rota: "/whatsapp" },
  { id: "leads", label: "Leads", tipo: "modulo", camada: "entrada", rota: "/leads" },
  { id: "clientes", label: "Clientes", tipo: "modulo", camada: "comercial", rota: "/clientes" },
  { id: "orcamentos", label: "Orçamentos", tipo: "modulo", camada: "comercial", rota: "/orcamentos" },
  { id: "orcamentos3d", label: "Orçamento 3D", tipo: "modulo", camada: "comercial", rota: "/impressao-3d" },
  { id: "produtos", label: "Produtos & Receitas", tipo: "entidade", camada: "comercial", rota: "/produtos" },
  { id: "os", label: "Ordens de Serviço", tipo: "modulo", camada: "operacao", rota: "/os" },
  { id: "kanban", label: "Kanban Produção", tipo: "modulo", camada: "producao", rota: "/kanban" },
  { id: "maquinas", label: "Máquinas & Agenda", tipo: "modulo", camada: "producao", rota: "/maquinas-agenda" },
  { id: "producao3d", label: "Produção 3D", tipo: "modulo", camada: "producao", rota: "/producao-3d" },
  { id: "estoque", label: "Estoque & Materiais", tipo: "entidade", camada: "producao", rota: "/materiais" },
  { id: "entregas", label: "Entregas", tipo: "modulo", camada: "posvenda", rota: "/entregas" },
  { id: "financeiro", label: "Financeiro", tipo: "modulo", camada: "financeiro", rota: "/financeiro" },
  { id: "resultado", label: "Resultado da OS", tipo: "entidade", camada: "financeiro", rota: "/relatorios" },
  { id: "posvenda", label: "Pós-venda / NPS", tipo: "modulo", camada: "posvenda", rota: "/pos-venda" },
  { id: "portal", label: "Portal do cliente", tipo: "integracao", camada: "posvenda", rota: "/portal-cliente" },
];

export type MapaEdge = { from: string; to: string; label: string };

export const mapaEdges: MapaEdge[] = [
  { from: "whatsapp", to: "leads", label: "conversa vira lead" },
  { from: "leads", to: "clientes", label: "converter_lead_em_cliente" },
  { from: "clientes", to: "orcamentos", label: "orçamento vinculado (opcional)" },
  { from: "orcamentos3d", to: "orcamentos", label: "sync_orcamento_3d_para_funil" },
  { from: "produtos", to: "orcamentos", label: "preço e margem" },
  { from: "orcamentos", to: "os", label: "converter_orcamento_em_os" },
  { from: "os", to: "kanban", label: "avancar_os_status" },
  { from: "os", to: "financeiro", label: "parcelas_receber" },
  { from: "produtos", to: "estoque", label: "produto_materiais (receita)" },
  { from: "kanban", to: "estoque", label: "baixar_estoque_os" },
  { from: "kanban", to: "maquinas", label: "agenda e apontamentos" },
  { from: "orcamentos3d", to: "producao3d", label: "jobs de impressão" },
  { from: "producao3d", to: "os", label: "status de produção" },
  { from: "kanban", to: "entregas", label: "OS pronta" },
  { from: "entregas", to: "resultado", label: "fechar_os" },
  { from: "financeiro", to: "resultado", label: "custos × receita" },
  { from: "resultado", to: "posvenda", label: "pesquisa NPS" },
  { from: "os", to: "portal", label: "documentos e acompanhamento" },
];

export const perfisAtividades: { perfil: string; atividades: string[]; modulos: string[] }[] = [
  {
    perfil: "admin",
    atividades: ["Configura o sistema", "Gerencia usuários e permissões", "Audita logs"],
    modulos: ["Todos"],
  },
  {
    perfil: "gestor",
    atividades: ["Aprova orçamentos e descontos", "Distribui OS", "Acompanha margem"],
    modulos: ["Comercial", "Produção", "Relatórios"],
  },
  {
    perfil: "financeiro",
    atividades: ["Confirma e estorna pagamentos", "Fecha resultado da OS"],
    modulos: ["Financeiro", "Relatórios"],
  },
  {
    perfil: "vendedor",
    atividades: ["Atende WhatsApp", "Cria leads, clientes e orçamentos"],
    modulos: ["Atendimento", "Comercial"],
  },
  {
    perfil: "designer",
    atividades: ["Produz arte", "Envia para aprovação do cliente"],
    modulos: ["Design & Arte", "Arquivos"],
  },
  {
    perfil: "operador",
    atividades: ["Executa produção", "Registra apontamentos 2D e 3D"],
    modulos: ["Kanban", "Produção 3D", "Máquinas"],
  },
  {
    perfil: "estoque",
    atividades: ["Confere materiais previstos", "Faz baixa e inventário"],
    modulos: ["Materiais", "Movimentações"],
  },
  {
    perfil: "instalador",
    atividades: ["Entrega e instala", "Coleta comprovante"],
    modulos: ["Entregas"],
  },
  {
    perfil: "cliente",
    atividades: ["Acompanha OS", "Aprova arte", "Responde NPS"],
    modulos: ["Portal do cliente"],
  },
];
