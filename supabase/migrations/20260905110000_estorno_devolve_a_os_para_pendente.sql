-- A OS continuava "paga" depois do dinheiro voltar.
--
-- Achado ligando o botão de estorno à tela: a função `estornar_pagamento` estava
-- pronta há tempo, correta no modelo contábil (cria contra-lançamento negativo e
-- preserva o original, em vez de apagar), e sem nenhum chamador.
--
-- Ao rodá-la de verdade, a conta não fechou:
--
--   pagamento original    121,15   status pago        <- entra na soma
--   contra-lançamento    -121,15   status cancelado   <- NÃO entra
--   ordens_servico.status_financeiro = 'pago'         <- errado
--
-- Duas causas somadas. `recalcular_status_financeiro_os` soma apenas
-- `status in ('pago','parcial')`, e o contra-lançamento nasce 'cancelado'.
-- E `estornar_pagamento` nem chama o recálculo.
--
-- O efeito é o pior tipo: o dinheiro voltou para o cliente e o sistema segue
-- dizendo que recebeu. A cobrança não é refeita, o fluxo de caixa conta uma
-- entrada que não existe, e `fechar_os` deixa fechar uma OS não paga.

-- ---------------------------------------------------------------------------
-- 1. O recálculo passa a enxergar o estorno.
--
-- O filtro não pode ser simplesmente "inclua cancelado": pagamento cancelado
-- que nunca foi pago tem valor POSITIVO, e somá-lo daria dinheiro que ninguém
-- recebeu. O que entra é só o contra-lançamento, reconhecido por
-- `pagamento_estornado_id` — a coluna que diz "esta linha desfaz aquela".
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_status_financeiro_os(p_os_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE v_total NUMERIC; v_pago NUMERIC; v_novo public.status_pagamento;
BEGIN
  SELECT COALESCE(valor_total,0) INTO v_total FROM public.ordens_servico WHERE id=p_os_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(valor),0) INTO v_pago
    FROM public.pagamentos
   WHERE os_id = p_os_id
     AND (status IN ('pago','parcial') OR pagamento_estornado_id IS NOT NULL);

  v_novo := CASE
    WHEN v_pago <= 0 THEN 'pendente'::public.status_pagamento
    WHEN v_total > 0 AND v_pago >= v_total THEN 'pago'::public.status_pagamento
    ELSE 'parcial'::public.status_pagamento END;

  UPDATE public.ordens_servico SET status_financeiro=v_novo, updated_at=now()
   WHERE id=p_os_id AND status_financeiro IS DISTINCT FROM v_novo
     AND (status_financeiro NOT IN ('atrasado','cancelado') OR v_novo='pago');
END
$$;

comment on function public.recalcular_status_financeiro_os is
  'Status financeiro pelo LÍQUIDO recebido: pagamentos confirmados menos estornos. O contra-lançamento entra por `pagamento_estornado_id`, não por status — cancelado positivo é cobrança que nunca foi paga e não pode somar.';

-- ---------------------------------------------------------------------------
-- 2. O estorno chama o recálculo.
--
-- Mesma função de antes, com a última linha acrescentada. Copiada inteira de
-- propósito: o modelo de contra-lançamento e a devolução da parcela para
-- 'prevista' estavam certos e não devem ser reescritos de memória.
-- ---------------------------------------------------------------------------
create or replace function public.estornar_pagamento(p_pagamento_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE v_uid UUID; v_pag public.pagamentos%ROWTYPE; v_estorno UUID;
BEGIN
  IF NULLIF(trim(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
  v_uid := public.require_permission('pagamentos.reverse');

  SELECT * INTO v_pag FROM public.pagamentos WHERE id=p_pagamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado'; END IF;
  IF v_pag.status <> 'pago' THEN RAISE EXCEPTION 'Somente pagamento confirmado pode ser estornado'; END IF;

  -- Estorno não apaga: cria a linha oposta. O original continua no histórico,
  -- que é o que permite auditar depois.
  INSERT INTO public.pagamentos(os_id, parcela_id, valor, data_pagamento, status, forma_pagamento,
                                taxa, observacoes, pagamento_estornado_id, registrado_por)
  VALUES (v_pag.os_id, v_pag.parcela_id, -v_pag.valor, CURRENT_DATE, 'cancelado', v_pag.forma_pagamento,
          -COALESCE(v_pag.taxa,0), p_motivo, p_pagamento_id, v_uid)
  RETURNING id INTO v_estorno;

  IF v_pag.parcela_id IS NOT NULL THEN
    UPDATE public.parcelas_receber SET status='prevista' WHERE id=v_pag.parcela_id;
  END IF;

  INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, tipo, titulo, descricao,
                                     dados_anteriores, dados_posteriores, usuario_id)
  VALUES ('pagamento', p_pagamento_id, v_pag.os_id, 'pagamento_estornado', 'Pagamento estornado',
          p_motivo, to_jsonb(v_pag), jsonb_build_object('estorno_id', v_estorno), v_uid);

  -- A linha que faltava: sem ela a OS seguia marcada como paga.
  IF v_pag.os_id IS NOT NULL THEN
    PERFORM public.recalcular_status_financeiro_os(v_pag.os_id);
  END IF;

  RETURN jsonb_build_object('pagamento_id', p_pagamento_id, 'estorno_id', v_estorno);
END
$$;

comment on function public.estornar_pagamento is
  'Estorna por contra-lançamento, devolve a parcela para prevista e recalcula o status financeiro da OS.';

-- ---------------------------------------------------------------------------
-- 3. Reconcilia OS cujo estorno já aconteceu antes desta correção.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select distinct os_id from public.pagamentos
            where pagamento_estornado_id is not null and os_id is not null
  loop
    perform public.recalcular_status_financeiro_os(r.os_id);
  end loop;
end $$;
