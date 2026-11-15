-- PROPOSTA NÃO APLICADA — 15/11/2026. Depende do pacote parceiro_sempre_atendido.
-- Nenhum envio/backfill/publicação nesta preparação. Funções chamadas somente por ação humana.
-- Templates são configuração deste pacote. Alterar parceiro_acesso também afeta pendentes
-- que usam esse modelo; nenhuma fila/destinatário é alterado e nada é enviado agora.
-- Janela conservadora: enfileiramento/reserva já bloqueia outro aviso, mesmo falha;
-- cancelados não contam. Evita dois avisos na fila antes do primeiro envio.
-- has_function_privilege vivo: require_permission/has_permission = authenticated+service_role;
-- enfileirar_notificacao = só service_role. Funções novas inexistem; DO confere após aplicar.
-- Reversão no fim, comentada. Sem controle externo de transação.
CREATE TABLE public.parceiro_avisos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), titulo text NOT NULL, texto text NOT NULL,
 publico text NOT NULL CHECK (publico IN ('ativos','sem_compra','com_credito','terceirizados')),
 status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviado','cancelado')),
 criado_por uuid REFERENCES public.usuarios(id), enviado_por uuid REFERENCES public.usuarios(id),
 enviado_em timestamptz, total integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.parceiro_avisos TO authenticated;
GRANT ALL ON public.parceiro_avisos TO service_role;
ALTER TABLE public.parceiro_avisos ENABLE ROW LEVEL SECURITY;
CREATE POLICY parceiro_avisos_leitura ON public.parceiro_avisos FOR SELECT TO authenticated
 USING (public.has_permission(auth.uid(),'parceiros.read'));
CREATE TABLE public.parceiro_aviso_envios (
 aviso_id uuid NOT NULL REFERENCES public.parceiro_avisos(id),
 parceiro_id uuid NOT NULL REFERENCES public.parceiros(id),
 notificacao_id uuid NOT NULL REFERENCES public.notificacoes_fila(id),
 UNIQUE(aviso_id,parceiro_id)
);
GRANT SELECT ON public.parceiro_aviso_envios TO authenticated;
GRANT ALL ON public.parceiro_aviso_envios TO service_role;
ALTER TABLE public.parceiro_aviso_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY parceiro_aviso_envios_leitura ON public.parceiro_aviso_envios FOR SELECT TO authenticated
 USING (public.has_permission(auth.uid(),'parceiros.read'));
ALTER TABLE public.parceiros ADD COLUMN nao_receber_avisos_em timestamptz,
 ADD COLUMN validado_por uuid REFERENCES public.usuarios(id), ADD COLUMN validacao_nota text;

-- Saldo efetivamente disponível, sem escrita/expiração durante a prévia.
-- Mesma dedução de expirados ainda não lançados usada por parceiro_expirar_creditos.
CREATE FUNCTION public._parceiro_aviso_publico(p_publico text)
RETURNS TABLE(id uuid,nome text,telefone text,credito numeric,comprou boolean,ultimo_aviso timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p.id, coalesce(nullif(btrim(p.marca_nome),''),c.nome,'Parceiro'),
 public._parceiro_celular(p.id), s.disponivel, b.comprou,
 (SELECT max(coalesce(f.enviado_em,f.created_at)) FROM public.parceiro_aviso_envios e
 JOIN public.notificacoes_fila f ON f.id=e.notificacao_id
 WHERE e.parceiro_id=p.id AND f.status<>'cancelado')
 FROM public.parceiros p LEFT JOIN public.clientes c ON c.id=p.cliente_id
 CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.orcamentos o
 WHERE o.cliente_id=p.cliente_id AND o.status::text IN ('aprovado','convertido')) AS comprou) b
 CROSS JOIN LATERAL (SELECT greatest(coalesce(sum(pc.valor),0)-greatest(least(coalesce(sum(pc.valor),0),
  coalesce(sum(pc.valor) FILTER(WHERE pc.valor>0 AND pc.expira_em<=now()),0)
 -coalesce(-sum(pc.valor) FILTER(WHERE pc.valor<0 AND pc.tipo<>'expirado'),0)
 -coalesce(-sum(pc.valor) FILTER(WHERE pc.tipo='expirado'),0)),0),0) AS disponivel
 FROM public.parceiro_creditos pc WHERE pc.parceiro_id=p.id) s
 WHERE p.status='ativo' AND p.nao_receber_avisos_em IS NULL
 AND public._parceiro_celular(p.id) IS NOT NULL
 AND (p_publico='ativos' OR (p_publico='sem_compra' AND NOT b.comprou)
 OR (p_publico='com_credito' AND s.disponivel>0)
 OR (p_publico='terceirizados' AND b.comprou))
 ORDER BY 2,p.id
