# Troféu de acrílico: os dados que o dono respondeu e o preço no servidor (22/11/2026)

Migração: `supabase/migrations/20261122300000_trofeu_dados_do_dono.sql`.
Servidor: `src/lib/api/trofeus.functions.ts` (`cotarTrofeu`). Montagem das taxas: `src/domain/trofeus/cotacao.ts`.
Conta: `src/domain/trofeus/conta.ts` (função pura, desde a etapa 1).

## O que o dono respondeu, e o que foi feito com cada resposta

| Resposta de 22/11 | O que a migração faz | O que NÃO é fato (a confirmar) |
| --- | --- | --- |
| Espelhado dourado: "pode botar R$ 480, a folha dela" | Custo unitário e médio de R$ 87,09/174,18 para **R$ 240,00 o m²**; lote de abertura (4 m²) de R$ 87,09 para R$ 240,00 (R$ 960,00 no total); medida 1,00 × 2,00 m gravada | Não há nota de compra. A **medida da folha é presumida** (2,00 m², como as outras chapas); se a folha for maior, o m² cai |
| Velocidade real do corte do laser: "pesquise a máquina e ponha os dados mais próximos" | Corte (m/min): 2 mm 1,9; 3 mm 1,15; 6 mm 0,48; 10 mm 0,2. Gravação: 520 min/m² (antes 60) | **Pesquisado, não medido.** Continua na lista de provisórios até alguém cronometrar na máquina |
| "A nossa máquina só corta até 10 mm" | Nova coluna `espessura_maxima_de_corte_mm` = 10; a conta recusa peça mais grossa com frase em português | A ficha do fabricante (`maquinas.especificacoes`) diz 30 mm. O cadastro da máquina **não foi alterado**: vale o que o dono disse da oficina |
| DTF UV: "deixar desativada, com aviso de que a gente faz por compra externa" | Continua **inativa**; aviso `aviso_22_11_2026` no cadastro dela e `dtf_uv_compra_externa` na lista de provisórios | Ativar exige custo por hora, velocidade, setup e valor de compra, que não existem (a compra está em "Formalização") |
| "A chapa de 15 mm é 1 metro" | Nada muda: o refile de 15 mm **por lado** (1,03 × 2,03 m bruta, 1,00 × 2,00 m útil) já era a conta de 20261122100000 | O 15 mm é a borda da chapa, **não a espessura do acrílico**. Medir com trena era só para confirmar essa borda; o dono confirmou |

### O R$ 174,18 do dourado era o preço de UMA folha

O cadastro tinha custo unitário R$ 174,18 e médio R$ 87,09 por m². A conta fecha: o lote de abertura tem 4 m² a R$ 87,09 =
R$ 348,36 = **2 folhas a R$ 174,18**. R$ 174,18 era o preço de uma folha de 2 m², lido como se fosse por m² (o
unitário), e R$ 87,09 era o m² certo daquela compra. É o mesmo erro do preto a R$ 400 (corrigido em 20261122100000).
Com o valor novo do dono (R$ 480 a folha), o m² passa a R$ 240,00. A folha custar 2,75 vezes o que custou em setembro
vale uma conferência do dono com o fornecedor.

## De onde vêm as velocidades do laser

A máquina é a Vuze VC10060-LM (CO2 100 W, mesa 100 × 60 cm). A Vuze não publica velocidade por espessura em acrílico. Fontes lidas:

- **Forza, tabelas de 100 W** (`support.forzalaser.com/wp-content/uploads/2021/12/PARAMETROS-REFERENCIALES-100-W.pdf`,
  PDF aberto e lido): corte de acrílico a 35% da potência: 3 mm a 24 mm/s, 6 mm a 10 mm/s, 9 mm a 5 mm/s, 12 mm a
  3 mm/s. Gravação a 14%: 400 mm/s com resolução de 0,1 mm.
- **Aeon Laser** (`aeonlaser.us/blogs/news/co2-laser-settings-for-acrylic`, página aberta; 100 W): "melhor velocidade"
  de 3 mm a 25 mm/s e de 10 mm a 4 mm/s; velocidade máxima de 3 mm a 30 mm/s e de 10 mm a 7 mm/s.
- O 2 mm não está em nenhuma tabela lida: foi interpolado (cerca de 40 mm/s).
- A página da Thunder Laser deu erro 403 e não foi lida; a tabela da Omtech só apareceu no resumo da busca. Nenhuma das
  duas entrou na conta.

Folga de 20% sobre o lido (o tubo da casa não entrega os 100 W de catálogo, as curvas freiam o corte e, na gravação,
a cabeça perde tempo no vaivém):

| Espessura | Lido | Com 20% de folga | Gravado (m/min) |
| --- | --- | --- | --- |
| 2 mm | ~40 mm/s (interpolado) | ~32 mm/s | 1,9 |
| 3 mm | 24 mm/s (Forza), 25 (Aeon) | ~19 mm/s | 1,15 |
| 6 mm | 10 mm/s (Forza) | 8 mm/s | 0,48 |
| 10 mm | ~4 mm/s (Forza 9–12 mm, Aeon) | ~3,3 mm/s | 0,2 |
| Gravação | 400 mm/s × 0,1 mm = 0,144 m²/h = 417 min/m² | 521 min/m² | 520 min/m² |

A gravação a 60 min/m² que estava plantada era oito vezes mais rápida que a tabela. Só pesa no modelo com peça gravada
(o premium, "Silhueta gravada").

## Efeito nos preços (1 troféu, ×3; custo cheio conferido à parte, em Python, com as mesmas taxas)

