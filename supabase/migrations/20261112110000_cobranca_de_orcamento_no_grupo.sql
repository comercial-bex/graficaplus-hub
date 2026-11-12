-- Cobrança de orçamento pendente no grupo de WhatsApp da equipe (pedido do dono de 11/11/2026:
-- "cobrar o atendimento por demora de envio de orçamento no grupo de trabalho").
--
-- A regra (minutos úteis, níveis, quem citar, texto) mora em src/domain/whatsapp/cobranca.ts. Este
-- arquivo só guarda a configuração, lê as pendências, registra o que foi (ou seria) cobrado e
-- enfileira a mensagem para o despachante que já existe.
--
-- O que este arquivo faz:
--  1. colunas da cobrança em whatsapp_configuracoes, com o modo nascendo DESLIGADO (nada liga aqui),
--     mais o resultado da última rodada (quando, se deu certo, por que parou ou falhou);
--  2. marca de pedido e dispensa no atendimento (os botões que escrevem são da onda seguinte);
--  3. histórico whatsapp_cobrancas, uma linha por (atendimento, nível, modo);
--  4. funções só do service_role: pendências, equipe, registrar, salvar e gravar a rodada;
--  5. modelo cobranca_orcamento ({{texto}});
--  6. job whatsapp-cobrar a cada 5 minutos, no padrão do whatsapp-despachar.
--
-- A trava do destino: whatsapp_cobranca_registrar NÃO recebe destino. Ela usa
-- grupo_equipe_destino(), que só devolve id ligado no formato ^\d{10,}-group$, e recusa com erro
-- qualquer outra coisa. A cobrança nunca vai ao cliente.
--
-- Grants por coluna (pg_attribute.attacl, 12/11): whatsapp_configuracoes e whatsapp_atendimentos têm
-- só grant de tabela, nenhuma coluna com ACL própria; coluna nova não precisa de GRANT de coluna.

-- 1. Configuração ---------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_configuracoes
  ADD COLUMN IF NOT EXISTS cobranca_modo text NOT NULL DEFAULT 'desligada',
  ADD COLUMN IF NOT EXISTS cobranca_min_pedido integer NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS cobranca_min_orcamento integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS cobranca_min_gestor integer NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS cobranca_sabado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cobranca_sabado_fim time NOT NULL DEFAULT '12:00',
  ADD COLUMN IF NOT EXISTS cobranca_ligada_em timestamptz,
  ADD COLUMN IF NOT EXISTS cobranca_ensaio_desde timestamptz,
  ADD COLUMN IF NOT EXISTS cobranca_rodada_em timestamptz,
  ADD COLUMN IF NOT EXISTS cobranca_rodada_ok boolean,
  ADD COLUMN IF NOT EXISTS cobranca_rodada_parada text,
  ADD COLUMN IF NOT EXISTS cobranca_rodada_erro text;

ALTER TABLE public.whatsapp_configuracoes
  DROP CONSTRAINT IF EXISTS whatsapp_configuracoes_cobranca_modo_check,
  DROP CONSTRAINT IF EXISTS whatsapp_configuracoes_cobranca_min_pedido_check,
  DROP CONSTRAINT IF EXISTS whatsapp_configuracoes_cobranca_min_orcamento_check,
  DROP CONSTRAINT IF EXISTS whatsapp_configuracoes_cobranca_min_gestor_check,
  DROP CONSTRAINT IF EXISTS whatsapp_configuracoes_cobranca_sabado_fim_check;

ALTER TABLE public.whatsapp_configuracoes
  ADD CONSTRAINT whatsapp_configuracoes_cobranca_modo_check
    CHECK (cobranca_modo IN ('desligada', 'ensaio', 'ligada')),
  ADD CONSTRAINT whatsapp_configuracoes_cobranca_min_pedido_check
    CHECK (cobranca_min_pedido BETWEEN 30 AND 1440),
  ADD CONSTRAINT whatsapp_configuracoes_cobranca_min_orcamento_check
    CHECK (cobranca_min_orcamento BETWEEN 30 AND 1440),
  ADD CONSTRAINT whatsapp_configuracoes_cobranca_min_gestor_check
    CHECK (cobranca_min_gestor BETWEEN 30 AND 1440),
  ADD CONSTRAINT whatsapp_configuracoes_cobranca_sabado_fim_check
    CHECK (cobranca_sabado_fim > '08:00' AND cobranca_sabado_fim <= '18:00');

COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_modo IS
  'Cobrança de orçamento no grupo: desligada (padrão), ensaio (só registra o que mandaria) ou ligada.';
COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_min_pedido IS
  'Minutos úteis entre o pedido de orçamento sem orçamento e a 1ª cobrança.';
COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_min_orcamento IS
  'Minutos úteis entre o orçamento criado e não enviado e a 1ª cobrança.';
COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_min_gestor IS
  'Minutos úteis entre a 1ª cobrança e a 2ª, que chama a gerência.';
COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_ligada_em IS
  'Corte do modo ligada: só pedidos depois dele são cobrados.';
COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_ensaio_desde IS
  'Corte do modo ensaio: só pedidos depois dele entram no ensaio.';
COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_rodada_em IS
  'Quando a última rodada da cobrança terminou (gravada por whatsapp_cobranca_rodada_gravar). Token errado nunca chega a gravar: rodada parada há mais de 15 minutos é o sinal.';
COMMENT ON COLUMN public.whatsapp_configuracoes.cobranca_rodada_ok IS
  'A última rodada deu certo (true) ou terminou com erro (false).';

-- 2. Marca de pedido e dispensa no atendimento ----------------------------------------------------
ALTER TABLE public.whatsapp_atendimentos
  ADD COLUMN IF NOT EXISTS pediu_orcamento_em timestamptz,
  ADD COLUMN IF NOT EXISTS pediu_orcamento_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS orcamento_dispensado_em timestamptz,
  ADD COLUMN IF NOT EXISTS orcamento_dispensado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS orcamento_dispensado_motivo text;

ALTER TABLE public.whatsapp_atendimentos
  DROP CONSTRAINT IF EXISTS whatsapp_atendimentos_orcamento_dispensado_motivo_check,
  DROP CONSTRAINT IF EXISTS whatsapp_atendimentos_orcamento_dispensa_coerente,
  DROP CONSTRAINT IF EXISTS whatsapp_atendimentos_pediu_orcamento_coerente;

ALTER TABLE public.whatsapp_atendimentos
  ADD CONSTRAINT whatsapp_atendimentos_orcamento_dispensado_motivo_check
    CHECK (orcamento_dispensado_motivo IN
      ('enviado_por_fora', 'nao_e_orcamento', 'respondeu_preco_por_texto', 'cliente_desistiu')),
  ADD CONSTRAINT whatsapp_atendimentos_orcamento_dispensa_coerente
    CHECK ((orcamento_dispensado_em IS NULL) = (orcamento_dispensado_motivo IS NULL)),
  ADD CONSTRAINT whatsapp_atendimentos_pediu_orcamento_coerente
    CHECK (pediu_orcamento_por IS NULL OR pediu_orcamento_em IS NOT NULL);

COMMENT ON COLUMN public.whatsapp_atendimentos.pediu_orcamento_em IS
  'Marca posta por pessoa: o cliente pediu orçamento neste momento. Liga o relógio da cobrança.';
COMMENT ON COLUMN public.whatsapp_atendimentos.orcamento_dispensado_em IS
  'Dispensa da cobrança de orçamento deste atendimento (com quem e o motivo).';

-- 3. Histórico ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id uuid NOT NULL REFERENCES public.whatsapp_atendimentos(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  orcamento_id uuid REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  nivel smallint NOT NULL CHECK (nivel IN (1, 2)),
  modo text NOT NULL CHECK (modo IN ('ensaio', 'ligada')),
  motivo text NOT NULL CHECK (motivo IN ('pedido_sem_orcamento', 'orcamento_parado')),
  minutos_uteis integer NOT NULL,
  citados jsonb NOT NULL DEFAULT '[]'::jsonb,
  texto text NOT NULL,
  destino text,
  fila_id uuid REFERENCES public.notificacoes_fila(id) ON DELETE SET NULL,
  agrupada boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_cobrancas_destino_so_grupo
    CHECK (modo = 'ensaio' OR (destino IS NOT NULL AND destino ~ '^\d{10,}-group$'))
);

