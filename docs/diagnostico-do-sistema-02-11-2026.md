# Diagnóstico do Bex Print — 02/11/2026

Somente leitura. Nada foi alterado, criado no banco ou publicado. Base: `origin/main` e o banco de produção.

**Como ler as porcentagens.** Cada número tem a conta ao lado (ex.: 70 de 78). Onde a medição foi aproximada (busca de texto no código, não execução da tela), está escrito "estimado". Onde só olhei e não testei, está escrito "conferir".

---

## 0. Placar geral

| Dimensão | Nota | Base |
|---|---|---|
| Conexão entre telas (menu, links, busca) | 97% | 76 de 78 rotas têm entrada |
| Tela mostra "carregando" | 90% | 70 de 78 |
| Tela mostra "vazio" com explicação | 90% | 70 de 78 |
| Dica de uso por tela (`dicaTela`) | 86% | 67 de 78 |
| Botão só-ícone com nome para leitor de tela | 80% | 49 de 61 |
| Tela com atributo de acessibilidade (aria) | 46% | 36 de 78 (estimado) |
| Telas descritas no Mapa do sistema | 32% | 25 de 78 |
| Banco com RLS ligada | 100% | 176 de 176 tabelas |
| Função do banco com `search_path` fixo | 100% | 371 de 371 |
| Política de escrita aberta (`true`) | 0% | 0 de todas |
| Telas com breakpoint responsivo (arquivos) | 55% | 209 de 382 `.tsx` (estimado) |

**Leitura honesta:** a segurança do banco é o ponto mais forte. As lacunas estão na camada de entendimento da tela (dica, acessibilidade, mapa) e em três telas gigantes.

---

## 1. Estrutura (o que existe)

- 78 rotas autenticadas, 38 rotas públicas/portais (parceiro, TV, catálogo, aprovação), 16 rotas de API.
- 277 componentes de tela, 246 arquivos de regra (lib/domain/hooks), 303 arquivos de teste.
- 89 arquivos usam modal (Dialog, Sheet ou AlertDialog).
- Menu único em `src/lib/menu.ts`, filtrado pela permissão da rota (o menu não mostra o que o guarda barra).

**Analogia:** é um prédio com 78 salas, uma recepção (menu + busca) e um porteiro (guarda de rota). O porteiro e a recepção leem a mesma lista, então ninguém é convidado a entrar numa sala trancada. Isso já está certo.

---

## 2. Conexões entre estruturas (o que se relaciona e o que não)

### 2.1 Telas ↔ menu ↔ busca — 97%
- 76 de 78 rotas têm algum link de entrada. As duas "sem entrada" são falso alarme provável da minha busca: `/route` é arquivo de layout e `/produtos_/$id` é a ficha do produto, aberta pela lista com parâmetro. **Conferir** abrindo a ficha a partir da lista.
- 9 rotas fora do menu: 7 são fichas de detalhe (cliente, orçamento, OS, produto, catálogo), o que é esperado. Duas merecem olhar: `/catalogos/gerenciar` e `/catalogos/pedidos` (só 1 e 2 links de entrada). **Impacto:** pedido de catálogo pode passar despercebido.

**Analogia:** corredores que ligam as salas. Quase todos existem; dois quartos ficam num corredor só.

### 2.2 Telas ↔ explicação (dica e mapa) — 86% e 32%
- 11 telas sem dica: `/orcamentos/$id`, `/os/$id`, `/clientes/$id`, `/produtos_/$id`, `/orcamento-3d/$id`, três de catálogo, `/configuracoes-api`, `/importar-flexi`. **São as telas mais usadas e mais complexas.** Quem mais precisa de ajuda é quem menos recebe.
- Mapa do sistema cobre 25 de 78 rotas (32%). 53 rotas fora, incluindo `/dashboard`, `/compras`, `/fornecedores`, `/os/$id`.
- **Impacto:** o mapa passa a ideia de "sistema completo" e está mostrando 1/3. Novo funcionário confia nele e não encontra a tela.

**Analogia:** placas nas portas. Quase todas as salas têm placa, mas a sala da diretoria e a do caixa estão sem.

### 2.3 Modais — consistência
- 14 arquivos usam `AlertDialog` (confirmação padrão); 4 pontos ainda usam `window.confirm`.
- Telas com mais modais: materiais, orçamentos, produtos, usuários (3 cada).
- **Impacto:** o `window.confirm` do navegador não herda o visual, não é acessível do mesmo jeito e some em alguns navegadores embutidos (por exemplo, o do app de desktop).

