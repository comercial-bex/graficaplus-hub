-- Cliente estrangeiro e WhatsApp com código de país (01/11/2026).
--
-- O dono tem cliente de fora (Guiana Francesa, por exemplo). O banco só aceitava
-- WhatsApp de celular brasileiro (DDD + 9 + 8 dígitos): `telefone_recebe_whatsapp`
-- recusava qualquer outro número, então esse cliente não cadastrava.
--
-- Regra nova, sem afrouxar a do Brasil: número de fora só vale escrito com "+" e o
-- código do país, de 8 a 15 dígitos (o limite do padrão E.164), e o código não pode
-- ser o 55. Digitado sem o "+", continua valendo só a regra brasileira, então um
-- celular brasileiro com dígito a mais não passa por estrangeiro.
--
--   telefone_estrangeiro('+594 694 12 34 56')  verdadeiro
--   telefone_estrangeiro('+55 96 99111-2233')  falso (é brasileiro; segue a regra de antes)
--   telefone_estrangeiro('594694123456')       falso (sem o "+")
--
-- Duas outras coisas dependiam do 55 fixo:
--   1. `whatsapp_conversa_do_numero` abria a conversa com '55' || número. Para
--      estrangeiro fica só o número com o código do país, como o que chega pelo webhook.
--   2. Responder numa conversa conferia o número com a regra brasileira, então
--      conversa de estrangeiro que chegou pelo webhook (só dígitos, sem "+") nunca
--      podia ser respondida pelo sistema. `conversa_recebe_whatsapp` é a regra para
--      número que o sistema recebeu e não que alguém digitou: aceita também só
--      dígitos de 12 a 15, fora do 55. Número digitado continua na regra estrita.
--
-- Limite conhecido: número dos EUA e do Canadá tem 11 dígitos e, sem o "+", se
-- confunde com número brasileiro digitado errado. Cadastrado com "+1", funciona;
-- chegando pelo webhook sem cadastro, a resposta pelo sistema fica de fora.
--
-- O país do cliente (`pais`, código ISO de duas letras) já nasce 'BR' para os
-- clientes de hoje.

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS pais text NOT NULL DEFAULT 'BR';

ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_pais_check;
ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_pais_check CHECK (pais ~ '^[A-Z]{2}$');

CREATE OR REPLACE FUNCTION public.telefone_estrangeiro(p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_telefone IS NULL THEN false
    ELSE btrim(p_telefone) LIKE '+%'
         AND regexp_replace(p_telefone, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{7,14}$'
         AND regexp_replace(p_telefone, '[^0-9]', '', 'g') !~ '^55'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.telefone_recebe_whatsapp(p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Celular brasileiro: DDD (2) + 9 + 8 digitos = 11 digitos, com DDD entre
  -- 11 e 99 e o nono digito na frente. Ou numero de fora escrito com "+" e o
  -- codigo do pais (ver telefone_estrangeiro).
  --
  -- So "esta preenchido" nao basta. `normalize_whatsapp_phone` aceita calado
  -- dois casos que nao recebem mensagem nenhuma:
  --   '96 3222-1234'                  -> 9632221234   (fixo, 10 digitos)
  --   '96 99131-8834 / 96 98140-8722' -> 9699131883496981408722 (dois colados)
  -- O segundo e o pior: 22 digitos gravados como se fossem um telefone.
  SELECT CASE
    WHEN p_telefone IS NULL THEN false
    ELSE COALESCE(public.normalize_whatsapp_phone(p_telefone) ~ '^[1-9][1-9]9[0-9]{8}$', false)
         OR public.telefone_estrangeiro(p_telefone)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.conversa_recebe_whatsapp(p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_telefone IS NULL THEN false
    ELSE public.telefone_recebe_whatsapp(p_telefone)
         OR (regexp_replace(p_telefone, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{11,14}$'
             AND regexp_replace(p_telefone, '[^0-9]', '', 'g') !~ '^55')
  END;
$function$;

-- Troca um trecho na definição que está viva no banco (as migrações antigas não são
-- a fonte da verdade: outras trocas já mexeram nestas funções). Falha se o trecho
-- não aparece exatamente uma vez, em vez de trocar o que não devia.
CREATE OR REPLACE FUNCTION pg_temp.trocar_na_definicao(p_funcao regprocedure, p_velho text, p_novo text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text := pg_get_functiondef(p_funcao);
  v_vezes int := (length(v_def) - length(replace(v_def, p_velho, ''))) / length(p_velho);
BEGIN
  IF v_vezes <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 ocorrência de "%" em %, achei %', p_velho, p_funcao, v_vezes;
  END IF;
  EXECUTE replace(v_def, p_velho, p_novo);
END $function$;

-- Abrir conversa pelo número: estrangeiro fica com o código do país e sem o 55 na frente.
SELECT pg_temp.trocar_na_definicao(
  'public.whatsapp_conversa_do_numero(text,text,uuid)'::regprocedure,
  '''55'' || v_chave',
  'CASE WHEN public.telefone_estrangeiro(p_telefone) THEN v_chave ELSE ''55'' || v_chave END');

-- Responder: número que o sistema recebeu (webhook) vale com ou sem "+".
SELECT pg_temp.trocar_na_definicao(
  'public.whatsapp_responder(uuid,text)'::regprocedure,
  'public.telefone_recebe_whatsapp(v_conversa.telefone)',
  'public.conversa_recebe_whatsapp(v_conversa.telefone)');

SELECT pg_temp.trocar_na_definicao(
  'public._wa_enfileirar_mensagem_da_equipe(uuid,uuid,text,text,text)'::regprocedure,
  'public.telefone_recebe_whatsapp(v_conversa.telefone)',
  'public.conversa_recebe_whatsapp(v_conversa.telefone)');

-- A dica do erro do cadastro passa a falar do estrangeiro.
SELECT pg_temp.trocar_na_definicao(
  'public.tg_cliente_precisa_de_whatsapp()'::regprocedure,
  'HINT = ''Formato: (96) 99999-9999'';',
  'HINT = ''Formato: (96) 99999-9999. Cliente de fora: + e o código do país, como +594 694 12 34 56.'';');

-- Permissões: funções novas não são para o público (mesma regra da conciliação).
REVOKE ALL ON FUNCTION public.telefone_estrangeiro(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conversa_recebe_whatsapp(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telefone_estrangeiro(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversa_recebe_whatsapp(text) TO authenticated, service_role;
