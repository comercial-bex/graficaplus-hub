# PM/PO e integração planejada do AIOX no Bex Print

## Objetivo e autorização

Organizar as pendências reais em um plano verificável e preparar a integração completa do AIOX como **ambiente de apoio ao desenvolvimento**, não como módulo do sistema Bex Print.

Você escolheu **planejar a integração completa para aprovação antes de executar**. Neste momento não haverá instalação, ativação de agentes, execução de scripts, mudanças em telas ou alterações no banco. A aprovação deste plano autorizará a preparação e o piloto descritos abaixo; alterações de negócio, permissões, envio de mensagens ou ativação do assistente WhatsApp exigem escopo e autorização próprios.

## Situação inicial: o que será tratado

| Tema | Situação registrada | Tratamento PM/PO |
|---|---|---|
| Adoção do AIOX | Pendente de decisão e execução | Trabalho confirmado: preparar integração isolada e piloto |
| Caixa WhatsApp v3 | Marcada como concluída no roadmap atual | Não reimplementar; registrar evidências existentes e pontos ainda sem homologação atual |
| Assistente WhatsApp | Desligado por decisão do dono | Preservar desligado; registrar como decisão, não como defeito |
| Extrato bancário real | Arquivo solicitado anteriormente; situação atual não confirmada | Confirmar se ainda falta arquivo e conciliação; não inventar saldo nem transações |
| Impressão 3D → OS e portal | Documentos antigos registram lacunas de implementação e homologação | Verificar evidências posteriores antes de abrir trabalho; não afirmar falha atual |
| Permissões, concorrência e estruturas antigas | Pendências em documentos históricos | Separar concluído, não verificado e problema reproduzido; encaminhar revisão de dados somente se justificada |

**Primeiro piloto:** organizar a adoção do próprio AIOX e a confirmação das pendências acima. Não escolher antecipadamente um módulo para correção sem evidência.

## Etapa PM — definir prioridades e resultados

### Entregável 1: inventário de pendências com evidências

Criar `docs/planejamento-aiox/inventario.md`, reunindo roadmap, diagnósticos, testes e registros posteriores disponíveis.

Cada item terá: identificador, necessidade do usuário, fonte e data, situação atual, evidência, impacto, dependência, responsável proposto e próximo passo. Situações: **confirmado**, **concluído com evidência**, **a validar**, **aguardando dados**, **aguardando autorização** ou **fora do escopo**.

**Critérios de aceite:**
- Todos os temas da situação inicial estão classificados, inclusive os que não geram trabalho.
- Nenhuma lacuna antiga é chamada de problema atual sem reprodução ou evidência recente.
- Nenhum nome de responsável é inventado: indicar função e “a designar” quando necessário.
- IA desligada e falta de dados externos aparecem como decisões/dependências, não como falhas.

### Entregável 2: documento de escopo e prioridades

Criar `docs/planejamento-aiox/escopo.md` com objetivo, público afetado, dentro/fora do escopo, riscos e ordem proposta. Priorizar por impacto operacional, segurança dos dados, dependências e força da evidência; estimativas serão faixas justificadas, não promessas de prazo.

**Critérios de aceite:**
- Cada prioridade aponta para um item do inventário e explica sua posição.
- Trabalho confirmado está separado de investigação e de pedidos bloqueados.
- Existe uma primeira entrega pequena, verificável e reversível.
- Ativação da IA, pagamentos, novos acessos e mudanças de identidade visual permanecem fora do escopo.

## Etapa PO — transformar prioridades em trabalho aceito

### Entregável 3: épico e histórias pequenas

Criar `docs/planejamento-aiox/epico.md` e histórias em `docs/planejamento-aiox/historias/`, adaptando os modelos PM/PO ao Bex Print, sem importar as regras do repositório do AIOX.

Histórias iniciais:
1. Confirmar e classificar as pendências registradas.
2. Preparar o ambiente AIOX isolado e seu acesso limitado.
3. Executar um piloto PM/PO que produza documentação sem alterar o sistema.
4. Revisar o piloto com data-engineer e QA antes de propor uso contínuo.

Cada história terá necessidade, limites, pré-requisitos, responsável proposto, critérios Dado/Quando/Então, evidência esperada e forma de desfazer. Correções de módulos serão histórias separadas somente após confirmação.

**Critérios de aceite:**
- Cada história é rastreável a uma necessidade e pode ser aprovada ou recusada objetivamente.
- Nenhuma história mistura investigação, instalação e correção de negócio num único aceite.
- Dependências impedem avanço quando faltam arquivo, conta autorizada, ambiente ou aprovação.
- O PO revisa clareza, tamanho e condições de aceite; o dono valida prioridades de negócio.

### Entregável 4: matriz de aceite e registro de decisões

Criar `docs/planejamento-aiox/aceite.md` e `decisoes.md` ligando necessidade → história → verificação → resultado → evidência. Registrar quem pode aprovar e o que não foi verificado.

**Critérios de aceite:**
- Toda história tem pelo menos uma verificação que possa falhar.
- Aprovação documental não é apresentada como comprovação do funcionamento de uma tela ou operação real.
- Decisões pendentes e bloqueios externos estão explícitos.
- Nenhuma informação pessoal ou segredo aparece nos exemplos e relatórios.

