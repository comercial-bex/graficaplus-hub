-- Aviso no grupo de WhatsApp da equipe quando chega cliente, como o Bex Lite faz no grupo
-- BEX/PRODUÇÃO.
--
-- O número da gráfica já está no grupo de trabalho "BEX PRINT" (120363431862625987-group): as
-- mensagens do grupo chegam no webhook e são descartadas de propósito (não viram lead). Faltava o
-- caminho de ida: a fila limpava o destino para só dígitos (normalize_whatsapp_phone no banco,
-- onlyDigits no envio), e "120363…-group" virava um número que não existe.
--
-- O que este arquivo faz:
--  1. guarda o grupo da equipe em whatsapp_configuracoes, com o aviso DESLIGADO até a função de
--     envio nova estar no ar (antes disso o envio ao grupo falharia);
--  2. enfileirar_notificacao aceita endereço de grupo sem mexer nele;
--  3. avisa no grupo quando abre um atendimento (mensagem nova ou conversa reaberta) e quando
--     alguém lança um lead à mão (lead do WhatsApp já é avisado pelo atendimento);
--  4. modelo "aviso_grupo_equipe" ({{texto}}), que pode ser desligado na tela de avisos.
--
-- Mensagem de alguém da equipe para o número da gráfica não vira aviso no grupo.
-- O aviso nunca impede o atendimento de abrir: se falhar, o atendimento segue e fica o WARNING.

ALTER TABLE public.whatsapp_configuracoes
  ADD COLUMN IF NOT EXISTS grupo_equipe_id text,
  ADD COLUMN IF NOT EXISTS grupo_equipe_ativo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_configuracoes.grupo_equipe_id IS
  'Id Z-API do grupo de trabalho da equipe (formato 120363…-group). Recebe os avisos de cliente novo.';
COMMENT ON COLUMN public.whatsapp_configuracoes.grupo_equipe_ativo IS
  'Liga os avisos no grupo da equipe. Só ligar com a função process-automations que envia para grupo no ar.';

UPDATE public.whatsapp_configuracoes
   SET grupo_equipe_id = '120363431862625987-group'
 WHERE grupo_equipe_id IS NULL;

-- A fila só aceitava orçamento/OS/parceiro/usuário: o aviso de atendimento e de lead cairia no
-- EXCEPTION do gatilho e nunca sairia.
ALTER TABLE public.notificacoes_fila DROP CONSTRAINT IF EXISTS notificacoes_fila_entidade_check;
ALTER TABLE public.notificacoes_fila ADD CONSTRAINT notificacoes_fila_entidade_check
  CHECK (entidade = ANY (ARRAY['orcamento'::text, 'ordem_servico'::text, 'parceiro'::text, 'usuario'::text,
                               'whatsapp_atendimento'::text, 'lead'::text]));

INSERT INTO public.notificacao_templates (evento, canal, corpo, descricao, ativo)
SELECT 'aviso_grupo_equipe', 'whatsapp', '{{texto}}',
       'Aviso no grupo de WhatsApp da equipe: atendimento aberto ou lead novo', true
 WHERE NOT EXISTS (SELECT 1 FROM public.notificacao_templates WHERE evento = 'aviso_grupo_equipe');

