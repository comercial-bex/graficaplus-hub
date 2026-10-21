-- Registro de dados (21/10/2026, "continue a resolver"): duas pendências do
-- painel que não dependiam de decisão de ninguém.
--
-- 1. Orçamentos sem item: #34 ("ADESIVOS", Yvens, 21/09, sem cliente) e #81
--    ("et", Fernando, 13/10, R$ 0) estavam vazios desde que nasceram. Marcados
--    `expirado` — o enum `status_orcamento` não tem "cancelado"; expirado sai da
--    pendência e das listas e pode voltar. O #93 (Carlos Santa, Jhessy, 19/10)
--    FICA: é o único orçamento aberto do cliente; quem o abriu preenche ou
--    descarta.
--
-- 2. OS #165 (Dani Muniz, Acrílico Virgem Recortado 3mm × 3) nasceu em 13/10,
--    antes de o produto ganhar ficha (20261021090000), e ficou sem material
--    previsto — custo real zero no resultado. `gerar_materiais_previstos_os` só
--    insere o que falta (NOT EXISTS por item e material). Ensaio com rollback:
--    3 linhas, 0,40 + 0,35 + 0,10 m² de ACRILICO CRISTAL VIRGEM 3MM a R$ 400/m²
--    (R$ 340 previstos); nenhum gatilho, aviso ou envio; a OS não muda.

UPDATE public.orcamentos o
   SET status = 'expirado'
 WHERE o.numero IN (34, 81)
   AND o.status = 'rascunho'
   AND NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM public.orcamentos_3d t WHERE t.orcamento_id = o.id);

SELECT public.gerar_materiais_previstos_os(os.id)
  FROM public.ordens_servico os
 WHERE os.numero = 165;
