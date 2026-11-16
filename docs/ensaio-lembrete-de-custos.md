# Ensaio da migração: lembrete diário de pendências de custo

Migração: `supabase/migrations/20261116110000_lembrete_diario_de_custos.sql`. Estado: **ensaiada no banco vivo em 15/11/2026 e de novo em 16/11/2026 (nesta versão, com a lista própria de feriados, sem INSERT em `whatsapp_feriados`, texto do aviso novo e a função `pendencias_de_custo()` só aqui), as duas vezes desfeita por RAISE EXCEPTION final. NÃO aplicada: a aplicação é feita depois, pelo dono, na ordem 20261116100000, 20261116110000, 20261116120000.** Conferi antes que o executor desfaz tudo, inclusive DDL e pg_cron: criei uma tabela, uma coluna e um job de teste, levantei erro e nenhum dos três existia depois. Depois do ensaio: fila com os mesmos 193 registros, 0 chaves `pendencias_custo`, job `pendencias-de-custo` inexistente, `integridade-orcamentos` ainda em `0 11-21 * * 1-6`, 0 feriados, 0 funções novas, 0 linhas em `logs_auditoria` do lembrete.

O preço de nenhum produto muda (provado no item 12). Nenhuma mensagem sai para ninguém: a migração só cria funções e um job, e não toca em `whatsapp_feriados`. A primeira mensagem sai no primeiro dia de envio (segunda a sábado, fora os feriados da lista do lembrete), às 08:00 de Macapá, se houver pendência.

## Ordem de aplicação

1. `20261116100000` (banco: custo real, parâmetros novos em `custos_tabela`, colunas `confirmado_por` e `confirmado_em`, view `produto_custo_real`). Ela não define mais `pendencias_de_custo()`.
2. Esta, `20261116110000`, dona única de `pendencias_de_custo()`. Aplicar a 100000 e esta juntas: entre as duas a função não existe, e o painel de preços trata a falta como erro visível.
3. `20261116120000` (função `confirmar_custo_fixo` e a permissão `custos.fixos.update`). Troca o gatilho `custos_tabela_log` criado pela 100000.

Esta migração também roda sem a do banco, porque as funções olham o que existe na hora de rodar. Sem a coluna `confirmado_em`, pendente é valor nulo ou zero. Sem a view, o custo do produto sai de `custo_cheio_do_produto`. Mas só depois da do banco a lista sai completa e com a mesma margem da tela `/precos`. O item 1 do ensaio é exatamente esse caso, sem nada da outra frente.

## O que muda em produção ao aplicar

| Item | O que faz | Muda dado? |
| --- | --- | --- |
| Função `_custo_texto_limpo(text)` | Tira parênteses, travessão e seta de nomes do cadastro | Não |
| Função `pendencias_de_custo()` | Devolve `codigo`, `rotulo`, `tipo` de cada pendência. Só `service_role` executa | Não |
| Funções `lembrete_diario_de_custos(boolean, date)` e `_lembrete_custos_enfileirar(...)` | O aviso. Só `service_role` executa a primeira, a segunda é interna | Só enfileira quando o job rodar |
| Job `pendencias-de-custo` | `0 11,13 * * 1-6` UTC, 08:00 e 10:00 em Macapá, segunda a sábado. Nasce ativo | Cria 1 job |
| Job `integridade-orcamentos` | Passa de `0 11-21 * * 1-6` para `20 11-21 * * 1-6`, para não empilhar com o aviso de custo | Muda o minuto de 1 job |
| Feriados do lembrete | Lista dentro de `lembrete_diario_de_custos`: 20/11/2026, 25/12/2026 e 01/01/2027. Não há tabela nova e `whatsapp_feriados` não é lida nem escrita | Não |

Nenhuma tabela nova, nenhuma coluna nova, nenhuma policy nova. Nenhum `UPDATE` ou `DELETE`. Nenhuma escrita em `produtos`.

**Feriado do lembrete não é feriado da triagem.** A tabela `whatsapp_feriados` é a do horário de atendimento do WhatsApp: um feriado nela fecha a triagem no dia. O lembrete de custo não tem esse direito, então a migração não insere nada ali (a versão de 15/11 inseria o 20/11, e isso foi retirado). Os três feriados do lembrete moram numa lista curta dentro da função. Ao virar o ano, acrescentar os do ano novo na mesma lista, em migração própria.

## Quem recebe, e o que as funções leem

