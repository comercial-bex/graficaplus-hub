# Plano: importar os jobs do Flexi para o Bex Print

Data: 24/10/2026. Estado: **proposta, nada implementado**. Só `SELECT` no banco.

Objetivo: trazer para o hub o que a plotter imprimiu de fato (job, medida, cópias, tinta), ligar cada job ao orçamento e à OS, e daí dar baixa de bobina e de tinta e registrar perda.

## 1. O que o banco mostra hoje (24/10/2026)

| Fato | Número | O que significa |
|---|---|---|
| Movimentações de estoque desde 21/09 | 8 no total, **1** `baixa_os` (13/10) | O estoque de bobina quase não se move. O saldo do sistema não é o saldo real |
| `apontamentos_producao` | **2** no total (22 e 23/10) | A impressão não é apontada |
| OS criadas desde 20/09 | 14, quase todas chaveiro, brinde e acrílico | A lona e o adesivo impressos não passam por OS |
| Jobs na fila do Flexi no mesmo período | cerca de 45 | A diferença é a impressão sem OS |
| Orçamentos "aprovado" sem OS com impressão no Flexi | 36, 38, 54, 56, 57, 62, 70 | Foi impresso sem OS aberta |
| Orçamento 115 (23/10), status "enviado" | 3 jobs de 24/10 já impressos | Impresso antes da aprovação |
| Orçamento 107, criado 22/10 | job de 21/10 de 80×120 | Impresso antes do orçamento existir |

A correspondência job×orçamento acima foi feita por medida e data. É inferência, e o operador confirma.

Máquina cadastrada: "Plotter de Impressão i1600 180 — Eco" (Vuze, 1,80 m úteis, 14 m²/h). A fila do Flexi se chama `YP-SY-I3200`. **Confirmar se é a mesma máquina.** Se for outra, cadastrar.

Bobinas no cadastro (`materiais`): Lona 280g (3,05 m²), Lona 440g reforçada (44 m²), vinil e laminação (0). Todas em **m²**, com `largura_bobina_m` e `comprimento_bobina_m`. Tinta: "Tinta solvente (conjunto)", 4.000 ml.

## 2. Princípios

1. **O Flexi é fonte do fato, não da OS.** O job importado nunca cria nem altera OS, orçamento ou tarefa.
2. **Fato e vínculo ficam em tabelas separadas.** O job bruto não muda. O vínculo é sugerido pelo sistema e **confirmado por uma pessoa**.
3. **Nada baixa estoque sem vínculo confirmado.** Baixa é difícil de desfazer e já houve tela afirmando o que o banco não tinha.
4. **Importar duas vezes não duplica.** Chave única por job.
5. **Tinta estimada e tinta do RIP ficam marcadas.** Nunca se mistura um número com o outro.
6. **Escrita só por função de servidor** que confere a permissão e chama função SQL `SECURITY DEFINER` executável só por `service_role`. É o padrão do `AGENTS.md` para o WhatsApp.

## 3. Como o dado sai do Flexi

Três caminhos, do mais barato ao mais completo. Fazer na ordem.

**A. Ajustes no Flexi (sem código, hoje)**
- Editar › Preferências › **Arquivo**: definir pasta e formato. Em "Após a Saída", usar **Arquivar**. Todo job impresso passa a ser guardado.
- Editar › Preferências › **Caminhos de Arquivo › Trabalhos**: anotar a pasta onde o Flexi guarda os jobs.
- Ver se existe a nuvem SAi (botão no topo e opção "Desativar envio de nomes e miniaturas à nuvem"). Se estiver ativa, a seção **Reports** tem o histórico.
- Regra de nome do arquivo: começar com o número do orçamento, por exemplo `O115 50und 11x7`.
- Alargar a coluna "Nome do Trabalho" antes de tirar print. Hoje o nome sai cortado.

**B. Importação assistida (primeira entrega de código)**
- Tela "Importar do Flexi" no hub. O operador cola ou arrasta o print da fila.
- A IA de visão lê as linhas e o operador confere antes de gravar. Custo: crédito de IA por leitura. Risco: número lido errado, por isso a conferência é obrigatória.
- Quando o Flexi permitir exportar a fila ou o relatório, a mesma tela aceita o arquivo.

**C. Agente no PC do Flexi (só se A e B não bastarem)**
- Programa local que lê a pasta de jobs e envia ao hub. Exige inspecionar o PC e instalar algo lá.

## 4. Modelo de dados proposto

Nomes provisórios. Migração entra como arquivo em `supabase/migrations`.

**`rip_importacoes`**: um lote por importação. Quem, quando, origem (`print`, `arquivo`, `agente`), quantidade de linhas.

**`rip_jobs`**: o fato, imutável depois de gravado.
- `chave_externa` (hash de nome + data/hora + largura + altura + cópias), único por fonte.
- `maquina_id`, `nome_job`, `status_flexi` (Concluído, Abortado, Mantendo), `apos_saida`.
- `largura_cm`, `altura_cm`, `copias`, `area_m2` (largura × altura × cópias), `impresso_em`.
- `perfil_icc`, `tipo_arquivo`, `tamanho_kb`, `job_pai_id` (para jobs aninhados do "Otimizar Distribuição").
- `ml_c`, `ml_m`, `ml_y`, `ml_k`, `tinta_origem` (`rip` ou `estimada`).
- `bruto jsonb` com a linha como veio.

**`rip_job_vinculos`**: a ligação.
- `rip_job_id`, `orcamento_id`, `orcamento_item_id`, `os_id`, `itens_os_id` (todos opcionais).
- `origem` (`numero_no_nome`, `sugestao_medida`, `manual`), `confianca`, `status` (`sugerido`, `confirmado`, `recusado`).
- `confirmado_por`, `confirmado_em`.

