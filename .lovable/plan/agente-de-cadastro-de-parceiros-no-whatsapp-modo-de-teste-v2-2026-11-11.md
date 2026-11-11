# Agente de cadastro de parceiros no WhatsApp — modo de teste (v2, roteiro do dono)

Objetivo: o anúncio de parceiros (mesma imagem e texto) passa a abrir o WhatsApp com "Quero ser parceiro Bex Print". Um agente conduz o cadastro por partes. Nesta versão só existe a tela de ensaio: nada sai pelo WhatsApp, nenhum parceiro é criado e o banco não muda (todo SQL é proposta).

## 1) Roteiro da conversa (definido pelo dono)

Regras: uma pergunta curta por mensagem, tom simpático, apresenta-se como assistente. Cada resposta é guardada na hora; se a pessoa parar, retoma de onde parou. Não repete o que já foi dito e aproveita várias respostas numa mensagem. "SAIR" ou "atendente" funcionam a qualquer momento.

| Passo | Pergunta | Obrigatório |
|---|---|---|
| 0 | Saudação, apresentação como assistente, aviso LGPD com link de privacidade e opção SAIR | sim (aceite) |
| 1 | Nome | sim |
| 2 | "O número que você está usando agora (final XXXX) é o mesmo para o cadastro? 1 Sim / 2 Não, é outro" — se 2, pede com DDD e valida | sim |
| 3 | E-mail (acesso ao painel), validado com sugestão de correção | sim — aqui nasce o pré-cadastro |
| 4 | Empresa ou marca | não |
| 5 | Ramo: 1 gráfica/comunicação visual, 2 agência, 3 designer, 4 revenda de brindes, 5 outro (pergunta qual) | não |
| 6 | Cidade e UF | não |
| 7 | Instagram ou site (@, link ou "não tenho") | não |
| 8 | CNPJ ou CPF | não |
| 9 | Volume mensal de pedidos: 1 até 5, 2 de 6 a 20, 3 mais de 20 | não |
| 10 | Aceite de promoções (sim/não, com data e hora; "não" = nunca recebe promoção) | não |
| 11 | Resumo e "1 está certo / 2 corrigir" (corrigir: pergunta qual campo e volta só nele) | — |
| 12 | "Seu cadastro foi enviado, a equipe confirma e libera o acesso." Entrega à equipe com tudo preenchido | — |

Mapeamento do ramo: 1 comunicacao_visual, 2 agencia, 3 designer, 4 revendedor_brindes, 5 outro + ramo_outro.

Exceções:
- Silêncio: um lembrete após cerca de 30 min, depois pausa; retoma de onde parou quando a pessoa voltar.
- Fora do horário (8h–18h, seg–sex, fuso de Belém): continua coletando e avisa que a equipe responde no próximo dia útil.
- Áudio, imagem ou arquivo: "Recebi, vou passar para a equipe" e transfere.
- Duas respostas ininteligíveis seguidas: transfere.
- Preço, desconto, crédito, prazo, pagamento, reclamação ou dúvida fora do programa: transfere.

## 2) Travas

- Só fala do que está no programa público de parceiros; nunca escreve valores, percentuais, datas de entrega, Pix ou promessa de aprovação.
- Checagem final do texto (mesma da assistente atual): R$, %, datas ou "desconto" bloqueiam a resposta e transferem.
- Confiança abaixo de 0,6 transfere.
- A IA só interpreta a resposta e extrai campos; a ordem dos passos, a validação e o texto das perguntas vêm de regras fixas no sistema. Assim o roteiro não varia e o custo cai.

## 3) Onde guardar — pré-cadastro por partes (proposta)

