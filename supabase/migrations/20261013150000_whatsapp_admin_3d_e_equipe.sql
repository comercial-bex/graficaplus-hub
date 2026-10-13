-- WhatsApp: o admin barrado, a OS 3D e "quem assumiu" (13/10/2026).
--
-- 1. O admin via "Você não tem permissão" na Visão geral do WhatsApp e no
--    painel "Ligados a esta conversa". Não era papel nem policy: a tabela
--    `orcamentos` tem leitura POR COLUNA (dinheiro e segredos ficam de fora),
--    e as três colunas de LIGAÇÃO — conversa_id, lead_id, contato_id — nunca
--    foram abertas. A tela filtrava por `conversa_id` e o PostgREST recusava
--    a consulta inteira, para todo mundo, inclusive o dono.
-- 2. OS de impressão 3D: o modelo mora no orçamento 3D (slicer, foto), não em
--    `arquivos`. Depois de dispensar a arte (migração 20261013090000), ela
--    continuava barrada por "sem arquivo final". Decisão do dono: dispensar.
-- 3. A equipe da caixa passa a dizer os papéis de cada pessoa: é de onde sai
--    "assumida por Yvens · Gerência" na conversa e na lista.
--
-- FEITO À MÃO, NÃO FAZ PARTE DESTA MIGRAÇÃO: a OS #44 (Urna e Gatinho Anjo,
-- 3D, paga e retirada em setembro) foi concluída em 13/10/2026 pelo caminho
-- oficial (fechar_os), a pedido do dono, com inspeção de qualidade e custo de
-- máquina registrados retroativamente no nome dele, o aviso "serviço
-- concluído" ao cliente cancelado e um evento `conclusao_retroativa` na OS.

-- 1. As colunas de ligação do orçamento ---------------------------------------
GRANT SELECT (conversa_id, lead_id, contato_id) ON public.orcamentos TO authenticated;

-- 2. OS 3D sem a trava do arquivo final ---------------------------------------
CREATE OR REPLACE FUNCTION public.os_e_impressao_3d(p_os_id uuid, p_orcamento_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.orcamentos_3d t3
    WHERE t3.os_id = p_os_id
       OR (p_orcamento_id IS NOT NULL AND t3.orcamento_id = p_orcamento_id)
  )
$function$;
COMMENT ON FUNCTION public.os_e_impressao_3d(uuid, uuid) IS
  'A OS é de impressão 3D quando um orçamento 3D aponta para ela ou para o orçamento de onde ela nasceu.';
REVOKE ALL ON FUNCTION public.os_e_impressao_3d(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.os_e_impressao_3d(uuid, uuid) TO authenticated, service_role;

-- Edita a função viva trecho a trecho: se o trecho não estiver lá, para.
DO $arq3d$
DECLARE
  v_def text := pg_get_functiondef('public.os_bloqueios_para(uuid, public.status_os)'::regprocedure);
  v_de text := E'AND final_producao = true\n    ) THEN';
  v_para text := E'AND final_producao = true\n    ) AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id) THEN';
BEGIN
  IF position(v_para IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'os_bloqueios_para: o teste do arquivo final não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$arq3d$;

-- 3. A equipe com papéis ------------------------------------------------------
-- RETURNS TABLE muda de forma: é DROP + CREATE, com as mesmas permissões.
DROP FUNCTION IF EXISTS public.whatsapp_equipe();
CREATE FUNCTION public.whatsapp_equipe()
RETURNS TABLE(id uuid, nome text, avatar_url text, filas whatsapp_fila[], papeis text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT u.id, u.nome, u.avatar_url, u.filas,
         coalesce((SELECT array_agg(r.role::text ORDER BY r.role) FROM public.user_roles r WHERE r.user_id = u.id), '{}'::text[]) AS papeis
  FROM public.usuarios u
  WHERE u.ativo IS NOT FALSE AND public.is_staff(u.id)
    AND public.has_permission(auth.uid(), 'whatsapp.read')
  ORDER BY u.nome
$function$;
COMMENT ON FUNCTION public.whatsapp_equipe() IS
  'A equipe que aparece na caixa do WhatsApp: id, nome, foto, filas e papéis. Exige whatsapp.read.';
REVOKE ALL ON FUNCTION public.whatsapp_equipe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_equipe() TO authenticated, service_role;

-- 4. O aviso automático liga a conversa ao orçamento e à OS ------------------
-- A conversa da Distribuidora Estrela nasceu do aviso do orçamento #73, mas
-- "Ligados a esta conversa" ficava vazio: o aviso virava mensagem da conversa
-- (whatsapp_registrar_mensagem, payload {fonte, id}) e ninguém gravava
-- orcamentos.conversa_id. O gatilho faz isso na hora; o bloco abaixo liga os
-- avisos já enviados (10 em 13/10/2026), sem mexer no updated_at do orçamento.
CREATE OR REPLACE FUNCTION public._wa_mensagem_liga_entidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ent text;
  v_id uuid;
  v_os uuid;
BEGIN
  IF NEW.direcao <> 'saida' OR coalesce(NEW.payload->>'fonte', '') <> 'notificacoes_fila' THEN
    RETURN NULL;
  END IF;
  IF coalesce(NEW.payload->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;
  SELECT n.entidade, n.entidade_id INTO v_ent, v_id
  FROM public.notificacoes_fila n WHERE n.id = (NEW.payload->>'id')::uuid;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  IF v_ent = 'orcamento' THEN
    UPDATE public.orcamentos SET conversa_id = NEW.conversa_id WHERE id = v_id AND conversa_id IS NULL;
    SELECT os_id INTO v_os FROM public.orcamentos WHERE id = v_id;
    IF v_os IS NOT NULL THEN
      UPDATE public.whatsapp_conversas SET os_id = v_os WHERE id = NEW.conversa_id AND os_id IS NULL;
    END IF;
  ELSIF v_ent = 'ordem_servico' THEN
    UPDATE public.whatsapp_conversas SET os_id = v_id WHERE id = NEW.conversa_id AND os_id IS NULL;
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public._wa_mensagem_liga_entidade() IS
  'Aviso automático que vira mensagem da conversa liga a conversa ao orçamento (orcamentos.conversa_id) e à OS (whatsapp_conversas.os_id) de que o aviso fala. Sem isso, "Ligados a esta conversa" ficava vazio.';

DROP TRIGGER IF EXISTS whatsapp_mensagens_liga_entidade ON public.whatsapp_mensagens;
CREATE TRIGGER whatsapp_mensagens_liga_entidade
  AFTER INSERT ON public.whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION public._wa_mensagem_liga_entidade();

DO $liga$
BEGIN
  ALTER TABLE public.orcamentos DISABLE TRIGGER tg_orcamentos_updated;
  UPDATE public.orcamentos o
     SET conversa_id = m.conversa_id
    FROM public.whatsapp_mensagens m
    JOIN public.notificacoes_fila n ON n.id::text = m.payload->>'id'
   WHERE m.payload->>'fonte' = 'notificacoes_fila' AND n.entidade = 'orcamento'
     AND o.id = n.entidade_id AND o.conversa_id IS NULL;
  ALTER TABLE public.orcamentos ENABLE TRIGGER tg_orcamentos_updated;
  UPDATE public.whatsapp_conversas c
     SET os_id = o.os_id
    FROM public.orcamentos o
   WHERE o.conversa_id = c.id AND o.os_id IS NOT NULL AND c.os_id IS NULL;
END
$liga$;