- **pendencias_de_custo** tem três fontes, nesta ordem no texto:
  1. Parâmetro de `custos_tabela` dos 9 códigos do contrato: `aluguel_espaco_mensal`, `outros_fixos_admin_mes`, `plotter_horas_mes_reais`, `energia_comercial_tarifa_kwh`, `tinta_consumo_ml_m2`, `plotter_manutencao_mensal`, `plotter_cabecote_custo`, `plotter_cabecote_vida_m2`, `plotter_limpeza_mensal`. Pendente é: não existe ou está desativado, ou valor nulo, ou `confirmado_em` nulo. A causa vai no texto: não cadastrado, sem valor, ou valor provisório.
  2. Material ativo, com custo de compra zerado pela mesma conta do motor de custo (`COALESCE(custo_medio, custo_unitario, 0)`), em uso por produto ativo. Hoje devolve zero: os 10 materiais sem custo estão inativos e só são usados por produtos inativos.
  3. Produto ativo com preço de parceiro abaixo do piso líquido. O preço olhado é o pior do parceiro: preço fixo, preço acima de uma área, e cada faixa de quantidade com o desconto do nível mais alto (nunca abaixo do piso antigo, como `parceiro_precos`). O piso é `custo de produção / (1 menos margem mínima menos taxas)`, com taxas lidas de `custos_tabela` (imposto sobre venda mais metade do cartão, 7,75 por cento hoje), igual a `desconto_avaliar`. O custo é o de produção, sem taxa, para o imposto entrar uma vez só. Entra só produto com preço de parceiro explícito ou faixa; os que seguem o desconto do nível já nascem acima do piso antigo.
- **Grupo da equipe:** `grupo_equipe_destino()`, evento `aviso_grupo_equipe`, com menção de verdade (campo `mencionar`) dos celulares de gestor e financeiro ativos, mais o `@` no texto. Correção em relação ao aviso imediato de 15/11, em que o campo `mencionar` saiu nulo e o `@` era só texto.
- **Privado:** um por gestor ou admin ativo com celular, evento `aviso_gerente_privado` (a trava do despachante só deixa passar esses números). O número vem do cadastro de usuário, sem número escrito no código. Hoje só o Raymison recebe: o admin não tem celular cadastrado, e o resultado traz `sem_celular` para isso aparecer.
- **Fila:** entidade `usuario` com o id real do gestor. `aviso_registro_existe` devolve nulo para `usuario`, então a tela de avisos não marca como órfão.

## Regras do envio

- **Um aviso por dia.** Chave `pendencias_custo:grupo:AAAA-MM-DD` no grupo e `pendencias_custo:privado:<id>:AAAA-MM-DD` no privado.
- **Reenvio sem spam.** A chave seguinte (`:r1`, `:r2`) só nasce se a linha anterior ficou `falhou` ou `cancelado`. Linha `pendente` ou `enviando` não reenvia, porque a fila deixa `pendente` enquanto ainda vai tentar de novo. Máximo de 3 por dia; esgotou, vira WARNING e linha em `logs_auditoria`.
- **Duas rodadas.** 11:00 UTC é a principal. 13:00 UTC só age se a das 08:00 falhou, porque a chave diária barra duplicata.
- **Domingo e os feriados da lista própria do lembrete não enviam.** Sábado envia, porque o aviso é das 08:00. O texto do aviso diz isso: volta todo dia útil e aos sábados, no início do dia.
- **Para sozinho.** Com a lista vazia não envia mais nada, sem desligar o job. Se já houve lembrete depois do último aviso de fim, envia UMA mensagem dizendo que tudo foi atualizado, com chave própria. Se amanhã surgir pendência nova, o lembrete volta sozinho.
- **Limite.** 12 linhas numeradas por mensagem, o resto vira "E mais K pendências".
- **Nunca em silêncio, nem se a lista quebrar.** Se `pendencias_de_custo()` falhar (por exemplo a view `produto_custo_real` sem a coluna `custo_producao`), a rodada não morre calada no cron: vira WARNING, linha `lembrete_diario_falha` com o erro em `logs_auditoria`, e a rodada das 10:00 tenta de novo. Grupo desligado, destino inválido, fila que recusa ou chave esgotada: WARNING e linha `lembrete_diario_falha` em `logs_auditoria`. Cada rodada grava uma linha `lembrete_diario` com o resultado, sem custo em reais.
- **Só o agendamento.** Pessoa logada recebe 42501 (`auth.uid()` preenchido).
- **Interruptor.** O job nasce ativo, a pedido do dono. Para pausar: `SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'pendencias-de-custo'`.

## Sem empilhar na segunda 16/11

