-- Grants das colunas novas: sem eles, adicionar item de orçamento falha.
--
-- Descoberto rodando o fluxo inteiro de ponta a ponta. Inserir um item de
-- orçamento ligado a um produto estourava com "permission denied for table
-- produtos" — o gatilho tg_item_precificar_por_area lê `area_minima_cobrada`, e
-- essa coluna nunca teve grant.
--
-- O acesso a `produtos` e `materiais` é por COLUNA, não por tabela: cada coluna
-- não financeira é liberada individualmente, e o custo fica de fora. Por isso
-- `has_table_privilege(...,'SELECT')` devolve false mesmo com o acesso
-- funcionando — quem confere precisa olhar information_schema.column_privileges.
--
-- Toda coluna nova exige o grant explícito. As que criei nesta leva
-- (espacamento_pecas_m, largura_bobina_m, comprimento_bobina_m) estavam no mesmo
-- buraco: a conta de aproveitamento de bobina leria nulo e diria "cadastre a
-- largura" para uma bobina que já estava cadastrada.

grant select (area_minima_cobrada, espacamento_pecas_m) on public.produtos to authenticated;
grant select (largura_bobina_m, comprimento_bobina_m, estoque_minimo, localizacao, status)
  on public.materiais to authenticated;

-- As views operacionais são o caminho oficial de leitura do front. Coluna que
-- não está na view é coluna que a tela não enxerga, por mais grant que tenha.
create or replace view public.produtos_operacional as
select id, nome, descricao, ativo, created_at, sku, categoria, tipo, unidade,
       tempo_producao_min, imagem_url, observacoes_internas, updated_at,
       maquina_padrao_id, material_principal_id, exigencias, sugestoes_operacionais,
       area_minima_cobrada, espacamento_pecas_m
from public.produtos;

create or replace view public.materiais_operacional as
select id, nome, unidade, estoque, created_at,
       estoque_minimo, localizacao, status,
       largura_bobina_m, comprimento_bobina_m
from public.materiais;

comment on view public.produtos_operacional is
  'Produto sem coluna de custo. Toda coluna nova precisa entrar aqui E ter grant.';
comment on view public.materiais_operacional is
  'Material sem coluna de custo. Inclui a largura de bobina usada no aproveitamento.';
