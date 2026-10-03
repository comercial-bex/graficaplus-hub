/**
 * Regras do "Meu perfil": o que se confere antes de gravar em `usuarios`, no
 * bucket `avatares` e no Auth.
 *
 * O que cada campo faz no sistema (medido em 02/10/2026, para a tela não
 * prometer o que não acontece):
 *   nome       sai no orçamento enviado ao cliente (campo do vendedor, lido em
 *              `usuarios` pelo gerador de PDF) e, só o primeiro nome, no
 *              painel do parceiro (`parceiro_painel`).
 *   telefone   aparece para o admin na lista de Usuários. Nenhuma função manda
 *              mensagem para ele — o painel do parceiro mostra o telefone da
 *              gráfica, nunca o pessoal.
 *   foto       aparece nos cartões do Quadro de produção em que a pessoa é
 *              responsável e na lista de Usuários.
 */

import { chaveWhatsApp, formatarTelefone, recebeWhatsApp } from "@/domain/documentos";

/** O mesmo limite da logo de cliente, que já sobe para o mesmo bucket. */
export const TAMANHO_MAXIMO_DA_FOTO = 2 * 1024 * 1024;

/** O mesmo mínimo da tela de redefinir senha. */
export const TAMANHO_MINIMO_DA_SENHA = 8;

/**
 * O bucket `avatares` é privado: a foto é exibida por URL assinada. É o
 * mesmo prazo que a logo do cliente usa (cinco anos), porque a URL fica
 * gravada em `usuarios.avatar_url` e é lida direto pelo Quadro de produção.
 */
export const VALIDADE_DO_LINK_DA_FOTO = 60 * 60 * 24 * 365 * 5;

export function conferirDados(d: { nome: string; telefone: string }): string[] {
  const problemas: string[] = [];
  if (!d.nome.trim()) {
    problemas.push("Informe seu nome: é ele que sai no orçamento enviado ao cliente.");
  }
  if (d.telefone.trim()) {
    const chave = chaveWhatsApp(d.telefone);
    if (!chave || (chave.length !== 10 && chave.length !== 11)) {
      problemas.push("Confira o telefone: DDD e número, com 10 ou 11 dígitos.");
    }
  }
  return problemas;
}

/**
 * Como o telefone é gravado: só dígitos, na régua canônica de `chaveWhatsApp`
 * — os três telefones já gravados em `usuarios` estão assim (11 dígitos).
 */
export function telefoneParaGravar(texto: string): string | null {
  return texto.trim() ? chaveWhatsApp(texto) : null;
}

export function telefoneParaMostrar(gravado: string | null | undefined): string {
  return gravado ? formatarTelefone(gravado) : "";
}

/** Fixo é aceito, mas a pessoa fica sabendo que ali não chega WhatsApp. */
export function avisoDoTelefone(texto: string): string | null {
  if (!texto.trim()) return null;
  const chave = chaveWhatsApp(texto);
  if (!chave || chave.length !== 10) return null;
  return recebeWhatsApp(texto) ? null : "Número fixo: não recebe WhatsApp.";
}

export function conferirSenha(s: { atual: string; nova: string; confirmacao: string }): string[] {
  const problemas: string[] = [];
  if (!s.atual) problemas.push("Digite sua senha atual.");
  if (s.nova.length < TAMANHO_MINIMO_DA_SENHA) {
    problemas.push(`A nova senha precisa de pelo menos ${TAMANHO_MINIMO_DA_SENHA} caracteres.`);
  } else if (s.nova !== s.confirmacao) {
    problemas.push("A confirmação não é igual à nova senha.");
  } else if (s.atual && s.nova === s.atual) {
    problemas.push("A nova senha precisa ser diferente da atual.");
  }
  return problemas;
}

export function conferirFoto(arquivo: { type: string; size: number }): string | null {
  if (!arquivo.type.startsWith("image/")) return "Envie uma imagem (PNG, JPG ou WEBP).";
  if (arquivo.size > TAMANHO_MAXIMO_DA_FOTO) return "A foto pode ter até 2 MB.";
  return null;
}

/**
 * Onde a foto mora no bucket. A policy de gravação do `avatares` só aceita
 * arquivo dentro da pasta com o id de quem está logado — por isso o caminho
 * começa pelo id. A subpasta `perfil/` separa das logos de cliente, que a
 * mesma pessoa sobe em `<id>/clientes/`.
 */
export function caminhoDaFoto(usuarioId: string, nomeDoArquivo: string, id: string): string {
  const bruto = (nomeDoArquivo.split(".").pop() ?? "").toLowerCase();
  const extensao = /^[a-z0-9]{1,5}$/.test(bruto) && bruto !== nomeDoArquivo.toLowerCase() ? bruto : "png";
  return `${usuarioId}/perfil/${id}.${extensao}`;
}

/** Duas letras para o lugar da foto: do nome; sem nome, do e-mail. */
export function iniciais(nome: string | null | undefined, email: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 2).toUpperCase();
}

/**
 * O Auth pode exigir confirmação por e-mail para trocar a senha (opção de
 * "troca segura" do projeto). A tela então oferece o link por e-mail em vez de
 * repetir o erro em inglês.
 */
export function pedeReautenticacao(erro: unknown): boolean {
  const texto =
    erro instanceof Error
      ? erro.message
      : typeof erro === "object" && erro !== null && "message" in erro
        ? String((erro as { message: unknown }).message)
        : String(erro ?? "");
  return /reauthenticat/i.test(texto);
}
