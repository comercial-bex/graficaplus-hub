/**
 * O que a tela de entrada confere ANTES de pedir ao servidor.
 *
 * Campo vazio ou e-mail digitado pela metade não vira requisição: a tela
 * aponta o campo e diz o que falta, embaixo dele. Se a senha está certa só o
 * servidor sabe — isso continua chegando pela mensagem de erro dele.
 */
export type ErrosDaEntrada = { email?: string; senha?: string };

/** "nome@dominio.algo": o bastante para pegar o que foi digitado pela metade. */
const PARECE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validarEntrada(email: string, senha: string): ErrosDaEntrada {
  const erros: ErrosDaEntrada = {};
  const limpo = email.trim();
  if (!limpo) erros.email = "Informe o e-mail.";
  else if (!PARECE_EMAIL.test(limpo)) {
    erros.email = "Confira o e-mail: falta o @ ou o final (como .com.br).";
  }
  if (!senha) erros.senha = "Informe a senha.";
  return erros;
}

export function temErro(erros: ErrosDaEntrada): boolean {
  return Boolean(erros.email || erros.senha);
}
