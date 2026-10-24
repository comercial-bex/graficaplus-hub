-- Vínculo do job do Flexi com o orçamento (24/10/2026) — fase 2 de docs/plano-importacao-flexi.md.
-- O sistema SUGERE (por número no nome ou por medida/cópias/data); uma PESSOA confirma.
-- Nada aqui baixa estoque nem cria OS: a baixa de bobina é a fase 3 e só olha vínculo
-- `confirmado`.
--
-- rip_job_vinculos: no máximo UM por job. Estados:
--   sugerido      o sistema achou um candidato que se destaca (a pessoa ainda não viu)
--   revisar       há candidatos, nenhum se destaca: a pessoa escolhe
--   confirmado    a pessoa confirmou (é o único que a fase 3 vai usar)
--   recusado      a pessoa disse que a sugestão está errada: nunca é sobrescrito
--   sem_orcamento a pessoa disse que o job não é de orçamento (prova, teste, terceirizado)
-- Guarda uma FOTO do número, título e descrição do orçamento, porque o operador
-- (que não lê orçamento) precisa ver o que confirmou, e porque o item do orçamento
-- pode ser refeito na edição: as chaves viram NULL (ON DELETE SET NULL), a foto fica.
--
-- Escrita: só pelas funções abaixo, que o servidor chama com a chave de serviço
-- depois de conferir a permissão; as funções conferem de novo. Leitura: quem vê
-- produção ou estoque.
--
-- Desfazer: DROP FUNCTION public.rip_decidir_vinculo(uuid, uuid, text, uuid, text);
--           DROP FUNCTION public.rip_gravar_sugestoes(uuid, jsonb);
--           DROP TABLE public.rip_job_vinculos;

CREATE TABLE public.rip_job_vinculos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rip_job_id          uuid NOT NULL UNIQUE REFERENCES public.rip_jobs(id) ON DELETE CASCADE,
  estado              text NOT NULL CHECK (estado IN ('sugerido', 'revisar', 'confirmado', 'recusado', 'sem_orcamento')),
  origem              text CHECK (origem IN ('numero_no_nome', 'medida', 'manual')),
  orcamento_id        uuid REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  orcamento_item_id   uuid REFERENCES public.orcamento_itens(id) ON DELETE SET NULL,
  os_id               uuid REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  orcamento_numero    integer,
  orcamento_titulo    text,
  item_descricao      text,
  confianca           numeric(3, 2) CHECK (confianca IS NULL OR (confianca >= 0 AND confianca <= 1)),
  motivos             text[] NOT NULL DEFAULT '{}',
  candidatos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivo_sem_orcamento text CHECK (motivo_sem_orcamento IS NULL OR motivo_sem_orcamento IN ('prova', 'teste', 'terceirizado', 'outro')),
  decidido_por        uuid,
  decidido_em         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- confirmado sem orçamento seria um vínculo que não liga a nada
  CONSTRAINT rip_job_vinculos_confirmado_tem_orcamento CHECK (estado <> 'confirmado' OR orcamento_numero IS NOT NULL),
  CONSTRAINT rip_job_vinculos_sem_orcamento_tem_motivo CHECK ((estado = 'sem_orcamento') = (motivo_sem_orcamento IS NOT NULL))
);

CREATE INDEX rip_job_vinculos_estado_idx ON public.rip_job_vinculos (estado);

ALTER TABLE public.rip_job_vinculos ENABLE ROW LEVEL SECURITY;
CREATE POLICY rip_job_vinculos_ler ON public.rip_job_vinculos FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'producao.read') OR public.has_permission(auth.uid(), 'estoque.read'));
REVOKE ALL ON public.rip_job_vinculos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.rip_job_vinculos FROM authenticated;
GRANT SELECT ON public.rip_job_vinculos TO authenticated;

