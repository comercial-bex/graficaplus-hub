/**
 * Quem resolve cada pendência, e o caminho literal para resolver.
 *
 * A função `pendencias_do_sistema()` devolve o número vivo, a severidade e o
 * rótulo de quem resolve. Aqui fica o que é de tela: o passo a passo, menu a
 * menu, sem status cru — e o mapa entre o papel de quem está logado e os
 * rótulos que ele atende.
 *
 * Organograma real da gráfica (20/09/2026), que define esse mapa:
 *
 *   atendimento  recepção — recebe o arquivo, monta o orçamento e manda para
 *                a produção. É o `vendedor`; o gerente também atende.
 *   producao     impressão + acabamento + entrega, na mesma pessoa (impressor
 *                e auxiliar). É o `operador`.
 *   gestao       gerente de vendas E produção, a mesma pessoa. É quem confirma
 *                a baixa de material — decisão de 20/09: o impressor aponta a
 *                produção, o gerente dá a baixa.
 *   financeiro   financeiro/administrativo, a mesma pessoa.
 *   admin        o CEO vê tudo.
 */

export type PapelResolvedor = 'atendimento' | 'producao' | 'gestao' | 'financeiro';

export const ROTULO_PAPEL: Record<PapelResolvedor, string> = {
  atendimento: 'Atendimento',
  producao: 'Impressão/Acabamento',
  gestao: 'Gerência',
  financeiro: 'Financeiro',
};

/** Papéis do sistema que atendem cada rótulo. */
export const PAPEIS_DO_ROTULO: Record<PapelResolvedor, string[]> = {
  atendimento: ['vendedor', 'gestor', 'admin'],
  producao: ['operador', 'admin'],
  gestao: ['gestor', 'admin'],
  financeiro: ['financeiro', 'admin'],
};

/**
 * Os rótulos que este papel atende. Leitura inversa de `PAPEIS_DO_ROTULO`.
 *
 * Aceita a lista de papéis porque uma pessoa da gráfica acumula função — o
 * gerente é de vendas E produção, o financeiro é financeiro E administrativo.
 */
export function rotulosDoPapel(papeis: readonly string[] | null | undefined): PapelResolvedor[] {
  if (!papeis || papeis.length === 0) return [];
  return (Object.keys(PAPEIS_DO_ROTULO) as PapelResolvedor[]).filter((rotulo) =>
    PAPEIS_DO_ROTULO[rotulo].some((papel) => papeis.includes(papel)),
  );
}

export interface GuiaPendencia {
  /** Caminho literal, 2 a 4 passos. */
  passos: string[];
  /** Rótulo do botão que leva ao destino. */
  acao?: string;
}

