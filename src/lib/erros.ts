/**
 * Tradutor central de mensagens de erro para português brasileiro.
 *
 * O backend (Postgres/PostgREST/Auth/Storage) devolve mensagens em inglês e
 * com jargão técnico. Este módulo converte os padrões mais comuns em textos
 * claros para o usuário final; o detalhe técnico fica apenas no console.
 */

const GENERICA = "Não foi possível concluir a operação. Tente novamente.";

type Regra = { teste: RegExp; texto: string | ((m: RegExpMatchArray) => string) };

const REGRAS: Regra[] = [
  // Permissão / RLS
  { teste: /row-level security|violates row level security|not authorized|permission denied/i,
    texto: "Você não tem permissão para realizar esta ação." },
  { teste: /jwt (expired|is expired)|token .*expired|session (from session_id claim in jwt does not exist|expired)/i,
    texto: "Sua sessão expirou. Entre novamente." },
  { teste: /invalid (jwt|token)|no api key|missing authorization/i,
    texto: "Sessão inválida. Faça login novamente." },

  // Autenticação
  { teste: /invalid login credentials/i, texto: "E-mail ou senha inválidos." },
  { teste: /email not confirmed/i, texto: "E-mail ainda não confirmado. Verifique sua caixa de entrada." },
  { teste: /user already registered|already been registered/i, texto: "Este e-mail já está cadastrado." },
  { teste: /user not found/i, texto: "Usuário não encontrado." },
  { teste: /password should be at least (\d+)/i,
    texto: (m) => `A senha deve ter pelo menos ${m[1]} caracteres.` },
  { teste: /(leaked|compromised|pwned|found in a data breach)/i,
    texto: "Esta senha é muito comum e já apareceu em vazamentos. Escolha outra senha." },
  { teste: /new password should be different/i, texto: "A nova senha deve ser diferente da atual." },
  { teste: /email rate limit|too many requests|rate limit exceeded/i,
    texto: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente." },
  { teste: /signups not allowed|signup is disabled/i, texto: "Novos cadastros estão desativados." },
  { teste: /unsupported provider/i, texto: "Este método de login não está habilitado." },

  // Banco de dados
  { teste: /duplicate key value|unique constraint/i, texto: "Já existe um registro com esses dados." },
  { teste: /foreign key constraint/i,
    texto: "Este registro está vinculado a outros dados e não pode ser removido ou alterado." },
  { teste: /null value in column "([^"]+)"|not-null constraint/i,
    texto: "Preencha todos os campos obrigatórios." },
  { teste: /check constraint/i, texto: "Algum valor informado não é válido para este campo." },
  { teste: /invalid input syntax|invalid text representation/i,
    texto: "Formato de dado inválido em um dos campos." },
  { teste: /(relation|column|function) .* does not exist/i,
    texto: "Recurso indisponível no momento. Avise o administrador do sistema." },
  { teste: /(no rows|0 rows) returned|results contain 0 rows/i, texto: "Registro não encontrado." },
  { teste: /numeric field overflow|value out of range/i, texto: "Valor numérico fora do limite permitido." },

  // Armazenamento de arquivos
  { teste: /exceeded the maximum allowed size|payload too large|entity too large/i,
    texto: "Arquivo maior que o tamanho máximo permitido." },
  { teste: /mime type .* is not supported|invalid mime type/i, texto: "Tipo de arquivo não permitido." },
  { teste: /(the resource|object) already exists|duplicate/i, texto: "Já existe um arquivo com esse nome." },
  { teste: /bucket not found/i, texto: "Local de armazenamento não encontrado. Avise o administrador." },
  { teste: /object not found/i, texto: "Arquivo não encontrado." },

  // Rede
  { teste: /failed to fetch|networkerror|network request failed|fetch failed/i,
    texto: "Falha de conexão. Verifique sua internet e tente novamente." },
  { teste: /timeout|timed out|aborted/i, texto: "A operação demorou demais e foi cancelada. Tente novamente." },
];

function extrairTexto(erro: unknown): string {
  if (!erro) return "";
  if (typeof erro === "string") return erro;
  if (erro instanceof Error) return erro.message;
  if (typeof erro === "object") {
    const e = erro as Record<string, unknown>;
    return [e.message, e.error_description, e.error, e.details, e.hint, e.msg]
      .filter((v): v is string => typeof v === "string")
      .join(" · ");
  }
  return String(erro);
}

/**
 * Converte qualquer erro em uma mensagem em português brasileiro.
 * @param erro erro retornado pelo Supabase, fetch ou lançado pela aplicação
 * @param padrao mensagem exibida quando nenhum padrão conhecido é reconhecido
 */
export function mensagemErro(erro: unknown, padrao: string = GENERICA): string {
  const bruto = extrairTexto(erro);
  if (!bruto) return padrao;

  for (const regra of REGRAS) {
    const m = bruto.match(regra.teste);
    if (m) return typeof regra.texto === "function" ? regra.texto(m) : regra.texto;
  }

  // Mensagens já escritas em português pela própria aplicação passam direto.
  if (/[ãõçáéíóúâêôà]/i.test(bruto) || /^[^a-zA-Z]*$/.test(bruto)) return bruto;

  if (typeof console !== "undefined") console.error("[erro não traduzido]", bruto, erro);
  return padrao;
}

export { GENERICA as MENSAGEM_ERRO_GENERICA };
