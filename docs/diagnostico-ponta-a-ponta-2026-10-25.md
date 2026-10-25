# Diagnóstico ponta a ponta — Bex Print, 25/10/2026

Do cliente que chega até a peça entregue e paga, passando por orçamento, envio, aprovação, produção, estoque, dashboards e configurações. Base: o banco de produção (só consultas de leitura, números de hoje), o código em `main` e os documentos de 22/10 (`plano-de-acao-2026-10-22.md`) e 24/10 (`simulacao-balcao-2026-10-24.md`).

Legenda: 🟢 funciona e conversa com o próximo elo · 🟡 funciona, mas com furo · 🔴 existe e não é usado ou não conversa.
**[Medido]** = contagem no banco hoje · **[Código]** = visto no repositório · **[Dedução]** = leitura minha, a confirmar.

---

## 0. O pedido, melhorado

O pedido original ("diagnóstico completo, detalhado, de ponta a ponta") rendeu mais quando ficou assim. Vale reaproveitar para as próximas rodadas:

> **Objetivo:** dizer, com número, se um pedido real consegue ir do primeiro contato do cliente até a entrega paga **sem que alguém precise lembrar do passo seguinte**, e o que impede.
> **Escopo:** entrada de cliente (lead, WhatsApp, cadastro) → orçamento → envio → aprovação → conversão em OS → arte → produção → estoque → entrega → cobrança e pagamento → pós-venda; dashboards; configurações e permissões.
> **Para cada elo:** o que existe (módulo e tabela), quanto é usado (contagem), com quem conversa (o que entrega e o que recebe), e o veredito.
> **Entregar:** (1) como estava, o que foi feito, como deve ficar; (2) matriz de comunicação entre módulos; (3) achados com prova; (4) plano em fases, cada uma com o resultado que o usuário vê; (5) o que só o dono decide.
> **Regras:** só leitura; número sem prova não entra; o que faltar de informação entra como valor simbólico com tag, nunca como dado real.

---

## 1. Veredito

**O sistema está construído quase inteiro e usado pouco. O que mais trava a operação não é falta de tela: é elo sem cola.** Cada módulo funciona sozinho; o que falta é um passo entregar para o seguinte sem a mão de uma pessoa.

Os cinco elos que mais pesam, em ordem:

1. **Aprovado não vira OS sozinho.** 8 orçamentos aprovados (R$ 619,51) esperam alguém converter. Enquanto isso o cliente acha que está em produção. [Medido]
2. **Dinheiro entra antes da produção começar.** 7 OS de venda abertas já foram pagas (R$ 2.738,74); a #161 recebeu R$ 1.200 e continua em "entrada". [Medido]
3. **Sobras de orçamento vazio poluem a lista.** 39 de 65 orçamentos (60%) não têm item nem versão; 26 são "rejeitados"/"expirados" antigos e sem valor, restos do botão que criava um orçamento por clique (corrigido em 21/10). Os cartões da lista já deixam esses status fora do "em aberto"; o que sujava era a lista e qualquer conta que eu fizesse sobre o total: a "taxa de rejeição" de 38% não vale, as rejeições de verdade são 2. [Medido]
4. **Entrega, portal e pós-venda existem e estão vazios.** `entregas_instalacoes` 0, `portal_cliente_acessos` 0, `aprovacoes` 0, `ocorrencias` 0, `pos_venda_tickets` 0. A OS é "concluída" sem comprovante de entrega. [Medido]
5. **Origem do cliente se perde.** 14 leads, 0 viraram cliente no cadastro; 22 de 28 clientes sem origem; 15 de 27 conversas de WhatsApp sem cliente. Não dá para saber qual canal traz dinheiro. [Medido]

