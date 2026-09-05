/**
 * Textos de ajuda do sistema, em um lugar só.
 *
 * Cada tela tem: `menu` (frase curta que aparece ao passar o mouse no menu
 * lateral), `tela` (explicação ao lado do título), `campos` (dicas de
 * formulário) e `acoes` (o que cada botão faz — e por que às vezes está
 * bloqueado). Mantendo tudo aqui, mudar uma frase muda em todo o sistema.
 */

export type DicasTela = {
  menu: string;
  tela: string;
  campos?: Record<string, string>;
  acoes?: Record<string, string>;
};

export const dicas = {
  "/contas-bancarias": {
    menu: "Saldo real das contas e importação do extrato do banco.",
    tela: "Cadastre as contas da gráfica e envie o extrato (OFX do banco ou planilha CSV). Cada lançamento novo entra no caixa e atualiza o saldo real; lançamentos já importados são ignorados, então pode reenviar o mesmo arquivo sem duplicar nada.",
  },
  "/dashboard": {
    menu: "Visão geral do dia: vendas, produção e o que precisa de atenção.",
    tela: "Resumo do negócio em números reais do sistema. Os cartões mudam conforme os orçamentos, as ordens de serviço e os pagamentos registrados.",
  },
  "/kanban": {
    menu: "Arraste as ordens de serviço entre as etapas da produção.",
    tela: "Quadro da produção. Arraste o cartão para mudar a etapa da ordem de serviço — cada mudança fica registrada no histórico. Cartões em vermelho estão com o prazo estourado.",
    acoes: {
      filtros: "Mostra só as ordens que interessam agora: por cliente, responsável, etapa ou prazo.",
    },
  },
  "/os": {
    menu: "Lista de todas as ordens de serviço, com etapa e prazo.",
    tela: "Todas as ordens de serviço da gráfica. Clique em uma linha para abrir o detalhe, apontar produção, baixar material e fechar o trabalho.",
    acoes: {
      nova: "Cria uma ordem de serviço do zero, sem passar por orçamento.",
    },
  },
  "/clientes": {
    menu: "Cadastro de clientes, contatos e histórico de compras.",
    tela: "Base de clientes. Um cliente cadastrado é o que permite converter orçamento em ordem de serviço, emitir documentos e acompanhar o histórico de compras.",
    campos: {
      tipo: "Pessoa física usa CPF; pessoa jurídica usa CNPJ e razão social.",
      documento: "CPF ou CNPJ. Com o CNPJ, o sistema tenta preencher endereço e razão social sozinho.",
      whatsapp: "Número usado para enviar orçamento, arte e aviso de entrega. Com DDD.",
      logo: "Logotipo do cliente. Aparece no cadastro e ajuda a identificar a arte na produção.",
      vendedor: "Quem responde por esse cliente. Usado nas metas e nos relatórios de vendas.",
    },
    acoes: {
      novo: "Abre o cadastro de um novo cliente.",
      excluir: "Remove o cliente. Não é possível quando já existem orçamentos ou ordens de serviço ligados a ele.",
    },
  },
  "/leads": {
    menu: "Contatos interessados que ainda não viraram cliente.",
    tela: "Funil de primeiros contatos. Registre a origem, acompanhe a conversa e converta em cliente quando o negócio avançar.",
    acoes: {
      converter: "Transforma o contato em cliente cadastrado, aproveitando nome, telefone e e-mail.",
    },
  },
  "/orcamentos": {
    menu: "Propostas para o cliente e conversão em ordem de serviço.",
    tela: "Todas as propostas comerciais. Monte os itens, envie ao cliente e, quando ele aprovar, converta em ordem de serviço com um clique.",
    campos: {
      cliente: "Cliente cadastrado. Sem cadastro dá para orçar, mas não dá para converter em ordem de serviço.",
      contato: "Nome de quem pediu o orçamento, para contatos que ainda não estão na base.",
      titulo: "Nome curto do trabalho, como o cliente reconhece: 'Fachada loja Centro'.",
      valor: "Valor total da proposta. Ao lançar itens, ele é recalculado automaticamente.",
      data_inicio: "Quando a produção começa, se o cliente aprovar.",
      prazo: "Data prometida de entrega. Alimenta o prazo da ordem de serviço e os alertas de atraso.",
    },
    acoes: {
      converter: "Cria a ordem de serviço a partir desta proposta. Exige um cliente cadastrado.",
      pdf: "Gera o orçamento impresso com dados da empresa, do cliente, medidas e valores.",
      producao: "Mesma impressão, sem valores — a via que vai para a oficina.",
      link: "Copia o endereço em que o cliente vê o orçamento e aprova pela internet.",
      whatsapp: "Abre a conversa no WhatsApp já com a mensagem e o link prontos.",
      artes: "Anexa as artes do item. A marcada com estrela é a que sai no PDF e no link do cliente.",
    },
  },
  "/impressao-3d": {
    menu: "Orçamentos e trabalhos de impressão 3D.",
    tela: "Lista dos orçamentos de impressão 3D. O cálculo usa as tarifas reais de filamento, energia e mão de obra cadastradas no sistema.",
    acoes: {
      novo: "Abre a calculadora de orçamento 3D, com peso, tempo e acabamento.",
    },
  },
  "/orcamento-3d-novo": {
    menu: "Calculadora de orçamento de impressão 3D.",
    tela: "Monte o orçamento 3D peça por peça. Preencha peso, tempo e acabamento; o sistema aplica filamento, energia, mão de obra e margem para chegar ao preço.",
  },
  "/orcamento-3d": {
    menu: "Detalhe do orçamento de impressão 3D.",
    tela: "Detalhe do orçamento 3D: peças, custos abertos e preço final. Aprovado, ele vira ordem de serviço com os trabalhos de impressão já criados.",
  },
  "/filamentos-3d": {
    menu: "Cadastro de filamentos, preços e rendimento.",
    tela: "Filamentos disponíveis com preço por quilo e perda estimada. É daqui que sai o custo de material dos orçamentos 3D.",
  },
  "/impressoras-3d": {
    menu: "Cadastro das impressoras 3D e seus custos por hora.",
    tela: "Impressoras 3D com consumo de energia, valor do equipamento e custo por hora. Esses números entram direto no preço de cada peça.",
  },
  "/configuracoes-3d": {
    menu: "Tarifas e margens usadas nos orçamentos 3D.",
    tela: "Parâmetros de precificação da impressão 3D: energia, mão de obra, perda e margem. Mudar aqui muda todos os próximos orçamentos.",
  },
  "/whatsapp": {
    menu: "Conversas com clientes pelo WhatsApp.",
    tela: "Central de atendimento. Responda o cliente, envie arquivos e ligue a conversa a um orçamento ou ordem de serviço.",
  },
  "/whatsapp-monitor": {
    menu: "Acompanhamento das mensagens ligadas a cada trabalho.",
    tela: "Mostra as mensagens trocadas por ordem de serviço, para saber o que foi combinado com o cliente sem sair do sistema.",
  },
  "/respostas-rapidas": {
    menu: "Mensagens prontas para agilizar o atendimento.",
    tela: "Textos padrão que a equipe usa no WhatsApp. Bom para orçamento enviado, arte aprovada e aviso de entrega.",
  },
  "/automacoes": {
    menu: "Avisos automáticos disparados por eventos do sistema.",
    tela: "Regras que avisam sozinhas: pagamento atrasado, estoque no mínimo, ordem de serviço concluída. Cada regra tem um gatilho e uma mensagem.",
  },
  "/design": {
    menu: "Artes em criação e aprovação do cliente.",
    tela: "Fila do design. Acompanhe o que está em criação, o que aguarda aprovação do cliente e o que voltou para ajuste.",
  },
  "/arquivos": {
    menu: "Todos os arquivos e artes enviados.",
    tela: "Arquivos do sistema: artes, briefings e comprovantes. Cada arquivo fica ligado ao cliente e ao trabalho de origem.",
  },
  "/maquinas": {
    menu: "Equipamentos da gráfica e custo por hora.",
    tela: "Parque de máquinas com velocidade e custo por hora. Esses valores entram no custo de produção de cada trabalho.",
    campos: {
      custo_hora: "Quanto custa manter a máquina ligada por uma hora, somando energia, manutenção e depreciação.",
      velocidade: "Produção média por hora. Usada para estimar o tempo de cada trabalho.",
    },
  },
  "/maquinas-agenda": {
    menu: "Reserva de horários das máquinas.",
    tela: "Agenda dos equipamentos. Evita duas ordens disputando a mesma máquina no mesmo horário.",
  },
  "/manutencao": {
    menu: "Manutenções preventivas e corretivas das máquinas.",
    tela: "Controle de manutenção: o que já foi feito, o que está previsto e quanto custou parar o equipamento.",
  },
  "/entregas": {
    menu: "Entregas e instalações agendadas.",
    tela: "Agenda de entrega e instalação. Registre data, responsável e a confirmação de quem recebeu.",
  },
  "/perdas": {
    menu: "Registro de desperdício de material na produção.",
    tela: "Perdas de produção por refile, erro de arte ou falha de impressão. É o que mostra quanto de material está indo para o lixo e em qual etapa.",
    campos: {
      motivo: "Por que o material foi perdido. Serve para atacar a causa que mais desperdiça.",
      quantidade: "Quanto de material foi perdido, na mesma unidade do estoque.",
    },
  },
  "/ocorrencias": {
    menu: "Problemas registrados durante os trabalhos.",
    tela: "Registro de problemas: atraso, retrabalho, reclamação. Ajuda a entender o que mais trava a produção.",
  },
  "/produtos": {
    menu: "Catálogo de produtos e serviços com preço.",
    tela: "Catálogo que abastece os orçamentos. Cada produto guarda unidade, custo médio e margem, e pode ter uma receita de materiais.",
    campos: {
      sku: "Código curto do produto, usado para achar rápido no orçamento.",
      unidade: "Como o produto é vendido: metro quadrado, unidade, hora.",
      custo: "Quanto custa produzir uma unidade. Base do cálculo de margem.",
      margem: "Percentual de lucro sobre o custo. O preço sugerido sai daqui.",
      materiais: "Materiais consumidos por unidade. É o que permite baixar o estoque automaticamente.",
    },
  },
  "/precificacao": {
    menu: "Planilha de custos e tarifas da gráfica.",
    tela: "Tarifas que o sistema usa em todos os cálculos: energia, hora de mão de obra, encargos, markup, perda e impostos. Alterar aqui muda os próximos orçamentos, não os antigos.",
    campos: {
      valor: "Valor atual da tarifa. Toda alteração fica registrada no histórico com data e autor.",
      markup: "Multiplicador aplicado sobre o custo para chegar ao preço de venda.",
      perda: "Percentual de material perdido que já entra no preço, para não sair no prejuízo.",
    },
  },
  "/materiais": {
    menu: "Estoque de materiais, com saldo e custo unitário.",
    tela: "Materiais em estoque com saldo, custo unitário e ponto de reposição. O saldo cai sozinho quando a produção baixa material.",
    campos: {
      estoque_minimo: "Quando o saldo chega nesse número, o sistema avisa para comprar.",
      custo_unitario: "Quanto custa uma unidade do material. Base do custo de cada trabalho.",
    },
  },
  "/custos-producao": {
    menu: "Valor da hora de cada função da equipe.",
    tela: "Custo de mão de obra por função. É o valor por hora que entra no custo dos trabalhos e dos orçamentos.",
  },
  "/movimentacoes": {
    menu: "Entradas e saídas de material do estoque.",
    tela: "Histórico de estoque: tudo que entrou, saiu ou foi ajustado, com data, responsável e trabalho de origem.",
    campos: {
      tipo: "Entrada soma ao saldo, saída subtrai e ajuste corrige uma contagem errada.",
      quantidade: "Quantidade movimentada, na unidade do material.",
    },
  },
  "/financeiro": {
    menu: "Contas a receber, a pagar e pagamentos.",
    tela: "Controle do dinheiro: o que já entrou, o que está pendente e o que venceu. Confirmar um pagamento lança no caixa e só sai de lá por estorno.",
    acoes: {
      registrar: "Lança um pagamento recebido e abate do saldo pendente.",
      estornar: "Desfaz um pagamento confirmado, deixando o registro do estorno.",
    },
  },
  "/fluxo-caixa": {
    menu: "Saldo das contas e movimento de caixa.",
    tela: "Caixa e contas bancárias. Mostra o saldo real das contas e o previsto com base no que ainda vai entrar e sair.",
    campos: {
      saldo_inicial: "Saldo da conta na data em que você começou a usar o sistema. Serve de ponto de partida.",
      conta: "A qual conta bancária o lançamento pertence.",
    },
    acoes: {
      importar: "Lê o extrato do banco e traz os lançamentos, sem repetir o que já foi importado.",
    },
  },
  "/relatorios": {
    menu: "Relatórios de vendas, produção e resultado.",
    tela: "Relatórios do período: vendas, produção, margem e desperdício. Use os filtros de data para comparar meses.",
  },
  "/portal-cliente": {
    menu: "O que o cliente vê e envia pelo link externo.",
    tela: "Acessos que o cliente recebe por link: aprovar arte, acompanhar o trabalho e enviar arquivos, sem entrar no sistema.",
  },
  "/pos-venda": {
    menu: "Pesquisa de satisfação e retorno do cliente.",
    tela: "Pós-venda: pesquisa de satisfação, garantias e oportunidades de nova venda depois da entrega.",
  },
  "/producao-3d": {
    menu: "Fila de impressão 3D e apontamento das peças.",
    tela: "Trabalhos de impressão 3D em andamento. Aponte início, fim e falhas para fechar o custo real de cada peça.",
  },
  "/usuarios": {
    menu: "Cadastro da equipe e níveis de acesso.",
    tela: "Pessoas com acesso ao sistema. O perfil define o que cada uma enxerga e pode fazer.",
    campos: {
      perfil: "Define o acesso: administrador vê tudo; vendedor vê comercial; operador vê produção.",
      email: "É o login da pessoa. A senha inicial é enviada para esse endereço.",
    },
    acoes: {
      novo: "Cria o acesso de uma nova pessoa e gera a senha inicial.",
      excluir: "Remove o acesso. Você não pode excluir a si mesmo.",
    },
  },
  "/matriz-permissoes": {
    menu: "O que cada perfil pode ver e fazer.",
    tela: "Tabela de permissões por perfil. Use para conferir o que um vendedor, um operador ou o financeiro consegue acessar.",
  },
  "/casos-de-uso": {
    menu: "Passo a passo das rotinas do dia a dia.",
    tela: "Roteiros das rotinas mais comuns, do primeiro contato à entrega, mostrando qual tela usar em cada passo.",
  },
  "/mapa-sistema": {
    menu: "Como as telas e os dados se conectam.",
    tela: "Mapa das ligações entre cadastros, orçamentos, produção, estoque e financeiro. Bom para entender o efeito de cada mudança.",
  },
  "/logs": {
    menu: "Histórico de quem fez o quê no sistema.",
    tela: "Auditoria: registro de alterações importantes, com autor, data e o que mudou.",
  },
  "/configuracoes-empresa": {
    menu: "Dados da empresa usados nos documentos.",
    tela: "Nome, CNPJ, endereço, telefones e logotipo que aparecem no orçamento e na ordem de serviço impressos.",
  },
  "/configuracoes": {
    menu: "Preferências gerais do sistema.",
    tela: "Ajustes gerais de funcionamento do sistema e das integrações.",
  },
} satisfies Record<string, DicasTela>;