COMMENT ON TABLE public.whatsapp_cobrancas IS
  'Cobranças de orçamento pendente no grupo da equipe (ou o que o ensaio teria mandado). Uma por atendimento, nível e modo.';

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_cobrancas_uma_por_nivel
  ON public.whatsapp_cobrancas (atendimento_id, nivel, modo);
CREATE INDEX IF NOT EXISTS whatsapp_cobrancas_recentes
  ON public.whatsapp_cobrancas (created_at DESC);

ALTER TABLE public.whatsapp_cobrancas ENABLE ROW LEVEL SECURITY;

-- Leitura só de quem tem configuracoes.manage (admin e gestor). O texto guardado traz o "@número"
-- de colegas, e usuarios.telefone é restrito a eles: quem só tem whatsapp.read (vendedor) não pode
-- ler o telefone do gestor por aqui.
DROP POLICY IF EXISTS "wa cobrancas leitura" ON public.whatsapp_cobrancas;
CREATE POLICY "wa cobrancas leitura" ON public.whatsapp_cobrancas
  FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'configuracoes.manage'));

REVOKE ALL ON TABLE public.whatsapp_cobrancas FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_cobrancas FROM anon;
-- O padrão do schema dá a tabela nova arwdDxtm ao authenticated: tirar TUDO e devolver só o SELECT
-- (TRUNCATE ignora a RLS e apagaria o histórico que sustenta o teto de 2 e a deduplicação).
REVOKE ALL ON TABLE public.whatsapp_cobrancas FROM authenticated;
GRANT SELECT ON TABLE public.whatsapp_cobrancas TO authenticated;
GRANT ALL ON TABLE public.whatsapp_cobrancas TO service_role;

