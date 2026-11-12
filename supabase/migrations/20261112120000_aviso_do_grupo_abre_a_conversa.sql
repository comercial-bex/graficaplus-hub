-- O aviso de cliente novo no grupo da equipe passa a abrir a conversa (decisão 10 da onda
-- "cobrança de orçamento no grupo", 12/11/2026).
--
-- Copiada da definição VIVA de public.tg_atendimento_avisa_grupo() (pg_get_functiondef em 12/11,
-- idêntica à da migração 20261110100000). Muda SÓ o link:
--   Responder: https://bexprint.com.br/whatsapp
-- passa a
--   Responder: https://bexprint.com.br/whatsapp?conversa=<id da conversa>
-- com NEW.conversa_id como último argumento do format. O resto do texto (inclusive o telefone do
-- contato), a regra de quem é da equipe, a chave de idempotência e o EXCEPTION ficam iguais.
-- O gatilho não é recriado: CREATE OR REPLACE troca o corpo e o gatilho existente passa a usá-lo.

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

    v_texto := format(E'📥 %s · %s\n👤 %s · %s\n%s\nResponder: https://bexprint.com.br/whatsapp?conversa=%s',
      CASE WHEN NEW.reaberto_de IS NOT NULL THEN 'Conversa reaberta' ELSE 'Novo atendimento' END,
      NEW.numero,
      v_quem,
      public.telefone_legivel(v_conv.telefone),
      CASE WHEN v_cliente IS NOT NULL THEN '🏷️ Cliente: ' || v_cliente
           WHEN NEW.reaberto_de IS NOT NULL THEN '🔁 Já falou com a gente antes'
           ELSE '🆕 Contato novo' END,
      NEW.conversa_id);

    PERFORM public.enfileirar_notificacao('whatsapp', v_grupo, v_conv.cliente_id, 'aviso_grupo_equipe',
      'whatsapp_atendimento', NEW.id, 'aviso_grupo_equipe', jsonb_build_object('texto', v_texto),
      'grupo_equipe:atendimento:' || NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso no grupo da equipe falhou (atendimento %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_atendimento_avisa_grupo() FROM PUBLIC, anon, authenticated;
