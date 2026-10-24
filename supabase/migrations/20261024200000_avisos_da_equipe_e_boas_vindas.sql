-- O "agente" de avisos do Bex Print, no jeito do Bex Lite (24/10/2026).
--
-- O que o Bex Lite tem e o Print já tinha: fila + despachante (pg_cron a cada 2
-- min), lembrete diário por pessoa (lembretes_da_equipe, 9h seg–sáb), cooldown de
-- 12 h por regra, silêncio quando não há nada. O que faltava:
--   1. a lista da operação não via OS ATRASADAS nem OS paradas no atendimento/
--      criação nem arte marcada "aprovada" sem aceite do cliente nem parceiro
--      novo sem atendente — exatamente o que estava parado e ninguém sabia;
--   2. boas-vindas por WhatsApp ao parceiro que se cadastra (e ao usuário novo
--      da equipe, pela função de servidor);
--   3. um aviso avulso à equipe (`alerta_equipe`), para o que não espera 9h.
-- Fica de fora de propósito (o Lite tem, o Print não precisa agora): escalonamento
-- de tom por reincidência, grupo interno de operação, modo dry_run.
-- Desfazer: remover os 4 blocos do lembretes_da_equipe (recriar da 20261013090000
-- / 20261015140000), dropar o gatilho tg_parceiro_boas_vindas e apagar os 3 templates.

-- 1. Templates -----------------------------------------------------------------
INSERT INTO public.notificacao_templates (evento, canal, descricao, corpo, ativo) VALUES
 ('parceiro_boas_vindas','whatsapp','Boas-vindas ao parceiro que acabou de se cadastrar',
  E'Olá, {{cliente}}! 👋 Seu cadastro de parceiro na Bex Print está liberado.\n\nEntre em {{link}} com o e-mail e a senha que você criou. Lá estão a sua tabela de preços, o orçamento com a sua marca e o seu crédito.\n\nQualquer dúvida, é só responder por aqui.', true),
 ('usuario_boas_vindas','whatsapp','Boas-vindas à pessoa nova da equipe (sem senha na mensagem)',
  E'Olá, {{nome}}! Seu acesso ao sistema da Bex Print foi criado.\n\nEntre em {{link}} com o seu e-mail. A senha inicial foi passada pela gerência — troque-a no primeiro acesso.', true),
 ('alerta_equipe','whatsapp','Aviso avulso à equipe (texto livre montado pelo sistema)','{{texto}}', true)
ON CONFLICT (evento) DO NOTHING;

-- 1b. A fila só aceitava aviso de orçamento e de OS (CHECK da entidade). O ensaio
--     com o cadastro de parceiro pegou: sem isto a boas-vindas falharia e, como o
--     gatilho roda dentro do cadastro, derrubaria o cadastro junto. Por isso o
--     gatilho também engole a falha (acessório não derruba o efeito).
ALTER TABLE public.notificacoes_fila DROP CONSTRAINT IF EXISTS notificacoes_fila_entidade_check;
ALTER TABLE public.notificacoes_fila ADD CONSTRAINT notificacoes_fila_entidade_check
  CHECK (entidade = ANY (ARRAY['orcamento'::text, 'ordem_servico'::text, 'parceiro'::text, 'usuario'::text]));

-- 2. Boas-vindas ao parceiro ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_parceiro_boas_vindas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tel text; v_nome text;
BEGIN
  -- Só quando o parceiro JÁ pode entrar (ativo e com login). A chave de
  -- idempotência garante uma vez por parceiro, mesmo se o status oscilar.
  IF NEW.status <> 'ativo' OR NEW.usuario_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.usuario_id IS NOT NULL AND OLD.status = 'ativo' THEN RETURN NEW; END IF;
  BEGIN
    SELECT COALESCE(NEW.marca_telefone, c.whatsapp_principal, c.telefone), COALESCE(NULLIF(btrim(NEW.marca_nome), ''), c.nome)
      INTO v_tel, v_nome FROM public.clientes c WHERE c.id = NEW.cliente_id;
    PERFORM public.enfileirar_notificacao('whatsapp', v_tel, NEW.cliente_id, 'parceiro_boas_vindas',
      'parceiro', NEW.id, 'parceiro_boas_vindas',
      jsonb_build_object('cliente', COALESCE(v_nome, 'parceiro'),
                         'link', public.url_publica_do_sistema() || '/login?como=parceiro'),
      'parceiro:' || NEW.id::text || ':boas_vindas');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_parceiro_boas_vindas: aviso não enfileirado para o parceiro %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.tg_parceiro_boas_vindas() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tg_parceiro_boas_vindas ON public.parceiros;
