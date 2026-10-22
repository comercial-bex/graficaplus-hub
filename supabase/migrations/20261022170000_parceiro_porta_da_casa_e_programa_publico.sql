-- A porta da casa para parceiros e o programa em página pública (22/10/2026).
--
-- Pedido do dono: mandar a john terry e Max Lima o link de cadastro de parceiro,
-- com uma página explicando como funciona e os benefícios, e o login separando
-- equipe de parceiro/terceirizado. Achado: o programa tem 0 parceiros, e o convite
-- só existe a partir de um parceiro ATIVO — a primeira pessoa não tinha por onde
-- entrar. Duas peças:
--
-- 1. Convite da casa (código BEXPRINT): cadastro de parceiro sem padrinho. Nasce
--    `pendente` e sem papel, como todo convite — quem libera é a gráfica, na tela
--    de Parceiros. Sem padrinho não há bônus de indicação.
--    Se o telefone for de um cliente JÁ marcado como revendedor e sem cadastro de
--    parceiro (john terry, Max Lima), o cadastro usa esse cliente em vez de criar
--    um segundo — o histórico de orçamentos dele fica junto.
-- 2. programa_parceiros_publico(): o que a página pública mostra, lido do cadastro
--    do programa (níveis e regras) — o que o dono mudar na tela de Parceiros muda
--    na página, sem texto fixo para envelhecer.

CREATE OR REPLACE FUNCTION public.convite_de_parceiro(p_codigo text)
 RETURNS TABLE(valido boolean, convidado_por text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT true, 'Bex Print'::text WHERE upper(btrim(p_codigo)) = 'BEXPRINT'
  UNION ALL
  SELECT true,
         coalesce(nullif(btrim(p.marca_nome), ''), c.nome, 'um parceiro Bex Print')
  FROM public.parceiros p
  LEFT JOIN public.clientes c ON c.id = p.cliente_id
  WHERE upper(btrim(p_codigo)) = p.codigo_convite AND p.status = 'ativo'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_cadastrar_por_convite(
  p_codigo text, p_usuario_id uuid, p_marca_nome text,
  p_documento text DEFAULT NULL::text, p_telefone text DEFAULT NULL::text, p_email text DEFAULT NULL::text,
  p_cidade text DEFAULT NULL::text, p_estado text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_padrinho public.parceiros%ROWTYPE;
  v_casa boolean := upper(btrim(p_codigo)) = 'BEXPRINT';
  v_criado_em timestamptz;
  v_cliente_id uuid;
  v_parceiro_id uuid;
  v_nome text := nullif(btrim(p_marca_nome), '');
  v_tel text := public.normalize_whatsapp_phone(p_telefone);
  v_achados uuid[];
BEGIN
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da sua empresa' USING ERRCODE = '22023';
  END IF;

  IF NOT v_casa THEN
    SELECT * INTO v_padrinho FROM public.parceiros
    WHERE codigo_convite = upper(btrim(p_codigo)) AND status = 'ativo';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT created_at INTO v_criado_em FROM auth.users WHERE id = p_usuario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = '22023';
  END IF;
  IF v_criado_em < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Esta conta não acabou de ser criada' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.parceiros WHERE usuario_id = p_usuario_id) THEN
    RAISE EXCEPTION 'Esta conta já é de um parceiro' USING ERRCODE = '23505';
  END IF;

  -- Cliente já marcado como revendedor, com este telefone e sem cadastro de
  -- parceiro: é ele (um só; dois com o mesmo número não adivinha).
  IF v_tel IS NOT NULL THEN
    SELECT array_agg(c.id) INTO v_achados
      FROM public.clientes c
     WHERE c.ativo IS NOT FALSE AND c.revendedor
       AND c.telefone_normalizado = v_tel
       AND NOT EXISTS (SELECT 1 FROM public.parceiros pa WHERE pa.cliente_id = c.id);
    IF coalesce(array_length(v_achados, 1), 0) = 1 THEN v_cliente_id := v_achados[1]; END IF;
  END IF;

  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (nome, documento, telefone, email, cidade, estado, origem, ativo, revendedor)
    VALUES (v_nome, nullif(btrim(p_documento), ''), nullif(btrim(p_telefone), ''),
            nullif(btrim(p_email), ''), nullif(btrim(p_cidade), ''), nullif(btrim(p_estado), ''),
            'convite_parceiro', true, true)
    RETURNING id INTO v_cliente_id;
  END IF;

  INSERT INTO public.parceiros (cliente_id, usuario_id, status, marca_nome, marca_documento,
                                marca_telefone, marca_email, marca_cidade, marca_estado,
                                indicado_por, indicado_em)
  VALUES (v_cliente_id, p_usuario_id, 'pendente', v_nome, nullif(btrim(p_documento), ''),
          nullif(btrim(p_telefone), ''), nullif(btrim(p_email), ''), nullif(btrim(p_cidade), ''),
          nullif(btrim(p_estado), ''),
          CASE WHEN v_casa THEN NULL ELSE v_padrinho.id END,
          CASE WHEN v_casa THEN NULL ELSE now() END)
  RETURNING id INTO v_parceiro_id;

  RETURN jsonb_build_object('ok', true, 'parceiro_id', v_parceiro_id,
                            'convidado_por', CASE WHEN v_casa THEN 'Bex Print' ELSE coalesce(v_padrinho.marca_nome, 'Bex Print') END);
END;
$function$;

-- 2. O programa para a página pública ------------------------------------------------
CREATE OR REPLACE FUNCTION public.programa_parceiros_publico()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'niveis', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'nome', n.nome, 'cor', n.cor, 'desconto_pct', n.desconto_pct,
                'compra_minima_90d', n.compra_minima_90d, 'cashback_pct', n.cashback_pct,
                'desconto_faixa_pct', n.desconto_faixa_pct) ORDER BY n.ordem)
              FROM public.parceiro_niveis n), '[]'::jsonb),
    'boas_vindas', (SELECT jsonb_build_object('ativa', p.boas_vindas_ativa, 'pct', p.boas_vindas_pct,
                      'teto', p.boas_vindas_teto, 'validade_dias', p.boas_vindas_validade_dias)
                    FROM public.parceiro_programa p LIMIT 1),
    'indicacao', (SELECT jsonb_build_object('ativa', p.indicacao_ativa, 'pct', p.indicacao_pct,
                    'teto', p.indicacao_teto, 'compras', p.indicacao_compras)
                  FROM public.parceiro_programa p LIMIT 1),
    'credito_max_pct_pedido', (SELECT p.credito_max_pct_pedido FROM public.parceiro_programa p LIMIT 1)
  )
$function$;
COMMENT ON FUNCTION public.programa_parceiros_publico() IS
  'O programa de parceiros para a página pública /seja-parceiro: níveis e regras, sem dado de parceiro nenhum.';
REVOKE ALL ON FUNCTION public.programa_parceiros_publico() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.programa_parceiros_publico() TO anon, authenticated;
