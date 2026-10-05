-- ============================================================================
-- Link do cliente do orçamento: o botão que nunca funcionou
-- ============================================================================
--
-- POR QUÊ
--   "Link do cliente" e "WhatsApp" em /orcamentos/$id chamam a função de
--   servidor gerarLinkPublicoOrcamento, que lia `orcamentos.token_publico` com
--   a sessão de quem clicou. O papel authenticated não tem SELECT nessa coluna
--   (grant por coluna: o token é a credencial do cliente e não pode sair numa
--   consulta comum), e tabela com grant por coluna recusa a consulta INTEIRA
--   quando ela pede uma coluna sem grant: 42501 para todo mundo, admin
--   inclusive. A função de servidor trocava o erro por "Orçamento não
--   encontrado". Medido em 05/10/2026: 0 de 18 orçamentos com token — o
--   cliente nunca recebeu link de aprovação pelo sistema.
--   Atrás desse havia um segundo buraco: o token era gravado pela policy de
--   UPDATE ("orc permission update", que pede orcamentos.create). Para quem lê
--   e não altera (o financeiro), o UPDATE casaria 0 linhas SEM erro e a tela
--   entregaria um link com um token que nunca foi gravado — o cliente abriria
--   "Link inválido ou expirado".
--
-- O QUE FAZ
--   orcamento_link_publico(p_orcamento_id) devolve o token do orçamento e o
--   cria na primeira vez (o mesmo link para sempre, como a tela promete).
--   SECURITY DEFINER porque lê e grava a coluna que o papel não lê; a guarda
--   está no corpo: só quem tem orcamentos.send — a chave de "mandar para o
--   cliente" (hoje admin, gestor e vendedor). O grant por coluna continua como
--   está: o token só sai por aqui, para quem pode mandá-lo.
--   EXECUTE fora de PUBLIC e do anon (o anon tem grant próprio; REVOKE de
--   PUBLIC sozinho não o fecha); só authenticated, que é como a função de
--   servidor chama, com a sessão de quem clicou.
--   Nada de RAISE NOTICE nem de linha em logs_auditoria com o token: ele é a
--   senha do cliente para aprovar o orçamento. Nenhum gatilho de orcamentos
--   copia a linha para log no UPDATE (o tg_auditar só roda no DELETE).
--
-- ENSAIO (05/10/2026, DO $ensaio$ ... RAISE EXCEPTION, tudo desfeito; função
-- criada dentro do ensaio com este mesmo corpo; orçamento 62 como cobaia)
--   Antes, a leitura da função de servidor (SELECT id, token_publico) como
--   cada conta: 42501 "permission denied for table orcamentos" para Harison,
--   Yvens, Cibele, Sergio e Leonardo.
--   Depois, a função como cada conta:
--     Harison admin, Yvens gestor, Leonardo vendedor  token de 36 caracteres,
--       gravado no orçamento; a segunda chamada devolve o MESMO token.
--     Cibele financeiro, Sergio operador  42501 "Seu perfil não pode mandar
--       orçamento para o cliente: falta a permissão orcamentos.send." — e o
--       orçamento continua sem token.
--     Orçamento inexistente  P0002 "Orçamento não encontrado."
--   has_function_privilege: anon = false, authenticated = true.
--
-- RETRATO
--   Aplicada pelo MCP em 05/10/2026 a partir DESTE arquivo. md5(prosrc) de
--   orcamento_link_publico depois de aplicada, igual ao do corpo abaixo
--   (entre os $function$): e4a91b58785d9391d6f67ae04e30828c.
--   proacl depois de aplicada: postgres, authenticated e service_role (este
--   pelo privilégio padrão do schema); anon e PUBLIC sem EXECUTE. O PostgREST
--   já enxerga a função: chamada como anon responde 42501, não PGRST202.
--   Idempotente: CREATE OR REPLACE; REVOKE/GRANT podem rodar de novo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.orcamento_link_publico(p_orcamento_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada: entre de novo para gerar o link do cliente.';
  END IF;
  -- A mesma chave que a matriz de permissões chama de "mandar orçamento".
  -- Quem só lê o orçamento (o financeiro) não manda link para o cliente.
  IF NOT public.has_permission(v_uid, 'orcamentos.send') THEN
    RAISE EXCEPTION 'Seu perfil não pode mandar orçamento para o cliente: falta a permissão orcamentos.send.'
      USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: dois cliques ao mesmo tempo não geram dois tokens; o segundo
  -- espera o primeiro terminar e devolve o mesmo.
  SELECT o.token_publico INTO v_token
    FROM public.orcamentos o
   WHERE o.id = p_orcamento_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Gerado uma vez só: o link que o cliente já recebeu continua valendo.
  IF v_token IS NULL THEN
    v_token := gen_random_uuid()::text;
    UPDATE public.orcamentos SET token_publico = v_token WHERE id = p_orcamento_id;
  END IF;

  RETURN v_token;
END
$function$;

REVOKE ALL ON FUNCTION public.orcamento_link_publico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_link_publico(uuid) TO authenticated;
