-- Matriz centralizada de permissões no banco para espelhar o frontend.
CREATE OR REPLACE VIEW public.role_permission_matrix AS
SELECT role::public.app_role, permission
FROM (VALUES
  ('admin', 'clientes.read'),
  ('admin', 'orcamentos.create'),
  ('admin', 'financeiro.read'),
  ('admin', 'custos.read'),
  ('admin', 'kanban.move'),
  ('admin', 'arquivos.approve'),
  ('admin', 'estoque.cost.read'),
  ('admin', 'instalacao.update'),
  ('gestor', 'clientes.read'),
  ('gestor', 'orcamentos.create'),
  ('gestor', 'financeiro.read'),
  ('gestor', 'custos.read'),
  ('gestor', 'kanban.move'),
  ('gestor', 'arquivos.approve'),
  ('gestor', 'estoque.cost.read'),
  ('gestor', 'instalacao.update'),
  ('financeiro', 'clientes.read'),
  ('financeiro', 'orcamentos.create'),
  ('financeiro', 'financeiro.read'),
  ('financeiro', 'custos.read'),
  ('financeiro', 'estoque.cost.read'),
  ('vendedor', 'clientes.read'),
  ('vendedor', 'orcamentos.create'),
  ('designer', 'clientes.read'),
  ('designer', 'kanban.move'),
  ('designer', 'arquivos.approve'),
  ('operador', 'clientes.read'),
  ('operador', 'kanban.move'),
  ('estoque', 'clientes.read'),
  ('estoque', 'estoque.cost.read'),
  ('instalador', 'clientes.read'),
  ('instalador', 'instalacao.update')
) AS matrix(role, permission);

GRANT SELECT ON public.role_permission_matrix TO authenticated;
GRANT SELECT ON public.role_permission_matrix TO service_role;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_matrix rpm ON rpm.role = ur.role
    WHERE ur.user_id = _user_id
      AND rpm.permission = _permission
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_permission(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_matrix rpm ON rpm.role = ur.role
    WHERE ur.user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_see_financials(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_permission(_user_id, 'financeiro.read')
$$;

-- Remover políticas amplas de dados sensíveis baseadas apenas em public.is_staff(auth.uid()).
DROP POLICY IF EXISTS "clientes staff read" ON public.clientes;
DROP POLICY IF EXISTS "clientes staff write" ON public.clientes;
DROP POLICY IF EXISTS "clientes staff update" ON public.clientes;
DROP POLICY IF EXISTS "contatos staff all" ON public.cliente_contatos;
DROP POLICY IF EXISTS "orc staff read" ON public.orcamentos;
DROP POLICY IF EXISTS "orc staff insert" ON public.orcamentos;
DROP POLICY IF EXISTS "orc staff update" ON public.orcamentos;
DROP POLICY IF EXISTS "orc_itens staff all" ON public.orcamento_itens;
DROP POLICY IF EXISTS "os staff read" ON public.ordens_servico;
DROP POLICY IF EXISTS "os staff insert" ON public.ordens_servico;
DROP POLICY IF EXISTS "os staff update" ON public.ordens_servico;
DROP POLICY IF EXISTS "itens_os staff all" ON public.itens_os;
DROP POLICY IF EXISTS "tarefas staff all" ON public.tarefas;
DROP POLICY IF EXISTS "coment staff all" ON public.comentarios_tarefa;
DROP POLICY IF EXISTS "arquivos staff all" ON public.arquivos;
DROP POLICY IF EXISTS "aprov staff read" ON public.aprovacoes;
DROP POLICY IF EXISTS "aprov staff insert" ON public.aprovacoes;
DROP POLICY IF EXISTS "pag financeiro all" ON public.pagamentos;
DROP POLICY IF EXISTS "custos financeiro all" ON public.custos_os;
DROP POLICY IF EXISTS "logs staff insert" ON public.logs_auditoria;
DROP POLICY IF EXISTS "maq staff read" ON public.maquinas;
DROP POLICY IF EXISTS "prod staff read" ON public.produtos;
DROP POLICY IF EXISTS "mat staff read" ON public.materiais;
DROP POLICY IF EXISTS "mov estoque read" ON public.movimentacoes_estoque;
DROP POLICY IF EXISTS "ent staff read" ON public.entregas_instalacoes;
DROP POLICY IF EXISTS "ent staff write" ON public.entregas_instalacoes;
DROP POLICY IF EXISTS "oco staff all" ON public.ocorrencias;
DROP POLICY IF EXISTS "arquivos staff read" ON storage.objects;
DROP POLICY IF EXISTS "arquivos staff write" ON storage.objects;
DROP POLICY IF EXISTS "arquivos staff update" ON storage.objects;
DROP POLICY IF EXISTS "pdf staff read" ON storage.objects;
DROP POLICY IF EXISTS "pdf staff insert" ON storage.objects;
DROP POLICY IF EXISTS "docs staff read" ON public.documentos_gerados;
DROP POLICY IF EXISTS "docs staff insert" ON public.documentos_gerados;

-- Clientes: leitura por permissão explícita; escrita comercial/admin sem is_staff amplo.
CREATE POLICY "clientes permission read" ON public.clientes FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'clientes.read'));
CREATE POLICY "clientes commercial insert" ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "clientes commercial update" ON public.clientes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'vendedor'));

