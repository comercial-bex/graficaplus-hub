/**
 * O combinado com o cliente no orçamento: quando entrega, como entrega, como
 * paga e o que ainda falta antes de mandar.
 *
 * Domínio puro (sem banco, sem rede). Duas regras daqui espelham funções do
 * banco e não podem divergir delas:
 *   - as parcelas seguem `converter_orcamento_em_os`: todas `round(total/n, 2)`
 *     e a última leva a sobra dos centavos, para a soma bater com o total;
 *   - `prazo` é o que a OS herda como data de entrega na conversão.
 */

import { dataLocal } from "@/domain/os/prazo";

/* ------------------------------------------------------------------------- */
/* Datas                                                                      */
/* ------------------------------------------------------------------------- */

/** "aaaa-mm-dd" a partir das partes LOCAIS — `toISOString()` volta um dia no Brasil. */
export function isoLocal(d: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Soma dias a uma data "aaaa-mm-dd" sem passar por UTC. */
export function somarDias(iso: string, dias: number): string {
  const d = dataLocal(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + dias);
  return isoLocal(d);
}

/** dd/mm/aaaa de uma data "aaaa-mm-dd" (ou de um timestamp). */
export function dataBR(valor: string | null | undefined): string | null {
  const d = dataLocal(valor ?? null);
  return d ? d.toLocaleDateString("pt-BR") : null;
}

/**
 * O que gravar quando a pessoa escolhe a data de entrega ao cliente.
 *
 * O orçamento tinha três datas lado a lado (início, prazo final, entrega
 * prometida) e quase sempre "prazo final" e "entrega prometida" são o mesmo
 * dia. Só que é o `prazo` que a OS herda — preencher só a entrega deixava a OS
 * sem data. Regra: o prazo ACOMPANHA a entrega enquanto estava vazio ou igual
 * a ela; se alguém separou as duas de propósito, o prazo fica como está.
 */
export function datasAoDefinirEntrega(
  novaEntrega: string | null,
  atual: { prazo: string | null; data_entrega_prometida: string | null },
): { data_entrega_prometida: string | null; prazo?: string | null } {
  const prazoAcompanha =
    !atual.prazo || atual.prazo === atual.data_entrega_prometida;
  return prazoAcompanha
    ? { data_entrega_prometida: novaEntrega, prazo: novaEntrega }
    : { data_entrega_prometida: novaEntrega };
}

/** Prazo da produção separado da entrega? (é o que decide mostrar o 2º campo) */
export function prazoSeparado(atual: { prazo: string | null; data_entrega_prometida: string | null }) {
  return !!atual.prazo && atual.prazo !== atual.data_entrega_prometida;
}

/**
 * Até quando o preço vale: dia da criação + validade_dias. `created_at` é
 * timestamptz em UTC — cortar a string pegaria o dia de Greenwich, e orçamento
 * feito depois das 21h em Macapá ganharia um dia de validade.
 */
export function validadeAte(criadoEm: string | null | undefined, validadeDias: number | null | undefined) {
  const criado = dataLocal(criadoEm ?? null);
  if (!criado || validadeDias == null) return null;
  return somarDias(isoLocal(criado), validadeDias);
}

/* ------------------------------------------------------------------------- */
/* Entrega                                                                    */
/* ------------------------------------------------------------------------- */

export type ModoDeEntrega = "retira" | "entrega" | "instalacao";

export function modoDeEntrega(precisaEntrega: boolean | null, precisaInstalacao: boolean | null): ModoDeEntrega {
  if (precisaInstalacao) return "instalacao";
  if (precisaEntrega) return "entrega";
  return "retira";
}

/** Os dois booleanos que `converter_orcamento_em_os` copia para a OS. */
export function camposDoModo(modo: ModoDeEntrega): { precisa_entrega: boolean; precisa_instalacao: boolean } {
  return {
    precisa_entrega: modo !== "retira",
    precisa_instalacao: modo === "instalacao",
  };
}

export const ROTULO_DO_MODO: Record<ModoDeEntrega, string> = {
  retira: "Cliente retira na empresa",
  entrega: "Entregar no endereço",
  instalacao: "Entregar e instalar",
};

/** O texto do endereço guardado em `endereco_entrega` (jsonb), qualquer que seja a forma. */
export function textoDoEndereco(endereco: unknown): string {
  if (!endereco || typeof endereco !== "object") return "";
  const e = endereco as Record<string, unknown>;
  if (typeof e.descricao === "string" && e.descricao.trim()) return e.descricao.trim();
  return [e.logradouro, e.numero, e.bairro, e.cidade, e.estado, e.cep]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(", ");
}

/** Endereço do cadastro do cliente numa linha, para "usar o endereço do cliente". */
export function enderecoDoCliente(c: {
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}): string {
  const cidade = [c.cidade, c.estado].filter(Boolean).join(" - ");
  return [c.endereco, c.bairro, cidade, c.cep ? `CEP ${c.cep}` : null]
    .filter((v): v is string => !!v && v.trim() !== "")
    .join(", ");
}

/* ------------------------------------------------------------------------- */
/* Pagamento                                                                  */
/* ------------------------------------------------------------------------- */

export const FORMAS_DE_PAGAMENTO = [
  "A faturar",
  "PIX",
  "Dinheiro",
  "Cartão de crédito",
  "Cartão de débito",
  "Boleto",
  "Transferência bancária",
] as const;

export type CondicaoDePagamento = {
  forma?: string | null;
  parcelas?: number | null;
  intervalo_dias?: number | null;
  primeiro_vencimento?: string | null;
};

export function lerCondicao(cru: unknown): CondicaoDePagamento {
  if (!cru || typeof cru !== "object") return {};
  return cru as CondicaoDePagamento;
}

export type Parcela = { numero: number; valor: number; vencimento: string | null };

/**
 * As parcelas, com a MESMA conta da conversão em OS: todas iguais e a última
 * com a sobra dos centavos. Sem primeiro vencimento, a conversão vence a
 * primeira no dia em que vira OS — aqui a data fica nula.
 */
export function parcelasDoOrcamento(total: number, condicao: CondicaoDePagamento): Parcela[] {
  const n = Math.max(1, Math.round(Number(condicao.parcelas ?? 1) || 1));
  const intervalo = Math.max(0, Math.round(Number(condicao.intervalo_dias ?? 30) || 0));
  const valor = Math.round((total / n) * 100) / 100;
  const ultima = Math.round((total - valor * (n - 1)) * 100) / 100;
  const primeiro = typeof condicao.primeiro_vencimento === "string" && condicao.primeiro_vencimento
    ? condicao.primeiro_vencimento
    : null;
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    valor: i === n - 1 ? ultima : valor,
    vencimento: primeiro ? somarDias(primeiro, intervalo * i) : null,
  }));
}

/* ------------------------------------------------------------------------- */
/* O que falta antes de mandar ao cliente                                     */
/* ------------------------------------------------------------------------- */

export function pendenciasParaEnviar(o: {
  temClienteOuContato: boolean;
  dataEntrega: string | null;
  verPreco: boolean;
  temCondicao: boolean;
  itens: { arquivo_id: string | null }[];
}): string[] {
  const falta: string[] = [];
  if (!o.temClienteOuContato) falta.push("cliente ou contato");
  if (!o.dataEntrega) falta.push("data de entrega");
  if (o.verPreco && !o.temCondicao) falta.push("condição de pagamento");
  if (o.itens.length === 0) falta.push("itens");
  const semArte = o.itens.filter((i) => !i.arquivo_id).length;
  if (semArte === 1) falta.push("layout em 1 item");
  else if (semArte > 1) falta.push(`layout em ${semArte} itens`);
  return falta;
}

/* ------------------------------------------------------------------------- */
/* Dinheiro                                                                   */
/* ------------------------------------------------------------------------- */

/** R$ 1.234,56 — "R$ 0.00" com ponto era o que a tela mostrava. */
export function brl(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** 22,050 m² */
export function m2(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m²`;
}