**Estoque.** Sem tabela nova. Usa `movimentacoes_estoque` com `origem = 'impressao_rip'` e `os_id`, `os_item_id`, `material_id` preenchidos. Perda usa `os_perdas` (motivo, quantidade perdida, máquina).

## 5. Como o job é ligado a orçamento e OS

Em ordem, parando no primeiro que decide:

1. **Número no nome** (`O115`, `OS 108`). Confiança alta. Sugere o orçamento e a OS dele.
2. **Medida + cópias + data.** Procura item de orçamento de impressão (lona, adesivo, banner) com largura e altura iguais ao job, com tolerância de 3 cm por sangria, criado até 7 dias antes ou depois. Exemplo real: job `250x130` (131 × 251,9 cm) bate com a lona 2,5 × 1,3 m da OS 108.
3. **Mais de um candidato ou nenhum.** Vai para a **fila de revisão**. O operador escolhe, ou marca "sem orçamento" (prova, teste, terceirizado).

Casos especiais:
- **Job aninhado.** O pai ("Otimizar Distribuição") consome a mídia. Os filhos dividem o consumo pela área.
- **Cópias a mais que o pedido** (54 impressas para 50 pedidas): as 4 sobram como perda ou sobra, sinalizadas, não escondidas.
- **Abortado:** vira perda com motivo "job abortado".
- **Impresso sem aprovação ou sem OS:** o vínculo é aceito, mas o job aparece em alerta "impresso antes da aprovação". Sem bloquear a produção.

## 6. Baixa de bobina

- Unidade do cadastro é **m²**. Baixa = área do job (largura × altura × cópias). Jobs aninhados baixam pela área do pai. A sobra de largura da bobina (a lona tem 1,60 m e o job pode ter 1,31 m) é decisão pendente: contar ou não como consumo. Ver pergunta 6.
- Só baixa quando o job está **Concluído** e o vínculo está **confirmado**.
- Registra `custo_unitario_snapshot` da bobina no momento.
- Se a OS já tinha `os_materiais_previstos`, mostra previsto contra realizado. A diferença é o desvio.
- Estoque negativo não bloqueia a importação. Vira alerta "saldo do sistema menor que o impresso", que é o caso de hoje.

## 7. Tinta

Depende da decisão já registrada no plano de 22/10.

1. **Tinta por cor no estoque** (C, M, Y, K) no lugar de "Tinta solvente (conjunto)". Decisão pendente do dono: compra por cor ou por conjunto?
2. **Ml por cor vêm da Estimativa do Flexi** (botão na barra, depois do RIP). Entram na importação ou digitados no job.
3. Sem o número do RIP, a baixa usa a média por m² da ficha do produto e marca `estimada`.
4. Cada job com número do RIP alimenta a média real (ml/m² por produto e modo de impressão).

A Estimativa só funciona se a impressora for compatível (HP não é). Testar na Y-Printer.

## 8. Entrega em fases

| Fase | O que entra | Esforço | Como saber que deu certo |
|---|---|---|---|
| 0 | Ajustes no Flexi (seção 3-A) e regra de nome | P, sem código | Pasta de arquivo recebendo jobs; operador usando `O<nº>` |
| 1 | Tabelas, tela "Importar do Flexi" (print + conferência), `rip_jobs` | M | Reimportar o mesmo print não duplica |
| 2 | Vínculo sugerido e fila de revisão | M | Dos 45 jobs de hoje, os 7 casos do quadro da seção 1 aparecem sugeridos corretos |
| 3 | Baixa de bobina e perda de job abortado | M | Saldo de Lona 440g baixa exatamente a área dos jobs confirmados; reverter vínculo estorna |
| 4 | Tinta por cor e média real | M, depende da decisão de cor | Uma impressão de teste baixa os 4 ml e a média ganha 1 ponto |
| 5 | Agente local ou leitura de relatório (se A e B não bastarem) | G | Importação sem print |

Teste de aceitação sugerido: os três jobs do orçamento 115 de 24/10 (`50 und 11x7`, `60 und 15x8`, `ads 20x15 50 und`) e os dois da OS 108 de 22/10 (`250x130`, `500x130`).

## 9. Riscos

- **Print perde informação:** nome cortado, linhas fora da tela. Mitigação: coluna alargada, conferência humana, lote registrado.
- **Vínculo errado baixa estoque errado.** Mitigação: só vínculo confirmado baixa, e reverter estorna.
- **Operador não segue a regra de nome.** Mitigação: a sugestão por medida cobre a maioria; a fila de revisão cobre o resto.
- **Importar o passado em massa.** Nada é criado em massa: o import só grava `rip_jobs`. OS e tarefas continuam manuais.
- **Impressão fora da fila** (job apagado, impresso em outra máquina). O plano não recupera o que já sumiu. Só a pasta de jobs e a nuvem podem ajudar.

## 10. Perguntas para o dono

1. A plotter `YP-SY-I3200` é a "i1600 180 Eco" do cadastro, ou outra?
2. O Flexi desta máquina tem SAi Cloud e "Reports"?
3. A tinta é comprada por cor ou por conjunto?
4. Os orçamentos "Terceirizado" (como o 78) foram impressos aqui ou fora?
5. O operador aceita começar o nome do arquivo com `O<nº>`?
6. A sobra de largura da bobina conta como consumo ou como sobra reaproveitável?

## 11. Fontes (suporte SAi)

- Production Manager Basic Elements: "Após a Saída", Estimativa, Janela da Nuvem.
- Production Manager Preferences: pasta de arquivo, caminho dos jobs, envio de nomes à nuvem.
- Ink Estimation: depende da impressora; HP não é compatível.
