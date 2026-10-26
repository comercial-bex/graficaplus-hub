-- Decisões do dono (27/10/2026), todas já aplicadas no banco ao vivo:
--   1. Prazo sugerido: mantidos os 5 dias úteis.
--   2. Sinal em Pix para converter: SIM. Pagamento combinado em Pix só vira OS com "O Pix chegou".
--      O envio do orçamento manda o QR Code e o copia e cola do sinal (1ª parcela, ou 50% à vista)
--      e pede o comprovante; o comprovante que chega pelo WhatsApp vira anexo do orçamento.
--   3. Lembrete de 48 h: não sai sozinho; continua por clique.
--   4. Atendimento (perfil vendedor) dá baixa, muda status, finaliza e mexe no kanban — tudo com
--      autor no histórico.
--   5. As 25 cascas (rejeitado/expirado, valor zero, sem item, sem OS) foram apagadas.

UPDATE public.decisoes_pendentes SET resolvida_em = COALESCE(resolvida_em, now()), resolvida_por = COALESCE(resolvida_por, '6e6693f1-ea58-42b8-acf6-46fae959566a'),
  resposta = COALESCE(resposta, 'Mantido: 5 dias úteis (chave prazo_entrega_padrao_dias).')
 WHERE chave = 'prazo_entrega_padrao_5_dias_uteis';
UPDATE public.decisoes_pendentes SET resolvida_em = COALESCE(resolvida_em, now()), resolvida_por = COALESCE(resolvida_por, '6e6693f1-ea58-42b8-acf6-46fae959566a'),
  resposta = COALESCE(resposta, 'Sim: pagamento combinado em Pix só vira OS com o sinal marcado como recebido. O envio do orçamento já manda a chave, o QR Code e pede o comprovante.')
 WHERE chave = 'sinal_para_converter_em_os';
UPDATE public.decisoes_pendentes SET resolvida_em = COALESCE(resolvida_em, now()), resolvida_por = COALESCE(resolvida_por, '6e6693f1-ea58-42b8-acf6-46fae959566a'),
  resposta = COALESCE(resposta, 'Não sai sozinho: o lembrete continua por clique do atendimento (botão "Lembrar o cliente" após 48 h).')
 WHERE chave = 'lembrete_48h_orcamento_sem_resposta';

INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT 'vendedor', p FROM unnest(ARRAY['os.update','os.status.advance','os.close','pagamentos.create','pagamentos.confirm','kanban.read','kanban.move']) p
WHERE NOT EXISTS (SELECT 1 FROM public.perfil_permissoes x WHERE x.perfil = 'vendedor' AND x.permissao = p);

ALTER TABLE public.orcamento_comprovantes ADD COLUMN IF NOT EXISTS bucket text NOT NULL DEFAULT 'comprovantes';

DO $sinal$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_em_os(uuid, jsonb)'::regprocedure);
  v_de text := $a$  -- (b2) item livre sem custo não vira OS (22/10/2026)$a$;
  v_para text := $b$  -- (b3) Sinal em Pix (decisão do dono, 27/10/2026): pagamento combinado em Pix só vira OS com o
  -- sinal marcado como recebido ("O Pix chegou" no orçamento, com extrato ou comprovante conferido).
  IF lower(COALESCE(v_orc.condicao_pagamento->>'forma', '')) = 'pix'
     AND COALESCE((v_orc.condicao_pagamento->'pix_recebido'->>'valor')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'Sinal em Pix ainda não marcado como recebido. Confira o extrato ou o comprovante e marque "O Pix chegou" no orçamento; depois converta.'
      USING ERRCODE = 'P0001';
  END IF;

  -- (b2) item livre sem custo não vira OS (22/10/2026)$b$;
BEGIN
  IF position('(b3) Sinal em Pix' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: a âncora (b2) não está como esperado';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$sinal$;

CREATE OR REPLACE FUNCTION public.anexar_comprovante_recebido(p_conversa_id uuid, p_caminho text, p_nome text, p_mime text, p_tamanho bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_conv record; v_orc record; v_id uuid;
BEGIN
  IF p_mime IS NULL OR NOT (p_mime ILIKE 'image/%' OR p_mime ILIKE 'application/pdf') THEN
    RETURN jsonb_build_object('anexado', false, 'motivo', 'não é imagem nem PDF');
  END IF;
  SELECT cliente_id, telefone_normalizado INTO v_conv FROM public.whatsapp_conversas WHERE id = p_conversa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('anexado', false, 'motivo', 'conversa não encontrada'); END IF;

  -- O orçamento que pediu o comprovante: Pix do sinal enviado nos últimos 10 dias e ainda sem "Pix chegou".
  SELECT o.id, o.numero INTO v_orc
    FROM public.orcamentos o
   WHERE o.status::text IN ('enviado', 'aprovado')
     AND o.os_id IS NULL
     AND (o.condicao_pagamento->'pix_enviado'->>'em')::timestamptz > now() - interval '10 days'
     AND COALESCE((o.condicao_pagamento->'pix_recebido'->>'valor')::numeric, 0) <= 0
     AND ((v_conv.cliente_id IS NOT NULL AND o.cliente_id = v_conv.cliente_id)
          OR (v_conv.telefone_normalizado IS NOT NULL
              AND public.normalize_whatsapp_phone(o.contato_telefone) = v_conv.telefone_normalizado))
   ORDER BY (o.condicao_pagamento->'pix_enviado'->>'em')::timestamptz DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('anexado', false, 'motivo', 'nenhum orçamento esperando comprovante'); END IF;
  IF EXISTS (SELECT 1 FROM public.orcamento_comprovantes c WHERE c.caminho = p_caminho) THEN
    RETURN jsonb_build_object('anexado', false, 'motivo', 'já anexado', 'orcamento_id', v_orc.id);
  END IF;

  INSERT INTO public.orcamento_comprovantes (orcamento_id, caminho, nome, mime_type, tamanho_bytes, origem, enviado_por, bucket)
  VALUES (v_orc.id, p_caminho, COALESCE(NULLIF(btrim(p_nome), ''), 'comprovante'), p_mime, p_tamanho, 'cliente', NULL, 'whatsapp-midias')
  RETURNING id INTO v_id;
  INSERT INTO public.eventos_negocio (entidade, entidade_id, cliente_id, tipo, titulo, descricao)
  VALUES ('orcamento', v_orc.id, v_conv.cliente_id, 'comprovante_recebido_pelo_whatsapp', 'Comprovante chegou pelo WhatsApp',
          COALESCE(p_nome, 'arquivo') || ' — confira e marque "O Pix chegou".');
  RETURN jsonb_build_object('anexado', true, 'orcamento_id', v_orc.id, 'comprovante_id', v_id, 'numero', v_orc.numero);
END $function$;

REVOKE ALL ON FUNCTION public.anexar_comprovante_recebido(uuid, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anexar_comprovante_recebido(uuid, text, text, text, bigint) TO service_role;
COMMENT ON FUNCTION public.anexar_comprovante_recebido(uuid, text, text, text, bigint) IS 'Webhook: imagem/PDF recebido numa conversa cujo cliente tem orçamento com Pix do sinal enviado (10 dias) e sem "Pix chegou" vira comprovante do orçamento. Nunca lança.';
