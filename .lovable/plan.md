# Agente de cadastro de parceiros no WhatsApp — modo de teste

Objetivo: quando alguém chega por um anúncio de parceiro, um agente conversa no WhatsApp e junta os dados do cadastro. Na primeira versão nada sai pelo WhatsApp, nenhum parceiro é gravado e o banco não muda: a equipe só testa numa tela de ensaio.

## 1) Como a conversa acontece

Tom: frases curtas, simpáticas e sem formalidade, no jeito de falar do Amapá ("Opa, tudo certo?", "Massa!", "Bora"). Uma pergunta por mensagem. Sem gírias forçadas e sem emoji em excesso (no máximo um).

Mensagem inicial (consentimento, LGPD):
> Opa! Aqui é a assistente da Bex Print 👋 Vi que tu tens interesse no programa de parceiros. Pra fazer teu pré-cadastro, vou te pedir uns dados. Eles servem só pra analisar tua parceria, como explica nossa política: bexprint.com.br/privacidade. Bora? Se não quiser continuar, é só mandar SAIR.

- Se a pessoa responder SAIR (ou "parar", "não quero"): o agente confirma ("Tranquilo, não vou mais te mandar mensagem por aqui.") e para. A conversa fica marcada como "não contatar".
- Se ela não disser "sim", o agente não pergunta nada: repete a opção uma vez e depois passa a conversa para a equipe.

Ordem das perguntas. Se a pessoa já mandou um dado antes da hora, o agente aproveita e pula a pergunta:
1. Nome do responsável.
2. Nome da empresa ou da marca.
3. CNPJ, ou CPF se trabalha sem empresa (com conferência dos dígitos).
4. Ramo: agência, comunicação visual, designer, revenda de brindes ou outro (no caso de "outro", pergunta qual).
5. Cidade e UF.
6. E-mail (reaproveita a sugestão de correção que já existe, por exemplo "gmial" vira "gmail").
7. Instagram (@) e, se tiver, Facebook. A pessoa pode responder "não tenho".
8. Volume que compra por mês, em faixas: até R$ 500, de R$ 500 a 2 mil, de 2 mil a 5 mil, acima de 5 mil.
9. Aceite de promoções, separado do cadastro: "Posso te mandar novidades e promoções por aqui? (sim/não)".
10. Fechamento: um resumo dos dados para a pessoa conferir ("Tá tudo certo?") e o aviso de que a equipe vai analisar e retornar. O agente não promete prazo.

O telefone vem do próprio WhatsApp e não é perguntado.

## 2) Onde guardar os dados (proposta, nada aplicado)

**Opção A, recomendada: uma nova lista de pré-cadastros de parceiro para a equipe aprovar.**
- Guarda: conversa, telefone, nome, empresa, documento, ramo, cidade/UF, e-mail, Instagram, Facebook, faixa de volume, aceite de promoções com data, aceite LGPD com data, situação (coletando, pronto, aprovado, recusado, saiu) e quem aprovou.
- Prós: não mexe na tabela de parceiros nem cria conta. A equipe revisa antes. É fácil desfazer.
- Contras: a aprovação vira um passo a mais, e é preciso uma tela para aprovar.
- No banco: uma tabela nova, com acesso restrito à equipe e escrita só pelo sistema, mais o SQL de reversão.

**Opção B: novas colunas na tabela de parceiros e de clientes** (instagram, facebook, aceita_promocoes, aceite_promocoes_em).
- Prós: o dado fica junto do parceiro e já resolve a falta de Instagram e Facebook no cadastro.
- Contras: sozinha, não tem onde guardar quem ainda não virou parceiro.
- Recomendação: usar as duas, nesta ordem. A opção A agora; a B na hora de aprovar, quando os dados passam do pré-cadastro para o parceiro.

**Opção C: guardar só como anotação dentro da conversa.** Não tem custo de banco, mas não dá para filtrar, aprovar nem provar o consentimento. Descartada.

Tudo isso vira um arquivo de proposta (`docs/proposta-pre-cadastro-parceiro.sql`), com reversão e testes manuais. Nada é aplicado sem a sua aprovação.

## 3) Como o pré-cadastro vira parceiro de verdade

- Na primeira versão o agente não cria conta nem senha, e não manda o link de convite sozinho.
- Ele gera o pré-cadastro. A equipe vê o pré-cadastro na tela de Parceiros e clica em "Aprovar". A aprovação usa o cadastro rápido que já existe (senha provisória, troca de senha no primeiro acesso), já com os dados preenchidos.
- Depois de aprovar, a equipe envia o link `/convite/<codigo>` ou os dados de acesso. Esse envio é sempre feito por uma pessoa nesta fase.
- Por que não mandar o link direto: a pessoa teria que digitar tudo de novo e perderíamos a validação do ramo pela equipe.

## 4) Travas e transferência para a equipe

