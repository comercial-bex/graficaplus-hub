-- ============================================================================
-- Telefone internacional: DDD de verdade, conversa de fora respondível e número de fora gravado certo (26/11/2026).
--
-- Pedido do dono: cliente da França, da Guiana Francesa e da Colômbia. A tela passou a ter bandeira e código do país
-- (Nova conversa, orçamento avulso, lead, ficha do cliente). Este arquivo fecha as três falhas do BANCO que a conferência
-- do código real mostrou, todas já medidas:
--
--   1. "Celular brasileiro" era só o FORMATO (`[1-9][1-9]9[0-9]{8}`): qualquer DDD servia. O Suriname (+597 712 3456, 10
--      dígitos) ganha um nono dígito pela regra brasileira, vira 59977123456 e passava por celular com "DDD 59", que não
--      existe. Agora o DDD tem de ser um dos 67 do Brasil (`ddd_do_brasil`, a MESMA lista de src/domain/contato/ddds-do-brasil.ts;
--      um teste compara os dois textos). Nenhum número já gravado muda de situação: em 26/11/2026 foram conferidos 491
--      valores (clientes, leads, conversas, usuários, contatos, orçamentos) e nenhum tinha DDD fora da lista.
--
--   2. `conversa_recebe_whatsapp` (número que o sistema RECEBEU, não o que alguém digitou) só aceitava de 12 a 15 dígitos
--      fora do 55. França, Espanha, Bélgica, Holanda, Suíça, EUA e Canadá têm 11: a conversa abria pelo webhook, mas o
--      sistema não deixava responder. Passa a aceitar 11 a 15 dígitos fora do 55 e 10 dígitos cujo começo NÃO seja DDD do
--      Brasil (Suriname 597 e Guiana 592 têm 10). Espelha `numeroRecebidoDeFora` do TypeScript.
--
--   3. `whatsapp_conversa_do_numero` gravava a conversa de fora com a CHAVE do número, que é uma conta brasileira: um
--      número de 10 dígitos (Suriname) ganhava um 9 no meio, e o envio saía para um número que não existe. Agora grava
--      o número real, com o "+" na frente ("+5977123456"). O "+" é a marca que o envio lê (`telefoneParaZapi`) para
--      mandar ao país certo: sem ele, um número francês 33 9 12 34 56 78 se confunde com o DDD 33 de Minas Gerais. A
--      chave de reconhecimento (`telefone_normalizado`, gerada a partir deste texto) não muda: continua a mesma, então
--      a conversa que já existe para esse número continua sendo achada. O mesmo padrão ("+" na conversa) já era o de
--      `whatsapp_conversa_do_cliente` para cliente de fora.
--
-- NÃO mexe em `normalize_whatsapp_phone`: ela é aplicada igual nos dois lados (conversa que chega e número gravado), então
-- o reconhecimento funciona; mudar a regra desencontraria números de 10 dígitos já gravados.
--
-- Ordem de entrega: publicar o front ANTES de aplicar esta migração. Com a migração aplicada primeiro, a conversa de 11
-- dígitos passa a poder ser respondida, mas o envio (`telefoneParaZapi`) ainda trataria o número como brasileiro.
--
-- Segurança: as duas funções novas só calculam (não gravam, não leem tabela). Nascem fechadas como as irmãs
-- (`telefone_recebe_whatsapp`, `telefone_estrangeiro`): REVOKE ALL de PUBLIC, anon e authenticated, e EXECUTE só para
-- `authenticated` e `service_role`. `CREATE OR REPLACE` não mexe nas permissões das funções que já existem; a conferência
-- no fim prova que `whatsapp_conversa_do_numero` (que grava) continua fechada para anon e authenticated.
-- ============================================================================

DO $guarda$
DECLARE
  v_antes constant jsonb := jsonb_build_object(
    'public.telefone_recebe_whatsapp(text)',        'a78f014f40348cd9f4ba38c19303f80f',
    'public.conversa_recebe_whatsapp(text)',        'a928ee39fd9e52b204e48ad6ee85576f',
    'public.whatsapp_conversa_do_numero(text,text,uuid)', 'de8ca40450deb28d9c46812508f2f20b'
  );
  v_assinatura text;
  v_oid regprocedure;
  v_md5 text;
