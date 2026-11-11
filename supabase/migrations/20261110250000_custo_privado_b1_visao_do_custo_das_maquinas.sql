-- APLICADA em 10/11/2026, em produção. Aditiva: nada deixa de ser lido por ninguém. Conferido depois: a visão tem 32
-- colunas, opções security_invoker=false e security_barrier=true, SELECT só para authenticated (anon não lê), e
-- nenhuma máquina tem texto comercial ainda (a coluna nasce vazia; a migração de fechamento é que move o texto de compra).

-- Privacidade do custo, onda B1: a visão do custo das máquinas (ADITIVA; 10/11/2026).
--
-- POR QUÊ
--   maquinas é lida por toda a equipe (policy is_staff, privilégio de tabela inteira). Medido com a conta do vendedor:
--   8 das 9 máquinas mostravam custo/hora, 6 mostravam valor de compra, e a ficha técnica (jsonb especificacoes) mistura
--   dado técnico com texto de compra (chaves compra, custo_hora_base, preco_referencia, situacao...). A tela /maquinas
--   desenha esse jsonb inteiro para quem a abre.
--   Esta migração NÃO tira nada de ninguém. Ela só cria o que o front passa a usar ANTES de a migração de fechamento tirar a
--   leitura da tabela:
--     - maquinas.especificacoes_comerciais (jsonb): para onde vai o texto de compra e de custo;
--     - maquinas_financeiro (visão): a máquina inteira, com custo, só para quem vê custo de máquina (financeiro.read ou
--       impressao3d.cost.read). Mesmo desenho de materiais_financeiro e os_perdas_financeiro: DEFINER + security_barrier,
--       guarda no WHERE, só SELECT. Traz também alimentacao e comprimento_util_m (migração do formato da máquina).
--
-- ORDEM: B1 (esta) -> publicar o front que lê maquinas_financeiro -> migração de fechamento. IDEMPOTENTE.

ALTER TABLE public.maquinas ADD COLUMN IF NOT EXISTS especificacoes_comerciais jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.maquinas.especificacoes_comerciais IS
  'Texto e números de compra e de custo da máquina (onde comprou, quanto pagou, base do custo/hora). Só quem vê custo lê: fica de fora do GRANT de authenticated e sai por maquinas_financeiro. A ficha técnica (especificacoes) não leva custo.';

CREATE OR REPLACE VIEW public.maquinas_financeiro AS
 SELECT m.id,
    m.nome,
    m.tipo,
    m.ativa,
    m.created_at,
    m.custo_hora,
    m.potencia_kw,
    m.setup_min,
    m.velocidade_m2_h,
    m.disponibilidade_pct,
    m.setor,
    m.updated_at,
    m.largura_util_m,
    m.margem_lateral_m,
    m.fabricante,
    m.modelo,
    m.numero_serie,
    m.imagem_url,
    m.especificacoes,
    m.horas_produtivas_mensais,
    m.vida_util_horas,
    m.valor_residual,
    m.base_cobranca,
    m.tempo_minimo_min,
    m.velocidade_mm_s,
    m.avanco_m,
    m.forma_aquisicao,
    m.valor_aquisicao,
    m.data_aquisicao,
    m.especificacoes_comerciais,
    m.alimentacao,
    m.comprimento_util_m
   FROM public.maquinas m
  WHERE public.is_staff(( SELECT auth.uid() AS uid)) AND public.pode_ver_custo_de_maquina(( SELECT auth.uid() AS uid));

-- CREATE OR REPLACE VIEW zera as opções: religar (security_barrier impede que um filtro do chamador veja linha antes da guarda)
ALTER VIEW public.maquinas_financeiro SET (security_invoker = false, security_barrier = true);
-- Visão criada em public nasce com tudo liberado para anon e authenticated; esta é só de leitura e só para quem entra.
REVOKE ALL ON public.maquinas_financeiro FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.maquinas_financeiro TO authenticated;
COMMENT ON VIEW public.maquinas_financeiro IS
  'A máquina inteira com custo/hora, valor de compra e texto de compra. Só quem vê custo de máquina (financeiro.read ou impressao3d.cost.read). Quem não vê lê a tabela maquinas, sem essas colunas.';

NOTIFY pgrst, 'reload schema';
