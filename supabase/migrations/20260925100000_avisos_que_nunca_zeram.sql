-- ============================================================================
-- Avisos que nunca conseguem chegar a zero
-- ============================================================================
--
-- Um aviso que não pode zerar ensina a ignorar todos os outros. Dois no painel
-- estavam assim.
--
-- `produto_sem_ficha` contava 18 de 31 produtos ativos. Quatro deles são
-- serviço — Criação/arte final, Deslocamento, Instalação em campo, Impressão 3D
-- — e serviço **não tem ficha de material por definição**. Nunca iam sair da
-- conta. A tabela já distingue: `produtos.tipo` é o enum `tipo_item`
-- (`produto | servico`), e os quatro já estavam marcados certo. O aviso é que
-- não olhava.
--
-- `os_sem_material_previsto` contava as duas OS abertas, e por motivos
-- diferentes — o que é justamente o problema: o mesmo aviso para dois defeitos
-- diferentes não diz a nenhum dos dois o que fazer.
--
--   OS 44  1 item, e o item está SEM PRODUTO      → não tem ficha para prever
--   OS 49  ZERO itens                             → não tem o que produzir
--
-- O segundo caso não tinha aviso nenhum. `orcamento_sem_item` existe desde
-- sempre; o irmão dele, um andar adiante, nunca foi escrito.
--
-- CUIDADO ao mexer nisto: a primeira versão desta migração usou
-- `JOIN produtos` para excluir serviço, e com isso escondeu a OS 44 — item sem
-- produto não casa no JOIN e sumia do aviso. Item sem produto é PIOR, não
-- melhor. O `LEFT JOIN` com `COALESCE(tipo,'produto')` é o que traz esse caso
-- de volta.
--
-- Retrato do banco vivo: aplicado e conferido.

-- ------------------------------------------- 1. serviço não tem ficha, e pronto
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='pendencias_do_sistema';

  IF position('p.tipo <> ''servico''' in src) > 0 THEN RETURN; END IF;

  novo := replace(src,
    $old$    (SELECT count(*)::int FROM public.produtos WHERE ativo),'atencao','gestao',
    'Sem ficha, a OS desse produto nasce sem material previsto, o estoque não baixa e o custo real fica zero.','/produtos'
  FROM public.produtos p WHERE p.ativo AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id=p.id) HAVING count(*)>0;$old$,
    $new$    (SELECT count(*)::int FROM public.produtos WHERE ativo AND tipo <> 'servico'),'atencao','gestao',
    'Sem ficha, a OS desse produto nasce sem material previsto, o estoque não baixa e o custo real fica zero. Se a peça não consome material da casa, marque-a como serviço no cadastro.','/produtos'
  FROM public.produtos p WHERE p.ativo AND p.tipo <> 'servico'
    AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id=p.id) HAVING count(*)>0;$new$);

  IF novo = src THEN RAISE EXCEPTION 'bloco produto_sem_ficha nao encontrado'; END IF;
  EXECUTE novo;
END $patch$;


-- -------------------------------- 2. OS só de serviço não tem o que prever
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='pendencias_do_sistema';

  IF position('so de servico' in src) > 0 THEN RETURN; END IF;

  novo := replace(src,
    $old$  FROM public.ordens_servico os WHERE os.status NOT IN ('concluido','faturado','cancelado')
    AND NOT EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id=os.id) HAVING count(*)>0;$old$,
    $new$  FROM public.ordens_servico os WHERE os.status NOT IN ('concluido','faturado','cancelado')
    AND NOT EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id=os.id)
    -- so de servico: nada a prever. LEFT JOIN de proposito — item SEM PRODUTO
    -- tem de continuar aparecendo, porque e pior, nao melhor.
    AND EXISTS (SELECT 1 FROM public.itens_os i
                  LEFT JOIN public.produtos p ON p.id = i.produto_id
                 WHERE i.os_id = os.id AND COALESCE(p.tipo::text, 'produto') <> 'servico')
  HAVING count(*)>0;$new$);

  IF novo = src THEN RAISE EXCEPTION 'bloco os_sem_material_previsto nao encontrado'; END IF;
  EXECUTE novo;
END $patch$;


-- ---------------------------------------- 3. o aviso que faltava: OS sem item
DO $patch$
DECLARE src text; novo text; bloco text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='pendencias_do_sistema';

  IF position('os_sem_item' in src) > 0 THEN RETURN; END IF;

  bloco := $b$
  -- O irmao de `orcamento_sem_item`, um andar adiante e nunca escrito. Uma OS
  -- sem nenhum item nao tem o que produzir, o que prever, o que cobrar nem o
  -- que fechar: `valor_total` fica zero, `fechar_os` nao acha material e o
  -- resultado nasce vazio. Aparece como "OS aberta" no painel e nao e trabalho.
  RETURN QUERY SELECT 'os_sem_item','Ordens de servico sem nenhum item', count(*)::int,
    (SELECT count(*)::int FROM public.ordens_servico WHERE status NOT IN ('concluido','faturado','cancelado')),
    'critico','atendimento',
    'A OS foi aberta e ninguem disse o que produzir. Abra e acrescente os itens, ou cancele se foi engano. Enquanto estiver assim ela conta como trabalho aberto sem ser.','/os'
  FROM public.ordens_servico o
  WHERE o.status NOT IN ('concluido','faturado','cancelado')
    AND NOT EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = o.id)
  HAVING count(*) > 0;

$b$;

  novo := replace(src, E'\n  RETURN QUERY SELECT ''cliente_sem_contato''', bloco || E'\n  RETURN QUERY SELECT ''cliente_sem_contato''');
  IF novo = src THEN RAISE EXCEPTION 'ancora cliente_sem_contato nao encontrada'; END IF;
  EXECUTE novo;
END $patch$;

-- CONFERIDO, no painel vivo:
--   produto_sem_ficha           18 de 31  ->  14 de 25  (serviço fora dos dois lados)
--   os_sem_material_previsto     2 de 2   ->   1 de 2   (só a OS 44, item sem produto)
--   os_sem_item                  (não existia)  1 de 2  (a OS 49, que não tinha aviso)
