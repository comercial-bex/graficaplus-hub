# Ensaio da migração: preços pendentes de aprovação e alerta de integridade dos orçamentos

Migração: `supabase/migrations/20261115180000_precos_pendentes_e_alertas_de_integridade.sql`. Estado: **ensaiada no banco vivo em 15/11/2026, desfeita por RAISE EXCEPTION final, NÃO aplicada.** O preço de nenhum produto muda na migração.

## O que muda em produção ao aplicar

- **Nenhum preço, orçamento ou produto muda.** As 12 propostas nascem `pendente`. Quem aprova é gestor ou admin que vê custo, pela função nova.
- **Tabelas novas, com RLS:** `precos_propostas` (as propostas) e `alertas_integridade` (um registro por achado, com o estado do aviso). Leitura só de quem vê custo e margem (`pode_ver_custo`, o mesmo critério de `custos_tabela`). Nenhuma policy de escrita: só as funções escrevem. Nada para `anon`.
- **View nova** `vw_precos_propostas`, `security_invoker`, para a tela mostrar nome e unidade do produto junto da proposta.
- **Funções novas:** `preco_proposta_aprovar(uuid)`, `preco_proposta_recusar(uuid, text)` (só `authenticated`, com checagem de papel por dentro), `alerta_integridade_orcamentos(boolean)` (`authenticated` para consulta seca e `service_role` para o agendamento), mais três contas pequenas e a detecção `_integridade_achados()` sem acesso de fora.
- **Um job novo do pg_cron:** `integridade-orcamentos`, `0 11-21 * * 1-6` (UTC), ou seja de hora em hora das 8h às 18h de Macapá, de segunda a sábado. Chama a função direto no banco, como os jobs `lembrete-gestao-orcamentos` e `lembrete-equipe`. Nada de função de borda, nada de segredo no cron. O envio usa a fila que já existe (`enfileirar_notificacao`, evento `aviso_grupo_equipe`) e o despachante de 2 minutos que já manda os 41 avisos de grupo.
- **Mensagem ao cliente: nunca.** O destino é só `grupo_equipe_destino()`.

## Preço por conserto, não por baixa de margem

A regra do dono: o preço do produto não baixa a margem mínima, o certo é consertar o preço para a margem mínima caber. As propostas usam a MESMA conta do piso de `parceiro_precos`: `round(custo_medio / (1 - margem_minima / 100), 2)`, custo só de material. As 7 propostas abaixo do piso ficam poucos centavos acima do piso, arredondadas para terminar em 90. As 5 de metro quadrado levam a lona e o adesivo impresso para perto da referência de 70 por metro quadrado do dono.

| Produto | Preço atual | Proposto | Piso | Margem hoje | Margem proposta |
| --- | --- | --- | --- | --- | --- |
| KIT CHURRASCO 12PÇ | 89,00 | 113,90 | 113,33 | 23,6 | 40,3 |
| COPO TERMICO 500ML | 40,00 | 50,90 | 50,00 | 25,0 | 41,1 |
| NECESSAIRE PERSONALIZADA | 39,90 | 49,90 | 49,83 | 25,1 | 40,1 |
| BOLSA TERMICA 30L | 59,00 | 67,90 | 66,67 | 32,2 | 41,1 |
| Acabamento manual (hora) | 38,40 | 40,90 | 40,28 | 37,1 | 40,9 |
| Recorte eletrônico (metro) | 1,93 | 2,10 | 2,02 | 37,3 | 42,4 |
| Corte a laser (hora) | 52,80 | 55,90 | 55,05 | 37,4 | 40,9 |
| Lona para cavalete (m2) | 45,00 | 59,90 | 14,81 | 77,0 | 82,7 |
| Lona 280g impressa (m2) | 45,00 | 59,90 | 15,95 | 77,0 | 82,7 |
| Faixa em lona (m2) | 45,00 | 59,90 | 15,95 | 77,0 | 82,7 |
| Adesivo vinil branco impresso (m2) | 55,00 | 69,90 | 15,35 | 83,3 | 86,8 |
| Adesivo transparente (m2) | 59,90 | 69,90 | 29,71 | 65,3 | 70,2 |

Os números saem do banco vivo na hora da migração (custo, margem mínima, preço atual), não da pesquisa: o ensaio abaixo imprime a lista real.

## Aprovar e recusar