$$;
REVOKE ALL ON FUNCTION public._parceiro_aviso_publico(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._parceiro_aviso_publico(text) TO service_role;

CREATE FUNCTION public.parceiro_aviso_publico(p_publico text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.require_permission('parceiros.read');
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public._parceiro_aviso_publico(p_publico) t),'[]');
END $$;
REVOKE ALL ON FUNCTION public.parceiro_aviso_publico(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_aviso_publico(text) TO authenticated,service_role;

CREATE FUNCTION public.parceiro_aviso_salvar(p_titulo text,p_texto text,p_publico text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=public.require_permission('parceiros.manage'); v_id uuid;
BEGIN
 IF length(btrim(p_titulo)) NOT BETWEEN 1 AND 200 OR length(btrim(p_texto)) NOT BETWEEN 1 AND 4000 THEN
 RAISE EXCEPTION 'Informe título e mensagem de até 4.000 caracteres.'; END IF;
 IF p_texto ~ '\{\{(?!nome\}\}|credito\}\}|link\}\})' THEN
  RAISE EXCEPTION 'Use somente as variáveis nome, credito e link.'; END IF;
 INSERT INTO public.parceiro_avisos(titulo,texto,publico,criado_por)
 VALUES(btrim(p_titulo),btrim(p_texto),p_publico,v_uid) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.parceiro_aviso_salvar(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_aviso_salvar(text,text,text) TO authenticated,service_role;

CREATE FUNCTION public.parceiro_aviso_enviar(p_aviso uuid,p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=public.require_permission('parceiros.manage'); a public.parceiro_avisos%ROWTYPE;
 r record; v_id uuid; v_fila uuid; v_texto text; v_motivo text;
 enviados jsonb:='[]'; recusados jsonb:='[]'; v_total integer:=0;
BEGIN
 SELECT * INTO a FROM public.parceiro_avisos WHERE id=p_aviso FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Aviso não encontrado.'; END IF;
 IF cardinality(p_ids) IS NULL OR cardinality(p_ids)=0 OR cardinality(p_ids)>50 THEN
 RAISE EXCEPTION 'Escolha entre 1 e 50 parceiros por aviso.'; END IF;
 IF a.status<>'rascunho' THEN RAISE EXCEPTION 'Este aviso já foi enviado ou cancelado.'; END IF;
 FOR v_id IN SELECT DISTINCT unnest(p_ids) LOOP
  -- Serializa avisos distintos para o mesmo parceiro: a janela de 7 dias não pode ser contornada.
  PERFORM pg_advisory_xact_lock(hashtext('parceiro_aviso'),hashtext(v_id::text));
  PERFORM 1 FROM public.parceiros WHERE id=v_id FOR UPDATE;
  SELECT * INTO r FROM public._parceiro_aviso_publico(a.publico) WHERE id=v_id;
  v_motivo:=NULL;
  IF NOT FOUND THEN v_motivo:='Fora do público, inativo, sem celular válido ou pediu para sair.';
  ELSIF r.ultimo_aviso>now()-interval '7 days' THEN v_motivo:='Já recebeu aviso há menos de 7 dias.'; END IF;
  IF v_motivo IS NOT NULL THEN
   recusados:=recusados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'motivo',v_motivo)); CONTINUE;
  END IF;
  -- Substituição única: valores inseridos não são reinterpretados como variáveis.
  v_texto:=replace(a.texto,'{{credito}}','R$ '||replace(to_char(r.credito,'FM999999990.00'),'.',','));
  v_texto:=replace(v_texto,'{{link}}','https://bexprint.com.br/login?como=parceiro');
  v_texto:=regexp_replace(v_texto,'\{\{nome\}\}',replace(split_part(btrim(r.nome),' ',1),'\','\\'),'g');
  v_texto:=v_texto||E'\n\nPara não receber estes avisos, responda SAIR.';
  v_fila:=public.enfileirar_notificacao('whatsapp',r.telefone,
   (SELECT cliente_id FROM public.parceiros WHERE id=v_id),'parceiro_aviso','parceiro_aviso',a.id,
   'parceiro_aviso',jsonb_build_object('texto',v_texto),'parceiro_aviso:'||a.id||':'||v_id);
  IF v_fila IS NULL THEN
   recusados:=recusados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'motivo','Aviso já enfileirado.')); CONTINUE;
  END IF;
  INSERT INTO public.parceiro_aviso_envios VALUES(a.id,v_id,v_fila);
  enviados:=enviados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'notificacao_id',v_fila));
  v_total:=v_total+1;
 END LOOP;
 UPDATE public.parceiro_avisos SET status='enviado',enviado_por=v_uid,enviado_em=now(),total=v_total WHERE id=a.id;
 RETURN jsonb_build_object('enviados',enviados,'recusados',recusados);
END $$;
REVOKE ALL ON FUNCTION public.parceiro_aviso_enviar(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_aviso_enviar(uuid,uuid[]) TO authenticated,service_role;

CREATE FUNCTION public.parceiro_aviso_historico()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.require_permission('parceiros.read');
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
 SELECT a.*,count(*) FILTER(WHERE f.status='enviado') AS sairam,
 count(*) FILTER(WHERE f.status='falhou') AS falharam,
 count(*) FILTER(WHERE f.status IN ('pendente','enviando')) AS na_fila,
 count(*) FILTER(WHERE f.status='cancelado') AS cancelados
 FROM public.parceiro_avisos a LEFT JOIN public.parceiro_aviso_envios e ON e.aviso_id=a.id
 LEFT JOIN public.notificacoes_fila f ON f.id=e.notificacao_id GROUP BY a.id ORDER BY a.created_at DESC LIMIT 100
 ) t),'[]');
