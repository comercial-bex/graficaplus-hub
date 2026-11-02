-- Sete funções SECURITY DEFINER podem ser chamadas sem login (anon). Conferidas
-- em 02/11/2026: seis são os fluxos públicos de propósito e validam o token ou o
-- convite POR DENTRO; a sétima não expõe nada sem uma pessoa válida. O comentário
-- diz isso para ninguém "consertar" revogando o acesso e quebrar o link do cliente.
COMMENT ON FUNCTION public.abrir_aprovacao(text) IS
  'Link público de aprovação de arte (/aprovar/$token). Chamável sem login de propósito: valida o hash do token por dentro e devolve só o necessário.';
COMMENT ON FUNCTION public.registrar_decisao_aprovacao(text, text, text) IS
  'Decisão do cliente no link de aprovação. Chamável sem login de propósito: exige token válido e delega a decidir_arte_por_token.';
COMMENT ON FUNCTION public.arquivo_em_aprovacao_aberta(text) IS
  'Diz só sim/não: o arquivo tem aprovação aberta (token vivo, não usado, não expirado). Chamável sem login para o Storage liberar a leitura do link.';
COMMENT ON FUNCTION public.convite_de_parceiro(text) IS
  'Valida o código de convite na página pública /seja-parceiro e devolve o nome da marca. Chamável sem login de propósito.';
COMMENT ON FUNCTION public.parceiro_cadastrar_por_convite(text, uuid, text, text, text, text, text, text) IS
  'Cadastro de parceiro por convite. Chamável sem login de propósito (a conta acabou de ser criada); exige convite ativo e conta com menos de 15 minutos.';
COMMENT ON FUNCTION public.programa_parceiros_publico() IS
  'Níveis e benefícios do programa de parceiros mostrados na página pública /seja-parceiro. Chamável sem login de propósito; não traz dado de parceiro.';
COMMENT ON FUNCTION public.can_see_prices(uuid) IS
  'Pergunta se uma pessoa vê preços. Sem sessão a resposta é falsa. É usada por 2 políticas, 9 funções e 5 views (medido em 02/11/2026); revogar o EXECUTE de anon só depois de rever esses usos.';
