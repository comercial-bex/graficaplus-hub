-- Jobs do Flexi importados (24/10/2026) — fase 1 do plano docs/plano-importacao-flexi.md.
-- O Flexi (FlexiPRINT) é a fonte do FATO "isto saiu da plotter". Aqui só se
-- GUARDA esse fato: não cria OS, não liga orçamento, não baixa estoque. O
-- vínculo com orçamento/OS e a baixa de bobina são as fases 2 e 3.
--
-- rip_importacoes: um lote por importação (quem, quando, quantas linhas).
-- rip_jobs: um registro por job impresso. Chave = máquina + dia/hora da saída +
--   medidas + cópias (SEM o nome: o nome sai cortado no print, e o mesmo job num
--   print com a coluna mais larga seria outro registro). Importar o mesmo job
--   outra vez não duplica; só atualiza status e nome (o nome mais longo vence).
--
-- Escrita: só pela função importar_flexi_jobs(), que o servidor chama com a
-- chave de serviço depois de conferir a permissão. A função confere de novo —
-- duas trancas, como na caixa do WhatsApp. Nenhuma policy de escrita: o
-- navegador não grava aqui. Leitura: quem vê produção ou estoque.
--
-- Desfazer: DROP FUNCTION public.importar_flexi_jobs(uuid, uuid, text, jsonb);
--           DROP TABLE public.rip_jobs; DROP TABLE public.rip_importacoes;

CREATE TABLE public.rip_importacoes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte                text NOT NULL DEFAULT 'flexi',
  origem               text NOT NULL CHECK (origem IN ('print', 'arquivo', 'agente')),
  maquina_id           uuid NOT NULL REFERENCES public.maquinas(id),
  usuario_id           uuid,
  linhas_lidas         integer NOT NULL DEFAULT 0,
  linhas_novas         integer NOT NULL DEFAULT 0,
  linhas_atualizadas   integer NOT NULL DEFAULT 0,
  linhas_iguais        integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rip_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte          text NOT NULL DEFAULT 'flexi',
  chave_externa  text NOT NULL,
  importacao_id  uuid REFERENCES public.rip_importacoes(id),
  maquina_id     uuid NOT NULL REFERENCES public.maquinas(id),
  nome_job       text NOT NULL,
  status_flexi   text NOT NULL CHECK (status_flexi IN ('concluido', 'abortado', 'mantendo', 'outro')),
  autor          text,
  largura_cm     numeric(10, 3) NOT NULL CHECK (largura_cm > 0),
  altura_cm      numeric(10, 3) NOT NULL CHECK (altura_cm > 0),
  copias         integer NOT NULL CHECK (copias >= 1),
  area_m2        numeric(12, 4) NOT NULL CHECK (area_m2 > 0),
  tipo_arquivo   text,
  tamanho_kb     numeric(12, 1),
  perfil_icc     text,
  cores          text,
  apos_saida     text,
  impresso_em    timestamptz NOT NULL,
  aninhado       boolean NOT NULL DEFAULT false,
  pai_chave      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (maquina_id, chave_externa)
);

CREATE INDEX rip_jobs_impresso_em_idx ON public.rip_jobs (impresso_em DESC);

ALTER TABLE public.rip_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rip_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY rip_importacoes_ler ON public.rip_importacoes FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'producao.read') OR public.has_permission(auth.uid(), 'estoque.read'));
CREATE POLICY rip_jobs_ler ON public.rip_jobs FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'producao.read') OR public.has_permission(auth.uid(), 'estoque.read'));

REVOKE ALL ON public.rip_importacoes, public.rip_jobs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.rip_importacoes, public.rip_jobs FROM authenticated;
GRANT SELECT ON public.rip_importacoes, public.rip_jobs TO authenticated;

