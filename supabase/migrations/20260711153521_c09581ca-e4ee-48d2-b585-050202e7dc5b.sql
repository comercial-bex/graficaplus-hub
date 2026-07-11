-- Parte 2 operação completa (retry)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.permissoes (chave, dominio, descricao) VALUES
('tarefas.read','operacao','Ler tarefas'),('tarefas.create','operacao','Criar tarefas'),('tarefas.update','operacao','Atualizar tarefas'),('tarefas.assign','operacao','Atribuir tarefas'),('tarefas.complete','operacao','Concluir tarefas'),('tarefas.reopen','operacao','Reabrir tarefas'),('kanban.read','operacao','Ler kanban'),('kanban.move','operacao','Mover kanban'),('producao.read','operacao','Ler produção'),('producao.start','operacao','Iniciar produção'),('producao.pause','operacao','Pausar produção'),('producao.finish','operacao','Finalizar produção'),('qualidade.read','operacao','Ler qualidade'),('qualidade.manage','operacao','Gerenciar qualidade'),('retrabalho.read','operacao','Ler retrabalho'),('retrabalho.manage','operacao','Gerenciar retrabalho'),
('arquivos.read','arquivos','Ler arquivos'),('arquivos.upload','arquivos','Enviar arquivos'),('arquivos.version','arquivos','Versionar arquivos'),('arquivos.finalize','arquivos','Finalizar arquivos'),('arquivos.request_approval','arquivos','Solicitar aprovação de arquivo'),('arquivos.register_approval','arquivos','Registrar aprovação de arquivo'),('arquivos.delete','arquivos','Excluir arquivos'),
('estoque.read','estoque','Ler estoque'),('estoque.cost.read','estoque','Ler custo de estoque'),('estoque.entry','estoque','Entrada de estoque'),('estoque.reserve','estoque','Reservar estoque'),('estoque.exit','estoque','Baixar estoque'),('estoque.adjust','estoque','Ajustar estoque'),('estoque.reverse','estoque','Estornar estoque'),('estoque.inventory','estoque','Inventário'),
('maquinas.read','maquinas','Ler máquinas'),('maquinas.manage','maquinas','Gerenciar máquinas'),('agenda.read','maquinas','Ler agenda'),('agenda.schedule','maquinas','Agendar máquina'),('agenda.reschedule','maquinas','Reagendar máquina'),('agenda.operate','maquinas','Operar agenda'),('manutencao.read','maquinas','Ler manutenção'),('manutencao.manage','maquinas','Gerenciar manutenção'),
('entregas.read','logistica','Ler entregas'),('entregas.manage','logistica','Gerenciar entregas'),('instalacoes.read','logistica','Ler instalações'),('instalacoes.manage','logistica','Gerenciar instalações'),
('custos.create','resultado','Criar custos'),('custos.update','resultado','Atualizar custos')
ON CONFLICT (chave) DO UPDATE SET dominio=EXCLUDED.dominio, descricao=EXCLUDED.descricao;

INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT p.perfil, pe.chave FROM (VALUES ('administrador'),('admin')) p(perfil) CROSS JOIN public.permissoes pe ON CONFLICT DO NOTHING;
INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT perfil, permissao FROM (VALUES
('gerente','tarefas.read'),('gerente','tarefas.create'),('gerente','tarefas.update'),('gerente','tarefas.assign'),('gerente','tarefas.complete'),('gerente','tarefas.reopen'),('gerente','kanban.read'),('gerente','kanban.move'),('gerente','producao.read'),('gerente','qualidade.read'),('gerente','retrabalho.read'),('gerente','arquivos.read'),('gerente','arquivos.upload'),('gerente','arquivos.version'),('gerente','arquivos.finalize'),('gerente','arquivos.request_approval'),('gerente','arquivos.register_approval'),('gerente','estoque.read'),('gerente','estoque.cost.read'),('gerente','maquinas.read'),('gerente','agenda.read'),('gerente','entregas.read'),('gerente','instalacoes.read'),('gerente','resultado.read'),('gerente','custos.read'),
('designer','tarefas.read'),('designer','tarefas.update'),('designer','tarefas.complete'),('designer','arquivos.read'),('designer','arquivos.upload'),('designer','arquivos.version'),('designer','arquivos.finalize'),('designer','arquivos.request_approval'),
('operador','tarefas.read'),('operador','tarefas.update'),('operador','tarefas.complete'),('operador','producao.read'),('operador','producao.start'),('operador','producao.pause'),('operador','producao.finish'),('operador','qualidade.read'),('operador','agenda.read'),('operador','agenda.operate'),
('estoque','estoque.read'),('estoque','estoque.cost.read'),('estoque','estoque.entry'),('estoque','estoque.reserve'),('estoque','estoque.exit'),('estoque','estoque.adjust'),('estoque','estoque.reverse'),('estoque','estoque.inventory'),
('instalador','entregas.read'),('instalador','entregas.manage'),('instalador','instalacoes.read'),('instalador','instalacoes.manage')
) v(perfil, permissao) ON CONFLICT DO NOTHING;

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS sugestoes_operacionais JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS arquivo_id UUID;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS especificacoes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS custos_previstos JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS preco_snapshot NUMERIC(12,2);
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS margem_prevista NUMERIC(8,4);
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS planejamento JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS requer_qualidade BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS precisa_entrega BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS precisa_instalacao BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.os_tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  os_item_id UUID REFERENCES public.itens_os(id) ON DELETE CASCADE, titulo TEXT NOT NULL, descricao TEXT, setor TEXT,
  responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL, prioridade TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'pendente',
  prazo TIMESTAMPTZ, inicio_previsto TIMESTAMPTZ, fim_previsto TIMESTAMPTZ, inicio_real TIMESTAMPTZ, fim_real TIMESTAMPTZ,
  minutos_previstos INT NOT NULL DEFAULT 0, minutos_realizados INT NOT NULL DEFAULT 0, dependencias JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb, anexos JSONB NOT NULL DEFAULT '[]'::jsonb, comentarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  bloqueia_dependentes BOOLEAN NOT NULL DEFAULT true, obrigatoria BOOLEAN NOT NULL DEFAULT true, created_by UUID REFERENCES public.usuarios(id), completed_by UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_tarefas TO authenticated;
GRANT ALL ON public.os_tarefas TO service_role;
ALTER TABLE public.os_tarefas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "os_tarefas read" ON public.os_tarefas;
CREATE POLICY "os_tarefas read" ON public.os_tarefas FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'tarefas.read'));
DROP POLICY IF EXISTS "os_tarefas write" ON public.os_tarefas;
CREATE POLICY "os_tarefas write" ON public.os_tarefas FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'tarefas.update') OR public.has_permission(auth.uid(),'tarefas.create')) WITH CHECK (public.has_permission(auth.uid(),'tarefas.update') OR public.has_permission(auth.uid(),'tarefas.create'));

CREATE TABLE IF NOT EXISTS public.os_tarefa_comentarios (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tarefa_id UUID NOT NULL REFERENCES public.os_tarefas(id) ON DELETE CASCADE, autor_id UUID REFERENCES public.usuarios(id), comentario TEXT NOT NULL, anexos JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_tarefa_comentarios TO authenticated;
GRANT ALL ON public.os_tarefa_comentarios TO service_role;
ALTER TABLE public.os_tarefa_comentarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coments staff" ON public.os_tarefa_comentarios;
CREATE POLICY "coments staff" ON public.os_tarefa_comentarios FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS os_item_id UUID REFERENCES public.itens_os(id) ON DELETE SET NULL;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS tarefa_id UUID REFERENCES public.os_tarefas(id) ON DELETE SET NULL;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS conversa_id UUID;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS versao INT NOT NULL DEFAULT 1;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS arquivo_substituido_id UUID REFERENCES public.arquivos(id) ON DELETE SET NULL;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS hash TEXT;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS tamanho BIGINT;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS mime TEXT;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS bucket TEXT;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS caminho TEXT;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS observacao TEXT;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.arquivos ADD COLUMN IF NOT EXISTS final BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.arquivo_aprovacoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), arquivo_id UUID NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE, decisao TEXT NOT NULL CHECK (decisao IN ('solicitada','aprovado','reprovado','ajuste')), usuario_id UUID REFERENCES public.usuarios(id), cliente_id UUID REFERENCES public.clientes(id), comentario TEXT, referencias JSONB NOT NULL DEFAULT '[]'::jsonb, canal TEXT NOT NULL DEFAULT 'interno', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.arquivo_aprovacoes TO authenticated;
GRANT ALL ON public.arquivo_aprovacoes TO service_role;
ALTER TABLE public.arquivo_aprovacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "arquivos approvals read" ON public.arquivo_aprovacoes;
CREATE POLICY "arquivos approvals read" ON public.arquivo_aprovacoes FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'arquivos.read'));
DROP POLICY IF EXISTS "arquivos approvals write" ON public.arquivo_aprovacoes;
CREATE POLICY "arquivos approvals write" ON public.arquivo_aprovacoes FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'arquivos.register_approval')) WITH CHECK (public.has_permission(auth.uid(),'arquivos.register_approval'));