## Integração completa, em etapas controladas

### 1. Preparar ambiente e verificar compatibilidade

- Manter `ferramentas/aiox-core/` como cópia de referência, sem instalar dependências nela.
- Preparar uma cópia de execução em ambiente separado do app; durante a preparação na sandbox, usar `/tmp`, sem prometer persistência desse ambiente.
- Conferir versão 5.4.1 do manifesto e compatibilidade dos arquivos guardados; a documentação antiga de instalação menciona outra versão e não será seguida cegamente.
- Definir o anfitrião de IA compatível disponível, operador responsável, permissões e custos antes do piloto. O pacote não traz IA própria e não implica execução nativa no Lovable.

**Aceite:** ambiente identificado, versão e requisitos registrados, acesso ao código apenas por cópia sanitizada/somente-leitura, nenhum acesso a segredos ou dados de produção. Se não houver anfitrião disponível, parar com esse bloqueio explícito, sem alegar integração concluída.

### 2. Instalar somente no ambiente isolado

- Revisar instalador e dependências antes de executá-los; fixar versão e registrar o comando escolhido.
- Bloquear scripts de instalação inicialmente e revisar os necessários antes de permitir sua execução.
- Não copiar hooks, automações, regras de IDE ou configurações globais para o Bex Print.
- Gerar configurações do anfitrião exclusivamente dentro do ambiente separado; começar por PM/PO e habilitar data-engineer/QA no piloto seguinte.

**Aceite:** dependências e configurações ficam fora do app; nenhum arquivo de código, configuração de testes, dependência, automação ou regra da raiz do Bex Print é alterado pela instalação. Scripts como `prepare`/Husky não instalam ganchos no projeto.

### 3. Pilotar PM/PO e revisar com data-engineer e QA

- PM organiza o inventário e o escopo; PO detalha histórias e critérios.
- O ambiente isolado produz propostas. Somente documentos revisados entram em `docs/planejamento-aiox/`; nenhum código gerado é aplicado automaticamente.
- Data-engineer revisa riscos de dados/permissões das histórias que os envolvam; QA revisa a verificabilidade dos critérios e a cobertura existente.
- Resolver divergências com as regras locais do Bex Print sempre prevalecendo.

**Aceite:** os quatro entregáveis acima são produzidos e revisados; recomendações não viram execução automática; o app e a IA WhatsApp permanecem inalterados.

### 4. Decidir continuidade

Produzir `docs/planejamento-aiox/avaliacao-piloto.md`: qualidade das histórias, retrabalho observado, custo quando houver uso externo, limitações, riscos e recomendação **continuar**, **ajustar** ou **interromper**.

**Aceite:** decisão baseada em evidências; operador, ambiente durável e manutenção definidos antes de uso contínuo. Integrações externas, módulos Pro, escrita automática de código e publicação não estão incluídos por padrão.

## Pré-requisitos e riscos

| Pré-requisito/risco | Controle proposto |
|---|---|
| Node ≥ 18, npm ≥ 9; requisito de Git a reconferir para o fluxo escolhido | Verificar no ambiente externo; nenhum comando Git de alteração de estado na sandbox |
| Anfitrião de IA compatível e operador | Confirmar disponibilidade antes de instalar; ausência bloqueia piloto executável |
| Custos de serviço externo ou licença Pro | Apresentar custo e obter autorização; núcleo MIT não elimina custos do anfitrião |
| Instalador pode sobrescrever regras e registrar hooks | Executar em cópia isolada, revisar scripts e comparar alterações antes de aceitar |
| Material guardado pode diferir da versão distribuída | Conferir procedência/completude e não atualizar silenciosamente |
| Envio de código a provedor externo | Limitar contexto a material autorizado e sanitizado; excluir dados pessoais e segredos |
| Diagnósticos antigos geram falso backlog | Exigir confirmação/evidência antes de abrir correções |
| Confundir AIOX com assistente WhatsApp | São iniciativas separadas; assistente permanece desligado |

## Detalhes técnicos e reversão

- AIOX é uma ferramenta externa de desenvolvimento baseada em Node, não uma dependência do app TanStack/Cloudflare; não será importado em rotas, servidor ou navegador.
- Não executar `sync:ide`, geração de configurações globais ou scripts de hooks na raiz do Bex Print. Qualquer suporte adicional do anfitrião fica no ambiente isolado.
- Revisar orientações da plataforma antes de futura implementação server-side; este plano não cria funções, rotas ou migrações.
- Registrar em `AGENTS.md`, durante a execução aprovada, a fronteira entre ambiente de ferramentas e app, preservando as regras atuais de segurança e isolamento.
- Reversão: interromper o anfitrião, remover o ambiente isolado e suas configurações locais; manter somente documentos aprovados e a cópia guardada. Não haverá alteração de produção a desfazer nesta etapa.

## Definição de conclusão

O plano PM/PO estará concluído quando inventário, escopo, histórias e matriz de aceite forem revisados. A integração só será declarada concluída quando instalação isolada e piloto real forem verificados; leitura dos modelos não basta. Bloqueios externos ficam identificados por nome e ação necessária.