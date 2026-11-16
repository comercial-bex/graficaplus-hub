# Ensaio da migração: custo real do produto (16/11/2026)

Migração: `supabase/migrations/20261116100000_custo_real_do_produto.sql`. Estado: **ensaiada no banco vivo em 15/11/2026, desfeita por RAISE EXCEPTION final. NÃO aplicada.** Depois do ensaio conferi que o banco voltou ao que era: 13 linhas em `custos_tabela`, `custo_admin_hora` em 12,00, encargos em 32,19, as duas colunas novas de `custos_tabela` e as duas de `maquinas` inexistentes, `produto_custo_real` e `pendencias_de_custo` inexistentes, o md5 de `custo_cheio_do_produto` (`849742afd482caf421f1b72200381f23`) e o de `custos_tabela_log` (`2c6b8d76e3035e7f3d0522fdbc0eafd2`) como antes, o gatilho de máquina só em `custo_hora` e a função de contagem do ensaio inexistente. Nenhuma mensagem foi enviada e nenhum preço mudou.

O ensaio rodou em duas passadas, as duas desfeitas. A primeira levou o relatório completo (preço, parâmetros, máquinas, gatilhos, acesso, orçamentos abertos). A segunda repetiu a migração só para imprimir a parte que a primeira truncou (a tabela por produto, a view e as pendências). Os números abaixo vêm das duas.

Nenhuma sequência foi consumida: nenhuma das tabelas tocadas tem coluna com `nextval` (conferido em `information_schema.columns`), então o rollback não deixa buraco de numeração.

## O que a migração faz

| Parte | O que faz | Muda dado? |
| --- | --- | --- |
| a | `custos_tabela` ganha `confirmado_em` e `confirmado_por`; `valor` deixa de ser obrigatório; 9 parâmetros novos numa instrução só | 13 linhas antigas viram confirmadas por migração. 9 linhas novas, só o aluguel com número |
| b | `maquinas` ganha `velocidade_calculo_m2_h` e `velocidade_calculo_texto`; só a Plotter i1600 recebe 10 e o texto; gatilho de máquina passa a olhar a velocidade | 1 máquina |
| c | `custo_cheio_do_produto` trocada na definição viva | Só a composição gravada em `produto_precificacao` (recomposição de todos os produtos). Nenhum preço |
| d | Tinta, manutenção, cabeçote e limpeza da plotter entram quando preenchidos e valem zero enquanto vazios | Nada hoje, tudo vazio |
| e | View `produto_custo_real` | Não. É view |
| f | Encargos de 32,19 para 32,82 em `custos_tabela` e em `custos_mao_de_obra` | 1 linha mais 5 linhas |
| g | `pendencias_de_custo()` | Não. É função |

## Item 0: preço e orçamento gravado não mudam

Foto antes e comparação depois, dentro da mesma transação:

| Conferência | Resultado |
| --- | --- |
| `produtos`: `preco_base`, `preco_parceiro`, `preco_publico`, `preco_minimo` de 70 produtos, hash por id | IGUAL |
| `produto_precos`: `preco_base` e `preco_parceiro`, 70 linhas | IGUAL |
| `orcamento_itens`: as 156 linhas inteiras (todas as colunas, em JSON), hash por id | IGUAL |
| `itens_os`: as linhas inteiras, hash por id | IGUAL |

A migração não tem `UPDATE` em `produtos`, `produto_precos`, `orcamentos` nem `orcamento_itens`. O que ela regrava é `produto_precificacao` (custo_material, custo_maquina, custo_mao_obra e custo_indireto), pela função `sincronizar_precificacao_do_produto` que já fazia isso, e esses quatro campos só alimentam o custo. Nenhum gatilho de preço lê o custo para calcular preço.

## Parte a: parâmetros e colunas

Colunas aditivas em `custos_tabela`: `confirmado_em timestamptz` e `confirmado_por uuid` (chave estrangeira para `usuarios`, a mesma identidade do login, `ON DELETE SET NULL`). A tabela não tem GRANT por coluna, então a coluna nova não derruba nenhuma consulta. **Pendente = valor nulo OU `confirmado_em` nulo**, como no contrato.

`valor` era `NOT NULL`. Para um parâmetro nascer vazio, a migração tira o `NOT NULL`. Quem lê esses valores no banco usa `max(valor)` com `COALESCE`, que ignora nulo. Quem lê na tela precisa tratar nulo (ver Riscos).

