-- Meta de vendas por pessoa, com nível Ouro e Diamante.
--
-- Decisão do Harison (21/10/2026): meta mensal de R$ 20 mil para a Jhesselem e
-- de R$ 10 mil para o Fernando e para o Leonardo. Bateu a meta = OURO, 1% da
-- OS; chegou ao DIAMANTE = 2,5% da OS. A ideia é que ouro vire obrigação.
--
-- Regras (e por que):
--  * "Vendido" = OS do mês (data de criação, hora de São Paulo) em que a pessoa
--    é `vendedor_id` ("quem trouxe a venda"), sem as canceladas. Enche a parte
--    clara da barra: é o que a pessoa já fechou.
--  * "Pago" = as mesmas OS com status_financeiro 'pago'. Enche a parte cheia da
--    barra e é o que define o NÍVEL. Comissão sobre venda não recebida é
--    adiantar dinheiro que pode não entrar (mesma razão de `comissoes`).
--  * O nível vale para TODAS as OS pagas do mês, não só as que passam da meta:
--    é o que faz ouro e diamante pagarem de verdade, e o primeiro real já conta.
--  * Diamante é atingido em `diamante_em_pct` da meta (padrão 150%).
--  * Nada é pago na hora. No fechamento do mês (`meta_fechar_mes`) o nível é
--    gravado e cada OS paga vira uma linha em `comissoes` (a tabela que o
--    financeiro já usa para pagar). Reexecutar o fechamento só acrescenta OS
--    que foram pagas depois, no % já gravado; o nível não muda.
--  * Quem tem meta não deve ter também `comissao_regras`, senão o gatilho de
--    pagamento lança 1 comissão e o fechamento ignora a OS (UNIQUE em os_id).
--
-- A tabela fica fora de `usuarios` pelo mesmo motivo de `comissao_regras`: lá
-- a pessoa edita a própria linha, e meta/percentual é decisão da gestão.
--
-- COMO DESFAZER:
--   drop function public.meta_fechar_mes(date); drop function public.meta_definir(uuid,date,numeric,numeric,numeric,numeric);
--   drop function public.meta_painel(date); drop function public.meta_comemorada(text);
--   drop function public.minha_meta(); drop function public.tg_meta_nivel(numeric,numeric,numeric);
--   drop table public.metas_vendas;
--   (comissões já lançadas ficam em `comissoes`; cancele-as por lá se for o caso)

-- ------------------------------------------------------------- 1. a tabela
CREATE TABLE IF NOT EXISTS public.metas_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  mes date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  meta numeric NOT NULL CHECK (meta > 0),
  pct_ouro numeric NOT NULL DEFAULT 1 CHECK (pct_ouro >= 0 AND pct_ouro <= 100),
  pct_diamante numeric NOT NULL DEFAULT 2.5 CHECK (pct_diamante >= 0 AND pct_diamante <= 100),
  diamante_em_pct numeric NOT NULL DEFAULT 150 CHECK (diamante_em_pct > 100 AND diamante_em_pct <= 1000),
  fechada_em timestamptz,
  nivel_fechado text CHECK (nivel_fechado IN ('nenhum','ouro','diamante')),
  pct_fechado numeric,
  pago_fechado numeric,
  comemorado_nivel text NOT NULL DEFAULT 'nenhum' CHECK (comemorado_nivel IN ('nenhum','ouro','diamante')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (usuario_id, mes)
);
COMMENT ON TABLE public.metas_vendas IS
  'Meta mensal de vendas por pessoa. Nível (ouro/diamante) e % da comissão; fechada no fim do mês por meta_fechar_mes().';

ALTER TABLE public.metas_vendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta: leitura" ON public.metas_vendas;
CREATE POLICY "meta: leitura" ON public.metas_vendas FOR SELECT
  USING (usuario_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_permission(auth.uid(), 'financeiro.read'));

-- Sem policy de escrita: quem grava são as funções abaixo (SECURITY DEFINER).

-- ------------------------------------------------------- 2. o nível pelo pago
CREATE OR REPLACE FUNCTION public.tg_meta_nivel(p_pago numeric, p_meta numeric, p_diamante_em numeric)
RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_meta IS NULL OR p_meta <= 0 THEN 'nenhum'
    WHEN p_pago >= p_meta * p_diamante_em / 100 THEN 'diamante'
    WHEN p_pago >= p_meta THEN 'ouro'
    ELSE 'nenhum' END;
