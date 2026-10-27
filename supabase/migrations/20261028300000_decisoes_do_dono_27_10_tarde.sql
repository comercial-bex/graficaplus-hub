-- 27/10/2026 (tarde) — decisões do dono aplicadas.
--
-- * Salário: fica o salário mínimo nas cinco funções; para mudar basta editar salário e horas em Custos de
--   produção (o gatilho tg_mao_de_obra_recompoe_custos recalcula o custo de todos os produtos sozinho).
-- * Estoque: só existe o que foi contado (filamento e material de apoio 3D). Os 6 materiais criados para as fichas
--   dos produtos da tabela (vinil fosco, blackout, promo, perfurado promocional, lona fosca e backlight) NÃO foram
--   comprados: ficam inativos, sem estoque e sem preço, e os avisos de "nunca receberam entrada", "sem custo" e
--   "custo provisório" não os cobram até a compra (quando comprar: ativar e informar o preço da nota).
-- * Compras da Camaleão: as 3 reservas (22426, 22921, 22990) estão pagas e retiradas.
-- * Prazo temporário de 5 dias úteis (04/11/2026, com o feriado de Finados) para as OS 161 a 167 sem prazo; a
--   OS 166 tinha prazo de 25/09, anterior à própria OS. As parcelas a receber passam a vencer nessa data.
--   O `updated_at` dessas OS (e das 169 a 174, tocadas no backfill de prazo) foi devolvido ao último movimento
--   real: mexer no prazo reiniciava o relógio de "OS sem movimento há mais de 5 dias" e escondia OS paradas.
-- * Acabamentos pela regra da casa: preço por minuto/metro = custo da hora ÷ 60 × (1 + markup padrão de 60%),
--   com o custo da hora = máquina (contrato ÷ 10.000 h) + energia (kW × tarifa) + 1 pessoa + rateio administrativo:
--   corte a laser R$ 33,03/h → R$ 0,88/min; acabamento manual R$ 24,17/h → R$ 0,64/min; recorte eletrônico
--   R$ 1,21/m (3 min de depuração, estimativa a cronometrar) → R$ 1,93/m.

UPDATE public.custos_mao_de_obra SET observacoes = 'Decisão do dono (27/10/2026): salário mínimo de 2026 (R$ 1.621,00, Decreto 12.797/2025) para as cinco funções, ÷ 176 h (8 h × 22 dias úteis), com 32,19% de encargos do Simples = R$ 12,17/h. Para pagar um salário diferente, edite salário e horas aqui: o custo de todos os produtos é recalculado sozinho.'
 WHERE ativo AND observacoes LIKE 'Provisório%';

UPDATE public.materiais SET status = 'inativo',
  caracteristicas = trim(both ' ' from coalesce(caracteristicas,'') || ' NÃO COMPRADO (decisão do dono, 27/10/2026): sem estoque e sem preço pago. Quando comprar, ative o material e informe o preço da nota.')
 WHERE nome IN ('Vinil branco fosco','Vinil blackout','Vinil promocional branco','Vinil perfurado promocional','Lona fosca 440g','Lona backlight (translúcida)') AND status = 'ativo' AND estoque = 0;

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    $a$FROM public.materiais m WHERE coalesce(m.estoque,0) <= 0
    AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque mv WHERE mv.material_id=m.id) HAVING count(*)>0;$a$,
    $b$FROM public.materiais m WHERE coalesce(m.estoque,0) <= 0 AND m.status = 'ativo'
    AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque mv WHERE mv.material_id=m.id) HAVING count(*)>0;$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'estoque_nunca_carregado não encontrado'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$FROM public.materiais m WHERE coalesce(m.custo_medio, m.custo_unitario, 0) <= 0
      AND EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.material_id=m.id) HAVING count(DISTINCT m.id)>0;$a$,
    $b$FROM public.materiais m WHERE coalesce(m.custo_medio, m.custo_unitario, 0) <= 0 AND m.status = 'ativo'
      AND EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.material_id=m.id) HAVING count(DISTINCT m.id)>0;$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'material_sem_custo não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_de_preenchimento()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    $a$FROM public.produtos p WHERE p.ativo AND p.observacoes_internas LIKE '%PROVISÓRIOS%' HAVING count(*) > 0;$a$,
    $b$FROM public.produtos p WHERE p.ativo AND p.observacoes_internas LIKE '%PROVISÓRIOS%'
      AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm JOIN public.materiais mx ON mx.id = pm.material_id
                       WHERE pm.produto_id = p.id AND mx.status <> 'ativo')
    HAVING count(*) > 0;$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'produto_custo_provisorio não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;

UPDATE public.ordens_servico SET prazo_entrega = '2026-11-04'
 WHERE numero IN (161,162,163,164,165,166,167) AND (prazo_entrega IS NULL OR numero = 166);

ALTER TABLE public.ordens_servico DISABLE TRIGGER tg_os_updated;
UPDATE public.ordens_servico o SET updated_at = GREATEST(o.created_at, COALESCE((SELECT max(h.mudou_em) FROM public.os_status_historico h WHERE h.os_id = o.id), o.created_at))
 WHERE o.numero IN (161,162,163,164,165,166,167,169,170,171,172,173,174) AND o.updated_at > '2026-10-27 00:00:00+00';
ALTER TABLE public.ordens_servico ENABLE TRIGGER tg_os_updated;

UPDATE public.acabamentos SET preco_venda = 0.88, updated_at = now() WHERE id = '4b608717-bc90-47d4-84d8-4a4b97070631';
UPDATE public.acabamentos SET preco_venda = 0.64, updated_at = now() WHERE id = '6972bede-222a-45e9-a599-594972a94f57';
UPDATE public.acabamentos SET preco_venda = 1.93, updated_at = now() WHERE id = '58b78cdf-9798-4d99-a88a-230dad6a8051';
UPDATE public.produtos SET preco_base = 52.80, custo_medio = 33.03, updated_at = now() WHERE sku = 'ACB-LASER';
UPDATE public.produtos SET preco_base = 38.40, custo_medio = 24.17, updated_at = now() WHERE sku = 'ACB-MANUAL';
UPDATE public.produtos SET preco_base = 1.93, custo_medio = 1.21, updated_at = now() WHERE sku = 'ACB-RECORTE';
-- (as observações explicativas dos 3 acabamentos e dos 3 produtos foram gravadas por SQL no mesmo dia; sem o
--  prefixo "PROVISÓRIO", que é o que os avisos procuram)