| Código | Categoria | Valor ao nascer | Confirmado |
| --- | --- | --- | --- |
| `aluguel_espaco_mensal` | fixos | 2000 | sim, `confirmado_em` preenchido, `confirmado_por` nulo (veio do dono, não de uma pessoa logada) |
| `outros_fixos_admin_mes` | fixos | nulo | não |
| `plotter_horas_mes_reais` | plotter | nulo | não |
| `energia_comercial_tarifa_kwh` | energia | nulo | não |
| `tinta_consumo_ml_m2` | plotter | nulo | não |
| `plotter_manutencao_mensal` | plotter | nulo | não |
| `plotter_cabecote_custo` | plotter | nulo | não |
| `plotter_cabecote_vida_m2` | plotter | nulo | não |
| `plotter_limpeza_mensal` | plotter | nulo | não |

As 13 linhas antigas recebem `confirmado_em = now()` na própria migração (sem `confirmado_por`), para o lembrete não cobrar o que já vale. Os códigos de energia comercial e de horas reais não mudam o custo hoje: a energia segue com `energia_tarifa_kwh` (R$ 1,1339) e as horas reais, vazias, caem nas 160 h da máquina.

Dois gatilhos de `custos_tabela` foram corrigidos, ambos provados no ensaio:

| Prova | Resultado |
| --- | --- |
| Só confirmar (`confirmado_em`) sem mudar o número | 0 linhas de `produto_precificacao` atualizadas. Antes, qualquer UPDATE recompunha o custo de todos os produtos |
| Mudar o valor | 109 linhas de `produto_precificacao` recompostas e `confirmado_em` preenchido sozinho |
| Apagar o valor | `confirmado_em` volta a nulo (o parâmetro volta a ser pendente) |

O gatilho de recomposição passou de "todo INSERT, UPDATE e DELETE" para `UPDATE OF valor, ativo` (mais INSERT e DELETE). `custos_tabela_log` foi trocada na definição viva (md5 conferido): mantém `updated_at` e o histórico do valor, e passa a carimbar quem confirmou. Mantive `SECURITY DEFINER` com `search_path = public`, como era.

## Aluguel dentro do rateio, nunca por cima

O custo administrativo por hora continua sendo UMA linha, `custo_admin_hora`, lida por `custo_cheio_do_produto`, `custo_do_acabamento_interno` e pelas telas. Um gatilho de linha (`tg_custos_rateio_admin_hora`) a mantém igual a **(aluguel + outros fixos) dividido pelas horas do mês**. As horas são `plotter_horas_mes_reais` se preenchida, senão as horas produtivas da i1600 (160). Se o aluguel não estiver confirmado ou for zero, o gatilho não mexe na linha.

Provado no ensaio:

| Situação | `custo_admin_hora` |
| --- | --- |
| Antes | 12,00 |
| Aluguel 2000, base 160 h, outros fixos vazios | 12,50 |
| Outros fixos 112 | 13,20 (conta: 2112 sobre 160) |
| Apagar outros fixos | 12,50 |
| Horas reais 200 | 10,00 |
| Apagar horas reais | 12,50 |

Com só o aluguel o rateio sobe R$ 0,50 por hora. O R$ 12,00 antigo descrevia aluguel, internet e software, e 12 vezes 176 h dá R$ 2.112 por mês, então quando o gestor informar `outros_fixos_admin_mes` o número tende a ficar perto do antigo. Quem edita `custo_admin_hora` na mão passa a ser sobrescrito na próxima mudança de aluguel, outros fixos ou horas: a tela deve apontar para o aluguel e não para a linha derivada.

## Parte b: máquinas, velocidade usada e velocidade nominal

`maquinas.velocidade_m2_h` não muda: a Plotter i1600 continua em 14 (catálogo). Colunas novas: `velocidade_calculo_m2_h` e `velocidade_calculo_texto`. Só a i1600 recebeu valor: 10 e o texto "A máquina faz 14 m² por hora no catálogo. O sistema calcula o custo com 10 m² por hora, como margem de segurança." No ensaio, `M outras com calculo preenchido: 0`.

Coluna nova numa tabela com GRANT por coluna nasce sem GRANT e derrubaria a consulta. Conferido:

| Conferência | Resultado |
| --- | --- |
| `authenticated` lê `velocidade_calculo_m2_h` | sim (GRANT por coluna só nas duas colunas novas) |
| `anon` lê a coluna nova | não |
| `authenticated` lê `custo_hora` | não, como antes |
| Consulta de `maquinas` com `id, nome, velocidade_m2_h, velocidade_calculo_m2_h, velocidade_calculo_texto` como `authenticated` | roda, não derruba |
| `maquinas_financeiro` | intacta, `security_invoker=false` e `security_barrier=true` como antes. Não precisei recriá-la, então não há `CREATE OR REPLACE VIEW` descartando opção |