Segunda de manhã, em Macapá, saem no mesmo grupo: custo às 08:00, integridade (21 alertas abertos, até 15 avisos mais um resumo) que passa a sair às 08:20, depois o lembrete de operação e o da equipe às 09:00 e os avisos de lead novo. O limite de 12 linhas no custo e o minuto 20 da integridade espaçam as três. O despachante roda a cada 2 minutos.

## Texto do aviso (o que sai hoje, com a lista real do ensaio)

Só percentual e nomes. Sem valor em reais, sem parênteses, sem travessão, sem seta. O texto está num modelo em constante dentro da função, e um teste de arquivo confere que o modelo não tem esses caracteres.

Grupo da equipe, com os celulares de gestor e financeiro como menção (aqui mascarados):

```
Bom dia, gerente e financeiro @55XXXXXXXXXXX @55XXXXXXXXXXX
Pendências de custo da Bex Print, 11 itens. Sem esses números o preço de venda e a margem na tabela de preços ficam errados.
1. Consumo médio de tinta por metro quadrado: sem valor
2. Custo do cabeçote da plotter: sem valor
3. Horas reais de uso da plotter por mês: sem valor
4. Limpeza mensal da plotter: sem valor
5. Manutenção mensal da plotter: sem valor
6. Outros custos fixos da administração: sem valor
7. Tarifa de energia comercial: valor provisório, falta confirmar
8. Vida útil do cabeçote da plotter em metros quadrados: sem valor
9. Preço de parceiro de Adesivo transparente: margem líquida de 22 por cento, o mínimo é 30 por cento
10. Preço de parceiro de CHAVEIRO ACRILICO: margem líquida de 36 por cento, o mínimo é 40 por cento
11. Preço de parceiro de Lona 440g reforçada impressa: margem líquida de 12 por cento, o mínimo é 35 por cento
Gestor e financeiro, preencham e confirmem os números na tela.
Preencher e confirmar na tela de custos fixos: https://bexprint.com.br/custos-producao
Este aviso volta todo dia útil e aos sábados, no início do dia, até a lista zerar.
```

Privado do gerente: a mesma lista, abrindo com `Raymison, bom dia.` e sem menções.

Fim de ciclo: `Bom dia, gerente e financeiro @... As pendências de custo da Bex Print foram todas atualizadas. O lembrete diário parou e volta sozinho se surgir pendência nova.`

Neste ensaio o aluguel entrou como já confirmado (2.000 por mês é decisão do dono) e a energia como provisória, por isso a lista tem 8 parâmetros e não 9. Na lista de 11 itens aparecem só 3 produtos de parceiro, porque o custo veio de `custo_cheio_do_produto`. Com a view `produto_custo_real` do banco, que traz perda, falha e mão de obra novas, a lista pode ganhar o recortado e o banner 280g, como a pesquisa previu. Se esta migração for aplicada antes da do banco, a lista sai mais curta e o piso usa o custo antigo, por isso a ordem de aplicação está no topo.

A frase "Gestor e financeiro, preencham e confirmem os números na tela" vale porque a migração 20261116120000 dá `custos.fixos.update` ao financeiro. Sem ela, a frase antiga mandava o financeiro conferir e informar ao gestor.

## Ensaio no banco vivo

O SQL abaixo roda DEPOIS do corpo da migração (sem BEGIN, SET LOCAL e COMMIT), na mesma transação, e termina com `RAISE EXCEPTION 'ENSAIO OK ...'`: nada fica. Ele simula, só dentro da transação, o que o banco da outra frente cria: as colunas de confirmação, os 9 parâmetros e um substituto da view `produto_custo_real`.