CREATE TABLE IF NOT EXISTS public.arquivo_tokens_externos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token_hash TEXT NOT NULL UNIQUE, os_id UUID REFERENCES public.ordens_servico(id) ON DELETE CASCADE, arquivo_id UUID REFERENCES public.arquivos(id) ON DELETE CASCADE, escopo JSONB NOT NULL DEFAULT '{}'::jsonb, expira_em TIMESTAMPTZ NOT NULL, revogado_em TIMESTAMPTZ, usado_em TIMESTAMPTZ, created_by UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.arquivo_tokens_externos TO authenticated;
GRANT ALL ON public.arquivo_tokens_externos TO service_role;
ALTER TABLE public.arquivo_tokens_externos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "arqtoken staff" ON public.arquivo_tokens_externos;
CREATE POLICY "arqtoken staff" ON public.arquivo_tokens_externos FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.material_lotes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), material_id UUID NOT NULL REFERENCES public.materiais(id) ON DELETE CASCADE, codigo TEXT, quantidade NUMERIC(14,4) NOT NULL DEFAULT 0, quantidade_reservada NUMERIC(14,4) NOT NULL DEFAULT 0, unidade TEXT NOT NULL DEFAULT 'un', custo_unitario_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0, fornecedor TEXT, validade DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (quantidade >= 0), CHECK (quantidade_reservada >= 0));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_lotes TO authenticated;
GRANT ALL ON public.material_lotes TO service_role;
ALTER TABLE public.material_lotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estoque canon read" ON public.material_lotes;
CREATE POLICY "estoque canon read" ON public.material_lotes FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'estoque.read'));
DROP POLICY IF EXISTS "estoque canon write" ON public.material_lotes;
CREATE POLICY "estoque canon write" ON public.material_lotes FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.os_materiais_previstos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, os_item_id UUID REFERENCES public.itens_os(id) ON DELETE CASCADE, tarefa_id UUID REFERENCES public.os_tarefas(id) ON DELETE SET NULL, material_id UUID NOT NULL REFERENCES public.materiais(id), quantidade NUMERIC(14,4) NOT NULL, unidade TEXT NOT NULL DEFAULT 'un', custo_unitario_previsto NUMERIC(12,4) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_materiais_previstos TO authenticated;
GRANT ALL ON public.os_materiais_previstos TO service_role;
ALTER TABLE public.os_materiais_previstos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "os mat prev staff" ON public.os_materiais_previstos;
CREATE POLICY "os mat prev staff" ON public.os_materiais_previstos FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.estoque_reservas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, os_item_id UUID REFERENCES public.itens_os(id), tarefa_id UUID REFERENCES public.os_tarefas(id), material_id UUID NOT NULL REFERENCES public.materiais(id), lote_id UUID REFERENCES public.material_lotes(id), quantidade NUMERIC(14,4) NOT NULL, quantidade_baixada NUMERIC(14,4) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'reservada', created_by UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estoque_reservas TO authenticated;
GRANT ALL ON public.estoque_reservas TO service_role;
ALTER TABLE public.estoque_reservas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estoque reservas read" ON public.estoque_reservas;
CREATE POLICY "estoque reservas read" ON public.estoque_reservas FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'estoque.read'));
DROP POLICY IF EXISTS "estoque reservas write" ON public.estoque_reservas;
CREATE POLICY "estoque reservas write" ON public.estoque_reservas FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.estoque_inventarios (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), material_id UUID NOT NULL REFERENCES public.materiais(id), lote_id UUID REFERENCES public.material_lotes(id), quantidade_anterior NUMERIC(14,4) NOT NULL, quantidade_nova NUMERIC(14,4) NOT NULL, motivo TEXT NOT NULL, usuario_id UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estoque_inventarios TO authenticated;
GRANT ALL ON public.estoque_inventarios TO service_role;
ALTER TABLE public.estoque_inventarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv staff" ON public.estoque_inventarios;
CREATE POLICY "inv staff" ON public.estoque_inventarios FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS lote_id UUID REFERENCES public.material_lotes(id) ON DELETE SET NULL;
ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS unidade TEXT;
ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS custo_unitario_snapshot NUMERIC(12,4);
ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS os_item_id UUID REFERENCES public.itens_os(id) ON DELETE SET NULL;
ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS tarefa_id UUID REFERENCES public.os_tarefas(id) ON DELETE SET NULL;
ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS movimentacao_origem_id UUID REFERENCES public.movimentacoes_estoque(id) ON DELETE SET NULL;
ALTER TABLE public.movimentacoes_estoque ADD COLUMN IF NOT EXISTS motivo TEXT;

ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS os_item_id UUID REFERENCES public.itens_os(id) ON DELETE SET NULL;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS tarefa_id UUID;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS operador_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS inicio_previsto TIMESTAMPTZ;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS fim_previsto TIMESTAMPTZ;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS minutos_previstos INT NOT NULL DEFAULT 0;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS inicio_real TIMESTAMPTZ;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS fim_real TIMESTAMPTZ;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS minutos_reais INT NOT NULL DEFAULT 0;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS prioridade INT NOT NULL DEFAULT 3;
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.maquinas_agenda ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.usuarios(id);

ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aberta';
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS os_item_id UUID REFERENCES public.itens_os(id) ON DELETE SET NULL;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS tarefa_id UUID REFERENCES public.os_tarefas(id) ON DELETE SET NULL;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS etapa TEXT;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS causa TEXT;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS analisado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS quantidade_afetada NUMERIC(14,4) NOT NULL DEFAULT 0;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS material_perdido JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS tempo_perdido_minutos INT NOT NULL DEFAULT 0;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS acao_corretiva TEXT;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS acao_preventiva TEXT;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS retrabalho_tarefa_id UUID REFERENCES public.os_tarefas(id) ON DELETE SET NULL;

ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS os_item_id UUID REFERENCES public.itens_os(id) ON DELETE CASCADE;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS janela_inicio TIMESTAMPTZ;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS janela_fim TIMESTAMPTZ;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS rota JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS fotos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS comprovante JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS assinatura JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.entregas_instalacoes ADD COLUMN IF NOT EXISTS ocorrencia TEXT;

ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS abertura TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS inicio_previsto TIMESTAMPTZ;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS fim_previsto TIMESTAMPTZ;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS inicio_real TIMESTAMPTZ;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS fim_real TIMESTAMPTZ;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS tecnico_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS pecas JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS custo NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS horas_paradas NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS horimetro NUMERIC(12,2);
ALTER TABLE public.manutencoes ADD COLUMN IF NOT EXISTS recorrencia JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.maquina_compatibilidades (maquina_id UUID REFERENCES public.maquinas(id) ON DELETE CASCADE, produto_id UUID REFERENCES public.produtos(id) ON DELETE CASCADE, tipo_operacao TEXT, minutos_setup INT NOT NULL DEFAULT 0, minutos_limpeza INT NOT NULL DEFAULT 0, ativo BOOLEAN NOT NULL DEFAULT true, PRIMARY KEY(maquina_id, produto_id, tipo_operacao));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maquina_compatibilidades TO authenticated;
GRANT ALL ON public.maquina_compatibilidades TO service_role;
ALTER TABLE public.maquina_compatibilidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mc staff" ON public.maquina_compatibilidades;
CREATE POLICY "mc staff" ON public.maquina_compatibilidades FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.apontamentos_producao (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, os_item_id UUID REFERENCES public.itens_os(id), tarefa_id UUID REFERENCES public.os_tarefas(id), operador_id UUID NOT NULL REFERENCES public.usuarios(id), maquina_id UUID REFERENCES public.maquinas(id), status TEXT NOT NULL DEFAULT 'ativo', inicio TIMESTAMPTZ NOT NULL DEFAULT now(), pausado_em TIMESTAMPTZ, retomado_em TIMESTAMPTZ, fim TIMESTAMPTZ, minutos INT NOT NULL DEFAULT 0, quantidade_planejada NUMERIC(14,4) NOT NULL DEFAULT 0, quantidade_produzida NUMERIC(14,4), quantidade_perdida NUMERIC(14,4) NOT NULL DEFAULT 0, motivo_perda TEXT, observacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (quantidade_produzida IS NULL OR quantidade_produzida >= 0));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apontamentos_producao TO authenticated;
GRANT ALL ON public.apontamentos_producao TO service_role;
ALTER TABLE public.apontamentos_producao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "producao read" ON public.apontamentos_producao;
CREATE POLICY "producao read" ON public.apontamentos_producao FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'producao.read'));
DROP POLICY IF EXISTS "producao write" ON public.apontamentos_producao;
CREATE POLICY "producao write" ON public.apontamentos_producao FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.qualidade_checklists (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), produto_id UUID REFERENCES public.produtos(id), categoria TEXT, operacao TEXT, itens JSONB NOT NULL DEFAULT '[]'::jsonb, ativo BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualidade_checklists TO authenticated;
GRANT ALL ON public.qualidade_checklists TO service_role;
ALTER TABLE public.qualidade_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qc staff" ON public.qualidade_checklists;
CREATE POLICY "qc staff" ON public.qualidade_checklists FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.qualidade_inspecoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, os_item_id UUID REFERENCES public.itens_os(id), tarefa_id UUID REFERENCES public.os_tarefas(id), checklist_id UUID REFERENCES public.qualidade_checklists(id), responsavel_id UUID REFERENCES public.usuarios(id), data TIMESTAMPTZ NOT NULL DEFAULT now(), respostas JSONB NOT NULL DEFAULT '{}'::jsonb, fotos JSONB NOT NULL DEFAULT '[]'::jsonb, observacao TEXT, resultado TEXT NOT NULL CHECK (resultado IN ('aprovado','aprovado_com_ressalva','reprovado','retrabalho')), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualidade_inspecoes TO authenticated;
GRANT ALL ON public.qualidade_inspecoes TO service_role;
ALTER TABLE public.qualidade_inspecoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qualidade read" ON public.qualidade_inspecoes;
CREATE POLICY "qualidade read" ON public.qualidade_inspecoes FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'qualidade.read'));
DROP POLICY IF EXISTS "qualidade write" ON public.qualidade_inspecoes;
CREATE POLICY "qualidade write" ON public.qualidade_inspecoes FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'qualidade.manage')) WITH CHECK (public.has_permission(auth.uid(),'qualidade.manage'));

