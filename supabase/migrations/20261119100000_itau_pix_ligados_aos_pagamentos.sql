-- =====================================================================================================
-- PIX DO EXTRATO DO ITAÚ LIGADOS AOS PAGAMENTOS DE OS (19/11/2026)
--
-- APLICADA em 19/11/2026 pelo conector do banco, com o dono confirmando cada par. Este arquivo registra o
-- que foi aplicado (os 4 UPDATEs, a cópia e a conferência, numa transação).
--
-- O QUE ESTAVA ERRADO
--   O Fluxo de caixa somava em dobro 4 Pix: o crédito do extrato e o pagamento de OS já registrado (a
--   conciliação automática só liga até 3 dias de diferença e um para um). Ligar tira o movimento do extrato
--   do Fluxo (vw_fluxo_caixa) e deixa o pagamento. Nada muda no saldo do banco, em OS nem em pagamento.
--   Pares: OS 215/218/219 (lote de R$ 1.239,17 em 06/11; ligado ao pagamento da OS 215, os 4 somam o
--   crédito), OS 161 (R$ 1.200,00), OS 167 (R$ 372,50), OS 169 (extrato R$ 410,00, pagamento R$ 409,50).
--   Resultado: 17 Pix ligados; saldo do Itaú segue R$ 385,82. Cópia em correcoes_de_extrato, lote
--   'itau-pix-ligados-2026-11-19' (desfazer: pagamento_id = NULL nesses 4 movimentos).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE _lig (mov uuid, pag uuid, valor_mov numeric, valor_pag numeric) ON COMMIT DROP;
INSERT INTO _lig VALUES
 ('0513dd76-65f1-4d84-8b04-d8c2590f113a', 'db51fe07-4729-4e33-8259-a795a407ef1e', 1239.17, 1112.50),
 ('95678c96-4079-44a0-b997-c6f34362a15d', 'de6335e7-dc95-4cb2-abb2-84a6dbd9565d', 1200.00, 1200.00),
 ('02cc95c9-cb2c-467d-830a-6ccc9b7a01e0', 'a2067151-3170-4599-be47-5f427bfb0404', 372.50, 372.50),
 ('2f4cefba-8cfc-4624-bc54-efef375628dc', '9e5d7a58-0304-476d-a380-6ec511ef16f9', 410.00, 409.50);
DO $g$
BEGIN
  IF (SELECT count(*) FROM _lig l JOIN caixa_movimentos m ON m.id=l.mov AND m.pagamento_id IS NULL AND m.origem='extrato' AND m.tipo='entrada' AND m.valor=l.valor_mov) <> 4
     OR (SELECT count(*) FROM _lig l JOIN pagamentos p ON p.id=l.pag AND p.status='pago' AND p.valor=l.valor_pag AND NOT EXISTS (SELECT 1 FROM caixa_movimentos x WHERE x.pagamento_id=p.id)) <> 4 THEN
    RAISE EXCEPTION 'Os pares não estão como na conferência.';
  END IF;
  IF (SELECT sum(p.valor) FROM pagamentos p WHERE p.id::text ~ '^(db51fe07|c0afd8ac|2df56a83|edab8117)' AND p.status='pago') <> 1239.17 THEN
    RAISE EXCEPTION 'O lote de 06/11 não soma R$ 1.239,17.';
  END IF;
END $g$;
CREATE TEMP TABLE _antes ON COMMIT DROP AS SELECT m.id, to_jsonb(m) j FROM caixa_movimentos m JOIN _lig l ON l.mov=m.id;
UPDATE caixa_movimentos m SET pagamento_id = l.pag FROM _lig l WHERE m.id = l.mov AND m.pagamento_id IS NULL;
INSERT INTO correcoes_de_extrato (lote, acao, tabela, registro_id, antes, depois, motivo)
SELECT 'itau-pix-ligados-2026-11-19', 'alterada', 'caixa_movimentos', m.id, a.j, to_jsonb(m),
       'Pix do extrato ligado ao pagamento de OS já registrado (dono confirmou o par em 19/11/2026); tira a soma em dobro do Fluxo de caixa.'
  FROM caixa_movimentos m JOIN _antes a ON a.id=m.id;
DO $c$
BEGIN
  IF (SELECT count(*) FROM caixa_movimentos WHERE pagamento_id IS NOT NULL AND origem='extrato') <> 17
     OR EXISTS (SELECT pagamento_id FROM caixa_movimentos WHERE pagamento_id IS NOT NULL GROUP BY 1 HAVING count(*)>1)
     OR (SELECT saldo_atual FROM vw_saldo_conta WHERE conta_id='d91b5d74-e754-48aa-8444-2f30ceb86eb2') <> 385.82
     OR (SELECT count(*) FROM correcoes_de_extrato WHERE lote='itau-pix-ligados-2026-11-19') <> 4 THEN
    RAISE EXCEPTION 'Conferência final falhou.';
  END IF;
END $c$;
COMMIT;