CREATE OR REPLACE FUNCTION public.importar_flexi_jobs(
  p_usuario uuid, p_maquina_id uuid, p_origem text, p_linhas jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_imp uuid;
  v_inserido boolean;
  v_lidas integer := 0;
  v_novas integer := 0;
  v_atual integer := 0;
  v_iguais integer := 0;
BEGIN
  IF p_usuario IS NULL
     OR NOT (public.has_permission(p_usuario, 'producao.finish') OR public.has_permission(p_usuario, 'estoque.exit')) THEN
    RAISE EXCEPTION 'Seu perfil não importa jobs do Flexi.' USING ERRCODE = '42501';
  END IF;
  IF p_origem NOT IN ('print', 'arquivo', 'agente') THEN
    RAISE EXCEPTION 'Origem da importação inválida.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.maquinas WHERE id = p_maquina_id AND tipo = 'plotter_impressao') THEN
    RAISE EXCEPTION 'A máquina escolhida não é uma plotter de impressão.' USING ERRCODE = '22023';
  END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha para importar.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_linhas) > 300 THEN
    RAISE EXCEPTION 'Mais de 300 linhas: importe em partes.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rip_importacoes (origem, maquina_id, usuario_id)
  VALUES (p_origem, p_maquina_id, p_usuario) RETURNING id INTO v_imp;

  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_linhas) AS x(
      chave text, nome text, status text, autor text, largura_cm numeric, altura_cm numeric,
      copias integer, area_m2 numeric, tipo_arquivo text, tamanho_kb numeric, perfil_icc text,
      cores text, apos_saida text, impresso_em timestamptz, aninhado boolean, pai_chave text)
  LOOP
    v_lidas := v_lidas + 1;
    INSERT INTO public.rip_jobs AS j (
      chave_externa, importacao_id, maquina_id, nome_job, status_flexi, autor, largura_cm, altura_cm,
      copias, area_m2, tipo_arquivo, tamanho_kb, perfil_icc, cores, apos_saida, impresso_em, aninhado, pai_chave)
    VALUES (
      r.chave, v_imp, p_maquina_id, left(r.nome, 200), r.status, left(r.autor, 60), r.largura_cm, r.altura_cm,
      r.copias, r.area_m2, left(r.tipo_arquivo, 60), r.tamanho_kb, left(r.perfil_icc, 80), left(r.cores, 40),
      left(r.apos_saida, 30), r.impresso_em, COALESCE(r.aninhado, false), r.pai_chave)
    ON CONFLICT (maquina_id, chave_externa) DO UPDATE
      SET status_flexi = EXCLUDED.status_flexi,
          nome_job = CASE WHEN length(EXCLUDED.nome_job) > length(j.nome_job) THEN EXCLUDED.nome_job ELSE j.nome_job END,
          apos_saida = COALESCE(EXCLUDED.apos_saida, j.apos_saida),
          updated_at = now()
      WHERE j.status_flexi IS DISTINCT FROM EXCLUDED.status_flexi
         OR length(EXCLUDED.nome_job) > length(j.nome_job)
         OR (EXCLUDED.apos_saida IS NOT NULL AND j.apos_saida IS DISTINCT FROM EXCLUDED.apos_saida)
    RETURNING (xmax = 0) INTO v_inserido;

    IF NOT FOUND THEN
      v_iguais := v_iguais + 1;
    ELSIF v_inserido THEN
      v_novas := v_novas + 1;
    ELSE
      v_atual := v_atual + 1;
    END IF;
  END LOOP;

  UPDATE public.rip_importacoes
     SET linhas_lidas = v_lidas, linhas_novas = v_novas, linhas_atualizadas = v_atual, linhas_iguais = v_iguais
   WHERE id = v_imp;

  RETURN jsonb_build_object('importacao_id', v_imp, 'lidas', v_lidas, 'novas', v_novas,
                            'atualizadas', v_atual, 'iguais', v_iguais);
END
$function$;
REVOKE ALL ON FUNCTION public.importar_flexi_jobs(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_flexi_jobs(uuid, uuid, text, jsonb) TO service_role;
