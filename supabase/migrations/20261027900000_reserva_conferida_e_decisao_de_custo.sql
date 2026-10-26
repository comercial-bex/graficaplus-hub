-- O que ficou pendente das compras na Camaleão (26/10/2026, "resolva o que tem de pendência").
--
-- APLICADA no banco vivo em 26/10/2026 pelo MCP, depois de ensaio com rollback
-- (Cibele, Fernando, Leonardo); conferida: o financeiro vê as 3 reservas.
--
-- 1. RESERVA PAGA SEM NOTA. No sistema da Camaleão, reserva é pedido pago que
--    não virou venda: sem nota. Três estão assim (22426, 22921, 22990 — R$ 3.156,17)
--    e o aviso só aparecia dentro da aba Fornecedores, sem jeito de zerar. Agora:
--    - `conferir_retirada_compra(id, obs)`: quem registra compra marca que o
--      material foi retirado e conferido (data, quem e observação ficam no
--      documento e na auditoria). A reserva continua reserva: a nota, quando
--      vier, é registrada como venda.
--    - `pendencias_do_sistema()` ganha `compra_reserva_sem_conferir` para o
--      financeiro: reserva paga ainda não conferida. Zera quando todas forem
--      conferidas (ou viram venda e a reserva sai com motivo).
-- 2. DECISÃO DE CUSTO. Atualizar o custo de tinta, vinil, lona e perfurado pelo
--    que se paga recalcula pela receita o custo de 19 produtos e apaga o custo
--    digitado neles (gatilhos tg_material_custo_propaga/recompoe_custos). Fica
--    em `decisoes_pendentes` com os números, para o dono decidir na tela.
-- 3. Camaleão: o único endereço público achado (TeleListas, sem confirmação)
--    vai para as observações, não para o campo de endereço.
--
-- Nada aqui mexe em estoque, caixa, custo de material ou preço.

-- 1. Reserva conferida -------------------------------------------------------
ALTER TABLE public.compras_fornecedor
  ADD COLUMN IF NOT EXISTS retirada_conferida_em timestamptz,
  ADD COLUMN IF NOT EXISTS retirada_conferida_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retirada_obs text;

COMMENT ON COLUMN public.compras_fornecedor.retirada_conferida_em IS
  'Reserva paga: quando alguém conferiu que o material foi retirado (a nota pode ainda não ter vindo).';

