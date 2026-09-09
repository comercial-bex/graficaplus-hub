-- A view do Kanban não tinha a máquina. Nem o produto.
--
-- O cartão escrevia "Máquina não definida" e "Produto não definido" em toda OS,
-- e não era por falta de cadastro: `ordens_servico_operacional` e
-- `ordens_servico_financeiro` **não expõem `maquina_id` nem `produto_id`**.
-- O código lia `os.maquinas?.nome` de um objeto que a consulta nunca poderia
-- trazer — view não tem FK declarada, então nem o embed do PostgREST funciona,
-- e sem a coluna de id não há nem como resolver do lado do cliente.
--
-- Era uma promessa impossível: o cartão anunciava um campo que a fonte de dados
-- não carrega. Some com a informação sem erro nenhum — o mesmo padrão do select
-- com coluna inexistente, só que ao contrário.
--
-- `precisa_entrega` e `precisa_instalacao` entram pelo mesmo motivo: o quadro
-- usa os dois para decidir se soltar o cartão em "Saída" significa aguardando
-- retirada, aguardando entrega ou instalação. Sem as colunas, aquele ramo nunca
-- rodava e toda OS caía em "aguardando retirada".
--
-- CREATE OR REPLACE acrescenta coluna NO FIM, que é exatamente o caso aqui.
-- `security_invoker=true` precisa ser repetido: sem ele a view voltaria a rodar
-- como dona e furaria o RLS de `ordens_servico`.

CREATE OR REPLACE VIEW public.ordens_servico_operacional
WITH (security_invoker = true) AS
  SELECT os.id,
    os.numero,
    os.cliente_id,
    c.nome AS cliente_nome,
    c.logo_url AS cliente_logo_url,
    os.orcamento_id,
    os.vendedor_id,
    os.responsavel_id,
    os.designer_id,
    os.operador_id,
    os.status,
    os.titulo,
    os.briefing,
    os.observacoes,
    os.prioridade,
    os.prazo_entrega,
    os.data_entrega_real,
    os.ordem_kanban,
    os.created_by,
    os.created_at,
    os.updated_at,
    os.estoque_baixado,
    -- acrescentadas em 09/09/2026
    os.maquina_id,
    os.produto_id,
    os.setor_atual,
    os.precisa_entrega,
    os.precisa_instalacao
   FROM (ordens_servico os
     JOIN clientes c ON ((c.id = os.cliente_id)));

CREATE OR REPLACE VIEW public.ordens_servico_financeiro
WITH (security_invoker = true) AS
  SELECT os.id,
    os.numero,
    os.cliente_id,
    c.nome AS cliente_nome,
    c.logo_url AS cliente_logo_url,
    os.orcamento_id,
    os.vendedor_id,
    os.responsavel_id,
    os.designer_id,
    os.operador_id,
    os.status,
    os.titulo,
    os.briefing,
    os.observacoes,
    os.prioridade,
    os.prazo_entrega,
    os.data_entrega_real,
    osf.valor_total,
    osf.custo_previsto,
    osf.custo_real,
    osf.margem_real,
    os.ordem_kanban,
    os.created_by,
    os.created_at,
    os.updated_at,
    -- acrescentadas em 09/09/2026
    os.maquina_id,
    os.produto_id,
    os.setor_atual,
    os.precisa_entrega,
    os.precisa_instalacao
   FROM ((ordens_servico os
     JOIN clientes c ON ((c.id = os.cliente_id)))
     LEFT JOIN os_resultados_financeiros osf ON ((osf.os_id = os.id)))
  WHERE can_see_financials(auth.uid());