- `preco_proposta_aprovar(p_id)`: exige admin ou gestor que veja custo. Trava a proposta e o produto. Recusa se a proposta não está pendente, se o preço do produto mudou depois da proposta, ou se o preço proposto ficou abaixo do piso de hoje. Grava `produtos.preco_base` com `WHERE id` (o espelho `produto_precos` segue pelo gatilho existente `tg_produtos_sync_precos`, e a leitura de preço do sistema é `COALESCE(produto_precos.preco_base, produtos.preco_base)`), marca quem decidiu e quando, e grava `logs_auditoria` com preço de e preço para, nunca custo. **Não toca em orçamento**: orçamento enviado ou aprovado guarda o preço que levou.
- `preco_proposta_recusar(p_id, p_nota)`: mesma checagem de papel, exige uma nota de pelo menos 3 letras, não mexe em preço.
- Preço por faixa de quantidade (`produto_faixas_preco`) e preço de parceiro fixo não mudam aqui. Decisões em aberto na seção de riscos.

## O alerta de integridade

`alerta_integridade_orcamentos(p_enfileirar boolean DEFAULT false)`. Olha orçamentos em rascunho, enviado e aprovado. Seis tipos de achado:

| Tipo | O que acha | Urgente |
| --- | --- | --- |
| `valor_enviado_mudou` | valor de hoje diferente do valor da versão enviada (da aprovada, quando aprovado) | só se ainda está enviado |
| `orcamento_duplicado` | mesmo cliente (ou lead), mesmos itens, quantidades e preços, em rascunho ou enviado. Um aviso por grupo, no mais novo, citando os números | sim |
| `margem_negativa` e `margem_baixa` | margem pelo custo gravado abaixo de zero, ou abaixo da margem mínima ponderada dos produtos | negativa sempre, baixa só se enviado ou aprovado |
| `custo_fantasma` | custo do item mais de 3 vezes o cadastrado, ou menos de um terço, por área quando o item é vendido por m2 | se enviado ou aprovado |
| `item_aprovado_sem_custo` | orçamento aprovado com item de custo zero e venda maior que zero | não |
| `produto_sem_preco` | produto ativo com preço zero ou nulo e sem faixa de preço | não |

**O texto:** começa com `ATENCAO GERENTE`, cita o gestor pelo telefone (`@5596984079775`, `variaveis.mencionar`), diz o número do orçamento e o nome do cliente, o que está errado e os números, e pede conferir e autorizar agora, com o link da tela. **Só percentual de margem, nunca custo em reais**: o dono pediu a margem no aviso, e o grupo tem gente sem acesso a custo. O custo fantasma diz quantas vezes o custo está fora, e a margem na tela contra a margem com o custo cadastrado.

**Dedupe sem comer o segundo aviso e sem repetir o primeiro:** cada achado tem uma linha aberta em `alertas_integridade` (chave `tipo:orcamento`, índice único parcial). Avisa quando é novo, quando o estado muda (hash do estado: os valores do problema) e quando passam 24 horas sem resolver. A chave da fila leva o id da linha, o hash, o dia de Macapá e o número de reenvios, então um problema novo no mesmo orçamento gera aviso novo e o mesmo problema não se repete na mesma hora.

**Nunca descarta em silêncio:** `enfileirar_notificacao` devolve NULL sem erro quando o grupo está desligado, quando o destino é inválido e quando a chave já existe. A função separa os casos: chave que já existe vira o id existente; o resto grava `aviso_nao_enviado` com o motivo na linha, levanta um WARNING e tenta de novo na hora seguinte. Aviso que a fila marcou como `falhou` ou `cancelado` volta a ser `aviso_nao_enviado` com `reenvios + 1` e é reenfileirado. Aviso que saiu vira `confirmado`. Não existe `EXCEPTION WHEN OTHERS` na função: erro de verdade derruba a rodada e aparece em `cron.job_run_details`.

**Mais de 15 avisos novos:** os não urgentes viram UM aviso-resumo (até 25 linhas, o resto vira contagem). Lembrete de achado não urgente sempre vai no resumo, e só a cada 7 dias (urgente lembra a cada 24 horas). Passou de 15 avisos próprios numa rodada, o excedente também vai no resumo. O estado de margem e de custo fantasma não leva o número que oscila, então editar rascunho não gera aviso novo.