O agente fala só do que está escrito no programa público de parceiros (os níveis e os benefícios como estão publicados). Ele nunca escreve valor, percentual, desconto, crédito, prazo, Pix ou forma de pagamento, nem promete aprovação.

Ele passa a conversa para a equipe com a frase padrão ("Vou chamar alguém da equipe pra continuar contigo.") quando:
- alguém pergunta de preço, desconto, crédito, prazo, pagamento ou orçamento;
- há reclamação ou tom irritado;
- surge dúvida fora do programa;
- a pessoa pede um atendente;
- a confiança da resposta fica abaixo de 0,6;
- o mesmo dado sai inválido 2 vezes;
- chega áudio ou arquivo que ele não entende;
- a conversa passa de 25 mensagens.

Antes de responder, uma segunda checagem lê o texto: se aparecer R$, %, uma data ou a palavra "desconto", a resposta é bloqueada e a conversa vai para a equipe. É a mesma proteção que a assistente já usa hoje.

## 5) Modo de teste e evolução

**Tela de ensaio**, no mesmo padrão da tela de teste do atendente de orçamento:
- À esquerda, a conversa simulada. A equipe digita como se fosse o interessado.
- À direita, a ficha que o agente está montando, campo a campo (preenchido, faltando ou inválido), o motivo de cada transferência e a confiança.
- Botão "Recomeçar".
- Nada vai para o WhatsApp e nada é gravado como parceiro ou pré-cadastro.

**Registro do teste:** o ensaio não grava nada no banco. A conversa fica só na tela e pode ser baixada como texto para revisão. Se quiserem histórico permanente de testes, isso entra na proposta SQL como uma opção marcada como "ensaio".

**Etapas:**
1. Ensaio: só a tela de teste, a versão de agora.
2. Rascunho: em conversas reais marcadas como parceiro, o agente sugere a resposta e a equipe aprova o envio com um clique. O pré-cadastro passa a ser gravado (depende da opção A aplicada).
3. Automático: responde sozinho só em conversas marcadas como parceiro, só em horário comercial (o horário da assistente, fuso de Belém), com a chave geral da IA ligada.

## 6) Custos e riscos

- **Custo por conversa:** de 12 a 20 trocas, com o histórico resumido. Estimativa de 15 a 30 mil tokens por cadastro completo, menos de R$ 0,50 por conversa com o modelo leve atual. Na tela de ensaio, o uso fica visível.
- **Mensagens em sequência:** o agente espera alguns segundos para juntar mensagens seguidas e responde no máximo 1 vez a cada 30 segundos (a regra atual). Também há um limite de conversas por hora. Se a IA estiver sem saldo ou sem limite, a conversa vai para a equipe.
- **Fora do horário:** só a mensagem de boas-vindas avisando que a equipe retorna no próximo dia útil. O agente não coleta dados (a partir da etapa 3).
- **Z-API (não oficial):** volume alto ou muitas mensagens iniciadas pela empresa podem levar ao bloqueio do número pelo WhatsApp. Por isso o agente só responde quem escreveu primeiro, não manda mensagens em massa, respeita o SAIR e responde com um pequeno atraso. Para volume grande de anúncios, o recomendado é migrar para a API oficial do WhatsApp (Meta).

## 7) Arquivos, testes e o que fica de fora

**Novos:**
- `src/domain/whatsapp/agente-parceiro.ts`: roteiro, ordem dos campos, leitura e validação de cada resposta, SAIR, travas e decisão de transferência.
- `src/lib/api/agente-parceiro-ensaio.functions.ts`: o ensaio, sem gravar nada e restrito à equipe.
- `src/routes/_authenticated/agente-parceiro-ensaio.tsx`: a tela de teste.
- `docs/proposta-pre-cadastro-parceiro.sql`: não aplicado.

**Ajustados:**
- `src/domain/parceiros/cadastro-rapido.ts`: reaproveitar as validações de documento e Instagram.
- `src/lib/dicas.ts`: dicas da tela.
- O menu, com o link para a tela de ensaio.
- `roadmap.md` e `AGENTS.md`.

**Testes** (`tests/agente-parceiro.test.ts`):
- consentimento e SAIR;
- ordem dos campos e o pulo do que já foi informado;
- CNPJ e CPF válidos e inválidos;
- ramo "outro";
- Instagram com e sem @;
- e-mail com sugestão de correção;
- bloqueio de R$, % e datas;
- cada motivo de transferência;
- confiança abaixo de 0,6;
- o limite de mensagens.

**Fora desta versão:**
- envio real pelo WhatsApp;
- gravação de pré-cadastro ou de parceiro;
- criação de conta e senha;
- leitura de áudio e imagem;
- etapas 2 e 3;
- mudanças no banco;
- publicação.

## Decisões que preciso de você
- Confirmar a opção A + B para guardar os dados.
- Confirmar as faixas de volume mensal.
- Dizer se o histórico dos testes de ensaio deve ficar guardado.
