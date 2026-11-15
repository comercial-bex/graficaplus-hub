# Ensaio da migração: o parceiro nunca paga mais que o balcão

Migração: `supabase/migrations/20261115170000_parceiro_nunca_paga_mais_que_o_balcao.sql`. Auditoria de origem: `docs/auditoria-orcamentos-precos-margem-15-11.md`. Estado da aplicação: seção 6 (aplicada).

## 1. O que muda em produção ao aplicar

- **Problema.** `parceiro_precos` calcula o preço do parceiro como o maior entre o preço com desconto do nível e o piso da margem mínima, sem teto. Quando o piso passa do preço de balcão, o parceiro paga mais que o balcão. São 7 produtos, nos 4 níveis (os 19 parceiros ativos estão em Bronze): Bolsa térmica 66,67 contra 59,00; Copo térmico 50,00 contra 40,00; Kit Churrasco 12PÇ 113,33 contra 89,00; Necessaire 49,83 contra 39,90; Corte a laser 55,05 contra 52,80; Recorte eletrônico 2,02 contra 1,93; Acabamento manual 40,28 contra 38,40.
- **DUAS funções trocadas, por troca na definição viva** (corpo vivo lido em 15/11/2026, md5 conferido antes de trocar; trecho conferido por contagem):
  - `parceiro_precos(uuid)`: md5 `aa319b8b5483496d7fefe13600236525` para `0cb6ca7ec3250a628c96ba5279b70fd6`. O preço simples (3 usos) e o preço de cada faixa (2 usos) viram `LEAST(GREATEST(com desconto, piso), preço base)`. O teto da faixa é `round(preço unitário, 4)`, o mesmo número que a função devolve como `preco_referencia`.
  - `parceiro_simular_niveis(jsonb)`: md5 `4ef7cf3ed9e1e09f1e370812c4527906` para `c84651dc04c958b4207c6e358075d805`. É a única outra função que repete a regra do piso (o preço `pago` da simulação de níveis). Sem a troca ela mostraria à equipe um preço que o parceiro já não paga.
- **`NULLIF(base, 0)`.** Base zero não vira teto zero, porque `LEAST` ignora NULL. Hoje nenhum produto ativo tem base zero (os 10 sem preço têm base NULL e nem entram na lista do parceiro), então isto só protege o futuro.
- **O que não muda.** Assinatura, retorno, `SECURITY DEFINER`, `search_path` e ACL das duas funções (o ensaio compara a ACL antes e depois). Nenhuma outra função, tabela, gatilho, política ou coluna. Preço de tabela do produto (origem `tabela`) e oferta ficam como estão: hoje nenhum preço de tabela passa do balcão (0 de 7).
- **A origem `piso` fica.** O contrato é "o piso da margem limitou o desconto". Quando o balcão já é menor que o piso, o desconto vai a zero, o parceiro paga o balcão e a origem continua `piso`. Foi conferido no código que ninguém depende do contrário: a ficha e o cartão do produto só distinguem `nivel` de qualquer outro valor; `orcamento_precos_parceiro`, `orcamento_precos_parceiro_interno`, `parceiro_catalogo` e `parceiro_enviar_pedido` só repassam o preço e a origem. Não nasce valor novo de origem, então nenhum tipo no código quebra.
- **Quem chama `parceiro_precos`.** `parceiro_catalogo`, `parceiro_enviar_pedido`, `orcamento_precos_parceiro` e `orcamento_precos_parceiro_interno`, todos pelo mesmo nome e com o mesmo retorno. Pedido já feito não muda: o preço foi gravado no item.
- **Funções que parecem irmãs e NÃO repetem esta regra** (conferido em `pg_proc`): `desconto_avaliar`, `desconto_do_orcamento` e `tg_parceiro_credito_no_total` usam outro piso (custo cheio com taxa, para a alçada do desconto e do crédito); `parceiro_venda_direta` só usa GREATEST para quantidade mínima.

## 2. Consequência de negócio que esta migração não resolve

