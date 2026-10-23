-- Versão congelada do orçamento ao enviar e ao aprovar (22/10/2026, R1 do plano).
--
-- Havia 0 linhas em orcamento_versoes para 26 orçamentos enviados ou aprovados:
-- se um preço mudasse depois, não havia como provar o que o cliente recebeu e
-- aprovou, e a OS herdava o valor "vivo". `aprovar_orcamento` congelava, mas a
-- tela nunca o chamava (o status ia por UPDATE direto) e o link público também
-- não. A trava tem de estar onde TODAS as portas passam: o banco.
--
-- Um gatilho BEFORE UPDATE OF status congela a versão quando o status VIRA
-- enviado ou aprovado: o retrato dos itens e do total, por item, sem custo,
-- margem nem token do link público (a leitura da versão é de quem vê preço).
-- Roda por último entre os BEFORE ("zz_"): os totais já foram refeitos.
--
-- Se a versão mais recente já tem o mesmo conteúdo (hash dos itens + total), é
-- ela que vale; se o conteúdo mudou, nasce a próxima. A aprovada vira
-- `versao_aprovada_id`.
--
-- Mudou depois de enviado? `orcamento_diferenca_da_versao` diz, e a conversão em
-- OS recusa quando o valor de hoje não é o que o cliente aprovou.
-- Os 27 orçamentos que já estavam enviados, aprovados ou convertidos ganham a
-- versão 1 marcada `retroativa`: é o retrato de hoje, não do dia do envio.

-- 1. O conteúdo, em uma conta só ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.orcamento_itens_para_versao(p_orcamento uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(
           to_jsonb(i) - 'custo_unitario' - 'custo_previsto' - 'margem_prevista' - 'parametros' - 'produto_snapshot'
           ORDER BY i.ordem, i.id), '[]'::jsonb)
    FROM public.orcamento_itens i WHERE i.orcamento_id = p_orcamento
