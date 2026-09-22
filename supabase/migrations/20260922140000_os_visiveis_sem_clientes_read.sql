-- O impressor (operador) via ZERO ordens de serviço: painel, Kanban, lista.
--
-- ordens_servico_operacional e ordens_servico_financeiro faziam
-- `JOIN clientes`. A RLS de `clientes` só deixa ler quem tem `clientes.read`
-- (ou acesso do portal) — operador, designer, instalador e estoque não têm.
-- Numa view security_invoker a RLS do join vale para o leitor: sem linha em
-- clientes, o JOIN interno descarta a OS inteira. Testado com SET LOCAL ROLE
-- authenticated + claims do operador: ordens_servico 2 linhas, clientes 0,
-- ordens_servico_operacional 0.
--
-- O nome do cliente está impresso na OS física — todo staff pode saber para
-- quem é o serviço. O que fica protegido é a FICHA (telefone, documento,
-- endereço), que continua atrás de `clientes.read`. Então:
--   * LEFT JOIN em vez de JOIN: a OS aparece mesmo sem ler clientes;
--   * nome e logo vêm de funções SECURITY DEFINER que só devolvem para staff,
--     usadas como fallback quando o join não trouxe a linha.
--
-- COMO DESFAZER: reaplicar 20260909230000_view_os_com_maquina.sql e
-- DROP FUNCTION public.nome_do_cliente(uuid), public.logo_do_cliente(uuid).

CREATE OR REPLACE FUNCTION public.nome_do_cliente(_cliente_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT c.nome::text FROM public.clientes c
  WHERE c.id = _cliente_id AND public.is_staff(auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.logo_do_cliente(_cliente_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT c.logo_url::text FROM public.clientes c
  WHERE c.id = _cliente_id AND public.is_staff(auth.uid())
$function$;

REVOKE ALL ON FUNCTION public.nome_do_cliente(uuid), public.logo_do_cliente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nome_do_cliente(uuid), public.logo_do_cliente(uuid) TO authenticated;

-- Mesmas colunas, mesma ordem, mesmos tipos (CREATE OR REPLACE exige).
CREATE OR REPLACE VIEW public.ordens_servico_operacional
WITH (security_invoker = true) AS
  SELECT os.id, os.numero, os.cliente_id,
         COALESCE(c.nome, public.nome_do_cliente(os.cliente_id)::character varying) AS cliente_nome,
         COALESCE(c.logo_url, public.logo_do_cliente(os.cliente_id)::character varying) AS cliente_logo_url,
         os.orcamento_id, os.vendedor_id, os.responsavel_id, os.designer_id, os.operador_id,
         os.status, os.titulo, os.briefing, os.observacoes, os.prioridade,
         os.prazo_entrega, os.data_entrega_real,
         os.ordem_kanban, os.created_by, os.created_at, os.updated_at, os.estoque_baixado,
         os.maquina_id, os.produto_id, os.setor_atual, os.precisa_entrega, os.precisa_instalacao
  FROM public.ordens_servico os
  LEFT JOIN public.clientes c ON c.id = os.cliente_id;

CREATE OR REPLACE VIEW public.ordens_servico_financeiro
WITH (security_invoker = true) AS
  SELECT os.id, os.numero, os.cliente_id,
         COALESCE(c.nome, public.nome_do_cliente(os.cliente_id)::character varying) AS cliente_nome,
         COALESCE(c.logo_url, public.logo_do_cliente(os.cliente_id)::character varying) AS cliente_logo_url,
         os.orcamento_id, os.vendedor_id, os.responsavel_id, os.designer_id, os.operador_id,
         os.status, os.titulo, os.briefing, os.observacoes, os.prioridade,
         os.prazo_entrega, os.data_entrega_real,
         osf.valor_total, osf.custo_previsto, osf.custo_real, osf.margem_real,
         os.ordem_kanban, os.created_by, os.created_at, os.updated_at,
         os.maquina_id, os.produto_id, os.setor_atual, os.precisa_entrega, os.precisa_instalacao
  FROM public.ordens_servico os
  LEFT JOIN public.clientes c ON c.id = os.cliente_id
  LEFT JOIN public.os_resultados_financeiros osf ON osf.os_id = os.id
  WHERE public.can_see_financials(auth.uid());
