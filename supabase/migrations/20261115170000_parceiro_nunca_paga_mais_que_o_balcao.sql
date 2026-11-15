-- APLICADA em 15/11/2026 no banco vivo (md5 novos 0cb6ca7e... e c84651dc..., ACLs iguais às de antes; ensaiada antes em transação desfeita; provas em docs/ensaio-parceiro-nunca-acima-do-balcao.md).
-- Auditoria que originou esta migração: docs/auditoria-orcamentos-precos-margem-15-11.md.
--
-- O PARCEIRO NUNCA PAGA MAIS QUE O BALCÃO (Bex Print)
--
-- PROBLEMA: `parceiro_precos` calcula o preço do parceiro como GREATEST(preço com desconto do nível, piso da margem mínima), sem teto.
-- Quando o piso (custo / (1 - margem mínima)) fica acima do preço de balcão, o parceiro paga MAIS que o balcão. Hoje são 7 produtos, nos 4 níveis
-- (os 19 parceiros ativos são Bronze): Bolsa térmica 66,67 contra 59,00; Copo térmico 50,00 contra 40,00; Kit Churrasco 12PÇ 113,33 contra 89,00;
-- Necessaire 49,83 contra 39,90; Corte a laser 55,05 contra 52,80; Recorte eletrônico 2,02 contra 1,93; Acabamento manual 40,28 contra 38,40.
--
-- O QUE MUDA: DUAS funções, por troca na definição viva.
--   1. `parceiro_precos(uuid)`: o preço simples (3 usos no corpo) e o preço de cada faixa (2 usos) viram
--      LEAST(GREATEST(com desconto, piso), preço base). Teto = o preço de referência que a própria função devolve (`preco_referencia`).
--   2. `parceiro_simular_niveis(jsonb)`: a simulação que a equipe usa para ver margem por nível repetia a mesma regra (`pago`). Sem o teto ela
--      continuaria mostrando um preço que o parceiro já não paga.
-- `NULLIF(base, 0)`: base zero não vira teto zero (LEAST ignora NULL), então um produto com balcão zerado continua como estava. Hoje não há
-- nenhum (os 10 sem preço têm base NULL e nem entram na lista do parceiro).
--
-- O QUE NÃO MUDA: assinatura, tipo de retorno, SECURITY DEFINER, search_path e ACL das duas funções. Nenhuma outra função, tabela, gatilho,
-- política ou coluna. A ORIGEM `piso` fica como está: o contrato é "o piso da margem limitou o desconto". Quando o balcão já é menor que o piso, o
-- desconto vai a zero, o parceiro paga o balcão e a origem continua `piso` (o nível não deu desconto porque a margem não deixa). Os consumidores
-- (ficha e cartão do produto, `orcamento_precos_parceiro`, `parceiro_catalogo`, `parceiro_enviar_pedido`) só distinguem `nivel` de outro valor
-- ou repassam a origem; nenhum depende de `piso` pagar mais que o balcão. Preço de tabela do produto (`preco_parceiro`, origem `tabela`) e oferta
-- continuam como estavam: hoje nenhum preço de tabela passa do balcão (conferido).
--
-- CONSEQUÊNCIA DE NEGÓCIO (decisão do dono, não desta migração): nesses 7 produtos o parceiro passa a pagar o balcão e a margem da Bex cai de onde o piso
-- a segurava. Em `parceiro_simular_niveis`, a menor margem vai de 39,9%/38,9%/34,9%/30,2% (Bronze a Diamante) para 23,6% em todos os níveis (margem
-- mínima cadastrada é 30%). A saída de verdade é a opção A da auditoria: subir o preço de balcão desses 7 para o piso caber.
--
-- POR TROCA NA DEFINIÇÃO VIVA (lição ler-funcao-viva-nao-migracao): lê o corpo vivo, confere o md5 lido em 15/11/2026, confere quantas vezes cada
-- trecho aparece e troca. Se o corpo vivo for outro, para sem trocar. Se já estiver com o md5 novo, não faz nada. `CREATE OR REPLACE` preserva dono,
-- ACL e search_path; a conferência final confirma e o REVOKE e o GRANT são reaplicados pelo nome, copiando as ACLs vivas.
--
-- COMO DESFAZER: recriar as duas funções com os corpos de 15/11/2026 (md5 aa319b8b5483496d7fefe13600236525 e 4ef7cf3ed9e1e09f1e370812c4527906),
-- guardados em tests/apoio/. O roteiro (docs/ensaio-parceiro-nunca-acima-do-balcao.md, seção 4) traz o bloco de volta.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $troca$
DECLARE
  v_oid_precos oid := to_regprocedure('public.parceiro_precos(uuid)');
  v_oid_sim oid := to_regprocedure('public.parceiro_simular_niveis(jsonb)');
  v_def text;
  v_n integer;
  -- parceiro_precos: preço simples (3 usos no corpo vivo) e preço de faixa (2 usos)
  v_s_velho constant text := $sv$GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0))$sv$;
  v_s_novo constant text := $sn$LEAST(GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0)), NULLIF(b.preco_base, 0))$sn$;
  v_f_velho constant text := $fv$GREATEST(round(f.preco_unitario * (1 - v_desc_faixa / 100), 4), COALESCE(b.piso, 0))$fv$;
  v_f_novo constant text := $fn$LEAST(GREATEST(round(f.preco_unitario * (1 - v_desc_faixa / 100), 4), COALESCE(b.piso, 0)), NULLIF(round(f.preco_unitario, 4), 0))$fn$;
  -- parceiro_simular_niveis: o preço pago que a simulação mostra à equipe
  v_m_velho constant text := $mv$GREATEST(c.com_desconto, c.piso) AS pago$mv$;
  v_m_novo constant text := $mn$LEAST(GREATEST(c.com_desconto, c.piso), NULLIF(c.preco, 0)) AS pago$mn$;
  v_md5_precos_lido constant text := 'aa319b8b5483496d7fefe13600236525';
  v_md5_sim_lido constant text := '4ef7cf3ed9e1e09f1e370812c4527906';
  v_md5_precos_novo constant text := '0cb6ca7ec3250a628c96ba5279b70fd6';
  v_md5_sim_novo constant text := 'c84651dc04c958b4207c6e358075d805';
  v_md5 text;
