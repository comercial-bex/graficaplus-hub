-- #############################################################################
-- SEÇÃO B — ATENDENTE PADRÃO
-- #############################################################################

-- B.1 Quem recebe os parceiros sem atendente. Começa NULO (definir com o dono).
-- Herda a política de escrita por tabela (parceiros.manage), como em A.1.
ALTER TABLE public.parceiro_programa
  ADD COLUMN atendente_padrao_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- B.2 Gatilho: parceiro ativo sem atendente recebe o padrão (se for usuário ativo).
-- Nome "ab_" para rodar depois de aa_parceiro_codigo_convite (BEFORE em ordem alfabética).
CREATE OR REPLACE FUNCTION public.tg_parceiro_atendente_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE v_atendente uuid;
BEGIN
  IF NEW.status <> 'ativo' OR NEW.responsavel_id IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    SELECT u.id INTO v_atendente
      FROM public.parceiro_programa pp
      JOIN public.usuarios u ON u.id = pp.atendente_padrao_id AND u.ativo
     WHERE pp.id LIMIT 1;
    IF v_atendente IS NOT NULL THEN NEW.responsavel_id := v_atendente; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_parceiro_atendente_padrao: atendente não definido para o parceiro %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.tg_parceiro_atendente_padrao() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ab_parceiro_atendente_padrao
  BEFORE INSERT OR UPDATE OF status, usuario_id ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_atendente_padrao();

-- B.3 Painel da equipe: atribuir o padrão aos que estão sem atendente.
CREATE OR REPLACE FUNCTION public.parceiros_atribuir_atendente_padrao(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE v_atendente uuid; v_qtd integer;
BEGIN
  PERFORM public.require_permission('parceiros.manage');
  SELECT u.id INTO v_atendente
    FROM public.parceiro_programa pp
    JOIN public.usuarios u ON u.id = pp.atendente_padrao_id AND u.ativo
   WHERE pp.id LIMIT 1;
  IF v_atendente IS NULL THEN
    RAISE EXCEPTION 'Defina um atendente padrão ativo na aba Programa antes.';
  END IF;
  UPDATE public.parceiros
     SET responsavel_id = v_atendente
   WHERE id = ANY (COALESCE(p_ids, '{}'::uuid[]))
     AND responsavel_id IS NULL AND status = 'ativo';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END
$$;
REVOKE ALL ON FUNCTION public.parceiros_atribuir_atendente_padrao(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiros_atribuir_atendente_padrao(uuid[]) TO authenticated, service_role;

-- B.4 parceiros_pendentes: sai só a janela de 14 dias da 2ª condição.
CREATE OR REPLACE FUNCTION public.parceiros_pendentes()
 RETURNS TABLE(id uuid, nome text, documento text, telefone text, email text, cidade text, estado text, convidado_por text, criado_em timestamp with time zone, tem_login boolean, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_permission('parceiros.read');
  RETURN QUERY
  SELECT p.id,
         coalesce(nullif(btrim(p.marca_nome),''), c.nome),
         p.marca_documento, p.marca_telefone, p.marca_email,
         p.marca_cidade, p.marca_estado,
         coalesce(nullif(btrim(padrinho.marca_nome),''), pc.nome, 'cadastro direto'),
         p.created_at,
         p.usuario_id IS NOT NULL,
         p.status
  FROM public.parceiros p
  LEFT JOIN public.clientes c ON c.id = p.cliente_id
  LEFT JOIN public.parceiros padrinho ON padrinho.id = p.indicado_por
  LEFT JOIN public.clientes pc ON pc.id = padrinho.cliente_id
  WHERE p.status = 'pendente'
     OR (p.status = 'ativo' AND p.responsavel_id IS NULL)  -- [atendente] sem a janela de 14 dias
  ORDER BY p.created_at;
END;
$function$;


-- -----------------------------------------------------------------------------
-- DESFAZER B (rodar como um bloco). Os responsáveis já atribuídos ficam: são
-- dados de atendimento reais; desfazer não os apaga.
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.parceiros_pendentes()
--  RETURNS TABLE(id uuid, nome text, documento text, telefone text, email text, cidade text, estado text, convidado_por text, criado_em timestamp with time zone, tem_login boolean, status text)
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   PERFORM public.require_permission('parceiros.read');
--   RETURN QUERY
--   SELECT p.id,
--          coalesce(nullif(btrim(p.marca_nome),''), c.nome),
--          p.marca_documento, p.marca_telefone, p.marca_email,
--          p.marca_cidade, p.marca_estado,
--          coalesce(nullif(btrim(padrinho.marca_nome),''), pc.nome, 'cadastro direto'),
--          p.created_at,
--          p.usuario_id IS NOT NULL,
--          p.status
--   FROM public.parceiros p
--   LEFT JOIN public.clientes c ON c.id = p.cliente_id
--   LEFT JOIN public.parceiros padrinho ON padrinho.id = p.indicado_por
--   LEFT JOIN public.clientes pc ON pc.id = padrinho.cliente_id
--   WHERE p.status = 'pendente'
--      OR (p.status = 'ativo' AND p.responsavel_id IS NULL AND p.created_at > now() - interval '14 days')
--   ORDER BY p.created_at;
-- END;
-- $function$;
--
-- DROP FUNCTION IF EXISTS public.parceiros_atribuir_atendente_padrao(uuid[]);
-- DROP TRIGGER IF EXISTS ab_parceiro_atendente_padrao ON public.parceiros;
-- DROP FUNCTION IF EXISTS public.tg_parceiro_atendente_padrao();
-- ALTER TABLE public.parceiro_programa DROP COLUMN atendente_padrao_id;
--
-- Testes manuais sugeridos (B):
--   1) Com atendente_padrao_id NULO, ativar parceiro: responsavel_id continua NULO.
--   2) Definir um usuário ativo e ativar outro parceiro: recebe o padrão.
--   3) Parceiro com responsável já definido: não é trocado.
--   4) SELECT * FROM parceiros_pendentes(): os cadastros de 23/10 e 03/11 voltam à fila.