-- 4a. Pendências ----------------------------------------------------------------------------------
-- Sinais de pedido (medidos no último mês, 136 atendimentos de cliente):
--  * orçamento ligado pela conversa, criado de 2 h antes da abertura em diante (39 atendimentos);
--  * palavra estrita do cliente (26 de 26 eram pedido de verdade); a ampla, com "valor" e "preço",
--    ficou em 83 % e não entra;
--  * a marca pediu_orcamento_em posta por pessoa (botão da onda seguinte).
-- Sem sinal, a linha não sai e nada é cobrado.
CREATE OR REPLACE FUNCTION public.whatsapp_cobranca_pendencias(p_desde timestamptz)
 RETURNS TABLE (
   atendimento_id uuid,
   numero text,
   conversa_id uuid,
   aberto_em timestamptz,
   fechado_em timestamptz,
   fila text,
   conversa_status text,
   resp_atendimento_id uuid,
   resp_conversa_id uuid,
   cliente_nome text,
   pediu_por_palavra_em timestamptz,
   pediu_por_marca_em timestamptz,
   orcamentos jsonb,
   envios_na_conversa timestamptz[],
   dispensado_em timestamptz,
   lead_status text,
   cobrancas jsonb
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT a.id,
         a.numero,
         a.conversa_id,
         a.aberto_em,
         a.fechado_em,
         c.fila::text,
         c.status::text,
         -- Os dois separados: o do atendimento pode ter saído da equipe, e então vale o da conversa.
         a.responsavel_id,
         c.responsavel_id,
         -- Nunca telefone: nome de contato que é só número vira nulo (a regra mostra "Sem nome").
         COALESCE(
           NULLIF(btrim(cl.nome), ''),
           CASE WHEN btrim(c.nome_contato) ~ '^[0-9+()\s.-]*$' THEN NULL
                ELSE NULLIF(btrim(c.nome_contato), '') END
         ),
         pal.em,
         a.pediu_orcamento_em,
         COALESCE(orc.lista, '[]'::jsonb),
         COALESCE(env.lista, ARRAY[]::timestamptz[]),
         a.orcamento_dispensado_em,
         ld.status,
         COALESCE(cob.lista, '[]'::jsonb)
    FROM public.whatsapp_atendimentos a
    JOIN public.whatsapp_conversas c ON c.id = a.conversa_id
    LEFT JOIN public.clientes cl ON cl.id = c.cliente_id
    LEFT JOIN public.leads ld ON ld.id = c.lead_id
    LEFT JOIN LATERAL (
      SELECT min(m.created_at) AS em
        FROM public.whatsapp_mensagens m
       WHERE m.atendimento_id = a.id
         AND m.direcao = 'entrada'
         AND COALESCE(m.origem, 'humano') = 'humano'
         AND m.tipo <> 'sistema'
         AND lower(COALESCE(m.texto, '') || ' ' || COALESCE(m.legenda, ''))
             ~ '(or[cç]amento|quanto custa|quanto fica|quanto sai|quanto seria|cota[cç][aã]o)'
    ) pal ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'id', o.id,
               'numero', o.numero,
               'status', o.status::text,
               'criado_em', o.created_at,
               'enviado_em', o.enviado_em,
               'vendedor_id', o.vendedor_id
             ) ORDER BY o.created_at) AS lista,
             min(o.created_at) FILTER (WHERE o.created_at >= a.aberto_em - interval '2 hours') AS primeiro
        FROM public.orcamentos o
       WHERE o.conversa_id = a.conversa_id
         AND (o.created_at >= a.aberto_em - interval '2 hours'
              OR o.enviado_em >= a.aberto_em - interval '2 hours')
    ) orc ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(m.created_at ORDER BY m.created_at) AS lista
        FROM public.whatsapp_mensagens m
       WHERE m.conversa_id = a.conversa_id
         AND m.direcao = 'saida'
         AND m.created_at >= a.aberto_em - interval '2 hours'
         AND ((COALESCE(m.texto, '') || ' ' || COALESCE(m.legenda, '')) ~* 'segue o or[cç]amento n'
              OR (m.tipo = 'documento'
                  AND (COALESCE(m.storage_path, '') || ' ' || COALESCE(m.payload->>'nome_arquivo', ''))
                      ~* 'or[cç]amento'))
    ) env ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('nivel', w.nivel, 'modo', w.modo, 'em', w.created_at)
                       ORDER BY w.created_at) AS lista
        FROM public.whatsapp_cobrancas w
       WHERE w.atendimento_id = a.id
    ) cob ON true
   WHERE p_desde IS NOT NULL
     AND a.fechado_em IS NULL
     AND a.origem_abertura::text <> 'manual'
     -- Alguém da equipe escrevendo para o número da gráfica não é cliente. Parceiro é cliente.
     AND NOT EXISTS (
       SELECT 1 FROM public.usuarios u
        WHERE u.ativo AND public.is_staff(u.id)
          AND u.telefone IS NOT NULL
          AND public.normalize_whatsapp_phone(u.telefone)
              = COALESCE(c.telefone_normalizado, public.normalize_whatsapp_phone(c.telefone))
     )
     AND LEAST(pal.em, a.pediu_orcamento_em, orc.primeiro) IS NOT NULL
     AND LEAST(pal.em, a.pediu_orcamento_em, orc.primeiro) >= p_desde
   ORDER BY a.aberto_em
$function$;

-- 4b. Equipe citável ------------------------------------------------------------------------------
-- whatsapp_equipe() não serve: filtra por auth.uid(), que o service_role não tem, e não traz
-- telefone. Aqui só pessoa ATIVA com papel de equipe (is_staff); quem saiu nunca aparece.
CREATE OR REPLACE FUNCTION public.whatsapp_cobranca_equipe()
 RETURNS TABLE (id uuid, nome text, telefone text, papeis text[])
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT u.id,
         u.nome,
         NULLIF(btrim(u.telefone), ''),
         ARRAY(SELECT r.role::text FROM public.user_roles r WHERE r.user_id = u.id ORDER BY r.role)
    FROM public.usuarios u
   WHERE u.ativo AND public.is_staff(u.id)
   ORDER BY u.nome
$function$;