BEGIN
  IF v_oid_precos IS NULL OR v_oid_sim IS NULL THEN
    RAISE EXCEPTION 'parceiro_precos(uuid) ou parceiro_simular_niveis(jsonb) não existe.';
  END IF;

  -- parceiro_precos ---------------------------------------------------------------------------------------------------
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = v_oid_precos;
  IF v_md5 = v_md5_precos_novo THEN
    RAISE NOTICE 'parceiro_precos já tem o teto do balcão: nada a fazer.';
  ELSE
    IF v_md5 <> v_md5_precos_lido THEN
      RAISE EXCEPTION 'O corpo vivo de parceiro_precos mudou desde 15/11/2026 (md5 lido %): releia o corpo vivo antes de trocar.', v_md5_precos_lido;
    END IF;
    v_def := pg_get_functiondef(v_oid_precos);
    v_n := (length(v_def) - length(replace(v_def, v_s_velho, ''))) / length(v_s_velho);
    IF v_n <> 3 THEN RAISE EXCEPTION 'Esperava o preço simples 3 vezes em parceiro_precos, achei %: nada foi trocado.', v_n; END IF;
    v_n := (length(v_def) - length(replace(v_def, v_f_velho, ''))) / length(v_f_velho);
    IF v_n <> 2 THEN RAISE EXCEPTION 'Esperava o preço de faixa 2 vezes em parceiro_precos, achei %: nada foi trocado.', v_n; END IF;
    EXECUTE replace(replace(v_def, v_s_velho, v_s_novo), v_f_velho, v_f_novo);
  END IF;

  -- parceiro_simular_niveis -------------------------------------------------------------------------------------------
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = v_oid_sim;
  IF v_md5 = v_md5_sim_novo THEN
    RAISE NOTICE 'parceiro_simular_niveis já tem o teto do balcão: nada a fazer.';
  ELSE
    IF v_md5 <> v_md5_sim_lido THEN
      RAISE EXCEPTION 'O corpo vivo de parceiro_simular_niveis mudou desde 15/11/2026 (md5 lido %): releia o corpo vivo antes de trocar.', v_md5_sim_lido;
    END IF;
    v_def := pg_get_functiondef(v_oid_sim);
    v_n := (length(v_def) - length(replace(v_def, v_m_velho, ''))) / length(v_m_velho);
    IF v_n <> 1 THEN RAISE EXCEPTION 'Esperava o preço pago 1 vez em parceiro_simular_niveis, achei %: nada foi trocado.', v_n; END IF;
    EXECUTE replace(v_def, v_m_velho, v_m_novo);
  END IF;
