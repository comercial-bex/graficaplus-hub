-- 1) Dedup de extrato ------------------------------------------------------
ALTER TABLE public.banco_transacoes ADD COLUMN IF NOT EXISTS hash_dedup text;

CREATE UNIQUE INDEX IF NOT EXISTS banco_transacoes_hash_uk
  ON public.banco_transacoes (conta_id, hash_dedup)
  WHERE hash_dedup IS NOT NULL;

-- 2) Saldo real por conta ---------------------------------------------------
CREATE OR REPLACE VIEW public.vw_saldo_conta
WITH (security_invoker = true) AS
SELECT c.id AS conta_id,
       c.nome,
       c.banco,
       c.agencia,
       c.conta,
       c.tipo,
       c.ativo,
       COALESCE(c.saldo_inicial, 0) AS saldo_inicial,
       c.saldo_inicial_data,
       COALESCE(SUM(CASE WHEN t.tipo = 'credito' THEN t.valor ELSE -t.valor END), 0) AS movimento,
       COALESCE(c.saldo_inicial, 0)
         + COALESCE(SUM(CASE WHEN t.tipo = 'credito' THEN t.valor ELSE -t.valor END), 0) AS saldo_atual,
       COUNT(t.id) AS lancamentos,
       COUNT(t.id) FILTER (WHERE NOT t.conciliado) AS nao_conciliados,
       MAX(t.data) AS ultimo_lancamento
  FROM public.contas_bancarias c
  LEFT JOIN public.banco_transacoes t ON t.conta_id = c.id
 GROUP BY c.id;

GRANT SELECT ON public.vw_saldo_conta TO authenticated;

-- 3) Importação de extrato com validação de duplicidade --------------------
DROP FUNCTION IF EXISTS public.importar_extrato(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.importar_extrato(p_conta_id uuid, p_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  l jsonb;
  v_data date; v_valor numeric; v_tipo text; v_desc text; v_doc text; v_fitid text;
  v_hash text; v_tx uuid; v_mov uuid;
  v_importadas int := 0; v_duplicadas int := 0;
  v_dups jsonb := '[]'::jsonb;
BEGIN
  v_uid := public.require_permission('pagamentos.confirm');

  IF NOT EXISTS (SELECT 1 FROM public.contas_bancarias WHERE id = p_conta_id) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada';
  END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Nenhum lançamento para importar';
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_data  := NULLIF(l->>'data','')::date;
    v_valor := round(COALESCE(NULLIF(l->>'valor','')::numeric, 0), 2);
    v_desc  := COALESCE(NULLIF(btrim(l->>'descricao'),''), 'Lançamento bancário');
    v_doc   := NULLIF(btrim(COALESCE(l->>'documento','')), '');
    v_fitid := NULLIF(btrim(COALESCE(l->>'fitid','')), '');
    v_tipo  := CASE WHEN COALESCE(l->>'tipo','') IN ('credito','debito')
                    THEN l->>'tipo'
                    WHEN v_valor < 0 THEN 'debito' ELSE 'credito' END;
    v_valor := abs(v_valor);

    IF v_data IS NULL OR v_valor = 0 THEN
      CONTINUE;
    END IF;

    v_hash := md5(p_conta_id::text || '|' || v_data::text || '|' || v_valor::text || '|'
                  || v_tipo || '|' || lower(v_desc) || '|' || COALESCE(v_fitid,''));

    IF EXISTS (
      SELECT 1 FROM public.banco_transacoes t
       WHERE t.conta_id = p_conta_id
         AND (t.hash_dedup = v_hash OR (v_fitid IS NOT NULL AND t.fitid = v_fitid))
    ) THEN
      v_duplicadas := v_duplicadas + 1;
      v_dups := v_dups || jsonb_build_object('data', v_data, 'descricao', v_desc, 'valor', v_valor);
      CONTINUE;
    END IF;

    INSERT INTO public.caixa_movimentos
      (tipo, origem, descricao, categoria, valor, data, realizado, conta_id, created_by, observacoes)
    VALUES
      (CASE WHEN v_tipo = 'credito' THEN 'entrada' ELSE 'saida' END,
       'extrato', v_desc, 'banco', v_valor, v_data, true, p_conta_id, v_uid,
       'Importado do extrato bancário')
    RETURNING id INTO v_mov;

    INSERT INTO public.banco_transacoes
      (conta_id, data, descricao, valor, tipo, documento, fitid, origem,
       conciliado, caixa_movimento_id, hash_dedup, created_by)
    VALUES
      (p_conta_id, v_data, v_desc, v_valor, v_tipo, v_doc, v_fitid, 'extrato',
       true, v_mov, v_hash, v_uid)
    RETURNING id INTO v_tx;

    v_importadas := v_importadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'conta_id', p_conta_id,
    'importadas', v_importadas,
    'duplicadas', v_duplicadas,
    'ignoradas', v_dups,
    'saldo_atual', (SELECT saldo_atual FROM public.vw_saldo_conta WHERE conta_id = p_conta_id)
  );
END $function$;

REVOKE ALL ON FUNCTION public.importar_extrato(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_extrato(uuid, jsonb) TO authenticated;

-- 4) Perda de produção também dá baixa no estoque --------------------------
CREATE OR REPLACE FUNCTION public.tg_perda_vira_custo_da_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_total numeric; v_qtd numeric; v_un text;
begin
  v_qtd   := coalesce(new.quantidade_perdida, 0);
  v_total := round(v_qtd * coalesce(new.custo_unitario, 0), 2);

  -- custo real da OS (alimenta vw_resultado_os -> lucro/margem realizados)
  if new.os_id is not null and v_total > 0 then
    insert into public.custos_operacionais_os
      (os_id, os_item_id, categoria, origem, quantidade, valor_unitario, data, usuario_id)
    values (new.os_id, new.os_item_id, 'perda', 'os_perdas',
            v_qtd, new.custo_unitario, now(),
            coalesce(new.operador_id, new.created_by));
  end if;

  -- baixa física do material desperdiçado
  if new.material_id is not null and v_qtd > 0 then
    select coalesce(new.unidade, m.unidade) into v_un
      from public.materiais m where m.id = new.material_id;

    insert into public.movimentacoes_estoque
      (material_id, tipo, quantidade, unidade, custo_unitario_snapshot,
       os_id, os_item_id, usuario_id, origem, motivo, observacao)
    values (new.material_id, 'saida', v_qtd, coalesce(v_un,'un'),
            coalesce(new.custo_unitario, 0), new.os_id, new.os_item_id,
            coalesce(new.operador_id, new.created_by), 'perda',
            new.motivo::text, new.observacoes);

    update public.materiais
       set estoque = coalesce(estoque, 0) - v_qtd,
           updated_at = now()
     where id = new.material_id;
  end if;

  return new;
end $function$;