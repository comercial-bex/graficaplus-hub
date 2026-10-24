# Índice das ferramentas guardadas — `ferramentas/aiox-core/`

> Material de terceiros armazenado para uso posterior. **Nada está ativado, instalado ou integrado.**
> A pasta está fora da checagem de tipos, do lint, dos testes e do Prettier, e as instruções internas dela (incluindo o próprio `AGENTS.md` do pacote) não valem para o Bex Print.

## O que é

**Synkra AIOX** (`@aiox-squads/core` 5.4.1, licença MIT) — um framework de "esquadrão de agentes de IA" para conduzir desenvolvimento de software: 12 papéis especializados (analista, arquiteto, engenheiro de dados, dev, QA, PM/PO/SM etc.), fluxos de trabalho prontos (histórias, QA, descoberta de sistema existente), 215 tarefas instrucionais, 16 checklists e modelos de documentos (PRD, arquitetura, histórias, ADR/DBDR). O pacote fornece as *instruções e processos*; quem executa é um "anfitrião de IA" (Claude Code, Cursor, Gemini CLI, Grok, Codex) — o pacote não traz IA própria.

**Licença MIT** — uso comercial livre no núcleo. Exceção: os módulos "Pro" (licença paga, backend do Synkra) e serviços externos com chave própria.

## Mapa da pasta

| Pasta | O que guarda |
|---|---|
| `.aiox-core/development/agents/` | As 12 definições de agentes (o coração do framework) |
| `.aiox-core/development/workflows/` | 15 fluxos completos (ex.: `story-development-cycle`, `qa-loop`, `brownfield-discovery`) |
| `.aiox-core/development/tasks/` | 215 tarefas instrucionais (ex.: `audit-codebase`, `analyze-brownfield`, `architect-analyze-impact`) |
| `.aiox-core/product/templates/` e `product/checklists/` | Modelos de documentos (PRD, arquitetura, épico, ADR) e checklists (acessibilidade WCAG, design de banco, migração, rollback) |
| `.aiox-core/core/` | Código de orquestração, sessões, gates de qualidade, dashboard de grafo |
| `bin/` e `.aiox-core/cli/` | CLIs: `aiox` (instalador/doctor/validate), `aiox-graph` (mapa de dependências), `aiox-delegate` (delega tarefa ao Codex), comandos `sdc`/`wave` (controle de progresso por história/épico) |
| `packages/` | `installer` (assistente de instalação), `aiox-install` (pacote NPX), `aiox-pro-cli` (licença Pro), `gemini-aiox-extension` |
| `squads/` | Exemplos de squad; `claude-code-mastery` (8 agentes sobre hooks/MCP/skills do Claude Code) |
| `.grok/`, `.gemini/`, `.cursor/`, `.antigravity/`, `.kimi/` | Adaptações dos agentes para cada ferramenta de IA/IDE |
| `.synapse/` | Registro de domínios/instruções por agente e fluxo (camada de contexto) |
| `docs/` | Documentação de instalação e uso (PT/ES/EN) |
| `_github/`, `_husky/` | Automações do repositório **origem**, guardadas desligadas de propósito |
| `governance/`, `audits/` | Regras de evolução do próprio framework (não aplicáveis ao Bex Print) |

## O que pode ajudar no Bex Print — e o pré-requisito de cada um