```sql
DO $ensaio$
DECLARE
  v_rel text := '';
  v_admin uuid := '6e6693f1-ea58-42b8-acf6-46fae959566a';
  v_res jsonb; v_n int; v_n0 int; v_n1 int; v_lin text; v_antes text; v_depois text; v_txt text; v_msg text;
  v_chave text;
BEGIN
  SELECT md5(string_agg(p.id::text || COALESCE(p.preco_base, 0) || COALESCE(p.preco_parceiro, 0) || COALESCE(p.preco_parceiro_acima, 0), ',' ORDER BY p.id))
    INTO v_antes FROM public.produtos p;
  SELECT count(*) INTO v_n0 FROM public.notificacoes_fila;
  v_rel := E'\nfila antes: ' || v_n0;

  -- [1] banco como esta hoje, sem confirmado_em e sem a view produto_custo_real
  SELECT count(*) INTO v_n FROM public.pendencias_de_custo();
  v_rel := v_rel || E'\n[1] sem coluna e sem view: pendencias=' || v_n;
  FOR v_lin IN SELECT tipo || ' | ' || rotulo FROM public.pendencias_de_custo() LOOP v_rel := v_rel || E'\n    ' || v_lin; END LOOP;

  -- [2] o que o banco A (20261116100000) cria, so dentro desta transacao
  ALTER TABLE public.custos_tabela ADD COLUMN confirmado_por uuid, ADD COLUMN confirmado_em timestamptz;
  ALTER TABLE public.custos_tabela ALTER COLUMN valor DROP NOT NULL;
  INSERT INTO public.custos_tabela (categoria, codigo, descricao, unidade, valor, ativo, confirmado_em) VALUES
    ('geral', 'aluguel_espaco_mensal', 'Aluguel do espaço', 'mes', 2000, true, now()),
    ('geral', 'outros_fixos_admin_mes', 'Outros fixos', 'mes', NULL, true, NULL),
    ('geral', 'plotter_horas_mes_reais', 'Horas reais', 'h', NULL, true, NULL),
    ('energia', 'energia_comercial_tarifa_kwh', 'Energia comercial', 'kwh', 1.2, true, NULL),
    ('geral', 'tinta_consumo_ml_m2', 'Tinta', 'ml', NULL, true, NULL),
    ('geral', 'plotter_manutencao_mensal', 'Manutenção', 'mes', NULL, true, NULL),
    ('geral', 'plotter_cabecote_custo', 'Cabeçote', 'un', NULL, true, NULL),
    ('geral', 'plotter_cabecote_vida_m2', 'Vida do cabeçote', 'm2', NULL, true, NULL),
    ('geral', 'plotter_limpeza_mensal', 'Limpeza', 'mes', NULL, true, NULL);
  SELECT count(*) INTO v_n FROM public.pendencias_de_custo() WHERE tipo = 'parametro';
  v_rel := v_rel || E'\n[2] com coluna, aluguel confirmado, energia provisoria: parametros pendentes=' || v_n || ' (esperado 8)';
  FOR v_lin IN SELECT rotulo FROM public.pendencias_de_custo() WHERE tipo = 'parametro' LOOP v_rel := v_rel || E'\n    ' || v_lin; END LOOP;

  -- [3] com a view do banco A (aqui um substituto que le o mesmo custo_cheio)
  CREATE VIEW public.produto_custo_real AS
    SELECT p.id AS produto_id, (public.custo_cheio_do_produto(p.id) ->> 'custo_total')::numeric AS custo_producao
      FROM public.produtos p WHERE p.ativo;
  SELECT count(*) INTO v_n FROM public.pendencias_de_custo() WHERE tipo = 'parceiro';
  SELECT count(*) INTO v_n1 FROM public.pendencias_de_custo() WHERE tipo = 'material';
  v_rel := v_rel || E'\n[3] com view: parceiro=' || v_n || ' material=' || v_n1 || ' total=' || (SELECT count(*) FROM public.pendencias_de_custo());
  FOR v_lin IN SELECT rotulo FROM public.pendencias_de_custo() WHERE tipo <> 'parametro' LOOP v_rel := v_rel || E'\n    ' || v_lin; END LOOP;

  -- [4] modo seco: o texto que sairia hoje, e nada na fila
  v_res := public.lembrete_diario_de_custos(false, DATE '2026-11-16');
  v_txt := v_res ->> 'texto_grupo';
  v_rel := v_rel || E'\n[4] SECO dia_util=' || (v_res ->> 'dia_util') || ' pendencias=' || (v_res ->> 'pendencias') || ' grupo_ativo=' || (v_res ->> 'grupo_ativo')
           || ' mencionando=' || (v_res ->> 'mencionando') || ' linhas=' || (v_res ->> 'linhas_no_texto');
  v_rel := v_rel || E'\n--- texto do grupo ---\n' || v_txt || E'\n--- texto privado (exemplo) ---\n' || (v_res ->> 'texto_privado_exemplo') || E'\n--- fim ---';
  v_rel := v_rel || E'\n    texto: parenteses=' || (v_txt ~ '[()]') || ' travessao=' || (v_txt ~ E'[—–]') || ' seta=' || (v_txt ~ E'→|->')
           || ' reais=' || (v_txt ~ 'R\$') || ' digitos_com_virgula=' || (v_txt ~ '[0-9],[0-9]');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    fila depois do seco: ' || v_n || ' (antes ' || v_n0 || ')';
  SELECT count(*) INTO v_n FROM public.logs_auditoria WHERE entidade = 'pendencias_custo';
  v_rel := v_rel || ' logs do lembrete: ' || v_n;

  -- [5] quem pode chamar
  v_rel := v_rel || E'\n[5] anon pendencias=' || has_function_privilege('anon', 'public.pendencias_de_custo()', 'EXECUTE')
           || ' authenticated pendencias=' || has_function_privilege('authenticated', 'public.pendencias_de_custo()', 'EXECUTE')
           || ' service_role pendencias=' || has_function_privilege('service_role', 'public.pendencias_de_custo()', 'EXECUTE')
           || ' anon lembrete=' || has_function_privilege('anon', 'public.lembrete_diario_de_custos(boolean, date)', 'EXECUTE')
           || ' authenticated lembrete=' || has_function_privilege('authenticated', 'public.lembrete_diario_de_custos(boolean, date)', 'EXECUTE')
           || ' service_role lembrete=' || has_function_privilege('service_role', 'public.lembrete_diario_de_custos(boolean, date)', 'EXECUTE');
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.lembrete_diario_de_custos(true, DATE '2026-11-16');
    v_rel := v_rel || E'\n    pessoa logada enfileirou: ERRO, deveria recusar';
  EXCEPTION WHEN insufficient_privilege THEN
    v_rel := v_rel || E'\n    pessoa logada: recusada (42501)';
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- [6] grupo desligado: nao fica em silencio
  UPDATE public.whatsapp_configuracoes SET grupo_equipe_ativo = false WHERE id IS NOT NULL;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-16');
  v_rel := v_rel || E'\n[6] grupo desligado: grupo=' || (v_res ->> 'grupo') || ' falhas=' || (v_res ->> 'falhas')
           || ' log_falha=' || (SELECT count(*) FROM public.logs_auditoria WHERE entidade = 'pendencias_custo' AND acao = 'lembrete_diario_falha')
           || ' privados=' || (v_res ->> 'privados');
  -- o privado de hoje ja entrou; desfaz so a chave do privado para repetir o teste do grupo ligado
  DELETE FROM public.notificacoes_fila WHERE starts_with(idempotency_key, 'pendencias_custo:');
  UPDATE public.whatsapp_configuracoes SET grupo_equipe_ativo = true WHERE id IS NOT NULL;

  -- [7] segunda 16/11, envio de verdade (nesta transacao)
  SELECT count(*) INTO v_n0 FROM public.notificacoes_fila;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-16');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n[7] segunda: fila +' || (v_n - v_n0) || ' grupo=' || (v_res ->> 'grupo') || ' privados=' || (v_res ->> 'privados') || ' sem_celular=' || (v_res ->> 'sem_celular');
  FOR v_lin IN SELECT evento || ' | ' || entidade || ' | ' || left(destinatario, 6) || ' | ' || idempotency_key || ' | mencionar=' || COALESCE((variaveis -> 'mencionar')::text, 'nenhum') || ' | ' || length(variaveis ->> 'texto') || ' letras'
                 FROM public.notificacoes_fila WHERE starts_with(idempotency_key, 'pendencias_custo:') ORDER BY idempotency_key LOOP
    v_rel := v_rel || E'\n    ' || v_lin;
  END LOOP;
  v_n0 := v_n;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-16');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    segunda rodada do mesmo dia (13:00): fila +' || (v_n - v_n0) || ' grupo=' || (v_res ->> 'grupo');
  v_n0 := v_n;
  -- 8h falhou: reforco sai com chave r1, depois r2, depois esgota
  UPDATE public.notificacoes_fila SET status = 'falhou' WHERE idempotency_key = 'pendencias_custo:grupo:2026-11-16';
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-16');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    grupo falhou: fila +' || (v_n - v_n0) || ' grupo=' || (v_res ->> 'grupo') || ' r1=' || EXISTS (SELECT 1 FROM public.notificacoes_fila WHERE idempotency_key = 'pendencias_custo:grupo:2026-11-16:r1');
  v_n0 := v_n;
  UPDATE public.notificacoes_fila SET status = 'cancelado' WHERE idempotency_key = 'pendencias_custo:grupo:2026-11-16:r1';
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-16');
  v_rel := v_rel || E'\n    r1 cancelado: grupo=' || (v_res ->> 'grupo');
  UPDATE public.notificacoes_fila SET status = 'falhou' WHERE idempotency_key = 'pendencias_custo:grupo:2026-11-16:r2';
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-16');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    r2 falhou: grupo=' || (v_res ->> 'grupo') || ' falhas=' || (v_res ->> 'falhas') || ' fila +' || (v_n - v_n0 - 1);
  -- pendente ou enviando nao reenvia
  UPDATE public.notificacoes_fila SET status = 'pendente' WHERE idempotency_key = 'pendencias_custo:grupo:2026-11-16';
  v_n0 := v_n;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-16');
  v_rel := v_rel || E'\n    base voltou a pendente: grupo=' || (v_res ->> 'grupo');

  -- [8] domingo e feriado nao enfileiram; sabado enfileira
  SELECT count(*) INTO v_n0 FROM public.notificacoes_fila;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-22');
  v_rel := v_rel || E'\n[8] domingo 22/11: enviou=' || (v_res ->> 'enviou') || ' motivo=' || (v_res ->> 'motivo');
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-20');
  v_rel := v_rel || E'\n    feriado 20/11: enviou=' || (v_res ->> 'enviou') || ' motivo=' || (v_res ->> 'motivo');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    fila +' || (v_n - v_n0) || ' (esperado 0)';
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-21');
  SELECT count(*) INTO v_n1 FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    sabado 21/11: enviou=' || (v_res ->> 'enviou') || ' fila +' || (v_n1 - v_n);

  -- [9] a lista zera: para sozinho, avisa uma vez, e volta se surgir pendencia
  UPDATE public.custos_tabela SET valor = COALESCE(valor, 1), confirmado_em = now()
   WHERE codigo IN ('aluguel_espaco_mensal','outros_fixos_admin_mes','plotter_horas_mes_reais','energia_comercial_tarifa_kwh','tinta_consumo_ml_m2',
                    'plotter_manutencao_mensal','plotter_cabecote_custo','plotter_cabecote_vida_m2','plotter_limpeza_mensal');
  UPDATE public.produtos SET ativo = false WHERE id IN (SELECT substring(codigo FROM 10)::uuid FROM public.pendencias_de_custo() WHERE tipo = 'parceiro');
  UPDATE public.materiais SET status = 'inativo' WHERE id IN (SELECT substring(codigo FROM 10)::uuid FROM public.pendencias_de_custo() WHERE tipo = 'material');
  SELECT count(*) INTO v_n FROM public.pendencias_de_custo();
  v_rel := v_rel || E'\n[9] tudo confirmado e sem preco abaixo do piso: pendencias=' || v_n || ' (esperado 0)';
  SELECT count(*) INTO v_n0 FROM public.notificacoes_fila;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-17');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    terca 17/11 lista zerada: fim_de_ciclo=' || COALESCE(v_res ->> 'fim_de_ciclo', 'nao') || ' enviou=' || (v_res ->> 'enviou') || ' fila +' || (v_n - v_n0);
  FOR v_lin IN SELECT idempotency_key || ' | ' || (variaveis ->> 'texto') FROM public.notificacoes_fila WHERE starts_with(idempotency_key, 'pendencias_custo:fim:') ORDER BY idempotency_key LOOP
    v_rel := v_rel || E'\n    ' || replace(v_lin, E'\n', ' / ');
  END LOOP;
  v_n0 := v_n;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-18');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    quarta 18/11 ainda zerada: enviou=' || (v_res ->> 'enviou') || ' motivo=' || COALESCE(v_res ->> 'motivo', '-') || ' fila +' || (v_n - v_n0) || ' (esperado 0)';
  UPDATE public.custos_tabela SET valor = NULL, confirmado_em = NULL WHERE codigo = 'tinta_consumo_ml_m2';
  v_n0 := v_n;
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-19');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    quinta 19/11 pendencia nova: enviou=' || (v_res ->> 'enviou') || ' pendencias=' || (v_res ->> 'pendencias') || ' fila +' || (v_n - v_n0);
  v_n0 := v_n;
  UPDATE public.custos_tabela SET valor = 1, confirmado_em = now() WHERE codigo = 'tinta_consumo_ml_m2';
  UPDATE public.notificacoes_fila SET created_at = now() - interval '3 days' WHERE starts_with(idempotency_key, 'pendencias_custo:fim:');
  v_res := public.lembrete_diario_de_custos(true, DATE '2026-11-24');
  SELECT count(*) INTO v_n FROM public.notificacoes_fila;
  v_rel := v_rel || E'\n    terca 24/11 zerou de novo depois de lembrete: fim_de_ciclo=' || COALESCE(v_res ->> 'fim_de_ciclo', 'nao') || ' fila +' || (v_n - v_n0);

  -- [10] limite de linhas
  UPDATE public.custos_tabela SET valor = NULL, confirmado_em = NULL WHERE codigo LIKE 'plotter_%' OR codigo IN ('tinta_consumo_ml_m2','outros_fixos_admin_mes','energia_comercial_tarifa_kwh','aluguel_espaco_mensal');
  UPDATE public.materiais SET status = 'ativo' WHERE COALESCE(custo_medio, custo_unitario, 0) <= 0 AND id IN (SELECT material_id FROM public.produto_materiais);
  UPDATE public.produtos SET ativo = true WHERE id IN (SELECT produto_id FROM public.produto_materiais pm JOIN public.materiais m ON m.id = pm.material_id WHERE COALESCE(m.custo_medio, m.custo_unitario, 0) <= 0);
  v_res := public.lembrete_diario_de_custos(false, DATE '2026-11-25');
  v_rel := v_rel || E'\n[10] muitas pendencias: pendencias=' || (v_res ->> 'pendencias') || ' linhas no texto=' || (v_res ->> 'linhas_no_texto')
           || E'\n     fecho do texto: ' || array_to_string((string_to_array(v_res ->> 'texto_grupo', E'\n'))[array_length(string_to_array(v_res ->> 'texto_grupo', E'\n'), 1) - 5:], ' / ');

  -- [11] agendamento
  FOR v_lin IN SELECT jobname || ' ' || schedule || ' ' || active || ' ' || command FROM cron.job WHERE jobname IN ('pendencias-de-custo', 'integridade-orcamentos', 'whatsapp-despachar', 'lembrete-equipe', 'lembrete-gestao-orcamentos') ORDER BY jobname LOOP
    v_rel := v_rel || E'\n[11] cron: ' || v_lin;
  END LOOP;
  v_rel := v_rel || E'\n     whatsapp_feriados intocada: linhas=' || (SELECT count(*) FROM public.whatsapp_feriados);

  -- [12] preco de produto: intocado (os UPDATE de ativo do [9] e [10] ficam na transacao e sao desfeitos, e nao tocam preco)
  SELECT md5(string_agg(p.id::text || COALESCE(p.preco_base, 0) || COALESCE(p.preco_parceiro, 0) || COALESCE(p.preco_parceiro_acima, 0), ',' ORDER BY p.id))
    INTO v_depois FROM public.produtos p;
  v_rel := v_rel || E'\n[12] precos de produto iguais antes e depois: ' || (v_antes = v_depois);

  RAISE EXCEPTION 'ENSAIO OK%', v_rel;
END
$ensaio$;
```