CREATE OR REPLACE FUNCTION public.conferir_retirada_compra(p_id uuid, p_obs text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_doc record;
BEGIN
  IF NOT (public.has_permission(v_uid, 'pagamentos.create') OR public.has_permission(v_uid, 'compras.create')) THEN
    RAISE EXCEPTION 'Você não pode conferir compra.' USING ERRCODE = '42501';
  END IF;
  SELECT id, tipo, pago, documento, retirada_conferida_em INTO v_doc FROM public.compras_fornecedor WHERE id = p_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Registro de compra não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_doc.tipo <> 'reserva' THEN
    RAISE EXCEPTION 'Só reserva se confere: a % já é %.', v_doc.documento, v_doc.tipo USING ERRCODE = '22023';
  END IF;
  IF NOT v_doc.pago THEN
    RAISE EXCEPTION 'A % ainda não foi paga.', v_doc.documento USING ERRCODE = '22023';
  END IF;
  IF v_doc.retirada_conferida_em IS NOT NULL THEN
    RAISE EXCEPTION 'A % já foi conferida.', v_doc.documento USING ERRCODE = '22023';
  END IF;
  UPDATE public.compras_fornecedor
     SET retirada_conferida_em = now(),
         retirada_conferida_por = v_uid,
         retirada_obs = nullif(btrim(coalesce(p_obs, '')), '')
   WHERE id = p_id;
END
$function$;

COMMENT ON FUNCTION public.conferir_retirada_compra(uuid, text) IS
  'Marca que o material de uma reserva paga foi retirado e conferido. Exige pagamentos.create ou compras.create.';
REVOKE ALL ON FUNCTION public.conferir_retirada_compra(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conferir_retirada_compra(uuid, text) TO authenticated;

-- Aviso no painel do financeiro: entra logo depois de pagamento_acima_da_conta,
-- dentro do bloco de quem vê dinheiro. Lê a função viva (outras sessões também
-- a remendam) e só mexe se a âncora aparecer uma vez.
DO $m$
DECLARE d text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  a text := E'           GROUP BY cr.id, cr.os_id, cr.valor_total HAVING sum(p.valor) > cr.valor_total + 0.01) x HAVING count(*) > 0;\n  END IF;';
  n int;
BEGIN
  IF position('compra_reserva_sem_conferir' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'âncora de pendencias_do_sistema aparece % vezes', n; END IF;
  d := replace(d, a,
       E'           GROUP BY cr.id, cr.os_id, cr.valor_total HAVING sum(p.valor) > cr.valor_total + 0.01) x HAVING count(*) > 0;\n\n'
    || E'    -- Compra paga no fornecedor que ficou como reserva (sem nota) e ninguém conferiu a retirada.\n'
    || E'    RETURN QUERY SELECT ''compra_reserva_sem_conferir'', ''Compras pagas no fornecedor sem nota e sem retirada conferida'', count(*)::int,\n'
    || E'      (SELECT count(*)::int FROM public.compras_fornecedor WHERE tipo = ''reserva''), ''atencao'', ''financeiro'',\n'
    || E'      ''O fornecedor recebeu e a compra ficou como reserva no sistema dele, sem nota. Confira se o material foi retirado e marque em Fornecedores; peça a nota e, quando vier, registre a venda.'',\n'
    || E'      ''/fornecedores''\n'
    || E'    FROM public.compras_fornecedor WHERE tipo = ''reserva'' AND pago AND retirada_conferida_em IS NULL HAVING count(*) > 0;\n  END IF;');
  EXECUTE d;
END $m$;

-- 2. A decisão do custo -------------------------------------------------------
INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe) VALUES
  ('custo_dos_materiais_pelo_que_se_paga',
   'Custo de tinta, vinil, lona e perfurado pelo que a Camaleão cobrou',
   'Pago na Camaleão (jul–set/2026) × custo do cadastro: tinta Jetbest R$ 0,2317/ml × R$ 0,09; vinil branco R$ 6,42 a 7,17/m² (média R$ 6,58) × R$ 9,50; lona 280 R$ 7,25/m² × R$ 9,50; perfurado R$ 6,30/m² × R$ 22,00 (e a bobina comprada é de 1,27 m, o cadastro diz 1,06). Trocar o custo recalcula pela receita o custo de 19 produtos e apaga o custo digitado neles: Adesivo vinil branco impresso R$ 22,00 → 9,21; Adesivo perfurado (one way) R$ 34,00 → 9,38; Lona 280g impressa R$ 18,00 → 10,37; Placa ACM 3mm com adesivo R$ 145,00 → 111,41; a Lona 440 impressa sobe R$ 18,30 → 20,26 pela tinta. O preço de venda não muda; muda o custo e a margem que o orçamento mostra. Os 4.000 ml de tinta lançados em 22/10 entraram a R$ 0,09/ml, o mesmo valor do cadastro, que a tela de entrada usa quando o custo fica em branco.')
ON CONFLICT (chave) DO NOTHING;

-- 3. Camaleão: o endereço achado, como observação ------------------------------
UPDATE public.fornecedores
   SET observacoes = observacoes || ' Endereço achado só no TeleListas, sem confirmação: Camaleão Tintas e Construção, Rua Santos Dumont, 1979, Santa Rita, Macapá - AP.'
 WHERE nome = 'Camaleão Tintas' AND observacoes IS NOT NULL AND position('TeleListas' IN observacoes) = 0;