-- 4c. Registrar (e, no modo ligada, enfileirar) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_cobranca_registrar(
  p_modo text,
  p_itens jsonb,
  p_texto text,
  p_mencionar text[],
  p_agrupada boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_modo_atual text;
  v_grupo text;
  v_n integer;
  v_primeiro uuid;
  v_chave text;
  v_fila uuid;
BEGIN
  -- Duas rodadas ao mesmo tempo esperam uma a outra.
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_cobranca_registrar'));

  IF p_modo IS NULL OR p_modo NOT IN ('ensaio', 'ligada') THEN
    RAISE EXCEPTION 'cobrança: modo inválido (%)', p_modo;
  END IF;

  SELECT cobranca_modo INTO v_modo_atual FROM public.whatsapp_configuracoes WHERE id;
  IF v_modo_atual IS DISTINCT FROM p_modo THEN
    RETURN jsonb_build_object('registrada', false, 'motivo', 'modo_mudou');
  END IF;

  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RAISE EXCEPTION 'cobrança: texto vazio';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_mencionar, '{}'::text[])) x WHERE x IS NULL OR x !~ '^\d{12,13}$') THEN
    RAISE EXCEPTION 'cobrança: menção inválida (só 12 ou 13 dígitos)';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) < 1 THEN
    RAISE EXCEPTION 'cobrança: nenhum item';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_itens)
             AS i(atendimento_id uuid, conversa_id uuid, nivel smallint, motivo text, minutos_uteis integer)
     WHERE i.atendimento_id IS NULL OR i.conversa_id IS NULL
        OR i.nivel IS NULL OR i.nivel NOT IN (1, 2)
        OR i.motivo IS NULL OR i.motivo NOT IN ('pedido_sem_orcamento', 'orcamento_parado')
        OR i.minutos_uteis IS NULL
  ) THEN
    RAISE EXCEPTION 'cobrança: item incompleto';
  END IF;

  SELECT count(*) INTO v_n FROM jsonb_to_recordset(p_itens) AS i(atendimento_id uuid, nivel smallint);
  IF v_n <> (SELECT count(DISTINCT (i.atendimento_id, i.nivel))
               FROM jsonb_to_recordset(p_itens) AS i(atendimento_id uuid, nivel smallint)) THEN
    RAISE EXCEPTION 'cobrança: item repetido';
  END IF;

  -- Tudo ou nada: se algum já foi cobrado neste modo, nada é gravado.
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_itens) AS i(atendimento_id uuid, nivel smallint)
      JOIN public.whatsapp_cobrancas w
        ON w.atendimento_id = i.atendimento_id AND w.nivel = i.nivel AND w.modo = p_modo
  ) THEN
    RETURN jsonb_build_object('registrada', false, 'motivo', 'ja_registrada');
  END IF;

  -- A trava do destino: não existe parâmetro de destino. Só o grupo da equipe, ligado.
  v_grupo := public.grupo_equipe_destino();
  IF p_modo = 'ligada' AND (v_grupo IS NULL OR v_grupo !~ '^\d{10,}-group$') THEN
    RAISE EXCEPTION 'cobrança recusada: o destino não é o grupo da equipe';
  END IF;

  INSERT INTO public.whatsapp_cobrancas
    (atendimento_id, conversa_id, orcamento_id, nivel, modo, motivo, minutos_uteis, citados,
     texto, destino, agrupada)
  SELECT i.atendimento_id, i.conversa_id, i.orcamento_id, i.nivel, p_modo, i.motivo, i.minutos_uteis,
         -- Nunca o telefone dos colegas no histórico: só id, nome e papel.
         COALESCE(
           (SELECT jsonb_agg(c.value - 'mencao')
              FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(i.citados) = 'array' THEN i.citados ELSE '[]'::jsonb END
                   ) AS c(value)),
           '[]'::jsonb),
         p_texto,
         CASE WHEN p_modo = 'ligada' THEN v_grupo ELSE NULL END,
         COALESCE(p_agrupada, false)
    FROM jsonb_to_recordset(p_itens)
         AS i(atendimento_id uuid, conversa_id uuid, orcamento_id uuid, nivel smallint, motivo text,
              minutos_uteis integer, citados jsonb);

  IF p_modo = 'ligada' THEN
    SELECT (p_itens->0->>'atendimento_id')::uuid INTO v_primeiro;

    IF v_n = 1 THEN
      v_chave := 'cobranca_orcamento:' || (p_itens->0->>'atendimento_id') || ':' || (p_itens->0->>'nivel');
    ELSE
      SELECT 'cobranca_orcamento:lista:'
             || md5(string_agg(i.atendimento_id::text || ':' || i.nivel::text, ','
                               ORDER BY i.atendimento_id, i.nivel))
        INTO v_chave
        FROM jsonb_to_recordset(p_itens) AS i(atendimento_id uuid, nivel smallint);
    END IF;

    v_fila := public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'cobranca_orcamento',
      'whatsapp_atendimento', v_primeiro, 'cobranca_orcamento',
      jsonb_build_object('texto', p_texto, 'mencionar', to_jsonb(COALESCE(p_mencionar, '{}'::text[]))),
      v_chave);

    IF v_fila IS NULL THEN
      -- Chave repetida na fila: o INSERT acima volta junto.
      RAISE EXCEPTION 'cobrança: chave % já está na fila', v_chave;
    END IF;

    UPDATE public.whatsapp_cobrancas w
       SET fila_id = v_fila
      FROM jsonb_to_recordset(p_itens) AS i(atendimento_id uuid, nivel smallint)
     WHERE w.atendimento_id = i.atendimento_id AND w.nivel = i.nivel AND w.modo = p_modo;
  END IF;

  RETURN jsonb_build_object('registrada', true, 'motivo', NULL, 'fila_id', v_fila, 'cobrancas', v_n);