-- Grava as sugestões do servidor. Só mexe em job SEM vínculo ou com vínculo ainda
-- `sugerido`/`revisar`: confirmado, recusado e sem_orcamento são decisão de pessoa
-- e nunca são sobrescritos.
CREATE OR REPLACE FUNCTION public.rip_gravar_sugestoes(p_usuario uuid, p_sugestoes jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_n integer := 0;
  v_ignoradas integer := 0;
  v_orc_id uuid;
  v_numero integer;
  v_titulo text;
  v_os uuid;
  v_item_id uuid;
  v_desc text;
BEGIN
  IF p_usuario IS NULL
     OR NOT (public.has_permission(p_usuario, 'producao.finish') OR public.has_permission(p_usuario, 'estoque.exit')) THEN
    RAISE EXCEPTION 'Seu perfil não vincula jobs do Flexi.' USING ERRCODE = '42501';
  END IF;
  IF p_sugestoes IS NULL OR jsonb_typeof(p_sugestoes) <> 'array' THEN
    RAISE EXCEPTION 'Sugestões inválidas.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_sugestoes) > 300 THEN
    RAISE EXCEPTION 'Mais de 300 sugestões: envie em partes.' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_sugestoes) AS x(
      rip_job_id uuid, estado text, origem text, orcamento_item_id uuid,
      confianca numeric, motivos jsonb, candidatos jsonb)
  LOOP
    IF r.estado NOT IN ('sugerido', 'revisar') OR r.origem NOT IN ('numero_no_nome', 'medida') THEN
      RAISE EXCEPTION 'Estado ou origem da sugestão inválidos.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rip_jobs WHERE id = r.rip_job_id) THEN
      v_ignoradas := v_ignoradas + 1;
      CONTINUE;
    END IF;

    v_orc_id := NULL; v_numero := NULL; v_titulo := NULL; v_os := NULL; v_item_id := NULL; v_desc := NULL;
    IF r.estado = 'sugerido' THEN
      SELECT o.id, o.numero, o.titulo, o.os_id, i.id, i.descricao
        INTO v_orc_id, v_numero, v_titulo, v_os, v_item_id, v_desc
        FROM public.orcamento_itens i JOIN public.orcamentos o ON o.id = i.orcamento_id
       WHERE i.id = r.orcamento_item_id;
      IF NOT FOUND THEN
        v_ignoradas := v_ignoradas + 1;
        CONTINUE;
      END IF;
    END IF;

    INSERT INTO public.rip_job_vinculos AS v (
      rip_job_id, estado, origem, orcamento_id, orcamento_item_id, os_id,
      orcamento_numero, orcamento_titulo, item_descricao, confianca, motivos, candidatos)
    VALUES (
      r.rip_job_id, r.estado, r.origem, v_orc_id, v_item_id, v_os,
      v_numero, left(v_titulo, 200), left(v_desc, 300), r.confianca,
      COALESCE((SELECT array_agg(m) FROM jsonb_array_elements_text(COALESCE(r.motivos, '[]'::jsonb)) m), '{}'),
      COALESCE(r.candidatos, '[]'::jsonb))
    ON CONFLICT (rip_job_id) DO UPDATE
      SET estado = EXCLUDED.estado, origem = EXCLUDED.origem, orcamento_id = EXCLUDED.orcamento_id,
          orcamento_item_id = EXCLUDED.orcamento_item_id, os_id = EXCLUDED.os_id,
          orcamento_numero = EXCLUDED.orcamento_numero, orcamento_titulo = EXCLUDED.orcamento_titulo,
          item_descricao = EXCLUDED.item_descricao, confianca = EXCLUDED.confianca,
          motivos = EXCLUDED.motivos, candidatos = EXCLUDED.candidatos, updated_at = now()
      WHERE v.estado IN ('sugerido', 'revisar');
    IF FOUND THEN v_n := v_n + 1; ELSE v_ignoradas := v_ignoradas + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('gravadas', v_n, 'ignoradas', v_ignoradas);
END
$function$;

