-- Correção de RAIZ do subsistema de automações.
--
-- Diagnóstico: o frontend (/automacoes), o edge function process-automations e a
-- versão original de enqueue_automacoes concordam entre si num mesmo contrato
-- ("schema pretendido": automacoes.ativo/payload/acao/condicao/cooldown/delay e
-- automacao_execucoes.gatilho/entidade/contexto/payload/status/scheduled_at/
-- tentativas/dedupe_key/processado_em/resposta). A TABELA é que foi criada com
-- outro shape (ativa/condicoes/acoes/canal; referencia_tipo/entrada/resultado),
-- quebrando tudo em runtime. Ambas as tabelas estão VAZIAS (0 linhas) — então
-- migramos as tabelas para o contrato do código, sem migração de dados.
--
-- Substitui os paliativos anteriores (enqueue inerte que só retornava 0).

-- 1) automacoes → contrato do código
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='automacoes' AND column_name='ativa') THEN
    ALTER TABLE public.automacoes RENAME COLUMN ativa TO ativo;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='automacoes' AND column_name='condicoes') THEN
    ALTER TABLE public.automacoes RENAME COLUMN condicoes TO condicao;
  END IF;
END $$;

ALTER TABLE public.automacoes DROP COLUMN IF EXISTS canal;
ALTER TABLE public.automacoes DROP COLUMN IF EXISTS acoes;
ALTER TABLE public.automacoes
  ADD COLUMN IF NOT EXISTS acao text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cooldown_segundos integer NOT NULL DEFAULT 3600,
  ADD COLUMN IF NOT EXISTS delay_segundos integer NOT NULL DEFAULT 0;

-- 2) automacao_execucoes → recriada no contrato do código (estava vazia, sem FKs)
DROP TABLE IF EXISTS public.automacao_execucoes;
CREATE TABLE public.automacao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automacao_id uuid NOT NULL REFERENCES public.automacoes(id) ON DELETE CASCADE,
  gatilho automacao_gatilho NOT NULL,
  entidade text NOT NULL,
  entidade_id uuid,
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','sucesso','erro')),
  tentativas integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  processado_em timestamptz,
  resposta jsonb,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX automacao_execucoes_dedupe_ativa
  ON public.automacao_execucoes(dedupe_key) WHERE status IN ('pendente','processando');
CREATE INDEX automacao_execucoes_pendentes ON public.automacao_execucoes(status, scheduled_at);

GRANT SELECT ON public.automacao_execucoes TO authenticated;
GRANT ALL ON public.automacao_execucoes TO service_role;
ALTER TABLE public.automacao_execucoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automacao exec staff read" ON public.automacao_execucoes;
CREATE POLICY "automacao exec staff read" ON public.automacao_execucoes
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- 3) enqueue_automacoes restaurada ao design original, agora compatível com o
--    schema — com rede de segurança: automação NUNCA bloqueia a operação de origem.
CREATE OR REPLACE FUNCTION public.enqueue_automacoes(p_gatilho automacao_gatilho, p_entidade text, p_entidade_id uuid, p_contexto jsonb DEFAULT '{}'::jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_automacao public.automacoes%ROWTYPE;
  v_dedupe TEXT;
  v_count INT := 0;
BEGIN
  -- automacoes.gatilho é TEXT (não o enum automacao_gatilho) → comparar com cast
  FOR v_automacao IN
    SELECT * FROM public.automacoes WHERE ativo = true AND gatilho = p_gatilho::text
  LOOP
    IF NOT public.automacao_condicao_ok(p_gatilho, COALESCE(v_automacao.condicao, '{}'::jsonb), p_contexto) THEN
      CONTINUE;
    END IF;

    v_dedupe := concat_ws(':', v_automacao.id::text, p_entidade, COALESCE(p_entidade_id::text, 'sem-id'), md5(p_contexto::text));

    IF EXISTS (
      SELECT 1 FROM public.automacao_execucoes e
      WHERE e.automacao_id = v_automacao.id
        AND e.entidade = p_entidade
        AND e.entidade_id IS NOT DISTINCT FROM p_entidade_id
        AND e.status = 'sucesso'
        AND e.processado_em > now() - make_interval(secs => v_automacao.cooldown_segundos)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.automacao_execucoes (automacao_id, gatilho, entidade, entidade_id, scheduled_at, dedupe_key, contexto, payload)
    VALUES (
      v_automacao.id, p_gatilho, p_entidade, p_entidade_id,
      now() + make_interval(secs => v_automacao.delay_segundos),
      v_dedupe, p_contexto, v_automacao.payload
    )
    ON CONFLICT (dedupe_key) WHERE status IN ('pendente','processando') DO NOTHING;

    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_automacoes falhou (%): operação de origem preservada', SQLERRM;
  RETURN 0;
END $function$;