Nesses 7 produtos o parceiro passa a pagar o balcão, e a Bex perde a folga que o piso segurava. Na simulação de níveis a menor margem da Bex vai de 39,9%, 38,9%, 34,9% e 30,2% (Bronze a Diamante) para 23,6% em todos os níveis; a margem mínima cadastrada é 30%. Esses produtos já vendem abaixo da margem mínima no balcão. A correção de verdade é a opção A da auditoria: subir o preço de balcão dos 7 até o piso caber. Essa é decisão do dono e não está nesta migração.

## 3. O ensaio

O roteiro roda no banco vivo numa transação que termina em `RAISE EXCEPTION`, então nada fica gravado. Escolhe um parceiro ativo sem compras e sem nível fixo, e simula os 4 níveis trocando `nivel_fixo_id` dentro da transação (desfeito junto). Tira a foto de `parceiro_precos` em cada nível ANTES, aplica a troca (o mesmo bloco da migração) e tira a foto DEPOIS. Exige: havia produto acima do balcão antes; nenhum depois, em nenhum nível; toda diferença é correção (depois igual ao balcão onde antes passava dele, mesma origem, mesmas faixas); md5 e ACL esperados. A sequência de `parceiros`/auditoria, se existir, não volta com o rollback; isso é inofensivo.

