-- Nova conversa pelo número (21/10/2026, pedido do dono: "um atalho para
-- adicionar o contato e chamar direto ao colar o número").
--
-- Até aqui a equipe só começava conversa pela ficha de um cliente CADASTRADO
-- ("Conversar no WhatsApp", 20261020120000). Número que chegou por fora — um
-- cartão, um print, um "me chama nesse" — exigia cadastrar o cliente antes.
-- `whatsapp_conversa_do_numero` acha a conversa desse número (e reabre se foi
-- resolvida) ou cria uma vazia na fila Comercial, guarda o nome digitado como o
-- nome do contato e liga ao cliente quando o número é de UM cliente ativo.
-- Não manda mensagem nenhuma: a primeira quem escreve é a pessoa, na conversa.
--
-- O nome digitado vale: o webhook mantém o nome que a conversa já tem
-- (`nome_contato = COALESCE(c.nome_contato, EXCLUDED.nome_contato)`).
--
-- Como as outras escritas da caixa: só o servidor chama, com a chave de serviço,
-- depois de conferir a permissão de quem pediu (abrirConversaPeloNumero em
-- whatsapp-caixa.functions.ts); a função confere de novo — duas trancas.

CREATE OR REPLACE FUNCTION public.whatsapp_conversa_do_numero(p_telefone text, p_nome text, p_usuario uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_chave text;
  v_nome text := nullif(left(btrim(coalesce(p_nome, '')), 120), '');
  v_instancia uuid;
  v_conversa public.whatsapp_conversas%ROWTYPE;
  v_clientes uuid[];
  v_cliente uuid;
  v_nova boolean := false;
  v_quem text;
BEGIN
  -- Abrir uma conversa é começar a responder: a mesma porta de responder.
  PERFORM public._wa_exigir_resposta(p_usuario);

  IF NOT public.telefone_recebe_whatsapp(p_telefone) THEN
    RAISE EXCEPTION 'Esse número não recebe WhatsApp: use o celular com DDD, como (96) 99999-9999.'
      USING ERRCODE = '22023';
  END IF;
  v_chave := public.normalize_whatsapp_phone(p_telefone);

  SELECT id INTO v_instancia FROM public.whatsapp_instancias
   WHERE ativa ORDER BY conectado DESC NULLS LAST, created_at LIMIT 1;
  IF v_instancia IS NULL THEN
    RAISE EXCEPTION 'O WhatsApp da gráfica não está configurado: nenhuma instância ativa.' USING ERRCODE = '22023';
  END IF;

  -- O cliente desse número, se for um só (a mesma regra do webhook: conta só
  -- cliente ativo; dois com o mesmo número não liga a nenhum).
  SELECT array_agg(DISTINCT c.id) INTO v_clientes
    FROM public.clientes c
   WHERE c.ativo IS NOT FALSE
     AND (c.telefone_normalizado = v_chave OR public.normalize_whatsapp_phone(c.whatsapp_principal) = v_chave);
  IF coalesce(array_length(v_clientes, 1), 0) = 1 THEN v_cliente := v_clientes[1]; END IF;

  SELECT * INTO v_conversa FROM public.whatsapp_conversas
   WHERE instancia_id = v_instancia AND telefone_normalizado = v_chave
   LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    UPDATE public.whatsapp_conversas
       SET nome_contato = coalesce(v_nome, nome_contato),
           cliente_id = coalesce(cliente_id, v_cliente),
           status = CASE WHEN status IN ('resolvida', 'arquivada') THEN 'aberta'::whatsapp_conversa_status ELSE status END
     WHERE id = v_conversa.id
    RETURNING * INTO v_conversa;
  ELSE
    SELECT split_part(btrim(nome), ' ', 1) INTO v_quem FROM public.usuarios WHERE id = p_usuario;
    -- Com o 55 na frente, como o número das conversas que chegam pelo webhook.
    INSERT INTO public.whatsapp_conversas (
      instancia_id, telefone, nome_contato, cliente_id, status, fila, modo,
      ultima_mensagem, ultima_mensagem_at, nao_lidas
    ) VALUES (
      v_instancia, '55' || v_chave, v_nome, v_cliente, 'aberta', 'comercial', 'humano',
      'Conversa iniciada por ' || coalesce(v_quem, 'alguém da equipe'), now(), 0
    )
    RETURNING * INTO v_conversa;
    v_nova := true;
  END IF;

  RETURN jsonb_build_object(
    'id', v_conversa.id,
    'nova', v_nova,
    'telefone', v_conversa.telefone,
    'cliente', (SELECT nome FROM public.clientes WHERE id = v_conversa.cliente_id)
  );
END $function$;
COMMENT ON FUNCTION public.whatsapp_conversa_do_numero(text, text, uuid) IS
  'Nova conversa pelo número: acha a conversa desse WhatsApp (reabre se resolvida) ou cria uma vazia, com o nome do contato e o cliente quando é um só. Não envia mensagem. Só service_role; exige whatsapp.reply de p_usuario.';
REVOKE ALL ON FUNCTION public.whatsapp_conversa_do_numero(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversa_do_numero(text, text, uuid) TO service_role;
