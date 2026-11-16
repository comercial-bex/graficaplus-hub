# Ensaio da migração: preço mínimo recomendado (16/11/2026)

Migração: `supabase/migrations/20261116130000_preco_minimo_recomendado.sql`. Estado: **ensaiada no banco vivo em 16/11/2026, junto com o que já está aplicado (100000, 110000 e 120000 estão no ar e publicadas), e desfeita por RAISE EXCEPTION final. NÃO aplicada: a aplicação é feita depois, pelo dono.** Depois do ensaio conferi que o banco voltou ao que era: os dois parâmetros novos inexistentes, o md5 de `custo_cheio_do_produto` (`d6bf1523d90f88e619d4ff129f33d40e`) e de `confirmar_custo_fixo` (`2647b2cb62c7eb230e486175f6b85926`) como antes, a view com 17 colunas, 12 propostas pendentes, a do Adesivo transparente ainda em 69,90, nenhuma proposta do Adesivo vinil recortado, `custo_admin_hora` em 12,50, e nenhuma tabela temporária do ensaio. Nenhuma mensagem foi enviada, nenhum preço mudou e nenhuma sequência foi consumida (nenhuma das tabelas tocadas tem coluna com `nextval` ou identidade, conferido em `information_schema.columns`).

O ensaio roda a migração inteira (sem o `BEGIN` e o `COMMIT` dela) numa chamada só, dentro da transação implícita da chamada, tira fotos antes (tabelas temporárias que somem no fim) e termina num `RAISE EXCEPTION` que carrega o relatório. A ferramenta de banco mostra o erro e trunca o miolo de mensagens longas: do relatório da tabela por produto sumiram algumas linhas do miolo (de Ilhós na lona a Lona para cavalete), que recompus por um SELECT só de leitura com a mesma conta e conferi contra todas as linhas que apareceram no ensaio (batem, até a segunda casa, com uma única diferença de 0,01 na conversão do Acabamento de lona, por ordem de arredondamento). O roteiro completo está no fim deste documento.

## Decisões do dono em 16/11/2026 que a migração implementa

1. **Ocupação.** O custo da conversão por unidade (hora da máquina sem a energia, mão de obra com encargos e rateio com o aluguel) é dividido pela ocupação alvo, hoje 50 por cento. Energia e perdas não são divididas, porque só correm quando a máquina roda.
2. **Fórmula.** Preço mínimo recomendado = o MAIOR entre (a) o multiplicador da regra de três, hoje 3, vezes o material com perda e falha, e (b) o piso do custo de produção, que é o custo de produção dividido por 1 menos a margem mínima do produto menos o imposto sobre a venda menos metade da taxa do cartão. Margem mínima vazia ou zero vale 30. Taxas lidas de `custos_tabela` (6 por cento de imposto e 3,5 por cento de cartão, o que dá 7,75 por cento). O custo de produção já leva a ocupação.
3. O tempo de recorte do adesivo recortado, 35 minutos, não muda.
4. Multiplicador e ocupação são parâmetros do cadastro de custos, confirmáveis por gestor e financeiro.

## O que a migração faz

| Parte | O que faz | Muda dado? |
| --- | --- | --- |
| a | `custos_tabela` ganha `ocupacao_alvo_pct` (50, unidade `%`) e `multiplicador_regra_de_tres` (3, unidade `x`), categoria `geral`, os dois confirmados (`confirmado_em` preenchido, `confirmado_por` nulo porque veio da decisão do dono) | 2 linhas novas. Numa instrução só, então a recomposição do gatilho roda uma vez |
| b | `custo_cheio_do_produto` trocada na definição viva, com guarda do md5 | Nada gravado. A função só calcula |
| c | View `produto_custo_real` recriada: as 17 colunas de hoje na mesma ordem e 7 novas no FIM | Não. É view |
| d | `confirmar_custo_fixo` trocada na definição viva, com guarda do md5 | Nada gravado |
| e | Propostas de preço: atualiza a pendente do Adesivo transparente e cria a do Adesivo vinil recortado | 1 linha atualizada e 1 nova em `precos_propostas`, as duas pendentes |
| f | `pendencias_de_custo` | Não muda. Lê `custo_producao` da view, então já segue o custo novo |
| g | `sincronizar_precificacao_do_produto` | Não muda e não é recomposta: grava só `custo_material`, `custo_maquina`, `custo_mao_obra` e `custo_indireto`, e essas quatro chaves não mudam de valor |

Os dois corpos de função são escritos sem linhas de comentário dentro, porque o banco guarda `prosrc` sem os comentários. Assim o md5 do corpo no arquivo é o md5 do que o banco vai ter: `custo_cheio_do_produto` fica em `a67875ec0aaaa9e94bc771b156175090` e `confirmar_custo_fixo` em `0f63f56aacd9d61e7aa79f2fb6f1431f`, os dois números que o ensaio imprimiu depois de rodar a migração e que o teste calcula pelo arquivo. A guarda do começo confere os md5 de hoje (os do banco vivo, que são os dos arquivos 100000 e 120000 sem as linhas de comentário). O teste prova essa igualdade.

## [1] Preço e orçamento gravado não mudam

Foto antes e comparação depois, dentro da mesma chamada:

