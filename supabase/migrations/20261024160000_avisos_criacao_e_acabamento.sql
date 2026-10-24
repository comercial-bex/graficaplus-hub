-- O cliente passa a ser avisado também quando o pedido entra em CRIAÇÃO (design)
-- e em ACABAMENTO (24/10/2026, pedido do dono: "em qual área está, já seguiu para
-- outra"). Antes avisavam só: orçamento aprovado, arte para aprovar, produção,
-- pronto (retirada/entrega), saiu para entrega e concluído.
-- Chave de idempotência continua `os:<id>:<status>`: cada status avisa uma vez
-- (a arte rejeitada que volta ao design não repete o aviso de criação).
-- Desfazer: tirar as duas linhas WHEN de marco_notificavel_os e apagar os dois
-- templates.
DO $m$
DECLARE d text := pg_get_functiondef('public.marco_notificavel_os(status_os)'::regprocedure);
  a text := E'    WHEN _status = ''aguardando_aprovacao_arte'' THEN ''os_arte_para_aprovar''\n';
BEGIN
  IF position('os_em_criacao' IN d) > 0 THEN RETURN; END IF; -- já aplicada
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'âncora não única'; END IF;
  d := replace(d, a, E'    WHEN _status = ''design'' THEN ''os_em_criacao''\n' || a || E'    WHEN _status = ''em_acabamento'' THEN ''os_em_acabamento''\n');
  EXECUTE d;
END $m$;

INSERT INTO public.notificacao_templates (evento, canal, descricao, corpo, ativo) VALUES
 ('os_em_criacao','whatsapp','A OS entrou em Criação (design)','Oi, {{cliente}}! O pedido {{os_numero}} ({{os_titulo}}) está na criação: nossa equipe já está preparando a sua arte. Assim que ficar pronta, enviamos para você aprovar.', true),
 ('os_em_acabamento','whatsapp','A OS entrou em Acabamento','{{cliente}}, o pedido {{os_numero}} ({{os_titulo}}) já foi produzido e está no acabamento e na conferência final. Falta pouco!', true)
ON CONFLICT (evento) DO NOTHING;
