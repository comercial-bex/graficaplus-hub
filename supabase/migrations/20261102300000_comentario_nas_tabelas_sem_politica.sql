-- Quatro tabelas com RLS ligada e nenhuma política não explicavam isso. As outras
-- oito já têm comentário. "Sem política" aqui é de propósito: só funções
-- SECURITY DEFINER e o servidor entram. Criar política aberta "para consertar"
-- exporia o hash do token ou o contador do atendimento.
COMMENT ON TABLE public.catalogo_links IS
  'Links da vitrine de brindes enviados ao cliente. Guarda só o hash do token. RLS ligada e nenhuma policy de propósito: só funções definer e service_role entram.';
COMMENT ON TABLE public.catalogo_link_itens IS
  'Quais itens do catálogo cada link da vitrine mostra, e em que ordem. RLS ligada e nenhuma policy de propósito: só funções definer e service_role entram.';
COMMENT ON TABLE public.portal_cliente_links IS
  'Links do portal do cliente (acompanhar pedido e aprovar arte). Guarda só o hash do token. RLS ligada e nenhuma policy de propósito: só funções definer e service_role entram.';
COMMENT ON TABLE public.whatsapp_atendimento_seq IS
  'Contador mensal do número de atendimento do WhatsApp (mes, ultimo). RLS ligada e nenhuma policy de propósito: só a função que numera o atendimento escreve.';
