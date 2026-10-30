-- Preço de tabela do banner próprio (decisão do dono, 30/10/2026, por delegação): R$ 110,00 → R$ 64,90/m².
-- Mesma regra dos outros produtos: preço de parceiro (R$ 37,90) × 1,7, arredondado ao próximo ,90.
-- Custo cheio R$ 15,95/m² ⇒ margem de 75%; a equipe tem folga para vender até perto de R$ 50 com
-- desconto sobre o produto ligado. Para desfazer: voltar BAN-LON a 110,00.
-- Já aplicado em produção; idempotente (só muda se ainda estiver em 110,00).
UPDATE public.produtos SET preco_base = 64.90 WHERE sku = 'BAN-LON' AND preco_base = 110.00;
