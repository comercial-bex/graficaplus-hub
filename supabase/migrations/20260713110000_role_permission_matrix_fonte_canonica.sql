-- Achado de homologação: role_permission_matrix era uma VIEW hardcoded com só
-- ~8 permissões por papel — admin não tinha nenhuma impressao3d.*, tarefas.*,
-- orcamentos.convert etc. Como has_permission() (base de quase toda a RLS) lê
-- essa view, o banco negava módulos inteiros para todos os usuários, mesmo com
-- a fonte canônica perfil_permissoes populada (361 linhas, 104 permissões).
--
-- Correção de raiz: a view passa a ler a fonte canônica. Perfis fora do enum
-- app_role (ex.: 'administrador', 'gerente' legados) são filtrados para o cast
-- não falhar.

CREATE OR REPLACE VIEW public.role_permission_matrix AS
SELECT pp.perfil::app_role AS role, pp.permissao AS permission
FROM public.perfil_permissoes pp
WHERE pp.perfil IN (
  SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'app_role'
);

-- Backfill: pares que a view hardcoded concedia e a fonte canônica não tinha
-- (senão a troca acima removeria permissões em uso — ex.: upload no bucket
-- arquivos-clientes exigia arquivos.approve, que admin não tinha na fonte).
INSERT INTO public.permissoes (chave, dominio, descricao)
SELECT x.chave, x.dominio, x.descricao FROM (VALUES
  ('arquivos.approve','arquivos','Aprovar arquivos (acesso ao bucket)'),
  ('instalacao.update','entregas','Atualizar instalação'),
  ('estoque.cost.read','estoque','Ler custos de estoque'),
  ('custos.read','financeiro','Ler custos'),
  ('kanban.move','os','Mover cards no kanban')
) AS x(chave, dominio, descricao)
WHERE NOT EXISTS (SELECT 1 FROM public.permissoes p WHERE p.chave = x.chave);

INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT x.perfil, x.permissao FROM (VALUES
  ('admin','arquivos.approve'),('admin','instalacao.update'),
  ('gestor','estoque.cost.read'),('gestor','instalacao.update'),('gestor','arquivos.approve'),
  ('gestor','custos.read'),('gestor','kanban.move')
) AS x(perfil, permissao)
WHERE NOT EXISTS (SELECT 1 FROM public.perfil_permissoes pp WHERE pp.perfil=x.perfil AND pp.permissao=x.permissao);

-- Storage arquivos-clientes: upload deve aceitar a permissão canônica de upload
-- (arquivos.upload), mantendo arquivos.approve como alternativa; leitura idem
-- com arquivos.read. Antes, só quem "aprovava" conseguia subir/baixar arquivo.
DROP POLICY IF EXISTS "arquivos permission write" ON storage.objects;
CREATE POLICY "arquivos permission write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'arquivos-clientes' AND (has_permission(auth.uid(),'arquivos.upload') OR has_permission(auth.uid(),'arquivos.approve')));
DROP POLICY IF EXISTS "arquivos permission read" ON storage.objects;
CREATE POLICY "arquivos permission read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'arquivos-clientes' AND (has_permission(auth.uid(),'arquivos.read') OR has_permission(auth.uid(),'arquivos.approve')));