| Conferência | Resultado |
| --- | --- |
| `produtos`, linha inteira de todas as colunas, hash por conteúdo | IGUAL |
| `produto_precos`, linha inteira | IGUAL |
| `orcamento_itens`, linha inteira | IGUAL |
| `itens_os`, linha inteira | IGUAL |
| `produto_precificacao` sem `updated_at` | IGUAL |
| `produto_custo_cheio`, a view que `desconto_avaliar` e `meta_por_produto` leem | IGUAL |
| `desconto_avaliar` em 41 orçamentos abertos (rascunho e enviado, com subtotal) com 10 por cento de desconto: alçada, piso, mínimo, desconto máximo do vendedor | IGUAL |
| `precos_propostas` dos outros produtos | IGUAL |

O piso de desconto dos orçamentos abertos não muda porque `custo_ocupacao` é somada só a `custo_producao`, nunca a `custo_total`. A função `desconto_avaliar` lê a view `produto_custo_cheio`, que lê a composição gravada em `produto_precificacao`, que vem de `custo_material`, `custo_maquina`, `custo_mao_obra` e `custo_indireto`. Nenhuma dessas quatro mudou de valor.

O gatilho de recomposição dispara uma vez quando os dois parâmetros nascem e regrava `produto_precificacao` com os mesmos valores. Só `updated_at` dessas linhas anda. Por isso o hash é sem `updated_at`.

## [2] Parâmetros, funções e acesso

| Item | Resultado |
| --- | --- |
| `ocupacao_alvo_pct` | 50, `%`, confirmado |
| `multiplicador_regra_de_tres` | 3, `x`, confirmado |
| `custo_cheio_do_produto` | 1 definição, md5 depois `a67875ec0aaaa9e94bc771b156175090`. EXECUTE só de service_role |
| `confirmar_custo_fixo` | 1 definição, md5 depois `0f63f56aacd9d61e7aa79f2fb6f1431f`. EXECUTE só de authenticated |
| `sincronizar_precificacao_do_produto` | md5 `c35b8affb3c51c2f40e3ce8a56c89d3a`, igual a antes |
| View `produto_custo_real` | opções `security_invoker=true`, SELECT: anon não, authenticated não, service_role sim |
| Colunas da view | `produto_id, nome, familia, preco_balcao, custo_producao, custo_real, margem_liquida_pct, vezes_o_custo, preco_regra_de_tres, sem_tinta, material_sem_custo, sem_mao_de_obra, custo_incompleto, velocidade_usada_m2_h, velocidade_nominal_m2_h, tempo_presumido, parceiro_abaixo_do_piso` mais, no fim, `custo_ocupacao, tres_x_material, piso_custo_producao, preco_minimo_recomendado, trava_que_manda, ocupacao_alvo_pct, multiplicador_regra_de_tres` |

`CREATE OR REPLACE VIEW` descarta as opções, por isso a migração reaplica `security_invoker = true`, o `REVOKE` de PUBLIC, anon e authenticated e o `GRANT SELECT` só para service_role. Custo e margem continuam privados: a view só é lida pelo servidor.

Os valores de preço da view (`tres_x_material`, `piso_custo_producao` e o mínimo) são arredondados PARA CIMA no centavo, para a margem mínima nunca cair por arredondamento. `trava_que_manda` vale `regra_de_3` quando a regra de três é maior ou igual ao piso, e `piso_custo` quando o piso é maior.

## Conferência com o exemplo do dono

Ocupação de 50 por cento, taxas de 7,75 por cento, perda mais falha de 13 por cento (8 de perda e 5 de falha, lidos do banco).

| Produto | Exemplo: material com perda, conversão, mínimo | Ensaio: material com perda, conversão, mínimo | Trava |
| --- | --- | --- | --- |
| Lona 280g impressa | 11,92, 10,53, 42,98 | 11,92, 10,42, **39,03** | piso do custo |
| Lona 440g reforçada impressa | 23,29, 10,53, 69,87 | 23,29, 10,42, 69,87 | regra de três |
| Adesivo vinil branco impresso | 10,59, 10,53, 40,42 | 10,59, 10,42, 40,21 | piso do custo |
| Adesivo transparente | 23,91, 10,53, 71,73 | 23,91, 10,42, 71,73 | regra de três |
| Adesivo vinil recortado | 8,32, 29,80, 72,96 | 8,32, 29,74, 72,84 | piso do custo |

Os números não batem em todas as linhas, e há duas causas, as duas explicadas por conta:

1. **Energia.** O exemplo dividiu TODA a conversão pela ocupação, incluindo a energia: 2 vezes a conversão de hoje, 5,2664 mais 5,2664 igual a 10,5328 para a plotter de impressão e 14,9017 mais 14,9017 igual a 29,8034 para a de recorte. A decisão do dono diz que a energia NÃO se divide, e a migração segue a decisão. A energia da i1600 é 0,1 h vezes 1 kW vezes R$ 1,1339, que dá 0,1134. A fixa sem energia é 1,4431 de máquina mais 1,8349 de mão de obra mais 1,8750 de rateio, 5,1530, que dividido por 0,5 dá 10,3060, e com a energia somada dá 10,4194, ou 10,42. A diferença para o exemplo é exatamente a energia, 0,1134 na plotter de impressão e 0,0661 na de recorte (0,1 kW por 35 minutos). Sobre o mínimo, a energia pesa 0,1134 dividido por 0,5225, que dá 0,217, e 0,0661 dividido por 0,5225, que dá 0,127. É o que separa 40,21 de 40,42, 72,84 de 72,96, e 69,87 e 71,73, que não mudam porque a regra de três manda neles e ela não usa a conversão.
2. **Lona 280g impressa: margem mínima.** O exemplo só chega a 42,98 com margem mínima de 40 por cento. O cadastro de `Lona 280g impressa` tem margem mínima de 35, e o mínimo sai 39,03. Com 40 e a conversão do exemplo, 22,45 dividido por 0,5225 dá 42,97, que arredondado para cima é 42,98. Com 40 e a conversão do ensaio daria 42,76. Se o dono quer 40 neste produto, é uma edição de cadastro, que não faz parte desta migração.