`COLUNAS_DA_MAQUINA_SEM_CUSTO` em `src/domain/maquinas/colunas.ts` passou a listar as duas colunas novas: o teste `custo-das-maquinas-pela-visao` e o de GRANT por coluna exigem que coluna nova de `maquinas` esteja na lista, e a lista vira o `select` de quem não vê custo. **Ordem de deploy: aplicar a migração ANTES de publicar o front.** Com o front novo no ar e a migração ainda não aplicada, o `select` de máquinas pede coluna inexistente e a consulta cai para todo mundo.

Gatilho de máquina: de `UPDATE OF custo_hora` para `UPDATE OF custo_hora, velocidade_m2_h, velocidade_calculo_m2_h`. Provado: mudar só `velocidade_calculo_m2_h` recompôs 109 linhas de `produto_precificacao`. Antes disso, mudar a velocidade deixava o custo antigo gravado.

Agenda e capacidade seguem na velocidade nominal: `agendar_os_interno`, `capacidade_das_maquinas` e `pendencias_do_sistema` leem `maquinas.velocidade_m2_h` e não foram tocadas (md5 do corpo conferido, nenhuma na migração). Se o dono quiser agenda a 10, é decisão separada.

## Parte c e d: custo_cheio_do_produto

Troca na definição viva, com guarda de md5 (`849742af...`). O que muda:

| Item | Antes | Depois |
| --- | --- | --- |
| Velocidade no cálculo do tempo | `velocidade_m2_h` | `COALESCE(NULLIF(velocidade_calculo_m2_h, 0), velocidade_m2_h)` |
| Texto de `criterio_do_tempo` | "velocidade da máquina (14 m²/h) × 1.5 para a mão de obra" | Sem parênteses nem sinal de vezes. Na i1600 diz que a máquina faz 14 e que o sistema usa 10 por margem de segurança |
| Perda e falha | não entravam | Divisor sobre o material de ficha: material dividido por (1 menos 13 por cento), menos o material. 13 por cento é 8 de perda mais 5 de falha, lidos de `custos_tabela`. Custo digitado sem ficha e serviço inteiro não levam perda |
| Extras da plotter | não existiam | Manutenção mais limpeza, cada uma dividida pelas horas do mês e vezes as horas de máquina por m²; cabeçote dividido pela vida em m²; tinta só se o produto não tem tinta na ficha. Cada parcela vale zero enquanto o parâmetro está vazio |
| Sinalizadores novos | não existiam | `sem_tinta`, `material_sem_custo`, `sem_mao_de_obra`, `custo_incompleto`, `tempo_presumido`, `usa_plotter`, `velocidade_usada_m2_h`, `velocidade_nominal_m2_h` |
| Rateio por hora | 12,00 | 12,50 (gatilho acima) |
| Encargos | 0,3219 | 0,3282 |

**Decisão de desenho que o dono precisa saber.** `custo_total`, `custo_material`, `custo_maquina`, `custo_mao_obra` e `custo_indireto` continuam com o mesmo significado. A perda e o extra saem em chaves à parte (`custo_perdas`, `custo_extra`, `custo_producao`) e **não entram em `produto_custo_cheio`**, nem em `sincronizar_precificacao_do_produto` (que não foi tocada). Motivo: `desconto_avaliar` já divide o piso por 1 menos a taxa e lê `custo_cheio` ao vivo; somar perda e taxa ali mudaria piso e alçada de orçamentos abertos além do necessário. Trocar `desconto_avaliar` e `meta_por_produto` para o custo real é uma migração própria, depois do OK do dono. Mesmo sem isso, o `custo_cheio` sobe por três motivos que agora valem: velocidade 10, rateio 12,50 e encargos 32,82.

A tinta: os produtos que já têm tinta na ficha (18 fichas, R$ 0,23 por ml) não ganham nada, a tinta deles já está no material. Só os que imprimem na plotter sem tinta na ficha usam `tinta_consumo_ml_m2` quando o gestor o preencher. Provado: 3 produtos `sem_tinta` antes de informar o consumo, 0 depois de informar 10 ml por m2. Limpeza de R$ 160 por mês com 160 h dá R$ 0,10 por m2 de extra nos produtos de m2 da plotter (esperado 0,10, achado 0,10).

## Parte e: view produto_custo_real

