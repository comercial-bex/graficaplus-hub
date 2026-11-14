# Parceiro nunca sem atendimento: chamado automático, cadastro completo, boas-vindas e promoção da semana

Regra geral: nada sai para ninguém por causa deste trabalho até o dono ligar o modo. Todo SQL vai primeiro para `docs/proposta-parceiro-sempre-atendido.sql` (seções A a E, cada uma com DESFAZER que traz o corpo vivo e o hash), revisado contra o banco vivo e aplicado por você, uma seção por vez. Não mexe na triagem, na caixa de entrada (telas e escritas) nem em orçamentos.

## O que foi conferido no repositório (14/11/2026)
- `_wa_abrir_atendimento(conversa, origem, usuario)` (drizzle 0002): é idempotente (devolve o atendimento aberto, se houver) e só zera `responsavel_id` e volta a `modo='auto'` quando `origem='mensagem_recebida'` e já existiu um atendimento antes. Com `origem='manual'` ela NÃO mexe no responsável: dá para reaproveitar sem alterar o corpo.
- Enum `whatsapp_origem_abertura` = `mensagem_recebida | manual | reaberto`. Não vamos criar valor novo (ADD VALUE não roda na mesma transação e mexeria no outro fluxo): usamos `manual`.
- `whatsapp_atendimentos.tipo_contato` CHECK `cliente_final|parceiro`; `origem_do_tipo` CHECK `anuncio|palavra|telefone|manual`. Usamos `parceiro` + `telefone` (o casamento é pelo telefone do cadastro). Nenhum CHECK muda.
- `_wa_mensagem_antes_inserir`: mensagem de entrada usa o atendimento ativo se existir. Então, com o chamado já aberto, a primeira resposta do parceiro cai nele, sem abrir outro e sem perder o responsável.
- `whatsapp_automacao_bloqueios` (telefone_hash, lid_hash, conversa_id, motivo `parar|robo|manual`, origem default `triagem`): serve para o SAIR. Usamos `motivo='parar'`, `origem='parceiros'`. Nenhum CHECK muda.
- Cobrança de orçamento: `whatsapp_configuracoes.cobranca_modo` `desligada|ensaio|ligada` com `cobranca_ligada_em`/`cobranca_ensaio_desde` e salvar por função. Esse é o padrão que vamos copiar.
- Convite curto (20261103300000/400000): `parceiro_acesso` leva a senha provisória; no primeiro acesso, `ocultar_senha_provisoria_do_parceiro` apaga a senha da fila, da mensagem, do log e da prévia.
- `whatsapp_conversas.chat_lid` existe (índice único por instância).

## Consultas de leitura antes de escrever o SQL (nenhuma altera nada)
1. Hash (md5 do corpo, espaços colapsados) da versão viva de: `_wa_abrir_atendimento`, `tg_atendimento_avisa_grupo`, `tg_atendimento_traz_contexto`, `tg_parceiro_boas_vindas`, `tg_parceiro_entrada`, `_parceiro_conceder_entrada`, `parceiro_enviar_pedido`, `parceiro_completar_cadastro`, `parceiro_programa_salvar` (ou equivalente), `parceiros_pendentes`. Conferir também se migrações posteriores (20261007, 20261021, 20261113100000/132000) redefiniram `_wa_abrir_atendimento`.
2. Os 15 ativos com login: telefone normalizado, conversa casada por cada variante (com/sem 55, com/sem nono dígito, `chat_lid`), contagem de entrada/saída, atendimento aberto, `responsavel_id`, mensagem `parceiro_acesso` na fila e na conversa. Só contagens no retorno, sem telefones.
3. Colunas reais de `parceiros` e `clientes` usadas para "completo" e quantos dos 15 já passam na regra.
4. `whatsapp_horarios_atendimento`/`whatsapp_feriados` (existe função pronta de "está no horário"? `_whatsapp_hora_em_texto`/`_whatsapp_dias_em_texto` sugerem que sim), `whatsapp_instancias.status`, e quantos envios a instância 1205 fez nos últimos 30 dias (base do teto).
5. `notificacao_templates`: colunas, chaves existentes, e se a fila aceita `agendar_para`.

## Etapas e ordem de aplicação

### 1. Código só (sem banco): regras puras e telas tolerantes
- `src/domain/parceiros/cadastro-completo.ts`: `faltasDoCadastro(parceiro)` → lista de campos que faltam; `cadastroCompleto`.
- `src/domain/parceiros/telefone-do-parceiro.ts`: variantes do número (com/sem 55, com/sem nono dígito) — espelho da função SQL.
- `src/domain/parceiros/promocao-da-semana.ts`: escolhe destinatários no ensaio (consentimento, sem bloqueio, sem envio nos últimos 7 dias, teto da rodada) e monta o texto.
- Testes em `tests/` para cada regra (valores do dono). Telas tratam coluna/função ausente como "recurso desligado", como no crédito de entrada.

