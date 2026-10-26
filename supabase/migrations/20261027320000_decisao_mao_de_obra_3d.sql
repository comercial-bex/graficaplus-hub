-- Mão de obra 3D a R$ 40/h é o valor de fábrica do módulo (27/10/2026): vira decisão pendente no
-- painel, com a conta real (R$ 14,07/h) ao lado, para o dono fechar o salário da função.
INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe) VALUES
  ('mao_de_obra_3d_40_por_hora', 'Mão de obra da impressão 3D: R$ 40/h é valor de fábrica',
   'Em Tarifas 3D (config_precificacao_3d) a mão de obra está em R$ 40,00/h com 0% de encargos, o padrão que veio com o módulo. O levantamento de 25/10 chegou a R$ 14,07/h (impressor digital, R$ 2.342/mês ÷ 220 h, com 32,19% de encargos do Simples). O valor só pesa quando alguém informa horas de acabamento na peça (lixa, pintura, montagem); nesse caso a peça sai 2,8× mais cara no acabamento do que o custo real. Decida o salário da função e eu ajusto a tarifa; a tela de Custos de produção já tem a conta.')
ON CONFLICT (chave) DO NOTHING;
