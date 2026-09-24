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
  orcamento_sem_item: {
    acao: 'Abrir orçamentos',
    passos: [
      'Abra Comercial › Orçamentos.',
      'Clique no orçamento sem valor.',
      'Use "Adicionar item" e escolha o produto — o preço vem da tabela e do cálculo por m².',
      'Salve: o valor total aparece e o botão de enviar ao cliente destrava.',
    ],
  },
  orcamento_parado: {
    acao: 'Ver orçamentos enviados',
    passos: [
      'Abra Comercial › Orçamentos e filtre por "enviado".',
      'Ligue ou mande mensagem para o contato do orçamento.',
      'Se o cliente desistiu, marque como rejeitado — orçamento parado polui a fila de todo mundo.',
    ],
  },
  orcamento_aprovado_sem_os: {
    acao: 'Abrir orçamentos',
    passos: [
      'Abra Comercial › Orçamentos e filtre por "aprovado".',
      'Abra o orçamento e use "Converter em OS".',
      'A OS já nasce com o material previsto, o estoque reservado, a conta a receber e a máquina agendada — por isso converter é o passo que solta tudo.',
      'Se o cliente desistiu depois de aprovar, marque como rejeitado em vez de deixar parado.',
    ],
  },
  os_pronta_sem_entrega_agendada: {
    acao: 'Abrir entregas',
    passos: [
      'Abra Produção › Entregas & Instalações.',
      'A entrega costuma nascer sozinha quando a peça fica pronta; se não apareceu, use "Agendar".',
      'Confira o endereço e escolha quem vai levar.',
      'Ao voltar, registre a conclusão com foto ou assinatura — é o que fecha o serviço para o cliente.',
    ],
  },
  arte_aguardando_cliente: {
    acao: 'Ver ordens de serviço',
    passos: [
      'Abra Produção › Ordens de Serviço e filtre por "aguardando aprovação de arte".',
      'Reenvie o link de aprovação pelo WhatsApp do cliente.',
      'Se ele aprovou por fora (telefone, presencial), registre a aprovação na OS com o canal correto.',
    ],
  },
  cliente_sem_contato: {
    acao: 'Abrir clientes',
    passos: [
      'Abra Cadastros › Clientes.',
      'Procure quem está sem telefone e sem e-mail.',
      'Preencha ao menos o WhatsApp — é por onde saem orçamento, arte e aviso de entrega pronta.',
    ],
  },
  os_na_fila_de_producao: {
    acao: 'Abrir produção',
    passos: [
      'Abra Produção › Painel de Produção.',
      'Comece pela de menor prazo, não pela mais recente.',
      'Mova o cartão conforme avança: impressão, acabamento, pronto.',
    ],
  },
  os_pronta_para_sair: {
    acao: 'Ver ordens prontas',
    passos: [
      'Abra Produção › Ordens de Serviço e filtre por "aguardando retirada" ou "aguardando entrega".',
      'Avise o cliente que está pronto.',
      'Ao sair, mude o status — enquanto não mudar, o trabalho conta como ocupando a gráfica.',
    ],
  },
  os_parada: {
    acao: 'Ver ordens paradas',
    passos: [
      'Abra Produção › Ordens de Serviço.',
      'Veja o que trava cada uma: falta arte aprovada, falta material ou falta máquina livre.',
      'Se o trabalho morreu, cancele a OS — OS parada sem fim vira gargalo falso no painel.',
    ],
  },
  os_sem_material_previsto: {
    acao: 'Ver ordens sem material',
    passos: [
      'Abra a OS e veja se o produto dela tem ficha técnica.',
      'Se não tiver, cadastre a ficha em Cadastros › Produtos (aba Materiais).',
      'Com a ficha pronta, a OS passa a prever o material, reservar o estoque e fechar o custo real.',
    ],
  },
  baixa_de_estoque_pendente: {
    acao: 'Ver ordens concluídas',
    passos: [
      'Abra Produção › Ordens de Serviço e filtre por concluídas.',
      'Confira com o impressor o que foi realmente consumido.',
      'Use "Dar baixa no estoque" na OS: o material sai da prateleira e entra no custo do trabalho.',
    ],
  },
  produto_sem_ficha: {
    acao: 'Abrir produtos',
    passos: [
      'Abra Cadastros › Produtos.',
      'Os que estão sem ficha têm a etiqueta "sem receita" na lista.',
      'Abra o produto, vá em Materiais e diga quanto de cada material entra por unidade de venda (por m², no caso de impressão).',
    ],
  },
  estoque_nunca_carregado: {
    acao: 'Abrir materiais',
    passos: [
      'Abra Estoque › Materiais.',
      'Para cada material que já está na prateleira, use "Entrada / saída" e registre a quantidade real com o custo de compra.',
      'A partir da primeira entrada, a OS passa a reservar e baixar sozinha.',
    ],
  },
  estoque_abaixo_minimo: {
    acao: 'Abrir materiais',
    passos: [
      'Abra Estoque › Materiais e veja os marcados como "Repor".',
      'Confira o fornecedor no cadastro do material.',
      'Registre a entrada assim que a compra chegar.',
    ],
  },
  material_sem_custo: {
    acao: 'Abrir materiais',
    passos: [
      'Abra Estoque › Materiais.',
      'O material sem preço aparece com "sem custo" na coluna de custo unitário.',
      'Preencha o custo de compra: o custo dos produtos que usam esse material volta a ser calculado sozinho.',
    ],
  },
  os_entregue_sem_cobranca: {
    acao: 'Abrir financeiro',
    passos: [
      'Abra Financeiro › Contas a Receber.',
      'Compare com as OS concluídas do período.',
      'Gere a cobrança a partir da OS, para a receita ficar ligada ao trabalho que a gerou.',
    ],
  },
  conta_pagar_vencida: {
    acao: 'Abrir contas a pagar',
    passos: [
      'Abra Financeiro › Contas a Pagar e ordene por vencimento.',
      'Pague ou renegocie o que está vencido.',
      'Se já foi paga, registre o pagamento — senão ela fica contando como atraso para sempre.',
    ],
  },
  receber_em_aberto: {
    acao: 'Abrir contas a receber',
    passos: [
      'Abra Financeiro › Contas a Receber.',
      'Confira uma a uma: hoje o sistema não guarda data de vencimento em contas a receber, então não há como saber quais estão atrasadas.',
      'Registre o recebimento do que já entrou.',
    ],
  },
};

export function guiaDe(chave: string): GuiaPendencia | undefined {
  return GUIA_PENDENCIAS[chave];
}