Não mexi na regra para forçar o exemplo: segui as quatro decisões escritas.

## [3] Tabela por produto

São 39 produtos ativos com preço na view. Margem líquida é depois do imposto e da metade do cartão. `*` marca os cinco de impressão. Conversão é o custo de produção menos o material com perda. Custo de produção antes é o de hoje, sem ocupação.

| Produto | Material com perda | Conversão | Custo de produção | Mínimo recomendado | Trava | Margem líquida hoje | Margem no mínimo | Margem mínima | Preço hoje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| * Adesivo transparente | 23,91 | 10,42 | 34,33 | 71,73 | regra de três | 37,9 | 48,1 | 30 | 59,90 |
| * Adesivo vinil branco impresso | 10,59 | 10,42 | 21,00 | 40,21 | piso do custo | 58,6 | 43,4 | 40 | 55,00 |
| * Adesivo vinil recortado | 8,32 | 29,74 | 38,06 | 72,84 | piso do custo | 39,3 | 43,4 | 40 | 68,00 |
| * Lona 280g impressa | 11,92 | 10,42 | 22,34 | 39,03 | piso do custo | 46,2 | 37,9 | 35 | 45,00 |
| * Lona 440g reforçada impressa | 23,29 | 10,42 | 33,71 | 69,87 | regra de três | 47,8 | 47,7 | 35 | 70,00 |
| Acabamento de lona | 0,80 | 4,12 | 4,93 | 9,43 | piso do custo | 40,7 | 43,4 | 40 | 9,00 |
| Acabamento manual | 24,17 | 0,00 | 24,17 | 72,51 | regra de três | 31,8 | 63,9 | 40 | 38,40 |
| Acrílico Espelhado Recortado 2mm | 400,00 | 61,00 | 461,00 | 1200,00 | regra de três | 50,0 | 58,4 | 40 | 1000,00 |
| Acrílico Virgem Recortado 2mm | 173,71 | 61,00 | 234,71 | 521,14 | regra de três | 57,6 | 51,2 | 40 | 600,00 |
| Acrílico Virgem Recortado 3mm | 219,02 | 61,00 | 280,02 | 657,07 | regra de três | 62,1 | 53,8 | 40 | 800,00 |
| Adesivo perfurado | 10,78 | 10,42 | 21,20 | 37,03 | piso do custo | 72,0 | 37,9 | 35 | 82,00 |
| Bainha na lona | 2,82 | 0,00 | 2,82 | 8,46 | regra de três | 44,4 | 63,8 | 40 | 5,50 |
| Banner com bastão e corda | 14,08 | 10,42 | 24,50 | 46,89 | piso do custo | 59,1 | 43,4 | 40 | 64,90 |
| Banner com bastão e corda, lona 440g | 24,40 | 10,42 | 34,82 | 73,21 | regra de três | 58,0 | 48,4 | 40 | 89,90 |
| Bastão e corda | 7,01 | 0,00 | 7,01 | 21,03 | regra de três | 36,7 | 63,9 | 40 | 12,00 |
| Bolsa térmica 30L | 40,00 | 0,00 | 40,00 | 120,00 | regra de três | 26,5 | 63,9 | 40 | 59,00 |
| Certificado A4 papel texturizado | 0,00 | 2,52 | 2,52 | 4,84 | piso do custo | 72,3 | 43,4 | 40 | 9,90 |
| Chaveiro acrílico | 2,25 | 1,22 | 3,47 | 6,75 | regra de três | 42,2 | 44,3 | 40 | 6,50 |
| Colagem da borda | 2,01 | 0,00 | 2,01 | 6,03 | regra de três | 37,7 | 63,8 | 40 | 3,50 |
| Copo térmico 500ml | 30,00 | 5,48 | 35,48 | 90,00 | regra de três | 3,9 | 57,3 | 40 | 40,00 |
| Copo tipo cuia 380ml | 30,00 | 5,48 | 35,48 | 90,00 | regra de três | 24,4 | 57,3 | 40 | 50,90 |
| Corte a laser | 33,03 | 0,00 | 33,03 | 99,09 | regra de três | 32,2 | 63,9 | 40 | 52,80 |
| Criação e arte final | 40,00 | 0,00 | 40,00 | 120,00 | regra de três | 51,8 | 63,9 | 50 | 90,00 |
| Deslocamento | 2,20 | 0,00 | 2,20 | 6,60 | regra de três | 47,1 | 63,9 | 30 | 4,50 |
| Faixa em lona | 11,92 | 10,42 | 22,34 | 39,03 | piso do custo | 46,2 | 37,9 | 35 | 45,00 |
| Ilhós na lona | 1,91 | 0,00 | 1,91 | 5,73 | regra de três | 40,9 | 63,9 | 40 | 3,50 |
| Impressão A4 colorida | 0,80 | 0,82 | 1,62 | 3,85 | piso do custo | 29,6 | 54,3 | 50 | 2,50 |
| Instalação em campo | 60,00 | 0,00 | 60,00 | 180,00 | regra de três | 50,0 | 63,9 | 40 | 130,00 |
| Kit churrasco 12 peças | 68,00 | 0,00 | 68,00 | 204,00 | regra de três | 17,2 | 63,9 | 40 | 89,00 |
| Kit churrasco 3 peças | 59,00 | 6,57 | 65,57 | 177,00 | regra de três | 28,1 | 59,8 | 40 | 98,90 |
| Laminação de adesivo | 9,66 | 6,18 | 15,84 | 28,97 | regra de três | 38,7 | 40,7 | 35 | 28,00 |
| Lona com adesivo aplicado | 19,86 | 10,42 | 30,28 | 59,60 | regra de três | 56,2 | 44,9 | 30 | 74,90 |
| Lona para cavalete | 11,92 | 10,42 | 22,34 | 35,90 | piso do custo | 46,2 | 32,5 | 30 | 45,00 |
| Necessaire personalizada | 29,90 | 0,00 | 29,90 | 89,70 | regra de três | 18,8 | 63,9 | 40 | 39,90 |
| Placa PS 2mm com adesivo | 58,52 | 10,42 | 68,94 | 175,55 | regra de três | 48,5 | 57,4 | 30 | 145,00 |
| Placa PVC expandido 3mm | 67,33 | 20,61 | 87,94 | 202,00 | regra de três | 45,5 | 52,8 | 30 | 175,00 |
| Quadro acrílico | 226,59 | 61,00 | 287,59 | 679,76 | regra de três | 68,8 | 54,1 | 40 | 1000,00 |
| Recorte eletrônico | 1,21 | 0,00 | 1,21 | 3,63 | regra de três | 32,1 | 63,9 | 40 | 1,93 |
| Refile de lona | 0,24 | 0,00 | 0,24 | 0,72 | regra de três | 48,0 | 63,9 | 40 | 0,50 |