```sql
DO $antes$
DECLARE
  v_parc uuid;
  v_admin uuid;
  v_n record;
  v_sim_antes jsonb;
BEGIN
  SELECT p.id INTO v_parc FROM public.parceiros p
   WHERE p.status::text = 'ativo' AND p.nivel_fixo_id IS NULL
     AND COALESCE((public.parceiro_nivel(p.id)->>'compras_90d')::numeric, 0) = 0
   ORDER BY p.id LIMIT 1;
  IF v_parc IS NULL THEN RAISE EXCEPTION 'sem parceiro de teste (ativo, sem nível fixo, sem compras)'; END IF;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role::text = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  CREATE TEMP TABLE _snap (fase text, nivel text, produto_id uuid, nome text, preco_ref numeric, preco numeric, origem text, faixas jsonb) ON COMMIT DROP;
  CREATE TEMP TABLE _ctx (parceiro uuid, admin uuid, sim_antes jsonb) ON COMMIT DROP;
  CREATE TEMP TABLE _md5 (fase text, funcao text, md5 text, acl text) ON COMMIT DROP;

  INSERT INTO _md5 SELECT 'antes', p.proname, md5(p.prosrc), p.proacl::text FROM pg_proc p
   WHERE p.oid IN ('public.parceiro_precos(uuid)'::regprocedure, 'public.parceiro_simular_niveis(jsonb)'::regprocedure);
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ordem) INTO v_sim_antes FROM public.parceiro_simular_niveis(NULL) s;

  FOR v_n IN SELECT id, nome FROM public.parceiro_niveis ORDER BY ordem LOOP
    UPDATE public.parceiros SET nivel_fixo_id = v_n.id WHERE id = v_parc;
    IF public.parceiro_nivel(v_parc)->>'nome' <> v_n.nome THEN
      RAISE EXCEPTION 'o parceiro de teste não ficou no nível %', v_n.nome;
    END IF;
    INSERT INTO _snap SELECT 'antes', v_n.nome, r.produto_id, r.nome, r.preco_referencia, r.preco_parceiro, r.origem, r.faixas
      FROM public.parceiro_precos(v_parc) r;
  END LOOP;
  INSERT INTO _ctx VALUES (v_parc, v_admin, v_sim_antes);
END $antes$;

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


DO $relatorio$
DECLARE
  v_parc uuid;
  v_n record;
  v_msg text := '';
  v_sim_antes jsonb;
  v_sim_depois jsonb;
  v_acima_antes integer;
  v_acima_depois integer;
  v_dif_total integer;
  v_dif_nao_correcao integer;
BEGIN
  SELECT parceiro, sim_antes INTO v_parc, v_sim_antes FROM _ctx;
  FOR v_n IN SELECT id, nome FROM public.parceiro_niveis ORDER BY ordem LOOP
    UPDATE public.parceiros SET nivel_fixo_id = v_n.id WHERE id = v_parc;
    INSERT INTO _snap SELECT 'depois', v_n.nome, r.produto_id, r.nome, r.preco_referencia, r.preco_parceiro, r.origem, r.faixas
      FROM public.parceiro_precos(v_parc) r;
  END LOOP;
  INSERT INTO _md5 SELECT 'depois', p.proname, md5(p.prosrc), p.proacl::text FROM pg_proc p
   WHERE p.oid IN ('public.parceiro_precos(uuid)'::regprocedure, 'public.parceiro_simular_niveis(jsonb)'::regprocedure);
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ordem) INTO v_sim_depois FROM public.parceiro_simular_niveis(NULL) s;

  -- preço do parceiro acima do balcão: simples (preço > referência) e de faixa (alguma faixa > sua referência)
  CREATE TEMP TABLE _acima ON COMMIT DROP AS
    SELECT fase, nivel, nome, preco_ref AS balcao, preco AS parceiro FROM _snap WHERE faixas IS NULL AND preco > preco_ref
    UNION ALL
    SELECT s.fase, s.nivel, s.nome || ' (faixa de ' || (f->>'quantidade_minima') || ')', (f->>'preco_referencia')::numeric, (f->>'preco_parceiro')::numeric
      FROM _snap s CROSS JOIN LATERAL jsonb_array_elements(s.faixas) f
     WHERE s.faixas IS NOT NULL AND (f->>'preco_parceiro')::numeric > (f->>'preco_referencia')::numeric;

  v_msg := v_msg || E'\nPARCEIRO DE TESTE: ' || v_parc || E' (os 4 níveis foram simulados por nivel_fixo_id dentro desta transação)';
  v_msg := v_msg || E'\n\nANTES, produtos com preço de parceiro acima do balcão, por nível:';
  FOR v_n IN SELECT nivel, count(*) q FROM _acima WHERE fase = 'antes' GROUP BY nivel ORDER BY 1 LOOP
    v_msg := v_msg || E'\n  ' || v_n.nivel || ': ' || v_n.q;
  END LOOP;
  v_msg := v_msg || E'\nANTES, nível Bronze, produto: balcão contra parceiro:';
  FOR v_n IN SELECT nome, balcao, parceiro FROM _acima WHERE fase = 'antes' AND nivel = 'Bronze' ORDER BY nome LOOP
    v_msg := v_msg || E'\n  ' || v_n.nome || ': ' || v_n.balcao || ' contra ' || v_n.parceiro;
  END LOOP;
  SELECT count(*) INTO v_acima_antes FROM _acima WHERE fase = 'antes';
  SELECT count(*) INTO v_acima_depois FROM _acima WHERE fase = 'depois';
  v_msg := v_msg || E'\n\nDEPOIS, linhas acima do balcão em qualquer nível: ' || v_acima_depois;

  -- diferença antes contra depois, para todo produto e todo nível
  CREATE TEMP TABLE _dif ON COMMIT DROP AS
    SELECT a.nivel, a.nome, a.preco_ref AS balcao, a.preco AS preco_antes, d.preco AS preco_depois, a.origem AS origem_antes, d.origem AS origem_depois,
           a.faixas AS faixas_antes, d.faixas AS faixas_depois, a.preco_ref AS ref_a, d.preco_ref AS ref_d
      FROM _snap a FULL JOIN _snap d ON d.fase = 'depois' AND d.nivel = a.nivel AND d.produto_id = a.produto_id
     WHERE a.fase = 'antes'
       AND (d.produto_id IS NULL OR a.preco IS DISTINCT FROM d.preco OR a.origem IS DISTINCT FROM d.origem OR a.faixas IS DISTINCT FROM d.faixas OR a.preco_ref IS DISTINCT FROM d.preco_ref);
  SELECT count(*) INTO v_dif_total FROM _dif;
  SELECT count(*) INTO v_dif_nao_correcao FROM _dif x
   WHERE NOT (
     (x.faixas_antes IS NULL AND x.faixas_depois IS NULL AND x.ref_a = x.ref_d AND x.origem_antes = x.origem_depois
        AND x.preco_antes > x.balcao AND x.preco_depois = x.balcao)
     OR
     (x.faixas_antes IS NOT NULL AND x.faixas_depois IS NOT NULL AND x.origem_antes = x.origem_depois
        AND jsonb_array_length(x.faixas_antes) = jsonb_array_length(x.faixas_depois)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(x.faixas_antes) WITH ORDINALITY fa(f, i)
            JOIN jsonb_array_elements(x.faixas_depois) WITH ORDINALITY fd(f, i) USING (i)
           WHERE fa.f IS DISTINCT FROM fd.f
             AND NOT ((fa.f->>'preco_parceiro')::numeric > (fa.f->>'preco_referencia')::numeric
                      AND (fd.f->>'preco_parceiro')::numeric = (fd.f->>'preco_referencia')::numeric
                      AND (fa.f - 'preco_parceiro') = (fd.f - 'preco_parceiro')))
        AND x.preco_antes IS NOT DISTINCT FROM x.preco_depois)
   );
  v_msg := v_msg || E'\n\nLINHAS (nível x produto): ' || (SELECT count(*) FROM _snap WHERE fase = 'antes') || ' antes, ' || (SELECT count(*) FROM _snap WHERE fase = 'depois') || ' depois';
  v_msg := v_msg || E'\nDIFERENTES antes contra depois: ' || v_dif_total || '; que NÃO são correção (depois igual ao balcão onde antes passava dele): ' || v_dif_nao_correcao;
  FOR v_n IN SELECT * FROM _dif ORDER BY nivel, nome LOOP
    v_msg := v_msg || E'\n  ' || v_n.nivel || ' | ' || v_n.nome || ' | balcão ' || coalesce(v_n.balcao::text, 'faixas') || ' | antes ' || coalesce(v_n.preco_antes::text, 'faixas')
          || ' | depois ' || coalesce(v_n.preco_depois::text, 'faixas') || ' | origem ' || coalesce(v_n.origem_antes, '-') || ' -> ' || coalesce(v_n.origem_depois, '-');
  END LOOP;

  v_msg := v_msg || E'\n\nMD5 E ACL:';
  FOR v_n IN SELECT a.funcao, a.md5 ma, d.md5 md, a.acl aa, d.acl ad FROM _md5 a JOIN _md5 d ON d.funcao = a.funcao AND d.fase = 'depois' WHERE a.fase = 'antes' ORDER BY 1 LOOP
    v_msg := v_msg || E'\n  ' || v_n.funcao || ': ' || v_n.ma || ' -> ' || v_n.md || '; ACL igual: ' || (v_n.aa = v_n.ad) || ' ' || v_n.ad;
  END LOOP;
  v_msg := v_msg || E'\n\nSIMULAR_NIVEIS antes: ' || v_sim_antes::text || E'\nSIMULAR_NIVEIS depois: ' || v_sim_depois::text;

  IF v_acima_antes = 0 THEN RAISE EXCEPTION E'ENSAIO FALHOU: antes não havia produto acima do balcão.%', v_msg; END IF;
  IF v_acima_depois <> 0 THEN RAISE EXCEPTION E'ENSAIO FALHOU: depois ainda há produto acima do balcão.%', v_msg; END IF;
  IF v_dif_nao_correcao <> 0 THEN RAISE EXCEPTION E'ENSAIO FALHOU: houve diferença que não é correção.%', v_msg; END IF;
  RAISE EXCEPTION E'ENSAIO OK (desfeito de propósito)%', v_msg;
END $relatorio$;
```