### Resultado de 15/11/2026

- **[1] Sem nada da outra frente:** 12 pendências, 9 parâmetros "não cadastrado" e 3 produtos de parceiro abaixo do piso: Adesivo transparente (margem líquida 22 contra mínimo 30), Chaveiro acrílico (36 contra 40) e Lona 440g reforçada impressa (12 contra 35). A função não falha sem a coluna nem a view.
- **[2] Com `confirmado_em`:** aluguel confirmado sai da lista, energia com valor e sem confirmação aparece como "valor provisório, falta confirmar", os outros 7 como "sem valor". 8 parâmetros.
- **[3] Com a view:** 3 produtos de parceiro, 0 materiais, 11 no total.
- **[4] Modo seco:** o texto acima, 11 linhas, grupo ativo, dois celulares citados. Sem parênteses, sem travessão, sem seta, sem R$, sem número com vírgula. Fila antes e depois do modo seco: 193 e 193, 0 linhas de log.
- **[5] Acesso:** `anon` e `authenticated` sem EXECUTE nas duas funções, `service_role` com. Pessoa logada (admin) recebe 42501.
- **[6] Grupo desligado:** o grupo volta `sem_destino`, o resultado traz a falha, 1 linha `lembrete_diario_falha` em `logs_auditoria`, e o privado do gerente ainda sai.
- **[7] Segunda 16/11, envio de verdade (desfeito no fim):** fila +2, um aviso de grupo (com `mencionar` preenchido, 1.133 letras) e um privado do Raymison (1.092 letras). Segunda rodada do mesmo dia: +0, `ja_na_fila`. Grupo marcado `falhou`: sai a chave `:r1`. `r1` cancelado: sai a `:r2`. `r2` falhou: `esgotado`, com a falha no resultado. Base de volta a `pendente`: não reenvia.
- **[8] Calendário:** domingo 22/11 e feriado 20/11 não enfileiram nada (fila +0). Sábado 21/11 enfileira 2.
- **[9] Lista zerada:** terça 17/11 manda o aviso de fim, 2 mensagens (grupo e privado). Quarta, ainda zerada: nada (`nada pendente`). Quinta, com uma pendência nova: o lembrete volta, 2 mensagens. Zerou de novo depois de um lembrete: novo aviso de fim, 2 mensagens.
- **[10] Muitas pendências:** 19 pendências, 12 linhas no texto e "E mais 7 pendências".
- **[11] Agendamento:** `pendencias-de-custo 0 11,13 * * 1-6 true`, `integridade-orcamentos 20 11-21 * * 1-6 true`, os de 12:00 UTC e o despachante de 2 em 2 minutos intactos. Nada em `whatsapp_feriados`.
- **[12] Preços de produto** (`preco_base`, `preco_parceiro`, `preco_parceiro_acima`) iguais antes e depois: sim.

