-- Decisões que o plano orçamento→OS (26/10/2026) deixou para o dono. Aparecem como avisos que se resolvem.
INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe) VALUES
  ('lona_440_acima_de_6m2_margem', 'Lona 440g acima de 6 m²: margem de 25,7%, abaixo do mínimo de 35%',
   'O preço de R$ 29,90/m² da faixa acima de 6 m² dá 25,7% de margem bruta (19,7% depois de 6% de imposto) contra o mínimo de 35% do produto. O preço que dá 35% é R$ 34,17, quase igual ao da faixa normal (R$ 34,90), e a faixa perderia o sentido. Opções: (a) renegociar a lona de 440g de R$ 16,23 para perto de R$ 14 o m² e manter o preço; (b) subir a faixa para perto de R$ 32 e aceitar margem menor em volume; (c) manter como preço de volume e aceitar a margem baixa.'),
  ('prazo_entrega_padrao_5_dias_uteis', 'Prazo de entrega sugerido no orçamento: confirmar os 5 dias úteis',
   'O botão "Sugerir entrega" do orçamento usa 5 dias úteis, valor provisório. Diga o prazo real da gráfica (pode ser por tipo de produto). Para mudar: Custos e produção, chave prazo_entrega_padrao_dias.'),
  ('sinal_para_converter_em_os', 'Exigir sinal (Pix) para converter o orçamento em OS?',
   'Hoje a OS nasce sem sinal. Decida se o sinal vira obrigatório (para todos, só cliente novo ou acima de certo valor). Com a conversão automática ao aprovar pelo link, a regra vale também para ela.'),
  ('lembrete_48h_orcamento_sem_resposta', 'Lembrete ao cliente que não respondeu o orçamento em 48 horas',
   'Não existe lembrete ao cliente depois do envio do orçamento. Decida se sai sozinho pelo WhatsApp da gráfica ou se o atendimento aprova antes (regra da casa: mensagem ao cliente com autorização).')
ON CONFLICT (chave) DO NOTHING;
