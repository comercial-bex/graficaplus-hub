-- ============================================================================
-- Onda 6 — higiene: fechar o que ficou aberto
-- ============================================================================
--
-- Varredura das funções SECURITY DEFINER com GRANT para `anon` ou
-- `authenticated` e sem nenhuma checagem de quem chama: 50 no começo, 15 no
-- fim — e as 15 que ficaram têm guarda que a varredura não reconhecia (escopo
-- por parceiro, token de link, `auth.uid()` guardado em variável), conferidas
-- uma a uma.
--
-- O grosso eram funções de GATILHO. No Postgres elas nascem com EXECUTE para
-- PUBLIC, e isso não é detalhe: o gatilho roda pelo dono da tabela, então o
-- GRANT não serve para nada legítimo — serve só para alguém CHAMAR DIRETO. E
-- chamar direto era possível para `tg_comissao_ao_pagar` (paga comissão),
-- `tg_parceiro_cashback` (credita cashback), `tg_parceiro_bonus_indicacao`
-- (bônus de indicação) e `tg_auditar` (escreve no log de auditoria).

-- --------------------------------------- 1. nenhum gatilho é chamável de fora
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
      AND p.proacl IS NOT NULL
      AND p.proacl::text ~ '(anon|authenticated|=X/)'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.assinatura);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'gatilhos fechados: %', n;
END $$;


