-- APLICADA em 12/11/2026 (ensaiada em transação desfeita: anon sem acesso, authenticated só SELECT, security_barrier ligado, 0 linhas sem login).
-- As visões nasceram vazias para quem não vê custo; o front da onda C passa a lê-las antes da C3 fechar as tabelas.

-- Privacidade do custo, onda C1: as visões do custo da impressão 3D (ADITIVA; desenho de 05/11/2026, revisto em 11/11/2026).
--
-- POR QUÊ
--   Quem não vê custo lê hoje, direto das tabelas, o custo por grama de cada filamento, o custo/hora e a depreciação de cada
--   impressora 3D e a configuração de preço (mão de obra/hora, salário, encargo, energia, markup, % de acabamento e de falha,
--   embalagem): a calculadora 3D do vendedor fazia a conta no navegador com esses números. Esconder só a coluna de compra e
--   deixar o custo por grama aberto não esconde nada (custo de compra = custo por grama x peso do rolo): a taxa é o custo.
--   O fechamento é a onda C3. Esta (C1) só cria o que o front passa a usar antes:
--     - maquinas_3d_config_financeiro: a impressora inteira (com nome e tipo da máquina), só para quem vê custo de máquina;
--     - materiais_3d_filamento_financeiro: o filamento inteiro (com nome do material), só para quem vê custo de máquina.
--   Mesmo desenho de maquinas_financeiro (B1, no ar desde 10/11/2026): DEFINER + security_barrier, guarda no WHERE
--   (is_staff e pode_ver_custo_de_maquina: financeiro.read ou impressao3d.cost.read), só SELECT, nada para o visitante.
--
-- REVISTO CONTRA O BANCO DE 11/11/2026 (pg_attribute): maquinas_3d_config tem 36 colunas, materiais_3d_filamento 25
-- (custo_por_grama_calculado é gerada), as mesmas de 05/11. As visões listam todas, uma a uma. A guarda abaixo PARA se a
-- tabela ganhou ou perdeu coluna desde essa leitura: a visão sairia incompleta (coluna nova sem caminho para quem vê custo)
-- ou a criação falharia no meio. Nenhuma visão depende hoje das duas tabelas.
--
-- ORDEM: C1 (esta) -> publicar o front da onda C (cotação 3D no servidor + telas pelas visões) e provar no pacote -> C3.
-- Publicar o front ANTES desta deixa admin, gestor e financeiro sem lista de impressoras e filamentos (a visão não existe).
-- IDEMPOTENTE.

-- 0. Guarda: as colunas vivas são as que esta migração conhece ------------------------------------------------------------
DO $guarda$
DECLARE
  v_imp_esperadas constant text[] := ARRAY[
    'maquina_id', 'fabricante', 'modelo', 'serial', 'tecnologia', 'custo_aquisicao', 'frete_aquisicao', 'instalacao',
    'acessorios_capitalizados', 'valor_residual', 'vida_util_horas', 'horas_acumuladas', 'manutencao_por_hora',
    'consumiveis_por_hora', 'infraestrutura_por_hora', 'potencia_media_w', 'potencia_aquecimento_w', 'potencia_standby_w',
    'horas_produtivas_mensais', 'metodo_custo_hora', 'custo_hora_calculado', 'custo_hora_manual', 'motivo_custo_manual',
    'custo_hora_manual_usuario_id', 'custo_hora_manual_at', 'capacidade_x', 'capacidade_y', 'capacidade_z', 'possui_ams',
    'quantidade_slots', 'bico_padrao', 'placa_padrao', 'consumiveis_json', 'ativa', 'created_at', 'updated_at'];
  v_fil_esperadas constant text[] := ARRAY[
    'material_id', 'tipo', 'marca', 'linha', 'cor', 'codigo', 'diametro', 'densidade', 'peso_nominal', 'peso_liquido',
    'tara_carretel', 'custo_compra', 'frete_rateado', 'tributos_aquisicao', 'descontos', 'outros_custos',
    'fator_aproveitamento', 'exige_secagem', 'tempo_secagem', 'potencia_secador', 'temperatura_secagem', 'armazenamento',
    'custo_por_grama_calculado', 'created_at', 'updated_at'];
  v_tabela text;
  v_esperadas text[];
  v_vivas text[];
  v_novas text;
  v_sumiram text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['maquinas_3d_config', 'materiais_3d_filamento'] LOOP
    v_esperadas := CASE v_tabela WHEN 'maquinas_3d_config' THEN v_imp_esperadas ELSE v_fil_esperadas END;
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_vivas
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || v_tabela) AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_vivas IS NULL THEN
      RAISE EXCEPTION 'C1: a tabela public.% não existe neste banco; reler antes de criar as visões', v_tabela;
    END IF;
    SELECT string_agg(c, ', ') INTO v_novas FROM unnest(v_vivas) AS c WHERE c <> ALL (v_esperadas);
    SELECT string_agg(c, ', ') INTO v_sumiram FROM unnest(v_esperadas) AS c WHERE c <> ALL (v_vivas);
    IF v_novas IS NOT NULL OR v_sumiram IS NOT NULL THEN
      RAISE EXCEPTION 'C1: public.% mudou desde a leitura de 11/11/2026 (coluna nova: %; coluna que sumiu: %). Pôr a coluna na visão e em src/domain/impressao3d/colunas.ts antes de aplicar',
        v_tabela, coalesce(v_novas, 'nenhuma'), coalesce(v_sumiram, 'nenhuma');
    END IF;
  END LOOP;
