-- O aviso "seu pedido entrou em produção" vale para qualquer máquina
-- ---------------------------------------------------------------------------
-- O marco que avisa o cliente pelo WhatsApp só reconhecia o status genérico
-- `em_producao`. Com o "Começar" por máquina (comecar_na_maquina, migração
-- anterior) a OS passa direto para `em_impressao`, `em_corte`, `em_laser_cnc`
-- ou `em_3d` — e nenhum desses era marco. O botão novo, que existe para a
-- oficina registrar em que máquina o trabalho está, calaria justamente o aviso
-- que o dono pediu ("avisar o cliente que o produto está sendo confeccionado").
--
-- Duas mudanças, as duas na mesma peça:
--
-- 1. `marco_notificavel_os` deixa de listar um status e passa a perguntar pela
--    ETAPA (etapa_da_os, a fonte única da migração 20261001100000): qualquer
--    status da etapa de produção é o marco `os_em_producao`. Status de máquina
--    novo no enum entra sozinho.
--
-- 2. A chave de idempotência do aviso de produção é do MARCO, não do status.
--    Com a chave por status, a OS que vai da impressão para o recorte e do
--    recorte para o laser avisaria o cliente três vezes. A chave continua
--    `os:<id>:em_producao` — a mesma que o caminho antigo gravava —, então quem
--    já foi avisado não recebe de novo. Os outros marcos seguem com a chave por
--    status, como eram.
--
-- Ensaiado em 01/10/2026 com a OS #44 (DO ... RAISE EXCEPTION, tudo desfeito):
--   entrada → em_impressao      1 aviso na fila (os_em_producao)
--   em_impressao → em_corte     1 (não repetiu)
--   em_corte → em_acabamento    1
--   em_acabamento → em_producao 1 (retrabalho não avisa de novo)
--   → aguardando_retirada       2 (os_pronta_retirada)

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
    WHEN _status = 'em_entrega' THEN 'os_saiu_entrega'
    WHEN _status = 'concluido' THEN 'os_concluida'
    ELSE NULL END
$function$;

CREATE OR REPLACE FUNCTION public.tg_os_notificar_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_evento text; v_cliente public.clientes%ROWTYPE; v_chave text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_evento := public.marco_notificavel_os(NEW.status);
  IF v_evento IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_cliente FROM public.clientes WHERE id = NEW.cliente_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_chave := CASE WHEN v_evento = 'os_em_producao' THEN 'em_producao' ELSE NEW.status::text END;
  PERFORM public.enfileirar_notificacao('whatsapp',
    COALESCE(v_cliente.whatsapp_principal, v_cliente.telefone), v_cliente.id, v_evento,
    'ordem_servico', NEW.id, v_evento,
    jsonb_build_object('cliente', v_cliente.nome, 'os_numero', NEW.numero,
      'os_titulo', NEW.titulo, 'os_id', NEW.id, 'prazo', NEW.prazo_entrega),
    'os:' || NEW.id::text || ':' || v_chave);
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_os_notificar_cliente() FROM PUBLIC, anon, authenticated;
