-- O quadro destrava sem burocracia (31/10/2026).
--
-- O dono pediu para testar o quadro "de verdade" e ver onde a equipe trava. O teste (ensaio desfeito, como
-- Leonardo, Jhesselem e Cibele) mostrou que 17 das 18 OS abertas não entravam na Fila de produção. Três causas,
-- fechadas aqui com o OK do dono:
--
--  1. Quem destrava não podia. `arquivos.upload` e `arquivos.finalize` eram só de admin, designer e gestor, e a
--     ficha do quadro oferecia "Anexar arquivo" a todos: operador e vendedor levavam "sem permissão". Agora operador
--     e vendedor anexam e marcam o arquivo final. O vendedor também passa a LER arquivo: sem a leitura, o
--     INSERT ... RETURNING do anexo é barrado pela política de SELECT.
--
--  2. "Arte aprovada" era um status que qualquer um escolhia, e a trava lia OUTRO registro, o aceite
--     (`arte_aprovada_da_os`). A 165 e a 168 estavam no status e o cartão dizia "Arte ainda não aprovada".
--     `registrar_aceite_da_arte` grava o aceite num gesto só (canal e nota), com ou sem arquivo na OS: a 163, a 166
--     e a 169 têm zero arquivos e `registrar_aprovacao_interna` exige um arquivo da OS. Leva a OS para
--     "Arte aprovada" só se ela ainda estiver antes disso; nunca recua uma OS que já está adiante.
--
--  3. O status legado `producao` ("duplica Em produção") não estava na lista de
--     `status_os_exige_validacoes_producao`: passava sem pagamento, arte, arquivo nem material, para qualquer
--     perfil (as OS 170 a 173 entraram por ele em 26/10). Passa a ter as mesmas travas. As que já estão nele
--     ficam onde estão: a trava só olha quem tenta MOVER.
--
-- Nenhuma OS muda de status, nenhum aceite é inventado e nada é apagado: os 13 aceites que faltam são da
-- equipe, agora a um clique. Tudo é idempotente.

-- 1. Permissões: 2 linhas para o operador e 3 para o vendedor (as que já existem são puladas).
INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT x.perfil, x.permissao
  FROM (VALUES
         ('operador', 'arquivos.upload'),
         ('operador', 'arquivos.finalize'),
         ('vendedor', 'arquivos.read'),
         ('vendedor', 'arquivos.upload'),
         ('vendedor', 'arquivos.finalize')
       ) AS x(perfil, permissao)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.perfil_permissoes p WHERE p.perfil = x.perfil AND p.permissao = x.permissao
 );

-- 2. O aceite da arte, num gesto.
CREATE OR REPLACE FUNCTION public.registrar_aceite_da_arte(
  p_os_id uuid,
  p_canal text DEFAULT 'whatsapp',
  p_observacao text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid;
  v_os public.ordens_servico%ROWTYPE;
  v_arquivo uuid;
  v_obs text := NULLIF(btrim(p_observacao), '');
  v_status text;
BEGIN
  v_uid := public.require_permission('os.update');

  IF p_canal NOT IN ('sistema', 'whatsapp', 'email', 'presencial', 'telefone') THEN
    RAISE EXCEPTION 'Canal invalido: use sistema, whatsapp, email, presencial ou telefone.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_os.status IN ('concluido', 'faturado', 'cancelado') THEN
    RAISE EXCEPTION 'A OS nº % já está encerrada: não há aceite a registrar.', v_os.numero;
  END IF;

  -- Já aceita: devolve sem gravar de novo (dois toques no botão não viram duas aprovações).
  IF public.arte_aprovada_da_os(p_os_id) THEN
    RETURN jsonb_build_object('ok', true, 'ja_aceita', true, 'os_id', p_os_id, 'status', v_os.status::text);
  END IF;

  -- O arquivo que o cliente viu: o final de produção, senão o mais recente que vale. Pode não haver nenhum
  -- (a arte veio pelo WhatsApp e está no RIP): o aceite vale do mesmo jeito.
  SELECT a.id INTO v_arquivo
    FROM public.arquivos a
   WHERE a.os_id = p_os_id AND a.ativo AND a.substituido_por IS NULL AND a.status <> 'substituido'
   ORDER BY a.final_producao DESC, a.created_at DESC
   LIMIT 1;

  INSERT INTO public.aprovacoes (tipo, os_id, arquivo_id, aprovado, canal, usuario_id, observacao)
  VALUES ('arte'::tipo_aprovacao, p_os_id, v_arquivo, true, p_canal::canal_aprovacao, v_uid,
          COALESCE(v_obs, 'Aceite registrado na ficha do quadro'));

  -- Com arquivo, o histórico da peça fica igual ao de `registrar_aprovacao_interna`.
  IF v_arquivo IS NOT NULL THEN
    INSERT INTO public.arquivo_aprovacoes (arquivo_id, decisao, usuario_id, comentario, canal)
    VALUES (v_arquivo, 'aprovado', v_uid, v_obs, p_canal);
    UPDATE public.arquivos SET status = 'aprovado', data_aprovacao = now() WHERE id = v_arquivo;
  END IF;

  -- Só avança quem ainda está antes de "Arte aprovada". Quem já está adiante fica onde está.
  v_status := v_os.status::text;
  IF v_os.status IN ('entrada', 'aguardando_briefing', 'briefing_ok', 'design', 'aguardando_aprovacao_arte', 'arte_rejeitada') THEN
    PERFORM set_config('app.avancar_os_status', 'on', true);
    UPDATE public.ordens_servico SET status = 'arte_aprovada' WHERE id = p_os_id;
    PERFORM set_config('app.avancar_os_status', '', true);
    v_status := 'arte_aprovada';
  END IF;

  RETURN jsonb_build_object('ok', true, 'ja_aceita', false, 'os_id', p_os_id, 'arquivo_id', v_arquivo, 'status', v_status);
END
$fn$;

REVOKE ALL ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) IS
  'Aceite da arte pela equipe, num gesto, com ou sem arquivo na OS (31/10/2026). Exige os.update; idempotente; só avança a OS se ela ainda está antes de arte_aprovada.';

-- 3. O status legado `producao` passa a ter as mesmas travas (troca na definição viva, com âncora contada).
DO $quadro$
DECLARE
  v_def text := pg_get_functiondef('public.status_os_exige_validacoes_producao(public.status_os)'::regprocedure);
  v_ancora text := $a$'aguardando_producao','em_producao',$a$;
  v_novo text := $b$'aguardando_producao','producao','em_producao',$b$;
  v_vezes int;
BEGIN
  IF position(v_novo IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  IF v_vezes <> 1 THEN
    RAISE EXCEPTION 'Âncora % vezes (esperava 1): a função mudou e nada foi alterado.', v_vezes;
  END IF;
  EXECUTE replace(v_def, v_ancora, v_novo);
END
$quadro$;