END $guarda$;

-- 1. A impressora 3D inteira, só para quem vê custo de máquina -------------------------------------------------------------
CREATE OR REPLACE VIEW public.maquinas_3d_config_financeiro AS
 SELECT c.maquina_id,
    m.nome,
    m.tipo,
    c.fabricante,
    c.modelo,
    c.serial,
    c.tecnologia,
    c.custo_aquisicao,
    c.frete_aquisicao,
    c.instalacao,
    c.acessorios_capitalizados,
    c.valor_residual,
    c.vida_util_horas,
    c.horas_acumuladas,
    c.manutencao_por_hora,
    c.consumiveis_por_hora,
    c.infraestrutura_por_hora,
    c.potencia_media_w,
    c.potencia_aquecimento_w,
    c.potencia_standby_w,
    c.horas_produtivas_mensais,
    c.metodo_custo_hora,
    c.custo_hora_calculado,
    c.custo_hora_manual,
    c.motivo_custo_manual,
    c.custo_hora_manual_usuario_id,
    c.custo_hora_manual_at,
    c.capacidade_x,
    c.capacidade_y,
    c.capacidade_z,
    c.possui_ams,
    c.quantidade_slots,
    c.bico_padrao,
    c.placa_padrao,
    c.consumiveis_json,
    c.ativa,
    c.created_at,
    c.updated_at
   FROM public.maquinas_3d_config c
     LEFT JOIN public.maquinas m ON m.id = c.maquina_id
  WHERE public.is_staff(( SELECT auth.uid() AS uid)) AND public.pode_ver_custo_de_maquina(( SELECT auth.uid() AS uid));

-- CREATE OR REPLACE VIEW zera as opções: religar (security_barrier impede que um filtro do chamador veja linha antes da guarda)
ALTER VIEW public.maquinas_3d_config_financeiro SET (security_invoker = false, security_barrier = true);
-- Visão criada em public nasce com tudo liberado para anon e authenticated; esta é só de leitura e só para quem entra.
REVOKE ALL ON public.maquinas_3d_config_financeiro FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.maquinas_3d_config_financeiro TO authenticated;
COMMENT ON VIEW public.maquinas_3d_config_financeiro IS
  'A impressora 3D inteira, com depreciação e custo/hora. Só quem vê custo de máquina (financeiro.read ou impressao3d.cost.read). Quem não vê lê maquinas_3d_config sem as colunas de custo (depois da onda C3) e recebe o preço da peça pelo servidor.';

-- 2. O filamento inteiro, só para quem vê custo de máquina -----------------------------------------------------------------
CREATE OR REPLACE VIEW public.materiais_3d_filamento_financeiro AS
 SELECT f.material_id,
    mt.nome,
    f.tipo,
    f.marca,
    f.linha,
    f.cor,
    f.codigo,
    f.diametro,
    f.densidade,
    f.peso_nominal,
    f.peso_liquido,
    f.tara_carretel,
    f.custo_compra,
    f.frete_rateado,
    f.tributos_aquisicao,
    f.descontos,
    f.outros_custos,
    f.fator_aproveitamento,
    f.exige_secagem,
    f.tempo_secagem,
    f.potencia_secador,
    f.temperatura_secagem,
    f.armazenamento,
    f.custo_por_grama_calculado,
    f.created_at,
    f.updated_at
   FROM public.materiais_3d_filamento f
     LEFT JOIN public.materiais mt ON mt.id = f.material_id
  WHERE public.is_staff(( SELECT auth.uid() AS uid)) AND public.pode_ver_custo_de_maquina(( SELECT auth.uid() AS uid));

ALTER VIEW public.materiais_3d_filamento_financeiro SET (security_invoker = false, security_barrier = true);
REVOKE ALL ON public.materiais_3d_filamento_financeiro FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.materiais_3d_filamento_financeiro TO authenticated;
COMMENT ON VIEW public.materiais_3d_filamento_financeiro IS
  'O filamento inteiro, com custo de compra e custo por grama. Só quem vê custo de máquina (financeiro.read ou impressao3d.cost.read). Quem não vê lê materiais_3d_filamento sem as colunas de custo (depois da onda C3).';

NOTIFY pgrst, 'reload schema';