Contagem: dos 39 produtos, 21 levam custo de ocupação (têm máquina padrão e não são serviço inteiro) e 18 não levam (sem máquina padrão, ou serviço com custo digitado que já inclui tempo e rateio). Em 26 o mínimo recomendado fica acima do preço de balcão de hoje.

Custo de produção antes e depois nos cinco de impressão: Adesivo transparente 29,18 para 34,33, Adesivo vinil branco 15,85 para 21,00, Adesivo vinil recortado 23,22 para 38,06, Lona 280g 17,19 para 22,34, Lona 440g 28,56 para 33,71. A diferença em cada um é só a ocupação: 5,15 nos cinco de impressão e 14,84 no recorte.

## [4] Propostas de preço

Preço proposto = menor valor terminado em 0,90 ou 0,00 que fica igual ou acima do mínimo. Decisão de ninguém: as duas ficam `pendente`, `origem = 'manual'`, e só gestor ou admin aprovam ou recusam.

| Produto | Preço de hoje | Mínimo recomendado | Proposta | Margem líquida hoje | Margem líquida na proposta | Trava |
| --- | --- | --- | --- | --- | --- | --- |
| Adesivo transparente | 59,90 | 71,73 | 71,90 | 37,88 | 48,25 | regra de três |
| Adesivo vinil recortado | 68,00 | 72,84 | 72,90 | 39,34 | 43,42 | piso do custo |

A do Adesivo transparente é a que já estava pendente em 69,90 (origem `referencia_m2`). A migração ATUALIZA essa linha, sem criar outra e sem decidir nada: novo preço, novo motivo, `origem` passa a `manual`, `custo` e `piso` com os valores novos (custo de produção e mínimo recomendado) e as margens recalculadas. O índice parcial único `precos_propostas_uma_pendente_por_produto` (uma pendente por produto) seria violado por um segundo INSERT, por isso o transparente é UPDATE e o recortado é INSERT. A guarda do começo confere que a pendente do transparente é exatamente a de 69,90 de `referencia_m2` e que o recortado não tem pendente.

Pendentes em `precos_propostas`: 12 antes, 13 depois. As outras 11 propostas não mudam (hash IGUAL). Os motivos não têm custo em reais, parênteses, travessão nem seta, e a conferência final da migração barra se tiverem. Motivo do transparente: "O material do adesivo transparente custa mais que o dobro do vinil branco e a regra de três sobre o material com perda e falha manda neste produto. O preço mínimo recomendado é de 71,73 e a proposta é o menor valor terminado em 0,90 ou 0,00 que fica igual ou acima dele. Sobe de 59,90 para 71,90. A margem líquida vai de 37,88 para 48,25 por cento." O do recortado tem a mesma forma, com o piso do custo de produção, a ocupação de 50 por cento e a margem mínima de 40.

As colunas `custo` e `piso` das duas linhas guardam o custo de produção e o mínimo recomendado, que são a conta nova. As propostas antigas guardam o custo só de material e o piso por essa conta. As margens das duas linhas novas são líquidas (depois de imposto e metade do cartão); as antigas são brutas sobre o material.

## [5] Parceiro: `pendencias_de_custo`

A função não muda. Ela lê `custo_producao` da view `produto_custo_real`, e a conta de parceiro divide esse custo por 1 menos a margem mínima menos a taxa. Como o custo de produção agora leva a ocupação, a conta de parceiro continua coerente com o custo novo, sem tocar na função. A taxa entra uma vez só: a conta usa o custo de produção sem taxa.

| | Antes | Depois |
| --- | --- | --- |
| Pendências de parceiro | 6 | 7 |

Entra a mais: Banner com bastão e corda, margem líquida de 28 por cento com mínimo de 40. Os outros seis já estavam, e a margem de todos cai:

