/**
 * O cadastro curto do convite (03/11/2026) e o que fica para o primeiro acesso.
 *
 * Decisão do dono: a página do convite pede só nome, WhatsApp e e-mail. A senha
 * é provisória, gerada aqui, e vai pelo WhatsApp junto com o link de entrada —
 * a pessoa não precisa inventar senha num formulário de nove campos dentro do
 * Instagram. O resto (ramo, comprovação, cidade, documento) e a senha
 * definitiva são pedidos UMA vez, no primeiro acesso ao painel, antes de
 * qualquer tela.
 *
 * Tudo aqui é puro: a página e a tela de primeiro acesso só chamam.
 */

/** Máscara (XX) XXXXX-XXXX / (XX) XXXX-XXXX. */
export function mascaraWhatsapp(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const ddd = d.slice(0, 2), r = d.slice(2);
  if (r.length <= 4) return `(${ddd}) ${r}`;
  if (d.length === 11) return `(${ddd}) ${r.slice(0, 5)}-${r.slice(5)}`;
  return `(${ddd}) ${r.slice(0, 4)}-${r.slice(4)}`;
}

export function whatsappValido(v: string): boolean {
  const n = v.replace(/\D/g, "").length;
  return n === 10 || n === 11;
}

export function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/**
 * Letras e números que não se confundem lidos num WhatsApp no celular: sem 0/O,
 * 1/I/l. Oito caracteres, maiúsculos — dá para digitar sem trocar de teclado.
 */
export const ALFABETO_DA_SENHA = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const TAMANHO_DA_SENHA_PROVISORIA = 8;

/** Senha provisória de 8 caracteres. `aleatorio` é injetável para o teste. */
export function gerarSenhaProvisoria(
  aleatorio: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n)),
): string {
  const buf = aleatorio(TAMANHO_DA_SENHA_PROVISORIA);
  return Array.from(buf, (n) => ALFABETO_DA_SENHA[n % ALFABETO_DA_SENHA.length]).join("");
}

export type CadastroRapido = { nome: string; telefone: string; email: string };

/** O que falta no formulário curto, em português claro; `null` quando pode enviar. */
export function validarCadastroRapido(c: CadastroRapido): { campo: keyof CadastroRapido; mensagem: string } | null {
  if (c.nome.trim().length < 2) return { campo: "nome", mensagem: "Diga o seu nome ou o da sua empresa." };
  if (!whatsappValido(c.telefone)) return { campo: "telefone", mensagem: "Informe um WhatsApp válido com DDD: (XX) XXXXX-XXXX." };
  if (!emailValido(c.email)) return { campo: "email", mensagem: "Confira o e-mail: é por ele que você entra no painel." };
  return null;
}

/** Marca gravada nos dados da conta no cadastro curto; a tela de primeiro acesso a apaga. */
export const CHAVE_CADASTRO_PENDENTE = "cadastro_pendente";

/** A conta ainda não passou pelo primeiro acesso (senha provisória, dados por completar). */
export function cadastroPendente(metadados: Record<string, unknown> | null | undefined): boolean {
  return metadados?.[CHAVE_CADASTRO_PENDENTE] === true;
}

export type Complemento = {
  ramo: string;
  ramoOutro: string;
  comprovacao: string;
  novaSenha: string;
};

/** O que falta na tela de primeiro acesso; `null` quando pode concluir. */
export function validarComplemento(c: Complemento, ramosValidos: readonly string[]): { campo: keyof Complemento; mensagem: string } | null {
  if (c.novaSenha.length < 8) return { campo: "novaSenha", mensagem: "Crie uma senha com pelo menos 8 caracteres." };
  if (!/[0-9]/.test(c.novaSenha) || !/[A-Za-z]/.test(c.novaSenha))
    return { campo: "novaSenha", mensagem: "Misture letras e números na senha." };
  if (!ramosValidos.includes(c.ramo)) return { campo: "ramo", mensagem: "Escolha o seu ramo de atuação." };
  if (c.ramo === "outro" && !c.ramoOutro.trim()) return { campo: "ramoOutro", mensagem: "Diga qual é o seu ramo." };
  if (c.comprovacao.trim().length < 3) return { campo: "comprovacao", mensagem: "Informe o Instagram ou site do seu negócio." };
  return null;
}

/**
 * O que a tela diz quando o auth recusa a troca de senha do primeiro acesso.
 *
 * O caso mais comum (03/11/2026, o primeiro parceiro real a se cadastrar): a
 * pessoa copia a senha provisória do WhatsApp para o campo "Crie a sua senha".
 * Ela passa na regra da tela (8 caracteres, letras e números) e o auth recusa
 * com `same_password`. O texto antigo ("precisa ser diferente da provisória")
 * aparecia como aviso no canto da tela, longe do campo, sem dizer o que fazer.
 *
 * O código do auth vem antes do texto em inglês, que muda de versão para
 * versão. `limpar` diz se a tela deve esvaziar o campo da senha: quando a
 * senha foi recusada, deixar o valor ali só convida a enviar o mesmo de novo.
 */
export type ErroDaTrocaDeSenha = { mensagem: string; limpar: boolean; sairDaConta: boolean };

export function erroDaTrocaDeSenha(erro: { code?: string | null; message?: string | null }): ErroDaTrocaDeSenha | null {
  const codigo = (erro.code ?? "").toLowerCase();
  const texto = (erro.message ?? "").toLowerCase();
  if (codigo === "same_password" || /different from the old password|should be different|same password/.test(texto))
    return {
      mensagem: "Essa é a mesma senha da sua conta (a provisória do WhatsApp). Crie uma senha nova, só sua.",
      limpar: true,
      sairDaConta: false,
    };
  if (codigo === "weak_password" || /weak|pwned|leaked|breach|at least|characters/.test(texto))
    return {
      mensagem: "Escolha uma senha mais forte: 8 ou mais caracteres, misturando letras e números, e que não seja comum.",
      limpar: true,
      sairDaConta: false,
    };
  if (codigo === "session_not_found" || codigo === "session_expired" || /session (missing|not found|expired)|jwt expired/.test(texto))
    return {
      mensagem: "Sua sessão expirou. Entre de novo com o seu e-mail e a senha provisória do WhatsApp.",
      limpar: false,
      sairDaConta: true,
    };
  return null;
}