Colunas, na ordem do contrato: `produto_id, nome, familia, preco_balcao, custo_producao, custo_real, margem_liquida_pct, vezes_o_custo, preco_regra_de_tres, sem_tinta, material_sem_custo, sem_mao_de_obra, custo_incompleto, velocidade_usada_m2_h, velocidade_nominal_m2_h, tempo_presumido, parceiro_abaixo_do_piso`. Uma linha por produto ativo com preço: **39 linhas**.

- `custo_real = custo_producao / (1 - 0,0775)`. A taxa 0,0775 é o imposto sobre a venda (6) mais metade da taxa do cartão (3,5 dividido por 2), lidos de `custos_tabela`, como `desconto_avaliar` calcula.
- `margem_liquida_pct = (1 - custo_real / preco_balcao) * 100`. Conferido nas 39 linhas: 0 linhas fora da fórmula por mais de 0,01, e 0 linhas em que `custo_real` vezes (1 menos a taxa) difere de `custo_producao` por mais de 0,01.
- `vezes_o_custo = preco_balcao / custo_real`. `preco_regra_de_tres = custo_real * 3`, só referência.
- `parceiro_abaixo_do_piso`: o preço de parceiro entrega margem líquida menor que a margem mínima do produto (30 quando não há). 3 produtos.
- `tempo_presumido` é verdadeiro quando o tempo vem do `tempo_producao_min` do cadastro e falso quando vem da velocidade da máquina. `velocidade_usada_m2_h` aparece 0 nas máquinas sem velocidade cadastrada (acrílico, laser); leia 0 como "sem velocidade", e nulo quando o produto nem tem máquina padrão.
- `custo_incompleto`: `sem_tinta`, material sem custo, sem mão de obra, ou manutenção, limpeza ou cabeçote da plotter ainda vazios (só para quem usa a i1600). 15 dos 39 estão incompletos hoje. 11 usam a plotter (parâmetros de manutenção, limpeza e cabeçote vazios, e 3 deles sem tinta na ficha) e os outros 4 não usam a plotter.

Acesso, conferido:

| Conferência | Resultado |
| --- | --- |
| `reloptions` de `produto_custo_real` | `security_invoker=true` |
| `reloptions` de `produto_custo_cheio` | `security_invoker=true` (intacta, 14 colunas, mesma ordem) |
| `has_table_privilege` na view | `anon` falso, `authenticated` falso, `service_role` verdadeiro |
| Papel `anon` lendo a view (`SET LOCAL ROLE`) | bloqueado, 42501 |
| Papel `authenticated` lendo a view | bloqueado, 42501 |
| Papel `service_role` lendo a view | 39 linhas |
| EXECUTE de `custo_cheio_do_produto` | `anon` falso, `authenticated` falso, `service_role` verdadeiro (já era; a migração reafirma) |

`CREATE OR REPLACE VIEW` descarta opções, mas a view é nova: as opções e os GRANTs são aplicados na criação, e o `REVOKE` de `PUBLIC`, `anon` e `authenticated` é explícito porque o Supabase concede a novas views por padrão. Revogar só `PUBLIC` não fecha o `anon`.

### Tabela por produto (balcão, custo cheio antes e depois, produção, real, margem)

Base do ensaio: banco de 15/11/2026, plotter a 10 m2 por hora, perda mais falha de 13 por cento sobre material de ficha, mão de obra R$ 12,23 por hora, rateio R$ 12,50 por hora, taxa 7,75 por cento dividindo o custo. Valores por unidade do produto (por m2 nos de área).