export type RotaComDica = keyof typeof dicas;

/** Dica do menu para uma rota, quando existir. */
export function dicaMenu(rota: string): string | undefined {
  return (dicas as Record<string, DicasTela>)[rota]?.menu;
}

/** Dica do título da tela, quando existir. */
export function dicaTela(rota: string): string | undefined {
  return (dicas as Record<string, DicasTela>)[rota]?.tela;
}

/**
 * Normaliza o rótulo para casar com a chave da dica.
 *
 * As telas passam o texto do rótulo como está na interface ("Custo unitário
 * (R$) *"), então tiramos acento, asterisco, unidade entre parênteses e
 * espaços. Assim a mesma dica serve para variações de escrita do mesmo campo.
 */
function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[*:]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function buscar(
  mapa: Record<string, string> | undefined,
  termo: string,
): string | undefined {
  if (!mapa) return undefined;
  const alvo = chave(termo);
  if (mapa[alvo]) return mapa[alvo];
  for (const [k, v] of Object.entries(mapa)) if (chave(k) === alvo) return v;
  return undefined;
}

/** Dica de um campo específico de uma tela. */
export function dicaCampo(rota: string, campo: string): string | undefined {
  return buscar((dicas as Record<string, DicasTela>)[rota]?.campos, campo);
}

/** Dica de uma ação (botão) de uma tela. */
export function dicaAcao(rota: string, acao: string): string | undefined {
  return buscar((dicas as Record<string, DicasTela>)[rota]?.acoes, acao);
}