export const GUIA_PENDENCIAS: Record<string, GuiaPendencia> = {
  os_prazo_vencido: {
    acao: 'Abrir o quadro',
    passos: [
      'Abra o Quadro de produção e ache a OS com o prazo vencido.',
      'Fale com o cliente e combine um novo prazo (ou explique o atraso).',
      'Atualize o prazo na OS e leve o cartão para a próxima etapa: o cliente é avisado sozinho.',
    ],
  },
  arte_aprovada_sem_aceite: {
    acao: 'Abrir as OS',
    passos: [
      'Abra a OS marcada como "arte aprovada".',
      'Na aba Arquivos, anexe o arquivo fechado e marque como final de produção.',
      'Gere o link de aprovação e envie ao cliente; registre o aceite quando ele responder.',
      'Só então mova para a fila de produção.',
    ],
  },
  catalogo_cotacao_sem_atendimento: {
    acao: 'Ver pedidos do catálogo',
    passos: [
      'Abra Catálogos e entre em Pedidos.',
      'Veja os itens que o cliente escolheu e fale com ele no WhatsApp.',
      'Marque o pedido como atendido para sair desta lista.',
    ],
  },
  parceiro_sem_atendente: {
    acao: 'Abrir Parceiros',
    passos: [
      'Abra Parceiros e veja "parceiros novos sem atendente".',
      'Toque em "Assumir" no parceiro.',
      'Chame no WhatsApp, apresente a tabela e o orçamento com a marca dele.',
    ],
  },
  apontamento_aberto_esquecido: {
    acao: 'Abrir as OS',
    passos: [
      'Abra a OS que está rodando na máquina e vá ao apontamento aberto.',
      'Finalize o apontamento com a quantidade produzida.',
      'Se a peça já saiu, mova a OS para a etapa seguinte.',
    ],
  },
  parcela_sem_vencimento: {
    acao: 'Abrir Contas a receber',
    passos: [
      'Abra Contas a receber e filtre as parcelas em aberto.',
      'Defina a data de vencimento de cada parcela sem data.',
      'Elas passam a entrar no cartão "Vencido" e no lembrete diário.',
    ],
  },
  pagamento_sem_parcela: {
    acao: 'Abrir Contas a receber',
    passos: [
      'Abra Financeiro › Contas a receber e procure a OS do pagamento (o aviso mostra quantos são).',
      'Confira se o pagamento não foi lançado duas vezes (mesmo valor e mesmo dia, em formas diferentes).',
      'Se for válido, ligue-o à parcela da conta; se for duplicado, estorne um dos dois.',
    ],
  },
  pagamento_acima_da_conta: {
    acao: 'Abrir Contas a receber',
    passos: [
      'Abra a OS que recebeu mais do que a conta e veja o extrato de pagamentos.',
      'Pagamento em dobro: estorne o repetido. Conta defasada (o valor da OS subiu): corrija a conta e a parcela.',
      'Só feche o caixa do mês depois disso: o "recebido" está acima do que a conta autoriza.',
    ],
  },
  os_paga_sem_producao: {
    acao: 'Abrir as OS em entrada',
    passos: [
      'Abra Produção › Ordens de serviço e filtre as que estão em "entrada".',
      'Nas que já têm pagamento, confira a arte e o material; se estiver tudo certo, avance a etapa.',
      'Se algo trava (arte, material, prazo), avise o cliente: ele já pagou e espera.',
    ],
  },
  os_sem_prazo: {
    acao: 'Abrir as OS sem prazo',
    passos: [
      'Abra a OS e defina a data de entrega combinada com o cliente.',
      'Sem prazo ela nunca aparece como atrasada, nem na TV, nem no aviso ao cliente.',
      'Na próxima conversão, preencha o prazo já no orçamento: a OS herda.',
    ],
  },
  os_sem_agenda: {
    acao: 'Abrir a agenda de máquinas',
    passos: [
      'Abra Produção › Agenda das máquinas e agende a OS na máquina do produto.',
      'Se a OS é só de arte ou de serviço sem máquina, ignore: o aviso some quando houver horário.',
      'Com a OS na agenda, a capacidade e o prazo prometido passam a ter base.',
    ],
  },
  orcamento_sem_item: {
    acao: 'Abrir orçamentos',
    passos: [
      'Abra Vendas › Orçamentos.',
      'Clique no orçamento sem valor.',
      'Use "Adicionar item" e escolha o produto — o preço vem da tabela e do cálculo por m².',
      'Salve: o valor total aparece e o botão de enviar ao cliente destrava.',
    ],
  },
  orcamento_parado: {
    acao: 'Ver orçamentos enviados',
    passos: [
      'Abra Vendas › Orçamentos e filtre por "enviado".',
      'Ligue ou mande mensagem para o contato do orçamento.',
      'Se o cliente desistiu, marque como rejeitado — orçamento parado polui a fila de todo mundo.',
    ],
  },
  orcamento_aprovado_sem_os: {
    acao: 'Abrir orçamentos',
    passos: [
      'Abra Vendas › Orçamentos e filtre por "aprovado".',
      'Abra o orçamento e use "Converter em OS".',
      'A OS já nasce com o material previsto, o estoque reservado, a conta a receber e a máquina agendada — por isso converter é o passo que solta tudo.',
      'Se o cliente desistiu depois de aprovar, marque como rejeitado em vez de deixar parado.',
    ],
  },
  os_pronta_sem_entrega_agendada: {
    acao: 'Abrir entregas',
    passos: [
      'Abra Produção › Entregas e instalações.',
      'A entrega costuma nascer sozinha quando a peça fica pronta; se não apareceu, use "Agendar".',
      'Confira o endereço e escolha quem vai levar.',
      'Ao voltar, registre a conclusão com foto ou assinatura — é o que fecha o serviço para o cliente.',
    ],
  },
  os_sem_item: {
    acao: 'Ver ordens de serviço',
    passos: [
      'A OS foi aberta e ninguém disse o que produzir.',
      'Abra a OS e acrescente os itens — sem item ela não tem valor, não prevê material, não gera conta a receber e não fecha.',
      'Se foi engano, cancele em vez de deixar parada: assim ela para de contar como trabalho aberto no painel.',
    ],
  },
  os_sem_material_reservado: {
    acao: 'Ver materiais',
    passos: [
      'A peça já foi prometida ao cliente e o material não está na prateleira.',
      'Abra a OS: o card de materiais previstos mostra o que falta, com quantidade e unidade.',
      'Dê entrada no estoque em Produção › Materiais e estoque, ou avise o cliente do novo prazo.',
      'Enquanto faltar, a OS não consegue dar baixa de material nem fechar — e a trava não diz o motivo em lugar nenhum além daqui.',
    ],
  },
  entrega_feita_os_aberta: {
    acao: 'Ver ordens de serviço',
    passos: [
      'A entrega já foi dada como concluída — o cliente recebeu.',
      'Abra a OS: ela tenta fechar sozinha quando a última entrega é baixada, e só não fechou porque alguma trava continua de pé.',
      'As travas são sempre estas: tarefa obrigatória em aberto, qualidade não aprovada, material sem baixa, custo operacional não lançado, ocorrência sem tratamento ou pagamento pendente.',
      'Enquanto a OS não fechar, o serviço não entra no faturado do mês nem aparece como concluído para o cliente.',
    ],
  },
  arte_aguardando_cliente: {
    acao: 'Ver ordens de serviço',
    passos: [
      'Abra Produção › Ordens de serviço e filtre por "aguardando aprovação de arte".',
      'Reenvie o link de aprovação pelo WhatsApp do cliente.',
      'Se ele aprovou por fora (telefone, presencial), registre a aprovação na OS com o canal correto.',
    ],
  },
  cliente_sem_contato: {
    acao: 'Abrir clientes',
    passos: [
      'Abra Vendas › Clientes.',
      'Procure quem está sem telefone e sem e-mail.',
      'Preencha ao menos o WhatsApp — é por onde saem orçamento, arte e aviso de entrega pronta.',
    ],
  },
  os_na_fila_de_producao: {
    acao: 'Abrir produção',
    passos: [
      'Abra Produção › Quadro de produção.',
      'Comece pela de menor prazo, não pela mais recente.',
      'Mova o cartão conforme avança: impressão, acabamento, pronto.',
    ],
  },
  os_pronta_para_sair: {
    acao: 'Ver ordens prontas',
    passos: [
      'Abra Produção › Ordens de serviço e filtre por "aguardando retirada" ou "aguardando entrega".',
      'Avise o cliente que está pronto.',
      'Ao sair, mude o status — enquanto não mudar, o trabalho conta como ocupando a gráfica.',
    ],
  },
  os_parada: {
    acao: 'Ver ordens paradas',
    passos: [
      'Abra Produção › Ordens de serviço.',
      'Veja o que trava cada uma: falta arte aprovada, falta material ou falta máquina livre.',
      'Se o trabalho morreu, cancele a OS — OS parada sem fim vira gargalo falso no painel.',
    ],
  },
  os_sem_material_previsto: {
    acao: 'Ver ordens sem material',
    passos: [
      'Abra a OS e veja se o produto dela tem ficha técnica.',
      'Se não tiver, cadastre a ficha em Financeiro › Produtos e serviços (aba Materiais).',
      'Com a ficha pronta, a OS passa a prever o material, reservar o estoque e fechar o custo real.',
    ],
  },
  os_sem_custo_previsto: {
    acao: 'Ver ordens sem custo',
    passos: [
      'Abra Produção › Ordens de serviço e entre na OS que a pendência cita.',
      'Se o item foi digitado sem produto, abra a aba Itens e ligue o item ao produto que ele é.',
      'Se o produto não tem custo, abra Financeiro › Produtos e serviços e preencha o custo (ou a ficha de materiais).',
      'Com o custo no produto, a margem da OS e o semáforo do reembolso passam a ter referência.',
    ],
  },
  reembolsos_para_a_gerencia: {
    acao: 'Decidir reembolsos',
    passos: [
      'Abra Financeiro › Reembolsos e veja a aba "Para decidir".',
      'Cada pedido mostra a foto do cupom e a margem da OS antes e depois da compra.',
      'Aprove ou recuse: prejuízo e recusa pedem o motivo. O aprovado entra na conta a pagar da sexta.',
    ],
  },
  reembolsos_para_o_financeiro: {
    acao: 'Aprovar reembolsos',
    passos: [
      'Abra Financeiro › Reembolsos e veja a aba "Para decidir".',
      'Confira a foto do cupom contra o valor e a OS pedidos.',
      'Aprove: o valor entra no custo da OS e na conta a pagar da sexta de quem pediu.',
    ],
  },
  baixa_de_estoque_pendente: {
    acao: 'Ver ordens concluídas',
    passos: [
      'Abra Produção › Ordens de serviço e filtre por concluídas.',
      'Confira com o impressor o que foi realmente consumido.',
      'Use "Dar baixa no estoque" na OS: o material sai da prateleira e entra no custo do trabalho.',
    ],
  },
  produto_sem_ficha: {
    acao: 'Abrir produtos',
    passos: [
      'Abra Financeiro › Produtos e serviços.',
      'Os que estão sem ficha têm a etiqueta "sem receita" na lista.',
      'Abra o produto, vá em Materiais e diga quanto de cada material entra por unidade de venda (por m², no caso de impressão).',
    ],
  },
  estoque_nunca_carregado: {
    acao: 'Abrir materiais',
    passos: [
      'Abra Produção › Materiais e estoque.',
      'Para cada material que já está na prateleira, use "Entrada / saída" e registre a quantidade real com o custo de compra.',
      'A partir da primeira entrada, a OS passa a reservar e baixar sozinha.',
    ],
  },
  estoque_abaixo_minimo: {
    acao: 'Abrir materiais',
    passos: [
      'Abra Produção › Materiais e estoque e veja os marcados como "Repor".',
      'Confira o fornecedor no cadastro do material.',
      'Registre a entrada assim que a compra chegar.',
    ],
  },
  material_sem_custo: {
    acao: 'Abrir materiais',
    passos: [
      'Abra Produção › Materiais e estoque.',
      'O material sem preço aparece com "sem custo" na coluna de custo unitário.',
      'Preencha o custo de compra: o custo dos produtos que usam esse material volta a ser calculado sozinho.',
    ],
  },
  os_entregue_sem_cobranca: {
    acao: 'Abrir financeiro',
    passos: [
      'Abra Financeiro › Contas a receber.',
      'Compare com as OS concluídas do período.',
      'Gere a cobrança a partir da OS, para a receita ficar ligada ao trabalho que a gerou.',
    ],
  },
  conta_pagar_vencida: {
    acao: 'Abrir contas a pagar',
    passos: [
      'Abra Financeiro › Caixa e contas a pagar, aba Contas a pagar, e ordene por vencimento.',
      'Pague ou renegocie o que está vencido.',
      'Se já foi paga, registre o pagamento — senão ela fica contando como atraso para sempre.',
    ],
  },
  // Reescrito em 24/09: a frase antiga dizia que não havia data de vencimento em
  // contas a receber, e por isso mandava conferir uma a uma. Hoje cada parcela
  // tem vencimento e a tela separa o que está atrasado — o passo velho fazia o
  // financeiro trabalhar no escuro por um defeito que já foi consertado.
  receber_em_aberto: {
    acao: 'Abrir contas a receber',
    passos: [
      'Abra Financeiro › Contas a receber.',
      'Comece pelas parcelas marcadas como atrasadas — o cartão "Vencido" é o total delas.',
      'Dê baixa no que já entrou e cobre o resto: conta em aberto sem cobrança vira prejuízo calado.',
    ],
  },
  parcela_vencida_sem_baixa: {
    acao: 'Abrir contas a receber',
    passos: [
      'Abra Financeiro › Contas a receber: o cartão "Vencido" é o que se cobra hoje.',
      'Confira com o caixa quem já pagou e use "Dar baixa" na parcela, com o meio e a data reais do recebimento.',
      'Quem não pagou, cobre pelo WhatsApp do cliente antes de o atraso crescer.',
      'Não mexa no status da conta: ela vira parcial e depois recebida sozinha quando a última parcela cai.',
    ],
  },
  comissoes_a_pagar: {
    acao: 'Abrir financeiro',
    passos: [
      'Abra Financeiro › Pagamentos e comissões e desça até o bloco de Comissões.',
      'Confira quem trouxe cada venda e o valor: a comissão nasce sozinha quando a OS é paga, sobre o bruto dela.',
      'Pague no fechamento e marque como paga — ela não gera lançamento em contas a pagar, então só sai da lista por aqui.',
    ],
  },
  produto_custo_provisorio: {
    acao: 'Abrir produtos',
    passos: [
      'Abra Financeiro › Produtos e serviços e procure os produtos com a etiqueta "Custo provisório".',
      'Abra cada um e troque o custo por m² e o preço de balcão pelos números reais.',
      'Ao salvar, o aviso some: a observação de provisório sai do produto.',
    ],
  },
  produto_sem_custo: {
    acao: 'Abrir produtos',
    passos: [
      'Abra Financeiro › Produtos e serviços e filtre pelos produtos sem custo.',
      'Preencha o custo do produto ou monte a ficha de materiais na aba Materiais.',
    ],
  },
  produto_sem_preco: {
    acao: 'Abrir produtos',
    passos: [
      'Abra Financeiro › Produtos e serviços e procure os produtos sem preço.',
      'Preencha o preço de balcão, as faixas de quantidade ou o preço de parceiro.',
    ],
  },
  acabamento_sem_preco: {
    acao: 'Abrir produtos',
    passos: [
      'Abra Financeiro › Produtos e serviços e entre em um produto que leva o acabamento.',
      'Na parte de acabamentos da ficha, preencha o preço de venda de cada um.',
    ],
  },
  material_sem_estoque_maximo: {
    acao: 'Abrir materiais',
    passos: [
      'Abra Produção › Materiais e estoque.',
      'Em cada rolo, preencha o estoque máximo (o estoque cheio).',
      'O estoque mínimo, que dispara o aviso de compra, passa a ser 15% desse valor.',
    ],
  },
};

/**
 * Pendências de custo e preço que, além de quem o rótulo atende, o gestor também precisa ver.
 * Quem não vê dinheiro nem recebe a linha: o banco só devolve estas para quem pode.
 */
export const VISIVEL_TAMBEM_PARA: Record<string, string[]> = {
  produto_custo_provisorio: ['gestor'],
  produto_sem_custo: ['gestor'],
  produto_sem_preco: ['gestor'],
  acabamento_sem_preco: ['gestor'],
};

export function guiaDe(chave: string): GuiaPendencia | undefined {
  return GUIA_PENDENCIAS[chave];
}
