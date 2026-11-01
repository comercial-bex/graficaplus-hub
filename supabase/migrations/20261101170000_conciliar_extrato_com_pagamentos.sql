-- O mesmo Pix contado duas vezes no fluxo de caixa (01/11/2026).
--
-- `vw_fluxo_caixa` soma as entradas de `pagamentos` (o que o sistema registrou)
-- e as linhas de `caixa_movimentos` que não têm vínculo com pagamento nem com
-- conta a pagar (o extrato importado do banco). Quando o mesmo Pix existe nos
-- dois lugares, entra duas vezes. Medido em 01/11/2026: 8 Pix, R$ 3.178,49 a
-- mais nas entradas.
--
-- A própria view já tem a regra para não contar duas vezes: linha de caixa
-- ligada a um pagamento (`pagamento_id`) fica de fora. Faltava quem ligasse.
--
-- Esta função faz o pareamento, um para um e sem adivinhar:
--   - só pagamento pago e só linha de extrato de entrada ainda sem vínculo;
--   - valor exato, ao centavo;
--   - datas com no máximo 3 dias de diferença (o Pix cai no banco antes ou
--     depois de alguém marcar "o Pix chegou");
--   - "melhor par mútuo": a linha escolhe o pagamento mais próximo no tempo e
--     o pagamento escolhe a linha mais próxima; só liga quando os dois se
--     escolhem (empate no dia, desempata por id). O que sobra ambíguo fica
--     sem ligar: melhor deixar duas vezes na conta que esconder uma entrada.
--     Ligar um par desfaz empates, então ao aplicar a função repete a rodada
--     até não sobrar par certo (no máximo 5 rodadas).
-- Ligar é reversível (voltar `pagamento_id` a nulo) e não apaga nada.
--
-- Com `p_aplicar = false` só mostra o que ligaria. A tela de importação do
-- extrato chama com `true` depois de cada importação.
--
-- Quem chama precisa ver o financeiro. Migração e serviço (sem usuário) passam.

CREATE OR REPLACE FUNCTION public.conciliar_extrato_com_pagamentos(p_aplicar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r jsonb;
  v_rodada int := 0;
  v_ligados int;
  v_total int := 0;
  v_pares jsonb := '[]'::jsonb;
  v_soma numeric := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'A conciliação é do financeiro.' USING ERRCODE = '42501';
  END IF;

  LOOP
  v_rodada := v_rodada + 1;
  WITH cand AS (
    SELECT p.id AS pagamento_id, m.id AS movimento_id, p.valor,
           coalesce(p.data_pagamento, p.data_vencimento) AS data_pagamento,
           m.data AS data_extrato,
           left(coalesce(m.descricao, ''), 40) AS descricao,
           abs(m.data - coalesce(p.data_pagamento, p.data_vencimento)) AS dif
      FROM public.pagamentos p
      JOIN public.caixa_movimentos m
        ON m.origem = 'extrato' AND m.tipo = 'entrada'
       AND m.pagamento_id IS NULL AND m.conta_pagar_id IS NULL
       AND abs(m.valor - p.valor) < 0.01
       AND abs(m.data - coalesce(p.data_pagamento, p.data_vencimento)) <= 3
     WHERE p.status = 'pago'
       AND NOT EXISTS (SELECT 1 FROM public.caixa_movimentos x WHERE x.pagamento_id = p.id)
  ), melhor AS (
    SELECT c.*,
           row_number() OVER (PARTITION BY c.pagamento_id ORDER BY c.dif, c.movimento_id) AS ordem_do_pagamento,
           row_number() OVER (PARTITION BY c.movimento_id ORDER BY c.dif, c.pagamento_id) AS ordem_da_linha
      FROM cand c
  ), pares AS (
    SELECT * FROM melhor WHERE ordem_do_pagamento = 1 AND ordem_da_linha = 1
  ), ligados AS (
    UPDATE public.caixa_movimentos m
       SET pagamento_id = pr.pagamento_id
      FROM pares pr
     WHERE p_aplicar AND m.id = pr.movimento_id
    RETURNING m.id
  )
  SELECT jsonb_build_object(
           'aplicado', p_aplicar,
           'pares', coalesce((SELECT jsonb_agg(jsonb_build_object(
                       'pagamento_id', pr.pagamento_id, 'movimento_id', pr.movimento_id,
                       'valor', pr.valor, 'data_pagamento', pr.data_pagamento,
                       'data_extrato', pr.data_extrato, 'descricao', pr.descricao)
                     ORDER BY pr.valor DESC) FROM pares pr), '[]'::jsonb),
           'soma', coalesce((SELECT sum(pr.valor) FROM pares pr), 0),
           'ligados', (SELECT count(*) FROM ligados)
         )
    INTO v_r;

  v_pares := v_pares || (v_r -> 'pares');
  v_soma := v_soma + (v_r ->> 'soma')::numeric;
  v_ligados := (v_r ->> 'ligados')::int;
  v_total := v_total + v_ligados;
  -- Ligar um par desfaz empates: o que era ambíguo na primeira rodada pode virar certo
  -- na segunda. Repete até não sobrar par certo (no máximo 5 vezes). A simulação mostra
  -- só a primeira rodada, porque nada foi ligado para as seguintes enxergarem.
  EXIT WHEN NOT p_aplicar OR v_ligados = 0 OR v_rodada >= 5;
  END LOOP;

  RETURN jsonb_build_object(
    'aplicado', p_aplicar, 'pares', v_pares, 'soma', v_soma, 'ligados', v_total, 'rodadas', v_rodada
  );
END $function$;

COMMENT ON FUNCTION public.conciliar_extrato_com_pagamentos(boolean) IS
  'Liga linha de extrato de entrada ao pagamento do sistema (um para um, valor exato, até 3 dias) para o fluxo de caixa não contar o mesmo Pix duas vezes. p_aplicar=false só mostra.';

-- Função de conciliação não é para o público nem para quem não está logado.
REVOKE ALL ON FUNCTION public.conciliar_extrato_com_pagamentos(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conciliar_extrato_com_pagamentos(boolean) TO authenticated, service_role;
