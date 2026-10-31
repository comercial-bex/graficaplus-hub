-- A OS 212 (Marcela) nasceu em 29/10 sem prazo, antes de a conversão passar a usar o prazo padrão da casa
-- (migração 20261029400000). É a única OS aberta sem prazo. Recebe o que o pedido teria recebido ao nascer:
-- 5 dias úteis contados da criação (29/10 -> 05/11). Só preenche se ainda estiver vazio.
UPDATE public.ordens_servico SET prazo_entrega = public.somar_dias_uteis((created_at AT TIME ZONE 'America/Belem')::date, 5)
 WHERE numero = 212 AND prazo_entrega IS NULL;
