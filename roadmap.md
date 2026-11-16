# Roadmap

## Aplicação de Avisos e validação (15/11)
- [x] Terceirizados inclui compradores com ou sem login; pacote aplicado como 0014, ACL/SECURITY DEFINER/search_path conferidos e 13 testes aprovados. Nenhum aviso/envio/validação registrado; sem publicação. Comparação das cópias detectou dois espaços extras de indentação no SQL enviado, sem diferença lógica; cabeçalho da fonte marcado APLICADA.

## Identificação de parceiros (11/11)
- [x] Preparar domínio, selo e filtro tolerantes à ausência de leads.tipo no Funil, Leads e WhatsApp.
- [x] Escrever proposta SQL com função atual, permissões, backfill opcional, reversão e testes manuais; não aplicada.
- [x] Executar suíte completa (4.234 aprovados, 1 pulado; 357 arquivos aprovados, 1 pulado) e checagem de tipos sem erros. Conferência visual autenticada bloqueada: solicitante sem conta correspondente; navegador ficou em carregamento sem sessão.
- [x] Ajustar proposta: frase "quero ser parceir" no lead novo e no temporário cliente; remover GRANTs de coluna (não aplicado).
- [ ] Plano do agente de cadastro de parceiros no WhatsApp (modo de teste) — escrito, aguardando revisão do dono.
- [ ] Aplicar proposta e validar classificação com mensagem real — depende de aprovação futura, cadastro dos IDs de anúncios e acesso autorizado; não executar nesta tarefa.

- [x] Criar temas claro e escuro com Montserrat e preferência persistente.
- [x] Manter o menu lateral escuro e sem reorganização.
- [x] Adicionar alternância de tema no cabeçalho autenticado.
- [x] Unificar cabeçalhos, indicadores, painéis, tabelas, campos, estados e tooltips.
- [x] Completar as dicas das 54 áreas exibidas no menu.
- [x] Validar compilação, tema inicial, persistência e ausência de erros no navegador.

## WhatsApp — caixa v3 (pedido 07/10)
- [x] A) Filas por setor (enum, coluna, usuarios.filas, transferir fila, chips; filas da equipe no Monitor). O submenu por setor ficou como chips na caixa e `?fila=` na URL.
- [x] B) Atendimentos imutáveis (WA-AAMM-NNNN, abrir/reabrir/resolver com motivo, painel)
- [x] C) Fila humana (/whatsapp-fila-humana, espera), leituras por usuário
- [x] D) Assistente de IA (chamada pelo webhook com teto de tempo; rota /api/whatsapp/agente para reprocessar; classificação, resposta, transferência, configurações, logs). Nasce DESLIGADA.
- [x] E) UX: chips de fila coloridos, atalhos R/T/E/Esc, estados vazios
- [x] Testes: resolver atendido recusado, reabertura, agente com responsável, flood control
- [x] Assistente usa a OpenAI (OPENAI_API_KEY, modelo OPENAI_MODEL ou gpt-5-mini), nunca o saldo do Lovable; não liga sem a chave (08/10)
- [x] "Reprocessar mensagens sem texto" consertado (a função dava 42P10 e nunca gravou); as 3 mensagens de modelo recuperadas (08/10)
- [ ] Assistente fica DESLIGADA por decisão do dono (08/10). Se um dia ligar: cadastrar OPENAI_API_KEY no Bex Print, preencher endereço e horário, auditar as primeiras decisões
- [x] `whatsapp_responder` e `whatsapp_vincular_cliente`: conferidas (08/10) — são SECURITY INVOKER, rodam como quem chamou (RLS vale) e conferem auth.uid() + whatsapp.reply. Não dão poder a mais; ficam como estão
- [x] Visão geral (/whatsapp-visao-geral, 08/10): esperando agora, recebidas/enviadas, atendimentos do dia, 1ª resposta (mediana), leads e orçamentos da caixa, mensagens por dia, abertas por setor, quem atendeu, motivos e saúde da conexão
- [x] Foto do contato na caixa (14/10): o servidor guarda a cópia da foto que o Z-API manda em cada mensagem (o link vence em ~10 dias) e completa as que faltam pelo GET /profile-picture (job `whatsapp-fotos`)
- [x] Assinatura com o setor da conversa (14/10): quem é do setor da fila assina com ele ("Leonardo · Produção"); quem não é, com o papel
- [x] Transferência com aviso ao cliente (14/10): a frase de passagem sai assinada por quem transferiu, na mesma transação; a conversa fica esperando o novo dono
- [x] Os 3 leads de propaganda (Claro, Renova Be, Kwai) fechados como perdidos e as conversas resolvidas como spam, a pedido do dono (08/10). "Gratidão" segue aberto
- [x] Despachante do servidor ligado (job `whatsapp-despachar`, a cada 2 min, token no Vault; testado com 200) (08/10)
- [x] Origem do lead pelo anúncio (11/11): leads NOVOS do WhatsApp que vêm de anúncio/botão/post entram com origem Instagram ou Facebook e campanha "Anúncio <número>" (migração 0010). Leads antigos não mudam
- [x] 12 funções SECURITY DEFINER que gravam fechadas para `anon` (migração 20261008040000, aplicada e conferida) (08/10)
- [x] Índice das ferramentas guardadas (ferramentas/aiox-core) criado em `docs/indice-aiox-core.md` — o que é, o que pode ajudar no Bex Print e pré-requisitos; nada ativado (24/10)
- [x] Selecionar três ferramentas no índice e propor ordem, pré-requisitos e riscos — PM/PO → data-engineer → QA/qa-loop; somente documentação (24/10)
- [x] Detalhar plano PM/PO aprovado e produzir inventário, escopo, épico, quatro histórias, matriz de aceite, decisões e avaliação em `docs/planejamento-aiox/` (24/10); referência isolada verificada e 96 testes locais aprovados
- [ ] Instalar e pilotar aiox-core em ambiente isolado — plano aprovado; bloqueado por acesso não confirmado ao anfitrião, operador e ambiente durável a definir; nenhuma instalação/ativação feita (24/10)

