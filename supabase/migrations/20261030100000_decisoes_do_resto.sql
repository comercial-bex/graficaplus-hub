-- Decisões do dono tomadas em 30/10/2026, por delegação ("decisão e continua a resolver"), sobre as
-- oito que sobravam das auditorias de 28/10. Cada resposta diz que foi por delegação e pode ser
-- revista; os valores de antes estão aqui para desfazer.
--
-- APLICADO (tem dado por trás):
--  * Hora do laser pela PARCELA do financiamento enquanto durar (o caixa paga a parcela, não a
--    depreciação): CNC Laser CO2 R$ 6,70 → 10,79 (R$ 1.726,74 ÷ 160 h); Fiber R$ 4,64 → 7,84
--    (R$ 1.254 ÷ 160 h). Voltar à depreciação quando o financiamento acabar.
--  * Potência média das impressoras 3D: 500 W → 150 W, o número do cadastro da máquina (o manual
--    da Bambu A1 indica ~95 W em regime; 150 W já é folga). Um número só nos dois lugares.
--  * Custo administrativo padrão do 3D: R$ 0 → R$ 12/h, o mesmo rateio do 2D.
--  * Faixas do chaveiro acrílico (BRI-CHA): 1 un = 7,00 · 200 = 6,50 · 400 = 6,00 · 500 = 5,50. As
--    vendas reais foram 7,00 com 100 un e 6,00 com 200 un; as faixas não pedem quantidade mínima
--    (a primeira vale de 1 un).
--  * Brindes com margem abaixo de 20% passam para o markup de 60% da casa, arredondado ao próximo
--    ,90: kit churrasco 3 pç (BRI-KC3B) 69 → 94,90; copo cuia 380 ml 35 → 48,90; kit churrasco longo
--    2 pç 79 → 110,90; caneta 5,50 → 7,90. Os outros brindes (margem de 25 a 32%) ficam até o
--    próximo reajuste de custo.
-- REGISTRADO, SEM MEXER EM DINHEIRO NEM EM LANÇAMENTO: Pix automático (agora não), banner (qual é
-- o padrão), orçamentos impressos sem OS (histórico) e as partes do 3D que pedem código.

UPDATE public.maquinas SET custo_hora = 10.79 WHERE tipo = 'laser_co2' AND custo_hora < 10.79;
UPDATE public.maquinas SET custo_hora = 7.84  WHERE tipo = 'laser_fiber' AND custo_hora < 7.84;

UPDATE public.maquinas_3d_config SET potencia_media_w = 150 WHERE potencia_media_w = 500;

UPDATE public.config_precificacao_3d SET custo_admin_padrao = 12 WHERE custo_admin_padrao = 0;

INSERT INTO public.produto_faixas_preco (produto_id, quantidade_minima, preco_unitario, observacao)
SELECT p.id, v.q, v.preco, 'Faixas decididas em 30/10/2026 por delegação do dono'
  FROM public.produtos p
  CROSS JOIN (VALUES (1, 7.00), (200, 6.50), (400, 6.00), (500, 5.50)) AS v(q, preco)
 WHERE p.sku = 'BRI-CHA'
   AND NOT EXISTS (SELECT 1 FROM public.produto_faixas_preco f WHERE f.produto_id = p.id AND f.quantidade_minima = v.q);

UPDATE public.produtos p SET preco_base = v.preco
  FROM (VALUES ('BRI-KC3B', 94.90), ('BRI-CUIA380', 48.90), ('BRI-KCL2', 110.90), ('BRI-CAN', 7.90)) AS v(sku, preco)
 WHERE p.sku = v.sku AND p.ativo AND COALESCE(p.preco_base, 0) < v.preco;

INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe) VALUES
  ('preco_de_tabela_do_banner', 'Preço de tabela do banner próprio: R$ 110 ou perto de R$ 40 por m²',
   'O banner próprio (BAN-LON) está a R$ 110/m² na tabela, mas a equipe vende a cerca de R$ 40/m² e os concorrentes de loja online cobram perto disso (um banner de 0,8 x 1,6 m a R$ 50,89, ou R$ 40 por m²). Custo cheio: R$ 15,95/m². Definir o preço de tabela: manter 110 (e vender abaixo só com desconto sobre o produto ligado) ou baixar para perto de 40-50. Não foi alterado: é posicionamento de preço.'),
  ('minimo_e_posprocessamento_3d', 'Calculadora 3D: tempo por peça e preço mínimo (a implementar)',
   'Decidido em 30/10/2026: 2 minutos de pós-processamento e embalagem por peça como padrão e preço mínimo de R$ 5,00 por peça. Falta implementar na calculadora 3D (hoje o chaveiro sai a R$ 1,78). Só o custo administrativo de R$ 12/h já foi aplicado.')