## 4. Voltar atrás

Devolve os corpos de 15/11/2026 (md5 `aa319b8b5483496d7fefe13600236525` e `4ef7cf3ed9e1e09f1e370812c4527906`), guardados em `tests/apoio/parceiro-precos-corpo-vivo-15-11.sql.txt` e `tests/apoio/parceiro-simular-niveis-corpo-vivo-15-11.sql.txt`. As ACLs não mudam em nenhum sentido.

```sql
DO $volta$
DECLARE
  v_oid_precos oid := to_regprocedure('public.parceiro_precos(uuid)');
  v_oid_sim oid := to_regprocedure('public.parceiro_simular_niveis(jsonb)');
  v_def text;
  v_n integer;
  -- parceiro_precos: preço simples (3 usos no corpo vivo) e preço de faixa (2 usos)
  v_s_novo constant text := $sv$GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0))$sv$;
  v_s_velho constant text := $sn$LEAST(GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0)), NULLIF(b.preco_base, 0))$sn$;
  v_f_novo constant text := $fv$GREATEST(round(f.preco_unitario * (1 - v_desc_faixa / 100), 4), COALESCE(b.piso, 0))$fv$;
  v_f_velho constant text := $fn$LEAST(GREATEST(round(f.preco_unitario * (1 - v_desc_faixa / 100), 4), COALESCE(b.piso, 0)), NULLIF(round(f.preco_unitario, 4), 0))$fn$;
  -- parceiro_simular_niveis: o preço pago que a simulação mostra à equipe
  v_m_novo constant text := $mv$GREATEST(c.com_desconto, c.piso) AS pago$mv$;
  v_m_velho constant text := $mn$LEAST(GREATEST(c.com_desconto, c.piso), NULLIF(c.preco, 0)) AS pago$mn$;
  v_md5_precos_lido constant text := '0cb6ca7ec3250a628c96ba5279b70fd6';
  v_md5_sim_lido constant text := 'c84651dc04c958b4207c6e358075d805';
  v_md5_precos_novo constant text := 'aa319b8b5483496d7fefe13600236525';
  v_md5_sim_novo constant text := '4ef7cf3ed9e1e09f1e370812c4527906';
  v_md5 text;
BEGIN
  IF v_oid_precos IS NULL OR v_oid_sim IS NULL THEN
    RAISE EXCEPTION 'parceiro_precos(uuid) ou parceiro_simular_niveis(jsonb) não existe.';
  END IF;

  -- parceiro_precos ---------------------------------------------------------------------------------------------------
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = v_oid_precos;
  IF v_md5 = v_md5_precos_novo THEN
    RAISE NOTICE 'parceiro_precos já voltou ao corpo de 15/11/2026: nada a fazer.';
  ELSE
    IF v_md5 <> v_md5_precos_lido THEN
      RAISE EXCEPTION 'O corpo vivo de parceiro_precos mudou desde a troca (md5 lido %): releia o corpo vivo antes de trocar.', v_md5_precos_lido;
    END IF;
    v_def := pg_get_functiondef(v_oid_precos);
    v_n := (length(v_def) - length(replace(v_def, v_s_novo, ''))) / length(v_s_novo);
    IF v_n <> 3 THEN RAISE EXCEPTION 'Esperava o preço simples com teto 3 vezes em parceiro_precos, achei %: nada foi trocado.', v_n; END IF;
    v_n := (length(v_def) - length(replace(v_def, v_f_novo, ''))) / length(v_f_novo);
    IF v_n <> 2 THEN RAISE EXCEPTION 'Esperava o preço de faixa com teto 2 vezes em parceiro_precos, achei %: nada foi trocado.', v_n; END IF;
    EXECUTE replace(replace(v_def, v_s_novo, v_s_velho), v_f_novo, v_f_velho);
  END IF;

  -- parceiro_simular_niveis -------------------------------------------------------------------------------------------
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = v_oid_sim;
  IF v_md5 = v_md5_sim_novo THEN
    RAISE NOTICE 'parceiro_simular_niveis já voltou ao corpo de 15/11/2026: nada a fazer.';
  ELSE
    IF v_md5 <> v_md5_sim_lido THEN
      RAISE EXCEPTION 'O corpo vivo de parceiro_simular_niveis mudou desde a troca (md5 lido %): releia o corpo vivo antes de trocar.', v_md5_sim_lido;
    END IF;
    v_def := pg_get_functiondef(v_oid_sim);
    v_n := (length(v_def) - length(replace(v_def, v_m_novo, ''))) / length(v_m_novo);
    IF v_n <> 1 THEN RAISE EXCEPTION 'Esperava o preço pago com teto 1 vez em parceiro_simular_niveis, achei %: nada foi trocado.', v_n; END IF;
    EXECUTE replace(v_def, v_m_novo, v_m_velho);
  END IF;
END $volta$;
```