### 2. Seção A (SQL): chamado automático + backfill sem mensagem
- `_parceiro_casar_conversa(p_parceiro)` (interna): procura a conversa pelas variantes; se não acha, cria a conversa (instância padrão, telefone normalizado com 55) SEM mensagem. Nunca cria duplicata: usa o mesmo índice único de telefone/instância.
- `_parceiro_garantir_chamado(p_parceiro)` (interna, SECURITY DEFINER, `search_path=public`, só service_role): casa a conversa → `_wa_abrir_atendimento(conversa,'manual', atendente)` → grava no atendimento `tipo_contato='parceiro'`, `origem_do_tipo='telefone'`, `responsavel_id=atendente` (só se vazio) e na conversa `responsavel_id=atendente` (só se vazio), `modo='humano'`. Liga a conversa ao cliente/parceiro, se a coluna de vínculo existir. À prova de falha: erro vira aviso, nunca derruba o cadastro.
- Gatilho novo `tg_parceiro_chamado` AFTER INSERT/UPDATE em `parceiros`, com a MESMA condição do crédito (ativo + login + atendente). Nenhuma função existente é alterada nesta seção.
- Aviso ao grupo: abrir o chamado dispara `tg_atendimento_avisa_grupo`. No backfill isso enviaria 14 avisos ao grupo da equipe. Proposta: a sessão do backfill liga uma marca local (`set_config('bex.sem_aviso_grupo','1',true)`) e o aviso ganha UMA linha que respeita a marca (mudança mínima, com hash e DESFAZER). Alternativa sem tocar no aviso: aceitar os avisos (ver pergunta 3).
- Mensagem de acesso dentro da conversa: hoje sai pela `notificacoes_fila`. A seção confirma (consulta 2) se o envio já grava em `whatsapp_mensagens`; se não grava, o gatilho passa a gravar a mensagem de saída na conversa (`origem='sistema'`) ao enviar, sem a senha (texto já ocultado).
- Backfill: bloco comentado `SELECT _parceiro_garantir_chamado(id) FROM parceiros WHERE <condição>` — idempotente (rodar duas vezes não muda nada), não insere em fila nem em mensagens. Os 4 sem conversa ganham conversa vazia; os 10 ganham atendimento.

### 3. Seção B (SQL + tela): nunca sem atendente
- Ao salvar o programa: não aceitar `atendente_padrao_id` vazio enquanto `entrada_ativa` ou o convite curto estiver ativo; não aceitar usuário inativo (mudança mínima na função de salvar o programa, ou CHECK por gatilho na `parceiro_programa`).
- Usuário desativado: gatilho em `usuarios` (ativo vira false) bloqueia se for o atendente padrão ("troque o atendente padrão antes"); os parceiros dele continuam com ele até a equipe reatribuir, e a fila mostra "atendente inativo".
- `parceiro_enviar_pedido`: mantém a recusa sem responsável (vira caso impossível), mas antes tenta preencher com o atendente padrão. Uma linha nova, com hash/DESFAZER. Recomendo isso em vez de remover a trava.
- Tela da aba Programa: seletor obrigatório, aviso se o atendente estiver inativo; o botão "atribuir os sem atendente" continua.

### 4. Seção C (SQL + tela): cadastro completo, sem envio
- Campos de "completo" (proposta, confirmar na consulta 3): nome da marca, nome do responsável, telefone, e-mail, cidade, UF, ramo de atuação, comprovação (Instagram/site ou "não tenho" marcado). CPF/CNPJ fica opcional (ver pergunta 5).
- `parceiro_faltas_do_cadastro(p_parceiro) → jsonb {completo, faltam[]}` (espelho da regra pura, testes cruzados).
- Templates novos em `notificacao_templates`: `parceiro_continue_cadastro` (cita o que falta + link da área) e `parceiro_cadastro_completo` (confirma, cita crédito de entrada e o atendente pelo primeiro nome). Só texto; perguntas nunca, porque não há robô.
- Quando sai: `continue` 24 h depois da ativação se incompleto (no máximo 2 vezes, intervalo de 3 dias); `completo` uma vez, quando passa a completo. Idempotência: tabela `parceiro_avisos (parceiro_id, tipo, enviado_em)` com índice único. Só dentro do horário de atendimento e fora de feriados; fora do horário fica para o próximo horário.
- Tudo atrás de `parceiro_programa.avisos_modo` `desligada|ensaio|ligada`, default `desligada`. No ensaio só lista quem receberia e o texto.

