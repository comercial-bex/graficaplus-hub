# Corrigir upload da logo do cliente + mensagens de erro em português

## O que está acontecendo com a logo

Confirmado na verificação: o bucket `avatares` é privado e sua política de gravação só aceita arquivos cuja **primeira pasta seja o ID do usuário logado** (`<user_id>/...`). A tela de clientes envia para `clientes/<uuid>.png`, ou seja, fora da pasta permitida. O banco recusa a gravação e devolve um erro técnico em inglês ("new row violates row-level security policy"), que aparece cru no aviso da tela.

## Correções

1. **Caminho do arquivo**: passar a enviar a logo para `<id-do-usuário>/clientes/<uuid>.<ext>`, respeitando a regra de segurança já existente (sem afrouxar permissões). A leitura continua funcionando: equipe interna já pode ver todos os avatares.
2. **Validação antes do envio**: bloquear arquivo que não seja imagem, manter o limite de 2 MB com mensagem clara ("A imagem deve ter no máximo 2 MB"), e avisar se a sessão expirou.
3. **Falha na URL assinada**: hoje, se a geração da URL falhar, a logo fica vazia em silêncio. Passará a exibir erro explícito.

## Mensagens de erro em português (todo o sistema)

Criar um tradutor central de erros, `src/lib/erros.ts`, com uma função `mensagemErro(erro)` que:
- reconhece os erros mais comuns do backend/autenticação/armazenamento e devolve texto em português brasileiro. Exemplos:
  - "violates row-level security policy" → "Você não tem permissão para realizar esta ação."
  - "duplicate key value violates unique constraint" → "Já existe um registro com esses dados."
  - "Invalid login credentials" → "E-mail ou senha inválidos."
  - "Email not confirmed" → "E-mail ainda não confirmado."
  - "User already registered" → "Este e-mail já está cadastrado."
  - "Password should be at least N characters" → "A senha deve ter pelo menos N caracteres."
  - "leaked/compromised password" → "Esta senha é muito comum e foi vazada em outros sites. Escolha outra."
  - "The object exceeded the maximum allowed size" → "Arquivo maior que o limite permitido."
  - "Failed to fetch" / "NetworkError" → "Falha de conexão. Verifique sua internet e tente novamente."
  - "JWT expired" / 401 → "Sua sessão expirou. Entre novamente."
  - violação de chave estrangeira → "Este registro está vinculado a outros dados e não pode ser removido."
  - `not null violation` → "Preencha todos os campos obrigatórios."
- quando não reconhecer o padrão, devolve um texto genérico em português ("Não foi possível concluir a operação.") mantendo o detalhe técnico apenas no console, para não expor inglês ao usuário.

Depois, substituir as chamadas atuais de `toast.error(error.message)` (45 arquivos com toasts hoje; serão ajustadas as que exibem mensagem crua do backend) por `toast.error(mensagemErro(error))`, priorizando: clientes, orçamentos (2D e 3D), OS, usuários, financeiro, estoque, WhatsApp, login/cadastro/recuperação de senha.

Também padronizar os textos das telas de erro de rota (`errorComponent`) para português.

## Detalhes técnicos

- Novo arquivo: `src/lib/erros.ts` (dicionário de padrões + `mensagemErro`, sem dependências novas).
- `src/routes/_authenticated/clientes.index.tsx`: novo caminho de upload dentro da pasta do usuário, validações e uso do tradutor.
- Ajuste em massa dos `toast.error` para usar `mensagemErro`.
- Testes rápidos em `tests/` para o tradutor (padrões principais).
- Nenhuma alteração de política de segurança no banco é necessária.
