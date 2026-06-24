-- Validação objetiva da Parte 2 após aplicar migrations.
SELECT 'tables' AS check, COUNT(*) AS found
FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('os_tarefas','arquivo_aprovacoes','arquivo_tokens_externos','material_lotes','estoque_reservas','maquinas_agenda','apontamentos_producao','qualidade_inspecoes','custos_operacionais_os','notificacoes_operacionais');

SELECT 'functions' AS check, COUNT(*) AS found
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('reservar_materiais_os','baixar_estoque_os','estornar_baixa_estoque_os','fechar_os');

SELECT 'permissions' AS check, COUNT(*) AS found
FROM public.permissoes
WHERE chave IN ('tarefas.read','arquivos.upload','estoque.reserve','estoque.exit','agenda.schedule','producao.start','qualidade.manage','retrabalho.manage','entregas.manage','os.close');