| Ferramenta | Como ajudaria | Pré-requisitos |
|---|---|---|
| **Agente `data-engineer`** (`development/agents/data-engineer.md`) | Modelo direto para revisar/Planejar schema, RLS, migrações e otimização de consultas — encaixa com o padrão que já usamos (funções SECURITY DEFINER, RLS por papel) | Só leitura/instrução; nada instalar. Útil como "manual de boas práticas" copiável para as decisões do sistema |
| **Agente `qa` + fluxo `qa-loop.yaml`** | Arquitetura de testes, rastreabilidade e ciclo revisar→corrigir→rerevisar para regras sensíveis (cálculos de orçamento, permissões, fechamento de OS) | Nenhum. Fluxo é texto; adaptar às nossas pautas |
| **Checklists** (`product/checklists/`: WCAG, design de banco, migração, rollback, PM) | Listas prontas para conferir migrações, acessibilidade e liberações — dá para usar hoje, uma a uma | Nenhum |
| **Modelos de documento** (`product/templates/`: PRD, arquitetura, épico, ADR/DBDR) | Padronizar os documentos de decisão (o `docs/` atual já tem algo disso) | Nenhum |
| **Fluxo `brownfield-discovery.yaml` + tarefas `analyze-brownfield`/`audit-codebase`** | Roteiro completo de avaliação de sistema existente (arquitetura, banco, UX, QA, PM) — emula as "avaliações totais" que já pedimos | Um anfitrião de IA (Claude Code, Cursor, Gemini CLI…) para conduzir os papéis |
| **Fluxo `brownfield-fullstack.yaml` + ciclo de histórias (`sm`→`po`→`dev`→`qa`)** | Método para transformar pedidos grandes (ex.: nova tela, integração) em histórias com critérios de aceite | Anfitrião de IA; opção de complemento: chaves de LLM (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`DEEPSEEK_API_KEY`) para o modo "claude-free" |
| **Agente `ux-design-expert` + fluxo `design-system-build-quality.yaml`** | Processo de pesquisa, wireframes, tokens e QA visual — casa com a identidade "Precisão industrial" e o sistema de tokens atual | Nenhum para leitura; uso completo pede anfitrião de IA |
| **Agente `pm`/`po`/`sm` + templates de PRD/épico** | Estruturar roadmap e escopo de módulos novos (ex.: expansão do portal, pós-venda) | Nenhum |
| **CLIs de controle** (`bin/aiox.js doctor/validate`, comandos `sdc`/`wave`, `aiox-graph`) | Acompanhar progresso por história/épico e visualizar dependências entre módulos como grafo | Node ≥ 18 e npm ≥ 9 (não atendidos *dentro* da pasta — dependências do pacote não foram instaladas de propósito); instalar é uma decisão à parte |
| **Squad `claude-code-mastery`** | Especialistas sobre hooks, MCP e skills do Claude Code — referência se formos aprofundar automações de IA | Claude Code; material de referência, não de produção |

**Nada no pacote traz código de aplicação** (não há conector de WhatsApp, integração de banco usável nem módulo de impressão): tudo é processo, instrução e utilitário de desenvolvimento.

## Pré-requisitos gerais (resumo)

- **Node ≥ 18, npm ≥ 9, Git ≥ 2.30** — e instalar as dependências do pacote (hoje, de propósito, nada foi instalado).
- **Anfitrião de IA** (Claude Code, Cursor, Gemini CLI, GitHub Copilot, Grok ou Codex) para conduzir os agentes — os CLIs sozinhos não chamam IA.
- **Chaves opcionais** (ver `.env.example`): OpenAI/Anthropic/DeepSeek/OpenRouter (inferência), Exa (pesquisa), GitHub (operações de repositório). Sem chaves, o modo `minimal` funciona sem API alguma.
- **Supabase/ClickUp/N8N/Sentry/Railway/Vercel** aparecem no modelo de `.env`, mas são integrações opcionais — não pré-requisitos do núcleo.
- **Módulos "Pro"**: exigem licença paga (conta no Synkra) — se um dia interessar, é decisão de compra, não só técnica.
- **Discrepância de versões**: `package.json` diz 5.4.1; os docs de instalação dizem 2.1.0. O que vale é o manifesto do pacote.

## O que não se aplica / conflitos (mantido isolado de propósito)

- `_github/` e `_husky/` são automações do repositório de origem (guarda de framework, manifestos, CI). Adotá-las no repositório do Bex Print causaria conflito com nosso CI e nossos hooks.
- O `AGENTS.md` e a "constituição" do pacote impõem regras dele (CLI primeiro, dashboards só observam, push só pelo agente devops) — não valem aqui, conforme registrado no `AGENTS.md` da raiz.
- Os caminhos padrão dele (`docs/prd`, `docs/stories`, `.ai/`) assumem a estrutura de projeto dele; rodar solto pode escrever nos lugares errados.
- Integrações de IDE (`.cursor/`, `.gemini/`, `.grok/`…) sobrescreveriam regras locais de ferramenta se copiadas para a raiz.

## Seleção prioritária para as pendências atuais — 24/10/2026

**Proposta apenas: nenhuma ferramenta será ativada, instalada ou integrada.** A referência de situação atual é o `roadmap.md`: a caixa WhatsApp v3 está marcada como concluída; o assistente permanece **desligado por decisão do dono**; a adoção do AIOX ainda aguarda decisão. Não tratar as lacunas de diagnósticos antigos como problemas atuais sem reconferência. A importação do extrato real foi mencionada anteriormente como dependente do envio do arquivo, mas não está confirmada como pendência no roadmap atual.

### 1. Agente `pm`/`po` + modelo de PRD/épico — definir o próximo trabalho