-- ------------------------------------------- 2. semear cliente sem ter login
-- `vincular_cliente_do_contato` CRIA cliente e altera orçamento, e estava
-- chamável por `anon`: com a chave pública do projeto, qualquer um na internet
-- podia semear a base de clientes passando ids de orçamento.
CREATE OR REPLACE FUNCTION public.vincular_cliente_do_contato(p_orcamento_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_orc public.orcamentos%ROWTYPE; v_cliente_id uuid; v_tel text; v_email text; v_uid uuid;
BEGIN
  v_uid := public.require_permission('orcamentos.update');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id=p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orcamento nao encontrado'; END IF;
  IF v_orc.cliente_id IS NOT NULL THEN RETURN v_orc.cliente_id; END IF;
  IF coalesce(btrim(v_orc.contato_nome),'') = '' THEN
    RAISE EXCEPTION 'Informe o nome do contato ou selecione um cliente para converter este orcamento';
  END IF;

  v_tel := public.normalize_whatsapp_phone(v_orc.contato_telefone);
  v_email := lower(nullif(btrim(v_orc.contato_email),''));

  IF v_tel IS NOT NULL AND v_tel <> '' THEN
    SELECT id INTO v_cliente_id FROM public.clientes
     WHERE telefone_normalizado = v_tel ORDER BY created_at LIMIT 1;
  END IF;
  IF v_cliente_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_cliente_id FROM public.clientes
     WHERE lower(email)=v_email ORDER BY created_at LIMIT 1;
  END IF;
  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (nome, tipo, telefone, email, origem, vendedor_id, created_by)
    VALUES (btrim(v_orc.contato_nome), 'pf', nullif(btrim(v_orc.contato_telefone),''),
            v_email, 'orcamento_avulso', v_orc.vendedor_id, coalesce(v_orc.created_by, v_uid))
    RETURNING id INTO v_cliente_id;
  END IF;

  UPDATE public.orcamentos SET cliente_id=v_cliente_id WHERE id=p_orcamento_id;
  RETURN v_cliente_id;
END $f$;

REVOKE ALL ON FUNCTION public.vincular_cliente_do_contato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_cliente_do_contato(uuid) TO authenticated;

-- Estado de usuário não é assunto de quem não tem login. Conferido antes: não
-- há policy que dependa desta função.
REVOKE ALL ON FUNCTION public.usuario_desativado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_desativado(uuid) TO authenticated;


-- ------------------------------- 3. expirar crédito do parceiro do vizinho
-- Escreve crédito NEGATIVO na carteira. Estava chamável por qualquer
-- autenticado e, com `p_parceiro_id` nulo, varria TODOS os parceiros: um
-- parceiro podia mandar expirar o crédito de um concorrente.
--
-- Duas portas legítimas, e só duas: a casa (rotina, varredura geral) e o
-- próprio parceiro ao abrir o painel. Esta segunda importa: `parceiro_painel`
-- chama esta função com o próprio id, e exigir `parceiros.manage` sem exceção
-- quebraria o portal inteiro — que é justamente de quem NÃO tem essa
-- permissão. Ensaiado nos dois sentidos.
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='parceiro_expirar_creditos';

  IF position('require_permission' in src) > 0 THEN RETURN; END IF;

  novo := replace(src,
    $old$  v_n integer := 0; v_total numeric := 0;
BEGIN$old$,
    $new$  v_n integer := 0; v_total numeric := 0;
BEGIN
  IF NOT (p_parceiro_id IS NOT NULL AND p_parceiro_id = public.parceiro_do_usuario()) THEN
    PERFORM public.require_permission('parceiros.manage');
  END IF;$new$);

  IF novo = src THEN RAISE EXCEPTION 'cabecalho de parceiro_expirar_creditos nao encontrado'; END IF;
  EXECUTE novo;
END $patch$;


-- ------------------------------------------------ 4. preço para quem vê preço
-- `preco_da_faixa` devolve preço de venda por faixa de quantidade, e estava
-- aberta a qualquer autenticado. Preço é do nível comercial para cima: o
-- operacional não vê valor em lugar nenhum do sistema, e esta função era a
-- porta aberta. `LANGUAGE sql` não tem IF, então o corpo vira uma função
-- interna sem GRANT e a pública passa a ser o porteiro.
CREATE OR REPLACE FUNCTION public.preco_da_faixa_interno(p_produto_id uuid, p_quantidade integer)
RETURNS TABLE (
  preco_unitario numeric, preco_m2_referencia numeric, quantidade_minima integer,
  proxima_faixa integer, economia_na_proxima numeric, vigencia_fim date, dias_para_vencer integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  with faixa as (
    select f.preco_unitario, f.preco_m2_referencia, f.quantidade_minima, f.vigencia_fim
    from public.produto_faixas_preco f
    where f.produto_id = p_produto_id
      and f.quantidade_minima <= p_quantidade
    order by f.quantidade_minima desc
    limit 1
  ),
  seguinte as (
    select f.quantidade_minima, f.preco_unitario
    from public.produto_faixas_preco f
    where f.produto_id = p_produto_id
      and f.quantidade_minima > p_quantidade
    order by f.quantidade_minima asc
    limit 1
  )
  select faixa.preco_unitario,
         faixa.preco_m2_referencia,
         faixa.quantidade_minima,
         seguinte.quantidade_minima,
         case when seguinte.preco_unitario is not null
              then round((faixa.preco_unitario - seguinte.preco_unitario) * seguinte.quantidade_minima, 2)
         end,
         faixa.vigencia_fim,
         case when faixa.vigencia_fim is not null
              then (faixa.vigencia_fim - current_date)::integer
         end
  from faixa left join seguinte on true;
$$;

CREATE OR REPLACE FUNCTION public.preco_da_faixa(p_produto_id uuid, p_quantidade integer)
RETURNS TABLE(preco_unitario numeric, preco_m2_referencia numeric, quantidade_minima integer,
              proxima_faixa integer, economia_na_proxima numeric, vigencia_fim date,
              dias_para_vencer integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF NOT public.can_see_prices(auth.uid()) THEN
    RAISE EXCEPTION 'Preco de venda nao e do seu perfil.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.preco_da_faixa_interno(p_produto_id, p_quantidade);
END $f$;

REVOKE ALL ON FUNCTION public.preco_da_faixa_interno(uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preco_da_faixa(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preco_da_faixa(uuid,integer) TO authenticated;


-- ------------------------------------------ 5. previsão de material é interna
-- `gerar_materiais_previstos_os` escreve previsão de material para QUALQUER
-- OS. Quem chama são dois gatilhos e `converter_orcamento_em_os`, todos
-- DEFINER e todos com guarda própria — nenhum caminho legítimo depende do
-- GRANT direto. Tirar o GRANT, e não adicionar guarda, é o corte certo: a
-- função continua interna e não ganha uma checagem que os gatilhos teriam de
-- driblar.
REVOKE ALL ON FUNCTION public.gerar_materiais_previstos_os(uuid) FROM PUBLIC, anon, authenticated;

-- ENSAIADO, com reversão:
--   parceiro expirando o proprio credito       -> ok
--   painel do parceiro                         -> continua abrindo
--   parceiro pedindo varredura geral           -> "Permissao necessaria: parceiros.manage"
--   a casa pedindo varredura geral             -> ok
--   preco_da_faixa como comercial              -> devolve a faixa, com preco e proxima faixa
--   preco_da_faixa como operacional            -> "Preco de venda nao e do seu perfil."
-- E fumaca em dez RPC de tela, nos tres perfis: nenhuma quebrou.
--
-- O QUE FICOU ABERTO DE PROPOSITO, conferido um a um:
--   abrir_aprovacao, registrar_decisao_aprovacao, arquivo_em_aprovacao_aberta,
--   convite_de_parceiro, parceiro_cadastrar_por_convite  -> o segredo e o token
--     ou o codigo do convite; `parceiro_cadastrar_por_convite` ainda exige que
--     a conta tenha nascido ha menos de 15 minutos.
--   parceiro_*  -> escopo por `parceiro_do_usuario()`, que recusa quem nao e
--     parceiro ativo.
--   minhas_comissoes  -> filtra por `auth.uid()` em todas as somas.
--   os demais  -> leitura de estado operacional da OS, que todo staff ve.