- [x] Vendas diretas do revendedor (menu Comprar no painel do parceiro; pagamento sinal 50% ou à vista; vira OS; tela interna Vendas diretas)
- [ ] Vendas diretas: anexar layout por item na compra

- [x] Instalação ligada ao item que instala + pendência — coluna orcamento_itens.instala_item_id aplicada no banco (05/11), campo "Instala qual item?" e pendência na tela
- [x] Zerar mão de obra automática no 3D; embalagem opcional e preço oculto preservados; testes de custo inicial adicionados e suíte executada (05/11). Conferência visual não realizada: solicitante sem conta correspondente para acesso autorizado.
- [x] Crédito de entrada do parceiro + atendente padrão: código pronto (tolerante ao banco sem as colunas); proposta em docs/proposta-credito-de-entrada-e-atendente.sql
- [x] Ajuste do crédito: exigir atendente na proposta de concessão, excluir candidatos sem atendente e ocultar aviso desligado/vencido/sem saldo. Suíte: 6.607 aprovados, 1 pulado; 429 arquivos aprovados, 1 pulado. Tipos sem erros; lint de 4 arquivos sem erros/avisos. SQL não aplicado; telas autenticadas e concessão no banco não verificadas nesta tarefa; sem publicação.
- [x] Aplicar as seções A e B, nesta ordem, pela ferramenta de migração (14/11): 0011 e 0012, com cópias nos arquivos 20261114170000 e 20261114170100. Sem concessão de crédito, atribuição de atendentes ou publicação; atendente padrão mantido NULO.
- [x] Parceiro sempre atendido (A chamado automático + B nunca sem atendente): proposta em docs/proposta-parceiro-sempre-atendido.sql, NÃO aplicada; telas ajustadas. C/D/E fora por decisão do dono (14/11)
- [x] Revisar proposta A/B + nova C de primeira compra, sincronizar responsável e preparar arquivo 20261115140000; hashes vivos conferidos, tipos sem erros; vitest 7.132 aprovados/1 pulado e 1 falha por colisão do prefixo solicitado (15/11). Sem aplicar/publicar/backfill.
- [ ] Resolver nome da proposta antes de aplicar: prefixo 20261115140000 já usado por maquina_na_fila_e_validacao_sem_atalho; nome solicitado preservado, aguardando decisão do dono.
- [x] Preparar próximo pacote de Avisos, validação e boas-vindas: SQL 20261115150000 NÃO aplicado; telas tolerantes, tipos sem erros e testes executados; nenhum envio/publicação. Suíte com 1 falha herdada de prefixo duplicado do pacote anterior; verificação visual autenticada indisponível (solicitante sem conta correspondente). ACL novas só serão verificáveis após aplicação; DO incluído para conferir has_function_privilege.

