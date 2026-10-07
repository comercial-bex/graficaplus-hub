import type { Carrinho } from "@/domain/catalogo/carrinho";
import { PRECO_POR, ehModalidade, type Modalidade } from "@/domain/catalogo/modalidades";
import { precoEmReais } from "@/domain/catalogo/preco-de-venda";

/**
 * O pedido de cotação do cliente, pelo link da vitrine.
 *
 * O cliente monta o carrinho no celular e toca "Pedir cotação": o pedido fica
 * REGISTRADO no banco (`catalogo_link_pedir_cotacao`, pela rota
 * /api/catalogo/cotacao) e em seguida abre o WhatsApp da gráfica com a lista
 * pronta. Duas pontas para o mesmo pedido, de propósito: o registro é o que a
 * equipe vê na tela mesmo que o WhatsApp não abra; a mensagem é o que o
 * cliente vê sair. Nenhuma mensagem é mandada AO cliente por aqui — quem fala
 * com ele é a equipe, pelo WhatsApp dela.
 *
 * A lista de chaves é FECHADA nas duas direções: o que o navegador manda
 * (`pedidoDeCotacaoFechado`, usado pelo servidor antes de ir ao banco) e o que
 * o banco guarda (a função reconstrói o jsonb campo a campo).
 *
 * Domínio puro.
 */

export const ROTA_DA_COTACAO = "/api/catalogo/cotacao";

export const LIMITE_DE_ITENS_DA_COTACAO = 50;

export type ItemDaCotacao = { codigo: string; modalidade: Modalidade | null; quantidade: number };

export type PedidoDeCotacao = { nome: string; telefone: string; itens: ItemDaCotacao[] };

/** As únicas chaves do pedido — o teste de vazamento e o servidor leem esta lista. */
export const CHAVES_DA_COTACAO = {
  pedido: ["nome", "telefone", "itens"],
  item: ["codigo", "modalidade", "quantidade"],
} as const;

const CODIGO_BX = /^BX-[0-9]{4,7}$/;

/** Só os dígitos, 10 a 13 (DDD + número, com ou sem o 55); `null` se não parece telefone. */
export function telefoneBemFormado(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 13 ? digitos : null;
}

export function nomeBemFormado(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.replace(/\s+/g, " ").trim();
  return limpo.length >= 2 && limpo.length <= 120 ? limpo : null;
}

/**
 * O corpo que chegou vira um pedido com a forma combinada, ou `null`. Chave a
 * mais é ignorada; item fora do formato derruba o pedido inteiro (a pessoa vê
 * "pedido inválido" e refaz, em vez de a gráfica receber metade).
 */
export function pedidoDeCotacaoFechado(valor: unknown): PedidoDeCotacao | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const v = valor as Record<string, unknown>;
  const nome = nomeBemFormado(v.nome);
  const telefone = telefoneBemFormado(v.telefone);
  if (!nome || !telefone || !Array.isArray(v.itens)) return null;
  if (v.itens.length < 1 || v.itens.length > LIMITE_DE_ITENS_DA_COTACAO) return null;
  const itens: ItemDaCotacao[] = [];
  for (const bruto of v.itens) {
    if (!bruto || typeof bruto !== "object") return null;
    const i = bruto as Record<string, unknown>;
    const codigo = typeof i.codigo === "string" ? i.codigo.trim().toUpperCase() : "";
    const quantidade = typeof i.quantidade === "number" ? i.quantidade : Number(i.quantidade);
    if (!CODIGO_BX.test(codigo)) return null;
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 1_000_000) return null;
    if (i.modalidade != null && !ehModalidade(i.modalidade)) return null;
    itens.push({
      codigo,
      modalidade: ehModalidade(i.modalidade) ? i.modalidade : null,
      quantidade,
    });
  }
  return { nome, telefone, itens };
}

/** O pedido a partir do carrinho do cliente. */
export function pedidoDoCarrinho(
  nome: string,
  telefone: string,
  carrinho: Carrinho,
): PedidoDeCotacao {
  return {
    nome: nome.replace(/\s+/g, " ").trim(),
    telefone: telefone.replace(/\D/g, ""),
    itens: carrinho.map((l) => ({
      codigo: l.codigo,
      modalidade: l.modalidade,
      quantidade: l.quantidade,
    })),
  };
}

const PECAS = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/**
 * A mensagem que o cliente manda no WhatsApp, com os códigos BX, a opção e a
 * quantidade de cada item — e o preço quando o link mostrou um.
 */
export function mensagemDaCotacao(titulo: string, nome: string, carrinho: Carrinho): string {
  const linhas = carrinho.map((l) => {
    const opcao = l.modalidade === "valor_unico" ? "" : ` (${l.rotulo})`;
    const preco =
      l.preco != null
        ? ` — ${precoEmReais(l.preco)} ${PRECO_POR[l.unidade_preco]}`
        : " — sob consulta";
    return `• ${l.codigo} — ${l.nome}${opcao}: ${PECAS.format(l.quantidade)} peças${preco}`;
  });
  return [
    `Olá! Sou ${nome.trim()}. Vi o catálogo "${titulo}" e quero uma cotação destes itens:`,
    ...linhas,
    "Pode me confirmar valores e prazo?",
  ].join("\n");
}

export type RespostaDaCotacao =
  | { estado: "registrado" }
  | { estado: "bloqueado"; libera_s: number }
  | { estado: "pedido_invalido"; mensagem: string }
  | { estado: "link_invalido" }
  | { estado: "fora_do_ar" };

/** Quanto tempo falta, em texto de gente. */
export function esperaEmTexto(segundos: number): string {
  const s = Math.max(1, Math.ceil(segundos));
  if (s < 60) return `${s} segundos`;
  const m = Math.ceil(s / 60);
  return m === 1 ? "1 minuto" : `${m} minutos`;
}
