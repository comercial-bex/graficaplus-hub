-- usuarios: a pessoa muda o próprio nome, telefone e foto; o resto é do admin
-- (15/10/2026).
--
-- APLICADA no banco vivo em 15/10/2026 pelo MCP, com OK do dono, antes do
-- Publish: o front no ar já grava como admin pelo próprio JWT (PR #133) e
-- Meus dados só grava nome, telefone e foto. Conferida logo depois com as
-- contas reais, em rollback.
--
-- A policy "usuarios self update" (USING id = auth.uid() OR admin) deixa cada
-- um alterar a PRÓPRIA linha, e o GRANT de UPDATE do authenticated é na tabela
-- inteira. Juntas, deixavam qualquer pessoa logada, direto pela API, mudar em
-- si mesma:
--   ativo           -> é ele que liga has_permission e is_staff. Ensaio de
--                      15/10: o Sergio (desativado) se reativava com o JWT
--                      que ainda valia e voltava a ter os.read;
--   filas           -> "Minhas filas" da caixa do WhatsApp (whatsapp_minhas_filas,
--                      whatsapp_equipe), que só o admin define pela tela;
--   horas_semanais  -> denominador da ocupação em capacidade_das_pessoas;
--   email, cargo_pretendido -> a tela Meus dados já diz "quem troca o e-mail é
--                      o administrador".
-- Uso real até 15/10: 3 auto-edições, todas de foto. Ninguém mexeu nessas
-- colunas em si mesmo.
--
-- Por que gatilho e não GRANT por coluna: o admin grava pela API com o próprio
-- JWT (usuarios.functions.ts) e também é authenticated. Tirar o UPDATE da
-- coluna tiraria dele junto; só quem olha has_role(admin) separa os dois.
--
-- A lista é do que a pessoa PODE mudar (nome, telefone, avatar_url — o que
-- Meus dados grava). Coluna nova em usuarios nasce do admin.
--
-- Fora da trava, de propósito: tudo que não chega pela API como authenticated.
-- Chave de serviço (service_role), o gatilho do Auth que cria a ficha
-- (handle_new_user) e as funções SECURITY DEFINER (whatsapp_definir_filas_usuario,
-- que confere admin por conta própria) rodam como o dono da função. Por isso
-- esta função NÃO é SECURITY DEFINER: current_user tem de ser quem gravou.

CREATE OR REPLACE FUNCTION public.usuarios_so_o_admin_muda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_colunas text[];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_colunas
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key NOT IN ('nome', 'telefone', 'avatar_url', 'updated_at')
       AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
  ELSE
    -- INSERT: a ficha que falta, criada pela própria pessoa em Meus dados
    -- (a policy "usuarios admin insert" deixa). O que é do admin sai com o
    -- padrão da coluna (o mesmo do banco em 15/10/2026) e o e-mail é o do login.
    v_colunas := array_remove(ARRAY[
      CASE WHEN NEW.ativo IS DISTINCT FROM true THEN 'ativo' END,
      CASE WHEN NEW.filas IS DISTINCT FROM '{comercial}'::public.whatsapp_fila[] THEN 'filas' END,
      CASE WHEN NEW.horas_semanais IS DISTINCT FROM 40 THEN 'horas_semanais' END,
      CASE WHEN NEW.cargo_pretendido IS NOT NULL THEN 'cargo_pretendido' END,
      CASE WHEN lower(NEW.email) IS DISTINCT FROM lower(auth.jwt() ->> 'email') THEN 'email' END
    ], NULL);
    IF cardinality(v_colunas) = 0 THEN
      v_colunas := NULL;
    END IF;
  END IF;

  IF v_colunas IS NOT NULL THEN
    RAISE EXCEPTION 'Só o administrador muda % de uma conta. Peça em Equipe e acessos.',
      array_to_string(v_colunas, ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.usuarios_so_o_admin_muda() IS
  'Gatilho de usuarios: pela API, quem não é admin muda só nome, telefone e avatar_url da própria linha (e cria a própria ficha com os padrões). service_role, handle_new_user e funções SECURITY DEFINER passam. SECURITY INVOKER de propósito: current_user é quem gravou.';

-- Função de gatilho não precisa de EXECUTE de ninguém para disparar (ensaiado).
REVOKE ALL ON FUNCTION public.usuarios_so_o_admin_muda() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_usuarios_so_o_admin_muda ON public.usuarios;
CREATE TRIGGER tg_usuarios_so_o_admin_muda
  BEFORE INSERT OR UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_so_o_admin_muda();
