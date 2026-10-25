-- Pendências de PREENCHIMENTO: o que o cadastro tem de provisório ou vazio e precisa de um número
-- de verdade. Aparece no painel de quem resolve (financeiro, gestor, administrador), junto com as
-- pendências de `pendencias_do_sistema()`; a tela junta as duas listas.
--
-- Função à parte (mesma forma de saída) de propósito: `pendencias_do_sistema()` tem 20 KB e várias
-- sessões mexem nela; acrescentar aqui não obriga a recriá-la nem disputa a versão.
--
-- Linhas de custo e preço só voltam para quem vê dinheiro (admin, financeiro.read ou custos.read).
CREATE OR REPLACE FUNCTION public.pendencias_de_preenchimento()
RETURNS TABLE(chave text, titulo text, quantidade integer, total integer, severidade text,
              quem_resolve text, o_que_fazer text, link text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ve_dinheiro boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE='42501'; END IF;
  v_ve_dinheiro := public.has_role(v_uid,'admin') OR public.has_permission(v_uid,'financeiro.read') OR public.has_permission(v_uid,'custos.read');

  IF v_ve_dinheiro THEN
    -- Produto vendendo com custo e preço de balcão COPIADOS do parecido (o dono ainda não informou).
    RETURN QUERY SELECT 'produto_custo_provisorio', 'Produtos com custo e preço de balcão provisórios', count(*)::int,
      (SELECT count(*)::int FROM public.produtos WHERE ativo), 'critico', 'financeiro',
      'Estes produtos já vendem com o custo e o preço de balcão copiados de um produto parecido. Margem, custo da OS e comissão saem errados até o número real entrar. Preencha o custo por m² e o preço de balcão.',
      '/produtos'
    FROM public.produtos p WHERE p.ativo AND p.observacoes_internas LIKE '%PROVISÓRIOS%' HAVING count(*) > 0;

    -- Produto de verdade (não serviço) sem custo: a margem do orçamento e da OS fica sem referência.
    RETURN QUERY SELECT 'produto_sem_custo', 'Produtos ativos sem custo cadastrado', count(*)::int,
      (SELECT count(*)::int FROM public.produtos WHERE ativo AND tipo::text <> 'servico'), 'critico', 'financeiro',
      'Sem custo, o orçamento mostra margem que não existe e a OS fecha com lucro falso. Preencha o custo ou a ficha de materiais do produto.',
      '/produtos'
    FROM public.produtos p
    WHERE p.ativo AND p.tipo::text <> 'servico' AND COALESCE(p.custo_medio, 0) <= 0
      AND COALESCE(p.observacoes_internas, '') NOT LIKE '%PROVISÓRIOS%'
    HAVING count(*) > 0;

    -- Produto ativo que ninguém consegue precificar: sem preço de balcão, sem faixa e sem preço de parceiro.
    RETURN QUERY SELECT 'produto_sem_preco', 'Produtos ativos sem nenhum preço de venda', count(*)::int,
      (SELECT count(*)::int FROM public.produtos WHERE ativo), 'atencao', 'financeiro',
      'O orçamento não sugere preço para estes produtos e o parceiro não os vê na tabela. Preencha o preço de balcão, as faixas de quantidade ou o preço de parceiro.',
      '/produtos'
    FROM public.produtos p
    WHERE p.ativo AND COALESCE(p.preco_base, 0) <= 0 AND COALESCE(p.preco_parceiro, 0) <= 0
      AND NOT EXISTS (SELECT 1 FROM public.produto_faixas_preco f WHERE f.produto_id = p.id)
      AND COALESCE(p.observacoes_internas, '') NOT LIKE '%PROVISÓRIOS%'
    HAVING count(*) > 0;

    -- Acabamento com tempo e custo mas sem preço de venda: não dá para cobrar à parte.
    RETURN QUERY SELECT 'acabamento_sem_preco', 'Acabamentos ativos sem preço de venda', count(*)::int,
      (SELECT count(*)::int FROM public.acabamentos WHERE ativo), 'atencao', 'financeiro',
      'Sem preço de venda o acabamento não pode ser cobrado como linha do orçamento. Abra o produto, aba Acabamentos, e preencha o preço.',
      '/produtos'
    FROM public.acabamentos WHERE ativo AND COALESCE(preco_venda, 0) <= 0 HAVING count(*) > 0;
  END IF;

  -- Só os rolos da impressão: sem o estoque cheio não há como avisar a compra a 15%.
  RETURN QUERY SELECT 'material_sem_estoque_maximo', 'Rolos sem estoque cheio definido (aviso de compra)', count(*)::int,
    (SELECT count(*)::int FROM public.materiais WHERE status = 'ativo' AND largura_bobina_m IS NOT NULL), 'atencao', 'gestao',
    'O aviso de compra a 15% do estoque cheio precisa saber quanto é o cheio de cada rolo. Preencha o estoque máximo e o mínimo passa a ser 15% dele.',
    '/materiais'
  FROM public.materiais m WHERE m.status = 'ativo' AND m.largura_bobina_m IS NOT NULL AND m.estoque_maximo IS NULL
  HAVING count(*) > 0;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.pendencias_de_preenchimento() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pendencias_de_preenchimento() TO authenticated;

NOTIFY pgrst, 'reload schema';
