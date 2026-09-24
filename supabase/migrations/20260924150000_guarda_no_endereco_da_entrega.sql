-- `endereco_da_entrega` nasceu sem guarda, na migração de uma hora atrás.
--
-- Ela é SECURITY DEFINER de propósito: o gatilho precisa do endereço do cliente
-- sem depender da RLS de `clientes`, que exige `clientes.read`. Só que eu a
-- concedi a `authenticated` sem checar quem chama — então qualquer pessoa
-- logada, inclusive um parceiro ou um cliente do portal, lia o endereço de
-- qualquer OS passando o id. Endereço é dado pessoal.
--
-- Achado pela varredura de "RPC DEFINER sem guarda" que eu mesmo rodo depois
-- de mexer no banco. O gatilho não é afetado: quem avança status já é staff.
--
-- COMO DESFAZER: recriar a função sem o IF NOT is_staff (mas aí o endereço
-- volta a ficar aberto).

CREATE OR REPLACE FUNCTION public.endereco_da_entrega(p_os_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e jsonb; chave text; c RECORD;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

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