END $$;
REVOKE ALL ON FUNCTION public.parceiro_aviso_historico() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_aviso_historico() TO authenticated,service_role;

CREATE FUNCTION public.parceiro_validar(p_parceiro uuid,p_nota text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=public.require_permission('parceiros.manage');
BEGIN
 IF length(btrim(coalesce(p_nota,''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Informe o que foi conferido (até 1.000 caracteres).'; END IF;
 UPDATE public.parceiros SET validado_em=now(),validado_por=v_uid,validacao_nota=btrim(p_nota) WHERE id=p_parceiro;
 IF NOT FOUND THEN RAISE EXCEPTION 'Parceiro não encontrado.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.parceiro_validar(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_validar(uuid,text) TO authenticated,service_role;
CREATE FUNCTION public.parceiro_avisos_preferencia(p_parceiro uuid,p_sair boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.require_permission('parceiros.manage');
 UPDATE public.parceiros SET nao_receber_avisos_em=CASE WHEN p_sair THEN now() ELSE NULL END WHERE id=p_parceiro;
 IF NOT FOUND THEN RAISE EXCEPTION 'Parceiro não encontrado.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.parceiro_avisos_preferencia(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_avisos_preferencia(uuid,boolean) TO authenticated,service_role;

INSERT INTO public.notificacao_templates(evento,canal,descricao,corpo,ativo)
 VALUES('parceiro_aviso','whatsapp','Aviso manual somente para parceiros cadastrados','{{texto}}',true);
UPDATE public.notificacao_templates SET corpo=$texto$Seja bem-vindo à Bex Print, {{nome}}! 👋

Entre em {{link}}
E-mail: {{email}}
Senha provisória: {{senha}}

No primeiro acesso você cria a sua senha e completa o cadastro em um minuto. Lá estão a sua tabela de preços, o orçamento com a sua marca e o seu crédito de boas-vindas para usar na 1ª compra.

A nossa equipe vai falar com você por aqui. Se já tiver um serviço na mão, é só responder esta mensagem.$texto$
 WHERE evento='parceiro_acesso';

-- Verificação efetiva após futura aplicação: falhar transação se ACL não corresponder.
DO $$
DECLARE r record; v_interna boolean;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('_parceiro_aviso_publico','parceiro_aviso_publico',
 'parceiro_aviso_salvar','parceiro_aviso_enviar','parceiro_aviso_historico','parceiro_validar','parceiro_avisos_preferencia') LOOP
 v_interna:=r.proname='_parceiro_aviso_publico';
 IF has_function_privilege('anon',r.oid,'EXECUTE')
 OR has_function_privilege('authenticated',r.oid,'EXECUTE')=v_interna
 OR NOT has_function_privilege('service_role',r.oid,'EXECUTE') THEN
 RAISE EXCEPTION 'Permissões incorretas na função %',r.proname; END IF;
 END LOOP;
END $$;

-- DESFAZER (não executado; preservar histórico/dados e colunas adicionadas).
-- REVOKE EXECUTE ON FUNCTION public.parceiro_aviso_enviar(uuid,uuid[]) FROM authenticated,service_role;
-- REVOKE EXECUTE ON FUNCTION public.parceiro_aviso_salvar(text,text,text) FROM authenticated,service_role;
-- REVOKE EXECUTE ON FUNCTION public.parceiro_validar(uuid,text) FROM authenticated,service_role;
-- REVOKE EXECUTE ON FUNCTION public.parceiro_avisos_preferencia(uuid,boolean) FROM authenticated,service_role;
-- REVOKE EXECUTE ON FUNCTION public.parceiro_aviso_publico(text) FROM authenticated,service_role;
-- REVOKE EXECUTE ON FUNCTION public.parceiro_aviso_historico() FROM authenticated,service_role;
-- REVOKE EXECUTE ON FUNCTION public._parceiro_aviso_publico(text) FROM service_role;
-- COMMENT ON TABLE public.parceiro_avisos IS 'DEPRECATED: pacote desativado; histórico preservado';
-- COMMENT ON TABLE public.parceiro_aviso_envios IS 'DEPRECATED: pacote desativado; histórico preservado';
-- UPDATE public.notificacao_templates SET ativo=false WHERE evento='parceiro_aviso';
-- UPDATE public.notificacao_templates SET corpo=$texto$Olá, {{nome}}! 👋 Seu cadastro de parceiro na Bex Print está liberado.
--
-- Entre em {{link}}
-- E-mail: {{email}}
-- Senha provisória: {{senha}}
--
-- No primeiro acesso você cria a sua senha e completa o cadastro em um minuto. Lá estão a sua tabela de preços, o orçamento com a sua marca e o seu crédito.
--
-- Qualquer dúvida, é só responder por aqui.$texto$ WHERE evento='parceiro_acesso';
-- Não cancela fila já criada: ela é auditável e seu cancelamento exige decisão separada.
