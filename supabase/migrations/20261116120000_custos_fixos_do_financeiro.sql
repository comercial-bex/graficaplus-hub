-- =====================================================================================================
-- CUSTOS FIXOS PELO FINANCEIRO (16/11/2026)
-- Ensaio com RAISE EXCEPTION final no banco vivo em docs/ensaio-custos-fixos-financeiro.md (simulando admin, gestor,
-- financeiro e vendedor). A aplicacao e feita depois, pelo dono, na ordem 20261116100000, 20261116110000 e esta.
-- O preco de NENHUM produto muda aqui: nada toca produtos, produto_precos, orcamentos nem itens. A funcao nova
-- recusa preco_base, margem, markup, imposto, perda e todo codigo fora da lista.
--
-- 1) Permissao custos.fixos.update, em permissoes e em perfil_permissoes para admin, gestor e financeiro. Ninguem
--    ganha custos.update por isso: o financeiro continua sem escrever na tabela de custos pela porta comum.
-- 2) confirmar_custo_fixo(p_codigo, p_valor, p_confirmar default true): SECURITY DEFINER, exige custos.fixos.update
--    pela funcao de permissao do repo (require_permission, que olha has_permission), so aceita os nove codigos do
--    contrato mais energia_tarifa_kwh (custo fixo que ja existia e e seguro), grava o valor e, so quando
--    p_confirmar, grava confirmado_por (auth.uid) e confirmado_em. EXECUTE so para authenticated.
--    A tela passa a chamar esta funcao nos dois botoes, salvar e confirmar e salvar sem confirmar. Nao ha mais
--    UPDATE direto em custos_tabela vindo dela.
-- 3) custos_tabela_log trocada na definicao viva (md5 conferido): quando a funcao acima grava SEM confirmar, o
--    gatilho nao confirma sozinho. A regra de 20261116100000 (mudar o numero confirma) segue valendo para qualquer
--    outra escrita, como a tela de parametros da casa. A exclusao vale so para a linha que a funcao esta gravando,
--    marcada por uma configuracao local da transacao com o id da linha, e some no fim da transacao.
--
-- ORDEM DE APLICACAO: depois de 20261116100000 (colunas confirmado_em e confirmado_por e o gatilho custos_tabela_log
-- que esta migracao troca) e de 20261116110000 (pendencias_de_custo, que le confirmado_em). Aplicar as tres juntas.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Troca na definicao viva: o corpo de custos_tabela_log tem de ser o de 20261116100000.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_h text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.custos_tabela'::regclass AND a.attname = 'confirmado_em' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = 'public.custos_tabela'::regclass AND a.attname = 'confirmado_por' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'custos_tabela sem confirmado_em e confirmado_por. Aplique 20261116100000 antes desta.';
  END IF;

  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'custos_tabela_log';
  IF v_h IS DISTINCT FROM 'ed5d77189445ddcb6f068e1d588a3df2' THEN
    RAISE EXCEPTION 'custos_tabela_log mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  IF to_regprocedure('public.require_permission(text)') IS NULL OR to_regprocedure('public.has_permission(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'a função de permissão do repo (require_permission) não existe';
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Permissao custos.fixos.update (perfil_permissoes tem chave estrangeira para permissoes).
-- ---------------------------------------------------------------------------------------------------
INSERT INTO public.permissoes (chave, dominio, descricao)
VALUES ('custos.fixos.update', 'resultado', 'Preencher e confirmar os custos fixos da gráfica')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT p.perfil, 'custos.fixos.update'
  FROM (VALUES ('admin'), ('gestor'), ('financeiro')) AS p(perfil)
ON CONFLICT (perfil, permissao) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------
-- 3. custos_tabela_log: igual a de 20261116100000, mais uma excecao. Se a funcao confirmar_custo_fixo marcou
--    ESTA linha como "gravar sem confirmar", mudar o numero nao confirma.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custos_tabela_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quem uuid := (SELECT u.id FROM public.usuarios u WHERE u.id = auth.uid());
  v_sem_confirmar boolean := COALESCE(current_setting('bex.custo_sem_confirmar', true), '') = NEW.id::text;
BEGIN
  NEW.updated_at = now();
  IF TG_OP = 'UPDATE' AND NEW.valor IS DISTINCT FROM OLD.valor THEN
    INSERT INTO public.custos_tabela_historico (custo_id, codigo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, NEW.codigo, OLD.valor, NEW.valor, auth.uid());
    IF v_sem_confirmar THEN
      NEW.confirmado_em := NULL;
      NEW.confirmado_por := NULL;
    ELSIF NEW.confirmado_em IS NOT DISTINCT FROM OLD.confirmado_em THEN
      IF NEW.valor IS NULL THEN
        NEW.confirmado_em := NULL;
        NEW.confirmado_por := NULL;
      ELSE
        NEW.confirmado_em := now();
        NEW.confirmado_por := COALESCE(v_quem, NEW.confirmado_por);
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.confirmado_em IS DISTINCT FROM OLD.confirmado_em
        AND NEW.confirmado_em IS NOT NULL AND v_quem IS NOT NULL THEN
    NEW.confirmado_por := v_quem;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.custos_tabela_log() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. confirmar_custo_fixo
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_custo_fixo(p_codigo text, p_valor numeric, p_confirmar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Os nove codigos do contrato e o unico custo fixo anterior que e seguro. Nunca preco_base, margem, markup,
  -- imposto, taxa, perda, mao de obra ou chave.
  c_permitidos constant text[] := ARRAY[
    'aluguel_espaco_mensal', 'outros_fixos_admin_mes', 'plotter_horas_mes_reais', 'energia_comercial_tarifa_kwh',
    'tinta_consumo_ml_m2', 'plotter_manutencao_mensal', 'plotter_cabecote_custo', 'plotter_cabecote_vida_m2',
    'plotter_limpeza_mensal', 'energia_tarifa_kwh'];
  v_uid uuid;
  v_quem uuid;
  v_id uuid;
  v_em timestamptz;
  v_por uuid;
BEGIN
  -- Permissao pela funcao do repo: sem login ou sem custos.fixos.update, para aqui.
  v_uid := public.require_permission('custos.fixos.update');

  IF p_codigo IS NULL OR NOT (p_codigo = ANY (c_permitidos)) THEN
    RAISE EXCEPTION 'Este custo não pode ser alterado por aqui.' USING ERRCODE = '22023';
  END IF;
  IF p_confirmar IS NULL THEN
    RAISE EXCEPTION 'Diga se o custo fica confirmado ou pendente.' USING ERRCODE = '22023';
  END IF;
  IF p_valor IS NULL OR p_valor < 0 OR p_valor > 1000000000 THEN
    RAISE EXCEPTION 'Digite um número válido para o custo.' USING ERRCODE = '22023';
  END IF;
  -- Zero so vale onde zero e uma resposta: nao ha outros custos fixos no mes.
  IF p_valor = 0 AND p_codigo <> 'outros_fixos_admin_mes' THEN
    RAISE EXCEPTION 'Este custo não pode ser zero.' USING ERRCODE = '22023';
  END IF;

  SELECT c.id INTO v_id FROM public.custos_tabela c WHERE c.codigo = p_codigo AND c.ativo FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Este custo ainda não existe no banco. Avise o suporte.' USING ERRCODE = 'P0002';
  END IF;

  -- confirmado_por aponta para usuarios, o mesmo id do login. Sem linha em usuarios fica nulo, nao barra.
  v_quem := (SELECT u.id FROM public.usuarios u WHERE u.id = v_uid);

  -- Marca esta linha para o gatilho nao confirmar sozinho. Vale so nesta transacao.
  PERFORM set_config('bex.custo_sem_confirmar', CASE WHEN p_confirmar THEN '' ELSE v_id::text END, true);

  UPDATE public.custos_tabela
     SET valor = p_valor,
         confirmado_em = CASE WHEN p_confirmar THEN now() ELSE NULL END,
         confirmado_por = CASE WHEN p_confirmar THEN v_quem ELSE NULL END
   WHERE id = v_id;

  PERFORM set_config('bex.custo_sem_confirmar', '', true);

  SELECT c.confirmado_em, c.confirmado_por INTO v_em, v_por FROM public.custos_tabela c WHERE c.id = v_id;

  RETURN jsonb_build_object('codigo', p_codigo, 'valor', p_valor, 'confirmado', v_em IS NOT NULL,
                            'confirmado_em', v_em, 'confirmado_por', v_por);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) TO authenticated;

COMMENT ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) IS
  'Grava um custo fixo da gráfica. Exige custos.fixos.update. Só aceita os nove códigos do contrato e energia_tarifa_kwh. Confirma só quando p_confirmar.';

-- ---------------------------------------------------------------------------------------------------
-- Conferencia final: a migracao para se algo nao ficou como deveria.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXECUTE de confirmar_custo_fixo deveria ser só de authenticated';
  END IF;
  IF (SELECT count(*) FROM public.perfil_permissoes WHERE permissao = 'custos.fixos.update'
         AND perfil IN ('admin', 'gestor', 'financeiro')) <> 3 THEN
    RAISE EXCEPTION 'custos.fixos.update não ficou com admin, gestor e financeiro';
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfil_permissoes WHERE permissao = 'custos.fixos.update'
              AND perfil NOT IN ('admin', 'gestor', 'financeiro')) THEN
    RAISE EXCEPTION 'custos.fixos.update foi para um perfil que não devia';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.confirmar_custo_fixo(text, numeric, boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'confirmar_custo_fixo deveria ser SECURITY DEFINER';
  END IF;
END
$confere$;

COMMIT;