| Modelo | Custo cheio antes | Custo cheio agora | Preço antes | **Preço agora** |
| --- | --- | --- | --- | --- |
| Econômico 18 cm | R$ 17,74 | R$ 17,68 | R$ 53,90 | **R$ 53,90** |
| Padrão 18 cm | R$ 28,45 | R$ 28,36 | R$ 85,90 | **R$ 85,90** |
| Premium 28 cm | R$ 63,70 | R$ 67,25 | R$ 191,90 | **R$ 201,90** |

O econômico e o padrão ficam iguais (cristal e preto, cortes mais rápidos). O premium sobe R$ 10,00: o dourado a R$ 240
e a gravação oito vezes mais lenta pesam mais que o corte um pouco mais rápido.

## O preço no servidor (`cotarTrofeu`)

O molde é o do 3D (`cotarPeca3d`): o vendedor manda o que escolhe e recebe só o preço; o custo nunca desce ao navegador.

- **Entrada estrita:** modelo, altura em cm, quantidade, urgência e arte (tipo, alterações, nomes). Preço, custo,
  multiplicador, margem ou taxa vindos do navegador são recusados.
- **Permissão antes da leitura:** cotar exige `orcamentos.create` ou `orcamentos.update`; ver a decomposição exige
  `financeiro.read`, a mesma chave que a RLS de `trofeu_regras` pede. O cliente do usuário só pergunta permissão; as
  taxas saem com a chave de serviço, depois.
- **Resposta do vendedor:** preço unitário, total, a arte, o total geral e os avisos do que ainda é estimativa. Lista
  explícita de campos: um campo novo na conta não vaza. Nenhum aviso carrega número.
- **Resposta de quem vê custo:** a mesma e custo cheio, custo de produção, multiplicador, faixa, margem líquida e as
  parcelas.
- **As taxas vêm das mesmas fontes do `custo_cheio_do_produto`:** `custos_tabela` (energia, admin, perda, falha,
  ocupação, impostos, cartão), `custos_mao_de_obra` (a função do setor do laser), `maquinas` (laser CO2 e plotter de
  impressão ativos) e **`COALESCE(custo_medio, custo_unitario)`** dos materiais. Resolve a pergunta aberta: o custo do
  material é o **médio**, como nos produtos.
- **Vinil, laminação, tinta e cola por id:** `trofeu_regras.material_*_id` (com chave estrangeira, que também impede apagar
  o material por engano), mais `cola_ml_por_frasco` (250). O servidor não adivinha material pelo nome.
- **Cadastro incompleto é erro em português**, nunca preço com número de fábrica ("Falta o custo por hora do laser...",
  "Não há laser CO2 ativo...", "Há mais de um laser CO2 ativo...").
- **Aviso da plotter:** manutenção, limpeza e cabeçote da plotter ainda não estão informados em `custos_tabela`; quando
  o modelo tem decoração impressa, o aviso diz que ela pode estar um pouco mais barata do que é.

**Ainda nenhuma tela chama `cotarTrofeu`** (é a etapa 3), e a gravação no orçamento (`salvarTrofeuNoOrcamento`) é a
etapa 2b. Esta etapa entrega o preço, travado em testes e conferido com números do banco vivo.

## Testes novos

- `tests/trofeus-cotacao.test.ts`: linhas do banco viram as mesmas taxas do fixture (preço igual, modelo a modelo e
  quantidade a quantidade), fonte de cada taxa (médio antes do último, consumo de tinta medido antes da estimativa),
  cada cadastro incompleto, a arte, os avisos e a resposta pública sem custo.
- `tests/trofeus-no-servidor.test.ts`: entrada estrita, permissão antes da leitura, cliente do usuário sem leitura de
  tabela, resposta do vendedor sem taxa, resposta de quem vê custo, falhas, e quais tabelas e filtros são lidos.
- `tests/trofeus-dados-do-dono.test.ts`: o SQL da migração igual ao fixture que a conta usa.
- `tests/trofeus-migracao.test.ts` (etapa 1) passou a conferir os números de partida, porque esta migração os revisa.
- `tests/sem-modulo-orfao.test.ts`: `src/domain/trofeus/conta.ts` saiu de `CONHECIDOS` (agora `cotacao.ts` a importa e
  `trofeus.functions.ts` importa `cotacao.ts`).

## Ensaio no banco vivo (22/11/2026, desfeito por RAISE EXCEPTION)

A migração inteira, sem o COMMIT, rodou duas vezes (a segunda depois de acrescentar os ponteiros de material) e
terminou numa exceção que desfez tudo, com a leitura do resultado:

- dourado: unitário R$ 240,00, médio R$ 240,00, medida útil 1,000 × 2,000; lote de abertura R$ 960,00;
- regras: corte `{"2": 1.9, "3": 1.15, "6": 0.48, "10": 0.2}`, gravação 520, limite 10 mm, provisórios na lista nova;
- ponteiros: vinil (m², R$ 6,58), laminação (m², R$ 8,00), tinta (ml, R$ 0,23), cola (un, R$ 71,26), cada um com a unidade certa;
- DTF UV: inativa, com o aviso;
- `anon` sem leitura de `trofeu_regras`; usuário logado lê.

O dourado não está em nenhum produto (`produto_materiais` vazio para ele), então nenhum preço de produto se mexe.

## Desfazer

Os valores de antes estão no `logs_auditoria` (`acao = 'trofeu_dados_do_dono'`); o roteiro está no fim da migração.