CREATE POLICY "contatos permission read" ON public.cliente_contatos FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'clientes.read'));
CREATE POLICY "contatos commercial write" ON public.cliente_contatos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'vendedor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'vendedor'));

-- Orçamentos e documentos comerciais.
CREATE POLICY "orc permission read" ON public.orcamentos FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'orcamentos.create'));
CREATE POLICY "orc permission insert" ON public.orcamentos FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'orcamentos.create'));
CREATE POLICY "orc permission update" ON public.orcamentos FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'orcamentos.create'));

CREATE POLICY "orc_itens permission all" ON public.orcamento_itens FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'orcamentos.create'))
  WITH CHECK (public.has_permission(auth.uid(), 'orcamentos.create'));

CREATE POLICY "docs permission read" ON public.documentos_gerados FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'orcamentos.create'));
CREATE POLICY "docs permission insert" ON public.documentos_gerados FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'orcamentos.create'));

-- OS/Kanban/instalações: leitura e movimentação por permissões específicas.
CREATE POLICY "os permission read" ON public.ordens_servico FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'kanban.move')
    OR public.has_permission(auth.uid(), 'instalacao.update')
    OR public.has_permission(auth.uid(), 'orcamentos.create')
  );
CREATE POLICY "os permission insert" ON public.ordens_servico FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'orcamentos.create'));
CREATE POLICY "os permission update" ON public.ordens_servico FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'kanban.move') OR public.has_permission(auth.uid(), 'instalacao.update'));

CREATE POLICY "itens_os permission all" ON public.itens_os FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'kanban.move') OR public.has_permission(auth.uid(), 'orcamentos.create'))
  WITH CHECK (public.has_permission(auth.uid(), 'kanban.move') OR public.has_permission(auth.uid(), 'orcamentos.create'));
CREATE POLICY "tarefas permission all" ON public.tarefas FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'kanban.move'))
  WITH CHECK (public.has_permission(auth.uid(), 'kanban.move'));
CREATE POLICY "coment permission all" ON public.comentarios_tarefa FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'kanban.move'))
  WITH CHECK (public.has_permission(auth.uid(), 'kanban.move'));

-- Arquivos e aprovações.
CREATE POLICY "arquivos permission all" ON public.arquivos FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'arquivos.approve'))
  WITH CHECK (public.has_permission(auth.uid(), 'arquivos.approve'));
CREATE POLICY "aprov permission read" ON public.aprovacoes FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'arquivos.approve') OR public.has_permission(auth.uid(), 'orcamentos.create'));
CREATE POLICY "aprov permission insert" ON public.aprovacoes FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'arquivos.approve') OR public.has_permission(auth.uid(), 'orcamentos.create'));

-- Financeiro, custos e estoque.
CREATE POLICY "pag financeiro permission all" ON public.pagamentos FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'financeiro.read'))
  WITH CHECK (public.has_permission(auth.uid(), 'financeiro.read'));
CREATE POLICY "custos permission all" ON public.custos_os FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'custos.read'))
  WITH CHECK (public.has_permission(auth.uid(), 'custos.read'));
CREATE POLICY "mat estoque permission read" ON public.materiais FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'estoque.cost.read'));
CREATE POLICY "mov estoque permission read" ON public.movimentacoes_estoque FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'estoque.cost.read'));

-- Instalações.
CREATE POLICY "ent instalacao permission read" ON public.entregas_instalacoes FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'instalacao.update'));
CREATE POLICY "ent instalacao permission write" ON public.entregas_instalacoes FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'instalacao.update'))
  WITH CHECK (public.has_permission(auth.uid(), 'instalacao.update'));

-- Demais módulos operacionais sem is_staff amplo.
CREATE POLICY "logs permission insert" ON public.logs_auditoria FOR INSERT TO authenticated
  WITH CHECK (public.has_any_permission(auth.uid()));
CREATE POLICY "maq permission read" ON public.maquinas FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'kanban.move'));
CREATE POLICY "prod permission read" ON public.produtos FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'orcamentos.create') OR public.has_permission(auth.uid(), 'estoque.cost.read'));
CREATE POLICY "oco permission all" ON public.ocorrencias FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'kanban.move') OR public.has_permission(auth.uid(), 'instalacao.update'))
  WITH CHECK (public.has_permission(auth.uid(), 'kanban.move') OR public.has_permission(auth.uid(), 'instalacao.update'));

-- Storage privado por permissão de negócio, não por is_staff genérico.
CREATE POLICY "arquivos permission read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='arquivos-clientes' AND public.has_permission(auth.uid(), 'arquivos.approve'));
CREATE POLICY "arquivos permission write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='arquivos-clientes' AND public.has_permission(auth.uid(), 'arquivos.approve'));
CREATE POLICY "arquivos permission update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='arquivos-clientes' AND public.has_permission(auth.uid(), 'arquivos.approve'));

CREATE POLICY "pdf permission read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documentos-pdf' AND public.has_permission(auth.uid(), 'orcamentos.create'));
CREATE POLICY "pdf permission insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documentos-pdf' AND public.has_permission(auth.uid(), 'orcamentos.create'));