$function$;

-- Vendido e pago de uma pessoa num mês (mês civil de São Paulo).
CREATE OR REPLACE FUNCTION public.tg_meta_realizado(p_usuario uuid, p_mes date)
RETURNS TABLE(vendido numeric, pago numeric, os_vendidas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(o.valor_total), 0),
         COALESCE(sum(o.valor_total) FILTER (WHERE o.status_financeiro::text = 'pago'), 0),
         count(*)::int
    FROM public.ordens_servico o
   WHERE o.vendedor_id = p_usuario
     AND o.status::text <> 'cancelado'
     AND (o.created_at AT TIME ZONE 'America/Sao_Paulo') >= p_mes::timestamp
     AND (o.created_at AT TIME ZONE 'America/Sao_Paulo') <  (p_mes + interval '1 month')::timestamp;
$function$;

-- Dias úteis (seg–sex) entre duas datas, as duas incluídas.
CREATE OR REPLACE FUNCTION public.tg_dias_uteis(p_de date, p_ate date)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $function$
  SELECT count(*)::int FROM generate_series(p_de, p_ate, interval '1 day') d
   WHERE extract(isodow FROM d) < 6;
$function$;

-- ------------------------------------------------- 3. a meta de quem está logado
CREATE OR REPLACE FUNCTION public.tg_meta_montar(m public.metas_vendas)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_fim date := (m.mes + interval '1 month - 1 day')::date;
  v_nivel text; v_nivel_se_receber text; v_pct numeric; v_pct_se_receber numeric;
  v_ouro numeric := m.meta; v_diamante numeric := m.meta * m.diamante_em_pct / 100;
  v_uteis_total int; v_uteis_passados int; v_uteis_restantes int;
  v_falta_prox numeric; v_prox text; v_proj numeric; v_ritmo numeric;
BEGIN
  SELECT * INTO r FROM public.tg_meta_realizado(m.usuario_id, m.mes);
  v_nivel := public.tg_meta_nivel(r.pago, m.meta, m.diamante_em_pct);
  v_nivel_se_receber := public.tg_meta_nivel(r.vendido, m.meta, m.diamante_em_pct);
  v_pct := CASE v_nivel WHEN 'diamante' THEN m.pct_diamante WHEN 'ouro' THEN m.pct_ouro ELSE 0 END;
  v_pct_se_receber := CASE v_nivel_se_receber WHEN 'diamante' THEN m.pct_diamante WHEN 'ouro' THEN m.pct_ouro ELSE 0 END;

  v_uteis_total := public.tg_dias_uteis(m.mes, v_fim);
  v_uteis_passados := CASE WHEN v_hoje < m.mes THEN 0 ELSE public.tg_dias_uteis(m.mes, LEAST(v_hoje, v_fim)) END;
  v_uteis_restantes := CASE WHEN v_hoje > v_fim THEN 0 ELSE public.tg_dias_uteis(GREATEST(v_hoje, m.mes), v_fim) END;

  -- Próximo degrau, pelo que já foi PAGO (é o que vale para o nível).
  IF r.pago < v_ouro THEN v_prox := 'ouro'; v_falta_prox := v_ouro - r.pago;
  ELSIF r.pago < v_diamante THEN v_prox := 'diamante'; v_falta_prox := v_diamante - r.pago;
  ELSE v_prox := NULL; v_falta_prox := 0; END IF;

  v_ritmo := CASE WHEN v_prox IS NULL OR v_uteis_restantes = 0 THEN NULL
                  ELSE round(v_falta_prox / v_uteis_restantes, 2) END;
  v_proj := CASE WHEN v_uteis_passados = 0 THEN NULL
                 ELSE round(r.vendido / v_uteis_passados * v_uteis_total, 2) END;

  RETURN jsonb_build_object(
    'meta_id', m.id, 'usuario_id', m.usuario_id, 'mes', m.mes,
    'meta', m.meta, 'ouro_em', v_ouro, 'diamante_em', v_diamante,
    'pct_ouro', m.pct_ouro, 'pct_diamante', m.pct_diamante, 'diamante_em_pct', m.diamante_em_pct,
    'vendido', r.vendido, 'pago', r.pago, 'os_vendidas', r.os_vendidas,
    'nivel', v_nivel, 'pct_atual', v_pct,
    'comissao_atual', round(r.pago * v_pct / 100, 2),
    'nivel_se_receber', v_nivel_se_receber,
    'comissao_se_receber', round(r.vendido * v_pct_se_receber / 100, 2),
    'proximo_nivel', v_prox, 'falta_proximo', v_falta_prox, 'ritmo_por_dia_util', v_ritmo,
    'dias_uteis_restantes', v_uteis_restantes, 'dias_uteis_total', v_uteis_total,
    'projecao_vendido', v_proj,
    'fechada', m.fechada_em IS NOT NULL, 'nivel_fechado', m.nivel_fechado,
    'pct_fechado', m.pct_fechado, 'comemorado_nivel', m.comemorado_nivel
  );