CREATE TABLE IF NOT EXISTS public.custos_operacionais_os (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, os_item_id UUID REFERENCES public.itens_os(id), tarefa_id UUID REFERENCES public.os_tarefas(id), categoria TEXT NOT NULL CHECK (categoria IN ('material','mao_obra','maquina','terceiros','acabamento','logistica','retrabalho','taxa','comissao')), origem TEXT NOT NULL, quantidade NUMERIC(14,4) NOT NULL DEFAULT 1, valor_unitario NUMERIC(12,4) NOT NULL DEFAULT 0, total NUMERIC(12,2) GENERATED ALWAYS AS (ROUND((quantidade * valor_unitario)::numeric, 2)) STORED, data TIMESTAMPTZ NOT NULL DEFAULT now(), usuario_id UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custos_operacionais_os TO authenticated;
GRANT ALL ON public.custos_operacionais_os TO service_role;
ALTER TABLE public.custos_operacionais_os ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "custos op read" ON public.custos_operacionais_os;
CREATE POLICY "custos op read" ON public.custos_operacionais_os FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'custos.read') OR public.has_permission(auth.uid(),'resultado.read'));
DROP POLICY IF EXISTS "custos op write" ON public.custos_operacionais_os;
CREATE POLICY "custos op write" ON public.custos_operacionais_os FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.notificacoes_operacionais (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE, tipo TEXT NOT NULL, entidade TEXT NOT NULL, entidade_id UUID NOT NULL, prioridade TEXT NOT NULL DEFAULT 'normal', mensagem TEXT NOT NULL, lida BOOLEAN NOT NULL DEFAULT false, canal TEXT NOT NULL DEFAULT 'app', data TIMESTAMPTZ NOT NULL DEFAULT now(), acao JSONB NOT NULL DEFAULT '{}'::jsonb);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes_operacionais TO authenticated;
GRANT ALL ON public.notificacoes_operacionais TO service_role;
ALTER TABLE public.notificacoes_operacionais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif own" ON public.notificacoes_operacionais;
CREATE POLICY "notif own" ON public.notificacoes_operacionais FOR ALL TO authenticated USING (usuario_id = auth.uid() OR public.is_staff(auth.uid())) WITH CHECK (usuario_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE OR REPLACE VIEW public.vw_tarefas_kanban AS SELECT * FROM public.os_tarefas;
CREATE OR REPLACE VIEW public.vw_estoque_critico AS SELECT m.id material_id, m.nome, COALESCE(SUM(l.quantidade),0) saldo_fisico, COALESCE(SUM(l.quantidade_reservada),0) saldo_reservado, COALESCE(SUM(l.quantidade-l.quantidade_reservada),0) saldo_disponivel, m.estoque_minimo, CASE WHEN COALESCE(SUM(l.quantidade-l.quantidade_reservada),0) <= COALESCE(m.estoque_minimo,0) THEN true ELSE false END critico FROM public.materiais m LEFT JOIN public.material_lotes l ON l.material_id=m.id GROUP BY m.id, m.nome, m.estoque_minimo;
CREATE OR REPLACE VIEW public.vw_resultado_operacional_os AS SELECT os.id os_id, COALESCE(os.valor_total,0) receita, COALESCE(os.custo_previsto,0) custo_previsto, COALESCE(SUM(co.total),0) custo_realizado, COALESCE(SUM(co.total),0)-COALESCE(os.custo_previsto,0) divergencia, COALESCE(SUM(co.total) FILTER (WHERE co.categoria='retrabalho'),0) retrabalho, COALESCE(os.valor_total,0)-COALESCE(os.custo_previsto,0) lucro_previsto, COALESCE(os.valor_total,0)-COALESCE(SUM(co.total),0) lucro_operacional_realizado, CASE WHEN COALESCE(os.valor_total,0)>0 THEN ROUND(((COALESCE(os.valor_total,0)-COALESCE(os.custo_previsto,0))/os.valor_total)*100,2) END margem_prevista, CASE WHEN COALESCE(os.valor_total,0)>0 THEN ROUND(((COALESCE(os.valor_total,0)-COALESCE(SUM(co.total),0))/os.valor_total)*100,2) END margem_operacional FROM public.ordens_servico os LEFT JOIN public.custos_operacionais_os co ON co.os_id=os.id GROUP BY os.id, os.valor_total, os.custo_previsto;
CREATE OR REPLACE VIEW public.vw_timeline_os AS SELECT id, os_id, entidade, entidade_id, tipo, titulo, descricao, dados_posteriores AS dados, usuario_id, created_at FROM public.eventos_negocio WHERE os_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.registrar_evento_os(p_os_id UUID, p_entidade TEXT, p_entidade_id UUID, p_tipo TEXT, p_titulo TEXT, p_descricao TEXT DEFAULT NULL, p_dados JSONB DEFAULT '{}'::jsonb) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, tipo, titulo, descricao, dados_posteriores, usuario_id) VALUES (p_entidade, p_entidade_id, p_os_id, p_tipo, p_titulo, p_descricao, p_dados, auth.uid()); END; $$;