### Rodada de 16/11/2026 (versão atual, junto com as outras duas migrações)

Rodada completa das três migrações na ordem, em `docs/ensaio-custos-fixos-financeiro.md`. O que importa para este lembrete, todo desfeito no fim:

- `pendencias_de_custo()` tem uma definição só, a desta migração (traz o rótulo do aluguel e `v_tem_view`). Com a versão antiga da 100000 instalada por cima do banco e esta aplicada depois, o `md5` do corpo volta ao mesmo e a contagem de pendências não muda.
- Modo seco em 16/11 (segunda) e 21/11 (sábado): dia de envio. 20/11, 25/12 e 01/01: feriado, sem envio. 22/11: domingo, sem envio. 02/01/2027 (sábado): envia.
- O texto do grupo traz "Este aviso volta todo dia útil e aos sábados, no início do dia, até a lista zerar." e não traz "8h".
- `whatsapp_feriados`: 0 linhas antes e 0 depois, 20/11/2026 não cadastrado.

## Como desfazer

```sql
DO $volta$
DECLARE v_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pendencias-de-custo') THEN
    PERFORM cron.unschedule('pendencias-de-custo');
  END IF;
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'integridade-orcamentos' AND schedule = '20 11-21 * * 1-6';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '0 11-21 * * 1-6');
  END IF;
END
$volta$;
DROP FUNCTION IF EXISTS public.lembrete_diario_de_custos(boolean, date);
DROP FUNCTION IF EXISTS public._lembrete_custos_enfileirar(text, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.pendencias_de_custo();
DROP FUNCTION IF EXISTS public._custo_texto_limpo(text);
```

