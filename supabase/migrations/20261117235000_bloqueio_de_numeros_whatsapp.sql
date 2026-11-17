-- BLOQUEIO DE NÚMEROS NO WHATSAPP (17/11/2026), APLICADA no banco vivo em 17/11/2026.
-- O dono mandou parar todas as mensagens para Léo (Leonardo Pimentel) e Yvens. Léo já estava inativo em usuarios;
-- Yvens foi desativado (usuarios.ativo = false). A trava vale para qualquer origem de envio:
--   - whatsapp_numeros_bloqueados guarda a chave do número (DDD + últimos 8 dígitos, sem 55 e sem o 9 extra);
--   - gatilho BEFORE INSERT em notificacoes_fila marca como cancelado, com a observação dizendo o motivo;
--   - gatilho BEFORE INSERT em whatsapp_fila_envio marca como falha, com o motivo em erro;
--   - whatsapp_automacao_bloqueios (motivo manual) impede a triagem de responder as duas conversas.
-- Ensaiada: Yvens e Léo ficam cancelado, outro número segue pendente (teste desfeito por RAISE EXCEPTION).
-- COMO DESBLOQUEAR: DELETE FROM whatsapp_numeros_bloqueados WHERE chave = '<chave>'; e apagar a linha da conversa em
-- whatsapp_automacao_bloqueios. Reativar Yvens: UPDATE usuarios SET ativo = true WHERE id = 'aae7d579-f2eb-4f80-a34b-1d82d12ab356'.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.whatsapp_numeros_bloqueados (
  chave text PRIMARY KEY, nome text, motivo text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.whatsapp_numeros_bloqueados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_numeros_bloqueados FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_numeros_bloqueados TO service_role;
DROP POLICY IF EXISTS "bloqueados leitura admin" ON public.whatsapp_numeros_bloqueados;
CREATE POLICY "bloqueados leitura admin" ON public.whatsapp_numeros_bloqueados FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));
GRANT SELECT ON public.whatsapp_numeros_bloqueados TO authenticated;
CREATE OR REPLACE FUNCTION public._wa_chave_numero(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(d) < 10 THEN NULL
              ELSE substr(CASE WHEN length(d) >= 12 AND left(d,2) = '55' THEN substr(d,3) ELSE d END, 1, 2) || right(d, 8) END
  FROM (SELECT regexp_replace(coalesce(p,''), '\D', '', 'g') AS d) s
$$;
REVOKE ALL ON FUNCTION public._wa_chave_numero(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wa_chave_numero(text) TO service_role;
CREATE OR REPLACE FUNCTION public.tg_notificacao_numero_bloqueado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.canal = 'whatsapp' AND EXISTS (SELECT 1 FROM public.whatsapp_numeros_bloqueados b WHERE b.chave = public._wa_chave_numero(NEW.destinatario)) THEN
    NEW.status := 'cancelado';
    NEW.observacao := coalesce(NEW.observacao || ' | ', '') || 'Número bloqueado pelo dono: nenhuma mensagem é enviada.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_notificacao_numero_bloqueado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tg_notificacao_numero_bloqueado ON public.notificacoes_fila;
CREATE TRIGGER tg_notificacao_numero_bloqueado BEFORE INSERT ON public.notificacoes_fila
  FOR EACH ROW EXECUTE FUNCTION public.tg_notificacao_numero_bloqueado();
CREATE OR REPLACE FUNCTION public.tg_fila_envio_numero_bloqueado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversas c JOIN public.whatsapp_numeros_bloqueados b
               ON b.chave = public._wa_chave_numero(coalesce(c.telefone_normalizado, c.telefone))
             WHERE c.id = NEW.conversa_id) THEN
    NEW.status := 'falha';
    NEW.erro := 'Número bloqueado pelo dono: nenhuma mensagem é enviada.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_fila_envio_numero_bloqueado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tg_fila_envio_numero_bloqueado ON public.whatsapp_fila_envio;
CREATE TRIGGER tg_fila_envio_numero_bloqueado BEFORE INSERT ON public.whatsapp_fila_envio
  FOR EACH ROW EXECUTE FUNCTION public.tg_fila_envio_numero_bloqueado();
INSERT INTO public.whatsapp_numeros_bloqueados (chave, nome, motivo) VALUES
  (public._wa_chave_numero('(96) 99142-3082'), 'Leonardo Pimentel (Léo)', 'Dono mandou parar todas as mensagens (17/11/2026)'),
  (public._wa_chave_numero('(96) 99156-4805'), 'Yvens', 'Dono mandou parar todas as mensagens (17/11/2026)')
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.whatsapp_automacao_bloqueios (conversa_id, telefone_hash, motivo, origem)
SELECT c.id, public._triagem_hash(c.telefone_normalizado), 'manual', 'dono'
FROM public.whatsapp_conversas c
WHERE public._wa_chave_numero(coalesce(c.telefone_normalizado, c.telefone)) IN (SELECT chave FROM public.whatsapp_numeros_bloqueados);
UPDATE public.usuarios SET ativo = false WHERE id = 'aae7d579-f2eb-4f80-a34b-1d82d12ab356';
COMMIT;
