-- Decisões do dono como avisos que se resolvem (25/10/2026).
--
-- O que fica "com o dono" (acréscimo de frente e verso, convenção da bainha, prazo de reposição…)
-- vivia só na conversa e se perdia. Agora cada decisão é uma linha, aparece como aviso para
-- administrador, gestor e financeiro até alguém responder e marcar como decidido, e a resposta
-- fica guardada com quem respondeu e quando.
--
-- Escrita só pela função `resolver_decisao` (confere o papel); a tabela é só leitura direta.

CREATE TABLE IF NOT EXISTS public.decisoes_pendentes (
  chave text PRIMARY KEY,
  titulo text NOT NULL,
  detalhe text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  resolvida_em timestamptz,
  resolvida_por uuid,
  resposta text
);

ALTER TABLE public.decisoes_pendentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decisoes leem os tres" ON public.decisoes_pendentes;
CREATE POLICY "decisoes leem os tres" ON public.decisoes_pendentes
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'gestor')
    OR public.has_role((SELECT auth.uid()), 'financeiro')
  );

COMMENT ON TABLE public.decisoes_pendentes IS
  'Decisões que dependem do dono. Aparecem como aviso até serem marcadas como decididas (resolver_decisao).';

INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe) VALUES
  ('frente_e_verso', 'Acréscimo de frente e verso',
   'Quanto a mais custa imprimir frente e verso (e a ventosa no banner). Sem o valor a opção não entra no orçamento, para não orçar abaixo do custo.'),
  ('convencao_da_bainha', 'Convenção da bainha',
   'O sistema sugere o contorno todo na lona e os dois lados menores no banner. Confirme se é a regra da casa.'),
  ('prazo_de_reposicao', 'Prazo de reposição dos rolos',
   'Dias entre pedir ao fornecedor e o rolo chegar. Com o estoque cheio de cada rolo, dá o aviso de compra a 15%.'),
  ('fila_no_expresso', 'Fila de produção no expresso',
   'A promessa do expresso conta a fila que já existe ou o expresso é por ordem de chegada?'),
  ('rolo_de_vinil_mais_largo', 'Rolo de vinil mais largo que 1,06 m',
   'Se existir, as peças acima de 1,06 m deixam de precisar de emenda.'),
  ('tempos_de_mao_de_obra', 'Tempos reais de mão de obra',
   'Cronometrar uma lona com bainha e ilhós e a decapagem de um adesivo com recorte; hoje são estimativas.')
ON CONFLICT (chave) DO NOTHING;

-- Já decidida em 25/10/2026: fica registrada para a história.
INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe, resolvida_em, resposta) VALUES
  ('margem_da_tabela', 'Preços da tabela abaixo da margem mínima',
   'Com os preços da tabela de terceirizados, adesivo TOP e lona PROMO ficam abaixo da margem mínima cadastrada.',
   now(), 'Mantida a tabela do WhatsApp como está (decisão de 25/10/2026).')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.resolver_decisao(p_chave text, p_resposta text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (
       public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gestor')
    OR public.has_role(auth.uid(), 'financeiro')
  ) THEN
    RAISE EXCEPTION 'Só administrador, gestor e financeiro resolvem decisões.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.decisoes_pendentes
     SET resolvida_em = now(), resolvida_por = auth.uid(), resposta = NULLIF(btrim(p_resposta), '')
   WHERE chave = p_chave AND resolvida_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Decisão não encontrada ou já resolvida.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolver_decisao(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_decisao(text, text) TO authenticated;

-- O aviso: uma linha só, com o que falta decidir; mesma forma de saída das outras pendências.
CREATE OR REPLACE FUNCTION public.pendencias_de_decisoes()
RETURNS TABLE(chave text, titulo text, quantidade integer, total integer, severidade text,
              quem_resolve text, o_que_fazer text, link text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT (
       public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gestor')
    OR public.has_role(auth.uid(), 'financeiro')
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT 'decisoes_do_dono', 'Decisões do dono que travam números e preços', count(*)::int,
    (SELECT count(*)::int FROM public.decisoes_pendentes), 'atencao', 'gestao',
    'Faltam decidir: ' || string_agg(d.titulo, '; ' ORDER BY d.criada_em, d.chave) ||
    '. Abra Dados da empresa, em Decisões do dono, responda e marque como decidido.',
    '/configuracoes-empresa'
  FROM public.decisoes_pendentes d WHERE d.resolvida_em IS NULL HAVING count(*) > 0;
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.pendencias_de_decisoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pendencias_de_decisoes() TO authenticated;

NOTIFY pgrst, 'reload schema';
