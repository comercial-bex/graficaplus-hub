-- Pix automático (integração futura), pedido do dono em 25/10/2026: por enquanto o Pix é manual
-- (QR Code e copia e cola com o valor; a pessoa confere o extrato e marca "O Pix chegou"). Fica como
-- decisão pendente, no painel de administrador, gestor e financeiro, para a API de cobrança do banco e o
-- aviso automático de pagamento (webhook) não serem esquecidos.
INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe) VALUES
  ('pix_automatico_api_banco', 'Pix automático: API do banco e aviso de pagamento (integração futura)',
   'Hoje o Pix é manual: o sistema gera o QR Code e o copia e cola com o valor, e a pessoa confere o extrato e clica em "O Pix chegou". Para dar baixa sozinho, é preciso a API Pix de cobrança do banco e o aviso automático de pagamento (webhook). Pergunte ao Itaú e ao C6: 1) qual a tarifa por Pix recebido na conta PJ; 2) quanto tempo leva para liberar a API Pix de cobrança; 3) se exige certificado digital; 4) se existe o aviso automático de pagamento. Com as respostas, escolhe-se o banco (ou uma plataforma de pagamento como Mercado Pago, Asaas ou Efí) e o sistema passa a criar a cobrança no orçamento e dar a baixa da parcela quando o pagamento entrar.')
ON CONFLICT (chave) DO NOTHING;
