-- A fila de "pendentes" ficou muda: desde 23/10 o cadastro nasce `ativo`, então
-- `parceiros_pendentes()` devolve sempre vazio e a gráfica não fica sabendo que
-- alguém novo entrou (a Aline ficou com responsavel_id nulo, sem ninguém para
-- atendê-la). Agora a fila mostra quem está pendente OU entrou nos últimos 14
-- dias e ainda não tem atendente. Quem assume sai da fila.
-- Desfazer: recriar a versão de 20260920160000_convite_de_parceiro.sql.
DROP FUNCTION IF EXISTS public.parceiros_pendentes();
CREATE FUNCTION public.parceiros_pendentes()
RETURNS TABLE(id uuid, nome text, documento text, telefone text, email text,
              cidade text, estado text, convidado_por text, criado_em timestamptz,
              tem_login boolean, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
     OR (p.status = 'ativo' AND p.responsavel_id IS NULL AND p.created_at > now() - interval '14 days')
  ORDER BY p.created_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.parceiros_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiros_pendentes() TO authenticated;
