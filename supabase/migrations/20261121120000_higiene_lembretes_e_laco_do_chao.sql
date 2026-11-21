-- =====================================================================================================
-- HIGIENE DOS LEMBRETES E O LAÇO DO CHÃO (21/11/2026)
--
-- Duas mudanças pequenas em funções que já rodam todo dia. Nenhuma tabela muda, nenhuma função nova nasce, e as
-- permissões (ACL) das duas funções ficam como estão, porque CREATE OR REPLACE mantém os grants.
--
-- 1) O aviso aos gestores (lembrete_orcamentos_aprovados_sem_os) ignorava quem está inativo.
--    A função manda o resumo diário de orçamentos aprovados sem OS, OS paradas e clientes esperando resposta para
--    TODO usuário com o papel gestor, sem olhar usuarios.ativo. Hoje o único gestor está ativo e ninguém é atingido,
--    mas o dono mandou parar as mensagens de quem ficou inativo (17/11/2026, Léo e Yvens) e esta era a única rotina
--    de aviso a pessoas que não respeitava isso (as outras já filtram: u.ativo IS NOT FALSE). Passa a filtrar.
--
-- 2) O laço do chão: o aviso diário da equipe (lembretes_da_equipe, bloco de operação) ganha um bloco que cobra a OS
--    que está em "Em produção" e que ninguém começou numa máquina.
--    Medido em 20/11/2026: 194 mudanças de etapa no histórico, 79 delas desde 14/11, e 0 apontamentos de máquina
--    desde 14/11 (o último é de 10/11). O quadro e a TV mostram o que alguém clicou, não o que a máquina faz: a OS 235
--    está em produção, atrasada, sem máquina e sem apontamento (as OS 233 e 237 são de impressão 3D e andam por
--    producao_3d_jobs, por isso ficam de fora). O bloco diz quais são e que o caminho é o botão "Começar na máquina" da
--    OS. Fica de fora quem já tem máquina na OS, quem tem apontamento aberto e a OS com job de impressão 3D. Sem nada a
--    cobrar, o bloco não escreve nada, como os outros.
--    O bloco é um sub-bloco com EXCEPTION próprio: se ele falhar um dia, o aviso diário sai como saía antes.
--
-- Como a troca é feita: pg_get_functiondef + replace de um trecho que existe UMA vez só, com o md5 do corpo de hoje
-- conferido antes e o md5 do corpo novo conferido depois. Se o corpo do banco não for o lido (alguém mexeu), para.
--
-- Ensaio no banco vivo, com RAISE EXCEPTION final: docs/ensaio-higiene-lembretes-e-laco-do-chao-21-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $troca$
DECLARE
  c_md5_aprovados_antes constant text := '5a5f75b4abb65cf763a18226107b6581';
  c_md5_equipe_antes    constant text := '5efedcc3af2f1af0ded8f11646f1a07b';
  v_def     text;
  v_novo    text;
  v_n       integer;
  c_ancora_equipe constant text := E'  -- Silêncio quando não há nada: nem "tudo certo" todo dia.\n';
  c_bloco_equipe  constant text := $bloco$  -- 12. OS em produção que ninguém começou numa máquina (laço do chão, 21/11/2026).
  --     "Em produção" sem máquina na OS, sem apontamento aberto e sem job de impressão 3D: a TV mostra a máquina
  --     parada e o tempo de ninguém fica registrado. Sub-bloco com EXCEPTION próprio: se falhar, o resto sai igual.
  BEGIN
    SELECT count(*), 0::numeric,
           string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
      INTO v_qtd, v_total, v_lista
    FROM (
      SELECT row_number() OVER (ORDER BY os.prazo_entrega NULLS LAST, os.numero) AS ordem,
             format('OS #%s · %s · %s · parada em produção há %s', os.numero,
               coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
               left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40),
               public._dias(v_hoje - (os.updated_at AT TIME ZONE 'America/Belem')::date)) AS linha
      FROM public.ordens_servico os
      LEFT JOIN public.clientes c ON c.id = os.cliente_id
      WHERE os.finalidade = 'venda' AND os.status::text = 'em_producao'
        AND os.maquina_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.apontamentos_producao a WHERE a.os_id = os.id AND a.finalizado_em IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j WHERE j.os_id = os.id)
    ) l;
    IF v_qtd > 0 THEN
      v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
        E'Em produção, mas ninguém começou numa máquina: %s.\n%s%s\nAbra a OS e use "Começar na máquina": é assim que a TV e o quadro mostram o que está rodando.',
        v_qtd, v_lista,
        CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
      v_nop := v_nop + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lembretes_da_equipe: o bloco "em produção sem máquina" falhou: %', SQLERRM;
  END;

