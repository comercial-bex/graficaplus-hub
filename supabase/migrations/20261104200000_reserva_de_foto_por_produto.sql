-- Reserva de produto para a foto por IA (04/11/2026, revisão do PR 428).
--
-- O servidor lia a foto do produto, pagava a IA e só então gravava. Duas abas, dois administradores ou o
-- lote mais o botão da pasta liam "sem foto" ao mesmo tempo e pagavam a MESMA foto duas vezes (a gravação
-- condicional protege o dado, não o saldo: simulado com 43 produtos, 75 a 85 gerações pagas). Agora a função
-- reserva o produto aqui ANTES de ler e de pagar: a chave primária é o produto, então o segundo a chegar leva
-- 23505 e recebe "em_andamento", sem gastar nada. A reserva sai quando a geração termina (também em erro), e
-- uma de mais de 5 minutos (a chamada que a fez morreu) não segura ninguém.
--
-- Só o servidor, com a chave de serviço, mexe aqui: RLS ligada e nenhuma política, nada para anon nem authenticated.

CREATE TABLE IF NOT EXISTS public.produto_foto_reservas (
  produto_id uuid PRIMARY KEY REFERENCES public.produtos(id) ON DELETE CASCADE,
  reservado_em timestamptz NOT NULL DEFAULT now(),
  por uuid NULL
);

ALTER TABLE public.produto_foto_reservas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.produto_foto_reservas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.produto_foto_reservas TO service_role;

COMMENT ON TABLE public.produto_foto_reservas IS
  'Produto com foto sendo gerada pela IA agora. Só o servidor (chave de serviço) grava, com a chave primária no produto para o segundo a chegar não pagar a mesma foto. RLS ligada e sem política de propósito: nada para anon nem authenticated.';
