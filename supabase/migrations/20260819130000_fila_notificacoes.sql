-- Fila de notificações ao cliente (WhatsApp), no padrão que o Bex Lite já provou.
--
-- No Bex Lite, `notifications_outbox` passou 5.011 mensagens com tentativas,
-- próxima tentativa e chave de idempotência. A lição embutida ali é que avisar
-- cliente NÃO pode ser "chamar a API e torcer": se a Z-API estiver fora do ar no
-- exato segundo em que a OS muda de etapa, o cliente simplesmente não é avisado
-- e ninguém fica sabendo. Fila com reenvio resolve isso — a mensagem espera.
--
-- Também herda a lição contrária, aprendida no Bex: alerta demais é alerta
-- ignorado. O Kanban tem 26 status; avisar em todos faria o cliente silenciar o
-- número. Só entram na fila os marcos que ele quer saber (ver MARCOS abaixo).
--
-- O link de acompanhamento NÃO é montado aqui: o token é assinado com
-- PUBLIC_LINK_SECRET, que vive no servidor. A fila guarda o os_id em `variaveis`
-- e quem envia monta o link. Segredo não entra no banco.

CREATE TABLE IF NOT EXISTS public.notificacoes_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  canal        text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp','email')),
  destinatario text NOT NULL,
  cliente_id   uuid REFERENCES public.clientes(id) ON DELETE SET NULL,

  evento    text NOT NULL,
  entidade  text NOT NULL CHECK (entidade IN ('orcamento','ordem_servico')),
  entidade_id uuid NOT NULL,

  template  text NOT NULL,
  variaveis jsonb NOT NULL DEFAULT '{}'::jsonb,

  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','enviando','enviado','falhou','cancelado')),
  tentativas     int NOT NULL DEFAULT 0,
  max_tentativas int NOT NULL DEFAULT 5,
  -- quando pode ser tentada de novo; o consumidor busca por isto
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  ultimo_erro text,

  -- rastro do provedor, para saber se chegou de fato
  provider_message_id text,
  provider_status     text,
  enviado_em   timestamptz,
  entregue_em  timestamptz,
  lido_em      timestamptz,

  -- Impede mensagem repetida. A OS pode voltar e avançar de novo no quadro
  -- (retrabalho, correção); sem esta chave o cliente receberia "entrou em
  -- produção" duas vezes.
  idempotency_key text NOT NULL UNIQUE,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- O consumidor pega o que está pendente e já venceu; este é o índice que ele usa.
CREATE INDEX IF NOT EXISTS idx_notificacoes_fila_pendentes
  ON public.notificacoes_fila (proxima_tentativa_em)
  WHERE status IN ('pendente','falhou');
