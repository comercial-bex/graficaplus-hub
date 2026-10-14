-- Kanban, avisos ao cliente e vencimento da parcela (13/10/2026).
--
-- Decisões do dono em 13/10, depois da auditoria do caminho
-- orçamento → OS → Kanban → WhatsApp:
--   "Quais colunas avisam o cliente? … também Saída para entrega, e
--    Pré-impressão quando houver arte para aprovar" — "sim concordo";
--   "Quando vence a parcela?" — "sim pode fazer" (vencer na saída do pedido,
--    não no dia da conversão);
--   "Quem pode mover o Kanban?" — "todos, mas mostrar o registro de quem fez e
--    quando fez" (o registro já existe em os_status_historico; é a tela que o
--    mostra — sem mudança aqui).
--
-- 1. Saída para entrega avisa ("pronto, vamos combinar a entrega").
-- 2. A arte para aprovar vai COM o link de aprovação. O aviso nascia dentro de
--    criar_link_aprovacao, antes de o link existir para mais ninguém; agora o
--    link entra nas variáveis. E a 2ª arte (depois de um ajuste) ganha aviso
--    próprio: a chave de deduplicação era a mesma para todas.
-- 3. OS concluída não volta pelo quadro: voltar para Produção mandava "entrou
--    em produção" a quem já estava com a peça (a #44 estava a um arrasto disso).
-- 4. "A OS nao pode fechar ainda" ganha o acento: sem ele o tradutor de erros
--    da tela trocava a frase pela mensagem genérica, e as travas do fechamento
--    nunca apareciam no quadro, no painel nem na ficha.
-- 5. Parcela única sem data no acordo vence na SAÍDA do pedido (pronto para
--    retirar/entregar, em entrega, instalação ou concluído), não no dia da
--    conversão. As 6 parcelas de 13/10 (R$ 3.746,60) ficam sem vencimento até
--    a saída — o lembrete do financeiro de 14/10 as listaria como vencidas.
-- 6. Orçamento com 3D vinculado converte pela porta do 3D: pela porta comum
--    nascia uma OS, e o 3D, sem OS, oferecia "Converter" de novo.

-- 0. Endereço público do sistema (link que vai ao cliente) ------------------
CREATE OR REPLACE FUNCTION public.url_publica_do_sistema()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$ SELECT 'https://bexprint.com.br' $function$;
COMMENT ON FUNCTION public.url_publica_do_sistema() IS
  'Endereço do sistema para links que vão ao cliente (aprovação de arte). Um lugar só.';
REVOKE ALL ON FUNCTION public.url_publica_do_sistema() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.url_publica_do_sistema() TO authenticated, service_role;

-- 1. Marcos que avisam o cliente --------------------------------------------
CREATE OR REPLACE FUNCTION public.marco_notificavel_os(_status status_os)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _status = 'aguardando_aprovacao_arte' THEN 'os_arte_para_aprovar'
    WHEN public.etapa_da_os(_status) = 'producao' THEN 'os_em_producao'
    WHEN _status = 'aguardando_retirada' THEN 'os_pronta_retirada'
    WHEN _status = 'aguardando_entrega' THEN 'os_pronta_entrega'
    WHEN _status = 'em_entrega' THEN 'os_saiu_entrega'
    WHEN _status = 'concluido' THEN 'os_concluida'
    ELSE NULL END
$function$;

INSERT INTO public.notificacao_templates (evento, canal, corpo, descricao, ativo)
VALUES (
  'os_pronta_entrega', 'whatsapp',
  '{{cliente}}, seu pedido {{os_numero}} ({{os_titulo}}) está pronto. Vamos combinar a entrega: responda por aqui com o melhor dia e horário.',
  'Pedido pronto, aguardando entrega', true
)
ON CONFLICT (evento) DO NOTHING;