| Produto | Margem líquida antes | Margem líquida depois | Mínimo |
| --- | --- | --- | --- |
| Adesivo transparente | 9 | menos 6 | 30 |
| Adesivo vinil branco impresso | 35 | 17 | 40 |
| Adesivo vinil recortado | 37 | 1 | 40 |
| Banner com bastão e corda | acima do mínimo | 28 | 40 |
| Chaveiro acrílico | 35 | 24 | 40 |
| Lona 280g impressa | 28 | 9 | 35 |
| Lona 440g reforçada impressa | menos 3 | menos 20 | 35 |

São 7 produtos com preço de parceiro fixo, e em 6 o mínimo recomendado (que é referência de balcão) fica acima do preço de parceiro. Isso é informativo: a regra de que o parceiro nunca paga mais que o balcão não muda, e esta migração não mexe em preço de parceiro. O lembrete diário de custos lê essa função, então o texto da próxima rodada vai falar de 7 produtos de parceiro, não de 6.

## [6] Orçamentos abertos

São 60 orçamentos abertos (rascunho e enviado). Nenhum item foi tocado (hash IGUAL). Dos 60, 27 têm item de produto que aparece na view e 7 têm item de produto cujo mínimo recomendado fica acima do preço de balcão de hoje. O piso de desconto dos 41 com subtotal não muda (hash de `desconto_avaliar` IGUAL), porque o piso de desconto lê `custo_total`, que não mudou. O mínimo recomendado é informação para a tela de preços e para as propostas, não trava nenhum orçamento.

## [7] `confirmar_custo_fixo` com contas reais

Simulação com `request.jwt.claims` e `SET LOCAL ROLE authenticated`, uma conta de cada papel (o vendedor só tem esse papel):

| Chamada | Resultado |
| --- | --- |
| gestor, `ocupacao_alvo_pct` 4 | 22023, "A ocupação alvo vai de 5 a 100 por cento. Confira o número." |
| gestor, `ocupacao_alvo_pct` 101 | 22023, mesma mensagem |
| gestor, `ocupacao_alvo_pct` 0 | 22023, "Este custo não pode ser zero." |
| gestor, `multiplicador_regra_de_tres` 0 | 22023, "Este custo não pode ser zero." |
| gestor, `multiplicador_regra_de_tres` 0,5 | 22023, "O multiplicador da regra de três vai de 1 a 10. Confira o número." |
| gestor, `multiplicador_regra_de_tres` 11 | 22023, mesma mensagem |
| gestor, `custo_admin_hora` 5 | 22023, "Este custo não pode ser alterado por aqui." |
| gestor, ocupação 70, confirmando | ok, `confirmado: true`, `confirmado_por` o gestor |
| gestor, multiplicador 4, sem confirmar | ok, `confirmado: false`, `confirmado_em` e `confirmado_por` nulos |
| financeiro, ocupação 60, confirmando | ok, `confirmado: true`, `confirmado_por` o financeiro |
| vendedor, ocupação 60 | P0001, "Permissão necessária: custos.fixos.update" |

Com ocupação de 60 e multiplicador de 4 (a última escrita do ensaio, depois desfeita), a view reage: o mínimo da Lona 280g passa a 47,69 pela regra de três (4 vezes 11,92) e o do Adesivo vinil recortado a 63,38 pelo piso do custo, porque a conversão fica menor com mais ocupação.

## Riscos e o que ficou fora

- **26 de 39 produtos ficam com mínimo acima do preço de hoje.** A maior parte vem da regra de três aplicada ao custo digitado de serviços, terceirizados e kits, que não têm ficha de material (Instalação em campo, Kit churrasco, Bolsa térmica, Copo térmico, Corte a laser, Criação e arte final). A decisão do dono foi "3 vezes o material com perda e falha", e para esses produtos o "material" é o custo digitado no cadastro. Se a intenção era só para produto com ficha de material, é uma decisão para o dono, em migração própria: não apliquei exceção por conta própria.
- **Aprovar a proposta apaga o rastro de custo líquido.** `preco_proposta_aprovar` regrava `custo`, `piso` e as margens da proposta com a conta antiga (custo só de material), e confere o preço contra esse piso antigo. As duas propostas passam nesse piso, mas, depois de aprovadas, a linha guarda os números da conta antiga. Não mexi nessa função, que não é desta migração.
- **Energia fora da ocupação** faz a conversão ficar 0,11 abaixo do exemplo na plotter de impressão e 0,07 na de recorte (item acima). É a decisão escrita do dono. Se o exemplo era a intenção, a troca é dividir também a energia, uma linha na função.
- **Ocupação só vale para produto com máquina padrão** que não seja serviço inteiro. Produto sem máquina padrão (acabamentos manuais, bainha, ilhós) não leva ocupação, embora tenha mão de obra e rateio, como a decisão pediu.
- **Ocupação ausente ou apagada** vale 100, ou seja, nenhuma ocupação. Ocupação digitada abaixo de 5 vale 5 e acima de 100 vale 100. A função de gravação já barra fora de 5 a 100, e o limite na função de custo é cinto e suspensório contra escrita direta.
- **A tela ainda não mostra as colunas novas.** A view e a função estão prontas; a tela `/precos` e a de custos fixos não fazem parte desta entrega.

## Roteiro do ensaio

O bloco 1 vai antes da migração e o bloco 2 depois (a migração entra sem as linhas `BEGIN;` e `COMMIT;`, num texto só). O bloco 2 termina em `RAISE EXCEPTION` e nunca em `COMMIT`: nada fica.

