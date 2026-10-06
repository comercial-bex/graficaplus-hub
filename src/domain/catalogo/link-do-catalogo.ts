import { dataCurta } from "@/domain/portal/link-do-portal";

/**
 * O link da vitrine que o cliente recebe: o que é, como se reconhece e como se
 * manda.
 *
 * DECISÃO DO DONO (05/10/2026): o cliente vê foto, nome, especificação, o
 * código Bex Print (BX-0001…) e o preço de venda — e NÃO vê o nome nem o código
 * do fornecedor, para não ir comprar direto da fábrica. Item sem foto não
 * aparece.
 *
 * O molde é o do portal do cliente (`domain/portal/link-do-portal.ts`):
 *   o token  32 bytes aleatórios em base64url (43 caracteres), sorteados pelo
 *            BANCO em `catalogo_gerar_link`; em claro uma vez só, na resposta
 *   o banco  guarda só o SHA-256, com validade (até 90 dias) e cancelamento
 *   a rota   de servidor recebe o token no cabeçalho `x-catalogo-token`, manda
 *            ao banco só o hash e devolve o jsonb de lista fechada de
 *            `catalogo_link_abrir`
 *
 * Domínio puro.
 */

/** O token viaja neste cabeçalho entre a página e a rota de servidor. */
export const CABECALHO_DO_CATALOGO = "x-catalogo-token";

/** A rota de servidor da vitrine. */
export const ROTA_DA_VITRINE = "/api/catalogo/vitrine";

/** A frase de quem chega com link que não abre — inválido, vencido ou cancelado. */
export const MENSAGEM_VITRINE_INVALIDA =
  "Este catálogo não está mais disponível — o link venceu ou foi cancelado. Peça um novo à Bex Print.";

/** Mesmo teto de `catalogo_gerar_link`. */
export const VALIDADE_PADRAO_DIAS = 30;
export const VALIDADE_MAXIMA_DIAS = 90;

/** 32 bytes em base64url, sem preenchimento: sempre 43 caracteres. Sem ponto: nunca casa com foto. */
const FORMATO_DO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function tokenDoCatalogoBemFormado(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_DO_TOKEN.test(valor);
}

export function validadeDoLink(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number.parseInt(String(valor ?? ""), 10);
  if (!Number.isFinite(n)) return VALIDADE_PADRAO_DIAS;
  return Math.min(VALIDADE_MAXIMA_DIAS, Math.max(1, Math.trunc(n)));
}

/** O endereço que vai para o cliente. */
export function urlDaVitrine(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/catalogo/${token}`;
}

/** A mensagem pronta para mandar o link ao cliente. */
export function mensagemDoLinkDaVitrine(
  cliente: string | null | undefined,
  url: string,
  venceEm: string,
): string {
  const saudacao = cliente?.trim() ? `Olá, ${cliente.trim()}!` : "Olá!";
  return (
    `${saudacao} Separamos alguns produtos da Bex Print para você, com foto e preço: ${url} ` +
    `(vale até ${dataCurta(venceEm)}). Escolha o que gostou e responda por aqui.`
  );
}

/** Só os dígitos, com o 55 na frente; `null` se não parece um telefone. */
function soDigitosComDdi(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 13) return null;
  return digitos.startsWith("55") && digitos.length >= 12 ? digitos : `55${digitos}`;
}

/**
 * O WhatsApp da gráfica a partir de `empresa_config.telefones`, que é um texto
 * livre ("(96) 99113-6169 · (96) 99111-6169"). Vale o PRIMEIRO celular
 * plausível (9 dígitos depois do DDD); sem celular, o primeiro telefone que
 * parece telefone; sem nenhum, `null` — e o botão não aparece, em vez de abrir
 * o WhatsApp num número vazio.
 */
export function whatsappDaEmpresa(telefones: string | null | undefined): string | null {
  if (!telefones) return null;
  const candidatos = telefones
    .split(/[·•|,;/]|\s+e\s+|\s+ou\s+/i)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(soDigitosComDdi)
    .filter((t): t is string => t !== null);
  const celular = candidatos.find((t) => t.length === 13 && t[4] === "9");
  return celular ?? candidatos[0] ?? null;
}

export type EscolhaDoCliente = { codigo: string; nome: string; opcao: string | null };

/** O pedido de orçamento que o cliente manda pelo WhatsApp, com os códigos BX. */
export function mensagemDoPedido(titulo: string, escolhas: EscolhaDoCliente[]): string {
  const linhas = escolhas.map(
    (e) => `• ${e.codigo} — ${e.nome}${e.opcao ? ` (${e.opcao})` : ""}`,
  );
  return [
    `Olá! Vi o catálogo "${titulo}" e quero um orçamento destes itens:`,
    ...linhas,
    "Quantidade de cada um: ",
  ].join("\n");
}

export function linkDoWhatsapp(numero: string, mensagem: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

/** Uma linha de `catalogo_links().links` — sem hash e sem token. */
export type LinkDaVitrine = {
  id: string;
  titulo: string;
  cliente_id: string | null;
  cliente: string | null;
  criado_em: string;
  criado_por: string | null;
  expira_em: string;
  revogado_em: string | null;
  ultimo_acesso_em: string | null;
  acessos: number;
  itens: number;
};

export type SituacaoDaVitrine = "ativo" | "vencido" | "cancelado";

export function situacaoDaVitrine(
  link: Pick<LinkDaVitrine, "expira_em" | "revogado_em">,
  agora: Date,
): SituacaoDaVitrine {
  if (link.revogado_em) return "cancelado";
  const vence = Date.parse(link.expira_em);
  // Data ilegível não abre porta nenhuma: na dúvida, vencido.
  if (!Number.isFinite(vence) || vence <= agora.getTime()) return "vencido";
  return "ativo";
}

/** A frase da lista de links. */
export function textoDaVitrine(link: LinkDaVitrine, agora: Date): string {
  switch (situacaoDaVitrine(link, agora)) {
    case "cancelado":
      return `Cancelado em ${dataCurta(link.revogado_em)}`;
    case "vencido":
      return `Venceu em ${dataCurta(link.expira_em)}`;
    case "ativo": {
      const acesso = link.ultimo_acesso_em
        ? `aberto ${link.acessos === 1 ? "1 vez" : `${link.acessos} vezes`}, a última em ${dataCurta(link.ultimo_acesso_em)}`
        : "o cliente ainda não abriu";
      return `Vale até ${dataCurta(link.expira_em)} · ${acesso}`;
    }
  }
}
