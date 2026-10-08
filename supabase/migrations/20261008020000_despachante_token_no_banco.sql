-- Despachante do WhatsApp sem segredo cadastrado à mão (08/10/2026).
--
-- A onda 1 (20261007150000) deixou o job `whatsapp-despachar` esperando o
-- dono criar o MESMO token em dois lugares: DESPACHANTE_TOKEN no servidor e
-- `despachante_token` no Vault. Agora o token mora só no Vault: é gerado aqui
-- dentro, ninguém vê o valor, e o servidor confere pelo banco com a função
-- abaixo (só o service_role chama). A variável DESPACHANTE_TOKEN, se um dia
-- existir, continua valendo e tem prioridade.
--
-- Ordem: 1 e 2 antes do publish (o front antigo não usa nada disto); 3, o
-- job, depois do publish — com o front antigo no ar a rota responderia 503.

-- 1. Situação do token, sem nunca devolver o valor ---------------------------
--    'sem_segredo'  o Vault não tem o token (despachante do servidor desligado)
--    'configurado'  tem, e ninguém mandou token para conferir (GET de saúde)
--    'confere'      o token recebido é o do Vault
--    'nao_confere'  não é
CREATE OR REPLACE FUNCTION public.whatsapp_despachante_token_situacao(p_token text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_segredo text;
BEGIN
  SELECT s.decrypted_secret INTO v_segredo
  FROM vault.decrypted_secrets s
  WHERE s.name = 'despachante_token';

  IF v_segredo IS NULL OR length(v_segredo) < 32 THEN
    RETURN 'sem_segredo';
  END IF;
  IF p_token IS NULL OR p_token = '' THEN
    RETURN 'configurado';
  END IF;
  -- Compara os resumos, não o texto: o tamanho do que chegou não muda nada.
  IF extensions.digest(p_token, 'sha256') = extensions.digest(v_segredo, 'sha256') THEN
    RETURN 'confere';
  END IF;
  RETURN 'nao_confere';
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_despachante_token_situacao(text) IS
  'Confere o token do despachante do WhatsApp com o do Vault (despachante_token) sem devolver o valor. Só o service_role chama: é o servidor, na rota /api/whatsapp/despachar.';

REVOKE ALL ON FUNCTION public.whatsapp_despachante_token_situacao(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_despachante_token_situacao(text) TO service_role;

-- 2. O token, gerado aqui dentro (32 bytes aleatórios), só se ainda não existe --
DO $segredo$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'despachante_token') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'despachante_token',
      'Token do despachante do WhatsApp: o job whatsapp-despachar manda no cabeçalho x-despachante-token; o servidor confere com whatsapp_despachante_token_situacao. Gerado no banco; o valor nunca foi mostrado.'
    );
  END IF;
END
$segredo$;

-- 3. O job (depois do publish): o mesmo da seção 5 da onda 1 -----------------
DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'despachante_token') THEN
    RAISE NOTICE 'despachante: sem o segredo despachante_token no Vault; job não criado.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-despachar') THEN
    PERFORM cron.unschedule('whatsapp-despachar');
  END IF;

  PERFORM cron.schedule(
    'whatsapp-despachar',
    '*/2 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bexprint.com.br/api/whatsapp/despachar',
        headers := jsonb_build_object(
          'x-despachante-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'despachante_token'),
          'content-type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )
    $cmd$
  );
END
$job$;