**Quem chama:** o agendamento (sem pessoa logada) enfileira. Uma pessoa só consulta, em modo seco, e só se vê custo; pedir para enfileirar por uma pessoa levanta erro. O modo seco não grava nada. O resumo em jsonb (`modo`, `total_achados`, `urgentes`, `por_tipo`, `plano`, `nao_enviados`, `propostas_de_preco_pendentes` e a lista `achados`, cada um com `vai_em`) é o que a tela vai usar.

## Volume da primeira rodada (medido no banco vivo, modo seco)

16 achados: 6 urgentes e 10 não urgentes. Como 16 passa de 15, a primeira rodada manda **7 avisos**: 6 próprios e 1 resumo com 10 linhas.

- Urgentes: orçamento 227 (valor enviado 57,60, hoje 448,00), orçamento 227 (custo 10 vezes menor que o cadastrado, margem na tela 97 por cento contra 71 por cento), orçamento 69 (margem negativa de menos 40 por cento), orçamento 181 (duplicado do 69), orçamento 115 (enviado por 530,30, hoje 366,00), orçamento 134 (enviado por 210,00, hoje 326,88).
- No resumo: 8 orçamentos aprovados com item sem custo (54, 56, 57, 62, 70, 151, 153, 195), o custo fantasma do 69 (rascunho) e o produto Impressão 3D (serviço) ativo sem preço.
- Fora do aviso por regra: os orçamentos aprovados 146, 191, 192, 204 e 222 não aparecem: a versão 2 deles foi a aprovada e é igual ao valor de hoje. A diferença só existia contra a versão 1, que foi renegociada.
- Depois da primeira rodada, a hora seguinte manda 0 avisos: todos ficam quietos até mudar ou completar 24 horas.

## Ensaio no banco vivo

O SQL abaixo roda DEPOIS do corpo da migração (sem BEGIN e sem COMMIT), na mesma transação, e termina com `RAISE EXCEPTION 'ENSAIO OK ...'`: nada fica. Conferi antes que o executor desfaz tudo: criei uma tabela de teste, levantei erro e a tabela não existia depois.

