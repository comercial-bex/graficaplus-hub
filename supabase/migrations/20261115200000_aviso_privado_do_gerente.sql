-- Aviso no WhatsApp PRIVADO do gerente (15/11/2026).
--
-- O dono pediu que o gerente (gestor) receba também no privado os avisos que hoje vão só ao grupo
-- da equipe. O evento `aviso_grupo_equipe` NÃO serve: o despachante o trava para destino de grupo,
-- e essa trava existe para nada interno chegar a cliente. Aqui nasce um evento NOVO, com modelo
-- próprio, e a regra de quem pode receber fica no servidor (src/domain/whatsapp/aviso-privado.ts):
-- só celular de usuário ATIVO com papel gestor ou admin; qualquer outro destino é falha definitiva
-- sem chamar o Z-API.
--
-- Esta migração só cria o modelo. Não enfileira nada, não liga nada, não mexe em trava.
-- Nasce ativo apenas se o modelo do grupo estiver ativo (mesmo interruptor da tela de avisos);
-- sem o modelo do grupo, nasce desligado.

INSERT INTO public.notificacao_templates (evento, canal, corpo, descricao, ativo)
SELECT 'aviso_gerente_privado', 'whatsapp', '{{texto}}',
       'Aviso no WhatsApp privado do gerente (gestor ou admin): mesmo texto do aviso do grupo, só para a gerência',
       COALESCE((SELECT t.ativo FROM public.notificacao_templates t
                  WHERE t.evento = 'aviso_grupo_equipe' AND t.canal = 'whatsapp' LIMIT 1), false)
 WHERE NOT EXISTS (SELECT 1 FROM public.notificacao_templates WHERE evento = 'aviso_gerente_privado');
