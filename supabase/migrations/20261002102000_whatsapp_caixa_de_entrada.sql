-- WhatsApp: a caixa de entrada responde pela fila que já existia
-- ---------------------------------------------------------------------------
-- Até 02/10/2026 a tela /whatsapp era demonstração: conversas e mensagens
-- fixas no código e sete botões sem ação. Medido no banco nesse dia, antes
-- desta migração: 1 instância (BEX PRINTS, conectado=false, nenhum evento — o
-- QR Code nunca tinha sido escaneado), 0 conversas, 0 mensagens, 0 linhas em
-- whatsapp_fila_envio, 4 avisos pendentes em notificacoes_fila. Às 16:30
-- (Macapá) do mesmo dia chegou o primeiro ConnectedCallback: a instância
-- passou a conectada, ainda com 0 conversas.
--
-- A tela nova lê o que o webhook grava (`whatsapp_registrar_mensagem` escreve
-- whatsapp_conversas e whatsapp_mensagens) e responde pelo caminho de envio
-- que já existia: uma linha em `whatsapp_fila_envio`, consumida pelo POST
-- /api/whatsapp/enviar. Faltavam duas peças no banco, as duas aqui:
--
--   whatsapp_responder(conversa, texto)
--     Grava a mensagem de saída como PENDENTE, a linha da fila e o resumo da
--     conversa NUMA transação. Feito pela tela em três chamadas, uma falha no
--     meio deixaria mensagem "pendente" que nenhuma fila manda — ou fila sem
--     mensagem para mostrar. Recusa, com a frase que a tela mostra:
--       - sem whatsapp.reply (operador, financeiro);
--       - texto vazio ou acima de 4.096 caracteres;
--       - instância desativada, ou não conectada ("falta escanear o QR Code"
--         quando nunca houve evento; "leia o QR Code de novo" quando caiu);
--       - número que não é celular brasileiro (telefone_recebe_whatsapp).
--     Quem responde primeiro vira `responsavel_id` (os relatórios de
--     atendimento já liam essa coluna; ninguém a escrevia) e as não lidas
--     zeram — quem respondeu leu.
--
--   whatsapp_vincular_cliente(conversa, cliente)
--     Liga a conversa ao cliente escolhido e leva o vínculo para as mensagens
--     já gravadas (o webhook copia o cliente da conversa só para as NOVAS).
--     Exige um cliente: desligar não é oferecido, porque o webhook religaria
--     pelo telefone na mensagem seguinte.
--
-- As duas são SECURITY INVOKER: valem as policies de quem chama
-- (whatsapp_conversas e whatsapp_mensagens pedem whatsapp.reply para gravar,
-- whatsapp_fila_envio pede is_staff, whatsapp_instancias tem grant por coluna
-- e a função só lê as colunas liberadas). A conferência de permissão no
-- começo existe para a recusa vir com o motivo, e não como "0 linhas".
-- EXECUTE só para authenticated (sem PUBLIC, sem anon).
--
-- Concluir atendimento, etiquetas, marcar como lida e ligar a conversa à OS
-- são UPDATE direto em whatsapp_conversas (colunas status, etiquetas,
-- nao_lidas e os_id já existiam), com a linha pedida de volta para o RLS não
-- recusar calado. Nenhuma coluna nova.
--
-- Ensaiado com DO ... RAISE EXCEPTION 'ENSAIO: ...' (tudo desfeito), numa
-- instância e conversas de ensaio:
--   vendedor responde       → mensagem saida/texto/pendente com o texto
--                             aparado, cliente copiado da conversa,
--                             enviada_por; fila pendente com
--                             {tipo:'texto', texto}, idempotency_key
--                             'caixa-de-entrada:<mensagem>'; conversa com
--                             ultima_mensagem, nao_lidas 0 e responsavel_id
--   operador / financeiro   → "Seu perfil não pode responder no WhatsApp…"
--   texto vazio             → "Escreva a mensagem antes de enviar…"
--   telefone fixo           → "O número desta conversa (9632221234) não é um
--                              celular que recebe WhatsApp…"
--   instância real (antes   → "WhatsApp desconectado — falta escanear o QR
--   do pareamento)             Code. A resposta não foi enfileirada."
--   caiu depois de evento   → "…leia o QR Code de novo no painel do Z-API…"
--   desativada              → "A instância de WhatsApp desta conversa está
--                              desativada…"
--   vincular (vendedor)     → conversa e 2 mensagens com o cliente
--   vincular (operador)     → recusado; o operador nem lê a conversa (0)
--   concluir por UPDATE     → vendedor 1 linha; operador e financeiro 0 linhas
--                             (o RLS filtra calado — a tela confere)
--   orçamento 9901 e OS 9901 criados pelo vendedor com conversa_id/briefing,
--   e a conversa ligada à OS (1 linha)
-- Depois de aplicar (ainda antes do pareamento): vendedor na instância real
-- recebe a frase do QR Code; anon recebe "permission denied for function".