```sql
DO $ensaio$
DECLARE
  v_rel text := '';
  v_admin uuid := '6e6693f1-ea58-42b8-acf6-46fae959566a';
  v_gestor uuid := 'f18b017b-c8a1-4ed8-8578-792eb4c26e4a';
  v_vend uuid;
  v_res jsonb; v_a jsonb; v_msg text; v_n int; v_n0 int; v_n1 int; v_id uuid;
  v_antes text; v_depois text; v_lin text; v_pb numeric; v_pp numeric; v_st text;
  v_ids jsonb;
BEGIN
  -- foto dos orcamentos antes
  SELECT md5(string_agg(o.id::text || o.valor_total || o.status::text || COALESCE(o.custo_estimado, 0), ',' ORDER BY o.id)) INTO v_antes FROM public.orcamentos o;
  SELECT u.id INTO v_vend FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id = u.id
   WHERE ur.role = 'vendedor' AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u.id AND x.role IN ('admin','gestor','financeiro','estoque'))
   AND u.ativo LIMIT 1;
  v_rel := v_rel || E'\nvendedor de teste: ' || COALESCE(v_vend::text, 'NENHUM');

  -- 1. propostas
  SELECT count(*) INTO v_n FROM public.precos_propostas WHERE status = 'pendente';
  v_rel := v_rel || E'\n[1] pendentes=' || v_n;
  FOR v_lin IN SELECT p.nome || ' ' || pr.preco_atual || '>' || pr.preco_proposto || ' piso ' || COALESCE(pr.piso::text, '-') ||
                      ' margem ' || COALESCE(pr.margem_atual::text, '-') || '>' || COALESCE(pr.margem_proposta::text, '-') || ' ' || pr.origem
                 FROM public.precos_propostas pr JOIN public.produtos p ON p.id = pr.produto_id ORDER BY pr.origem, p.nome LOOP
    v_rel := v_rel || E'\n   ' || v_lin;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.precos_propostas pr JOIN public.produtos p ON p.id = pr.produto_id WHERE pr.preco_atual <> p.preco_base;
  v_rel := v_rel || E'\n   produtos com preco diferente do atual da proposta: ' || v_n;

  -- 2. modo seco
  v_res := public.alerta_integridade_orcamentos(false);
  v_rel := v_rel || E'\n[2] SECO total=' || (v_res->>'total_achados') || ' urgentes=' || (v_res->>'urgentes') || ' porTipo=' || (v_res->>'por_tipo') ||
           ' plano=' || (v_res->>'plano') || ' grupo=' || (v_res->>'grupo_ativo') || ' mencionando=' || (v_res->>'mencionando');
  FOR v_a IN SELECT * FROM jsonb_array_elements(v_res->'achados') LOOP
    v_rel := v_rel || E'\n   ' || (v_a->>'tipo') || ' | orc ' || COALESCE(v_a->>'orcamento', '-') || ' | ' || (v_a->>'cliente') || ' | urg=' || (v_a->>'urgente') ||
             ' | ' || (v_a->>'vai_em') || ' | ' || left(v_a->>'texto', 230);
  END LOOP;
  SELECT count(*) INTO v_n FROM public.alertas_integridade;
  SELECT count(*) INTO v_n0 FROM public.notificacoes_fila WHERE idempotency_key LIKE 'grupo_equipe:integridade:%';
  v_rel := v_rel || E'\n   seco gravou alertas=' || v_n || ' fila=' || v_n0;

  -- 3. quem pode o que
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.precos_propostas;
  v_rel := v_rel || E'\n[3] admin ve propostas=' || v_n;
  SELECT count(*) INTO v_n FROM public.vw_precos_propostas;
  v_rel := v_rel || ' view=' || v_n;
  v_res := public.alerta_integridade_orcamentos(false);
  v_rel := v_rel || ' admin seco ok total=' || (v_res->>'total_achados');
  BEGIN PERFORM public.alerta_integridade_orcamentos(true); v_rel := v_rel || ' ERRO: admin enfileirou';
  EXCEPTION WHEN OTHERS THEN v_rel := v_rel || ' admin enfileirar barrado=' || SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF v_vend IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_vend::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM public.precos_propostas;
    v_rel := v_rel || E'\n    vendedor ve propostas=' || v_n;
    SELECT count(*) INTO v_n FROM public.alertas_integridade;
    v_rel := v_rel || ' alertas=' || v_n;
    BEGIN PERFORM public.alerta_integridade_orcamentos(false); v_rel := v_rel || ' ERRO: vendedor consultou';
    EXCEPTION WHEN OTHERS THEN v_rel := v_rel || ' consulta barrada=' || SQLSTATE; END;
    SELECT id INTO v_id FROM public.precos_propostas LIMIT 1;
    EXECUTE 'RESET ROLE';
    SELECT id INTO v_id FROM public.precos_propostas LIMIT 1;
    PERFORM set_config('request.jwt.claim.sub', v_vend::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN PERFORM public.preco_proposta_aprovar(v_id); v_rel := v_rel || ' ERRO: vendedor aprovou';
    EXCEPTION WHEN OTHERS THEN v_rel := v_rel || ' aprovar barrado=' || SQLSTATE; END;
    BEGIN PERFORM public.preco_proposta_recusar(v_id, 'nao quero'); v_rel := v_rel || ' ERRO: vendedor recusou';
    EXCEPTION WHEN OTHERS THEN v_rel := v_rel || ' recusar barrado=' || SQLSTATE; END;
    EXECUTE 'RESET ROLE';
  END IF;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM count(*) FROM public.precos_propostas; v_rel := v_rel || E'\n    ERRO: anon leu a tabela';
  EXCEPTION WHEN OTHERS THEN v_rel := v_rel || E'\n    anon na tabela barrado=' || SQLSTATE; END;
  BEGIN PERFORM public.alerta_integridade_orcamentos(false); v_rel := v_rel || ' ERRO: anon executou';
  EXCEPTION WHEN OTHERS THEN v_rel := v_rel || ' anon na funcao barrado=' || SQLSTATE; END;
  EXECUTE 'RESET ROLE';

  -- 4. aprovar e recusar de verdade (como admin e como gestor)
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT id INTO v_id FROM public.precos_propostas WHERE produto_id = '1a646e6f-1988-4fda-9a3f-c0284112f9d8' AND status = 'pendente';
  v_res := public.preco_proposta_aprovar(v_id);
  EXECUTE 'RESET ROLE';
  SELECT p.preco_base, pp.preco_base INTO v_pb, v_pp FROM public.produtos p JOIN public.produto_precos pp ON pp.produto_id = p.id WHERE p.id = '1a646e6f-1988-4fda-9a3f-c0284112f9d8';
  SELECT status INTO v_st FROM public.precos_propostas WHERE id = v_id;
  SELECT count(*) INTO v_n FROM public.logs_auditoria WHERE acao = 'preco_proposta_aprovada' AND entidade_id = '1a646e6f-1988-4fda-9a3f-c0284112f9d8';
  v_rel := v_rel || E'\n[4] admin aprovou necessaire: ' || v_res::text || ' produtos.preco_base=' || v_pb || ' espelho=' || v_pp || ' status=' || v_st || ' auditoria=' || v_n;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.preco_proposta_aprovar(v_id);
    v_rel := v_rel || ' ERRO: aprovou duas vezes';
  EXCEPTION WHEN OTHERS THEN v_rel := v_rel || ' segunda vez barrada=' || SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  -- gestor recusa: nota curta barrada, nota boa vale
  SELECT id INTO v_id FROM public.precos_propostas WHERE produto_id = 'fb5b6cd1-3998-41a0-90d3-50f219c909a8' AND status = 'pendente';
  PERFORM set_config('request.jwt.claim.sub', v_gestor::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.preco_proposta_recusar(v_id, ' x '); v_rel := v_rel || E'\n    ERRO: recusou sem nota';
  EXCEPTION WHEN OTHERS THEN v_rel := v_rel || E'\n    gestor recusar sem nota barrado=' || SQLSTATE; END;
  v_res := public.preco_proposta_recusar(v_id, 'Vou rever o custo do copo antes.');
  EXECUTE 'RESET ROLE';
  SELECT preco_base INTO v_pb FROM public.produtos WHERE id = 'fb5b6cd1-3998-41a0-90d3-50f219c909a8';
  v_rel := v_rel || ' gestor recusou: ' || v_res::text || ' preco do copo segue=' || v_pb;
  -- piso: proposta forcada abaixo do piso nao aprova
  SELECT id INTO v_id FROM public.precos_propostas WHERE produto_id = 'c07299b0-a140-4a1f-860b-dfcb2be8d998' AND status = 'pendente';
  UPDATE public.precos_propostas SET preco_proposto = 100 WHERE id = v_id;
  PERFORM set_config('request.jwt.claim.sub', v_gestor::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.preco_proposta_aprovar(v_id); v_rel := v_rel || E'\n    ERRO: aprovou abaixo do piso';
  EXCEPTION WHEN OTHERS THEN v_rel := v_rel || E'\n    abaixo do piso barrado=' || SQLSTATE || ' ' || SQLERRM; END;
  EXECUTE 'RESET ROLE';
  UPDATE public.precos_propostas SET preco_proposto = 113.90 WHERE id = v_id;
  -- preco mudou depois da proposta
  UPDATE public.produtos SET preco_base = 61 WHERE id = '02084c59-cc5e-49c3-b3b5-55d18b2581d0';
  SELECT id INTO v_id FROM public.precos_propostas WHERE produto_id = '02084c59-cc5e-49c3-b3b5-55d18b2581d0' AND status = 'pendente';
  PERFORM set_config('request.jwt.claim.sub', v_gestor::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.preco_proposta_aprovar(v_id); v_rel := v_rel || E'\n    ERRO: aprovou com preco desatualizado';
  EXCEPTION WHEN OTHERS THEN v_rel := v_rel || E'\n    preco desatualizado barrado=' || SQLSTATE; END;
  EXECUTE 'RESET ROLE';

  -- 5. envio de verdade (dentro da transacao, que sera desfeita)
  -- o agendamento roda sem pessoa logada: limpa a identidade simulada
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n0 FROM public.notificacoes_fila WHERE idempotency_key LIKE 'grupo_equipe:integridade:%';
  v_res := public.alerta_integridade_orcamentos(true);
  SELECT count(*) INTO v_n1 FROM public.notificacoes_fila WHERE idempotency_key LIKE 'grupo_equipe:integridade:%';
  v_rel := v_rel || E'\n[5] ENVIANDO: fila antes=' || v_n0 || ' depois=' || v_n1 || ' plano=' || (v_res->>'plano') || ' nao_enviados=' || (v_res->>'nao_enviados');
  SELECT count(*) INTO v_n FROM public.alertas_integridade WHERE status = 'enfileirado';
  v_rel := v_rel || ' alertas enfileirados=' || v_n;
  FOR v_lin IN SELECT f.destinatario || ' | ' || replace(f.variaveis->>'texto', E'\n', ' // ') || ' | mencionar=' || (f.variaveis->>'mencionar') || ' | ' || f.entidade
                 FROM public.notificacoes_fila f WHERE f.idempotency_key LIKE 'grupo_equipe:integridade:%' ORDER BY f.created_at, f.idempotency_key LOOP
    v_rel := v_rel || E'\n   >> ' || left(v_lin, 520);
  END LOOP;
  -- segunda rodada: nada novo
  v_res := public.alerta_integridade_orcamentos(true);
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key LIKE 'grupo_equipe:integridade:%';
  v_rel := v_rel || E'\n    segunda rodada: fila=' || v_n || ' (esperado ' || v_n1 || ') plano=' || (v_res->>'plano');
  -- o problema muda: a versao enviada do 227 passa a outro valor
  UPDATE public.orcamento_versoes SET valor_total = 60 WHERE orcamento_id = (SELECT id FROM public.orcamentos WHERE numero = 227) AND numero_versao = 1;
  v_res := public.alerta_integridade_orcamentos(true);
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key LIKE 'grupo_equipe:integridade:%';
  v_rel := v_rel || E'\n    problema mudou: fila=' || v_n || ' (esperado ' || (v_n1 + 1) || ') plano=' || (v_res->>'plano');
  -- a fila falha: o aviso volta
  UPDATE public.notificacoes_fila SET status = 'falhou' WHERE idempotency_key LIKE 'grupo_equipe:integridade:%' AND variaveis->>'texto' LIKE '%Orçamento 227%' AND status = 'pendente';
  v_res := public.alerta_integridade_orcamentos(true);
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key LIKE 'grupo_equipe:integridade:%';
  SELECT count(*) INTO v_n1 FROM public.alertas_integridade WHERE reenvios > 0;
  v_rel := v_rel || E'\n    fila falhou: fila=' || v_n || ' alertas com reenvio=' || v_n1 || ' plano=' || (v_res->>'plano');
  -- grupo desligado: nao descarta
  UPDATE public.whatsapp_configuracoes SET grupo_equipe_ativo = false WHERE id IS NOT NULL;
  UPDATE public.orcamento_versoes SET valor_total = 61 WHERE orcamento_id = (SELECT id FROM public.orcamentos WHERE numero = 227) AND numero_versao = 1;
  v_res := public.alerta_integridade_orcamentos(true);
  SELECT count(*) INTO v_n FROM public.alertas_integridade WHERE status = 'aviso_nao_enviado';
  v_rel := v_rel || E'\n    grupo desligado: nao_enviados=' || (v_res->>'nao_enviados') || ' alertas aviso_nao_enviado=' || v_n || ' grupo_ativo=' || (v_res->>'grupo_ativo');
  UPDATE public.whatsapp_configuracoes SET grupo_equipe_ativo = true WHERE id IS NOT NULL;
  v_res := public.alerta_integridade_orcamentos(true);
  SELECT count(*) INTO v_n FROM public.alertas_integridade WHERE status = 'aviso_nao_enviado';
  v_rel := v_rel || E'\n    grupo religado: ainda aviso_nao_enviado=' || v_n || ' plano=' || (v_res->>'plano');

  -- 6. nada de orcamento mudou pelas funcoes novas (exceto o que o proprio ensaio mexeu em versoes)
  SELECT md5(string_agg(o.id::text || o.valor_total || o.status::text || COALESCE(o.custo_estimado, 0), ',' ORDER BY o.id)) INTO v_depois FROM public.orcamentos o;
  v_rel := v_rel || E'\n[6] orcamentos iguais antes e depois: ' || (v_antes = v_depois);
  SELECT jobname || ' ' || schedule || ' ' || active INTO v_lin FROM cron.job WHERE jobname = 'integridade-orcamentos';
  v_rel := v_rel || E'\n[7] cron: ' || COALESCE(v_lin, 'NENHUM');

  RAISE EXCEPTION 'ENSAIO OK%', v_rel;
END
$ensaio$;
```

