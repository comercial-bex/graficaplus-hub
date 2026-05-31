-- =========================================================================
-- PRD Kanban: status padronizados, dados de card e ordenação por coluna
-- =========================================================================

ALTER TYPE public.status_os RENAME VALUE 'novo' TO 'entrada';
ALTER TYPE public.status_os RENAME VALUE 'em_design' TO 'design';
ALTER TYPE public.status_os RENAME VALUE 'em_producao' TO 'producao';

ALTER TABLE public.ordens_servico
  ALTER COLUMN status SET DEFAULT 'entrada';

ALTER TABLE public.ordens_servico
  ADD COLUMN produto_id UUID REFERENCES public.produtos(id) ON DELETE SET NULL,
  ADD COLUMN maquina_id UUID REFERENCES public.maquinas(id) ON DELETE SET NULL,
  ADD COLUMN setor_atual TEXT;

CREATE INDEX IF NOT EXISTS idx_ordens_servico_status_ordem_kanban
  ON public.ordens_servico (status, ordem_kanban, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ordens_servico_produto_id
  ON public.ordens_servico (produto_id);

CREATE INDEX IF NOT EXISTS idx_ordens_servico_maquina_id
  ON public.ordens_servico (maquina_id);