| Produto | Balcão | Cheio antes | Cheio depois | Produção | Real | Margem líquida | Vezes | Regra de três |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Adesivo vinil branco impresso | 55,00 | 12,91 | 14,48 | 15,85 | 17,18 | 68,76 | 3,20 | 51,54 |
| Adesivo perfurado | 82,00 | 13,08 | 14,65 | 16,04 | 17,39 | 78,79 | 4,72 | 52,17 |
| Lona 280g impressa | 45,00 | 14,07 | 15,64 | 17,19 | 18,63 | 58,60 | 2,42 | 55,89 |
| Faixa em lona | 45,00 | 14,07 | 15,64 | 17,19 | 18,63 | 58,60 | 2,42 | 55,89 |
| Lona para cavalete | 45,00 | 14,07 | 15,64 | 17,19 | 18,63 | 58,60 | 2,42 | 55,89 |
| Laminação de adesivo | 28,00 | 14,44 | 14,59 | 15,84 | 17,17 | 38,68 | 1,63 | 51,51 |
| Banner com bastão e corda | 64,90 | 15,95 | 17,52 | 19,35 | 20,97 | 67,69 | 3,09 | 62,91 |
| Lona com adesivo aplicado | 74,90 | 20,98 | 22,55 | 25,13 | 27,24 | 63,63 | 2,75 | 81,72 |
| Adesivo vinil recortado | 68,00 | 21,81 | 22,14 | 23,22 | 25,17 | 62,99 | 2,70 | 75,51 |
| Lona 440g reforçada impressa | 70,00 | 23,96 | 25,53 | 28,56 | 30,95 | 55,79 | 2,26 | 92,85 |
| Adesivo transparente | 59,90 | 24,50 | 26,07 | 29,18 | 31,63 | 47,20 | 1,89 | 94,89 |
| Banner com bastão e corda lona 440g | 89,90 | 24,93 | 26,50 | 29,67 | 32,16 | 64,23 | 2,80 | 96,48 |
| Placa PS 2mm com adesivo | 145,00 | 54,61 | 56,18 | 63,78 | 69,14 | 52,32 | 2,10 | 207,42 |
| Placa PVC expandido 3mm | 175,00 | 78,73 | 79,19 | 87,94 | 95,33 | 45,53 | 1,84 | 285,99 |
| Acrílico Virgem Recortado 2mm | 600,00 | 182,07 | 182,53 | 205,11 | 222,34 | 62,94 | 2,70 | 667,02 |
| Acrílico Virgem Recortado 3mm | 800,00 | 221,49 | 221,95 | 250,42 | 271,46 | 66,07 | 2,95 | 814,38 |
| Quadro Acrilico | 1000,00 | 228,07 | 228,53 | 257,98 | 279,66 | 72,03 | 3,58 | 838,98 |
| Acrílico Espelhado Recortado 2mm | 1000,00 | 430,94 | 431,40 | 431,40 | 467,64 | 53,24 | 2,14 | 1402,92 |

Os demais 21 produtos ativos com preço (serviços, acabamentos, brindes, laser, impressão A4) mudam o custo cheio em no máximo R$ 0,15 e nenhum depende da plotter. Exemplos: Acabamento de lona 4,73 para 4,82; Impressão A4 colorida 1,61 para 1,63; Corte a laser, Criação, Instalação, Deslocamento e Acabamento manual não mudam. A lista inteira está no relatório do ensaio; as margens líquidas vão de 11,23 (Copo térmico 500ml) a 86,16 (Certificado A4).

**Diferença para a tabela do plano.** O plano de 15/11 mostrava, por exemplo, adesivo vinil com custo real de 20,03 e margem de 63,6. Aquela conta somava as taxas sobre o PREÇO (custo de produção mais 7,75 por cento do balcão). O contrato desta entrega manda dividir o CUSTO por (1 menos 0,0775), como `desconto_avaliar`, o que dá 17,18 e margem de 68,76. Segui o contrato. As duas contas não são equivalentes: a do plano é mais severa em produtos de preço alto. Quem for escrever a tela deve usar a view e não refazer a conta. O custo de produção bate com o plano (lona 440g: plano 28,47, aqui 28,56, a diferença de 0,09 é o salário com encargo corrigido e o rateio de 12,50).

Produtos de parceiro abaixo do piso hoje: **Adesivo transparente, Lona 280g impressa e Lona 440g reforçada impressa**. O plano citava lona 440g e adesivo transparente; a lona 280g também aparece agora, porque o custo de produção passou a ter perda e velocidade 10.

## Parte g: pendencias_de_custo()

`pendencias_de_custo() returns table(codigo text, rotulo text, tipo text)`, `SECURITY DEFINER`, `search_path = public`, EXECUTE só para `service_role` (`anon` falso, `authenticated` falso, conferido; `authenticated` chamando recebe 42501). Devolve três tipos:

| Tipo | O que lista | Hoje |
| --- | --- | --- |
| `parametro` | linha ativa de `custos_tabela` fora da categoria `chave` com valor nulo ou sem confirmação | 8 itens: tinta, cabeçote (custo e vida), horas reais, limpeza, manutenção, outros fixos e energia comercial |
| `material_sem_custo` | material com custo zero que está em ficha de produto ativo | 0 |
| `parceiro_abaixo_do_piso` | linha de `produto_custo_real` com o sinalizador verdadeiro | 3 |

O rótulo é a descrição da linha ou o nome do produto: **nunca custo em reais**, para o aviso poder ir ao grupo. Como service_role, o ensaio leu 11 linhas. O aluguel não aparece porque está confirmado.

## Parte f: salário e encargos