```sql
CREATE TEMP TABLE _antes ON COMMIT DROP AS SELECT
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) FROM public.produtos t) AS h_prod,
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) FROM public.produto_precos t) AS h_pp,
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) FROM public.orcamento_itens t) AS h_oi,
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) FROM public.itens_os t) AS h_os,
  (SELECT md5(string_agg((to_jsonb(t) - 'updated_at')::text, ',' ORDER BY (to_jsonb(t) - 'updated_at')::text)) FROM public.produto_precificacao t) AS h_precif,
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) FROM public.produto_custo_cheio t) AS h_cheio,
  (SELECT md5(string_agg(public.desconto_avaliar(o.id, o.valor_subtotal, round(o.valor_subtotal * 0.10, 2), 0)::text, '|' ORDER BY o.id))
     FROM public.orcamentos o WHERE o.status IN ('rascunho', 'enviado') AND COALESCE(o.valor_subtotal, 0) > 0) AS h_desc,
  (SELECT count(*)::int FROM public.orcamentos o WHERE o.status IN ('rascunho', 'enviado') AND COALESCE(o.valor_subtotal, 0) > 0) AS n_desc,
  (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) FROM public.precos_propostas t
    WHERE t.produto_id NOT IN ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', '622d3846-6b63-432f-8ee2-c073e7373c16')) AS h_prop_outras,
  (SELECT count(*)::int FROM public.precos_propostas WHERE status = 'pendente') AS n_pend;
CREATE TEMP TABLE _view_ant ON COMMIT DROP AS
  SELECT produto_id, custo_producao, custo_real, margem_liquida_pct FROM public.produto_custo_real;
CREATE TEMP TABLE _parc_ant ON COMMIT DROP AS
  SELECT codigo, rotulo FROM public.pendencias_de_custo() WHERE tipo = 'parceiro';
```