CREATE OR REPLACE FUNCTION public.enfileirar_notificacao(p_canal text, p_destinatario text, p_cliente_id uuid, p_evento text, p_entidade text, p_entidade_id uuid, p_template text, p_variaveis jsonb, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_destino text;
BEGIN
  v_destino := CASE WHEN p_canal='whatsapp' AND btrim(p_destinatario) ~ '^\d{10,}-group$' THEN btrim(p_destinatario)
                    WHEN p_canal='whatsapp' THEN public.normalize_whatsapp_phone(p_destinatario)
                    ELSE lower(nullif(btrim(p_destinatario),'')) END;
  IF v_destino IS NULL OR v_destino = '' THEN RETURN NULL; END IF;
  INSERT INTO public.notificacoes_fila (canal, destinatario, cliente_id, evento, entidade,
    entidade_id, template, variaveis, idempotency_key)
  VALUES (p_canal, v_destino, p_cliente_id, p_evento, p_entidade, p_entidade_id,
    p_template, COALESCE(p_variaveis,'{}'::jsonb), p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- Grupo ligado e com id, ou NULL.
CREATE OR REPLACE FUNCTION public.grupo_equipe_destino()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT grupo_equipe_id FROM public.whatsapp_configuracoes
   WHERE grupo_equipe_ativo AND grupo_equipe_id ~ '^\d{10,}-group$'
   LIMIT 1
$function$;

-- "(96) 99154-0452" a partir de 559691540452; outro formato sai como veio.
CREATE OR REPLACE FUNCTION public.telefone_legivel(p_telefone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN d ~ '^\d{11}$' THEN format('(%s) %s-%s', left(d, 2), substring(d, 3, 5), right(d, 4))
           WHEN d ~ '^\d{10}$' THEN format('(%s) %s-%s', left(d, 2), substring(d, 3, 4), right(d, 4))
           ELSE p_telefone
         END
    FROM (SELECT public.normalize_whatsapp_phone(p_telefone) AS d) x
$function$;

CREATE OR REPLACE FUNCTION public.tg_atendimento_avisa_grupo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo text := public.grupo_equipe_destino();
  v_conv public.whatsapp_conversas%ROWTYPE;
  v_cliente text;
  v_quem text;
  v_texto text;
BEGIN
  IF v_grupo IS NULL OR NEW.origem_abertura::text = 'manual' THEN RETURN NEW; END IF;

  BEGIN
    SELECT * INTO v_conv FROM public.whatsapp_conversas WHERE id = NEW.conversa_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    -- Alguém da equipe escrevendo para o número da gráfica não é cliente chegando. Parceiro
    -- (revenda) é cliente: o aviso sai.
    IF EXISTS (SELECT 1 FROM public.usuarios u
                WHERE u.ativo AND u.telefone IS NOT NULL
                  AND public.normalize_whatsapp_phone(u.telefone) = public.normalize_whatsapp_phone(v_conv.telefone)
                  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text <> 'parceiro')) THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_cliente FROM public.clientes WHERE id = v_conv.cliente_id;
    v_quem := COALESCE(NULLIF(btrim(v_conv.nome_contato), ''), 'Sem nome');

    v_texto := format(E'📥 %s · %s\n👤 %s · %s\n%s\nResponder: https://bexprint.com.br/whatsapp',
      CASE WHEN NEW.reaberto_de IS NOT NULL THEN 'Conversa reaberta' ELSE 'Novo atendimento' END,
      NEW.numero,
      v_quem,
      public.telefone_legivel(v_conv.telefone),
      CASE WHEN v_cliente IS NOT NULL THEN '🏷️ Cliente: ' || v_cliente
           WHEN NEW.reaberto_de IS NOT NULL THEN '🔁 Já falou com a gente antes'
           ELSE '🆕 Contato novo' END);

    PERFORM public.enfileirar_notificacao('whatsapp', v_grupo, v_conv.cliente_id, 'aviso_grupo_equipe',
      'whatsapp_atendimento', NEW.id, 'aviso_grupo_equipe', jsonb_build_object('texto', v_texto),
      'grupo_equipe:atendimento:' || NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (atendimento %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_atendimento_avisa_grupo ON public.whatsapp_atendimentos;
CREATE TRIGGER tg_atendimento_avisa_grupo
  AFTER INSERT ON public.whatsapp_atendimentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_atendimento_avisa_grupo();

CREATE OR REPLACE FUNCTION public.tg_lead_avisa_grupo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo text := public.grupo_equipe_destino();
  v_por text;
  v_texto text;
BEGIN
  -- Lead do WhatsApp já é avisado pelo atendimento que o criou.
  IF v_grupo IS NULL OR NEW.temporario OR lower(COALESCE(NEW.origem, '')) = 'whatsapp' THEN RETURN NEW; END IF;

  BEGIN
    SELECT nome INTO v_por FROM public.usuarios WHERE id = NEW.created_by;

    v_texto := format(E'🎯 Lead novo · %s\n👤 %s%s%s%s\nVer: https://bexprint.com.br/leads',
      COALESCE(NULLIF(btrim(NEW.origem), ''), 'sem origem'),
      COALESCE(NULLIF(btrim(NEW.nome), ''), 'Sem nome'),
      CASE WHEN NEW.telefone IS NOT NULL THEN ' · ' || public.telefone_legivel(NEW.telefone) ELSE '' END,
      CASE WHEN NULLIF(btrim(NEW.interesse), '') IS NOT NULL THEN E'\n💬 ' || left(btrim(NEW.interesse), 120) ELSE '' END,
      CASE WHEN v_por IS NOT NULL THEN E'\n✍️ Lançado por ' || v_por ELSE '' END);

    PERFORM public.enfileirar_notificacao('whatsapp', v_grupo, NEW.cliente_id, 'aviso_grupo_equipe',
      'lead', NEW.id, 'aviso_grupo_equipe', jsonb_build_object('texto', v_texto),
      'grupo_equipe:lead:' || NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (lead %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_lead_avisa_grupo ON public.leads;
CREATE TRIGGER tg_lead_avisa_grupo
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_avisa_grupo();

REVOKE EXECUTE ON FUNCTION public.grupo_equipe_destino() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_atendimento_avisa_grupo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_lead_avisa_grupo() FROM PUBLIC, anon, authenticated;