- **Por que primeiro:** a pendência imediata do AIOX é escolher seu uso, não instalar o pacote. Este item ajuda a transformar pedidos e registros antigos em uma lista curta de trabalho confirmado, separando concluído, aguardando dados e aguardando autorização.
- **Adoção proposta:** usar o material apenas como referência para uma revisão do escopo; produzir uma lista priorizada com critérios de aceite e responsáveis. Manter a ativação do assistente fora do escopo enquanto não houver nova autorização do dono.
- **Pré-requisitos:** roadmap atual, confirmação dos responsáveis sobre pendências antigas e objetivo de uma primeira revisão. Nenhuma dependência, chave ou licença Pro para consultar os modelos.
- **Riscos:** burocratizar tarefas pequenas, reabrir trabalho já concluído ou transformar sugestão em autorização. Limitar a proposta a um módulo e não adotar os caminhos ou regras do pacote.
- **Critério para avançar:** escopo confirmado, resultado esperado verificável e autorização específica para a próxima etapa — não autorização genérica para integrar o AIOX.

### 2. Agente `data-engineer` — revisar a segurança das mudanças propostas

- **Por que segundo:** futuras alterações no WhatsApp ou preparação do assistente dependem de permissões, dados reais e histórico íntegro. É onde uma adoção indiscriminada traz maior risco.
- **Adoção proposta:** consultar o agente como roteiro de revisão somente-leitura de uma mudança já definida; conferir permissões, funções de escrita, integridade dos atendimentos e estratégia de reversão antes de propor qualquer alteração.
- **Pré-requisitos:** escopo da etapa 1, esquema e migrações atuais, matriz de permissões e regras locais do Bex Print. A consulta ao texto não exige instalação; uma revisão dos dados reais depende de acesso autorizado, sem copiar segredos para relatórios.
- **Riscos:** aplicar recomendações genéricas incompatíveis com o Bex Print, ampliar acessos, expor dados de clientes ou alterar a idempotência do webhook. As regras locais prevalecem; nenhuma migração, RPC ou comando do pacote faz parte desta proposta.
- **Critério para avançar:** parecer com evidências, riscos e plano de reversão; mudanças de acesso ou estrutura ficam sujeitas a aprovação própria.

### 3. Agente `qa` + fluxo `qa-loop` — verificar o resultado antes de liberar

- **Por que terceiro:** depois de delimitar o escopo e revisar os riscos, este item ajuda a comprovar o que funciona, evitando confundir uma marca de concluído com uma verificação atual de ponta a ponta.
- **Adoção proposta:** adaptar o ciclo revisar → corrigir → rever como lista de verificação, usando os testes e ferramentas existentes do projeto. Começar pelas regras sensíveis do WhatsApp: resolução com última mensagem de entrada, reabertura sem responsável, bloqueio da IA com responsável e controle de respostas repetidas.
- **Pré-requisitos:** critérios de aceite da etapa 1, parecer da etapa 2, testes existentes e conta autorizada para verificações de uso real. Testes de envio exigem destinatário de teste autorizado; testes de IA exigem autorização separada, configuração real e avaliação de custos — não ligar a IA para cumprir esta proposta.
- **Riscos:** dar aprovação com base apenas em testes isolados, usar dados reais indevidamente ou enviar mensagens a clientes durante a verificação. Registrar limites do que foi verificado e manter testes sem efeitos externos por padrão.
- **Critério para concluir:** evidências por regra e resultado explícito: aprovado, aprovado com ressalvas ou não aprovado, incluindo o que depende de dados ou autorização.

**Ordem de adoção sugerida:** definir escopo (`pm`/`po`) → revisar dados e segurança (`data-engineer`) → validar (`qa`/`qa-loop`). Os três podem começar como referências textuais, sem instalar CLIs, dependências, adaptações de IDE ou módulos Pro. A seleção não remove os bloqueios do roadmap nem autoriza ativar o assistente.

## Como usar (quando decidirmos)

1. Escolher 1–3 itens da tabela acima (sugestão natural: checklists + data-engineer + qa-loop primeiro, pois não exigem nada instalado).
2. Para uso completo, instalar num ambiente separado (`npx aiox-core install` exige as pré-requisitos acima) e apontá-lo para uma pasta de documentação própria — nunca sobre a raiz do Bex Print.
3. Nada disto muda o app, o banco ou o CI.

_Índice criado em 24/10/2026 a partir de leitura somente-leitura do pacote; nenhum script executado, nenhuma dependência instalada._