`mo_encargos_pct` em `custos_tabela`: 32,19 para 32,82. `custos_mao_de_obra.encargos_pct`: 0,3219 para 0,3282 nas 5 funções (Acabamento, Designer, Entregador, Instalador, Impressor). Parcelas: FGTS 8,00, 13º 8,33, férias com um terço 11,11, FGTS sobre 13º e férias 1,56, rescisão provisionada 3,82 (era 3,20), total 32,82. Custo da hora: R$ 9,2102 com 0,3282 dá R$ 12,2330 (era 12,17 no texto antigo e 12,18 com 0,3219). Salário R$ 1.621 e 176 h ficam como estão. A observação das linhas registra a composição, a premissa do Simples Nacional e "Estimativa".

**Quem lê encargos, conferido:**

| Leitor | Como lê | Precisa mexer? |
| --- | --- | --- |
| `custo_cheio_do_produto` | `custos_mao_de_obra.encargos_pct` | Não, já lê 0,3282 |
| Funções SQL com `mo_encargos_pct` | nenhuma | Não |
| `src/domain/financeiro/encargos.ts` (parcelas, rescisão 3,20) e `tests/encargos.test.ts` | constante no código | **Sim, frente de tela.** O código ainda soma 32,19 |
| `src/routes/_authenticated/custos-producao.tsx` (`quantoFalta(0.3219)`) | constante no código | **Sim.** Quem salvar um salário por essa tela recalcula `encargos_pct` pelo `encargos.ts` e volta a gravar 0,3219 em cima do 0,3282 |
| `tests/custo-cheio-tempo-energia-e-mao-de-obra.test.ts` | lê a migração antiga de 25/10 por texto | Não, é a história |
| `src/components/produtos/custo-da-peca.tsx`, `src/domain/precificacao/parametros.ts`, `simulador.ts`, `planilha-custos.tsx`, `configuracoes-3d.tsx`, `lib/pdf/generate.ts` | citam `mo_encargos_pct` ou `custo_admin_hora` de `custos_tabela` | Leem a linha do banco, então pegam 32,82 e 12,50 sozinhos. Conferir se algum guarda 32,19 ou 12 em constante |

## Consumidores de custo_cheio_do_produto e de produto_custo_cheio

| Consumidor | O que lê | Efeito |
| --- | --- | --- |
| `sincronizar_precificacao_do_produto` | `custo_cheio_do_produto` (4 campos de composição) | Regrava `produto_precificacao`. Chamada por vários gatilhos (produto, ficha, material, máquina, mão de obra e parâmetros). Não mexe em preço |
| `produto_custo_cheio` (view) | `produto_precificacao` | `custo_cheio` muda como na tabela acima. Colunas e opções intactas |
| `desconto_avaliar` | `max(custo_cheio)` por produto | O piso e o desconto máximo do vendedor mudam (abaixo) |
| `meta_por_produto` | `custo_cheio` e componentes, via view | Custo e margem do ranking mudam na mesma proporção. Não foi alterada |
| `produto_custo_real` (nova) | `custo_cheio_do_produto` ao vivo | Nova |
| `custo_do_acabamento_interno` | `custo_admin_hora` | Lê 12,50 em vez de 12,00. Não medido produto a produto |
| `ponto_de_equilibrio` | `pct_perda_material`, `pct_falha_producao`, imposto, cartão | Não muda. Atenção: ele usa perda e falha como acréscimo (1 mais perda mais falha), e `custo_cheio_do_produto` usa divisor (1 menos 13 por cento). São convenções diferentes; o divisor foi o pedido do dono e ainda não foi confirmado por ele |
| `agendar_os_interno`, `capacidade_das_maquinas`, `pendencias_do_sistema` | `velocidade_m2_h` nominal | Sem efeito |

### Orçamentos abertos: piso de desconto

Os 156 itens de orçamento não têm custo previsto gravado, então `desconto_avaliar` recalcula o piso ao vivo a partir de `produto_custo_cheio`. Rodei `desconto_avaliar` antes e depois, com o subtotal, o desconto já gravado e crédito zero, em todo orçamento aberto com itens: **42 orçamentos, 15 rascunhos e 27 enviados** (os 18 rascunhos restantes não têm itens; aprovados e convertidos não são reavaliados pelo sistema).

| Resultado | Quantidade |
| --- | --- |
| Piso subiu | 25 |
| Piso igual | 12 |
| Sem piso (regra de limite fixo de 10 por cento, sem custo) | 5 |
| Piso desceu | 0 |
| Desconto máximo do vendedor encolheu | 25 |
| Desconto máximo igual | 17 |
| Desconto máximo cresceu | 0 |
| **Alçada mudou** (vendedor, gerente, abaixo do piso, sem desconto) | **0** |