-- A decisão da pessoa. `reabrir` apaga o vínculo para o job voltar à fila; depois
-- da fase 3, reabrir um `confirmado` precisa estornar a baixa feita por ele.
CREATE OR REPLACE FUNCTION public.rip_decidir_vinculo(
  p_usuario uuid, p_rip_job_id uuid, p_acao text, p_orcamento_item_id uuid, p_motivo text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
  v_atual public.rip_job_vinculos%ROWTYPE;
  v_origem text;
BEGIN
  IF p_usuario IS NULL
     OR NOT (public.has_permission(p_usuario, 'producao.finish') OR public.has_permission(p_usuario, 'estoque.exit')) THEN
    RAISE EXCEPTION 'Seu perfil não vincula jobs do Flexi.' USING ERRCODE = '42501';
  END IF;
  IF p_acao NOT IN ('confirmar', 'recusar', 'sem_orcamento', 'reabrir') THEN
    RAISE EXCEPTION 'Ação inválida.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rip_jobs WHERE id = p_rip_job_id) THEN
    RAISE EXCEPTION 'Job não encontrado.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.rip_job_vinculos WHERE rip_job_id = p_rip_job_id;

  IF p_acao = 'reabrir' THEN
    DELETE FROM public.rip_job_vinculos WHERE rip_job_id = p_rip_job_id;
    RETURN jsonb_build_object('estado', NULL);
  END IF;

  IF p_acao = 'confirmar' THEN
    SELECT o.id AS orcamento_id, o.numero, o.titulo, o.os_id, i.id AS item_id, i.descricao
      INTO v_item
      FROM public.orcamento_itens i JOIN public.orcamentos o ON o.id = i.orcamento_id
     WHERE i.id = p_orcamento_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de orçamento não encontrado.' USING ERRCODE = '22023';
    END IF;
    -- Origem: a da sugestão, se a pessoa escolheu um dos candidatos; senão, manual.
    v_origem := CASE
      WHEN v_atual.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_atual.candidatos) c WHERE c->>'itemId' = p_orcamento_item_id::text
      ) THEN v_atual.origem ELSE 'manual' END;

    INSERT INTO public.rip_job_vinculos AS v (
      rip_job_id, estado, origem, orcamento_id, orcamento_item_id, os_id,
      orcamento_numero, orcamento_titulo, item_descricao, decidido_por, decidido_em)
    VALUES (
      p_rip_job_id, 'confirmado', v_origem, v_item.orcamento_id, v_item.item_id, v_item.os_id,
      v_item.numero, left(v_item.titulo, 200), left(v_item.descricao, 300), p_usuario, now())
    ON CONFLICT (rip_job_id) DO UPDATE
      SET estado = 'confirmado', origem = EXCLUDED.origem, orcamento_id = EXCLUDED.orcamento_id,
          orcamento_item_id = EXCLUDED.orcamento_item_id, os_id = EXCLUDED.os_id,
          orcamento_numero = EXCLUDED.orcamento_numero, orcamento_titulo = EXCLUDED.orcamento_titulo,
          item_descricao = EXCLUDED.item_descricao, motivo_sem_orcamento = NULL,
          decidido_por = p_usuario, decidido_em = now(), updated_at = now();
    RETURN jsonb_build_object('estado', 'confirmado', 'orcamento_numero', v_item.numero);
  END IF;

  IF p_acao = 'sem_orcamento' THEN
    IF p_motivo IS NULL OR p_motivo NOT IN ('prova', 'teste', 'terceirizado', 'outro') THEN
      RAISE EXCEPTION 'Diga por que o job não tem orçamento (prova, teste, terceirizado ou outro).' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.rip_job_vinculos AS v (rip_job_id, estado, origem, motivo_sem_orcamento, decidido_por, decidido_em)
    VALUES (p_rip_job_id, 'sem_orcamento', 'manual', p_motivo, p_usuario, now())
    ON CONFLICT (rip_job_id) DO UPDATE
      SET estado = 'sem_orcamento', origem = 'manual', motivo_sem_orcamento = p_motivo,
          orcamento_id = NULL, orcamento_item_id = NULL, os_id = NULL, orcamento_numero = NULL,
          orcamento_titulo = NULL, item_descricao = NULL, confianca = NULL,
          decidido_por = p_usuario, decidido_em = now(), updated_at = now();
    RETURN jsonb_build_object('estado', 'sem_orcamento');
  END IF;

  -- recusar: a sugestão está errada. Fica registrado para nunca ser sugerida de novo.
  INSERT INTO public.rip_job_vinculos AS v (rip_job_id, estado, origem, decidido_por, decidido_em)
  VALUES (p_rip_job_id, 'recusado', 'manual', p_usuario, now())
  ON CONFLICT (rip_job_id) DO UPDATE
    SET estado = 'recusado', orcamento_id = NULL, orcamento_item_id = NULL, os_id = NULL,
        orcamento_numero = NULL, orcamento_titulo = NULL, item_descricao = NULL,
        motivo_sem_orcamento = NULL, decidido_por = p_usuario, decidido_em = now(), updated_at = now();
  RETURN jsonb_build_object('estado', 'recusado');
END
$function$;

REVOKE ALL ON FUNCTION public.rip_gravar_sugestoes(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rip_gravar_sugestoes(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.rip_decidir_vinculo(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rip_decidir_vinculo(uuid, uuid, text, uuid, text) TO service_role;