**Opção A, recomendada: nova tabela `parceiro_pre_cadastros`**, uma linha por conversa:
- ligação: conversa_id, lead_id, telefone_conversa;
- andamento: etapa_atual (0–12), situacao (coletando, minimo_completo, enviado, aprovado, recusado, saiu, transferido), tentativas_invalidas, ultimo_contato_em, lembrete_enviado_em;
- consentimento: aceite_lgpd_em;
- dados: nome, telefone_confirmado (sim/não), telefone_cadastro, email, empresa, ramo_atuacao, ramo_outro, cidade, uf, instagram_ou_site (normalizado), documento, volume_mensal (ate_5, 6_20, mais_20);
- promoções: aceita_promocoes (sim/não/vazio) e aceite_promocoes_em;
- origem: fonte (anuncio, convite, texto, telefone), anuncio_id, codigo_convite;
- revisão: aprovado_por, aprovado_em, parceiro_id, motivo_recusa.
- Acesso: leitura e decisão só para a equipe com permissão de parceiros; gravação só pelo sistema. Um pré-cadastro aberto por telefone.
- Prós: não mexe em parceiros nem cria contas, guarda quem ainda não virou parceiro e prova o consentimento. Contra: precisa de uma tela de aprovação.

**Opção B, complementar, na aprovação:** colunas novas em `parceiros` — instagram_ou_site, aceita_promocoes, aceite_promocoes_em, volume_mensal, pre_cadastro_id. Só são preenchidas quando a equipe aprova.

**Opção C:** guardar como nota na conversa. Descartada: sem filtro, aprovação ou prova de consentimento.

Arquivo: `docs/proposta-pre-cadastro-parceiro.sql`, com tabela, acessos, regras de acesso, colunas da opção B, reversão e testes manuais. Não aplicado.

**Teste no ensaio:** cada turno vai para a tabela de ensaios que já existe (a mesma do atendente de orçamento), com a ficha parcial nos dados do turno. Não cria pré-cadastro real.

## 4) Pontos pedidos

**(b) Telefone da conversa vira telefone do cadastro.** Se a resposta do passo 2 for "1/sim", grava telefone_confirmado = sim e copia o telefone da conversa, já no formato normalizado que o WhatsApp usa. Se for "2", pede o número com DDD, valida com `whatsappValido`/`mascaraWhatsapp` e grava esse; o da conversa continua guardado em telefone_conversa. O "final XXXX" mostra só os 4 últimos dígitos.

**(c) Reaproveitar `cadastro-rapido.ts`.**
- Validação: `validarCadastroRapido` (nome, telefone, e-mail), `nomeParecendoEndereco` (nome que parece endereço), `sugerirEmail` ("você quis dizer …@gmail.com?").
- Complemento: `validarComplemento` (ramo, contra a lista `RAMOS` de `ramo.ts`).
- Funções novas pequenas no mesmo domínio: CPF/CNPJ com dígito verificador, normalização de Instagram/site (mesma regra de comprovacao_url), UF válida.
- O agente não duplica nenhuma dessas regras.

**(d) Aprovação com um clique.** Na tela de Parceiros, uma aba "Pré-cadastros" mostra a ficha, a origem e um link para a conversa.
- "Aprovar" chama uma função do sistema que confere a permissão de quem clicou e cria o parceiro com os dados (`origem_cadastro = 'whatsapp'`, código de convite novo, `validado_em` preenchido se a equipe confirmar o ramo).
- Sem conta e sem senha: a equipe libera o acesso pelo cadastro rápido que já existe, ou manda o link `/convite/<codigo>`.
- "Recusar" pede o motivo.
- Nada disso é automático na v1.

**(e) Tela de ensaio com a ficha ao vivo.** Rota nova "Ensaio do agente de parceiros", restrita à equipe.
- À esquerda: a conversa simulada, com botões de atalho (SAIR, áudio simulado, silêncio de 30 min, fora do horário) e um campo para simular o telefone da conversa.
- À direita: a ficha atualizada a cada resposta. Cada campo aparece como vazio, preenchido ou inválido; também mostra o passo atual, o selo "mínimo completo" a partir do passo 3, a fonte, o aceite de promoções com data e o motivo de qualquer transferência e a confiança.
- Botões "Recomeçar" e "Baixar conversa". Nada é enviado.