### Resultado de 15/11/2026

- **[1] Propostas:** 12 pendentes, todas com o preço atual igual ao do produto, margens pela conta do piso (lista na seção acima).
- **[2] Modo seco:** 16 achados, nada gravado (0 alertas, 0 na fila), o gestor citado com `5596984079775`.
- **[3] Quem pode o quê:** admin vê 12 propostas e 12 na view; vendedor vê 0 propostas, 0 alertas, e `consulta`, `aprovar` e `recusar` voltam 42501; `anon` não lê a tabela nem executa a função (42501); admin tentando enfileirar recebe 42501.
- **[4] Decidir:** admin aprova a NECESSAIRE: `produtos.preco_base` e o espelho `produto_precos` ficam em 49,90, status `aprovada`, 1 linha de auditoria; aprovar de novo volta 22023. Gestor recusa sem nota (22023) e com nota (ok), o preço do copo segue 40,00. Proposta forçada a 100 (piso 113,33) é barrada com a mensagem do piso; produto cujo preço mudou depois da proposta é barrado.
- **[5] Envio de verdade, desfeito no fim:** fila 0 para 7 (6 próprios, 1 resumo), 16 alertas enfileirados. Segunda rodada: 0 novos, 16 quietos. Valor da versão enviada do 227 muda: exatamente 1 aviso novo. Fila marca 2 avisos do 227 como `falhou`: 2 reenviados com chave nova. Grupo desligado e problema novo: `nao_enviados = 1`, 1 linha `aviso_nao_enviado`. Grupo religado: o aviso sai, 0 pendentes.
- **[6] Orçamentos iguais antes e depois:** sim.
- **[7] Cron:** `integridade-orcamentos 0 11-21 * * 1-6 true`.

