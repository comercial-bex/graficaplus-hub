-- Onda 1 do plano orçamento→OS (26/10/2026): aprovou pelo link, vira OS.
--
-- Os 8 orçamentos aprovados pelo cliente ficaram 13 a 28 dias parados: o lembrete das 9h
-- ia ao gestor todo dia e ninguém convertia. A conversão passa a rodar sozinha logo depois
-- da aprovação pelo link, quando o pedido está completo (cliente, itens e valor). Se a
-- conversão recusar (desconto sem aprovação, valor mudado, etc.), a aprovação fica como
-- está e o lembrete diário continua cobrando: nada é perdido nem forçado.
--
-- Chave de desligar: custos_tabela.codigo = 'converter_sozinho_ao_aprovar' (valor 0 desliga).
-- Autor da OS: o admin do sistema; o histórico mostra "convertido automaticamente".

INSERT INTO public.custos_tabela (categoria, codigo, descricao, valor, unidade, ativo)
SELECT 'chave', 'converter_sozinho_ao_aprovar', 'Converter em OS sozinho quando o cliente aprova pelo link (1 liga, 0 desliga)', 1, 'chave', true
WHERE NOT EXISTS (SELECT 1 FROM public.custos_tabela WHERE codigo = 'converter_sozinho_ao_aprovar');

CREATE OR REPLACE FUNCTION public.converter_aprovado_pelo_cliente(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
  v_ator uuid;
  v_res jsonb;
BEGIN
  IF COALESCE((SELECT max(valor) FROM public.custos_tabela WHERE ativo AND codigo = 'converter_sozinho_ao_aprovar'), 1) <= 0 THEN
    RETURN jsonb_build_object('convertido', false, 'motivo', 'desligado');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('convertido', false, 'motivo', 'não encontrado'); END IF;
  IF v_orc.status::text <> 'aprovado' OR v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('convertido', false, 'motivo', 'não está aprovado sem OS');
  END IF;
  IF v_orc.cliente_id IS NULL OR COALESCE(v_orc.valor_total, 0) <= 0
     OR NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id = p_orcamento_id) THEN
    RETURN jsonb_build_object('convertido', false, 'motivo', 'pedido incompleto: falta cliente, itens ou valor');
  END IF;

  SELECT user_id INTO v_ator FROM public.user_roles WHERE role = 'admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_ator IS NULL THEN RETURN jsonb_build_object('convertido', false, 'motivo', 'sem admin'); END IF;

  -- A conversão confere permissão por auth.uid(); aqui quem age é o sistema, com o admin.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ator, 'role', 'authenticated')::text, true);
  BEGIN
    v_res := public.converter_orcamento_em_os(p_orcamento_id, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('convertido', false, 'motivo', SQLERRM);
  END;

  INSERT INTO public.eventos_negocio(entidade, entidade_id, cliente_id, tipo, titulo, descricao, usuario_id)
  VALUES ('orcamento', p_orcamento_id, v_orc.cliente_id, 'orcamento_convertido_automatico',
          'OS criada automaticamente', 'O cliente aprovou pelo link e o pedido estava completo.', v_ator);
  RETURN jsonb_build_object('convertido', true, 'os_id', v_res->>'os_id');
END
$function$;

REVOKE ALL ON FUNCTION public.converter_aprovado_pelo_cliente(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.converter_aprovado_pelo_cliente(uuid) TO service_role;

COMMENT ON FUNCTION public.converter_aprovado_pelo_cliente(uuid) IS 'Chamada só pelo servidor depois da aprovação pelo link: converte em OS quando o pedido está completo. Nunca lança: devolve o motivo.';