CREATE TRIGGER tg_parceiro_boas_vindas AFTER INSERT OR UPDATE OF usuario_id, status ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_boas_vindas();

-- 3. Mais quatro blocos na lista da operação ---------------------------------------
DO $lista$
DECLARE
  v_def text := pg_get_functiondef('public.lembretes_da_equipe()'::regprocedure);
  v_ancora text := E'  -- Silêncio quando não há nada: nem "tudo certo" todo dia.\n';
  v_blocos text;
BEGIN
  IF position('OS com o prazo vencido' IN v_def) > 0 THEN RETURN; END IF; -- já aplicada
  IF (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 THEN
    RAISE EXCEPTION 'lembretes_da_equipe: a âncora do silêncio não está como esperado';
  END IF;
  v_blocos := $blocos$
  -- 8. OS com o prazo vencido (qualquer etapa, menos as encerradas).
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.prazo_entrega, os.numero) AS ordem,
           format('OS #%s · %s · %s · %s · prazo venceu há %s', os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40),
             initcap(replace(os.status::text, '_', ' ')),
             public._dias(v_hoje - (os.prazo_entrega AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    WHERE os.finalidade = 'venda' AND os.status::text NOT IN ('concluido', 'faturado', 'cancelado')
      AND os.prazo_entrega < now()
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'OS com o prazo vencido: %s.\n%s%s\nFale com o cliente, combine um novo prazo ou leve a OS adiante no quadro.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 9. Paradas no atendimento ou na criação há mais de 3 dias (as de prazo
  --    vencido já estão no bloco acima). Conta do último movimento no histórico,
  --    não do updated_at, que qualquer rotina mexe.
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY p.desde, p.numero) AS ordem,
           format('OS #%s · %s · %s · %s há %s', p.numero, p.cliente, p.titulo, p.etapa,
                  public._dias(v_hoje - (p.desde AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM (
      SELECT os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente') AS cliente,
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40) AS titulo,
             initcap(replace(os.status::text, '_', ' ')) AS etapa,
             coalesce((SELECT max(h.mudou_em) FROM public.os_status_historico h WHERE h.os_id = os.id), os.created_at) AS desde,
             os.prazo_entrega
      FROM public.ordens_servico os
      LEFT JOIN public.clientes c ON c.id = os.cliente_id
      WHERE os.finalidade = 'venda'
        AND os.status::text IN ('entrada', 'aguardando_briefing', 'briefing_ok', 'design', 'arte_rejeitada', 'arte_aprovada')
    ) p
    WHERE p.desde < now() - interval '3 days' AND (p.prazo_entrega IS NULL OR p.prazo_entrega >= now())
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'OS paradas no atendimento ou na criação há mais de 3 dias: %s.\n%s%s\nTerminou o briefing ou a arte? Mova no quadro; o cliente é avisado a cada etapa.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 10. Arte marcada como aprovada sem o aceite do cliente registrado: a OS
  --     não pode entrar na fila de produção assim (a trava do banco barra).
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.numero) AS ordem,
           format('OS #%s · %s · %s', os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40)) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    WHERE os.finalidade = 'venda' AND os.status::text = 'arte_aprovada'
      AND NOT public.arte_aprovada_da_os(os.id)
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Arte marcada como aprovada, mas sem o aceite do cliente registrado: %s.\n%s%s\nEnvie a arte para o cliente aprovar pelo link (e anexe o arquivo final): sem isso a OS não entra na fila de produção.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 11. Parceiros que entraram sozinhos e ainda não têm atendente.
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY pa.created_at) AS ordem,
           format('%s · cadastrou-se há %s', coalesce(nullif(btrim(pa.marca_nome), ''), c.nome, 'parceiro'),
             public._dias(v_hoje - (pa.created_at AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM public.parceiros pa
    LEFT JOIN public.clientes c ON c.id = pa.cliente_id
    WHERE pa.status = 'ativo' AND pa.responsavel_id IS NULL AND pa.usuario_id IS NOT NULL
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Parceiros novos sem atendente: %s.\n%s%s\nEm Parceiros, toque em "Assumir" e chame no WhatsApp: o primeiro pedido dele só sai com atendente.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

$blocos$;
  EXECUTE replace(v_def, v_ancora, v_blocos || v_ancora);
END
$lista$;