### 5. Seção D (SQL + tela): promoção da semana, nasce desligada
- Tabela `parceiro_promocoes` (titulo, texto, valida_de, valida_ate, ativa, aprovada_por, aprovada_em, criado_por). Editar o texto apaga a aprovação.
- Tabela `parceiro_promocao_envios` (promocao_id, parceiro_id, rodada_id, status, enviado_em) com índice que impede 2 envios para o mesmo parceiro na mesma semana.
- `parceiro_programa.promocao_modo` `desligada|ensaio|ligada` + `promocao_teto_rodada` (proposta 30), `promocao_intervalo_seg` (proposta 90 a 180 s, com variação), dia/hora da rodada.
- Função `parceiro_promocao_rodada()` (cron semanal): só roda com modo ligada, promoção aprovada e válida, dentro do horário, instância conectada (aborta e registra o motivo se não estiver). No ensaio devolve só a lista e o texto.
- Destinatários: ativos, com consentimento registrado, sem bloqueio (telefone_hash/lid_hash/conversa), sem envio nos últimos 7 dias.
- Consentimento: coluna `parceiros.aceita_promocoes_em` + `aceita_promocoes_origem` (`cadastro`|`whatsapp`). Checkbox desmarcado no cadastro curto (texto aprovado pelo dono). SIM pela conversa: como não há robô, a equipe marca na ficha "respondeu SIM" (um clique). SAIR: a equipe (ou a palavra SAIR, quando a triagem for ligada) grava em `whatsapp_automacao_bloqueios` com `origem='parceiros'`; toda promoção termina com "Responda SAIR para não receber mais".
- Tela: aba Programa → "Promoção da semana": editor, botão Aprovar (só `parceiros.manage`), seletor de modo, prévia de ensaio com contagem e texto.

### 6. Seção E (SQL + texto): boas-vindas nova
- Texto novo do `parceiro_acesso` (mesma chave, para não mexer no gatilho): saudação, link, e-mail, senha provisória, crédito (valor, validade, pedido mínimo, até X% do pedido, lido de `parceiro_programa`), nome do atendente, e "responda esta mensagem para falar com ele".
- Só troca o texto do template e as variáveis passadas pelo gatilho (diff mínimo, hash/DESFAZER). Envio continua igual: é a mensagem que já sai hoje, então não é envio novo.
- Senha em texto: recomendo link de primeiro acesso de uso único (definir senha na página) no lugar da senha. Isso muda o fluxo de acesso, então fica só como proposta. Enquanto isso, a ocultação no primeiro acesso continua.

## Riscos e o que não foi confirmado
- Não confirmei o corpo vivo de nenhuma função nem os hashes; a versão de `_wa_abrir_atendimento` pode ter mudado depois da 0002 (aparece em 4 migrações).
- Não confirmei se o envio da fila grava a mensagem em `whatsapp_mensagens` (afeta a "mensagem de acesso dentro da conversa").
- Casamento de telefone: número fixo/errado no cadastro gera conversa "fantasma"; parceiro com dois números; `chat_lid` só existe depois que o contato escreve. Mitigação: casar só número móvel de 13 dígitos, e mostrar na ficha "conversa criada pelo cadastro".
- Criar conversa sem mensagem pode mostrar itens vazios na caixa de entrada (que não vamos alterar). Confirmar como a lista ordena conversas sem mensagem.
- Aviso ao grupo no backfill (14 avisos de uma vez) se a marca de silêncio não for aprovada.
- Banimento: o 1205 é o número de todo o atendimento, pela Z-API (não oficial). Disparo em massa para quem nunca respondeu (10 de 15 hoje) é o principal motivo de bloqueio. Teto proposto: até 30 por rodada, 1 por semana por parceiro, intervalo de 90 a 180 s, só para quem tem consentimento, e pausar sozinho se 2 ou mais pessoas bloquearem/disserem SAIR na rodada. Migrar para a API oficial do WhatsApp (modelos aprovados pelo Meta) quando passar de 50 parceiros com consentimento ou na primeira restrição do número. Ideal: número separado para promoções.
- O crédito e o chamado dependem do mesmo trio (ativo + login + atendente); um parceiro sem telefone válido terá crédito e não terá chamado. A fila deve mostrar isso.

## Perguntas para o dono (com recomendação)
1. Origem do chamado automático: usar `manual` (existente) ou criar um valor novo "cadastro_parceiro"? Recomendo `manual`, sem mexer no enum.
2. A conversa do parceiro começa em `modo humano` com o atendente como responsável? Recomendo sim.
3. No backfill, o grupo da equipe deve receber os 14 avisos? Recomendo não (marca de silêncio, uma linha no aviso).
4. Atendente padrão obrigatório sempre, ou só com entrada/convite ativos? Recomendo sempre, e bloquear desativar o usuário que é atendente padrão.
5. "Completo" exige CPF/CNPJ? Recomendo não exigir (está como opcional no roteiro do dono); exigir comprovação do ramo (Instagram/site ou "não tenho").
6. Quantos "continue seu cadastro" e em que intervalo? Recomendo 2 no máximo: 24 h e 4 dias depois da ativação.
7. Teto da promoção: 30 por rodada e intervalo de 90 a 180 s? Recomendo sim, e pausa automática com 2 SAIR na rodada.
8. Consentimento pela conversa: a equipe marca na ficha (sem robô)? Recomendo sim até a triagem ser ligada.
9. Trocar a senha provisória por link de primeiro acesso? Recomendo sim, em pacote separado, depois deste.
10. Aceita usar um segundo número (ou a API oficial) só para promoções? Recomendo avaliar antes de ligar a promoção.

## Fora do escopo
Triagem, robô conversacional, caixa de entrada (telas e escritas), orçamentos, publicação, ligar qualquer modo, rodar backfill.