$bloco$;
  c_filtro_antes constant text := $f$WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'gestor')$f$;
  c_filtro_depois constant text := $f$WHERE u.ativo IS NOT FALSE AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'gestor')$f$;
BEGIN
  -- 1) aviso aos gestores: só quem está ativo
  v_def := pg_get_functiondef('public.lembrete_orcamentos_aprovados_sem_os'::regproc);
  IF md5(v_def) IS DISTINCT FROM c_md5_aprovados_antes THEN
    RAISE EXCEPTION 'lembrete_orcamentos_aprovados_sem_os mudou no banco (md5 %): releia antes de trocar', md5(v_def);
  END IF;
  v_n := (length(v_def) - length(replace(v_def, c_filtro_antes, ''))) / length(c_filtro_antes);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'o filtro de gestor aparece % vezes (esperado 1)', v_n;
  END IF;
  EXECUTE replace(v_def, c_filtro_antes, c_filtro_depois);

  -- 2) aviso da equipe: o bloco do laço do chão, antes do trecho que decide se há o que enviar
  v_def := pg_get_functiondef('public.lembretes_da_equipe'::regproc);
  IF md5(v_def) IS DISTINCT FROM c_md5_equipe_antes THEN
    RAISE EXCEPTION 'lembretes_da_equipe mudou no banco (md5 %): releia antes de trocar', md5(v_def);
  END IF;
  v_n := (length(v_def) - length(replace(v_def, c_ancora_equipe, ''))) / length(c_ancora_equipe);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'a âncora do aviso da equipe aparece % vezes (esperado 1)', v_n;
  END IF;
  v_novo := replace(v_def, c_ancora_equipe, c_bloco_equipe || c_ancora_equipe);
  EXECUTE v_novo;
END
$troca$;

-- ---------------------------------------------------------------------------------------------------
-- Conferência final: corpos novos, permissões como antes (anon sem EXECUTE) e o trecho certo em cada função.
-- ---------------------------------------------------------------------------------------------------
DO $final$
DECLARE
  c_md5_aprovados_depois constant text := '7ed3350d7810cac624fc63a8c61ac1bd';
  c_md5_equipe_depois    constant text := 'c52e2e74fc0b7c543839f2c8c5c63007';
  v_a text := pg_get_functiondef('public.lembrete_orcamentos_aprovados_sem_os'::regproc);
  v_e text := pg_get_functiondef('public.lembretes_da_equipe'::regproc);
BEGIN
  IF position('WHERE u.ativo IS NOT FALSE AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = ''gestor'')' IN v_a) = 0 THEN
    RAISE EXCEPTION 'o aviso aos gestores não ficou com o filtro de ativo';
  END IF;
  IF position('Em produção, mas ninguém começou numa máquina' IN v_e) = 0
     OR position('NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j WHERE j.os_id = os.id)' IN v_e) = 0
     OR position('EXCEPTION WHEN OTHERS THEN' IN v_e) = 0 THEN
    RAISE EXCEPTION 'o aviso da equipe não ficou com o bloco do laço do chão';
  END IF;
  IF md5(v_a) IS DISTINCT FROM c_md5_aprovados_depois THEN
    RAISE EXCEPTION 'corpo de lembrete_orcamentos_aprovados_sem_os diferente do ensaiado (md5 %)', md5(v_a);
  END IF;
  IF md5(v_e) IS DISTINCT FROM c_md5_equipe_depois THEN
    RAISE EXCEPTION 'corpo de lembretes_da_equipe diferente do ensaiado (md5 %)', md5(v_e);
  END IF;
  IF has_function_privilege('anon', 'public.lembrete_orcamentos_aprovados_sem_os()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lembretes_da_equipe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon voltou a poder executar um dos lembretes';
  END IF;
END
$final$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (cole os corpos de antes: md5 5a5f75b4abb65cf763a18226107b6581 e 5efedcc3af2f1af0ded8f11646f1a07b).
-- Aviso aos gestores: trocar "WHERE u.ativo IS NOT FALSE AND EXISTS (" por "WHERE EXISTS (" no corpo vivo.
-- Aviso da equipe: apagar o bloco entre "-- 12. OS em produção que ninguém começou numa máquina" e a linha
-- "-- Silêncio quando não há nada" no corpo vivo. Os dois com pg_get_functiondef + replace + EXECUTE.
-- =====================================================================================================