CREATE INDEX IF NOT EXISTS idx_notificacoes_fila_entidade
  ON public.notificacoes_fila (entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_fila_cliente_id
  ON public.notificacoes_fila (cliente_id);

ALTER TABLE public.notificacoes_fila ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificacoes_fila_staff ON public.notificacoes_fila;
CREATE POLICY notificacoes_fila_staff ON public.notificacoes_fila
  FOR ALL TO authenticated
  USING (is_staff((select auth.uid())))
  WITH CHECK (is_staff((select auth.uid())));

GRANT SELECT, INSERT, UPDATE ON public.notificacoes_fila TO authenticated;

DROP TRIGGER IF EXISTS tg_notificacoes_fila_updated ON public.notificacoes_fila;
CREATE TRIGGER tg_notificacoes_fila_updated
  BEFORE UPDATE ON public.notificacoes_fila
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Enfileirar
-- ---------------------------------------------------------------------------
-- Idempotente por construção: ON CONFLICT DO NOTHING sobre idempotency_key.
-- Chamar duas vezes com a mesma chave enfileira uma vez só.
CREATE OR REPLACE FUNCTION public.enfileirar_notificacao(
  p_canal text,
  p_destinatario text,
  p_cliente_id uuid,
  p_evento text,
  p_entidade text,
  p_entidade_id uuid,
  p_template text,
  p_variaveis jsonb,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_destino text;
BEGIN
  -- Sem destinatário não há o que enfileirar. Silencioso de propósito: cliente
  -- sem telefone é situação normal (retirada no balcão), não erro que deva
  -- derrubar a transação que mudou o status da OS.
  v_destino := CASE
    WHEN p_canal = 'whatsapp' THEN public.normalize_whatsapp_phone(p_destinatario)
    ELSE lower(nullif(btrim(p_destinatario), ''))
  END;
  IF v_destino IS NULL OR v_destino = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notificacoes_fila (
    canal, destinatario, cliente_id, evento, entidade, entidade_id,
    template, variaveis, idempotency_key
  )
  VALUES (
    p_canal, v_destino, p_cliente_id, p_evento, p_entidade, p_entidade_id,
    p_template, COALESCE(p_variaveis, '{}'::jsonb), p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- ---------------------------------------------------------------------------
-- Marcos: o que o cliente quer saber
-- ---------------------------------------------------------------------------
-- Deliberadamente curto. Cada linha aqui é uma mensagem no celular de alguém.
CREATE OR REPLACE FUNCTION public.marco_notificavel_os(_status status_os)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _status
    WHEN 'aguardando_aprovacao_arte' THEN 'os_arte_para_aprovar'
    WHEN 'em_producao'               THEN 'os_em_producao'
    WHEN 'aguardando_retirada'       THEN 'os_pronta_retirada'
    WHEN 'em_entrega'                THEN 'os_saiu_entrega'
    WHEN 'concluido'                 THEN 'os_concluida'
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public.tg_os_notificar_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_evento text;
  v_cliente public.clientes%ROWTYPE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  v_evento := public.marco_notificavel_os(NEW.status);
  IF v_evento IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_cliente FROM public.clientes WHERE id = NEW.cliente_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  PERFORM public.enfileirar_notificacao(
    'whatsapp',
    COALESCE(v_cliente.whatsapp_principal, v_cliente.telefone),
    v_cliente.id,
    v_evento,
    'ordem_servico',
    NEW.id,
    v_evento,
    jsonb_build_object(
      'cliente',   v_cliente.nome,
      'os_numero', NEW.numero,
      'os_titulo', NEW.titulo,
      'os_id',     NEW.id,
      'prazo',     NEW.prazo_entrega
    ),
    -- a chave inclui o status: a mesma OS voltando ao mesmo marco não reenvia
    'os:' || NEW.id::text || ':' || NEW.status::text
  );

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_os_notificar_cliente ON public.ordens_servico;
CREATE TRIGGER tg_os_notificar_cliente
  AFTER UPDATE OF status ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_notificar_cliente();

-- Orçamento aprovado: confirma e manda o acompanhamento.
CREATE OR REPLACE FUNCTION public.tg_orcamento_notificar_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cliente public.clientes%ROWTYPE; v_destino text;
BEGIN
  IF NEW.status::text <> 'aprovado' OR OLD.status::text = 'aprovado' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cliente FROM public.clientes WHERE id = NEW.cliente_id;
  -- Cliente ainda não vinculado: usa o contato avulso do próprio orçamento.
  v_destino := COALESCE(v_cliente.whatsapp_principal, v_cliente.telefone, NEW.contato_telefone);

  PERFORM public.enfileirar_notificacao(
    'whatsapp', v_destino, NEW.cliente_id,
    'orcamento_aprovado', 'orcamento', NEW.id, 'orcamento_aprovado',
    jsonb_build_object(
      'cliente',        COALESCE(v_cliente.nome, NEW.contato_nome),
      'orcamento_numero', NEW.numero,
      'orcamento_id',   NEW.id,
      'valor_total',    NEW.valor_total
    ),
    'orcamento:' || NEW.id::text || ':aprovado'
  );

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_orcamento_notificar_cliente ON public.orcamentos;
CREATE TRIGGER tg_orcamento_notificar_cliente
  AFTER UPDATE OF status ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_notificar_cliente();

-- ---------------------------------------------------------------------------
-- Consumo
-- ---------------------------------------------------------------------------
-- Reserva um lote para envio. FOR UPDATE SKIP LOCKED permite dois consumidores
-- rodando sem enviar a mesma mensagem duas vezes.
CREATE OR REPLACE FUNCTION public.reservar_notificacoes(p_limite int DEFAULT 20)
RETURNS SETOF public.notificacoes_fila
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH alvo AS (
    SELECT id FROM public.notificacoes_fila
    WHERE status IN ('pendente','falhou')
      AND tentativas < max_tentativas
      AND proxima_tentativa_em <= now()
    ORDER BY proxima_tentativa_em
    LIMIT GREATEST(1, p_limite)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notificacoes_fila f
  SET status = 'enviando', tentativas = f.tentativas + 1, updated_at = now()
  FROM alvo WHERE f.id = alvo.id
  RETURNING f.*;
END $function$;

-- Resultado do envio. Em falha, espera de 1, 4, 9, 16… minutos (tentativas ao
-- quadrado) — dá tempo de a instância voltar sem martelar o provedor.
CREATE OR REPLACE FUNCTION public.concluir_notificacao(
  p_id uuid,
  p_ok boolean,
  p_provider_message_id text DEFAULT NULL,
  p_erro text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_ok THEN
    UPDATE public.notificacoes_fila
    SET status = 'enviado', enviado_em = now(), provider_message_id = p_provider_message_id,
        ultimo_erro = NULL, updated_at = now()
    WHERE id = p_id;
  ELSE
    UPDATE public.notificacoes_fila
    SET status = CASE WHEN tentativas >= max_tentativas THEN 'falhou' ELSE 'pendente' END,
        ultimo_erro = p_erro,
        proxima_tentativa_em = now() + (power(tentativas, 2) * interval '1 minute'),
        updated_at = now()
    WHERE id = p_id;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.enfileirar_notificacao(text,text,uuid,text,text,uuid,text,jsonb,text) FROM public;
REVOKE ALL ON FUNCTION public.reservar_notificacoes(int) FROM public;
REVOKE ALL ON FUNCTION public.concluir_notificacao(uuid,boolean,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_notificacoes(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.concluir_notificacao(uuid,boolean,text,text) TO service_role;