Nenhum orçamento muda de alçada com o desconto que já tem, mas 25 ficam com menos folga para desconto. Os 25, com piso e desconto máximo do vendedor antes e depois:

| Orçamento | Situação | Piso antes | Piso depois | Máx. vendedor antes | Máx. vendedor depois |
| --- | --- | --- | --- | --- | --- |
| 69 | rascunho | 1113,90 | 1124,48 | 342,49 | 324,16 |
| 82 | enviado | 19,59 | 21,98 | 42,41 | 38,20 |
| 99 | enviado | 46,71 | 46,76 | 17,52 | 17,44 |
| 115 | enviado | 168,94 | 173,61 | 95,11 | 86,87 |
| 134 | enviado | 107,66 | 116,38 | 148,82 | 134,21 |
| 158 | enviado | 17,29 | 18,99 | 34,37 | 31,37 |
| 166 | rascunho | 25,93 | 28,49 | 51,56 | 47,05 |
| 168 | enviado | 117,93 | 123,49 | 117,06 | 107,24 |
| 169 | rascunho | 46,34 | 51,90 | 193,32 | 184,35 |
| 174 | enviado | 25,97 | 27,67 | 28,15 | 25,41 |
| 175 | enviado | 69,13 | 77,54 | 149,14 | 134,30 |
| 181 | rascunho | 1113,90 | 1124,48 | 342,49 | 324,16 |
| 196 | enviado | 19,74 | 19,79 | 25,15 | 25,07 |
| 197 | enviado | 120,05 | 120,30 | 188,05 | 187,61 |
| 198 | enviado | 10,50 | 11,77 | 22,72 | 20,47 |
| 199 | rascunho | 97,91 | 109,81 | 211,91 | 190,89 |
| 200 | enviado | 46,71 | 46,76 | 17,52 | 17,44 |
| 201 | enviado | 237,35 | 266,21 | 513,75 | 462,79 |
| 206 | enviado | 14,03 | 14,94 | 15,20 | 13,72 |
| 209 | enviado | 37,83 | 38,40 | 42,01 | 41,00 |
| 213 | enviado | 19,48 | 21,85 | 42,17 | 37,98 |
| 217 | rascunho | 133,70 | 140,70 | 168,33 | 155,97 |
| 221 | enviado | 28,05 | 29,89 | 30,40 | 27,44 |
| 227 | enviado | 166,23 | 177,12 | 180,15 | 162,60 |
| 233 | enviado | 11,64 | 13,06 | 25,20 | 22,70 |

O orçamento 69 e o 181 têm o mesmo piso e o mesmo máximo porque os itens são os mesmos. O gerente deve ser avisado antes de aplicar: nenhuma cobrança muda, mas o vendedor que ia dar um desconto no limite pode ser barrado no envio. Isto vale para a troca de definição de `custo_cheio_do_produto`, sem trocar `desconto_avaliar`. Se `desconto_avaliar` passar a ler o custo real (perda mais taxa), o piso sobe de novo e este quadro precisa ser refeito.

Itens de orçamento já gravados: 156 antes, 156 depois, linha a linha iguais (hash). Cliente e orçamento já enviado com preço antigo não são repreçados.

## Roteiro do ensaio

Tudo dentro de uma transação desfeita por `RAISE EXCEPTION` no fim. A foto "antes" vai para tabelas temporárias, a migração roda inteira (sem o `BEGIN` e o `COMMIT`), e um bloco `DO` compara e monta o relatório. Uma função e um gatilho de contagem criados dentro da transação provam que confirmar não recompõe. Papéis testados com `SET LOCAL ROLE` dentro de blocos que capturam `insufficient_privilege`.

```sql
CREATE TEMP TABLE rel(n serial, linha text);
CREATE TEMP TABLE a_prod AS SELECT p.id, p.nome, pr.preco_base, pr.preco_parceiro, c.custo_cheio
  FROM produtos p JOIN produto_precos pr ON pr.produto_id = p.id JOIN produto_custo_cheio c ON c.produto_id = p.id WHERE p.ativo;
CREATE TEMP TABLE a_hash AS SELECT
  (SELECT md5(string_agg(id::text || coalesce(preco_base::text,'-') || coalesce(preco_parceiro::text,'-') || coalesce(preco_publico::text,'-') || coalesce(preco_minimo::text,'-'), ',' ORDER BY id)) FROM produtos) h_prod,
  (SELECT md5(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id)) FROM orcamento_itens i) h_itens;
CREATE TEMP TABLE a_desc AS SELECT o.id, o.numero, o.status::text status,
  public.desconto_avaliar(o.id, o.valor_subtotal, coalesce(o.desconto_valor,0), 0) r
  FROM orcamentos o WHERE o.status::text IN ('rascunho','enviado') AND EXISTS (SELECT 1 FROM orcamento_itens i WHERE i.orcamento_id = o.id);
-- cole aqui o corpo da migração, sem BEGIN, SET LOCAL e COMMIT
DO $ens$
BEGIN
  -- compara os hashes, lista produto a produto, testa papéis e gatilhos, avalia desconto_avaliar de novo
  RAISE EXCEPTION E'ENSAIO OK, DESFEITO\n%', (SELECT string_agg(linha, E'\n' ORDER BY n) FROM rel);
END $ens$;
```