BEGIN
  FOR v_assinatura IN SELECT jsonb_object_keys(v_antes) LOOP
    v_oid := to_regprocedure(v_assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Falta a função %: as migrações de telefone anteriores precisam estar aplicadas.', v_assinatura;
    END IF;
    v_md5 := md5(pg_get_functiondef(v_oid));
    -- Ou é exatamente a versão que esta migração conhece, ou já é a nova (reaplicação). Outra coisa é alteração feita por fora.
    IF v_md5 <> v_antes ->> v_assinatura AND pg_get_functiondef(v_oid) NOT LIKE '%ddd_do_brasil%'
       AND pg_get_functiondef(v_oid) NOT LIKE '%v_digitos%' THEN
      RAISE EXCEPTION 'A função % mudou depois da versão que esta migração conhece (md5 %). Releia antes de sobrescrever.', v_assinatura, v_md5;
    END IF;
  END LOOP;
END
$guarda$;

-- 1. Os DDDs do Brasil e o celular brasileiro de verdade ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ddd_do_brasil(p_ddd text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(p_ddd = ANY (ARRAY[
    '11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38',
    '41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69',
    '71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99'
  ]), false);
$function$;

-- Celular brasileiro já na chave (sem o 55): 11 dígitos, DDD que existe e o 9 na frente do número.
CREATE OR REPLACE FUNCTION public.celular_br_valido(p_chave text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    p_chave ~ '^[0-9]{11}$'
    AND public.ddd_do_brasil(left(p_chave, 2))
    AND substring(p_chave, 3, 1) = '9',
    false);
$function$;

REVOKE ALL ON FUNCTION public.ddd_do_brasil(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.celular_br_valido(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ddd_do_brasil(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.celular_br_valido(text) TO authenticated, service_role;

-- 2. O que o telefone digitado precisa ser para receber WhatsApp -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.telefone_recebe_whatsapp(p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Celular brasileiro (DDD que existe + 9 + 8 dígitos, na chave sem o 55) ou número de fora escrito com "+" e o código do país.
  SELECT CASE
    WHEN p_telefone IS NULL THEN false
    ELSE public.celular_br_valido(public.normalize_whatsapp_phone(p_telefone))
         OR public.telefone_estrangeiro(p_telefone)
  END;
$function$;

-- 3. O que uma conversa que o sistema recebeu precisa ser para poder ser respondida ----------------------------------------

CREATE OR REPLACE FUNCTION public.conversa_recebe_whatsapp(p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Vale o que vale digitado, e também o número de fora que chegou só com dígitos (código do país na frente, fora do 55):
  -- 11 a 15 dígitos; ou 10, desde que os dois primeiros não sejam DDD do Brasil (Suriname 597 e Guiana 592).
  SELECT CASE
    WHEN p_telefone IS NULL THEN false
    ELSE public.telefone_recebe_whatsapp(p_telefone)
         OR (SELECT d !~ '^55'
                    AND (d ~ '^[1-9][0-9]{10,14}$'
                         OR (d ~ '^[1-9][0-9]{9}$' AND NOT public.ddd_do_brasil(left(d, 2))))
               FROM (SELECT regexp_replace(p_telefone, '[^0-9]', '', 'g') AS d) AS so_digitos)
  END;
$function$;

-- 4. Abrir a conversa pelo número: o de fora é gravado como é, com o "+" ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_conversa_do_numero(p_telefone text, p_nome text, p_usuario uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_chave text;
  v_digitos text;
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
    RAISE EXCEPTION 'Esse número não recebe WhatsApp: use o celular com DDD, como (96) 99999-9999, ou, para outro país, o número com + e o código do país.'
      USING ERRCODE = '22023';
  END IF;
  v_chave := public.normalize_whatsapp_phone(p_telefone);
  v_digitos := regexp_replace(p_telefone, '[^0-9]', '', 'g');

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
    -- Brasileiro: com o 55 na frente, como o número das conversas que chegam pelo webhook. De fora: o número REAL com o "+"
    -- (e não a chave, que é conta brasileira e acrescenta um 9 a número de 10 dígitos). O "+" é o que manda o envio ao país certo.
    INSERT INTO public.whatsapp_conversas (
      instancia_id, telefone, nome_contato, cliente_id, status, fila, modo,
      ultima_mensagem, ultima_mensagem_at, nao_lidas
    ) VALUES (
      v_instancia, CASE WHEN public.telefone_estrangeiro(p_telefone) THEN '+' || v_digitos ELSE '55' || v_chave END, v_nome, v_cliente, 'aberta', 'comercial', 'humano',
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

-- Conferência final: o que a migração promete, provado no próprio banco. Qualquer falha desfaz tudo.
DO $conferencia$
DECLARE
  v_oid oid;
  v_nome text;
BEGIN
  -- Celular brasileiro de verdade e o que deixou de passar por celular.
  IF NOT public.celular_br_valido('96991112233') OR public.celular_br_valido('59977123456')
     OR public.celular_br_valido('96881112233') OR public.celular_br_valido('9699111223') OR public.celular_br_valido(NULL) THEN
    RAISE EXCEPTION 'celular_br_valido fora do esperado.';
  END IF;
  -- Digitado: brasileiro, de fora com "+", e o que não vale.
  IF NOT public.telefone_recebe_whatsapp('(96) 99111-2233') OR NOT public.telefone_recebe_whatsapp('+55 96 99111-2233')
     OR NOT public.telefone_recebe_whatsapp('+33 6 12 34 56 78') OR NOT public.telefone_recebe_whatsapp('+597 712 3456')
     OR public.telefone_recebe_whatsapp('(59) 97712-3456') OR public.telefone_recebe_whatsapp('33612345678')
     OR public.telefone_recebe_whatsapp('(96) 3222-1234') OR public.telefone_recebe_whatsapp('96 99131-8834 / 96 98140-8722') THEN
    RAISE EXCEPTION 'telefone_recebe_whatsapp fora do esperado.';
  END IF;
  -- Recebido: 11 a 15 dígitos de fora, 10 sem DDD do Brasil; o brasileiro malformado e o fixo continuam de fora.
  IF NOT public.conversa_recebe_whatsapp('33612345678') OR NOT public.conversa_recebe_whatsapp('34612345678')
     OR NOT public.conversa_recebe_whatsapp('12125551234') OR NOT public.conversa_recebe_whatsapp('573001234567')
     OR NOT public.conversa_recebe_whatsapp('594694123456') OR NOT public.conversa_recebe_whatsapp('5977123456')
     OR NOT public.conversa_recebe_whatsapp('5596991112233') OR NOT public.conversa_recebe_whatsapp('96991112233')
     OR public.conversa_recebe_whatsapp('9632221234') OR public.conversa_recebe_whatsapp('5532221234')
     OR public.conversa_recebe_whatsapp('') OR public.conversa_recebe_whatsapp(NULL) THEN
    RAISE EXCEPTION 'conversa_recebe_whatsapp fora do esperado.';
  END IF;

  -- Permissões: as duas funções novas só para authenticated e service_role; a que grava continua fechada.
  FOREACH v_nome IN ARRAY ARRAY['public.ddd_do_brasil(text)', 'public.celular_br_valido(text)'] LOOP
    v_oid := v_nome::regprocedure;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = v_oid AND a.grantee = 0)
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.proconfig @> ARRAY['search_path=public']) THEN
      RAISE EXCEPTION 'Permissões ou search_path de % fora do esperado.', v_nome;
    END IF;
  END LOOP;
  v_oid := 'public.whatsapp_conversa_do_numero(text,text,uuid)'::regprocedure;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = v_oid AND a.grantee = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'whatsapp_conversa_do_numero ficou aberta ou sem search_path.';
  END IF;
END
$conferencia$;

-- ============================================================================
-- DESFAZER (recoloca as três funções como estavam; as duas novas ficam sem uso e podem sair)
-- ============================================================================
-- CREATE OR REPLACE FUNCTION public.telefone_recebe_whatsapp(p_telefone text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
--   SELECT CASE WHEN p_telefone IS NULL THEN false
--     ELSE COALESCE(public.normalize_whatsapp_phone(p_telefone) ~ '^[1-9][1-9]9[0-9]{8}$', false) OR public.telefone_estrangeiro(p_telefone) END; $f$;
-- CREATE OR REPLACE FUNCTION public.conversa_recebe_whatsapp(p_telefone text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
--   SELECT CASE WHEN p_telefone IS NULL THEN false
--     ELSE public.telefone_recebe_whatsapp(p_telefone)
--          OR (regexp_replace(p_telefone, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{11,14}$' AND regexp_replace(p_telefone, '[^0-9]', '', 'g') !~ '^55') END; $f$;
-- whatsapp_conversa_do_numero: recolocar a versão de supabase/migrations/20261101180000_cliente_estrangeiro_e_whatsapp_internacional.sql
-- DROP FUNCTION public.celular_br_valido(text);  DROP FUNCTION public.ddd_do_brasil(text);
-- As conversas de fora abertas depois desta migração ficam com "+" no telefone: é o formato que o envio entende, não precisa desfazer.
