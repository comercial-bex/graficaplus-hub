import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth-context";

/**
 * Cria a conta de uma pessoa da equipe sem derrubar a sessão de quem está criando.
 *
 * `supabase.auth.signUp` no cliente principal AUTENTICA o usuário recém-criado e
 * substitui a sessão guardada no localStorage — o admin clicaria em "adicionar"
 * e apareceria logado como a pessoa que acabou de cadastrar. Por isso o cadastro
 * usa um cliente separado com persistSession: false: ele fala com o mesmo
 * projeto, mas não escreve sessão nenhuma no navegador.
 *
 * Criar usuário pelo painel de admin do Supabase exigiria a service role, que não
 * pode viver no navegador. Este caminho usa só a chave pública.
 */

type Resultado =
  | { ok: true; usuarioId: string; precisaConfirmarEmail: boolean }
  | { ok: false; erro: string };

function clienteSemSessao() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !chave) {
    // Mostra o NOME da variável ausente, nunca o valor.
    throw new Error(
      "Configuração do Supabase ausente (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).",
    );
  }
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function criarUsuarioComPapel(dados: {
  nome: string;
  email: string;
  senha: string;
  papel: AppRole;
}): Promise<Resultado> {
  const email = dados.email.trim().toLowerCase();

  // O Supabase devolve "sucesso" para e-mail já cadastrado (evita descobrir quem
  // tem conta), então o aviso útil precisa vir de uma checagem nossa antes.
  const { data: existente } = await supabase
    .from("usuarios")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existente) {
    return {
      ok: false,
      erro: "Já existe uma conta com este e-mail. Atribua o papel na lista abaixo.",
    };
  }

  let usuarioId: string;
  let precisaConfirmarEmail: boolean;
  try {
    const auth = clienteSemSessao();
    const { data, error } = await auth.auth.signUp({
      email,
      password: dados.senha,
      options: { data: { nome: dados.nome.trim() } },
    });
    if (error) return { ok: false, erro: error.message };
    if (!data.user) return { ok: false, erro: "O cadastro não retornou usuário." };
    usuarioId = data.user.id;
    // Sem sessão na resposta, o projeto exige confirmação por e-mail: a pessoa só
    // entra depois de clicar no link. Quem cadastrou precisa saber disso na hora.
    precisaConfirmarEmail = data.session === null;
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao criar a conta." };
  }

  // O papel é escrito pelo cliente autenticado (RLS de user_roles exige admin).
  // Sem papel a pessoa entra e não enxerga nada: o guarda de rota é deny-by-default.
  const { error: erroPapel } = await supabase
    .from("user_roles")
    .insert({ user_id: usuarioId, role: dados.papel });
  if (erroPapel) {
    return {
      ok: false,
      erro: `Conta criada, mas o papel não foi atribuído: ${erroPapel.message}. Atribua na lista abaixo.`,
    };
  }

  return { ok: true, usuarioId, precisaConfirmarEmail };
}

/**
 * Motivo para recusar a remoção de um papel, ou null quando pode remover.
 *
 * Papel some com um clique nesta tela. Sem estas duas travas dá para o admin
 * remover o próprio admin — e aí ninguém mais consegue atribuir papel a ninguém,
 * porque só admin escreve em user_roles. O sistema fica sem dono.
 */
export function motivoParaNaoRemoverPapel(params: {
  papel: string;
  usuarioId: string;
  usuarioLogadoId: string | null;
  totalDeAdmins: number;
}): string | null {
  if (params.papel !== "admin") return null;
  if (params.totalDeAdmins <= 1) {
    return "Este é o único administrador. Promova outra pessoa antes de remover.";
  }
  if (params.usuarioId === params.usuarioLogadoId) {
    return "Você perderia o acesso de administrador agora mesmo. Peça a outro admin.";
  }
  return null;
}

/**
 * Motivo para recusar a desativação de uma pessoa, ou null quando pode.
 *
 * Desativar bloqueia de verdade — has_permission e is_staff passaram a exigir
 * `usuarios.ativo`. Por isso as mesmas duas travas do papel valem aqui: desativar
 * o único admin, ou a si mesmo, deixa o sistema sem quem administre.
 */
export function motivoParaNaoDesativar(params: {
  usuarioId: string;
  usuarioLogadoId: string | null;
  ehAdmin: boolean;
  totalDeAdminsAtivos: number;
}): string | null {
  if (params.usuarioId === params.usuarioLogadoId) {
    return "Você sairia do sistema agora mesmo. Peça a outro administrador.";
  }
  if (params.ehAdmin && params.totalDeAdminsAtivos <= 1) {
    return "Este é o único administrador ativo. Promova outra pessoa antes de desativar.";
  }
  return null;
}

/**
 * Motivo para recusar a alteração de uma permissão de perfil, ou null.
 *
 * O perfil admin é a rede de segurança: se alguém tirar `usuarios.read` dele,
 * ninguém mais abre a tela que conserta permissão. O banco ainda deixaria (a
 * policy aceita has_role admin), mas a tela ficaria inalcançável — e é pela tela
 * que a pessoa vai tentar voltar atrás.
 */
export function motivoParaNaoMudarPermissao(papel: string): string | null {
  if (papel === "admin") {
    return "O perfil admin mantém todas as permissões — é o que garante voltar atrás se algo for removido por engano.";
  }
  return null;
}