END $function$;

-- 4d. Salvar a configuração (tela do Monitor, por servidor que confere a permissão) ---------------
CREATE OR REPLACE FUNCTION public.whatsapp_cobranca_salvar(p_usuario uuid, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_atual public.whatsapp_configuracoes%ROWTYPE;
  v_modo text;
  v_min_pedido integer;
  v_min_orcamento integer;
  v_min_gestor integer;
  v_sabado boolean;
  v_sabado_fim time;
  v_salva public.whatsapp_configuracoes%ROWTYPE;
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'configuracoes.manage') THEN
    RAISE EXCEPTION 'Configurar a cobrança exige a permissão configuracoes › manage.';
  END IF;

  SELECT * INTO v_atual FROM public.whatsapp_configuracoes WHERE id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração do WhatsApp não encontrada.';
  END IF;

  v_modo := COALESCE(NULLIF(btrim(p_config->>'modo'), ''), v_atual.cobranca_modo);
  IF v_modo NOT IN ('desligada', 'ensaio', 'ligada') THEN
    RAISE EXCEPTION 'Modo da cobrança inválido: use desligada, ensaio ou ligada.';
  END IF;

  v_min_pedido := COALESCE((p_config->>'min_pedido')::integer, v_atual.cobranca_min_pedido);
  v_min_orcamento := COALESCE((p_config->>'min_orcamento')::integer, v_atual.cobranca_min_orcamento);
  v_min_gestor := COALESCE((p_config->>'min_gestor')::integer, v_atual.cobranca_min_gestor);
  IF v_min_pedido NOT BETWEEN 30 AND 1440
     OR v_min_orcamento NOT BETWEEN 30 AND 1440
     OR v_min_gestor NOT BETWEEN 30 AND 1440 THEN
    RAISE EXCEPTION 'Os tempos da cobrança vão de 30 a 1440 minutos úteis.';
  END IF;

  v_sabado := COALESCE((p_config->>'sabado')::boolean, v_atual.cobranca_sabado);
  v_sabado_fim := COALESCE((p_config->>'sabado_fim')::time, v_atual.cobranca_sabado_fim);
  IF NOT (v_sabado_fim > '08:00'::time AND v_sabado_fim <= '18:00'::time) THEN
    RAISE EXCEPTION 'O sábado termina depois das 8h e até as 18h.';
  END IF;

  IF v_modo = 'ligada' AND public.grupo_equipe_destino() IS NULL THEN
    RAISE EXCEPTION 'Para ligar a cobrança, o aviso no grupo da equipe precisa estar ligado e com o id do grupo.';
  END IF;

  UPDATE public.whatsapp_configuracoes SET
    cobranca_modo = v_modo,
    cobranca_min_pedido = v_min_pedido,
    cobranca_min_orcamento = v_min_orcamento,
    cobranca_min_gestor = v_min_gestor,
    cobranca_sabado = v_sabado,
    cobranca_sabado_fim = v_sabado_fim,
    cobranca_ligada_em = CASE WHEN v_modo = 'ligada' AND v_atual.cobranca_modo <> 'ligada'
                              THEN now() ELSE cobranca_ligada_em END,
    cobranca_ensaio_desde = CASE WHEN v_modo = 'ensaio' AND v_atual.cobranca_modo <> 'ensaio'
                                 THEN now() ELSE cobranca_ensaio_desde END,
    updated_at = now(),
    updated_by = p_usuario
  WHERE id
  RETURNING * INTO v_salva;

  RETURN jsonb_build_object(
    'ok', true,
    'modo', v_salva.cobranca_modo,
    'min_pedido', v_salva.cobranca_min_pedido,
    'min_orcamento', v_salva.cobranca_min_orcamento,
    'min_gestor', v_salva.cobranca_min_gestor,
    'sabado', v_salva.cobranca_sabado,
    'sabado_fim', to_char(v_salva.cobranca_sabado_fim, 'HH24:MI'),
    'ligada_em', v_salva.cobranca_ligada_em,
    'ensaio_desde', v_salva.cobranca_ensaio_desde
  );