```sql
DO $ensaio$
DECLARE
  v_rel text := '';
  a record; r record; v_n int; v_n2 int; v_msg text; v_res jsonb; v_txt text; v_h text;
  v_gestor uuid; v_fin uuid; v_vend uuid; v_lin text; v_n3 int; v_n4 int;
BEGIN
  SELECT * INTO a FROM _antes;

  v_rel := '[1] PRECO E ORCAMENTO GRAVADO, hash antes e depois';
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) INTO v_h FROM public.produtos t;
  v_rel := v_rel || E'\n  produtos (linha inteira): ' || CASE WHEN v_h = a.h_prod THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) INTO v_h FROM public.produto_precos t;
  v_rel := v_rel || E'\n  produto_precos (linha inteira): ' || CASE WHEN v_h = a.h_pp THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) INTO v_h FROM public.orcamento_itens t;
  v_rel := v_rel || E'\n  orcamento_itens (linha inteira): ' || CASE WHEN v_h = a.h_oi THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) INTO v_h FROM public.itens_os t;
  v_rel := v_rel || E'\n  itens_os (linha inteira): ' || CASE WHEN v_h = a.h_os THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg((to_jsonb(t) - 'updated_at')::text, ',' ORDER BY (to_jsonb(t) - 'updated_at')::text)) INTO v_h FROM public.produto_precificacao t;
  v_rel := v_rel || E'\n  produto_precificacao (sem updated_at): ' || CASE WHEN v_h = a.h_precif THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) INTO v_h FROM public.produto_custo_cheio t;
  v_rel := v_rel || E'\n  produto_custo_cheio (view que desconto_avaliar e meta_por_produto leem): ' || CASE WHEN v_h = a.h_cheio THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg(public.desconto_avaliar(o.id, o.valor_subtotal, round(o.valor_subtotal * 0.10, 2), 0)::text, '|' ORDER BY o.id)) INTO v_h
    FROM public.orcamentos o WHERE o.status IN ('rascunho', 'enviado') AND COALESCE(o.valor_subtotal, 0) > 0;
  v_rel := v_rel || E'\n  desconto_avaliar em ' || a.n_desc || ' orcamentos abertos com 10 por cento de desconto (alcada, piso, minimo, maximo do vendedor): '
        || CASE WHEN v_h = a.h_desc THEN 'IGUAL' ELSE 'DIFERENTE' END;
  SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text)) INTO v_h FROM public.precos_propostas t
   WHERE t.produto_id NOT IN ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', '622d3846-6b63-432f-8ee2-c073e7373c16');
  v_rel := v_rel || E'\n  precos_propostas dos OUTROS produtos: ' || CASE WHEN v_h = a.h_prop_outras THEN 'IGUAL' ELSE 'DIFERENTE' END;

  v_rel := v_rel || E'\n[2] FUNCOES E PARAMETROS';
  FOR r IN SELECT proname, md5(prosrc) h, count(*) OVER (PARTITION BY proname) n FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname IN ('custo_cheio_do_produto', 'confirmar_custo_fixo', 'sincronizar_precificacao_do_produto') ORDER BY 1 LOOP
    v_rel := v_rel || E'\n  ' || r.proname || ' md5 depois=' || r.h || ' definicoes=' || r.n;
  END LOOP;
  FOR r IN SELECT codigo, descricao, unidade, valor, confirmado_em IS NOT NULL AS conf, observacao FROM public.custos_tabela
            WHERE codigo IN ('ocupacao_alvo_pct', 'multiplicador_regra_de_tres') ORDER BY 1 LOOP
    v_rel := v_rel || E'\n  ' || r.codigo || '=' || r.valor || ' ' || r.unidade || ' confirmado=' || r.conf || ' | ' || r.descricao;
  END LOOP;
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_txt FROM pg_attribute WHERE attrelid = 'public.produto_custo_real'::regclass AND attnum > 0 AND NOT attisdropped;
  v_rel := v_rel || E'\n  colunas da view: ' || v_txt;
  v_rel := v_rel || E'\n  view: opcoes=' || (SELECT reloptions::text FROM pg_class WHERE oid = 'public.produto_custo_real'::regclass)
        || ' anon=' || has_table_privilege('anon', 'public.produto_custo_real', 'SELECT')
        || ' authenticated=' || has_table_privilege('authenticated', 'public.produto_custo_real', 'SELECT')
        || ' service_role=' || has_table_privilege('service_role', 'public.produto_custo_real', 'SELECT');
  v_rel := v_rel || E'\n  custo_cheio EXECUTE: anon=' || has_function_privilege('anon', 'public.custo_cheio_do_produto(uuid)', 'EXECUTE')
        || ' authenticated=' || has_function_privilege('authenticated', 'public.custo_cheio_do_produto(uuid)', 'EXECUTE')
        || ' service_role=' || has_function_privilege('service_role', 'public.custo_cheio_do_produto(uuid)', 'EXECUTE');
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('custos_tabela', 'precos_propostas', 'produto_precificacao', 'custos_tabela_historico')
     AND (column_default LIKE 'nextval%' OR is_identity = 'YES');
  v_rel := v_rel || E'\n  colunas com sequencia nas tabelas tocadas: ' || v_n;

  v_rel := v_rel || E'\n[3] TABELA POR PRODUTO (nome | material com perda | conversao | custo producao | minimo | trava | margem liquida hoje | margem no minimo | producao antes)';
  FOR r IN
    SELECT x.nome, x.preco_balcao, x.custo_producao, x.margem_liquida_pct, x.custo_real, x.preco_minimo_recomendado mn,
           x.trava_que_manda tv, x.custo_ocupacao oc, x.ocupacao_alvo_pct,
           (c.c ->> 'custo_material')::numeric + (c.c ->> 'custo_perdas')::numeric AS mp, ant.custo_producao AS prod_ant,
           (x.nome IN ('Lona 280g impressa', 'Lona 440g reforçada impressa', 'Adesivo vinil branco impresso', 'Adesivo transparente', 'Adesivo vinil recortado')) AS cinco
      FROM public.produto_custo_real x
      CROSS JOIN LATERAL (SELECT public.custo_cheio_do_produto(x.produto_id) AS c) c
      LEFT JOIN _view_ant ant ON ant.produto_id = x.produto_id
     ORDER BY 12 DESC, x.nome
  LOOP
    v_rel := v_rel || E'\n  ' || CASE WHEN r.cinco THEN '* ' ELSE '  ' END || left(r.nome, 30) || ' | ' || round(r.mp, 2) || ' | ' || round(r.custo_producao - r.mp, 2)
          || ' | ' || r.custo_producao || ' | ' || COALESCE(r.mn::text, '-') || ' | ' || COALESCE(r.tv, '-')
          || ' | ' || COALESCE(r.margem_liquida_pct::text, '-') || ' | '
          || COALESCE(round((1 - r.custo_real / r.mn) * 100, 1)::text, '-') || ' | ' || COALESCE(r.prod_ant::text, '-')
          || ' | preco ' || r.preco_balcao || ' ocup ' || COALESCE(r.ocupacao_alvo_pct::text, '-');
  END LOOP;
  SELECT count(*) FILTER (WHERE custo_ocupacao > 0), count(*) FILTER (WHERE ocupacao_alvo_pct IS NULL),
         count(*) FILTER (WHERE preco_minimo_recomendado > preco_balcao), count(*)
    INTO v_n, v_n2, v_n3, v_n4 FROM public.produto_custo_real;
  v_rel := v_rel || E'\n  produtos na view=' || v_n4 || ' com custo de ocupacao=' || v_n || ' sem ocupacao=' || v_n2 || ' com minimo acima do preco de hoje=' || v_n3;

  v_rel := v_rel || E'\n[4] PROPOSTAS';
  FOR r IN SELECT pp.produto_id, p.nome, pp.preco_atual, pp.preco_proposto, pp.custo, pp.piso, pp.margem_minima, pp.margem_atual, pp.margem_proposta, pp.origem, pp.status, pp.motivo
             FROM public.precos_propostas pp JOIN public.produtos p ON p.id = pp.produto_id
            WHERE pp.status = 'pendente' AND pp.produto_id IN ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', '622d3846-6b63-432f-8ee2-c073e7373c16') ORDER BY p.nome LOOP
    v_rel := v_rel || E'\n  ' || r.nome || ': atual ' || r.preco_atual || ' proposto ' || r.preco_proposto || ' producao ' || r.custo || ' minimo ' || r.piso
          || ' mm ' || r.margem_minima || ' margem atual ' || r.margem_atual || ' proposta ' || r.margem_proposta || ' origem ' || r.origem || ' status ' || r.status
          || E'\n    motivo: ' || r.motivo;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.precos_propostas WHERE status = 'pendente';
  v_rel := v_rel || E'\n  pendentes antes=' || a.n_pend || ' depois=' || v_n || ' (esperado +1)';

  v_rel := v_rel || E'\n[5] PARCEIRO, pendencias_de_custo tipo parceiro';
  SELECT count(*) INTO v_n FROM _parc_ant;
  SELECT count(*) INTO v_n2 FROM public.pendencias_de_custo() WHERE tipo = 'parceiro';
  v_rel := v_rel || E'\n  antes=' || v_n || ' depois=' || v_n2;
  FOR r IN SELECT d.rotulo, 'ENTROU' AS q FROM public.pendencias_de_custo() d WHERE d.tipo = 'parceiro' AND d.codigo NOT IN (SELECT codigo FROM _parc_ant)
           UNION ALL SELECT p.rotulo, 'SAIU' FROM _parc_ant p WHERE p.codigo NOT IN (SELECT codigo FROM public.pendencias_de_custo() WHERE tipo = 'parceiro') LOOP
    v_rel := v_rel || E'\n  ' || r.q || ': ' || r.rotulo;
  END LOOP;
  FOR r IN SELECT d.rotulo FROM public.pendencias_de_custo() d WHERE d.tipo = 'parceiro' ORDER BY 1 LOOP
    v_rel := v_rel || E'\n  lista depois: ' || r.rotulo;
  END LOOP;
  SELECT count(*), count(*) FILTER (WHERE v.preco_minimo_recomendado > pr.preco_parceiro) INTO v_n, v_n2
    FROM public.produto_custo_real v JOIN public.produto_precos pr ON pr.produto_id = v.produto_id WHERE COALESCE(pr.preco_parceiro, 0) > 0;
  v_rel := v_rel || E'\n  produtos com preco de parceiro fixo=' || v_n || ' dos quais com minimo recomendado acima do preco de parceiro=' || v_n2
        || ' (informativo: o minimo e referencia de balcao, a regra de parceiro nunca acima do balcao nao muda)';

  v_rel := v_rel || E'\n[6] ORCAMENTOS ABERTOS (rascunho e enviado)';
  SELECT count(*) INTO v_n FROM public.orcamentos WHERE status IN ('rascunho', 'enviado');
  SELECT count(DISTINCT o.id) INTO v_n2 FROM public.orcamentos o JOIN public.orcamento_itens i ON i.orcamento_id = o.id
    JOIN public.produto_custo_real v ON v.produto_id = i.produto_id
   WHERE o.status IN ('rascunho', 'enviado') AND v.preco_minimo_recomendado > v.preco_balcao;
  SELECT count(DISTINCT o.id) INTO v_n3 FROM public.orcamentos o JOIN public.orcamento_itens i ON i.orcamento_id = o.id
   WHERE o.status IN ('rascunho', 'enviado') AND i.produto_id IN (SELECT produto_id FROM public.produto_custo_real WHERE trava_que_manda IS NOT NULL);
  v_rel := v_rel || E'\n  abertos=' || v_n || ' com algum item de produto cujo minimo recomendado esta acima do preco de balcao=' || v_n2
        || ' com item de produto da view=' || v_n3 || ' (nenhum item foi tocado: hash acima)';

  v_rel := v_rel || E'\n[7] confirmar_custo_fixo com contas reais';
  SELECT ur.user_id INTO v_gestor FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'gestor'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_fin FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'financeiro'::public.app_role AND u.ativo IS NOT FALSE ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO v_vend FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'vendedor'::public.app_role AND u.ativo IS NOT FALSE
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role <> 'vendedor'::public.app_role) ORDER BY 1 LIMIT 1;
  v_rel := v_rel || E'\n  contas: gestor=' || (v_gestor IS NOT NULL) || ' financeiro=' || (v_fin IS NOT NULL) || ' vendedor=' || (v_vend IS NOT NULL);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_gestor::text, true);
  SET LOCAL ROLE authenticated;
  FOR r IN SELECT * FROM (VALUES ('ocupacao_alvo_pct', 4::numeric), ('ocupacao_alvo_pct', 101), ('ocupacao_alvo_pct', 0), ('multiplicador_regra_de_tres', 0),
                                  ('multiplicador_regra_de_tres', 0.5), ('multiplicador_regra_de_tres', 11), ('custo_admin_hora', 5)) AS t(c, v) LOOP
    v_msg := 'NAO RECUSOU';
    BEGIN PERFORM public.confirmar_custo_fixo(r.c, r.v, true); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
    v_rel := v_rel || E'\n  gestor ' || r.c || ' ' || r.v || ': ' || v_msg;
  END LOOP;
  v_msg := 'ok';
  BEGIN v_res := public.confirmar_custo_fixo('ocupacao_alvo_pct', 70, true); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n  gestor ocupacao 70 confirmando: ' || v_msg || ' ' || COALESCE(v_res::text, '');
  BEGIN v_res := public.confirmar_custo_fixo('multiplicador_regra_de_tres', 4, false); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n  gestor multiplicador 4 sem confirmar: ' || v_msg || ' ' || COALESCE(v_res::text, '');
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_fin::text, true);
  SET LOCAL ROLE authenticated;
  v_msg := 'ok';
  BEGIN v_res := public.confirmar_custo_fixo('ocupacao_alvo_pct', 60, true); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n  financeiro ocupacao 60: ' || v_msg || ' ' || COALESCE(v_res::text, '');
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_vend::text, true);
  SET LOCAL ROLE authenticated;
  v_msg := 'NAO RECUSOU';
  BEGIN PERFORM public.confirmar_custo_fixo('ocupacao_alvo_pct', 60, true); EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE || ' ' || SQLERRM; END;
  v_rel := v_rel || E'\n  vendedor ocupacao 60: ' || v_msg;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT string_agg(left(nome, 12) || '=' || preco_minimo_recomendado || '/' || trava_que_manda, '; ' ORDER BY nome) INTO v_txt
    FROM public.produto_custo_real WHERE nome IN ('Lona 280g impressa', 'Adesivo vinil recortado');
  v_rel := v_rel || E'\n  com ocupacao 60 e multiplicador 4: ' || v_txt;

  RAISE EXCEPTION E'ENSAIO DESFEITO\n%', v_rel;
END
$ensaio$;
```
