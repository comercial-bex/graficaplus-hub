-- Validação objetiva da Parte 1. Deve ser executada após aplicar migrations.
DO $$
DECLARE missing TEXT[];
BEGIN
  SELECT array_agg(obj) INTO missing
  FROM (VALUES
    ('permissoes'),('perfil_permissoes'),('eventos_negocio'),('orcamento_versoes'),('orcamento_versao_itens'),
    ('contas_receber'),('parcelas_receber'),('whatsapp_contatos'),('whatsapp_anexos'),('whatsapp_fila_envio')
  ) v(obj)
  WHERE to_regclass('public.' || obj) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Objetos ausentes: %', missing; END IF;
END $$;

SELECT proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
AND proname IN ('converter_lead_em_cliente','aprovar_orcamento','converter_orcamento_em_os','avancar_os_status','forcar_transicao_os','confirmar_pagamento','estornar_pagamento')
ORDER BY proname;