$function$;
REVOKE ALL ON FUNCTION public.orcamento_itens_para_versao(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.orcamento_hash_atual(p_orcamento uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT md5(public.orcamento_itens_para_versao(p_orcamento)::text || '|' || coalesce(
           (SELECT o.valor_total::text FROM public.orcamentos o WHERE o.id = p_orcamento), '0'))
$function$;
REVOKE ALL ON FUNCTION public.orcamento_hash_atual(uuid) FROM PUBLIC, anon, authenticated;

-- 2. O gatilho ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_orcamento_congela_versao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_itens jsonb := public.orcamento_itens_para_versao(NEW.id);
  v_hash text := md5(v_itens::text || '|' || coalesce(NEW.valor_total::text, '0'));
  v_ultima public.orcamento_versoes%ROWTYPE;
  v_id uuid;
  v_aprovando boolean := NEW.status::text = 'aprovado';
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_ultima FROM public.orcamento_versoes
   WHERE orcamento_id = NEW.id ORDER BY numero_versao DESC LIMIT 1;

  IF FOUND AND v_ultima.snapshot->>'hash' = v_hash THEN
    v_id := v_ultima.id;
    UPDATE public.orcamento_versoes
       SET status = CASE WHEN v_aprovando THEN 'aprovada' ELSE status END,
           enviada_em = CASE WHEN NOT v_aprovando THEN coalesce(enviada_em, now()) ELSE enviada_em END,
           aprovada_em = CASE WHEN v_aprovando THEN coalesce(aprovada_em, now()) ELSE aprovada_em END,
           aprovado_por = CASE WHEN v_aprovando THEN coalesce(aprovado_por, v_uid) ELSE aprovado_por END
     WHERE id = v_id;
  ELSE
    INSERT INTO public.orcamento_versoes
      (orcamento_id, numero_versao, status, snapshot, valor_total, enviada_em, aprovada_em, aprovado_por, created_by)
    VALUES (NEW.id, coalesce(v_ultima.numero_versao, 0) + 1,
            CASE WHEN v_aprovando THEN 'aprovada' ELSE 'enviada' END,
            jsonb_build_object(
              'hash', v_hash,
              'orcamento', to_jsonb(NEW) - 'custo_estimado' - 'margem_estimada' - 'token_publico' - 'aprovado_ip',
              'itens', v_itens),
            NEW.valor_total,
            CASE WHEN NOT v_aprovando THEN now() END,
            CASE WHEN v_aprovando THEN now() END,
            CASE WHEN v_aprovando THEN v_uid END,
            v_uid)
    RETURNING id INTO v_id;

    INSERT INTO public.orcamento_versao_itens (versao_id, orcamento_item_id, snapshot, ordem)
    SELECT v_id, (e->>'id')::uuid, e, (e->>'ordem')::int
      FROM jsonb_array_elements(v_itens) e;
  END IF;

  IF v_aprovando THEN NEW.versao_aprovada_id := v_id; END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.tg_orcamento_congela_versao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_orcamento_congela_versao ON public.orcamentos;
CREATE TRIGGER zz_orcamento_congela_versao
  BEFORE UPDATE OF status ON public.orcamentos
  FOR EACH ROW
  WHEN (NEW.status::text IN ('enviado', 'aprovado') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_orcamento_congela_versao();

-- 3. Mudou depois de enviado? -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orcamento_diferenca_da_versao(p_orcamento uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ultima public.orcamento_versoes%ROWTYPE;
  v_atual numeric;
BEGIN
  IF v_uid IS NULL OR NOT public.can_see_prices(v_uid) THEN
    RETURN jsonb_build_object('tem_versao', false);
  END IF;
  SELECT * INTO v_ultima FROM public.orcamento_versoes
   WHERE orcamento_id = p_orcamento ORDER BY numero_versao DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('tem_versao', false); END IF;
  SELECT valor_total INTO v_atual FROM public.orcamentos WHERE id = p_orcamento;
  RETURN jsonb_build_object(
    'tem_versao', true,
    'numero', v_ultima.numero_versao,
    'status', v_ultima.status,
    'retroativa', coalesce((v_ultima.snapshot->>'retroativa')::boolean, false),
    'valor_da_versao', v_ultima.valor_total,
    'valor_atual', v_atual,
    'enviada_em', v_ultima.enviada_em,
    'aprovada_em', v_ultima.aprovada_em,
    'mudou', v_ultima.snapshot->>'hash' IS DISTINCT FROM public.orcamento_hash_atual(p_orcamento),
    'valor_mudou', v_ultima.valor_total IS DISTINCT FROM v_atual);
END $function$;
REVOKE ALL ON FUNCTION public.orcamento_diferenca_da_versao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_diferenca_da_versao(uuid) TO authenticated;

-- 4. A conversão recusa valor diferente do aprovado ----------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_em_os'::regproc);
  v_de text := E'  -- (b) desconto que passou da alçada precisa de aprovação válida\n';
  v_para text := E'  -- (a2) o valor de hoje é o que o cliente aprovou? (22/10/2026)\n'
    || E'  DECLARE v_aprov numeric;\n'
    || E'  BEGIN\n'
    || E'    SELECT v.valor_total INTO v_aprov FROM public.orcamento_versoes v WHERE v.id = v_orc.versao_aprovada_id;\n'
    || E'    IF v_aprov IS NOT NULL AND v_aprov IS DISTINCT FROM v_orc.valor_total THEN\n'
    || E'      RAISE EXCEPTION ''O orçamento mudou depois de aprovado: o cliente aprovou R$ % e hoje está R$ %. Volte o valor ou peça nova aprovação (marque como enviado e aprovado de novo) antes de converter.'',\n'
    || E'        to_char(v_aprov, ''FM999G999G990D00''), to_char(v_orc.valor_total, ''FM999G999G990D00'')\n'
    || E'        USING ERRCODE = ''P0001'';\n'
    || E'    END IF;\n'
    || E'  END;\n\n'
    || v_de;
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 5. Os que já estavam enviados, aprovados ou convertidos ---------------------------------
DO $m$
DECLARE
  o record;
  v_itens jsonb;
  v_hash text;
  v_id uuid;
BEGIN
  FOR o IN
    SELECT * FROM public.orcamentos
     WHERE status::text IN ('enviado', 'aprovado', 'convertido')
       AND NOT EXISTS (SELECT 1 FROM public.orcamento_versoes v WHERE v.orcamento_id = orcamentos.id)
  LOOP
    v_itens := public.orcamento_itens_para_versao(o.id);
    v_hash := md5(v_itens::text || '|' || coalesce(o.valor_total::text, '0'));
    INSERT INTO public.orcamento_versoes
      (orcamento_id, numero_versao, status, snapshot, valor_total, enviada_em, aprovada_em)
    VALUES (o.id, 1,
            CASE WHEN o.status::text = 'enviado' THEN 'enviada' ELSE 'aprovada' END,
            jsonb_build_object('hash', v_hash, 'retroativa', true,
                               'orcamento', to_jsonb(o) - 'custo_estimado' - 'margem_estimada' - 'token_publico' - 'aprovado_ip',
                               'itens', v_itens),
            o.valor_total, o.enviado_em, o.aprovado_em)
    RETURNING id INTO v_id;
    INSERT INTO public.orcamento_versao_itens (versao_id, orcamento_item_id, snapshot, ordem)
    SELECT v_id, (e->>'id')::uuid, e, (e->>'ordem')::int FROM jsonb_array_elements(v_itens) e;
    IF o.status::text IN ('aprovado', 'convertido') AND o.versao_aprovada_id IS NULL THEN
      UPDATE public.orcamentos SET versao_aprovada_id = v_id WHERE id = o.id;
    END IF;
  END LOOP;
END $m$;
