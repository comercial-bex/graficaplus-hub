-- ============================================================================
-- Onda 3 — a ponta do cliente: a entrega fecha a OS
-- ============================================================================
--
-- `entregas_instalacoes` tinha ZERO linhas. Não por falta de entrega: por falta
-- da pergunta. `tg_os_gera_entrega` (PR #76) só abre a entrega quando
-- `precisa_entrega` ou `precisa_instalacao` é verdadeiro, e nenhuma tela jamais
-- ofereceu esses campos — toda OS nascia com os dois nulos. Elo modelado que
-- nada preenche.
--
-- E, mesmo que alguém preenchesse na mão, a perna seguinte estava partida por
-- uma letra:
--
--   a tela /entregas gravava   'concluido'   (masculino)
--   `fechar_os` procurava      'concluida'   (feminino)
--
-- `fechar_os` bloqueia enquanto houver entrega fora de
-- ('concluida','cancelada','nao_necessaria'). Dar baixa na entrega não
-- desbloqueava nada: a OS ficava presa em "em entrega" PARA SEMPRE — fora do
-- realizado do mês, fora do faturado, fora do portal do cliente, e sem um erro
-- sequer aparecer. A coluna é `text` e não tinha CHECK, então nada impedia uma
-- terceira grafia.
--
-- Pior: mesmo com a palavra certa, NADA ligava a baixa da entrega ao
-- fechamento da OS. A tabela não tinha um único gatilho. O entregador voltava,
-- marcava "entregue", e a OS continuava aberta.
--
-- Retrato do banco vivo: tudo abaixo já foi aplicado e ensaiado com reversão.

-- ------------------------------------------------------- 1. uma palavra só
UPDATE public.entregas_instalacoes SET status = 'concluida' WHERE status = 'concluido';

ALTER TABLE public.entregas_instalacoes
  DROP CONSTRAINT IF EXISTS entregas_instalacoes_status_check;
ALTER TABLE public.entregas_instalacoes
  ADD CONSTRAINT entregas_instalacoes_status_check
  CHECK (status IN ('agendada','em_rota','concluida','cancelada','nao_necessaria'));

COMMENT ON COLUMN public.entregas_instalacoes.status IS
  'agendada | em_rota | concluida | cancelada | nao_necessaria. O CHECK existe porque a tela gravava "concluido" e fechar_os procurava "concluida": a OS ficava presa para sempre.';


-- --------------------------------------------- 2. a baixa da entrega fecha a OS
-- Acessório COM RASTRO, e a distinção importa: a entrega ACONTECEU. Recusar a
-- baixa dela porque a OS não pôde fechar apagaria um fato do mundo real — o
-- cliente recebeu, e o sistema fingiria que não. Então a baixa passa, o
-- fechamento é tentado, e o que não fechar vira aviso na tela (pendência
-- `entrega_feita_os_aberta` logo abaixo), não WARNING perdido no log.
--
-- `fechar_os` tem oito travas: tarefa obrigatória, qualidade, material baixado,
-- ocorrência tratada, logística, custo operacional e pagamento. O gatilho não
-- força nenhuma — quem decide continua sendo quem fecha.
CREATE OR REPLACE FUNCTION public.tg_entrega_conclui_a_os()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_abertas int; v_status text; v_res jsonb;
BEGIN
  IF NEW.status <> 'concluida' OR COALESCE(OLD.status,'') = 'concluida' THEN RETURN NULL; END IF;

  -- Uma OS pode ter entrega E instalação. Fechar na primeira deixaria a
  -- instalação pendente numa OS já concluída.
  SELECT count(*) INTO v_abertas FROM public.entregas_instalacoes
   WHERE os_id = NEW.os_id AND status NOT IN ('concluida','cancelada','nao_necessaria');
  IF v_abertas > 0 THEN RETURN NULL; END IF;

  SELECT status::text INTO v_status FROM public.ordens_servico WHERE id = NEW.os_id;
  IF v_status IN ('concluido','faturado','cancelado') THEN RETURN NULL; END IF;

  BEGIN
    v_res := public.fechar_os(NEW.os_id);
    IF NOT COALESCE((v_res->>'fechada')::boolean, false) THEN
      RAISE WARNING 'Entrega da OS % concluida, mas a OS nao fechou: %', NEW.os_id, v_res->'bloqueios';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Entrega da OS % concluida, mas fechar_os falhou: %', NEW.os_id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.tg_entrega_conclui_a_os() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_entrega_conclui_a_os ON public.entregas_instalacoes;
CREATE TRIGGER tg_entrega_conclui_a_os
  AFTER UPDATE OF status ON public.entregas_instalacoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_entrega_conclui_a_os();


-- ------------------------------ 3. o que não fechou tem de aparecer na tela
-- Sem esta pendência, uma OS que a trava impediu de fechar viraria um WARNING
-- no log do Postgres que ninguém lê — exatamente o silêncio que prendeu a OS
-- em "em entrega" até agora, só que com outro nome.
--
-- Ensaiado com reversão: entrega aberta -> 0 pendências; baixada com a OS
-- travada -> 1; baixada com a OS limpa -> OS `concluido`, status_geral
-- `fechada`, data_fechamento preenchida, pesquisa de pós-venda criada, e
-- nenhuma pendência.
DO $patch$
DECLARE src text; novo text; bloco text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='pendencias_do_sistema';

  IF position('entrega_feita_os_aberta' in src) > 0 THEN RETURN; END IF;

  bloco := $b$
  -- A entrega foi feita e a OS continua aberta. `fechar_os` tem oito travas
  -- (tarefas, qualidade, material baixado, custo operacional, pagamento) e a
  -- baixa da entrega dispara o fechamento, mas nao pode forcar nenhuma delas.
  -- Sem este aviso o que sobra e um WARNING no log que ninguem le, e a OS fica
  -- fora do realizado do mes e do portal do cliente sem que ninguem saiba.
  RETURN QUERY SELECT 'entrega_feita_os_aberta','Entrega concluida e OS ainda aberta', count(*)::int,
    (SELECT count(*)::int FROM public.ordens_servico WHERE status NOT IN ('concluido','faturado','cancelado')),
    'atencao','producao',
    'O cliente ja recebeu. Abra a OS e veja o que falta para fechar: tarefa obrigatoria, qualidade, baixa de material, custo operacional ou pagamento. Enquanto nao fechar, a venda nao entra no faturado do mes.','/os'
  FROM public.ordens_servico o
  WHERE o.status NOT IN ('concluido','faturado','cancelado')
    AND EXISTS (SELECT 1 FROM public.entregas_instalacoes e WHERE e.os_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.entregas_instalacoes e
                     WHERE e.os_id = o.id AND e.status NOT IN ('concluida','cancelada','nao_necessaria'))
  HAVING count(*) > 0;

$b$;

  novo := replace(src, E'\n  RETURN QUERY SELECT ''cliente_sem_contato''', bloco || E'\n  RETURN QUERY SELECT ''cliente_sem_contato''');
  IF novo = src THEN RAISE EXCEPTION 'ancora cliente_sem_contato nao encontrada'; END IF;
  EXECUTE novo;
END $patch$;
