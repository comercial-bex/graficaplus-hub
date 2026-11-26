-- ============================================================================
-- Chaves estrangeiras de endurecimento (Onda 2 do diagnóstico de 23/11/2026, 26/11/2026).
--
-- Seis colunas já guardam o id de outra tabela, todas SEM chave estrangeira. Em 26/11/2026 nenhuma tinha valor órfão
-- (conferido no banco vivo, linha a linha). Sem a chave, o banco não impede o próximo órfão: apagar a conversa, a OS ou o aviso
-- deixaria o id pendurado e a tela mostraria um vínculo que não existe mais ("a tela afirma o que o banco não tem").
--
--   coluna                                     aponta para            valores / órfãos   ao apagar o pai
--   orcamentos.conversa_id                     whatsapp_conversas     88 / 0             SET NULL (o orçamento fica)
--   arquivos.conversa_id                       whatsapp_conversas     789 / 0            SET NULL (o arquivo fica)
--   parceiro_orcamentos.os_id                  ordens_servico         0 / 0              SET NULL (mesmo que orcamentos.os_id)
--   whatsapp_atendimentos.responsavel_id       usuarios               198 / 0            SET NULL (mesmo que whatsapp_conversas.responsavel_id)
--   whatsapp_conversa_leituras.user_id         usuarios               565 / 0            CASCADE (NOT NULL e parte da chave primária: leitura de quem saiu não serve)
--   alertas_integridade.fila_id                notificacoes_fila      23 / 0             SET NULL (o alerta é histórico; a fila pode ser limpa)
--
-- Só essas seis. NENHUMA chave em coluna polimórfica (`tasks.current_action_owner_id` e parentes: o tipo ao lado diz de qual
-- tabela o id vem). Cada uma das seis foi conferida: aponta sempre para a mesma tabela, e as colunas irmãs já têm a chave
-- equivalente (`whatsapp_conversas.responsavel_id` e `atribuido_para` para `usuarios`, `orcamentos.os_id` para `ordens_servico`).
--
-- Conferido antes de escrever:
--   * nenhuma função, rotina agendada ou gatilho apaga linhas de `whatsapp_conversas`, `ordens_servico`, `notificacoes_fila` ou
--     `usuarios`, nem faz TRUNCATE nelas; a chave só passa a valer para o dia em que alguém apagar à mão;
--   * nenhuma consulta embutida do PostgREST (`tabela(...)` dentro de `.select`) usa estes pares de tabelas, então a chave nova não
--     deixa nenhuma consulta ambígua;
--   * todo usuário de `auth.users` (25) tem linha em `usuarios` (25), e `whatsapp_marcar_lida` só grava a leitura de quem tem
--     permissão, ou seja, de quem existe em `usuarios`: a chave de `user_id` não cria um erro novo na hora de abrir a conversa.
--
-- As tabelas têm poucas linhas (a maior, `arquivos`, 789), então validar custa milissegundos; `lock_timeout` de 5 s faz a migração
-- desistir em vez de ficar na fila se alguma tabela estiver ocupada. Não mexe em dado, só acrescenta a regra.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $guarda$
DECLARE
  v record;
  v_orfaos bigint;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('orcamentos',                 'conversa_id',    'whatsapp_conversas'),
      ('arquivos',                   'conversa_id',    'whatsapp_conversas'),
      ('parceiro_orcamentos',        'os_id',          'ordens_servico'),
      ('whatsapp_atendimentos',      'responsavel_id', 'usuarios'),
      ('whatsapp_conversa_leituras', 'user_id',        'usuarios'),
      ('alertas_integridade',        'fila_id',        'notificacoes_fila')
    ) AS t(tabela, coluna, pai)
  LOOP
    IF to_regclass('public.' || v.tabela) IS NULL OR to_regclass('public.' || v.pai) IS NULL THEN
      RAISE EXCEPTION 'Falta a tabela % ou %: as migrações anteriores precisam estar aplicadas.', v.tabela, v.pai;
    END IF;
    EXECUTE format(
      'SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = c.%I)',
      v.tabela, v.coluna, v.pai, v.coluna) INTO v_orfaos;
    IF v_orfaos > 0 THEN
      RAISE EXCEPTION '%.% tem % valor(es) sem correspondente em %. Corrija os órfãos antes de aplicar a chave.',
        v.tabela, v.coluna, v_orfaos, v.pai;
    END IF;
  END LOOP;
