-- ============================================================================
-- Materiais: características e uma grafia só para o metro quadrado
-- ============================================================================
--
-- POR QUÊ (05/10/2026): o dono pediu que a equipe informe nome e
-- CARACTERÍSTICAS do material e que o sistema mostre os parecidos já
-- cadastrados antes de salvar, para não duplicar; e um filtro por unidade
-- (m², un, kg) na lista.
--
--   - `materiais` não tinha onde escrever cor, espessura, gramatura,
--     acabamento. `caracteristicas` (texto livre) entra na tabela e no FIM das
--     duas views que a tela lê. A operacional é security_invoker: o leitor
--     precisa do SELECT na coluna — daí o GRANT antes de recriar a view (view
--     invoker com coluna sem grant morre inteira). A financeira é definer e
--     mantém o filtro dela. `fornecedor` continua fora da operacional (quem vê
--     fornecedor não muda aqui).
--   - O mesmo metro quadrado estava gravado "m2" (9 materiais) e "m²" (3). O
--     filtro já trata os dois como um só, mas o cadastro novo oferece "m²" e a
--     conferência de duplicidade compara unidades — duas grafias para a mesma
--     coisa é exatamente o ruído que ela existe para tirar. Decisão do dono:
--     unificar em "m²". E o "Acrilico esp dourado 2mm" estava em "mt", que o
--     dono confirmou ser m² digitado errado.
--     Nenhuma função do banco compara a unidade do material escrita por
--     extenso (conferido: só `parceiro_precos`, que é de PRODUTO e aceita as
--     duas grafias); lotes e movimentações guardam a unidade como retrato do
--     dia e ficam como estão.

-- ------------------------------------------------------- 1. características
ALTER TABLE public.materiais ADD COLUMN caracteristicas text;

COMMENT ON COLUMN public.materiais.caracteristicas IS 'Cor, espessura, gramatura, acabamento, largura — o que distingue este material de outro parecido. Entra na conferência de duplicidade do cadastro.';

GRANT SELECT (caracteristicas) ON public.materiais TO authenticated;

CREATE OR REPLACE VIEW public.materiais_operacional WITH (security_invoker = true) AS
 SELECT id,
    nome,
    unidade,
    estoque,
    created_at,
    estoque_minimo,
    localizacao,
    status,
    largura_bobina_m,
    comprimento_bobina_m,
    caracteristicas
   FROM materiais;

CREATE OR REPLACE VIEW public.materiais_financeiro WITH (security_invoker = false, security_barrier = true) AS
 SELECT m.id,
    m.nome,
    m.unidade,
    m.estoque,
    mc.custo_unitario,
    m.created_at,
    m.custo_medio,
    m.fornecedor,
    m.estoque_minimo,
    m.estoque_maximo,
    m.localizacao,
    m.status,
    m.updated_at,
    m.largura_bobina_m,
    m.comprimento_bobina_m,
    m.caracteristicas
   FROM materiais m
     LEFT JOIN material_custos mc ON mc.material_id = m.id
  WHERE is_staff(auth.uid()) AND can_see_financials(auth.uid());

-- ------------------------------------------------------------- 2. unidade
UPDATE public.materiais SET unidade = 'm²' WHERE unidade = 'm2';
UPDATE public.materiais SET unidade = 'm²' WHERE unidade = 'mt' AND nome = 'Acrilico esp dourado 2mm';