E dois alertas de caixa que ninguém via (agora aparecem no painel, §5): **pagamento sem parcela** (2, R$ 300 na OS #168) e **OS que recebeu mais do que a conta** (a #168 recebeu R$ 600 contra uma conta de R$ 300 — pode ser lançamento em dobro; uma pessoa precisa conferir o extrato).

---

## 2. Como estava, o que foi feito, como deve ficar

Fotografia de 22/10 (documento anterior) × hoje × alvo. Cada linha usa o ID do plano de 22/10.

| ID | Tema | 22/10 | Hoje (25/10) | Alvo |
|---|---|---|---|---|
| R1 | Versão congelada do orçamento | 26 enviados/aprovados sem versão | **0 sem versão** (31 versões) 🟢 | mantido |
| R2 | Fechar OS com prova | `fechar_os` barrava só tarefa obrigatória | `fechar_os` barra 11 coisas: tarefas, qualidade, baixa de material, ocorrência, entrega, apontamento aberto, custo, layout final, medidas 🟡 | tarefa padrão e entrega nascem sozinhas (hoje `os_tarefas` = 1 e `entregas_instalacoes` = 0, então esses bloqueios estão ocos) |
| R3 | Eixos de status | só "pendente" | **igual**: `status_arte` pendente 16/16; `status_logistica` nao_iniciada 16/16; 19 OS com `status ≠ status_geral` 🔴 | derivados de fatos (arte ← aprovação, produção ← apontamento, logística ← entrega) |
| R4 | Aprovado → convertido | 9 com OS ainda "aprovado" | 1 corrigido hoje (#106); **8 aprovados sem OS** continuam 🟡 | conversão automática com confirmação |
| R5 | Rastro do lead | 12 leads, 0 com cliente | 14 leads, **0** com cliente; 14 conversas com lead 🔴 | lead → cliente → orçamento com origem |
| R6/R7 | Custo e item livre | 16 de 41 itens livres | 18 de 49 itens livres 🟡; custo cheio corrigido (§4.3) | item livre exige custo ou vira produto |
| R8 | Responsável, prazo, máquina | 11/11 sem máquina | das 14 OS de venda abertas: **10 sem horário na agenda de máquina e 12 sem prazo** (o campo "máquina" da OS não vale: a máquina é a do produto) 🔴 | prazo na conversão; agenda automática |
| R9 | Entrega | `entregas_instalacoes` 0 | **0** 🔴 | nasce na conversão quando precisa entrega |
| R10 | Portal e NPS | 0 acessos | **0** acessos, 1 pesquisa 🔴 | disparado na aprovação e no fechamento |
| R11 | Parceiros | em andamento | 8 parceiros (6 contas), painel próprio, preço de tabela com faixa por área 🟢 | atendente para os 4 novos |
| R12/R13 | Checklists e resultados duplicados | duplicados | **igual** (`qualidade_*` 7 × `checklists_os` 0; resultados 29) 🔴 | um modelo só |
| R17 | OS interna | não existia | **existe** (`finalidade`; 13 OS de auditoria do RIP) 🟢 | — |
| R18 | Tinta por cor e RIP | tinta "conjunto" | importação do Flexi no ar (38 jobs); tinta ainda em 1 material 🟡 | tinta por cor, baixa pelo real |

**O que foi feito de 22/10 para hoje (90 mudanças em `main`; as duas sessões)**

- **Preço e catálogo:** tabela de preços em cartões com régua (#192); família e código em todo produto (#202); faixa de 6 m² progressiva por linha (#201); 7 produtos da tabela de terceirizados ativados com custo provisório (#209); custo cheio corrigido (#205): a Lona 280g saiu de R$ 33,20 para R$ 14,97.
- **Orçamento em passos:** equipe e parceiro nos mesmos quatro passos (#197), prazo e expresso (#198), degraus de quantidade e tamanhos prontos (#199), cartões de material, tamanho e acabamento (#203, #204), cobrança do acabamento como linha (#210, #216), lados da bainha (#213).
- **Acabamentos:** cadastro com custo de máquina e mão de obra (#208), valores simbólicos com tag e avisos (#217).
- **Cadastros em passos:** produto (#215), material (#219), cliente (#221), máquina (#223), usuário (#224), com medição de uso (#225).
- **Painéis:** caixa e meta do mês (#183), avisos da equipe (#184), pendências de preenchimento, auditoria do RIP com 13 OS internas (#191).

---

## 3. A jornada, elo a elo

### 3.1 Entrada do cliente 🔴
- **O que existe:** `leads` (14), `clientes` (28), `whatsapp_conversas` (27), `whatsapp_atendimentos` (19), convite de parceiro, cadastro em passos.
- **Uso [Medido]:** 11 leads "novo" e 3 "perdido", nenhum virou cliente; 15 de 27 conversas sem cliente (56%); só 6 conversas ligadas a uma OS; 22 de 28 clientes sem `origem`; 9 sem documento.
- **O que entrega ao próximo elo:** o orçamento. Mas 24 de 65 orçamentos nasceram sem cliente, e 5 avisos de "orçamento aprovado" foram cancelados por "sem cliente vinculado".
- **Furo:** a conversa do WhatsApp, o lead e o cliente são três cadastros sem ligação obrigatória.
- **Deve ficar:** conversa nova cria lead; o primeiro orçamento transforma o lead em cliente (origem herdada da conversa); conversa sem cliente cai numa fila de triagem.

### 3.2 Orçamento 🟡
- **O que existe:** produto com preço por m² e faixas, versões congeladas, desconto com alçada, tela em quatro passos, acabamento cobrado, tabela de terceirizados.
- **Uso [Medido]:** 65 orçamentos: 9 rascunho, 5 enviado, 9 aprovado, 14 convertido, 25 rejeitado, 3 expirado. **39 sem item nem versão** (23 rejeitados vazios, 8 rascunhos vazios, 5 convertidos só com valor digitado, 3 expirados). R$ convertido: 6.007,65; aprovado sem OS: 619,51; enviado: 1.011,80.
- **O que entrega:** valor e itens à OS; preço de parceiro automático.
- **Furo:** as sobras de orçamento vazio (26, rejeitados/expirados sem valor) enchiam a lista e confundiam qualquer conta de conversão feita sobre o total. O custo do item ainda sai do `custo_medio` do cadastro (só material), não do custo cheio: a margem do orçamento fica maior que a real.
- **Deve ficar:** orçamento só existe depois do primeiro item; o painel de conversão ignora cascas; decisão do dono sobre custo cheio no orçamento.

### 3.3 Envio 🟢
- **O que existe:** link público (`orcamento-publico.$token`), PDF, aviso por WhatsApp (`notificacoes_fila`: 23 enviados, 17 cancelados), templates ativos (12), fila e despacho a cada 2 minutos.
- **Uso:** 20 avisos de "orçamento aprovado" enviados.
- **Furo:** dos 17 cancelados, 7 eram de OS/orçamento apagados, 5 sem cliente vinculado, 5 por decisão do dono. A causa raiz é a mesma do elo 3.1 (cliente ausente).
- **Deve ficar:** lembrete automático de orçamento enviado há 3 dias sem resposta (`automacoes` tem 3 regras ativas; nenhuma é essa).

### 3.4 Aprovação 🔴
- **O que existe:** `aprovar.$token`, `aprovacoes`, `arquivo_aprovacoes`, aprovação de arte na OS.
- **Uso:** `aprovacoes` 0, `arquivo_aprovacoes` 0. A aprovação do cliente acontece por WhatsApp e alguém marca "aprovado" à mão.
- **Furo:** o status muda por mão e o passo seguinte (conversão) fica parado: 8 aprovados esperando.
- **Deve ficar:** aprovar (link ou mão) dispara a conversão em OS com um clique de confirmação e pede o sinal.

### 3.5 Conversão em OS 🟡
- **O que existe:** `converter_orcamento_em_os` completa: confere valor aprovado, alçada de desconto, item sem custo, cria itens, conta a receber, parcelas, reserva de material e agenda a máquina.
- **Uso:** 14 convertidos. 29 OS: 10 entrada, 2 design, 1 arte aprovada, 1 aguardando aprovação de arte, 14 concluídas (13 delas são as OS internas de auditoria do RIP), 1 cancelada.
- **Furo:** das 14 OS de venda abertas, 10 não estão na agenda de máquina e 12 não têm prazo; `os_tarefas` tem 1 linha (sem tarefas padrão). A agenda e a capacidade ficam cegas. (A máquina é a do produto: `produtos.maquina_padrao_id` está preenchida em todo produto físico das OS abertas.)
- **Deve ficar:** prazo e máquina obrigatórios na conversão (já há o prazo e o expresso do orçamento em passos), tarefas padrão por tipo de produto.

### 3.6 Arte e produção 🟡
- **O que existe:** kanban com cinco colunas, aprovação de arte, apontamento, TV por máquina, agenda, qualidade, Flexi (38 jobs importados).
- **Uso:** 4 OS paradas, 2 com prazo vencido, 2 em entrada há mais de 7 dias; apontamentos funcionam.
- **Furo:** os eixos de status paralelos nunca mudam (R3), então o painel de produção não sabe em que ponto a peça está.
- **Deve ficar:** status derivado dos fatos (aprovação de arte, apontamento, entrega).

### 3.7 Estoque e compras 🟡
- **O que existe:** `materiais` (27), lotes FIFO (10), movimentações (8), reserva e baixa por OS, aviso de estoque mínimo, assistente de novo material.
- **Uso:** estoque nunca carregado em 18 de 27 materiais; 6 abaixo do mínimo; 8 OS de venda abertas sem material previsto; baixa pendente em 14 de 14 OS concluídas (as internas); `compras` 0 linhas; `contas_pagar`: 104 abertas e 6 pagas.
- **Furo:** sem saldo inicial, a reserva e a baixa não fecham; a compra não gera conta a pagar nem entrada de estoque pela mesma tela. [Dedução] As 104 contas a pagar abertas parecem lista de planejamento, não pagamento real: confirmar.
- **Deve ficar:** entrada de nota gera movimentação e conta a pagar juntas.

### 3.8 Entrega 🔴
- **O que existe:** `entregas_instalacoes`, rota `/entregas`, bloqueio no `fechar_os`.
- **Uso:** 0 registros. 1 OS de venda concluída sem data de entrega real e sem baixa de estoque.
- **Furo:** o bloqueio de entrega só vale se existir uma entrega pendente; como nenhuma é criada, a OS fecha sem comprovante.
- **Deve ficar:** a conversão cria a entrega quando "precisa entrega/instalação"; retirada no balcão registra quem retirou.

### 3.9 Cobrança e pagamento 🟡
- **O que existe:** `contas_receber` (15), `parcelas_receber` (16), `pagamentos` (11), estorno, caixa, meta, aviso de cobrança com OK do financeiro.
- **Uso [Medido]:** R$ 2.859,89 recebidos em contas e R$ 3.159,89 em pagamentos (diferença de R$ 300); 7 contas previstas somam R$ 3.180,40; `parcelas vencidas` 0 **porque as 7 abertas não têm vencimento** (vence na saída do pedido).
- **Furos:** (a) 2 pagamentos de R$ 150 na OS #168 sem parcela, somando R$ 600 contra conta de R$ 300; (b) forma de pagamento escrita de dois jeitos ("pix"/"PIX", "dinheiro"/"DINHEIRO"); (c) sinal recebido não muda nada na produção; (d) o "atrasado" do caixa é sempre zero, pelo vencimento em aberto.
- **Deve ficar:** sinal na aprovação liga a OS ("pode produzir"); forma de pagamento em lista fechada; conferência do caixa com alerta de pagamento em dobro (feito).

### 3.10 Pós-venda 🔴
- `pos_venda_*` 0 (1 pesquisa), `portal_cliente_*` 0, `ocorrencias` 0. O módulo existe e ninguém dispara. **Deve ficar:** pesquisa enviada no fechamento da OS, garantia criada quando a peça é entregue.

---

## 4. Módulos de apoio

### 4.1 Catálogo, preço e custo 🟢
Hoje é a parte mais redonda: 52 produtos ativos com código, família e preço de parceiro; faixa de 6 m² progressiva; tabela de preços com régua e custo cheio; 5 acabamentos com custo; 7 produtos com custo provisório (tag). Pendente: custo real dos 7, custo da tinta, salário real.

### 4.2 WhatsApp e avisos 🟡
12 templates ativos, fila com 74 envios feitos, agente de avisos (lembretes às 9h), 3 automações. Furo: avisos cancelados por falta de cliente (elo 3.1).

### 4.3 Custos de produção (parâmetros) 🟡
O custo cheio estava inflado por parâmetro de enfeite: mão de obra de R$ 40/h com 0% de encargos (5,4× o mínimo-hora). Hoje R$ 10,65/h + 32,19% (média nacional de impressor; **estimativa**), tempo de máquina pela velocidade da plotter, energia incluída. Pendentes com tag: salário real, custo/hora da plotter de recorte (R$ 3,00 simbólico), tinta (R$ 0,09/ml no estoque × ~R$ 0,22 de varejo), fator 1,5 de mão de obra, manutenção do laser.

### 4.4 Parceiros 🟢
Cadastro libera na hora, painel com cartões, preço automático no orçamento, faixa por área, taxa de expresso editável. Pendente: 4 parceiros novos sem atendente.

---

## 5. Dashboards

| Painel | O que mostra | Problema |
|---|---|---|
| Dashboard / caixa | recebido hoje, 7 dias, mês (R$ 3.121,49), em aberto (R$ 3.180,40), atrasado | atrasado = 0 por falta de vencimento; recebido do mês não confere com o saldo por OS (diferença R$ 300 da OS #168) |
| Meta do mês | meta R$ 11.373,04; **vendido 5.428,89**; **recebido 3.121,49**; **realizado 121,15**; backlog 5.919,14 | três números para "quanto vendi": o "atingido" (1,1%) usa o realizado (OS fechadas) e esconde que 48% da meta foi vendida |
| Funil | lead → cliente → orçado → fechado → produção → entregue | começa em lead, e lead nunca vira cliente (0 de 14) |
| Pendências do sistema | 14 tipos hoje (+2 novos de pagamento) | boa; falta quem-resolve visível para pagamento |
| Pendências de preenchimento | custo provisório (10), acabamento provisório (3), mão de obra estimada (6), rolos sem estoque cheio (6) | nova, cobra o valor real |
| Tabela de preços | 52 cartões, margem por produto | custo "do cadastro" × "cheio" precisam de uma decisão (§7) |

Regra proposta: **cada número do painel diz uma coisa só, com o nome do que mede** ("vendido" = orçamento aprovado; "recebido" = pagamento; "realizado" = OS fechada).

---

## 6. Configurações e permissões 🟡

- **Papéis:** 16 vínculos (parceiro 6, vendedor 3, operador 2, estoque 1, financeiro 1, gestor 1, designer 1, admin 1); 320 permissões por perfil; matriz em `/matriz-permissoes`. 12 usuários ativos.
- **Parâmetros:** dados da empresa e taxa do expresso editáveis (12% provisória); custos de produção (§4.3); templates e automações.
- **Furos:** parâmetros estimados convivem com os reais sem marca na tela (agora marcados e cobrados no painel); `config_precificacao_3d` ainda em R$ 40/h; cadastro de máquina com custo/hora zero (plotter de recorte, fiber, DTF).

---

## 7. Matriz de comunicação entre módulos

| De → Para | Entrega | Recebe | Situação |
|---|---|---|---|
| Conversa WhatsApp → Cliente | telefone, nome | cliente vinculado | 🔴 56% sem cliente |
| Lead → Cliente | origem, contato | cadastro | 🔴 0 de 14 |
| Cliente → Orçamento | cliente_id | itens, preço de parceiro | 🟡 24 orçamentos sem cliente |
| Orçamento → Envio | PDF, link | aviso ao cliente | 🟢 |
| Envio → Aprovação | resposta do cliente | status | 🔴 manual |
| Aprovação → OS | conversão | OS, conta, reserva, agenda | 🟡 8 esperando |
| OS → Estoque | material previsto | reserva e baixa | 🟡 8 sem material previsto |
| OS → Máquina/agenda | máquina, prazo | capacidade | 🔴 10 de 14 sem horário na agenda; 12 sem prazo |
| OS → Entrega | endereço, instalação | comprovante | 🔴 0 |
| OS → Financeiro | valor, parcelas | caixa | 🟡 sinal não liga produção; 1 OS recebeu o dobro |
| Financeiro → Dashboard | recebimentos | caixa e meta | 🟡 vencimento ausente |
| Fechamento → Pós-venda | OS concluída | pesquisa e garantia | 🔴 0 |
| Compras → Estoque e contas a pagar | nota | entrada e título | 🔴 `compras` vazia |

---

## 8. Plano reorganizado

**Meta (resultado visível):** um pedido que entra pelo WhatsApp chega ao fim — orçamento, aprovação, pagamento, produção, entrega — sem que ninguém precise lembrar do passo seguinte, e todo número do painel quer dizer uma coisa só.

**Fase 1 — Limpar o que distorce os números.** *Serve à meta porque ninguém decide em cima de painel errado.*
Cascas de orçamento marcadas e fora da conversão; conferir o extrato da OS #168 (R$ 300); lista fechada de forma de pagamento; 8 aprovados sem OS: converter ou rejeitar um a um; orçamento sem cliente.
**Fase 2 — Ligar elo a elo.** *Serve porque é aqui que a mão humana some.*
Conversão com confirmação a partir da aprovação; prazo, máquina e tarefas padrão obrigatórios; entrega nasce na conversão; eixos de status derivados; sinal libera a produção.
**Fase 3 — Rastro de origem.** *Serve porque sem origem não se sabe onde investir.*
Conversa → lead → cliente → orçamento; origem obrigatória; fila de conversa sem cliente.
**Fase 4 — Dinheiro e custo.** *Serve porque margem é decisão.*
Vencimento padrão da parcela; compras gerando entrada e conta a pagar; decisão do custo cheio no orçamento; tinta por cor.
**Fase 5 — Painéis.** *Serve porque cada número tem de dizer uma coisa.*
Nomes únicos (vendido, recebido, realizado); funil a partir do orçamento; alerta de pagamento no painel (feito).
**Fase 6 — Configurações reais.** *Serve porque o provisório vira verdade.*
Trocar os valores com tag: salário real, plotter de recorte, tinta, os 7 custos, preço do laser e do manual.
**Verificação:** rodar 3 pedidos reais do começo ao fim (banner de cliente, adesivo de parceiro, OS interna) e ver cada elo da §7 passar sem mão humana.

---

## 9. O que só o dono decide

1. O orçamento passa a usar o **custo cheio**? Muda todas as margens que ele mostra.
2. Conversão automática da aprovação: **sempre com confirmação** (recomendado) ou direto?
3. Sinal obrigatório para começar a produzir? Qual percentual?
4. OS #168: foi pagamento em dobro (R$ 300 para estornar) ou o valor da conta subiu?
5. Os 8 orçamentos aprovados sem OS: converter, e a quem o aviso vai?
6. Vencimento padrão da parcela quando não há data (hoje vence na saída).

## 10. Valores provisórios em uso (todos com tag)
Mão de obra R$ 10,65/h + 32,19% · fator 1,5 de mão de obra sobre o tempo de máquina · plotter de recorte R$ 3,00/h · depuração 3 min/m · preços do laser (R$ 1,00/min), manual (R$ 0,75/min) e recorte (R$ 2,20/m) · custo dos 7 produtos da tabela de terceirizados · taxa do expresso 12%.

---

## 11. Andamento: Fase 1 e começo da Fase 2 (25/10/2026, noite)

Feito, aplicado no banco e coberto por teste:

- **O atendimento autoriza e converte.** O vendedor ganhou `orcamentos.approve` e `orcamentos.convert` (a Jhesselem já converte). Continua sem pagamento, fechar OS, forçar status nem financeiro; desconto fora da alçada segue com quem tem "Aprovar desconto".
- **Forma de pagamento em minúsculas**, por gatilho (havia "PIX" e "pix").
- **Orçamentos vazios** rejeitados/expirados saem da lista (botão "Mostrar" traz de volta).
- **A entrega nasce com a OS** quando o orçamento pede entrega ou instalação (ensaiado sobre os 8 aprovados: 7 converteram; o #54 parou na trava de desconto, como deve).
- **Cinco alertas novos no painel:** pagamento sem parcela (2), OS que recebeu mais que a conta (1), **OS já paga parada em "entrada" (3)**, OS sem prazo (12), OS sem horário na máquina (10).
- **Orçamento #106** passou a "convertido".

**Segurado de propósito (precisa de gente):** os 8 aprovados sem OS são pedidos de setembro que já foram impressos (ver `auditoria-rip`); converter agora cria cobrança, reserva e agenda de trabalho feito. Cada um precisa de uma decisão de quem fechou com o cliente. O extrato da OS #168 também.

**Próximo (Fase 2, o que sobra):** prazo e agenda automáticos na conversão, tarefas padrão por tipo de produto, status derivados de fatos, sinal que libera a produção (decisão do dono).
