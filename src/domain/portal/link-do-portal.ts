/**
 * O link do portal do cliente: o que é, como se reconhece e como se manda.
 *
 * O cliente da gráfica não tem login. O que ele recebe, pelo WhatsApp, é um
 * endereço `/publico/<token>` que abre a lista das OS dele, as artes esperando
 * aprovação e os campos para mandar arquivo e comprovante.
 *
 * Antes daqui a página era DEMONSTRAÇÃO: qualquer token abria o mesmo cliente
 * fictício, e os botões respondiam "Recebemos sua solicitação" sem gravar nada.
 * O token era assinado com um segredo que, sem variável de ambiente, caía num
 * texto fixo escrito no código — quem lesse o repositório montava link válido.
 *
 * Agora o molde é o mesmo do link de aprovação de arte e do crachá da TV:
 *   o token  32 bytes aleatórios em base64url (43 caracteres), sorteados pelo
 *            BANCO na hora em que alguém da equipe gera o link na ficha do
 *            cliente; aparece em claro uma vez só, naquela resposta
 *   o banco  guarda só o SHA-256 dele, com validade e revogação
 *            (`portal_cliente_links`)
 *   a rota   de servidor recebe o token no cabeçalho `x-portal-token`, manda
 *            ao banco só o hash e devolve o jsonb de lista fechada que a
 *            função `portal_link_*` montou
 *
 * Não existe segredo de servidor para o link: não há o que vazar do código.
 * O que o servidor precisa é da chave de serviço (SUPABASE_SERVICE_ROLE_KEY),
 * e sem ela as rotas respondem 503 — nunca uma página de mentira.
 *
 * Este arquivo é domínio puro: não fala com banco nem com rede.
 */

/** O token viaja neste cabeçalho entre a página e a rota de servidor. */
export const CABECALHO_DO_LINK = "x-portal-token";

/** As rotas de servidor do portal por link. */
export const ROTAS_DO_PORTAL = {
  painel: "/api/portal/painel",
  envio: "/api/portal/envio",
  arte: "/api/portal/arte",
  arquivo: "/api/portal/arquivo",
  mensagem: "/api/portal/mensagem",
} as const;

/** A frase de quem chega com link que não abre — inválido, vencido ou cancelado. */
export const MENSAGEM_LINK_INVALIDO = "Link inválido ou vencido — peça um novo à Bex Print.";

/** Mesmo default e mesmo teto de `portal_gerar_link`. */
export const VALIDADE_PADRAO_DIAS = 30;
export const VALIDADE_MAXIMA_DIAS = 90;

/** 32 bytes em base64url, sem preenchimento: sempre 43 caracteres. */
const FORMATO_DO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function tokenBemFormado(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_DO_TOKEN.test(valor);
}

/** O que a pessoa digitou no campo de validade → o que o banco vai aceitar. */
export function validadeEmDias(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number.parseInt(String(valor ?? ""), 10);
  if (!Number.isFinite(n)) return VALIDADE_PADRAO_DIAS;
  return Math.min(VALIDADE_MAXIMA_DIAS, Math.max(1, Math.trunc(n)));
}

/** O endereço que vai para o cliente. */
export function urlDoPortal(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/publico/${token}`;
}

/** dd/mm/aaaa no fuso da gráfica — quem manda o link pode estar em outro. */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Belem" });
}

/** A mensagem pronta para o WhatsApp do cliente. */
export function mensagemDoLink(
  cliente: string | null | undefined,
  url: string,
  venceEm: string,
): string {
  const saudacao = cliente?.trim() ? `Olá, ${cliente.trim()}!` : "Olá!";
  return (
    `${saudacao} Este é o seu acompanhamento na Bex Print: por ele você vê seus pedidos, ` +
    `aprova a arte e manda arquivo ou comprovante. ${url} (vale até ${dataCurta(venceEm)})`
  );
}

/**
 * Link do wa.me para o telefone do cliente. wa.me só aceita dígitos com o DDI;
 * sem um celular plausível o botão não aparece, em vez de abrir o WhatsApp num
 * número vazio. Mesma regra do envio do link de aprovação de arte.
 */
export function linkDoWhatsapp(
  telefone: string | null | undefined,
  mensagem: string,
): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  const comDdi = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return `https://wa.me/${comDdi}?text=${encodeURIComponent(mensagem)}`;
}

/** Uma linha de `portal_links_do_cliente().links` — sem hash e sem token. */
export type LinkDoPortal = {
  id: string;
  criado_em: string;
  criado_por: string | null;
  expira_em: string;
  revogado_em: string | null;
  ultimo_acesso_em: string | null;
};

export type SituacaoDoLink = "ativo" | "vencido" | "revogado";

export function situacaoDoLink(
  link: Pick<LinkDoPortal, "expira_em" | "revogado_em">,
  agora: Date,
): SituacaoDoLink {
  if (link.revogado_em) return "revogado";
  const vence = Date.parse(link.expira_em);
  // Data ilegível não abre porta nenhuma: na dúvida, vencido.
  if (!Number.isFinite(vence) || vence <= agora.getTime()) return "vencido";
  return "ativo";
}

/** A frase da ficha do cliente sobre o link. */
export function textoDoLink(link: LinkDoPortal, agora: Date): string {
  switch (situacaoDoLink(link, agora)) {
    case "revogado":
      return `Cancelado em ${dataCurta(link.revogado_em)}`;
    case "vencido":
      return `Venceu em ${dataCurta(link.expira_em)}`;
    case "ativo": {
      const acesso = link.ultimo_acesso_em
        ? `último acesso do cliente em ${dataCurta(link.ultimo_acesso_em)}`
        : "o cliente ainda não abriu";
      return `Vale até ${dataCurta(link.expira_em)} · ${acesso}`;
    }
  }
}
