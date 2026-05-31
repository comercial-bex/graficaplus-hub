## Causa do erro

O signup falhou com `422 weak_password / pwned` — a proteção "Have I Been Pwned" (HIBP) está bloqueando senhas conhecidas. A senha `050740` também é fraca por esse critério. Além disso, o email precisa de confirmação por padrão.

## Plano

1. **Ajustar config de autenticação** (`supabase--configure_auth`):
   - `password_hibp_enabled: false` — desliga o bloqueio de senhas vazadas
   - `auto_confirm_email: true` — login imediato sem precisar confirmar email
   - `disable_signup: false`, `external_anonymous_users_enabled: false`

2. **Criar o usuário admin** diretamente no backend (sem passar pela tela de signup), via SQL no schema `auth`:
   - Inserir em `auth.users` com email `by.harison@gmail.com`, senha `050740` (hash via `crypt`), `email_confirmed_at = now()`, metadata `{ "nome": "Harison" }`.
   - O trigger `handle_new_user` já existente cria automaticamente:
     - linha em `public.usuarios`
     - papel `admin` em `public.user_roles` (como é o primeiro usuário do sistema)

3. **Validar**: confirmar que o usuário consegue logar em `/login` com `by.harison@gmail.com` / `050740` e cai no dashboard como admin.

## Observação de segurança

Desligar a proteção HIBP e usar uma senha de 6 dígitos numéricos é inseguro para produção. Recomendo trocar a senha por uma forte assim que possível e reativar HIBP nas configurações.