**Analogia:** duas campainhas diferentes na mesma casa. Funciona, mas o visitante não sabe qual tocar.

### 2.4 Estados da tela — carregando / vazio
- 8 telas sem estado de carregamento: `/dashboard`, `/configuracoes`, `/casos-de-uso`, `/mapa-sistema`, `/pos-venda`, `/producao-3d`, `/orcamento-3d-novo`, `/catalogos/pedidos`.
- **Impacto:** `/dashboard` é a primeira tela. Sem indicação de carregamento, o dono vê número velho ou zerado e acha que o dado sumiu. Isso é o mesmo defeito que já pegamos antes ("a tela afirma o que o banco não tem").

**Analogia:** elevador sem luz de "andar". A pessoa não sabe se está subindo ou parado.

### 2.5 Telas gigantes (acoplamento)
- `/orcamentos/$id` 3.075 linhas, `/produtos` 1.472, `/os/$id` 1.395, `/produtos_/$id` 1.371, `/clientes/$id` 1.238.
- **Impacto:** cada mudança nelas arrisca quebrar outra parte da mesma tela; é onde nasce a "tela morta que passa no typecheck". Também é onde a dica de uso está ausente.

**Analogia:** uma loja que guarda tudo no mesmo cômodo. Dá para viver, mas qualquer arrumação mexe em tudo.

---

## 3. Experiência (UX) e tooltips

| Item | Tem? | Detalhe |
|---|---|---|
| Dica por tela (`dicaTela`) | Sim, 86% | Faltam as 11 telas de detalhe |
| Tooltip em ação (ícone) | Parcial | Componente `Tooltip` usado em 3 arquivos; 57 usam `title=` do navegador |
| Nome acessível em botão só-ícone | 80% | 12 sem nome, em: pedido de compra, itens da OS, editor de materiais do produto, conversa do WhatsApp, ficha do cliente (calendário e sidebar são da biblioteca) |
| Estado vazio com ação | 90% | |
| Busca de telas | Sim | no menu |
| Mapa do sistema e casos de uso | Sim | existem como telas (`/mapa-sistema`, `/casos-de-uso`) |

**Analogia:** é um carro com painel completo, mas alguns botões do volante não têm símbolo. Quem conhece o carro acerta, quem acabou de pegar não.

---

## 4. Segurança

### 4.1 Banco (medido)
- 176 tabelas, todas com RLS. 0 políticas de escrita abertas. 371 funções `SECURITY DEFINER`, todas com `search_path` fixo. **Isso é acima do padrão da maioria dos sistemas.**
- 7 funções chamáveis sem login (anon): `abrir_aprovacao`, `arquivo_em_aprovacao_aberta`, `registrar_decisao_aprovacao`, `convite_de_parceiro`, `parceiro_cadastrar_por_convite`, `programa_parceiros_publico`, `can_see_prices`. Seis são os fluxos públicos esperados (aprovação por link, convite de parceiro). **Conferir** se cada uma valida o token ou o convite por dentro. `can_see_prices` para anon não tem motivo claro.
- 12 tabelas com RLS ligada e nenhuma política (`tv_*`, `catalogo_*`, `portal_cliente_links`, `permissoes_excecoes*`, `whatsapp_atendimento_seq`). Isso significa "ninguém acessa pelo app, só o servidor", o que é seguro, mas **não está documentado**; alguém pode "consertar" criando política aberta.
- 3 views sem `security_invoker`: `produto_custo_cheio` (ninguém do app lê, correto), `vw_aprovacoes_orcamento` e `vw_metragem_cliente` (leitura por usuário logado; as duas filtram por quem pergunta, então o risco é baixo). 6 usuários com papel de parceiro têm login, por isso vale manter esse filtro sob teste.

### 4.2 Rotas de API públicas (conferir)
- 16 rotas `api.*`. Em 4 (`api.portal.arquivo`, `api.portal.envio`, `api.portal.mensagem`, `api.tv.parear`) a busca não achou menção a token, assinatura ou autenticação no próprio arquivo. Podem delegar tudo a uma função do banco, o que é válido, mas **não confirmei**.
- Webhook do WhatsApp e rotas com chave: têm referência a assinatura/token.

