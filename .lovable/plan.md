# Gestão de Usuários — CRUD completo na tela /usuarios

Hoje a tela só lista usuários e permite adicionar/remover perfis. Falta tudo o resto: criar usuário, editar dados, ativar/inativar, excluir e trocar senha. A tabela `usuarios` já tem campos que a tela nem mostra: telefone, cargo, avatar e status ativo.

## O que será construído

### 1. Botão "Novo usuário"
Diálogo com: nome, e-mail, telefone, cargo, senha inicial (com opção de gerar automática), perfil inicial e status ativo. Cria a conta de acesso e o registro do usuário de uma vez, já com o perfil atribuído.

### 2. Editar usuário
Diálogo de edição com nome, telefone, cargo, e-mail e status ativo. Alterar e-mail também atualiza o e-mail de login.

### 3. Alterar senha
Ação por usuário: definir nova senha manualmente ou enviar link de redefinição para o e-mail dele.

### 4. Ativar / Inativar e Excluir
- Switch de ativo/inativo direto na linha (inativo bloqueia o acesso).
- Excluir com confirmação, removendo conta de acesso, perfis e registro. Bloqueado para o próprio usuário logado e para o último administrador restante.

### 5. Tela reformulada
- Colunas: avatar + nome, e-mail, telefone, cargo, perfis, status, ações.
- Busca por nome/e-mail e filtros por perfil e status.
- Cartões de resumo: total de usuários, ativos, administradores.
- Identidade visual Bex Print (SectionHeader, StatusChip, NeonButton), estados vazio e de carregamento padronizados.

### 6. Segurança
Todas as operações passam por verificação de que quem executa é administrador; ninguém sem essa permissão consegue criar, editar, excluir ou trocar senha de outra pessoa. A tela em si continua restrita ao grupo Administração.

## Detalhes técnicos

- Novo `src/lib/api/usuarios.functions.ts` com `createServerFn` + `requireSupabaseAuth`:
  `listarUsuarios`, `criarUsuario`, `atualizarUsuario`, `definirSenha`, `enviarResetSenha`, `definirAtivo`, `excluirUsuario`, `atribuirPerfil`, `removerPerfil`.
- Cada handler valida entrada com Zod e confere o papel `admin` via `context.supabase` (consulta a `user_roles`) **antes** de carregar `supabaseAdmin` com `await import('@/integrations/supabase/client.server')`.
- Criação usa `auth.admin.createUser` (email confirmado), depois insere em `usuarios` com o mesmo `id` e grava o perfil em `user_roles`; falha na segunda etapa reverte a conta criada.
- Exclusão usa `auth.admin.deleteUser` (cascata remove `user_roles`); registros de negócio que referenciam o usuário mantêm a referência ou são desvinculados conforme a FK.
- Reescrita de `src/routes/_authenticated/usuarios.tsx` consumindo essas funções via `useServerFn` + React Query, com `sonner` para feedback.
- Migração apenas se necessária: policies de `usuarios` para admin gerenciar todas as linhas.
