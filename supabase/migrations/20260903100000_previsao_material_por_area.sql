-- A previsão de material ignorava a ÁREA e contava PEÇAS.
--
-- Achado rodando um ciclo completo: banner de 3,00 × 2,00 (6 m²), ficha técnica
-- pedindo 1,05 m² de lona por m² vendido. A previsão respondeu:
--
--   Lona 280g   necessário 1,0500 m²   <- deveria ser 6,3000
--   Tinta       necessário 12,0000 ml  <- deveria ser 72,0000
--
-- Seis vezes menos. A causa:
--
--   pm.quantidade_por_unidade * coalesce(i.quantidade, 1)
--
-- `quantidade` é o número de PEÇAS (1 banner). `quantidade_por_unidade` é
-- consumo por unidade DE VENDA, e a unidade de venda de produto medido em área
-- é o m² — a própria observação da ficha diz "m² de lona" e "ml de tinta por
-- m²". Multiplicar por peças errava por um fator igual à área da peça.
--
-- O efeito não é só relatório errado: `reservar_materiais_os` e
-- `baixar_estoque_os` leem esta tabela. A gráfica reservaria e baixaria um sexto
-- da lona que realmente usa, o estoque acreditaria ter material já consumido, e
-- o custo da OS sairia seis vezes menor — bagunçando margem e previsto×realizado
-- justamente nos produtos que são a maior parte do faturamento.
--
-- Esta regra JÁ EXISTIA no front, em `baseDeConsumo` (src/domain/orcamentos/
-- area.ts): área cobrada quando o item tem dimensões, quantidade quando não tem.
-- O banco tinha a segunda verdade. Agora usa `itens_os.area_cobrada`, que é
-- coluna gerada com exatamente essa semântica (maior entre área da peça e área
-- mínima, × quantidade) e vem NULL para item sem dimensão — então um único
-- `coalesce` cobre os dois casos.
create or replace function public.gerar_materiais_previstos_os(p_os_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.os_materiais_previstos (os_id, os_item_id, material_id, quantidade, unidade, custo_unitario_previsto)
  SELECT i.os_id, i.id, pm.material_id,
         pm.quantidade_por_unidade * public.base_de_consumo_item(i.area_cobrada, i.quantidade),
         m.unidade, m.custo_unitario
  FROM public.itens_os i
  JOIN public.produto_materiais pm ON pm.produto_id = i.produto_id
  JOIN public.materiais m ON m.id = pm.material_id
  WHERE i.os_id = p_os_id
    AND NOT EXISTS (
      SELECT 1 FROM public.os_materiais_previstos p
      WHERE p.os_item_id = i.id AND p.material_id = pm.material_id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- Uma função só para a base, para não repetir a regra em cada consulta que
-- precisar dela (e não abrir espaço para uma terceira verdade).
create or replace function public.base_de_consumo_item(p_area_cobrada numeric, p_quantidade numeric)
returns numeric
language sql
immutable
as $$
  -- Item com dimensão consome por ÁREA; sem dimensão, por peça.
  select case
           when coalesce(p_area_cobrada, 0) > 0 then p_area_cobrada
           else greatest(coalesce(p_quantidade, 1), 1)
         end
$$;

comment on function public.base_de_consumo_item is
  'Base que multiplica a ficha técnica: área cobrada para item dimensionado, quantidade de peças para o resto. Espelha baseDeConsumo() do front.';

comment on function public.gerar_materiais_previstos_os is
  'Gera a previsão de material da OS a partir da ficha técnica, com a base em ÁREA para produto vendido por m².';

-- ---------------------------------------------------------------------------
-- Conserta previsões já gravadas que ninguém usou ainda.
--
-- Só as intocadas: linha que já tem reserva ou movimentação fica como está.
-- Mudar a previsão por baixo de uma baixa já feita esconderia a diferença
-- justamente onde ela precisa aparecer — em previsto × realizado.
-- ---------------------------------------------------------------------------
update public.os_materiais_previstos p
   set quantidade = pm.quantidade_por_unidade * public.base_de_consumo_item(i.area_cobrada, i.quantidade)
  from public.itens_os i, public.produto_materiais pm
 where p.os_item_id = i.id
   and pm.produto_id = i.produto_id
   and pm.material_id = p.material_id
   and coalesce(i.area_cobrada, 0) > 0
   and p.quantidade <> pm.quantidade_por_unidade * public.base_de_consumo_item(i.area_cobrada, i.quantidade)
   and not exists (select 1 from public.estoque_reservas r where r.os_id = p.os_id and r.material_id = p.material_id)
   and not exists (select 1 from public.movimentacoes_estoque mv where mv.os_id = p.os_id and mv.material_id = p.material_id);