### 4.3 Front
- Um só `dangerouslySetInnerHTML` (script do tema, texto fixo): sem risco.
- 3 `console.log` em `src/`. Irrelevante.

**Analogia:** o cofre é de qualidade (RLS em tudo, fechaduras com a chave certa). O que falta é um caderno dizendo por que 12 gavetas estão sem chave de uso comum e uma conferência das 4 portas de serviço da calçada.

---

## 5. Compatibilidade

- `viewport` e `theme-color` ok; modo claro/escuro com script anti-piscada; manifesto PWA; `sw.js` que **nunca guarda HTML** (decisão certa, evita tela velha).
- Responsivo: 55% dos arquivos têm breakpoint (estimado, pois subcomponentes herdam o pai). Pelo histórico, margem no celular é por página.
- Sem `browserslist` e sem `engines` no `package.json`: o alvo de navegador e de versão do Node não está declarado.
- `localStorage` em 21 arquivos (tema, preferências): padrão; já existe tratamento para falha de leitura no tema.

**Analogia:** a casa tem tomada para os plugues de três países (modo claro/escuro, celular, offline), mas falta a etiqueta dizendo quais plugues foram testados.

---

## 6. Comparação com os melhores

| Prática de referência | Quem faz bem | Bex Print |
|---|---|---|
| Paleta de comandos e atalhos de teclado | Linear, Notion | Tem busca de telas; faltam ações ("criar orçamento") e atalhos |
| Histórico e relacionados dentro do registro | Odoo (chatter e botões inteligentes), Stripe | Parcial: existem abas, mas orçamento ↔ OS ↔ cobrança ↔ compra de material não aparecem juntos numa linha só |
| Estado vazio que ensina | Stripe, Notion | 90% |
| Confirmação padronizada | Radix/shadcn | 14 padrão, 4 do navegador |
| Acessibilidade por padrão (nome em botão-ícone, foco em modal) | Radix, GitHub | 80% botões, 46% telas com aria |
| Documentação viva do sistema | Backstage, Odoo | Mapa cobre 32% |
| Segurança por padrão (RLS, funções com `search_path`) | Supabase, Stripe | 100% |

---

## 7. Melhorias propostas (não executadas, em ordem de impacto por esforço)

1. **Dica nas 11 telas de detalhe** (esforço baixo, impacto alto). Reaproveita o `dicaTela` que já existe.
2. **Carregando nas 8 telas**, começando por `/dashboard` e `/producao-3d` (baixo).
3. **Trocar os 4 `window.confirm` por `AlertDialog`** e corrigir os 12 botões sem nome (baixo, também ajuda leitor de tela).
4. **Documentar as 12 tabelas "sem política"** com `COMMENT ON TABLE` e um teste que proíba política aberta nelas (baixo, evita acidente futuro).
5. **Conferir as 7 funções anon e as 4 rotas de API sem token visível** e trocar `can_see_prices` para uso só logado se não houver motivo (médio, é o único item de segurança que pede olho humano).
6. **Mapa do sistema gerado a partir das rotas reais** (hoje é lista manual, por isso 32%). Quando o mapa vier das rotas e do menu, sempre mostra 100% (médio).
7. **Cadeia orçamento ↔ OS ↔ cobrança ↔ compra de material numa faixa só** na ficha do cliente e do orçamento, como o "relacionados" do Odoo (médio-alto).
8. **Quebrar `/orcamentos/$id`** em seções (3.075 linhas), sem mudar comportamento (alto; deixar por último).
9. **Declarar `browserslist` e `engines`** (baixo).

**Mantém como está (serve):** menu único filtrado por permissão, RLS em 100% das tabelas, `sw.js` que não guarda HTML, `dicaTela`, estados de vazio, os assistentes em passos, a suíte de 303 testes.

---

## 8. O que este diagnóstico não mediu

- Não abri as telas no navegador (login pendente com o dono). Contraste, foco do teclado e o layout real no celular ficam sem nota.
- Os 11 "sem dica", 8 "sem carregando" e 42 "sem aria" vêm de busca no código; uma tela pode cumprir o papel por outro caminho.
- Não li o corpo das 7 funções anon nem das 4 rotas de API: marquei como "conferir", não como falha.
- "Compare com os melhores" é por prática conhecida desses produtos, não por teste lado a lado.
