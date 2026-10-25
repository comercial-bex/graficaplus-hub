-- Pagamento do orçamento com Pix de verdade (25/10/2026).
--
-- 1) empresa_config ganha a chave Pix da casa (tipo + chave). O orçamento monta o "Pix copia e cola" com
--    o valor e manda ao cliente; sem chave cadastrada, a tela avisa onde cadastrar (Dados da empresa).
-- 2) O orçamento pode MARCAR o Pix como recebido (condicao_pagamento.pix_recebido = {valor, em}). Na
--    conversão em OS, esse valor vira baixa das parcelas, da primeira para a última (confirmar_pagamento,
--    forma "pix"), e a marca recebe lancado = true para não lançar duas vezes. Só acontece quando quem
--    converte pode confirmar pagamento (pagamentos.confirm); senão a marca fica e o financeiro dá a baixa.
--    O que passar do total da conta não é lançado e sai como aviso. Acessório: nunca derruba a conversão.
--    Ensaiada com RAISE sobre os 8 aprovados: 7 converteram e lançaram o Pix limitado ao total da conta.
-- Desfazer: DROP das duas colunas; recriar a conversão sem o bloco "Pix já recebido".
ALTER TABLE public.empresa_config ADD COLUMN IF NOT EXISTS pix_tipo text, ADD COLUMN IF NOT EXISTS pix_chave text;
COMMENT ON COLUMN public.empresa_config.pix_chave IS 'Chave Pix da empresa já normalizada (CPF/CNPJ só dígitos, celular com +55, e-mail minúsculo).';

DO $m$
DECLARE d text := pg_get_functiondef('public.converter_orcamento_em_os(uuid,jsonb)'::regprocedure);
  a text := E'  -- A OS nasce com a máquina reservada: é o passo que faltava entre vender\n';
  n int; novo text;
BEGIN
  IF position('pix_recebido' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'âncora aparece % vezes', n; END IF;
  novo := E'  -- Pix já recebido na hora de combinar o pagamento (marcado no orçamento): vira baixa das parcelas, da\n'
    || E'  -- primeira para a última. Só quando quem converte pode confirmar pagamento; senão fica o aviso e o\n'
    || E'  -- financeiro dá a baixa. Acessório: nunca derruba a conversão.\n'
    || E'  IF COALESCE((v_orc.condicao_pagamento->''pix_recebido''->>''valor'')::numeric, 0) > 0\n'
    || E'     AND COALESCE((v_orc.condicao_pagamento->''pix_recebido''->>''lancado'')::boolean, false) = false THEN\n'
    || E'    BEGIN\n'
    || E'      IF public.has_permission(v_uid, ''pagamentos.confirm'') THEN\n'
    || E'        DECLARE v_resto numeric := (v_orc.condicao_pagamento->''pix_recebido''->>''valor'')::numeric; v_p record; v_aplica numeric;\n'
    || E'        BEGIN\n'
    || E'          FOR v_p IN SELECT id, valor FROM public.parcelas_receber WHERE conta_id = v_conta_id ORDER BY parcela LOOP\n'
    || E'            EXIT WHEN v_resto <= 0.009;\n'
    || E'            v_aplica := LEAST(v_resto, v_p.valor);\n'
    || E'            PERFORM public.confirmar_pagamento(v_p.id, v_aplica, ''pix'', 0, COALESCE((v_orc.condicao_pagamento->''pix_recebido''->>''em'')::date, CURRENT_DATE), NULL, ''orcamento'');\n'
    || E'            v_resto := v_resto - v_aplica;\n'
    || E'          END LOOP;\n'
    || E'          IF v_resto > 0.009 THEN RAISE WARNING ''Pix marcado maior que a conta da OS %: sobraram R$ %'', v_os_id, v_resto; END IF;\n'
    || E'        END;\n'
    || E'        UPDATE public.orcamentos SET condicao_pagamento = jsonb_set(condicao_pagamento, ''{pix_recebido,lancado}'', ''true''::jsonb) WHERE id = p_orcamento_id;\n'
    || E'      END IF;\n'
    || E'    EXCEPTION WHEN OTHERS THEN\n'
    || E'      RAISE WARNING ''Não deu para lançar o Pix recebido da OS %: %'', v_os_id, SQLERRM;\n'
    || E'    END;\n'
    || E'  END IF;\n\n' || a;
  EXECUTE replace(d, a, novo);
END $m$;