ON CONFLICT (chave) DO NOTHING;

UPDATE public.decisoes_pendentes SET resolvida_em = now(), resposta = v.resposta
  FROM (VALUES
    ('pix_automatico_api_banco',
     'Decidido em 30/10/2026 por delegação do dono: agora não. Manter o Pix manual (QR Code e copia e cola, com conferência do extrato e o clique em "O Pix chegou"). Reavaliar quando passar de 30 Pix por mês; ao reavaliar, começar pela plataforma de pagamento (Mercado Pago, Asaas ou Efí), que costuma liberar mais rápido que a API do banco, e confirmar as quatro perguntas (tarifa, prazo, certificado, aviso automático) antes de escolher.'),
    ('banner_40_x_110_qual_vale',
     'Decidido em 30/10/2026 por delegação do dono: o padrão é o banner PRÓPRIO (BAN-LON), sempre ligado ao produto no item, para o custo contar (o aviso de item sem custo antes da OS já cobra isso). O banner "terceirizado" de R$ 40 (BAN-LON-COPY) fica só para pedido de parceiro. O preço de tabela do próprio (110 ou perto de 40) virou uma decisão à parte, que não foi alterada.'),
    ('brindes_margem_abaixo_do_markup',
     'Decidido em 30/10/2026 por delegação do dono: brinde segue o markup de 60% da casa, com o piso da margem mínima do produto. Aplicado já nos que estavam abaixo de 20% de margem: kit churrasco 3 pç (BRI-KC3B) 69 → 94,90; copo cuia 380 ml 35 → 48,90; kit churrasco longo 2 pç 79 → 110,90; caneta 5,50 → 7,90. Os outros (25 a 32%) sobem no próximo reajuste de custo, um a um.'),
    ('faixa_de_volume_chaveiro_acrilico',
     'Decidido e cadastrado em 30/10/2026 por delegação do dono: 1 un = R$ 7,00; 200 = 6,50; 400 = 6,00; 500 = 5,50 (as vendas reais foram 7,00 com 100 un e 6,00 com 200 un). Sem quantidade mínima. Margem sobre o custo de R$ 2,80: 60% a 49%.'),
    ('hora_maquina_financiada_x_depreciacao',
     'Decidido e aplicado em 30/10/2026 por delegação do dono: a hora dessas duas sobe para a parcela do financiamento enquanto ele durar, porque o caixa paga a parcela. CNC Laser CO2 R$ 6,70 → 10,79; Fiber R$ 4,64 → 7,84. Voltar à depreciação quando o financiamento terminar.'),
    ('potencia_das_impressoras_3d',
     'Decidido e aplicado em 30/10/2026 por delegação do dono: 150 W nos dois lugares (cadastro da máquina e calculadora). O manual da Bambu A1 indica ~95 W em regime; 150 W já tem folga. Ajustar se um medidor de tomada mostrar outro número.'),
    ('precificacao_3d_mao_de_obra_e_indireto_zerados',
     'Decidido em 30/10/2026 por delegação do dono: (1) custo administrativo do 3D em R$ 12/h, como no 2D, já aplicado; (2) 2 minutos de pós-processamento e embalagem por peça e (3) preço mínimo de R$ 5,00 por peça: decididos, a implementar na calculadora (virou uma decisão à parte para não esquecer). Ligar o filamento real nas OS 170 a 173 depende de saber qual rolo foi usado: a equipe aponta na OS.'),
    ('orcamentos_produzidos_sem_os',
     'Decidido em 30/10/2026 por delegação do dono: (b) manter como histórico, sem receita no sistema, os orçamentos 54, 56, 57, 62 e 70, que o dono já tinha tomado por clientes de teste: converter criaria conta a receber de dinheiro que ninguém sabe se entrou. O 36 e o 38 seguem rejeitados. O 115 (parceiro Yvens, R$ 366, impresso em 24/10): o atendimento confirma com o parceiro se o pedido valeu e converte em OS com a data real, pelo botão que já está liberado para a atendente.')
  ) AS v(chave, resposta)
 WHERE decisoes_pendentes.chave = v.chave AND decisoes_pendentes.resolvida_em IS NULL;
