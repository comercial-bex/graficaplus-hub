-- O chatLid de cada conversa, para reconhecer as mensagens mandadas pelo celular da empresa
-- (decisão 11 da onda "cobrança de orçamento no grupo", 12/11/2026).
--
-- Quando alguém responde o cliente pelo próprio celular da gráfica, o Z-API manda o evento com
-- fromMe verdadeiro, fromApi falso e phone "<n>@lid" (282 eventos em 30 dias, todos descartados
-- hoje). O lid não é telefone: só dá para achar a conversa se ela já souber o seu lid, que vem nas
-- mensagens do próprio cliente (chatLid em 1.434 de 1.436).
--
-- Medido em 12/11 (só SELECT): 134 lids na primeira medição e 136 na repetida, porque o número
-- cresce a cada dia (cada telefone com um lid só e cada lid com um telefone só); todos casam com a
-- conversa pelo telefone normalizado (a mesma regra de whatsapp_registrar_mensagem), nenhum
-- ambíguo. Na hora de aplicar, repita a contagem do CTE `ev` e compare com o resultado.
--
-- O que este arquivo faz:
--  1. coluna chat_lid em whatsapp_conversas, com índice único parcial por instância;
--  2. preenche a coluna a partir de whatsapp_webhook_eventos (esperado: o número do CTE `ev` medido na hora, hoje perto de 136);
--  3. funções só do service_role: achar a conversa do lid e aprender o lid de uma conversa.
-- Não importa nenhuma mensagem antiga do celular e não toca em whatsapp_mensagens.
--
-- Grants: whatsapp_conversas tem grant de tabela e nenhuma coluna com ACL própria (12/11); a coluna
-- nova não precisa de GRANT de coluna.

-- 1. Coluna e índice ------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_conversas
  ADD COLUMN IF NOT EXISTS chat_lid text;

ALTER TABLE public.whatsapp_conversas
  DROP CONSTRAINT IF EXISTS whatsapp_conversas_chat_lid_check;
ALTER TABLE public.whatsapp_conversas
  ADD CONSTRAINT whatsapp_conversas_chat_lid_check CHECK (chat_lid ~ '^\d{6,20}@lid$');

COMMENT ON COLUMN public.whatsapp_conversas.chat_lid IS
  'Id "<n>@lid" que o WhatsApp usa para este contato. Aprendido das mensagens do cliente; acha a conversa das mensagens mandadas pelo celular da empresa.';

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversas_chat_lid_key
  ON public.whatsapp_conversas (instancia_id, chat_lid)
  WHERE chat_lid IS NOT NULL;

-- 2. Preenchimento --------------------------------------------------------------------------------
-- Só pares sem dúvida: lid com UM telefone, telefone com UM lid, telefone com UMA conversa na
-- instância, conversa ainda sem lid e lid ainda livre na instância.
WITH ev AS (
  SELECT i.id AS instancia_id,
         e.payload->>'chatLid' AS lid,
         public.normalize_whatsapp_phone(e.payload->>'phone') AS tel
    FROM public.whatsapp_webhook_eventos e
    JOIN public.whatsapp_instancias i ON i.zapi_instance_id = e.payload->>'instanceId'
   WHERE e.provedor = 'zapi'
     AND e.payload->>'type' = 'ReceivedCallback'
     AND COALESCE((e.payload->>'isGroup')::boolean, false) = false
     AND COALESCE((e.payload->>'fromMe')::boolean, false) = false
     AND e.payload->>'chatLid' ~ '^\d{6,20}@lid$'
     AND e.payload->>'phone' ~ '^\d{10,13}$'
), lid_unico AS (
  SELECT instancia_id, lid, min(tel) AS tel
    FROM ev
   GROUP BY instancia_id, lid
  HAVING count(DISTINCT tel) = 1
), tel_unico AS (
  SELECT instancia_id, tel
    FROM ev
   GROUP BY instancia_id, tel
  HAVING count(DISTINCT lid) = 1
), conversa_unica AS (
  SELECT c.instancia_id, c.telefone_normalizado AS tel, min(c.id::text)::uuid AS conversa_id
    FROM public.whatsapp_conversas c
   WHERE c.telefone_normalizado IS NOT NULL
   GROUP BY c.instancia_id, c.telefone_normalizado
  HAVING count(*) = 1
), par AS (
  SELECT l.instancia_id, l.lid, cu.conversa_id
    FROM lid_unico l
    JOIN tel_unico t ON t.instancia_id = l.instancia_id AND t.tel = l.tel
    JOIN conversa_unica cu ON cu.instancia_id = l.instancia_id AND cu.tel = l.tel
)
UPDATE public.whatsapp_conversas c
   SET chat_lid = p.lid
  FROM par p
 WHERE c.id = p.conversa_id
   AND c.chat_lid IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.whatsapp_conversas o
      WHERE o.instancia_id = p.instancia_id AND o.chat_lid = p.lid
   );

-- 3. Funções --------------------------------------------------------------------------------------
-- A conversa de um lid, no máximo uma (o índice único garante).
CREATE OR REPLACE FUNCTION public.whatsapp_conversa_do_lid(p_instancia_id uuid, p_chat_lid text)
 RETURNS TABLE (conversa_id uuid, telefone text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT c.id, c.telefone
    FROM public.whatsapp_conversas c
   WHERE c.instancia_id = p_instancia_id
     AND c.chat_lid = p_chat_lid
     AND p_chat_lid ~ '^\d{6,20}@lid$'
   LIMIT 1
$function$;

-- Aprende o lid de uma conversa a partir de mensagem do próprio cliente. Grava só quando a
-- conversa ainda não tem lid, o lid tem o formato e nenhuma outra conversa da instância o tem.
-- Devolve true quando gravou ou quando a conversa já tinha este mesmo lid; false quando ela tem
-- outro lid ou o lid é de outra conversa (o webhook registra esse caso no log). Nunca levanta erro
-- por lid repetido.
CREATE OR REPLACE FUNCTION public.whatsapp_aprender_lid(p_conversa_id uuid, p_chat_lid text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_conversa_id IS NULL OR p_chat_lid IS NULL OR p_chat_lid !~ '^\d{6,20}@lid$' THEN
    RETURN false;
  END IF;

  -- Já sabia este mesmo lid: está certo, e é o caso de quase toda mensagem do cliente.
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversas c WHERE c.id = p_conversa_id AND c.chat_lid = p_chat_lid) THEN
    RETURN true;
  END IF;

  BEGIN
    UPDATE public.whatsapp_conversas c
       SET chat_lid = p_chat_lid
     WHERE c.id = p_conversa_id
       AND c.chat_lid IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.whatsapp_conversas o
          WHERE o.instancia_id = c.instancia_id AND o.chat_lid = p_chat_lid AND o.id <> c.id
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    -- Outra conversa ganhou o mesmo lid ao mesmo tempo.
    RETURN false;
  END;

  RETURN v_n > 0;
END $function$;

REVOKE ALL ON FUNCTION public.whatsapp_conversa_do_lid(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversa_do_lid(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_aprender_lid(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_aprender_lid(uuid, text) TO service_role;
