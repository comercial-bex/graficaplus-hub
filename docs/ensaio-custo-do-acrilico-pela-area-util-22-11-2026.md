# Custo do acrílico pela área útil da chapa e a NF-e 859 (22/11/2026)

Migração: `supabase/migrations/20261122100000_custo_do_acrilico_pela_area_util.sql`.

## O que o dono decidiu

As notas da Gonçalves & Nunes trazem a chapa Terzian "1030 X 2030": 1,03 × 2,03 m, 2,0909 m². A Terzian vende esse
acrílico no formato comercial 1,00 × 2,00 m. Os 3 cm a mais são borda que se refila, sobra que não se vende. Decisão do
dono em 22/11: **o custo e o estoque contam a área útil, 2,00 m² por chapa**. Vale para toda chapa Terzian, inclusive a de
10 mm (1,05 × 2,05 m bruta), que também conta 2,00 m².

## O que estava errado

| Material | Nota ou cotação | Sistema antes | Pela área útil |
| --- | --- | --- | --- |
| Preto 3 mm | NF-e 859, R$ 389,00 a chapa (não lançada) | R$ 400,00/m² | **R$ 194,50/m²** |
| Cristal 3 mm | NF-e 860, R$ 360,00 | R$ 172,17 unitário, R$ 181,16 médio | **R$ 180,00/m²** |
| Branco 3 mm | NF-e 862, R$ 400,00 | R$ 191,31/m² | **R$ 200,00/m²** |
| Cristal 2 mm | cotação, R$ 316,00 | R$ 151,13/m² | **R$ 158,00/m²** |
| Cristal 6 mm | cotação, R$ 801,51 | R$ 383,33/m² | **R$ 400,76/m²** |
| Cristal 10 mm | cotação, R$ 1.282,49 | R$ 595,81/m² | **R$ 641,25/m²** |

De onde vinha o R$ 400,00 do preto: o saldo de abertura de 05/10 deu R$ 400,00 o m² aos três acrílicos de 3 mm
(lotes `ABERTURA`, 2 m² cada). Cristal e branco foram corrigidos pelas compras de 04/11; o preto não, porque a nota dele
nunca entrou. Os lotes de abertura continuavam a R$ 400,00, e é deles que a baixa da OS tira o custo do material.

As compras de 04/11 foram lançadas em 16/11 rendendo 2,091 m² por chapa (a área bruta), com lote de 2,0909 m² e entrada
de 2,09 m². O estoque contava a borda como material vendável.

## O que a migração faz

1. `materiais.largura_util_m` e `materiais.comprimento_util_m`, com CHECK (positivas e dentro da chapa), lidas pelas duas
   visões (`materiais_operacional`, `materiais_financeiro`). As visões são recriadas com as opções de antes
   (`security_invoker = true` na operacional; `security_invoker = false, security_barrier = true` na financeira): sem o
   `WITH`, o Postgres apaga as opções, e a operacional passaria a ignorar o RLS. O GRANT de SELECT nas colunas novas
   para `authenticated` vem antes de recriar a operacional.
2. Os seis acrílicos Terzian recebem a medida útil 1,00 × 2,00 m. O preto ganha a medida bruta 1,03 × 2,03 e a marca.
3. NF-e 860 e 862: o item da compra passa a render 2,000 m², o lote e a entrada passam a 2,00 m² a R$ 180,00 e
   R$ 200,00.
4. Lotes `ABERTURA` dos três acrílicos de 3 mm: de R$ 400,00 para R$ 180,00, R$ 200,00 e R$ 194,50.
5. Custo por m² de cristal 2, 3, 6 e 10 mm e branco 3 mm, como na tabela.
6. NF-e 859 em Compras (PIX, R$ 389,00, chave de acesso da DANFE), item rendendo 2,000 m², lote `E-261104-NF859` e entrada
   de 2,00 m² a R$ 194,50. A entrada dispara o gatilho de custo médio, que põe o preto a R$ 194,50.
7. Rastro em `logs_auditoria` (acao `custo_pela_area_util`) com os valores de antes e de depois.

Os gatilhos que já existem recompõem o custo dos produtos. Preço de venda não muda. Nenhuma função nova.

O código: a tela de registrar compra sugere sozinha o rendimento da chapa pela medida útil (2,00 m²) e diz que a borda é
sobra (`rendeSugerido`, em `src/domain/fornecedores/registro.ts`). A medida bruta da chapa nunca é sugerida.

## Ensaio no banco vivo (22/11/2026, desfeito por RAISE EXCEPTION)

A migração inteira, sem o COMMIT, mais um relatório:

| Conferido | Resultado |
| --- | --- |
| Custo e médio | preto 194,50; cristal 2 mm 158,00; 3 mm 180,00; 6 mm 400,76; 10 mm 641,25; branco 3 mm 200,00 |
| Estoque | preto, cristal 3 mm e branco 3 mm com 4,00 m² (2 da abertura + 2 da compra); 2, 6 e 10 mm com 0 |
| Área útil | 1,000 × 2,000 nos seis; preto com chapa 1,030 × 2,030 e marca Terzian |
| Custo dos produtos | Acrílico Virgem Recortado 2 mm 158,00; 3 mm 180,00; Quadro Acrílico 186,58 (180,00 + vinil 6,58) |
| Compras | NF-e 859 R$ 389,00 PIX; as três chapas de 04/11 rendendo 2,000 m² |
| Lotes de 3 mm | abertura e compra a 180,00, 200,00 e 194,50; nenhum a 400,00 |
| Visões | operacional `{security_invoker=true}`; financeira `{security_invoker=false,security_barrier=true}` |
| Permissões | `authenticated` lê a medida útil; `anon` não lê a visão financeira |
| Automações | nenhuma enfileirada (não há automação de estoque mínimo) |
| Auditoria | 1 linha `custo_pela_area_util` |

## O que fica de fora

- **Acrílico espelhado dourado 2 mm:** sem nota de compra. O produto "Acrílico Espelhado Recortado 2 mm" segue com
  R$ 400,00 por m² digitado, e o material com custo médio de R$ 87,09, puxado por uma entrada de R$ 0 em 24/09. Corrige-se
  quando a nota chegar.
- **PVC expandido e as chapas da Camaleão (1,00 × 2,00 m):** sem medida útil por enquanto, porque não se sabe se têm borda.
- **Tela de materiais:** não mostra nem edita medida de chapa ou bobina. Material novo em chapa recebe a medida útil pelo
  banco, até a tela ganhar o campo.