END $troca$;

-- ACLs vivas, reaplicadas pelo nome ---------------------------------------------------------------------------------------------------
-- parceiro_precos: só service_role (o painel do parceiro chega por parceiro_catalogo, que é SECURITY DEFINER).
REVOKE ALL ON FUNCTION public.parceiro_precos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_precos(uuid) TO service_role;
-- parceiro_simular_niveis: authenticated e service_role (a função barra quem não tem `parceiros.manage`).
REVOKE ALL ON FUNCTION public.parceiro_simular_niveis(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_simular_niveis(jsonb) TO authenticated, service_role;

-- Conferência: se algo estiver fora do esperado, desfaz tudo ----------------------------------------------------------------------------
DO $confere$
DECLARE
  v_precos oid := to_regprocedure('public.parceiro_precos(uuid)');
  v_sim oid := to_regprocedure('public.parceiro_simular_niveis(jsonb)');
  v_n integer;
  v_acima integer := 0;
  v_parceiros integer := 0;
  r record;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('parceiro_precos', 'parceiro_simular_niveis');
  IF v_n <> 2 THEN RAISE EXCEPTION 'esperava uma versão de cada função, achei % no total', v_n; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_precos) <> '0cb6ca7ec3250a628c96ba5279b70fd6' THEN
    RAISE EXCEPTION 'o corpo novo de parceiro_precos não tem o md5 do ensaio';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_sim) <> 'c84651dc04c958b4207c6e358075d805' THEN
    RAISE EXCEPTION 'o corpo novo de parceiro_simular_niveis não tem o md5 do ensaio';
  END IF;
  -- ACL: parceiro_precos só service_role; parceiro_simular_niveis authenticated e service_role; nenhuma das duas para anon nem PUBLIC
  IF has_function_privilege('anon', v_precos, 'EXECUTE') OR has_function_privilege('authenticated', v_precos, 'EXECUTE')
     OR has_function_privilege('public', v_precos, 'EXECUTE') OR NOT has_function_privilege('service_role', v_precos, 'EXECUTE') THEN
    RAISE EXCEPTION 'a ACL de parceiro_precos mudou';
  END IF;
  IF has_function_privilege('anon', v_sim, 'EXECUTE') OR has_function_privilege('public', v_sim, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_sim, 'EXECUTE') OR NOT has_function_privilege('service_role', v_sim, 'EXECUTE') THEN
    RAISE EXCEPTION 'a ACL de parceiro_simular_niveis mudou';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (v_precos, v_sim) AND NOT (prosecdef AND proconfig IS NOT NULL AND 'search_path=public' = ANY (proconfig))) THEN
    RAISE EXCEPTION 'o search_path ou o modo de segurança mudou';
  END IF;

  -- o que importa: para cada parceiro ativo, no nível em que ele está agora, nenhum preço (simples ou de faixa) passa do balcão
  FOR r IN SELECT p.id FROM public.parceiros p WHERE p.status::text = 'ativo' LOOP
    v_parceiros := v_parceiros + 1;
    SELECT v_acima + count(*) INTO v_acima FROM public.parceiro_precos(r.id) x
     WHERE (x.faixas IS NULL AND x.preco_parceiro > x.preco_referencia)
        OR (x.faixas IS NOT NULL AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(x.faixas) f
               WHERE (f->>'preco_parceiro')::numeric > (f->>'preco_referencia')::numeric));
  END LOOP;
  IF v_acima <> 0 THEN
    RAISE EXCEPTION 'ainda há % preço(s) de parceiro acima do balcão depois da troca (% parceiros conferidos)', v_acima, v_parceiros;
  END IF;
END $confere$;

COMMIT;
