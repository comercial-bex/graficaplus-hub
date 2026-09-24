-- A peça fica pronta e alguém tem de sair para entregar.
--
-- `entregas_instalacoes` era o elo morto mais caro do sistema: a tela
-- /entregas lê, cria e atualiza — e NADA no banco criava a entrega a partir da
-- OS. Nenhuma função, nenhum gatilho. A OS marcava `precisa_entrega`, ficava
-- pronta, e a entrega só existia se alguém lembrasse de digitar. Era o primeiro
-- degrau do caminho que fechava 13% dos passos, o pior de todos.
--
-- Agora: quando a OS chega em aguardando_entrega / em_entrega / em_instalacao
-- e pede entrega ou instalação, a linha nasce sozinha — uma por necessidade,
-- com o endereço resolvido e a data do prazo.
--
-- O gatilho é ACESSÓRIO: a OS tem de poder avançar mesmo que a entrega não
-- consiga nascer, então ele engole o erro. Mas não em silêncio — deixa
-- RAISE WARNING no log, e a pendência `os_pronta_sem_entrega_agendada` pega o
-- que escapar. Engolir sem rastro é o defeito que esconde o próprio defeito.
--
-- COMO DESFAZER:
--   drop trigger tg_os_gera_entrega on public.ordens_servico;
--   drop function public.tg_os_gera_entrega(), public.endereco_da_entrega(uuid);
--   e remover a pendência os_pronta_sem_entrega_agendada.

-- --------------------------------------------------- de onde sai o endereço
-- `ordens_servico.endereco_entrega` é jsonb de formato livre — nasceu do
-- orçamento e ninguém fixou a forma. Aceita string solta, {texto}, {endereco}
-- ou {logradouro}; sem nada disso, cai no cadastro do cliente. Exigir uma
-- forma só devolveria vazio para todas as outras.
CREATE OR REPLACE FUNCTION public.endereco_da_entrega(p_os_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e jsonb; chave text; c RECORD;
BEGIN
  SELECT os.endereco_entrega INTO e FROM public.ordens_servico os WHERE os.id = p_os_id;

  IF e IS NOT NULL AND e <> '{}'::jsonb THEN
    IF jsonb_typeof(e) = 'string' THEN RETURN nullif(trim(e #>> '{}'), ''); END IF;
    FOREACH chave IN ARRAY ARRAY['texto', 'endereco', 'logradouro', 'rua'] LOOP
      IF COALESCE(e ->> chave, '') <> '' THEN
        RETURN nullif(trim(concat_ws(', ', e ->> chave, e ->> 'numero', e ->> 'bairro', e ->> 'cidade')), '');
      END IF;
    END LOOP;
  END IF;

  SELECT cl.endereco AS endereco, cl.bairro AS bairro, cl.cidade AS cidade, cl.estado AS estado INTO c
  FROM public.ordens_servico os JOIN public.clientes cl ON cl.id = os.cliente_id
  WHERE os.id = p_os_id;

  IF NOT FOUND OR COALESCE(c.endereco, '') = '' THEN RETURN NULL; END IF;
  RETURN nullif(trim(concat_ws(', ', c.endereco, c.bairro, c.cidade, c.estado)), '');
END $function$;

REVOKE ALL ON FUNCTION public.endereco_da_entrega(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endereco_da_entrega(uuid) TO authenticated;

-- ------------------------------------------- a entrega nasce com a peça pronta
CREATE OR REPLACE FUNCTION public.tg_os_gera_entrega()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_end text; v_quando timestamptz;
BEGIN
  -- Só quando a peça fica pronta para sair. Antes é adivinhar; depois é tarde.
  IF NEW.status NOT IN ('aguardando_entrega', 'em_entrega', 'em_instalacao') THEN
    RETURN NULL;
  END IF;
  IF NOT COALESCE(NEW.precisa_entrega, false) AND NOT COALESCE(NEW.precisa_instalacao, false) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_end := public.endereco_da_entrega(NEW.id);
    -- 9h da manhã do prazo, no fuso do Amapá. Prazo é DATE: sem o fuso
    -- explícito viraria 21h do dia anterior.
    v_quando := CASE WHEN NEW.prazo_entrega IS NOT NULL
                     THEN (NEW.prazo_entrega + time '09:00') AT TIME ZONE 'America/Belem' END;

    -- Uma linha por necessidade, e nunca duas: o NOT EXISTS deixa o gatilho
    -- repetir a cada avanço de status sem duplicar a rota do instalador.
    IF COALESCE(NEW.precisa_entrega, false) THEN
      INSERT INTO public.entregas_instalacoes (os_id, tipo, endereco, data_agendada, status)
      SELECT NEW.id, 'entrega', v_end, v_quando, 'agendada'
      WHERE NOT EXISTS (SELECT 1 FROM public.entregas_instalacoes e
                         WHERE e.os_id = NEW.id AND e.tipo = 'entrega' AND e.status <> 'cancelada');
    END IF;

    IF COALESCE(NEW.precisa_instalacao, false) THEN
      INSERT INTO public.entregas_instalacoes (os_id, tipo, endereco, data_agendada, status)
      SELECT NEW.id, 'instalacao', v_end, v_quando, 'agendada'
      WHERE NOT EXISTS (SELECT 1 FROM public.entregas_instalacoes e
                         WHERE e.os_id = NEW.id AND e.tipo = 'instalacao' AND e.status <> 'cancelada');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Não deu para abrir a entrega da OS %: %', NEW.id, SQLERRM;
  END;

  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS tg_os_gera_entrega ON public.ordens_servico;
CREATE TRIGGER tg_os_gera_entrega
  AFTER INSERT OR UPDATE OF status ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_gera_entrega();

REVOKE ALL ON FUNCTION public.tg_os_gera_entrega() FROM PUBLIC, anon, authenticated;

-- --------------------------------------- a rede embaixo do gatilho acessório
DO $patch$
DECLARE src text; novo text; marca text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';

  marca := '  RETURN QUERY SELECT ''cliente_sem_contato''';

  novo := replace(src, marca,
'  -- Rede de segurança do gatilho tg_os_gera_entrega: ele abre a entrega
  -- sozinho, mas engole o próprio erro para não travar o avanço da OS. Se
  -- engolir, a peça fica pronta e ninguém sai para entregar — e é aqui que
  -- isso aparece.
  RETURN QUERY SELECT ''os_pronta_sem_entrega_agendada'',''Peças prontas para sair sem entrega agendada'', count(*)::int,
    (SELECT count(*)::int FROM public.ordens_servico WHERE precisa_entrega OR precisa_instalacao),''critico'',''producao'',
    ''A peça está pronta e pede entrega ou instalação, mas não há nada agendado. Abra Entregas e agende — o cliente está esperando.'',''/entregas''
  FROM public.ordens_servico os
  WHERE os.status IN (''aguardando_entrega'',''em_entrega'',''em_instalacao'')
    AND (COALESCE(os.precisa_entrega,false) OR COALESCE(os.precisa_instalacao,false))
    AND NOT EXISTS (SELECT 1 FROM public.entregas_instalacoes e
                     WHERE e.os_id = os.id AND e.status <> ''cancelada'')
  HAVING count(*) > 0;

' || marca);
  IF novo = src THEN RAISE EXCEPTION 'ponto de inserção da pendência não encontrado'; END IF;
  EXECUTE novo;
END $patch$;