## Como desfazer

```sql
DO $volta$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integridade-orcamentos') THEN
    PERFORM cron.unschedule('integridade-orcamentos');
  END IF;
END
$volta$;
DROP FUNCTION IF EXISTS public.alerta_integridade_orcamentos(boolean);
DROP FUNCTION IF EXISTS public._integridade_achados();
DROP FUNCTION IF EXISTS public.preco_proposta_aprovar(uuid);
DROP FUNCTION IF EXISTS public.preco_proposta_recusar(uuid, text);
DROP VIEW IF EXISTS public.vw_precos_propostas;
DROP TABLE IF EXISTS public.alertas_integridade;
DROP TABLE IF EXISTS public.precos_propostas;
DROP FUNCTION IF EXISTS public._preco_piso(numeric, numeric);
DROP FUNCTION IF EXISTS public._preco_margem(numeric, numeric);
DROP FUNCTION IF EXISTS public._integridade_brl(numeric);
```

Preço já aprovado por proposta não volta sozinho: está em `logs_auditoria` (ação `preco_proposta_aprovada`, preço de e para).

## Riscos e decisões que ficam com o dono

1. **O grupo vê a margem em percentual.** Pedido do dono. Se o grupo tem alguém sem acesso a custo, essa pessoa deduz a margem de um orçamento. O custo em reais nunca vai.
2. **Primeira rodada de 7 avisos de uma vez**, e depois um lembrete de 24 horas por achado não resolvido (urgentes um a um, o resto no resumo). Se for demais, o ajuste é o limite de 24 horas ou desligar o job.
3. **Orçamento 227.** A história do dono se confirma em parte: foi enviado por 57,60 e vale 448,00. O que mudou foi a largura de 0,8 para 8,0 (provável erro de digitação, o custo ainda é de 0,64 m2) e o preço por m2 de 90 para 70. O número 40 do dono não aparece nos dados: falta saber o que é.
4. **Orçamento 69 e 181.** São o mesmo pedido. Manter o 181 (custo correto) e apagar o 69 só depois de listar e com OK do dono. Esta migração só avisa, não apaga.
5. **Preços de parceiro fixos** não entram nas propostas. A Lona 280g impressa tem `preco_parceiro` de 26,90, que com o balcão em 59,90 fica 55 por cento abaixo. A Lona 440g tem `preco_parceiro_acima` de 29,90, abaixo do piso de 31,17. Decisão do dono, em outra proposta.
6. **Custo fantasma depende do custo cadastrado de hoje.** Se o custo de um produto mudar muito, orçamento antigo em aberto pode aparecer. A regra de 3 vezes protege da oscilação normal.
7. **Preço por faixa de quantidade não é coberto** por `produtos.preco_base`. Nenhum dos 12 produtos tem faixa hoje.
8. **O texto do cliente.** A mensagem nunca vai a cliente: o único destino é `grupo_equipe_destino()`.
9. **Tipos do TypeScript.** `src/integrations/supabase/types.ts` não foi regenerado: nenhuma tela usa as tabelas novas ainda. A tela de propostas, com as barras coloridas de piso e margem, é o próximo passo e vai precisar dos tipos.
10. **Ordem de publicação:** nada no código usa a migração, então a ordem não importa.