## Riscos e o que não foi feito

1. **Tela e `valor` nulo.** `src/components/custos/parametros-da-casa.tsx` lista as linhas de `custos_tabela` e hoje trata `valor` como número. As 8 linhas pendentes chegam nulas. A tela precisa mostrar "ainda não informado" e o campo de confirmar. Nada foi mudado no front.
2. **`custos-producao.tsx` desfaz o 32,82.** Ver a tabela de leitores de encargos: enquanto `encargos.ts` tiver rescisão 3,20, salvar salário por essa tela regrava 0,3219.
3. **`custos.update` ainda é só de admin e gestor.** Financeiro lê e não grava. Não criei a permissão `custos.fixos.update` nem policy nova: depende do dono. Sem isso, as pendências de aluguel e de plotter ficam sem quem confirme além de admin e gestor.
4. **Sem RPC de confirmação.** Confirmar é um UPDATE comum em `custos_tabela` (mudar o valor já carimba quem e quando; só carimbar `confirmado_em` também grava quem). A RPC `SECURITY DEFINER` do plano ficou de fora porque o contrato não a pede.
5. **Margens mostradas caem.** O plano estimava a margem de hoje em 55 a 84 por cento nos produtos de plotter. Com o custo real, a margem líquida dos 39 produtos vai de 11 a 86 por cento, e 3 produtos de parceiro ficam abaixo do piso. A tela deve explicar a diferença.
6. **Aluguel em dois lugares.** O aluguel de `custos_tabela` é só custo por m2 (rateio). O compromisso de caixa mora em contas a pagar e na meta do mês. A tela precisa dizer isso para ninguém somar duas vezes.
7. **Convenção do divisor não confirmada.** Perda mais falha como divisor sobre material (13 por cento) é a regra do contrato. `ponto_de_equilibrio` usa acréscimo. O dono ainda não confirmou qual vale.
8. **Base de 160 h.** O rateio usa 160 h (as horas da i1600), não 176. Alternativa: preencher `plotter_horas_mes_reais`.
9. **Agenda e calculadora do orçamento.** A calculadora de orçamento (`calculadora-custo.tsx`) lê o modo Produção, 14 m2 por hora, de `maquinas_modos_impressao`. Se não for ajustada, o custo do item do orçamento e o custo do produto divergem na plotter. Não é banco e não está aqui.
10. **Testes de outras frentes que tive de ajustar.** `tests/custo-das-maquinas-pela-visao.test.ts` (espelho das colunas vivas de `maquinas`) ganhou as duas colunas novas, e `tests/privacidade-de-custo-banco.test.ts` passou a somar os `GRANT SELECT` por coluna de migrações posteriores à B3 antes de comparar com a lista do código. Sem isso as duas colunas novas quebrariam o CI.
11. **Não feito:** trocar `desconto_avaliar` e `meta_por_produto` para o custo real; `types.ts` gerado e a tela; o lembrete diário e o cron; a permissão do financeiro; `produto_precificacao.custo_perdas` e `custo_extra` (a view calcula ao vivo e não precisou de coluna).
12. **Fontes secundárias** (RAT, 13º e férias sem página oficial, salário mínimo sem reajuste extraordinário confirmado) seguem como no plano: a observação das linhas diz "Estimativa".

## Revisão independente (16/11/2026): visão `maquinas_financeiro`

A visão `maquinas_financeiro` lista as colunas uma a uma. Sem ajuste, quem vê custo (`lerMaquinas(true)`, `select("*")` na visão) receberia as duas colunas novas de velocidade vazias, enquanto quem não vê custo as receberia da tabela. A migração agora recria a visão com as duas colunas no fim e reafirma `security_barrier = true` e `security_invoker = false`. Ensaiada em transação desfeita no banco vivo: opções preservadas, 34 colunas, `SELECT` de `authenticated` mantido.
