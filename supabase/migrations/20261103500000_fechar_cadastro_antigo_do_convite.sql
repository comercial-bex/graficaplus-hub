-- Fecha o cadastro antigo do convite (03/11/2026, decisão do dono).
--
-- parceiro_cadastrar_por_convite (nove campos) foi trocada por
-- parceiro_cadastrar_rapido na 20261103300000 e endurecida na 20261103400000. A
-- página do convite só chama a nova; a antiga ficou aberta ao público só como
-- plano de volta. Mas ela aceita nome, e-mail e telefone sem conferir com a
-- conta e dispara a boas-vindas pelo WhatsApp da gráfica: era a porta que as
-- conferências novas não cobriam.
--
-- Conferido antes: nenhuma função do banco e nenhum arquivo do app (fora o
-- types.ts gerado) a chama. Fica só para o service_role. Se um dia for preciso
-- voltar: GRANT EXECUTE ON FUNCTION ... TO anon, authenticated.

REVOKE ALL ON FUNCTION public.parceiro_cadastrar_por_convite(text, uuid, text, text, text, text, text, text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_cadastrar_por_convite(text, uuid, text, text, text, text, text, text, jsonb, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.parceiro_cadastrar_por_convite(text, uuid, text, text, text, text, text, text, jsonb, text, text, text) IS
  'Cadastro antigo do convite (nove campos). Fechada ao público em 03/11/2026: a página do convite usa parceiro_cadastrar_rapido. Só o service_role executa.';

-- O REVOKE não reclama quando não pega: confere.
DO $conferir$
DECLARE
  v_f regprocedure := 'public.parceiro_cadastrar_por_convite(text, uuid, text, text, text, text, text, text, jsonb, text, text, text)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_f, 'EXECUTE') OR has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'parceiro_cadastrar_por_convite ainda é executável por anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role perdeu a execução de parceiro_cadastrar_por_convite';
  END IF;
END $conferir$;