- [x] Parceiro nunca esquecido: migração 20261116150000 preparada e aprovada pelo dono.
- [x] APLICADA em 16/11/2026: arquivo aprovado aplicado exatamente como 0016 após reconferir os dois hashes normalizados, iguais ao DESFAZER. Cópia aplicada conferida byte a byte; SECURITY DEFINER/search_path e ACL verificados; dois jobs ativos, conta de teste marcada, parâmetros 48h/7 dias e template conferidos. Zero execuções dos jobs e zero notificações do pacote; sem publicação. Testes específicos: 21 aprovados.
- [ ] Marcar o cabeçalho de supabase/migrations/20261116150000_parceiro_nunca_esquecido.sql como APLICADA em 16/11/2026: a ferramenta recusou alterar arquivo de histórico após aplicação. Status registrado aqui; nenhum SQL foi alterado.

- [x] Contas a pagar, fase 1 (16/11): "Pagar" abre confirmação (descrição, fornecedor, valor, vencimento, conta de origem, data do pagamento editável e comprovante); anexos (fatura/boleto e comprovante, PDF/JPG/PNG até 10 MB, vários por conta) em bucket privado; aviso "sem comprovante"; estorno com motivo; histórico de quem criou, pagou, estornou, anexou e removeu. Migrações 20261116160000 e 20261116170000 APLICADAS em 16/11 (md5 dos corpos conferido contra o arquivo). Ensaio no banco vivo OK, nada gravado: saídas realizadas R$ 15.074,89 → 16.309,45 → 15.074,89 após o estorno; movimento na data retroativa informada. Tipos sem erros; suíte 475 arquivos/7.820 testes aprovados, 1 pulado. Tela não vista no navegador (sem conta autenticada nesta sessão).
- [x] Aplicar 20261116160000 e rodar o ensaio no banco vivo (16/11). O ensaio achou um furo da própria migração: o VENDEDOR tem pagamentos.confirm e .create sem financeiro.read, e as funções novas (SECURITY DEFINER) só conferiam a chave, então ele pagaria e anexaria pela API. Corrigido na hora por 20261116170000 (só estreita: volta à regra de antes), antes de qualquer uso (histórico com 0 linhas). Ensaio refeito: OK.
- [ ] Publicar a tela (mesclar o PR e publicar no Lovable). Até lá, a tela publicada é a antiga: "Pagar" ainda grava no clique, na data do clique, mas o histórico já registra quem pagou.
- [ ] Depois de publicada a tela nova: apagar o caminho antigo de pagar em `src/components/financeiro/contas-a-pagar/use-conta-a-pagar.ts` (ramo `pacoteAtivo = false`).
- [ ] Decisão do dono: o único gestor ativo também tem o papel vendedor, e por isso soma pagamentos.confirm e .create e PAGA conta a pagar (já pagava pela tela antiga). Contraria a decisão de 03/10 ("gestor só vê"). Resolver é tirar o papel vendedor dele ou negar as chaves por exceção pessoal; não mexi.
- [ ] Decisão do dono: `vw_fluxo_caixa` põe a conta a pagar paga na data do VENCIMENTO, não na do pagamento (a curva de projeção não mostra o pagamento retroativo no dia certo; Movimentos e histórico mostram). Mudar é mudar o cálculo do fluxo, fora da fase 1.
- [ ] DEFEITO achado em 16/11, não corrigido (fora do escopo, "não altere saldo"): o card "Saldo em conta" do Fluxo de caixa usa `saldo_contas_bancarias`, que SOMA os débitos do extrato (`importar_extrato` grava valor positivo com tipo 'debito'). Medido: tela R$ 34.113,38; `vw_saldo_conta` (que subtrai) R$ 28.009,06. Diferença R$ 6.104,32 = 2 × R$ 3.052,16 de 16 débitos.
- [ ] Conta reaberta por estorno mantém os anexos do pagamento estornado: se for paga de novo, o comprovante antigo ainda conta e o aviso "sem comprovante" não aparece.