CREATE OR REPLACE FUNCTION public.whatsapp_responder(p_conversa_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_texto text := btrim(COALESCE(p_texto, ''));
  v_conversa public.whatsapp_conversas%ROWTYPE;
  v_conectado boolean;
  v_status text;
  v_ativa boolean;
  v_ultimo_evento timestamptz;
  v_mensagem_id uuid;
  v_fila_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'whatsapp.reply') THEN
    RAISE EXCEPTION 'Seu perfil não pode responder no WhatsApp (falta a permissão whatsapp › reply).';
  END IF;
  IF v_texto = '' THEN
    RAISE EXCEPTION 'Escreva a mensagem antes de enviar: o texto está vazio.';
  END IF;
  IF length(v_texto) > 4096 THEN
    RAISE EXCEPTION 'Mensagem longa demais: % caracteres (o WhatsApp aceita até 4.096).', length(v_texto);
  END IF;

  SELECT * INTO v_conversa FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada (ou seu perfil não pode alterá-la).';
  END IF;

  SELECT i.conectado, i.status::text, i.ativa, i.ultimo_evento_at
    INTO v_conectado, v_status, v_ativa, v_ultimo_evento
  FROM public.whatsapp_instancias i
  WHERE i.id = v_conversa.instancia_id;

  IF NOT FOUND OR v_ativa IS NOT TRUE THEN
    RAISE EXCEPTION 'A instância de WhatsApp desta conversa está desativada: a resposta não foi enfileirada.';
  END IF;
  IF v_conectado IS NOT TRUE OR v_status IS DISTINCT FROM 'conectada' THEN
    RAISE EXCEPTION 'WhatsApp desconectado — %. A resposta não foi enfileirada.',
      CASE WHEN v_ultimo_evento IS NULL THEN 'falta escanear o QR Code'
           ELSE 'leia o QR Code de novo no painel do Z-API' END;
  END IF;
  IF NOT public.telefone_recebe_whatsapp(v_conversa.telefone) THEN
    RAISE EXCEPTION 'O número desta conversa (%) não é um celular que recebe WhatsApp: a resposta não foi enfileirada.',
      v_conversa.telefone;
  END IF;

  INSERT INTO public.whatsapp_mensagens (
    conversa_id, instancia_id, direcao, tipo, status, texto,
    cliente_id, os_id, enviada_por, payload
  ) VALUES (
    v_conversa.id, v_conversa.instancia_id, 'saida', 'texto', 'pendente', v_texto,
    v_conversa.cliente_id, v_conversa.os_id, v_uid,
    jsonb_build_object('origem', 'caixa_de_entrada')
  )
  RETURNING id INTO v_mensagem_id;

  INSERT INTO public.whatsapp_fila_envio (
    conversa_id, mensagem_id, payload, status, idempotency_key, created_by
  ) VALUES (
    v_conversa.id, v_mensagem_id,
    jsonb_build_object('tipo', 'texto', 'texto', v_texto),
    'pendente', 'caixa-de-entrada:' || v_mensagem_id::text, v_uid
  )
  RETURNING id INTO v_fila_id;

  UPDATE public.whatsapp_conversas
  SET ultima_mensagem = left(v_texto, 500),
      ultima_mensagem_at = now(),
      nao_lidas = 0,
      responsavel_id = COALESCE(responsavel_id, v_uid)
  WHERE id = v_conversa.id;

  RETURN jsonb_build_object('mensagem_id', v_mensagem_id, 'fila_id', v_fila_id, 'status', 'pendente');
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_responder(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_responder(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.whatsapp_responder(uuid, text) IS 'Resposta da caixa de entrada (/whatsapp): grava a mensagem pendente, enfileira em whatsapp_fila_envio e atualiza a conversa. SECURITY INVOKER: vale o RLS de quem responde. Recusa sem whatsapp.reply e com a instancia desconectada.';

CREATE OR REPLACE FUNCTION public.whatsapp_vincular_cliente(p_conversa_id uuid, p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_mensagens int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'whatsapp.reply') THEN
    RAISE EXCEPTION 'Seu perfil não pode alterar conversas do WhatsApp (falta a permissão whatsapp › reply).';
  END IF;
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o cliente: a conversa não pode ficar ligada a ninguém por esta função.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado (ou seu perfil não enxerga a carteira).';
  END IF;

  UPDATE public.whatsapp_conversas SET cliente_id = p_cliente_id WHERE id = p_conversa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada (ou seu perfil não pode alterá-la).';
  END IF;

  UPDATE public.whatsapp_mensagens
  SET cliente_id = p_cliente_id
  WHERE conversa_id = p_conversa_id AND cliente_id IS DISTINCT FROM p_cliente_id;
  GET DIAGNOSTICS v_mensagens = ROW_COUNT;

  RETURN jsonb_build_object('conversa_id', p_conversa_id, 'cliente_id', p_cliente_id, 'mensagens', v_mensagens);
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_vincular_cliente(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_vincular_cliente(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.whatsapp_vincular_cliente(uuid, uuid) IS 'Liga a conversa do WhatsApp a um cliente e leva o vinculo para as mensagens ja gravadas. SECURITY INVOKER: exige whatsapp.reply e o RLS de quem liga.';