Aviso já enfileirado e enviado não volta. Para o lembrete parar sem desfazer nada, é só desativar o job.

## Riscos e decisões que ficam com o dono

0. **Margem mínima vazia ou zero vale 30** na conta do piso, igual a `desconto_avaliar` e à view `produto_custo_real` (corrigido na revisão de 16/11: antes valia 0 e escondia o produto).
0b. **`pendencias_de_custo()` tem uma dona só.** A migração `20261116100000` deixou de defini-la. Se um banco já tiver a versão antiga dela instalada, esta migração a substitui (mesmo nome e mesmas colunas, ensaiado). Os tipos mudam de `material_sem_custo` e `parceiro_abaixo_do_piso` para `material` e `parceiro`; a tela `/precos` só usa `codigo` e `rotulo`.
0c. **A lista de feriados do lembrete tem 3 datas** (20/11/2026, 25/12/2026, 01/01/2027) e não é a da triagem. Depois de 01/01/2027 o lembrete volta a rodar em feriado até alguém acrescentar as datas novas na função.

1. **Feriado do lembrete não mexe na triagem.** Resolvido: a lista é própria e `whatsapp_feriados` não é tocada.
2. **O lembrete nasce ativo.** A primeira mensagem sai no primeiro dia útil depois de aplicar, às 08:00 de Macapá. Para ver o texto antes, chamar `SELECT public.lembrete_diario_de_custos(false)` como `service_role`, que não grava nem enfileira.
3. **Lista que nunca esvazia gera fadiga.** Os 8 parâmetros só zeram quando o gestor preenche e confirma na tela. Entram na lista só coisas que o gestor consegue resolver.
4. **Financeiro grava custo fixo** pela função `confirmar_custo_fixo` (migração 20261116120000). Se essa migração não for aplicada, o botão da tela falha com mensagem clara e o texto do aviso promete uma coisa que o financeiro não consegue fazer.
5. **O admin não tem celular cadastrado**, então não recebe o privado. O resultado de cada rodada mostra `sem_celular`.
6. **Preço de parceiro que oscila por arredondamento** pode mudar o texto de um dia para o outro, mas a chave diária garante um aviso por dia.
7. **Produto de parceiro por faixa usa o desconto do nível mais alto (8 por cento hoje) como pior caso.** O chaveiro acrílico vem da faixa de preço e pode ser ruído, conferir.
8. **A migração depende dos nomes `impostos_venda` e `taxa_cartao` em `custos_tabela`** (6 e 3,5 hoje). Se faltarem, a conta usa 6 e 3,5.