## 5. Depois de aplicar

1. Conferir o md5 do corpo vivo das duas funções: `0cb6ca7ec3250a628c96ba5279b70fd6` e `c84651dc04c958b4207c6e358075d805`.
2. Conferir a ACL: `parceiro_precos` só `service_role`; `parceiro_simular_niveis` `authenticated` e `service_role`.
3. Como parceiro de teste, abrir o catálogo e ver Bolsa térmica a 59,00 (e não 66,67).
4. A migração já faz sozinha a conferência de que nenhum dos parceiros ativos vê preço acima do balcão e desfaz tudo se algum vir.

## 6. Resultado do ensaio e estado da aplicação

Ensaio de 15/11/2026, parceiro de teste `0281b55d-d4b5-45e4-8434-4f1e23a08868`:

- ANTES: 7 produtos acima do balcão em cada um dos 4 níveis (Bronze, Prata, Ouro, Diamante), exatamente os 7 da auditoria, com os valores acima (Bronze: 38,40 contra 40,28; 59,00 contra 66,67; 40,00 contra 50,00; 52,80 contra 55,05; 89,00 contra 113,33; 39,90 contra 49,83; 1,93 contra 2,02).
- DEPOIS: 0 linhas acima do balcão em qualquer nível.
- 192 linhas (nível x produto) antes e depois. Diferentes: 28 (7 produtos x 4 níveis), todas correção, **0 que não são correção**. Todo o resto, incluindo as faixas e a origem, ficou idêntico.
- md5: `parceiro_precos` `aa319b8b...` para `0cb6ca7e...`; `parceiro_simular_niveis` `4ef7cf3e...` para `c84651dc...`. ACL igual antes e depois nas duas.
- `parceiro_simular_niveis` depois da troca: menor margem 23,6% nos 4 níveis (antes 39,9; 38,9; 34,9; 30,2) e ganho médio do parceiro de 10,9; 14,1; 17,1; 19,9 (antes 8,7; 11,9; 14,9; 17,7). A coluna `travados_no_piso` não muda (17, 17, 19, 23).
- Os 7 produtos aparecem em todos os níveis porque, neles, o piso passa do balcão mesmo sem desconto.
- A migração inteira (troca, REVOKE e GRANT, conferência) foi ensaiada à parte numa transação desfeita: conferência passou, 19 parceiros ativos, 0 preço acima do balcão. A segunda rodada da troca (reconhecer o md5 novo e não fazer nada) não foi ensaiada no banco; está coberta pelo teste do texto.
- Depois do ensaio, o banco vivo foi relido: md5 antigos, nenhum parceiro com nível fixo.

**Estado: aplicada em 15/11/2026.** Depois de aplicar, o banco vivo foi relido: md5 novos `0cb6ca7ec3250a628c96ba5279b70fd6` e `c84651dc04c958b4207c6e358075d805`, ACLs iguais às de antes (`parceiro_precos` só service_role; `parceiro_simular_niveis` authenticated e service_role), SECURITY DEFINER e search_path intactos. Em transação desfeita, com um parceiro de teste em cada nível: Bronze, Prata, Ouro e Diamante com 48 produtos e 0 acima do balcão.
