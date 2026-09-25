-- ============================================================================
-- Quando falta material, dizer QUAL e QUANTO
-- ============================================================================
--
-- Encontrado seguindo o ciclo inteiro até o fim, com a OS na mão.
--
-- A conversão do orçamento faz três coisas com material: prevê, reserva, e
-- devolve o que não coube. O `Adesivo jateado` precisa de 2,1 m² de `Vinil
-- jateado`, e a gráfica tem ZERO — nem saldo, nem lote. A reserva então
-- funciona exatamente como deve: não reserva nada e devolve
--
--   "reserva": {"status":"parcial","faltantes":[{"faltante":2.1000,"material_id":"46e9a4…"}]}
--
-- Três problemas, e nenhum deles é a reserva:
--
-- 1. Esse `faltantes` volta num campo do JSON da conversão — com o id do
--    material, não o nome — e some assim que a tela fecha. Não vira aviso, não
--    vira pendência, não fica em lugar nenhum.
--
-- 2. Quando o operador tenta dar baixa, `baixar_estoque_os` responde:
--    "Não há material reservado para esta OS... Gere a previsão de materiais e
--    reserve o estoque antes de dar baixa." — mandando fazer o que a conversão
--    JÁ FEZ. O motivo real é outro: não há material na prateleira. A mensagem
--    aponta o operador para o lugar errado.
--
-- 3. A partir daí a OS não baixa estoque, e por isso não fecha (`fechar_os`
--    trava em `materiais_baixados`), e ninguém sabe por quê até tentar.
--
-- E a reserva na conversão é engolida por um `EXCEPTION WHEN OTHERS` que
-- escreve o erro num campo do retorno e mais nada. Engolir aqui é certo — a OS
-- tem de nascer mesmo com o estoque inconsistente. Engolir EM SILÊNCIO não é.
--
-- Retrato do banco vivo: aplicado e ensaiado com reversão.

-- ----------------------------------------------------- 1. o que falta, por nome
CREATE OR REPLACE FUNCTION public.materiais_faltantes_da_os(p_os_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT string_agg(
    format('%s (falta %s %s)', m.nome,
           trim(to_char(mp.quantidade - COALESCE(res.reservado,0), 'FM999999990.00')), m.unidade),
    ', ' ORDER BY m.nome)
  FROM public.os_materiais_previstos mp
  JOIN public.materiais m ON m.id = mp.material_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(r.quantidade),0) AS reservado
      FROM public.estoque_reservas r
     WHERE r.os_id = mp.os_id AND r.material_id = mp.material_id
       AND r.status IN ('reservada','parcial')
  ) res ON true
  WHERE mp.os_id = p_os_id
    AND mp.quantidade - COALESCE(res.reservado,0) > 0.0001;
$f$;

REVOKE ALL ON FUNCTION public.materiais_faltantes_da_os(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.materiais_faltantes_da_os(uuid) TO authenticated;


-- ------------------------------------- 2. a mensagem que apontava para o lado
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='baixar_estoque_os';

  IF position('materiais_faltantes_da_os' in src) > 0 THEN RETURN; END IF;

  novo := replace(src,
    $old$    raise exception 'Não há material reservado para esta OS, então não há o que baixar. Gere a previsão de materiais e reserve o estoque antes de dar baixa.'
      using errcode = 'P0001';$old$,
    $new$    -- A mensagem antiga mandava "gerar a previsao e reservar", que e o que a
    -- conversao JA faz sozinha. O motivo real, quase sempre, e outro: nao ha
    -- material no estoque para reservar. Dizer QUAL e QUANTO poupa o operador
    -- de procurar o defeito no lugar errado.
    DECLARE v_falta text;
    BEGIN
      v_falta := public.materiais_faltantes_da_os(p_os_id);
      IF v_falta IS NOT NULL THEN
        raise exception 'Nao da para baixar: falta material no estoque. %', v_falta
          using errcode = 'P0001',
                hint = 'De entrada no estoque desses materiais e tente de novo.';
      END IF;
      raise exception 'Nao ha material reservado para esta OS, e nada consta como faltando. Confira a ficha do produto: sem receita, nao ha o que baixar.'
        using errcode = 'P0001';
    END;$new$);

  IF novo = src THEN RAISE EXCEPTION 'mensagem de baixar_estoque_os nao encontrada'; END IF;
  EXECUTE novo;
END $patch$;


-- --------------------------------------------- 3. o engolido deixa rastro
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='converter_orcamento_em_os';

  IF position('RAISE WARNING' in src) > 0 THEN RETURN; END IF;

  novo := replace(src,
    $old$  EXCEPTION WHEN OTHERS THEN
    v_reserva := jsonb_build_object('erro', SQLERRM);
  END;$old$,
    $new$  EXCEPTION WHEN OTHERS THEN
    v_reserva := jsonb_build_object('erro', SQLERRM);
    RAISE WARNING 'Conversao da OS %: previsao/reserva de material falhou: %', v_os_id, SQLERRM;
  END;$new$);

  IF novo = src THEN RAISE EXCEPTION 'bloco EXCEPTION da reserva nao encontrado'; END IF;
  EXECUTE novo;
END $patch$;


-- ------------------------------------------- 4. e vira aviso, não só exceção
DO $patch$
DECLARE src text; novo text; bloco text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='pendencias_do_sistema';

  IF position('os_sem_material_reservado' in src) > 0 THEN RETURN; END IF;

  bloco := $b$
  -- A OS foi aberta, o material foi previsto, e nao havia saldo para reservar.
  -- Hoje isso so aparecia como um campo `faltantes` no JSON que a conversao
  -- devolve — some assim que a tela fecha. Dai a OS nao pode baixar estoque,
  -- nao pode fechar, e ninguem sabe por que ate tentar.
  RETURN QUERY SELECT 'os_sem_material_reservado','OS esperando material que nao ha no estoque', count(*)::int,
    (SELECT count(*)::int FROM public.ordens_servico WHERE status NOT IN ('concluido','faturado','cancelado')),
    'critico','gestao',
    'A peca esta prometida e o material nao esta na prateleira. Abra a OS para ver o que falta e de entrada no estoque, ou avise o cliente do prazo. Enquanto faltar, a OS nao consegue dar baixa nem fechar.','/materiais'
  FROM public.ordens_servico o
  WHERE o.status NOT IN ('concluido','faturado','cancelado')
    AND public.materiais_faltantes_da_os(o.id) IS NOT NULL
  HAVING count(*) > 0;

$b$;

  novo := replace(src, E'\n  RETURN QUERY SELECT ''cliente_sem_contato''', bloco || E'\n  RETURN QUERY SELECT ''cliente_sem_contato''');
  IF novo = src THEN RAISE EXCEPTION 'ancora cliente_sem_contato nao encontrada'; END IF;
  EXECUTE novo;
END $patch$;

-- ENSAIADO, com reversão, no caso real (Adesivo jateado, 2 un):
--   falta                   -> "Vinil jateado (falta 2.10 m2)"
--   baixa sem material      -> "Nao da para baixar: falta material no estoque.
--                               Vinil jateado (falta 2.10 m2)"
--   pendência               -> 1 OS
--   depois de dar entrada   -> reserva e baixa funcionam
