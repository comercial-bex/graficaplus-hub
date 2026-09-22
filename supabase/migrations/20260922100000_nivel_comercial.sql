-- Nível "comercial": ver preço de venda sem ver custo e margem.
--
-- O papel `vendedor` criava e enviava orçamento sem enxergar valor nenhum:
-- `can_see_financials` = `financeiro.read`, e as views `_operacional` tiram
-- TODAS as colunas de dinheiro. Todo orçamento de vendedor saía R$ 0,00.
--
-- Dar `financeiro.read` ao vendedor abriria custo, margem e o módulo
-- Financeiro inteiro. A correção certa é um terceiro nível entre os dois:
--
--   operacional  sem dinheiro               (operador, designer, instalador…)
--   comercial    preço de venda, sem custo  (vendedor)          ← novo
--   financeiro   tudo                       (financeiro, gestor, admin)
--
-- Como o dinheiro vive em tabelas-espelho com RLS `can_see_financials`
-- (produto_precos, orcamento_custos, orcamento_item_custos,
-- os_resultados_financeiros, item_os_custos), uma view `security_invoker`
-- devolveria NULL ao vendedor. Por isso as views `_comercial` são DEFINER
-- (dona postgres, que passa pela RLS do espelho) e fazem o próprio guarda:
-- `is_staff` E `can_see_prices`. Elas listam explicitamente as colunas de
-- preço e nunca as de custo — é a lista que protege, não a RLS.
--
-- `preco_minimo` fica de fora de propósito: é custo ÷ (1 − margem), ou seja,
-- revela o custo por trás. O piso de desconto é regra do servidor, não
-- informação do vendedor.
--
-- COMO DESFAZER:
--   drop view produtos_comercial, orcamentos_comercial, orcamento_itens_comercial,
--             ordens_servico_comercial, itens_os_comercial;
--   drop function public.can_see_prices(uuid);
--   delete from public.role_permission_matrix where permission = 'precos.read';

-- ----------------------------------------------------------- 1. a permissão
-- `role_permission_matrix` é uma VIEW sobre `perfil_permissoes` (perfil,
-- permissao); o catálogo é `permissoes` (chave, dominio, descricao).
INSERT INTO public.permissoes (chave, dominio, descricao)
SELECT 'precos.read', 'precos', 'Ver preço de venda (sem custo nem margem)'
WHERE NOT EXISTS (SELECT 1 FROM public.permissoes WHERE chave = 'precos.read');

INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT r, 'precos.read' FROM unnest(ARRAY['admin','gestor','financeiro','vendedor']) AS r
WHERE NOT EXISTS (
  SELECT 1 FROM public.perfil_permissoes p WHERE p.perfil = r AND p.permissao = 'precos.read'
);

CREATE OR REPLACE FUNCTION public.can_see_prices(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.has_permission(_user_id, 'precos.read') OR public.can_see_financials(_user_id)
$function$;

-- --------------------------------------------------------------- 2. as views
CREATE OR REPLACE VIEW public.produtos_comercial
WITH (security_invoker = false, security_barrier = true) AS
  SELECT p.id, p.nome, p.descricao, p.ativo, p.created_at, p.sku, p.categoria, p.tipo,
         p.unidade, p.tempo_producao_min, p.imagem_url, p.observacoes_internas, p.updated_at,
         p.maquina_padrao_id, p.material_principal_id, p.exigencias, p.sugestoes_operacionais,
         p.area_minima_cobrada, p.espacamento_pecas_m,
         pp.preco_base, pp.preco_publico, pp.preco_sugerido
  FROM public.produtos p
  LEFT JOIN public.produto_precos pp ON pp.produto_id = p.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.orcamentos_comercial
WITH (security_invoker = false, security_barrier = true) AS
  SELECT o.id, o.numero, o.cliente_id, c.nome AS cliente_nome,
         o.contato_nome, o.contato_telefone, o.contato_email, o.vendedor_id,
         o.status, o.titulo, o.descricao, o.validade_dias,
         oc.desconto_percentual, oc.valor_subtotal, oc.valor_total,
         o.observacoes, o.enviado_em, o.aprovado_em, o.os_id,
         o.created_by, o.created_at, o.updated_at
  FROM public.orcamentos o
  LEFT JOIN public.clientes c ON c.id = o.cliente_id
  LEFT JOIN public.orcamento_custos oc ON oc.orcamento_id = o.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.orcamento_itens_comercial
WITH (security_invoker = false, security_barrier = true) AS
  SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade,
         oic.valor_unitario, oic.valor_total,
         oi.ordem, oi.created_at, oi.largura, oi.altura, oi.area_unitaria, oi.area_total,
         oi.acabamento, oi.arquivo_id, oi.produto_id, oi.area_minima, oi.area_cobrada
  FROM public.orcamento_itens oi
  LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.ordens_servico_comercial
WITH (security_invoker = false, security_barrier = true) AS
  SELECT os.id, os.numero, os.cliente_id, c.nome AS cliente_nome, c.logo_url AS cliente_logo_url,
         os.orcamento_id, os.vendedor_id, os.responsavel_id, os.designer_id, os.operador_id,
         os.status, os.titulo, os.briefing, os.observacoes, os.prioridade,
         os.prazo_entrega, os.data_entrega_real,
         osf.valor_total,
         os.ordem_kanban, os.created_by, os.created_at, os.updated_at,
         os.estoque_baixado, os.maquina_id, os.produto_id, os.setor_atual,
         os.precisa_entrega, os.precisa_instalacao
  FROM public.ordens_servico os
  JOIN public.clientes c ON c.id = os.cliente_id
  LEFT JOIN public.os_resultados_financeiros osf ON osf.os_id = os.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.itens_os_comercial
WITH (security_invoker = false, security_barrier = true) AS
  SELECT io.id, io.os_id, io.descricao, io.quantidade, io.unidade,
         ioc.valor_unitario, ioc.valor_total,
         io.ordem, io.created_at, io.largura, io.altura, io.area_unitaria, io.area_total,
         io.acabamento, io.arquivo_id, io.produto_id, io.area_minima, io.area_cobrada
  FROM public.itens_os io
  LEFT JOIN public.item_os_custos ioc ON ioc.item_os_id = io.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

REVOKE ALL ON public.produtos_comercial, public.orcamentos_comercial, public.orcamento_itens_comercial,
              public.ordens_servico_comercial, public.itens_os_comercial FROM PUBLIC, anon;
GRANT SELECT ON public.produtos_comercial, public.orcamentos_comercial, public.orcamento_itens_comercial,
                public.ordens_servico_comercial, public.itens_os_comercial TO authenticated;