END;
$function$;

-- O que é MEU eu vejo sem permissão financeira: é a minha meta.
CREATE OR REPLACE FUNCTION public.minha_meta()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE m public.metas_vendas;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.metas_vendas
   WHERE usuario_id = auth.uid()
     AND mes = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.tg_meta_montar(m);
END;
$function$;

-- Placar da gestão: todas as metas do mês, com nome.
CREATE OR REPLACE FUNCTION public.meta_painel(p_mes date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_mes date := COALESCE(date_trunc('month', p_mes)::date,
                               date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date);
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')
          OR public.has_permission(auth.uid(),'financeiro.read')) THEN
    RAISE EXCEPTION 'Sem permissão para ver as metas da equipe' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.tg_meta_montar(m) || jsonb_build_object('usuario_nome', u.nome) ORDER BY u.nome)
      FROM public.metas_vendas m JOIN public.usuarios u ON u.id = m.usuario_id
     WHERE m.mes = v_mes), '[]'::jsonb);
END;
$function$;

-- Marca que a comemoração do nível já foi vista, para não repetir a cada abertura.
CREATE OR REPLACE FUNCTION public.meta_comemorada(p_nivel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_mes date := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF p_nivel NOT IN ('ouro','diamante') THEN
    RAISE EXCEPTION 'Nível inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.metas_vendas
     SET comemorado_nivel = p_nivel
   WHERE usuario_id = auth.uid() AND mes = v_mes
     AND (comemorado_nivel = 'nenhum' OR (comemorado_nivel = 'ouro' AND p_nivel = 'diamante'));
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ------------------------------------------------------ 4. a gestão define
CREATE OR REPLACE FUNCTION public.meta_definir(
  p_usuario_id uuid, p_mes date, p_meta numeric,
  p_pct_ouro numeric DEFAULT 1, p_pct_diamante numeric DEFAULT 2.5, p_diamante_em_pct numeric DEFAULT 150)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_mes date := date_trunc('month', p_mes)::date;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')) THEN
    RAISE EXCEPTION 'Só a gestão define metas' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id = u.id
                  WHERE u.id = p_usuario_id AND u.ativo AND ur.role NOT IN ('cliente','parceiro')) THEN
    RAISE EXCEPTION 'Essa pessoa não está na equipe ativa' USING ERRCODE = '22023';
  END IF;
  IF p_pct_diamante < p_pct_ouro THEN
    RAISE EXCEPTION 'O diamante não pode pagar menos que o ouro' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.metas_vendas WHERE usuario_id = p_usuario_id AND mes = v_mes AND fechada_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Esse mês já foi fechado' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.metas_vendas (usuario_id, mes, meta, pct_ouro, pct_diamante, diamante_em_pct, updated_by)
  VALUES (p_usuario_id, v_mes, p_meta, p_pct_ouro, p_pct_diamante, p_diamante_em_pct, auth.uid())
  ON CONFLICT (usuario_id, mes) DO UPDATE
    SET meta = EXCLUDED.meta, pct_ouro = EXCLUDED.pct_ouro, pct_diamante = EXCLUDED.pct_diamante,
        diamante_em_pct = EXCLUDED.diamante_em_pct, updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Fecha o mês: grava o nível e lança as comissões das OS pagas. Pode rodar de
