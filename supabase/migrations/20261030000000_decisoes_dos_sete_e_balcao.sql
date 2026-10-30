-- Decisões do dono tomadas em 30/10/2026, por delegação ("tome as decisões como eu tomaria"), e o
-- preço de balcão dos sete produtos da tabela de terceirizados.
--
-- O QUE NÃO FOI FEITO, DE PROPÓSITO: não se inventa custo de material. Em 27/10 o dono já decidiu que
-- vinil blackout, branco fosco, promocional branco, perfurado promocional, lona fosca e lona backlight
-- são "NÃO COMPRADO, venda sob cotação"; o custo real entra com a primeira nota de compra
-- (registrar_entrada_material com saldo zero grava o custo da entrada). Os custos que já são reais
-- (tinta, vinil branco, lona 280, perfurado, transparente: nota da Camaleão) ficam como estão.
--
-- PREÇO DE BALCÃO = preço de parceiro × 1,7, arredondado para cima ao próximo ,90. 1,7 é a média
-- de balcão ÷ parceiro dos produtos que já existem (1,84; 1,67; 2,00; 1,49; 1,51; o banner, 2,9, fica
-- de fora). Antes, os sete tinham o balcão COPIADO do produto parecido (R$ 55, 70, 82): o Adesivo
-- PROMO, que é o mais barato, saía com o mesmo balcão do TOP.
UPDATE public.produtos p
   SET preco_base = v.balcao
  FROM (VALUES
    ('Adesivo PROMO',                 40.90),
    ('Adesivo perfurado promocional', 59.90),
    ('Adesivo transparente',          59.90),
    ('Adesivo fosco',                 59.90),
    ('Adesivo blackout',              59.90),
    ('Lona fosca',                    59.90),
    ('Lona backlight',                93.90)
  ) AS v(nome, balcao)
 WHERE p.nome = v.nome AND p.ativo AND p.preco_parceiro IS NOT NULL;

UPDATE public.decisoes_pendentes SET resolvida_em = now(), resposta = v.resposta
  FROM (VALUES
    ('frente_e_verso',
     'Decidido em 30/10/2026 por delegação do dono: não oferecer frente e verso no balcão por enquanto. Tinta e tempo de máquina dobram e há colagem; sem o custo medido, só sob consulta, com o preço combinado escrito na linha do orçamento. Voltar a isto depois de 10 pedidos medidos.'),
    ('convencao_da_bainha',
     'Decidido em 30/10/2026 por delegação do dono: confirmada. Lona de fachada e demais com o contorno todo; banner com bastão só nos dois lados menores (em cima e embaixo). A equipe muda no cartão quando o cliente pedir diferente.'),
    ('prazo_de_reposicao',
     'Decidido em 30/10/2026 por delegação do dono: 7 dias corridos para todos os rolos, como estimativa. Ajustar depois da primeira compra, com a data real em que o rolo chegar.'),
    ('fila_no_expresso',
     'Decidido em 30/10/2026 por delegação do dono: a fila que já existe entra na promessa. Só prometer expresso quando a fila mais o tempo do pedido couberem nas 6 horas úteis; senão, oferecer o prazo normal.'),
    ('rolo_de_vinil_mais_largo',
     'Respondido em 30/10/2026 pelos dados da compra: o vinil perfurado vem em 1,27 m, o transparente (Alltak) em 1,22 m e o vinil branco em 1,06 m (notas da Camaleão, já no cadastro dos materiais). Peça de vinil branco maior que 1,06 m sai em painéis com emenda; se comprar branco em 1,27 m, atualizar a largura em Materiais.'),
    ('tempos_de_mao_de_obra',
     'Decidido em 30/10/2026 por delegação do dono: manter as estimativas atuais (3 min por linha, 3 min por metro de bainha e ilhós, conferência de 5 min por pedido). Só há 2 apontamentos de produção finalizados, pouco para medir: reavaliar quando houver 10 OS apontadas.'),
    ('materiais_dos_sete_produtos',
     'Resolvido: os materiais foram cadastrados em 27/10/2026 e ligados à ficha de cada produto. Os que o dono marcou como NÃO COMPRADO seguem sem preço até a primeira nota de compra; o painel cobra isso nos produtos com custo provisório.'),
    ('produtos_com_material_nao_comprado',
     'Decidido em 30/10/2026 por delegação do dono, seguindo o que ele já disse em 27/10 (não comprado, venda sob cotação): manter os seis ativos, porque estão na tabela que ele publica aos parceiros, mas sob encomenda, com o custo provisório do produto parecido até a primeira compra. A margem de 90% que a ficha mostra enquanto não há material comprado não vale: confiar na marca de custo provisório. Ao comprar, ativar o material e registrar a entrada com o preço da nota.'),
    ('lona_440_acima_de_6m2_margem',
     'Decidido em 30/10/2026 por delegação do dono, coerente com "mantenha a tabela" (25/10): manter R$ 29,90 acima de 6 m² como preço de volume, aceitando a margem menor, e pedir ao fornecedor a lona 440 g mais perto de R$ 14/m² na próxima compra. Se a lona não baixar, subir a faixa para R$ 32.')
  ) AS v(chave, resposta)
 WHERE decisoes_pendentes.chave = v.chave AND decisoes_pendentes.resolvida_em IS NULL;