-- O texto da arte ganha o link — só se ainda for o texto de fábrica (o dono
-- pode ter editado em Avisos; o dele vale).
UPDATE public.notificacao_templates
   SET corpo = E'Oi, {{cliente}}! A arte do pedido {{os_numero}} ({{os_titulo}}) está pronta para sua aprovação.\n{{como_aprovar}}\nAssim que você aprovar, entra na fila de produção.'
 WHERE evento = 'os_arte_para_aprovar'
   AND corpo = 'Oi, {{cliente}}! A arte do pedido {{os_numero}} ({{os_titulo}}) está pronta para sua aprovação. Assim que você aprovar, entra na fila de produção.';

-- 2. O aviso da OS, num lugar só ---------------------------------------------
CREATE OR REPLACE FUNCTION public._os_enfileirar_aviso(p_os public.ordens_servico, p_evento text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente public.clientes%ROWTYPE;
  v_link text := nullif(current_setting('app.link_aprovacao', true), '');
  v_chave text;
BEGIN
  SELECT * INTO v_cliente FROM public.clientes WHERE id = p_os.cliente_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Todas as máquinas são "em produção": o cliente é avisado uma vez. A arte,
  -- uma vez por link — a 2ª arte (depois de um ajuste) é outro aviso.
  v_chave := CASE
    WHEN p_evento = 'os_em_producao' THEN 'em_producao'
    WHEN p_evento = 'os_arte_para_aprovar' AND v_link IS NOT NULL THEN 'arte:' || left(md5(v_link), 12)
    ELSE p_os.status::text END;
  RETURN public.enfileirar_notificacao('whatsapp',
    COALESCE(v_cliente.whatsapp_principal, v_cliente.telefone), v_cliente.id, p_evento,
    'ordem_servico', p_os.id, p_evento,
    jsonb_build_object('cliente', v_cliente.nome, 'os_numero', p_os.numero,
      'os_titulo', p_os.titulo, 'os_id', p_os.id, 'prazo', p_os.prazo_entrega,
      'link', v_link,
      'como_aprovar', CASE WHEN v_link IS NOT NULL
                           THEN 'Veja e aprove por este link: ' || v_link
                           ELSE 'Responda por aqui aprovando ou pedindo um ajuste.' END),
    'os:' || p_os.id::text || ':' || v_chave);
END $function$;
COMMENT ON FUNCTION public._os_enfileirar_aviso(public.ordens_servico, text) IS
  'Enfileira o aviso de um marco da OS para o cliente (WhatsApp). Usada pelo gatilho de status e por criar_link_aprovacao.';
REVOKE ALL ON FUNCTION public._os_enfileirar_aviso(public.ordens_servico, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._os_enfileirar_aviso(public.ordens_servico, text) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_os_notificar_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_evento text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_evento := public.marco_notificavel_os(NEW.status);
  IF v_evento IS NULL THEN RETURN NEW; END IF;
  PERFORM public._os_enfileirar_aviso(NEW, v_evento);
  RETURN NEW;
END $function$;

-- 2b. criar_link_aprovacao entrega o link ao aviso ---------------------------
DO $link$
DECLARE
  v_def text := pg_get_functiondef('public.criar_link_aprovacao(uuid, integer)'::regprocedure);
  v_de text := E'  perform set_config(''app.avancar_os_status'', ''on'', true);\n  update public.ordens_servico set status = ''aguardando_aprovacao_arte''\n   where id = v_arquivo.os_id and status not in (''concluido'',''faturado'',''cancelado'');\n  perform set_config(''app.avancar_os_status'', ''off'', true);\n';
  v_para text := E'  -- O aviso ao cliente leva o link (13/10/2026): o gatilho de status lê esta\n'
    || E'  -- variável. Se a OS já esperava aprovação (2ª arte), o aviso sai daqui.\n'
    || E'  perform set_config(''app.link_aprovacao'', public.url_publica_do_sistema() || ''/aprovar/'' || v_token, true);\n'
    || E'  if exists (select 1 from public.ordens_servico where id = v_arquivo.os_id and status = ''aguardando_aprovacao_arte'') then\n'
    || E'    perform public._os_enfileirar_aviso(o, ''os_arte_para_aprovar'') from public.ordens_servico o where o.id = v_arquivo.os_id;\n'
    || E'  end if;\n'
    || E'  perform set_config(''app.avancar_os_status'', ''on'', true);\n'
    || E'  update public.ordens_servico set status = ''aguardando_aprovacao_arte''\n'
    || E'   where id = v_arquivo.os_id and status not in (''concluido'',''faturado'',''cancelado'');\n'
    || E'  perform set_config(''app.avancar_os_status'', ''off'', true);\n'
    || E'  perform set_config(''app.link_aprovacao'', '''', true);\n';
BEGIN
  IF position('app.link_aprovacao' IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'criar_link_aprovacao: o trecho da mudança de status não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$link$;

-- 3 e 4. avancar_os_status: OS concluída não volta; travas do fechamento com acento
DO $avancar$
DECLARE
  v_def text := pg_get_functiondef('public.avancar_os_status(uuid, public.status_os)'::regprocedure);
  v_de1 text := E'  IF v_os.status = novo_status THEN\n    RETURN v_os;\n  END IF;\n';
  v_para1 text := E'  IF v_os.status = novo_status THEN\n    RETURN v_os;\n  END IF;\n\n'
    || E'  -- OS concluída não volta pelo quadro (13/10/2026): voltar para Produção\n'
    || E'  -- avisaria "entrou em produção" a quem já está com a peça.\n'
    || E'  IF v_os.status IN (''concluido'',''faturado'') AND novo_status NOT IN (''concluido'',''faturado'') THEN\n'
    || E'    RAISE EXCEPTION ''A OS nº % já foi concluída e não volta pelo quadro. Se precisa refazer o serviço, abra uma nova OS.'', v_os.numero;\n'
    || E'  END IF;\n';
  v_de2 text := E'RAISE EXCEPTION ''A OS nao pode fechar ainda: %.'', v_texto;';
  v_para2 text := E'RAISE EXCEPTION ''A OS não pode fechar ainda: %.'', v_texto;';
BEGIN
  IF position('não volta pelo quadro' IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de1, ''))) / length(v_de1) <> 1
     OR (length(v_def) - length(replace(v_def, v_de2, ''))) / length(v_de2) <> 1 THEN
    RAISE EXCEPTION 'avancar_os_status: os trechos não estão como esperado; revise a troca';
  END IF;
  EXECUTE replace(replace(v_def, v_de1, v_para1), v_de2, v_para2);
END
$avancar$;

-- 5. Vencimento na saída do pedido --------------------------------------------
DO $venc$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_em_os(uuid, jsonb)'::regprocedure);
  v_de text := E'  v_primeiro  := COALESCE((v_orc.condicao_pagamento->>''primeiro_vencimento'')::date, CURRENT_DATE);\n';
  v_para text := E'  -- Parcela única sem data no acordo vence na saída do pedido (13/10/2026):\n'
    || E'  -- fica sem vencimento e o gatilho tg_os_parcela_vence_na_saida a data.\n'
    || E'  v_primeiro  := COALESCE((v_orc.condicao_pagamento->>''primeiro_vencimento'')::date,\n'
    || E'                          CASE WHEN v_parcelas = 1 THEN NULL ELSE CURRENT_DATE END);\n';
  v_de3 text := E'  IF v_orc.os_id IS NOT NULL THEN\n    RETURN jsonb_build_object(''orcamento_id'', p_orcamento_id, ''os_id'', v_orc.os_id, ''idempotent'', true);\n  END IF;\n';
  v_para3 text := v_de3
    || E'\n  -- Orçamento com 3D vinculado converte pela porta do 3D (13/10/2026): pela\n'
    || E'  -- porta comum nascia uma OS e o 3D, sem OS, oferecia "Converter" de novo.\n'
    || E'  IF EXISTS (SELECT 1 FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id) THEN\n'
    || E'    RETURN public.converter_orcamento_3d_em_os(\n'
    || E'      (SELECT t3.id FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id ORDER BY t3.created_at DESC LIMIT 1));\n'
    || E'  END IF;\n';
  v_def3 text := pg_get_functiondef('public.converter_orcamento_3d_em_os(uuid)'::regprocedure);
  v_de4 text := E'  VALUES (v_conta_id, 1, COALESCE(v_orc.preco_comercial, 0), CURRENT_DATE);';
  v_para4 text := E'  VALUES (v_conta_id, 1, COALESCE(v_orc.preco_comercial, 0), NULL); -- vence na saída do pedido';
BEGIN
  IF position('vence na saída do pedido' IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1
       OR (length(v_def) - length(replace(v_def, v_de3, ''))) / length(v_de3) <> 1 THEN
      RAISE EXCEPTION 'converter_orcamento_em_os: os trechos não estão como esperado; revise a troca';
    END IF;
    EXECUTE replace(replace(v_def, v_de, v_para), v_de3, v_para3);
  END IF;
  IF position('vence na saída do pedido' IN v_def3) = 0 THEN
    IF (length(v_def3) - length(replace(v_def3, v_de4, ''))) / length(v_de4) <> 1 THEN
      RAISE EXCEPTION 'converter_orcamento_3d_em_os: o trecho da parcela não está como esperado; revise a troca';
    END IF;
    EXECUTE replace(v_def3, v_de4, v_para4);
  END IF;
END
$venc$;

CREATE OR REPLACE FUNCTION public.tg_os_parcela_vence_na_saida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.parcelas_receber p
     SET vencimento = (now() AT TIME ZONE 'America/Belem')::date
    FROM public.contas_receber cr
   WHERE cr.os_id = NEW.id
     AND p.conta_id = cr.id
     AND p.vencimento IS NULL
     AND p.status <> 'paga';
  RETURN NULL;
END $function$;
COMMENT ON FUNCTION public.tg_os_parcela_vence_na_saida() IS
  'Parcela sem vencimento (pagamento na retirada/entrega) passa a vencer no dia em que o pedido sai: pronto para retirar ou entregar, em entrega, instalação ou concluído.';
REVOKE ALL ON FUNCTION public.tg_os_parcela_vence_na_saida() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_os_parcela_vence_na_saida ON public.ordens_servico;
CREATE TRIGGER tg_os_parcela_vence_na_saida
  AFTER UPDATE OF status ON public.ordens_servico
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('aguardando_retirada','aguardando_entrega','em_entrega','em_instalacao','concluido','faturado'))
  EXECUTE FUNCTION public.tg_os_parcela_vence_na_saida();

-- As parcelas que nasceram vencendo no dia da conversão, de pedidos que ainda
-- não saíram: parcela única, sem data no acordo, vencimento = dia em que a
-- conta nasceu. Em 13/10/2026: OS 161 a 166, R$ 3.746,60.
UPDATE public.parcelas_receber p
   SET vencimento = NULL
  FROM public.contas_receber cr
  JOIN public.ordens_servico os ON os.id = cr.os_id
 WHERE p.conta_id = cr.id
   AND p.status <> 'paga'
   AND p.vencimento = (cr.created_at AT TIME ZONE 'America/Belem')::date
   AND (SELECT count(*) FROM public.parcelas_receber p2 WHERE p2.conta_id = cr.id) = 1
   AND coalesce(os.condicao_pagamento->>'primeiro_vencimento', '') = ''
   AND os.status NOT IN ('aguardando_retirada','aguardando_entrega','em_entrega','em_instalacao','concluido','faturado','cancelado');
