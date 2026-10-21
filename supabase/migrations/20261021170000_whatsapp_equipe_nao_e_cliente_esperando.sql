-- Mensagem da EQUIPE não é cliente esperando resposta (21/10/2026).
--
-- O painel dizia "Clientes esperando resposta no WhatsApp: Leo (desde 20/10
-- 17:28), jhesselem medeiros (desde 21/10 10:00), Griff Móveis…": dois dos três
-- eram o Leonardo e a Jhessy escrevendo do próprio celular para o número da
-- empresa. `_wa_mensagem_antes_inserir` marca `aguardando_desde` e abre um
-- atendimento para qualquer número que escreve — e esse campo alimenta a
-- pendência, a Fila humana e os números do atendimento.
--
-- Agora: número de alguém da equipe ATIVA entra na conversa normalmente, mas não
-- abre atendimento nem conta como cliente esperando. A pendência ganha a mesma
-- exclusão (a transferência de fila também marca `aguardando_desde`). As
-- conversas da equipe que estavam marcadas como esperando são desmarcadas.
-- Limite conhecido: alguém da equipe que também compra como cliente, escrevendo
-- do mesmo número, não entra na fila — a pessoa está do lado de dentro.
--
-- Edição por substituição ancorada no corpo VIVO (como 20261021090000): âncora
-- fora do esperado para a migração sem mudar nada.

CREATE OR REPLACE FUNCTION public._wa_telefone_da_equipe(p_telefone_normalizado text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_telefone_normalizado IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.usuarios u
     WHERE u.ativo IS NOT FALSE
       AND coalesce(btrim(u.telefone), '') <> ''
       AND public.normalize_whatsapp_phone(u.telefone) = p_telefone_normalizado
  )
$function$;
COMMENT ON FUNCTION public._wa_telefone_da_equipe(text) IS
  'O número (já normalizado) é de alguém da equipe ativa? Usado para a mensagem da equipe não virar cliente esperando.';
REVOKE ALL ON FUNCTION public._wa_telefone_da_equipe(text) FROM PUBLIC, anon, authenticated;

-- 1. A mensagem que chega -------------------------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public._wa_mensagem_antes_inserir'::regproc);
  v_de text := E'      v_at := coalesce(c.atendimento_ativo_id, public._wa_abrir_atendimento(c.id, ''mensagem_recebida'', NULL));\n      UPDATE public.whatsapp_conversas SET aguardando_desde = coalesce(aguardando_desde, v_quando) WHERE id = c.id;\n';
  v_para text := E'      IF public._wa_telefone_da_equipe(c.telefone_normalizado) THEN\n        -- Alguém da equipe escrevendo do próprio celular (21/10/2026): entra na\n        -- conversa, mas não abre atendimento nem conta como cliente esperando.\n        v_at := c.atendimento_ativo_id;\n      ELSE\n        v_at := coalesce(c.atendimento_ativo_id, public._wa_abrir_atendimento(c.id, ''mensagem_recebida'', NULL));\n        UPDATE public.whatsapp_conversas SET aguardando_desde = coalesce(aguardando_desde, v_quando) WHERE id = c.id;\n      END IF;\n';
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION '_wa_mensagem_antes_inserir: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 2. A pendência do painel ------------------------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema'::regproc);
  v_de text := E'  WHERE c.status = ''aberta'' AND c.aguardando_desde < now() - interval ''2 hours''\n';
  v_para text := E'  WHERE c.status = ''aberta'' AND c.aguardando_desde < now() - interval ''2 hours''\n    AND NOT public._wa_telefone_da_equipe(c.telefone_normalizado)\n';
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'pendencias_do_sistema: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 3. As conversas da equipe que estavam marcadas como esperando ------------------
UPDATE public.whatsapp_conversas
   SET aguardando_desde = NULL
 WHERE aguardando_desde IS NOT NULL
   AND public._wa_telefone_da_equipe(telefone_normalizado);
