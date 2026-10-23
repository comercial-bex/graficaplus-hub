-- Quem se cadastra como parceiro/terceirizado entra na hora.
--
-- Até aqui `parceiro_cadastrar_por_convite` criava o parceiro `pendente` e SEM
-- papel: a pessoa fazia o cadastro, confirmava o e-mail, entrava... e não via
-- nada até alguém aprovar. Foi o caso da Aline (22/10): inscreveu-se e ficou
-- travada. A regra do dono é outra: o cadastro libera o painel automaticamente
-- (ver preços de parceiro, fazer pedido); a equipe só SUSPENDE quem não deve
-- ficar. O acesso passa a ser controlado na aba "Parceiros e terceirizados"
-- de Equipe e acessos.
--
-- Desfazer: voltar 'ativo' para 'pendente' e remover o INSERT em user_roles
-- (corpo anterior em 20261022170000_parceiro_porta_da_casa_e_programa_publico.sql).
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.parceiro_cadastrar_por_convite(text,uuid,text,text,text,text,text,text)'::regprocedure);
  v_novo text;
  a1 text := $a$VALUES (v_cliente_id, p_usuario_id, 'pendente', v_nome,$a$;
  a2 text := $a$  RETURNING id INTO v_parceiro_id;
$a$;
BEGIN
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 THEN
    RAISE EXCEPTION 'âncora 1 não encontrada exatamente uma vez';
  END IF;
  IF (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'âncora 2 não encontrada exatamente uma vez';
  END IF;
  v_novo := replace(v_def, a1, $b$VALUES (v_cliente_id, p_usuario_id, 'ativo', v_nome,$b$);
  v_novo := replace(v_novo, a2, a2 || $b$
  -- O papel é o que abre o painel /parceiro.
  INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro')
  ON CONFLICT DO NOTHING;
$b$);
  EXECUTE v_novo;
END
$mig$;
