-- Achado de homologação: as tabelas-base ordens_servico/itens_os/orcamentos têm
-- SELECT revogado para o role `authenticated` (proteção de custo por colunas via
-- views operacional/financeira). Porém as views OPERACIONAIS não expunham algumas
-- colunas puramente operacionais que o app lê — quebrando leituras com 403
-- (baixa de estoque, etc.). Adiciona as colunas operacionais faltantes.
--
-- CREATE OR REPLACE VIEW só permite ANEXAR colunas ao final, na mesma ordem.

CREATE OR REPLACE VIEW public.itens_os_operacional AS
 SELECT id, os_id, descricao, quantidade, unidade, ordem, created_at, produto_id
   FROM public.itens_os;

CREATE OR REPLACE VIEW public.ordens_servico_operacional AS
 SELECT os.id, os.numero, os.cliente_id, c.nome AS cliente_nome, c.logo_url AS cliente_logo_url,
    os.orcamento_id, os.vendedor_id, os.responsavel_id, os.designer_id, os.operador_id,
    os.status, os.titulo, os.briefing, os.observacoes, os.prioridade, os.prazo_entrega,
    os.data_entrega_real, os.ordem_kanban, os.created_by, os.created_at, os.updated_at,
    os.estoque_baixado
   FROM public.ordens_servico os
     JOIN public.clientes c ON c.id = os.cliente_id;