-- novo: só acrescenta OS pagas depois, no % já gravado.
CREATE OR REPLACE FUNCTION public.meta_fechar_mes(p_mes date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mes date := date_trunc('month', p_mes)::date;
  v_atual date := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
  m public.metas_vendas; r record; v_nivel text; v_pct numeric; v_lancadas int; v_total numeric;
  v_resumo jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')
          OR public.has_permission(auth.uid(),'pagamentos.confirm')) THEN
    RAISE EXCEPTION 'Sem permissão para fechar o mês' USING ERRCODE = '42501';
  END IF;
  IF v_mes >= v_atual THEN
    RAISE EXCEPTION 'O mês só fecha depois de terminar' USING ERRCODE = '22023';
  END IF;

  FOR m IN SELECT * FROM public.metas_vendas WHERE mes = v_mes ORDER BY usuario_id FOR UPDATE LOOP
    SELECT * INTO r FROM public.tg_meta_realizado(m.usuario_id, m.mes);
    IF m.fechada_em IS NULL THEN
      v_nivel := public.tg_meta_nivel(r.pago, m.meta, m.diamante_em_pct);
      v_pct := CASE v_nivel WHEN 'diamante' THEN m.pct_diamante WHEN 'ouro' THEN m.pct_ouro ELSE 0 END;
      UPDATE public.metas_vendas
         SET fechada_em = now(), nivel_fechado = v_nivel, pct_fechado = v_pct, pago_fechado = r.pago,
             updated_at = now(), updated_by = auth.uid()
       WHERE id = m.id;
    ELSE
      v_nivel := m.nivel_fechado; v_pct := m.pct_fechado;
    END IF;

    v_lancadas := 0; v_total := 0;
    IF v_pct > 0 THEN
      WITH nova AS (
        INSERT INTO public.comissoes (os_id, usuario_id, base, pct, valor, observacao)
        SELECT o.id, m.usuario_id, o.valor_total, v_pct, round(o.valor_total * v_pct / 100, 2),
               'Meta de ' || to_char(m.mes, 'MM/YYYY') || ' — nível ' || v_nivel
          FROM public.ordens_servico o
         WHERE o.vendedor_id = m.usuario_id
           AND o.status::text <> 'cancelado'
           AND o.status_financeiro::text = 'pago'
           AND o.valor_total > 0
           AND (o.created_at AT TIME ZONE 'America/Sao_Paulo') >= m.mes::timestamp
           AND (o.created_at AT TIME ZONE 'America/Sao_Paulo') <  (m.mes + interval '1 month')::timestamp
        ON CONFLICT (os_id) DO NOTHING
        RETURNING valor)
      SELECT count(*), COALESCE(sum(valor), 0) INTO v_lancadas, v_total FROM nova;
    END IF;

    v_resumo := v_resumo || jsonb_build_object(
      'usuario_id', m.usuario_id, 'nivel', v_nivel, 'pct', v_pct,
      'pago', r.pago, 'comissoes_lancadas', v_lancadas, 'valor_lancado', v_total);
  END LOOP;

  RETURN jsonb_build_object('mes', v_mes, 'pessoas', v_resumo);
END;
$function$;

-- ------------------------------------------------------------- 5. permissões
REVOKE ALL ON FUNCTION public.tg_meta_nivel(numeric,numeric,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_dias_uteis(date,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_meta_realizado(uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_meta_montar(public.metas_vendas) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.minha_meta() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_painel(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_comemorada(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_definir(uuid,date,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_fechar_mes(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_meta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_painel(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_comemorada(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_definir(uuid,date,numeric,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_fechar_mes(date) TO authenticated;

-- ---------------------------------------------------------------- 6. as metas
-- Outubro (em curso) e novembro, mesmos valores. Procura pelo e-mail, não por
-- nome: se alguém não existir, a linha simplesmente não nasce.
INSERT INTO public.metas_vendas (usuario_id, mes, meta)
SELECT u.id, m.mes, v.meta
  FROM (VALUES ('medeirosketellem@gmail.com', 20000),
               ('fa6937895@gmail.com', 10000),
               ('leolpmalmeida@gmail.com', 10000)) AS v(email, meta)
  JOIN public.usuarios u ON lower(u.email) = lower(v.email)
 CROSS JOIN (VALUES (date '2026-10-01'), (date '2026-11-01')) AS m(mes)
ON CONFLICT (usuario_id, mes) DO NOTHING;
