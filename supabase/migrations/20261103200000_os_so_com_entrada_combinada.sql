-- OS só nasce com ENTRADA combinada (decisão do dono, 03/11/2026).
--
-- "O orçamento é aprovado, o cliente dá uma entrada (50% ou uma das negociações que já existem) e o
-- restante na entrega. Pode pagar tudo de uma vez, fica a critério. Mas tem que ter uma entrada de
-- valor financeiro para poder gerar a ordem de serviço."
--
-- Antes, o modelo "Parcelado" (e o acordo antigo, sem modelo) deixava converter com entrada ZERO: a OS
-- nascia sem nenhum valor na aprovação. Agora a conversão recusa quando a entrada combinada é zero.
-- Passam: à vista (o total), 50% + 50%, e "Entrada + saldo" com valor ou percentual maior que zero.
-- A conta é a mesma do bloco que cria as parcelas, logo abaixo na própria função, e a de
-- `valorDaEntrada` (src/domain/orcamentos/acordo.ts) — tela, banco e conta a receber não discordam.
--
-- Medido antes de ligar: nenhum orçamento do banco usa "Parcelado" ou "Entrada + saldo"; os 5 aprovados
-- sem OS já estavam barrados por não ter condição combinada. Não barra nenhum pedido de hoje.
--
-- A função é reescrita a partir da definição viva, com guarda de md5: se outra sessão mudou a função,
-- a migração aborta em vez de pisar na mudança dela. Desfazer: remover o bloco (b4b) da função.
DO $migracao$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_em_os(uuid, jsonb)'::regprocedure);
  v_ancora text := '  -- (b2) item livre sem custo não vira OS (22/10/2026)';
  v_bloco text := $bloco$  -- (b4b) Entrada obrigatória (decisão do dono, 03/11/2026): sem valor combinado para a aprovação não há OS.
  -- À vista = o total; 50% + 50% = metade; entrada = valor fixo ou percentual. Parcelado puro não tem entrada.
  DECLARE v_entrada_min numeric;
  BEGIN
    v_entrada_min := CASE COALESCE(v_orc.condicao_pagamento->>'modelo', '')
      WHEN 'a_vista' THEN COALESCE(v_orc.valor_total, 0)
      WHEN 'metade_metade' THEN round(COALESCE(v_orc.valor_total, 0) * 0.5, 2)
      WHEN 'entrada' THEN
        CASE WHEN COALESCE((v_orc.condicao_pagamento->>'entrada_valor')::numeric, 0) > 0
             THEN LEAST(COALESCE(v_orc.valor_total, 0), round((v_orc.condicao_pagamento->>'entrada_valor')::numeric, 2))
             ELSE round(COALESCE(v_orc.valor_total, 0)
                        * LEAST(100, GREATEST(0, COALESCE((v_orc.condicao_pagamento->>'entrada_pct')::numeric, 0))) / 100, 2)
        END
      ELSE 0
    END;
    IF COALESCE(v_orc.valor_total, 0) > 0 AND v_entrada_min <= 0 THEN
      RAISE EXCEPTION 'Orçamento sem entrada: a OS só nasce com um valor combinado para a aprovação. Escolha à vista, 50%% + 50%% ou "Entrada + saldo" (com o valor ou o percentual da entrada) no quadro Pagamento; depois converta.'
        USING ERRCODE = 'P0001';
    END IF;
  END;

$bloco$;
BEGIN
  IF position('(b4b) Entrada obrigatória' in v_def) > 0 THEN
    RAISE NOTICE 'Nada a fazer: a trava de entrada já está na função.';
    RETURN;
  END IF;
  IF md5(v_def) <> '8fd8d7e7680b2809010c85679305af28' THEN
    RAISE EXCEPTION 'converter_orcamento_em_os mudou (md5 %); reler antes de aplicar', md5(v_def);
  END IF;
  IF position(v_ancora in v_def) = 0 THEN
    RAISE EXCEPTION 'âncora (b2) não encontrada em converter_orcamento_em_os';
  END IF;
  EXECUTE replace(v_def, v_ancora, v_bloco || v_ancora);
END
$migracao$;

NOTIFY pgrst, 'reload schema';
