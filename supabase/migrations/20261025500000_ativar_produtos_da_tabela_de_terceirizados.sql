-- Ativa os sete produtos da tabela de terceirizados que estavam como "(comparação)", inativos
-- de propósito até haver custo e preço.
--
-- PROVISÓRIO: o dono não mandou os custos por m². Cada produto recebe o custo, o preço de balcão,
-- a máquina e o tempo do produto PARECIDO que já vende (vinil branco, perfurado, lona 440 g), e a
-- observação interna diz isso. O preço de parceiro é o da tabela do WhatsApp. Ao saber o custo
-- real: UPDATE produtos SET custo_medio = ..., preco_base = ... WHERE nome = '...';
--
-- O preço de balcão (preco_base) é preenchido porque a tabela do parceiro só lista produto com
-- preco_base ou faixa. Sem ligação com material (como os irmãos): não reserva nem baixa estoque.
--
-- Idempotente: só mexe em quem ainda está inativo, com custo zero e o nome antigo.

WITH novos(id, nome_antigo, nome_novo, irmao, preco_parceiro) AS (VALUES
  ('d28f271f-5745-4606-8d88-67ea6a51a46b'::uuid, 'Adesivo PROMO (comparação)',                    'Adesivo PROMO',                  'aef1d1c9-5dbb-4860-bb80-818d64729464'::uuid, 23.90),
  ('6d3bcfa5-3a60-4e86-bc7f-92b4ee886d24'::uuid, 'Adesivo perfurado promocional (comparação)',    'Adesivo perfurado promocional',  '8834839e-f345-46dc-b864-10dfc0f4cc54'::uuid, 34.90),
  ('504a9190-317b-4e44-8e7c-e9214ea0d1dd'::uuid, 'Adesivo transparente (comparação)',             'Adesivo transparente',           'aef1d1c9-5dbb-4860-bb80-818d64729464'::uuid, 34.90),
  ('d741f73d-2129-41ef-9c67-fea281029620'::uuid, 'Adesivo fosco (comparação)',                    'Adesivo fosco',                  'aef1d1c9-5dbb-4860-bb80-818d64729464'::uuid, 34.90),
  ('3ae5022a-968d-41db-bb85-e462318cb583'::uuid, 'Adesivo blackout (comparação)',                 'Adesivo blackout',               'aef1d1c9-5dbb-4860-bb80-818d64729464'::uuid, 34.90),
  ('104c2b37-2112-4c97-865e-7842b6696cd5'::uuid, 'Lona fosca (comparação)',                       'Lona fosca',                     'b642e4a8-7fc0-4168-9ca6-697bfd5b985f'::uuid, 34.90),
  ('74cbbb9d-47a5-4cf3-8111-dc4517879743'::uuid, 'Lona backlight (comparação)',                   'Lona backlight',                 'b642e4a8-7fc0-4168-9ca6-697bfd5b985f'::uuid, 54.90)
)
UPDATE public.produtos p
   SET nome = n.nome_novo,
       ativo = true,
       preco_parceiro = n.preco_parceiro,
       preco_base = s.preco_base,
       custo_medio = s.custo_medio,
       maquina_padrao_id = s.maquina_padrao_id,
       tempo_producao_min = s.tempo_producao_min,
       observacoes_internas =
         'CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (25/10/2026): copiados de "' || s.nome ||
         '" porque o custo real ainda não foi informado. Preço de parceiro: tabela do WhatsApp. ' ||
         'Confirmar o custo por m² e ajustar.'
  FROM novos n
  JOIN public.produtos s ON s.id = n.irmao
 WHERE p.id = n.id
   AND p.nome = n.nome_antigo
   AND p.ativo = false
   AND COALESCE(p.custo_medio, 0) = 0;

NOTIFY pgrst, 'reload schema';