CREATE OR REPLACE FUNCTION public.reservar_materiais_os(p_os_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid UUID; r RECORD; l RECORD; v_restante NUMERIC; v_reservado NUMERIC; v_faltantes JSONB := '[]'::jsonb;
BEGIN
  v_uid := public.require_permission('estoque.reserve');
  PERFORM 1 FROM public.ordens_servico WHERE id=p_os_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  FOR r IN SELECT * FROM public.os_materiais_previstos WHERE os_id=p_os_id LOOP
    IF EXISTS (SELECT 1 FROM public.estoque_reservas WHERE os_id=p_os_id AND material_id=r.material_id AND COALESCE(os_item_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE(r.os_item_id,'00000000-0000-0000-0000-000000000000'::uuid)) THEN CONTINUE; END IF;
    v_restante := r.quantidade;
    FOR l IN SELECT * FROM public.material_lotes WHERE material_id=r.material_id AND (quantidade-quantidade_reservada)>0 ORDER BY validade NULLS LAST, created_at FOR UPDATE LOOP
      EXIT WHEN v_restante <= 0; v_reservado := LEAST(v_restante, l.quantidade-l.quantidade_reservada);
      UPDATE public.material_lotes SET quantidade_reservada=quantidade_reservada+v_reservado WHERE id=l.id;
      INSERT INTO public.estoque_reservas(os_id, os_item_id, tarefa_id, material_id, lote_id, quantidade, status, created_by) VALUES (p_os_id, r.os_item_id, r.tarefa_id, r.material_id, l.id, v_reservado, CASE WHEN v_reservado<r.quantidade THEN 'parcial' ELSE 'reservada' END, v_uid);
      v_restante := v_restante - v_reservado;
    END LOOP;
    IF v_restante > 0 THEN v_faltantes := v_faltantes || jsonb_build_object('material_id', r.material_id, 'faltante', v_restante); END IF;
  END LOOP;
  UPDATE public.ordens_servico SET status_producao = CASE WHEN jsonb_array_length(v_faltantes)>0 THEN 'material_parcial' ELSE 'material_reservado' END WHERE id=p_os_id;
  PERFORM public.registrar_evento_os(p_os_id,'os',p_os_id,'reserva_estoque','Reserva de materiais',NULL,jsonb_build_object('faltantes',v_faltantes));
  RETURN jsonb_build_object('os_id',p_os_id,'faltantes',v_faltantes,'status',CASE WHEN jsonb_array_length(v_faltantes)>0 THEN 'parcial' ELSE 'reservado' END);
END; $$;

CREATE OR REPLACE FUNCTION public.baixar_estoque_os(p_os_id UUID, p_consumos JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid UUID; r RECORD; l RECORD; v_qtd NUMERIC; v_movs JSONB := '[]'::jsonb; v_mov UUID;
BEGIN
  v_uid := public.require_permission('estoque.exit');
  PERFORM 1 FROM public.ordens_servico WHERE id=p_os_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE os_id=p_os_id AND tipo='saida' AND origem='baixa_os') THEN RAISE EXCEPTION 'Estoque da OS já baixado'; END IF;
  FOR r IN SELECT * FROM public.estoque_reservas WHERE os_id=p_os_id AND status IN ('reservada','parcial') FOR UPDATE LOOP
    v_qtd := r.quantidade - r.quantidade_baixada; IF v_qtd <= 0 THEN CONTINUE; END IF;
    SELECT * INTO l FROM public.material_lotes WHERE id=r.lote_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Lote nao encontrado'; END IF;
    UPDATE public.material_lotes SET quantidade=quantidade-v_qtd, quantidade_reservada=GREATEST(quantidade_reservada-v_qtd,0) WHERE id=r.lote_id;
    UPDATE public.estoque_reservas SET quantidade_baixada=quantidade_baixada+v_qtd, status='baixada' WHERE id=r.id;
    INSERT INTO public.movimentacoes_estoque(material_id,lote_id,tipo,quantidade,unidade,custo_unitario_snapshot,os_id,os_item_id,tarefa_id,usuario_id,origem,motivo) VALUES (r.material_id,r.lote_id,'saida',v_qtd,l.unidade,l.custo_unitario_snapshot,p_os_id,r.os_item_id,r.tarefa_id,v_uid,'baixa_os','Baixa transacional da OS') RETURNING id INTO v_mov;
    INSERT INTO public.custos_operacionais_os(os_id,os_item_id,tarefa_id,categoria,origem,quantidade,valor_unitario,usuario_id) VALUES (p_os_id,r.os_item_id,r.tarefa_id,'material','baixa_estoque',v_qtd,l.custo_unitario_snapshot,v_uid);
    v_movs := v_movs || jsonb_build_object('movimentacao_id',v_mov,'material_id',r.material_id,'quantidade',v_qtd);
  END LOOP;
  UPDATE public.ordens_servico SET status_producao='material_baixado' WHERE id=p_os_id;
  PERFORM public.registrar_evento_os(p_os_id,'os',p_os_id,'baixa_estoque','Baixa de estoque',NULL,jsonb_build_object('movimentacoes',v_movs));
  RETURN jsonb_build_object('os_id',p_os_id,'movimentacoes',v_movs);
END; $$;

CREATE OR REPLACE FUNCTION public.estornar_baixa_estoque_os(p_movimentacao_origem_id UUID, p_motivo TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid UUID; m RECORD; v_new UUID;
BEGIN
  IF NULLIF(trim(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF; v_uid := public.require_permission('estoque.reverse');
  SELECT * INTO m FROM public.movimentacoes_estoque WHERE id=p_movimentacao_origem_id AND tipo='saida' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Movimentação de saída não encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE movimentacao_origem_id=p_movimentacao_origem_id AND tipo='entrada') THEN RAISE EXCEPTION 'Movimentação já estornada'; END IF;
  UPDATE public.material_lotes SET quantidade=quantidade+m.quantidade WHERE id=m.lote_id;
  INSERT INTO public.movimentacoes_estoque(material_id,lote_id,tipo,quantidade,unidade,custo_unitario_snapshot,os_id,os_item_id,tarefa_id,usuario_id,origem,movimentacao_origem_id,motivo) VALUES (m.material_id,m.lote_id,'entrada',m.quantidade,m.unidade,m.custo_unitario_snapshot,m.os_id,m.os_item_id,m.tarefa_id,v_uid,'estorno_os',p_movimentacao_origem_id,p_motivo) RETURNING id INTO v_new;
  PERFORM public.registrar_evento_os(m.os_id,'movimentacoes_estoque',v_new,'estorno_estoque','Estorno de baixa',p_motivo,jsonb_build_object('origem',p_movimentacao_origem_id));
  RETURN jsonb_build_object('movimentacao_id',v_new,'origem_id',p_movimentacao_origem_id);
END; $$;

DROP FUNCTION IF EXISTS public.fechar_os(UUID);
CREATE OR REPLACE FUNCTION public.fechar_os(p_os_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid UUID; v_bloqueios JSONB := '[]'::jsonb; v_result RECORD;
BEGIN
  v_uid := public.require_permission('os.close'); PERFORM 1 FROM public.ordens_servico WHERE id=p_os_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM public.os_tarefas WHERE os_id=p_os_id AND obrigatoria AND status <> 'concluida') THEN v_bloqueios := v_bloqueios || '"tarefas_obrigatorias"'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM public.itens_os WHERE os_id=p_os_id AND requer_qualidade) AND NOT EXISTS (SELECT 1 FROM public.qualidade_inspecoes WHERE os_id=p_os_id AND resultado IN ('aprovado','aprovado_com_ressalva')) THEN v_bloqueios := v_bloqueios || '"qualidade_aprovada"'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM public.os_materiais_previstos WHERE os_id=p_os_id) AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE os_id=p_os_id AND tipo='saida' AND origem='baixa_os') THEN v_bloqueios := v_bloqueios || '"materiais_baixados"'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM public.ocorrencias WHERE os_id=p_os_id AND COALESCE(status,'aberta') NOT IN ('tratada','fechada','cancelada')) THEN v_bloqueios := v_bloqueios || '"ocorrencias_tratadas"'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM public.entregas_instalacoes WHERE os_id=p_os_id AND status NOT IN ('concluida','cancelada','nao_necessaria')) THEN v_bloqueios := v_bloqueios || '"logistica_concluida"'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.custos_operacionais_os WHERE os_id=p_os_id) THEN v_bloqueios := v_bloqueios || '"custos_operacionais"'::jsonb; END IF;
  SELECT * INTO v_result FROM public.vw_resultado_operacional_os WHERE os_id=p_os_id;
  IF jsonb_array_length(v_bloqueios)>0 THEN RETURN jsonb_build_object('os_id',p_os_id,'fechada',false,'bloqueios',v_bloqueios,'bloqueios_financeiros_restantes',jsonb_build_array('financeiro_final_parte_3')); END IF;
  UPDATE public.ordens_servico SET status_geral='fechada_operacionalmente', status='concluido', custo_real=COALESCE(v_result.custo_realizado,0), lucro_real=COALESCE(v_result.lucro_operacional_realizado,0), margem_real=COALESCE(v_result.margem_operacional,0) WHERE id=p_os_id;
  PERFORM public.registrar_evento_os(p_os_id,'os',p_os_id,'fechamento_operacional','Fechamento operacional da OS',NULL,to_jsonb(v_result));
  RETURN jsonb_build_object('os_id',p_os_id,'fechada',true,'resultado',to_jsonb(v_result),'bloqueios_financeiros_restantes',jsonb_build_array('financeiro_final_parte_3'));
END; $$;

GRANT EXECUTE ON FUNCTION public.reservar_materiais_os(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.baixar_estoque_os(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_estoque_os(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fechar_os(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_os(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;