**(f) Convivência com a marcação de parceiro (`proposta-tipo-do-lead-parceiro.sql`).**
- A marcação continua sendo a única fonte do selo e da cor: `leads.tipo` e a lista de anúncios de parceiro. O agente não cria outra marca.
- O agente só começa em conversas cujo lead já está como parceiro. Ele lê a marcação e não a altera.
- O pré-cadastro guarda `lead_id`, e a aprovação liga o parceiro ao lead (lead continua parceiro).
- Divergência de regra de texto: o dono agora citou "parceiro/revendedor/terceirizado", mas o ajuste anterior aceita só "quero ser parceir", justamente para "meu parceiro me indicou" não marcar parceiro. Proposta: manter a frase específica e acrescentar "quero ser revendedor" e "sou terceirizado". As palavras soltas não marcam. Confirmar antes de mexer na proposta.
- Ordem de aplicação: primeiro a proposta de marcação, depois a de pré-cadastro, que depende de `leads.tipo` e de `anuncios_de_parceiro`.

## 5) Evolução em etapas
1. Ensaio: só a tela de teste (esta versão).
2. Rascunho: em conversas reais marcadas como parceiro, o agente sugere a resposta, a equipe aprova o envio, e o pré-cadastro começa a ser gravado.
3. Automático: só em conversas de parceiro, com a chave geral da IA ligada. Fora do horário segue coletando e avisa sobre o próximo dia útil.

## 6) Custos e riscos
- Cadastro completo: cerca de 14 a 20 trocas. Como a IA só extrai campos, a estimativa é de 8 a 15 mil tokens, menos de R$ 0,30 por cadastro no modelo leve atual. O consumo aparece no ensaio.
- Mensagens em sequência: junta mensagens seguidas por alguns segundos e responde no máximo uma vez a cada 30 s (regra atual), com limite de conversas por hora. Sem saldo de IA, transfere.
- Lembrete de silêncio: no máximo um por conversa, só dentro de 24 h da última mensagem da pessoa.
- Z-API (não oficial): risco de bloqueio do número com volume alto. O agente só responde quem escreveu primeiro, nunca dispara em massa, respeita SAIR e o "não" às promoções. Com volume grande de anúncios, recomenda-se a API oficial da Meta.

## 7) Arquivos, testes e fora do escopo

**Novos:**
- `src/domain/whatsapp/agente-parceiro.ts`: passos, interpretação de "1/2/sim/não", extração de várias respostas, retomada, travas e decisão de transferência.
- `src/lib/api/agente-parceiro-ensaio.functions.ts`: restrito à equipe, sem envio.
- `src/routes/_authenticated/agente-parceiro-ensaio.tsx`.
- `docs/proposta-pre-cadastro-parceiro.sql`: não aplicado.

**Ajustados:**
- `src/domain/parceiros/cadastro-rapido.ts`: documento, Instagram/site e UF.
- `src/lib/dicas.ts`.
- Item de menu.
- `roadmap.md`.
- `AGENTS.md`: regra de que o agente de parceiros só lê a marcação de parceiro e só grava no pré-cadastro.

**Testes (`tests/agente-parceiro.test.ts`):**
- SAIR e atendente em qualquer passo;
- passo 2 com "1", "sim", "2" seguido de número válido e inválido;
- mínimo completo no passo 3;
- várias respostas numa mensagem pulam passos;
- retomada no passo certo;
- mapeamento de ramo 1–5 e "outro";
- Instagram com @, link e "não tenho";
- CPF e CNPJ válidos e inválidos;
- volume 1–3;
- promoções sim/não com data;
- correção no resumo;
- duas respostas ininteligíveis transferem;
- áudio transfere;
- preço, desconto e prazo transferem;
- bloqueio de R$, % e datas;
- fora do horário continua coletando;
- lembrete único.

**Fora da v1:** envio real, gravação de pré-cadastro em produção, criação de conta ou senha, leitura de áudio e imagem, etapas 2 e 3, aplicação de SQL, publicação.

## Decisões pendentes do dono
1. Regra de texto: manter frases específicas, como proposto em (f), ou aceitar as palavras soltas?
2. Opção A + B para guardar os dados.
3. Lembrete de silêncio: só um, ou um segundo no dia seguinte?