END $function$;

-- 4e. Gravar o resultado da rodada ----------------------------------------------------------------
-- Sem isto a falha da rodada (grupo desligado, erro de leitura) só ficaria na resposta do
-- net.http_post, que ninguém lê, e o cartão diria "Ligada" com a cobrança parada.
CREATE OR REPLACE FUNCTION public.whatsapp_cobranca_rodada_gravar(p_ok boolean, p_parada text, p_erro text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  UPDATE public.whatsapp_configuracoes
     SET cobranca_rodada_em = now(),
         cobranca_rodada_ok = COALESCE(p_ok, false),
         cobranca_rodada_parada = left(NULLIF(btrim(p_parada), ''), 60),
         cobranca_rodada_erro = left(NULLIF(btrim(p_erro), ''), 300)
   WHERE id
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_cobranca_pendencias(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_cobranca_pendencias(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_cobranca_equipe() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_cobranca_equipe() TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_cobranca_registrar(text, jsonb, text, text[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_cobranca_registrar(text, jsonb, text, text[], boolean) TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_cobranca_rodada_gravar(boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_cobranca_rodada_gravar(boolean, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_cobranca_salvar(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_cobranca_salvar(uuid, jsonb) TO service_role;

-- 5. Modelo ---------------------------------------------------------------------------------------
INSERT INTO public.notificacao_templates (evento, canal, corpo, descricao, ativo)
SELECT 'cobranca_orcamento', 'whatsapp', '{{texto}}',
       'Cobrança de orçamento pendente no grupo da equipe', true
 WHERE NOT EXISTS (SELECT 1 FROM public.notificacao_templates WHERE evento = 'cobranca_orcamento');

-- 6. Job ------------------------------------------------------------------------------------------
-- O mesmo padrão do whatsapp-despachar (cron.job, 12/11): o token vem do Vault na hora de cada
-- chamada. Pode nascer antes do Publish: até a rota existir recebe 404, e o modo nasce desligado.
DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'despachante_token') THEN
    RAISE NOTICE 'cobrança: sem o segredo despachante_token no Vault; job não criado.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-cobrar') THEN
    PERFORM cron.unschedule('whatsapp-cobrar');
  END IF;

  PERFORM cron.schedule(
    'whatsapp-cobrar',
    '*/5 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bexprint.com.br/api/whatsapp/cobrar',
        headers := jsonb_build_object(
          'x-despachante-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'despachante_token'),
          'content-type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )
    $cmd$
  );
END
$job$;
