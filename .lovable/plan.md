# Diagnóstico completo e correção do módulo de Orçamentos

## O que foi verificado agora no sistema

Consultei o banco e o código antes de escrever este plano. Os achados abaixo estão confirmados.

### 1. Causa raiz dos orçamentos 3D "que somem" (crítico)

O orçamento 3D **é gravado** — existe 1 registro salvo ("Urna e Gatinho Anjo", R$ 121,15, hoje 13:52). O problema é na **leitura**: 21 regras de acesso, em 13 tabelas do módulo 3D, dependem da função interna `require_permission`, e essa função **deixou de ser executável pelo usuário logado** (efeito colateral do último ajuste de segurança). Resultado: toda consulta às tabelas abaixo falha ou volta vazia para quem está logado.

Tabelas afetadas: `orcamentos_3d`, `orcamento_3d_calculos`, `orcamento_3d_placas`, `orcamento_3d_consumos`, `orcamento_3d_servicos`, `maquinas_3d_config`, `materiais_3d_filamento`, `config_precificacao_3d`, `producao_3d_jobs`, `producao_3d_apontamentos`, `producao_3d_fechamentos`, `slicer_imports`, `os_resultado_snapshots`.

Isso explica em cascata: lista de orçamentos 3D vazia, impressoras/filamentos sumindo dos seletores, produção 3D vazia e a energia/mão de obra não vindo das configurações.

### 2. Energia e mão de obra não puxam da configuração

As configurações **existem e estão certas** no banco: tarifa marginal R$ 1,1339/kWh (calculada da fatura, R$ 1,108521 com tributos) e mão de obra R$ 40,00/h. Dois problemas:
- a leitura dessa tabela está bloqueada pelo item 1;
- mesmo desbloqueada, o formulário só aplica o valor salvo se o campo ainda estiver exatamente no valor "de fábrica" (0,95 e 40). Se o usuário mexeu ou trocou de preset, a configuração é ignorada.

### 3. Orçamento sem cliente cadastrado (pedido do usuário)

Hoje é impossível: na tabela de orçamentos o cliente é **campo obrigatório** e não existe campo para escrever o nome livre. O orçamento 3D já aceita ficar sem cliente, mas a tela obriga selecionar.

### 4. Orçamento comum (lona, adesivo, impressão) — catálogo zerado

Após a limpeza dos dados, `produtos` e `orcamentos` estão com 0 registros. O autocomplete de produtos funciona, mas não há nada para escolher, então o orçamento tradicional parece "quebrado".

### 5. Orçamentos 3D e orçamentos comuns são dois mundos separados

`/orcamentos` lê só a tabela tradicional; o 3D vive em `/impressao-3d`. Não há visão única do funil comercial.

---

## O que será feito

### Etapa A — Destravar o sistema (correção de banco)
- Devolver a permissão de execução de `require_permission` ao usuário logado (mantendo bloqueado para visitantes anônimos), restaurando leitura/escrita nas 13 tabelas.
- Revisar as demais funções internas usadas em regras de acesso para garantir que nenhuma outra ficou com o mesmo problema.
- Tornar o cliente **opcional** no orçamento tradicional e adicionar campos de contato avulso (nome, telefone, e-mail).
- Regra de faturamento: exigir cliente cadastrado apenas na conversão do orçamento em OS (mensagem clara pedindo o vínculo).

### Etapa B — Orçamento sem cliente (telas)
- Em `/orcamentos` e no orçamento 3D: alternar entre "Cliente cadastrado" e "Contato avulso" (só o nome é obrigatório).
- Botão "Cadastrar este contato como cliente" que cria o cliente e vincula ao orçamento existente.
- Bloqueio amigável na conversão em OS quando não houver cliente vinculado.

### Etapa C — Orçamento 3D confiável
- Puxar sempre tarifa de energia, mão de obra/hora, markup, acabamento, falha e custo administrativo da configuração salva, com indicação visual de origem ("vindo das configurações") e possibilidade de sobrepor manualmente.
- Presets deixam de sobrescrever a tarifa de energia da configuração.
- Após salvar, redirecionar para o detalhe do orçamento 3D e confirmar em tela que foi gravado (hoje volta para a lista, que estava vazia por causa do item 1).
- Mensagens de erro reais em vez de falha silenciosa ao salvar.

### Etapa D — Orçamento tradicional (lona, adesivo, impressão)
- Repovoar o catálogo de produtos/serviços de comunicação visual (lona, adesivo, banner, placa, impressão, acabamentos) com unidade, custo e margem — como base editável.
- Revisar cálculo por m² (largura × altura × quantidade) nos itens de orçamento.
- Conferir fluxo completo: criar → itens → total → aprovar → converter em OS → parcelas.

### Etapa E — Diagnóstico dos módulos e conexões
- Página/relatório interno de saúde do sistema mostrando, por módulo (Comercial, Produção, 3D, Estoque, Financeiro, Pós-venda, WhatsApp): tabelas acessíveis, cadastros mínimos presentes (máquinas, materiais, produtos, configurações) e o que falta para operar.
- Conferir vínculos: máquinas ↔ configuração 3D ↔ filamentos ↔ agenda ↔ produção; produtos ↔ materiais ↔ estoque; OS ↔ financeiro ↔ pós-venda.
- Entregar ao final um resumo em % do que está operacional por módulo.

---

## Detalhes técnicos

- Migration: `GRANT EXECUTE ON FUNCTION public.require_permission(text) TO authenticated;` e auditoria de `has_function_privilege` para toda função citada em `pg_policies`.
- Migration: `ALTER TABLE public.orcamentos ALTER COLUMN cliente_id DROP NOT NULL;` + colunas `contato_nome`, `contato_telefone`, `contato_email`; validação no RPC `converter_orcamento_em_os` exigindo `cliente_id`.
- Frontend: `orcamentos.tsx`, `orcamentos.$id.tsx`, `orcamento-3d-novo.tsx`, `impressao-3d.tsx`, `configuracoes-3d.tsx`.
- Prefill do 3D passa a usar um estado "tocado pelo usuário" por campo em vez de comparar com literais (`"0.95"`, `"40"`).
- Seed do catálogo por migration com `INSERT` explícito.

## Fora deste escopo
- Mudanças visuais na identidade Bex Print (mantida).
- Integração real de WhatsApp com provedor externo.
