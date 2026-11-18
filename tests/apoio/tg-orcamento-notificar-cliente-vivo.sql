CREATE OR REPLACE FUNCTION public.tg_orcamento_notificar_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cliente public.clientes%ROWTYPE; v_destino text;
BEGIN
  IF NEW.status::text <> 'aprovado' OR OLD.status::text = 'aprovado' THEN RETURN NEW; END IF;
  SELECT * INTO v_cliente FROM public.clientes WHERE id = NEW.cliente_id;
  v_destino := COALESCE(v_cliente.whatsapp_principal, v_cliente.telefone, NEW.contato_telefone);
  PERFORM public.enfileirar_notificacao('whatsapp', v_destino, NEW.cliente_id,
    'orcamento_aprovado', 'orcamento', NEW.id, 'orcamento_aprovado',
    jsonb_build_object('cliente', COALESCE(v_cliente.nome, NEW.contato_nome),
      'orcamento_numero', NEW.numero, 'orcamento_id', NEW.id, 'valor_total', NEW.valor_total),
    'orcamento:' || NEW.id::text || ':aprovado');
  RETURN NEW;
END $function$