END
$guarda$;

DO $chaves$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orcamentos_conversa_id_fkey' AND conrelid = 'public.orcamentos'::regclass) THEN
    ALTER TABLE public.orcamentos
      ADD CONSTRAINT orcamentos_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES public.whatsapp_conversas(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arquivos_conversa_id_fkey' AND conrelid = 'public.arquivos'::regclass) THEN
    ALTER TABLE public.arquivos
      ADD CONSTRAINT arquivos_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES public.whatsapp_conversas(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parceiro_orcamentos_os_id_fkey' AND conrelid = 'public.parceiro_orcamentos'::regclass) THEN
    ALTER TABLE public.parceiro_orcamentos
      ADD CONSTRAINT parceiro_orcamentos_os_id_fkey FOREIGN KEY (os_id) REFERENCES public.ordens_servico(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_atendimentos_responsavel_id_fkey' AND conrelid = 'public.whatsapp_atendimentos'::regclass) THEN
    ALTER TABLE public.whatsapp_atendimentos
      ADD CONSTRAINT whatsapp_atendimentos_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conversa_leituras_user_id_fkey' AND conrelid = 'public.whatsapp_conversa_leituras'::regclass) THEN
    ALTER TABLE public.whatsapp_conversa_leituras
      ADD CONSTRAINT whatsapp_conversa_leituras_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alertas_integridade_fila_id_fkey' AND conrelid = 'public.alertas_integridade'::regclass) THEN
    ALTER TABLE public.alertas_integridade
      ADD CONSTRAINT alertas_integridade_fila_id_fkey FOREIGN KEY (fila_id) REFERENCES public.notificacoes_fila(id) ON DELETE SET NULL;
  END IF;
END
$chaves$;

-- Conferência final: as seis existem, valem para todas as linhas (convalidated) e têm a ação esperada ao apagar o pai.
DO $conferencia$
DECLARE
  v record;
  v_achou record;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('orcamentos',                 'orcamentos_conversa_id_fkey',                 'whatsapp_conversas', 'n'),
      ('arquivos',                   'arquivos_conversa_id_fkey',                   'whatsapp_conversas', 'n'),
      ('parceiro_orcamentos',        'parceiro_orcamentos_os_id_fkey',              'ordens_servico',     'n'),
      ('whatsapp_atendimentos',      'whatsapp_atendimentos_responsavel_id_fkey',   'usuarios',           'n'),
      ('whatsapp_conversa_leituras', 'whatsapp_conversa_leituras_user_id_fkey',     'usuarios',           'c'),
      ('alertas_integridade',        'alertas_integridade_fila_id_fkey',            'notificacoes_fila',  'n')
    ) AS t(tabela, nome, pai, acao)
  LOOP
    SELECT k.convalidated, k.confdeltype, k.confrelid::regclass::text AS pai INTO v_achou
      FROM pg_constraint k
     WHERE k.conname = v.nome AND k.conrelid = ('public.' || v.tabela)::regclass AND k.contype = 'f';
    IF NOT FOUND OR NOT v_achou.convalidated OR v_achou.confdeltype <> v.acao::"char" OR v_achou.pai <> v.pai THEN
      RAISE EXCEPTION 'A chave % não ficou como esperado (achou: %).', v.nome, to_jsonb(v_achou);
    END IF;
  END LOOP;
END
$conferencia$;

-- ============================================================================
-- DESFAZER (tira a regra; nenhum dado foi alterado por esta migração)
-- ============================================================================
-- ALTER TABLE public.orcamentos                  DROP CONSTRAINT orcamentos_conversa_id_fkey;
-- ALTER TABLE public.arquivos                    DROP CONSTRAINT arquivos_conversa_id_fkey;
-- ALTER TABLE public.parceiro_orcamentos         DROP CONSTRAINT parceiro_orcamentos_os_id_fkey;
-- ALTER TABLE public.whatsapp_atendimentos       DROP CONSTRAINT whatsapp_atendimentos_responsavel_id_fkey;
-- ALTER TABLE public.whatsapp_conversa_leituras  DROP CONSTRAINT whatsapp_conversa_leituras_user_id_fkey;
-- ALTER TABLE public.alertas_integridade         DROP CONSTRAINT alertas_integridade_fila_id_fkey;
