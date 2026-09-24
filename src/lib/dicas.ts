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
  "/parceiros": {
    menu: "Rede de revendedores: níveis, metas, ofertas e quem está esfriando.",
    tela: "Quem compra da gráfica para revender com a própria marca. Aqui você cadastra o parceiro, dá o acesso ao painel dele, define níveis de desconto, metas com prêmio e ofertas que aparecem para ele. Os orçamentos que o parceiro faz para os clientes dele são dele: a gráfica vê quanto ele trabalha (orçamentos, m², pedidos), nunca quem são os clientes.",
    campos: {
      compras_30_dias:
        "Quanto o parceiro comprou da gráfica nos últimos 30 dias (OS não canceladas do cliente dele). Só aparece para quem vê financeiro.",
      orcamentos_30_dias:
        "Quantos orçamentos ele fez no painel dele no último mês. Mostra se ele está trabalhando mesmo quando ainda não fechou pedido.",
      m2_orcados_30_dias: "Metragem somada dos orçamentos dele no mês. É o tamanho do trabalho na mão dele.",
      pedidos_30_dias: "Quantos orçamentos dele viraram pedido para a gráfica no mês.",
      credito: "Saldo de cashback, prêmios de meta e ajustes. Ele abate isso no próximo pedido, como desconto.",
      ultimo_acesso: "Última vez que ele abriu o painel. Quem nunca entrou normalmente não recebeu o acesso direito.",
      nivel:
        "Calculado sozinho pelo valor comprado nos últimos 90 dias. 'Garantido' quer dizer que a gestão fixou um nível mínimo para ele.",
      compras_em_90_dias:
        "Quanto o parceiro precisa comprar em 90 dias para entrar neste nível. Divida por 3 para pensar por mês.",
      desconto_na_tabela:
        "Quanto ele paga a menos que o preço de balcão. É o ganho dele ao revender pelo mesmo preço que a gráfica cobra.",
      desconto_em_preco_por_faixa:
        "Desconto extra nos produtos de campanha, que já têm preço por quantidade e não têm custo cadastrado — por isso é separado e menor.",
      volta_em_credito: "Cashback: percentual do pedido que volta como crédito quando a OS é paga.",
      beneficios: "Frases que o parceiro vê no painel dele. Prometa só o que a gráfica cumpre.",
      o_que_conta: "A conta da meta: valor comprado, metragem comprada ou quantidade de pedidos no período.",
      meta: "O número que ele precisa alcançar no período para ganhar o prêmio.",
      premio:
        "Crédito entra sozinho no saldo dele assim que bate. Produto e brinde ficam na aba Recompensas para a equipe entregar.",
      para_quem: "Dá para restringir a meta ou a oferta a um nível para cima (ex.: só Ouro e Diamante).",
      preco_da_oferta:
        "Preço promocional por unidade de venda. Só vale enquanto for menor que o preço de parceiro dele, e só no prazo.",
      abrir_como_aviso: "A oferta aparece sozinha quando o parceiro entra no painel, uma única vez.",
      motivo: "O parceiro vê este texto no extrato dele. Escreva para ele entender sem precisar perguntar.",
    },
    acoes: {
      novo_parceiro:
        "Transforma um cliente já cadastrado em parceiro. É pelo cadastro de cliente que as compras dele contam para nível e meta.",
      dar_acesso:
        "Cria o login do painel (ou liga uma conta que ele já criou) e gera a mensagem pronta para mandar no WhatsApp.",
      ajustar_credito: "Dá ou tira crédito manualmente. Sempre com motivo, porque o parceiro lê esse texto.",
      entregar_recompensa: "Marca o prêmio de produto ou brinde como entregue. O parceiro vê isso no painel.",
      simular: "Mostra, com os produtos reais da gráfica, quanto sobra de margem em cada desconto antes de salvar.",
      extrato_do_contador:
        "Fecha o mês do clube: quanto de crédito foi dado, quanto foi usado, quanto ficou em aberto e quais prêmios saíram.",
    },
  },
  "/parceiro": {
    menu: "Painel do parceiro revendedor.",
    tela: "Seu painel: sua tabela de preços, seus orçamentos com a sua marca, seus pedidos e o seu crédito.",
    campos: {
      seu_nivel:
        "Sobe sozinho pelo quanto você comprou nos últimos 90 dias. Quanto mais alto, menor o preço que você paga.",
      desconto: "Quanto você paga a menos que o preço de balcão da gráfica.",
      seu_credito:
        "Dinheiro seu para abater no próximo pedido. Vem do cashback dos pedidos pagos, das metas batidas e de ajustes da gráfica.",
      metas: "Todo parceiro que bate a meta ganha o prêmio. Não é sorteio: não depende de sorte nem de ser o primeiro.",
      balcao: "O preço que a gráfica cobra do cliente final. Se você revender por ele, o seu ganho é o desconto do seu nível.",
      peca_minima: "Peças menores que essa área são cobradas como se tivessem o tamanho mínimo — o corte e o setup existem do mesmo jeito.",
      faixa: "Quanto maior a quantidade no mesmo pedido, menor o preço por unidade.",
      item_livre: "Serviço seu (instalação, arte, deslocamento). Entra no PDF do seu cliente e não vira pedido na gráfica.",
      seu_preco: "O preço que VOCÊ cobra do seu cliente. A gráfica não vê este valor.",
      voce_paga: "O que a gráfica vai te cobrar por este item quando virar pedido.",
      seu_ganho: "A diferença entre o que o seu cliente paga e o que você paga à gráfica.",
      validade: "Quantos dias o preço vale para o seu cliente. Sai impresso no PDF.",
      cobrar_por: "Unidade: por metro quadrado (usa largura × altura) ou por unidade.",
    },
    acoes: {
      novo_orcamento: "Monta um orçamento com a sua marca para o seu cliente.",
      baixar_pdf: "Gera o PDF com o seu logo e os seus dados. Nada da gráfica aparece nele.",
      fazer_pedido: "Manda os itens de tabela para a gráfica produzir. Os preços são conferidos pela gráfica no envio.",
      duplicar: "Cria uma cópia deste orçamento para repetir o trabalho sem digitar tudo de novo.",
    },
  },
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
      filtros:
        "Mostra só as ordens que interessam agora: por cliente, responsável, etapa ou prazo.",
    },
  },
  "/os": {
    menu: "Lista de todas as ordens de serviço, com etapa e prazo.",
    tela: "Todas as ordens de serviço da gráfica. Clique em uma linha para abrir o detalhe, apontar produção, baixar material e fechar o trabalho.",
    campos: {
      "quem trouxe a venda":
        "A pessoa da equipe que trouxe este trabalho — qualquer papel, não só vendedor. Se ela tiver comissão configurada, ganha um % do bruto quando a OS for paga. Só gestão e atendimento podem mudar.",
    },
    acoes: {
      nova: "Cria uma ordem de serviço do zero, sem passar por orçamento.",
    },
  },
  "/clientes": {
    menu: "Cadastro de clientes, contatos e histórico de compras.",
    tela: "Base de clientes. Um cliente cadastrado é o que permite converter orçamento em ordem de serviço, emitir documentos e acompanhar o histórico de compras.",
    campos: {
      tipo: "Pessoa física usa CPF; pessoa jurídica usa CNPJ e razão social.",
      documento:
        "CPF ou CNPJ. Com o CNPJ, o sistema tenta preencher endereço e razão social sozinho.",
      whatsapp: "Número usado para enviar orçamento, arte e aviso de entrega. Com DDD.",
      logo: "Logotipo do cliente. Aparece no cadastro e ajuda a identificar a arte na produção.",
      vendedor: "Quem responde por esse cliente. Usado nas metas e nos relatórios de vendas.",
    },
    acoes: {
      novo: "Abre o cadastro de um novo cliente.",
      excluir:
        "Remove o cliente. Não é possível quando já existem orçamentos ou ordens de serviço ligados a ele.",
    },
  },
  "/leads": {
    menu: "Contatos interessados que ainda não viraram cliente.",
    tela: "Funil de primeiros contatos. Registre a origem, acompanhe a conversa e converta em cliente quando o negócio avançar.",
    acoes: {
      converter:
        "Transforma o contato em cliente cadastrado, aproveitando nome, telefone e e-mail.",
    },
  },
  "/orcamentos": {
    menu: "Propostas para o cliente e conversão em ordem de serviço.",
    tela: "Todas as propostas comerciais. Monte os itens, envie ao cliente e, quando ele aprovar, converta em ordem de serviço com um clique.",
    campos: {
      cliente:
        "Cliente cadastrado. Sem cadastro dá para orçar, mas não dá para converter em ordem de serviço.",
      contato: "Nome de quem pediu o orçamento, para contatos que ainda não estão na base.",
      titulo: "Nome curto do trabalho, como o cliente reconhece: 'Fachada loja Centro'.",
      valor: "Valor total da proposta. Ao lançar itens, ele é recalculado automaticamente.",
      data_inicio: "Quando a produção começa, se o cliente aprovar.",
      prazo:
        "Data prometida de entrega. Alimenta o prazo da ordem de serviço e os alertas de atraso.",
    },
    acoes: {
      converter: "Cria a ordem de serviço a partir desta proposta. Exige um cliente cadastrado.",
      pdf: "Gera o orçamento impresso com dados da empresa, do cliente, medidas e valores.",
      producao: "Mesma impressão, sem valores — a via que vai para a oficina.",
      link: "Copia o endereço em que o cliente vê o orçamento e aprova pela internet.",
      whatsapp: "Abre a conversa no WhatsApp já com a mensagem e o link prontos.",
      artes:
        "Anexa as artes do item. A marcada com estrela é a que sai no PDF e no link do cliente.",
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
      custo_hora:
        "Quanto custa manter a máquina ligada por uma hora, somando energia, manutenção e depreciação.",
      velocidade: "Produção média por hora. Usada para estimar o tempo de cada trabalho.",
    },
  },
  "/maquinas-agenda": {
    menu: "Reserva de horários das máquinas.",
    tela: "Agenda dos equipamentos. Evita duas ordens disputando a mesma máquina no mesmo horário.",
  },
  "/capacidade": {
    menu: "Quanto de cada máquina já está vendido na semana, e quanto ainda cabe.",
    tela: "Horas de cada máquina na janela escolhida: quantas existem, quantas já estão reservadas por OS e quanto sobra. Serve para responder o cliente no balcão — 'cabe para sexta?' — sem chutar. Máquina sem custo por hora ou sem velocidade cadastrada aparece na lista de pendências, porque sem esses dois números a conta da hora não fecha.",
    campos: {
      horas_disponiveis:
        "Horas produtivas da máquina no mês, proporcionais aos dias úteis da janela. É o teto, não a promessa.",
      horas_reservadas: "Soma das reservas vivas (agendadas e em produção) na janela. É trabalho já vendido.",
      ocupacao: "Reservado dividido pelo disponível. Verde abaixo de 70%, âmbar de 70 a 95, vermelho acima.",
      velocidade: "Quanto a máquina produz por hora (m²/h). Sem ela o sistema não sabe transformar peça em tempo.",
      custo_hora: "Quanto custa manter a máquina ligada por uma hora. Só aparece para quem vê financeiro.",
    },
  },
  "/onde-para": {
    menu: "Em qual etapa as ordens de serviço estão emperrando agora.",
    tela: "Cada OS aberta na etapa em que está e há quantos dias não sai dela. Mostra o gargalo do momento e quem precisa agir para destravar. Diferente do quadro de produção, que mostra onde o trabalho está: aqui o que importa é há quanto tempo ele está parado.",
    campos: {
      dias_parada: "Dias desde a última mudança de etapa desta OS. Conta do histórico, não da data de criação.",
      mediana: "O tempo do caso do meio da etapa. Um trabalho muito antigo não empurra este número sozinho.",
      gargalo: "A etapa com mais OS presas há mais de 7 dias. É por onde começar a destravar.",
    },
  },
  "/conflitos-agenda": {
    menu: "Reserva sobreposta, esquecida ou que não cabe no prazo prometido.",
    tela: "O que ainda pode dar errado na agenda das máquinas. O banco já recusa duas reservas vivas no mesmo horário da mesma máquina; esta tela mostra o resto, que a trava não vê: reserva esquecida em 'agendado' com a hora já passada, produção estourando o tempo previsto, reserva digitada à mão sem OS e prazo prometido que não cabe na fila.",
    campos: {
      reserva_esquecida:
        "Continua como 'agendado' com o horário já no passado. Ou a peça rodou e ninguém apontou, ou a máquina ficou parada.",
      sem_os: "Reserva digitada à mão, sem ordem de serviço. Segura a máquina sem ninguém saber de qual trabalho é.",
      prazo_que_nao_cabe: "A reserva termina depois da data prometida ao cliente. Ou antecipa a fila, ou avisa o cliente.",
    },
  },
  "/meta": {
    // O menu mostra este texto para quem tem preco.read OU financeiro.read — o
    // vendedor entra só com preço e nunca vê o ponto de equilíbrio. Por isso a
    // frase começa pelo que todo mundo vê e marca o resto como do financeiro:
    // prometer no menu um número que a tela vai esconder é o mesmo defeito de
    // mostrar zero por falta de permissão.
    menu: "Qual peça paga melhor a hora de máquina — e, para quem vê financeiro, quanto falta para o mês empatar.",
    tela: "O mês em dois números. Primeiro o ponto de equilíbrio: quanto a gráfica precisa faturar para pagar o custo fixo com a margem que pratica — o que já entrou, o que está na oficina e o que falta. Depois o ranking de produtos por quanto cada um rende por hora de máquina, que é o que diz onde vale empurrar a venda. Sem acesso ao financeiro, só o ranking aparece.",
    campos: {
      custo_fixo: "O que a gráfica gasta no mês mesmo sem produzir nada: aluguel, salários, energia de base.",
      margem_de_contribuicao:
        "O que sobra de cada real vendido depois de material, perda, falha, imposto e taxa de cartão. É com isso que se paga o custo fixo.",
      meta_de_faturamento: "Custo fixo dividido pela margem de contribuição. Abaixo disso o mês fecha no prejuízo.",
      em_producao: "Trabalho já na oficina que ainda não foi concluído. Não conta como realizado, mas está a caminho.",
      margem_hora: "Quanto o produto deixa por hora de máquina ocupada. Preço alto com tempo longo pode render menos que peça rápida.",
    },
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
      materiais:
        "Materiais consumidos por unidade. É o que permite baixar o estoque automaticamente.",
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
  "/aprovacoes": {
    menu: "O que o cliente aprovou, o que pediu ajuste e o que já foi entregue.",
    tela: "Situação de cada orçamento na visão do cliente. Junta três coisas que costumam ficar separadas: o status do orçamento, a resposta do cliente em cada arte e os pedidos de ajuste abertos no portal. Se aparecer 'Pediu ajuste', não mande produzir.",
  },
  "/metragem": {
    menu: "Metros quadrados por cliente: orçado, aprovado e produzido.",
    tela: "Quanto cada cliente já orçou, aprovou, colocou em ordem de serviço e quanto ainda falta produzir. 'Aprovado sem OS' é trabalho vendido que ainda não entrou na produção — normalmente é aí que o dinheiro trava.",
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
    menu: "Valor da hora da equipe e os parâmetros que formam o preço.",
    tela: "Custo de mão de obra por função, e os parâmetros da casa: markup, imposto, taxa de cartão, perda de refile e falha de produção. Quatro deles entram direto na conta da Meta do mês — mudar aqui muda quanto a gráfica precisa faturar para empatar.",
    campos: {
      encargos: "FGTS, 13º, férias e provisão de rescisão sobre o salário-hora. Encargo em 0% faz o bloco de mão de obra sair menor do que o que sai do bolso.",
      parametros_da_casa:
        "Os dez números que formam preço e medem resultado. Só o administrador altera; a equipe vê, porque entender de onde sai o preço ajuda a explicar o orçamento ao cliente.",
    },
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
    campos: {
      "comissões":
        "Geradas sozinhas quando a OS é paga, sobre o bruto da OS, com o % de quem trouxe a venda. Pague no fechamento e marque como paga; não gera lançamento em contas a pagar.",
    },
    acoes: {
      registrar: "Lança um pagamento recebido e abate do saldo pendente.",
      estornar: "Desfaz um pagamento confirmado, deixando o registro do estorno.",
    },
  },
  "/a-receber": {
    menu: "Quanto cada cliente ainda deve e o que já venceu.",
    tela: "O que a gráfica já entregou e ainda não recebeu, cliente por cliente e parcela por parcela. A conta nasce sozinha quando o orçamento vira ordem de serviço, com as parcelas da condição de pagamento combinada. Ao confirmar o recebimento de uma parcela, o próprio banco move a conta para parcial ou recebida — esse status não é digitado por ninguém.",
    campos: {
      a_receber: "Soma do que ainda falta entrar nas contas em aberto. Não conta o que já foi recebido.",
      vencido:
        "A parte do 'a receber' cuja data de vencimento já passou. É o número que vira cobrança hoje.",
      // A soma é do valor COMBINADO das parcelas já baixadas, não do que o
      // extrato mostra: a baixa fecha a parcela inteira mesmo se o valor
      // digitado for menor. Dizer "quanto entrou" seria mentir sobre dinheiro.
      recebido:
        "Soma das parcelas já baixadas, pelo valor combinado delas. Somado ao 'a receber', dá o valor total vendido — confira sempre contra o extrato do caixa.",
      vencimento:
        "Data combinada de cada parcela. Vem da condição de pagamento do orçamento no momento da conversão em OS.",
      parcela:
        "Cada pedaço do pagamento combinado. A conta só fica recebida quando a última parcela cai.",
    },
    acoes: {
      dar_baixa:
        "Registra o recebimento de uma parcela: lança o pagamento, marca a parcela como paga e fecha a conta quando for a última. Só financeiro e administrador. Atenção: a baixa quita a parcela INTEIRA, mesmo que você digite um valor menor — se o cliente pagou só uma parte, não dê baixa, porque o resto sai da cobrança e ninguém mais vê.",
      todas:
        "Mostra também as contas já quitadas, para conferir histórico. O padrão é listar só o que está em aberto.",
    },
  },
  "/fluxo-caixa": {
    menu: "Saldo das contas e movimento de caixa.",
    tela: "Caixa e contas bancárias. Mostra o saldo real das contas e o previsto com base no que ainda vai entrar e sair.",
    campos: {
      saldo_inicial:
        "Saldo da conta na data em que você começou a usar o sistema. Serve de ponto de partida.",
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
      "comissão":
        "Percentual sobre o bruto da OS que a pessoa ganha quando traz uma venda. Cada 1 ponto aqui tira 1 ponto da margem daquela OS. Só admin e gestor alteram.",
      perfil:
        "Define o acesso: administrador vê tudo; vendedor vê comercial; operador vê produção.",
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

function buscar(mapa: Record<string, string> | undefined, termo: string): string | undefined {
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
