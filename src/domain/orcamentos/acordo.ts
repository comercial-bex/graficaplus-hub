/**
 * O combinado com o cliente no orçamento: quando entrega, como entrega, como
 * paga e o que ainda falta antes de mandar.
 *
 * Domínio puro (sem banco, sem rede). Duas regras daqui espelham funções do
 * banco e não podem divergir delas:
 *   - as parcelas seguem `converter_orcamento_em_os`: todas `round(total/n, 2)`
 *     e a última leva a sobra dos centavos, para a soma bater com o total —
 *     em centavos inteiros (`valoresDasParcelas`), que é o que faz bater;
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

/** Soma dias ÚTEIS (segunda a sexta) a uma data "aaaa-mm-dd"; sábado e domingo não contam. */
export function somarDiasUteis(iso: string, dias: number): string {
  const d = dataLocal(iso);
  if (!d) return iso;
  let faltam = Math.max(0, Math.round(dias));
  while (faltam > 0) {
    d.setDate(d.getDate() + 1);
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) faltam -= 1;
  }
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

/**
 * Como o pagamento se divide (decisão do dono, 28/10/2026). Antes só existia "n
 * parcelas iguais"; a condição geral da gráfica (50% na aprovação, 50% na
 * entrega) não tinha como ser gravada, e o Pix do sinal pedia 50% enquanto a
 * conta a receber nascia com UMA parcela do total. Agora:
 *   a_vista        100% na aprovação;
 *   metade_metade  50% na aprovação + 50% na entrega (o padrão da casa);
 *   entrada        X% ou R$ X na aprovação + saldo na entrega ou em n parcelas;
 *   parcelado      n parcelas iguais a partir do 1º vencimento (o modelo antigo).
 * Condição sem `modelo` é acordo antigo: vale como "parcelado".
 */
export const MODELOS_DE_CONDICAO = ["a_vista", "metade_metade", "entrada", "parcelado"] as const;
export type ModeloDeCondicao = (typeof MODELOS_DE_CONDICAO)[number];

export const ROTULO_DO_MODELO: Record<ModeloDeCondicao, string> = {
  a_vista: "À vista",
  metade_metade: "50% + 50%",
  entrada: "Entrada + saldo",
  parcelado: "Parcelado",
};

export type CondicaoDePagamento = {
  forma?: string | null;
  /** bandeira do cartão, opcional: visa, mastercard, elo, amex, hipercard */
  bandeira?: string | null;
  /** Pix que a pessoa marcou como recebido ao combinar o pagamento; vira baixa na conversão em OS */
  pix_recebido?: { valor: number; em: string; lancado?: boolean } | null;
  /** Como divide; ausente = acordo antigo (parcelas iguais). */
  modelo?: ModeloDeCondicao | null;
  /** Entrada em % do total (0–100) — só no modelo `entrada`, quando não há valor fixo. */
  entrada_pct?: number | null;
  /** Entrada em R$ — só no modelo `entrada`; manda sobre o percentual quando os dois existem. */
  entrada_valor?: number | null;
  /** Parcelas do SALDO (ou do total, quando não há entrada). */
  parcelas?: number | null;
  intervalo_dias?: number | null;
  primeiro_vencimento?: string | null;
};

export function lerCondicao(cru: unknown): CondicaoDePagamento {
  if (!cru || typeof cru !== "object") return {};
  return cru as CondicaoDePagamento;
}

/** O modelo gravado, ou null quando é acordo antigo (ou lixo). */
export function modeloDaCondicao(c: CondicaoDePagamento | null | undefined): ModeloDeCondicao | null {
  const m = c?.modelo;
  return (MODELOS_DE_CONDICAO as readonly string[]).includes(String(m)) ? (m as ModeloDeCondicao) : null;
}

/** O padrão da casa: 50% na aprovação e 50% na entrega (condições gerais da gráfica). */
export const CONDICAO_PADRAO_DA_CASA: Pick<CondicaoDePagamento, "modelo" | "parcelas"> = {
  modelo: "metade_metade",
  parcelas: 1,
};

/**
 * Condição completa = dá para mandar ao cliente e virar OS: tem a FORMA (Pix,
 * cartão…) e tem COMO divide (um dos quatro modelos, escolhido). O
 * `{parcelas: 1}` que o orçamento ganha ao nascer NÃO é divisão: foi assim
 * que 12 das 15 OS de outubro nasceram sem pagamento combinado — e, em
 * 29/10/2026, o orçamento 152 saiu com forma Pix e esse `parcelas: 1` de
 * nascença: o Pix pedia 50%, o PDF dizia "1x" e a conta a receber nasceria com
 * UMA parcela do total. Acordo antigo em n parcelas vira "Parcelado" com um
 * clique; o banco (`converter_orcamento_em_os`) cobra a mesma régua.
 */
export function condicaoCompleta(cru: unknown): boolean {
  const c = lerCondicao(cru);
  const temForma = typeof c.forma === "string" && c.forma.trim() !== "";
  return temForma && modeloDaCondicao(c) !== null;
}

const centavosDe = (v: unknown) => Math.round((Number(v) || 0) * 100);

/**
 * Quanto o cliente paga na aprovação, em R$, com a MESMA conta da conversão em
 * OS: `round(total × pct ÷ 100, 2)` em centavos inteiros; valor fixo nunca
 * passa do total. À vista é o total inteiro; parcelado e acordo antigo, zero.
 */
export function valorDaEntrada(total: number, c: CondicaoDePagamento): number {
  const totalC = centavosDe(total);
  if (totalC <= 0) return 0;
  const modelo = modeloDaCondicao(c);
  if (modelo === "a_vista") return totalC / 100;
  if (modelo === "metade_metade") return Math.round(totalC / 2) / 100;
  if (modelo === "entrada") {
    if (c.entrada_valor != null && Number(c.entrada_valor) > 0) {
      return Math.min(totalC, centavosDe(c.entrada_valor)) / 100;
    }
    const pct = Math.min(100, Math.max(0, Number(c.entrada_pct ?? 0) || 0));
    return Math.round((totalC * pct) / 100) / 100;
  }
  return 0;
}

/** Texto da condição para o PDF, o link do cliente e a revisão. Acordo antigo sai como "2x". */
export function descricaoDaCondicao(c: CondicaoDePagamento, total?: number): string {
  const modelo = modeloDaCondicao(c);
  const n = Math.max(1, Math.round(Number(c.parcelas ?? 1) || 1));
  const intervalo = Math.max(0, Math.round(Number(c.intervalo_dias ?? 30) || 0));
  const saldo = n === 1 ? "o saldo na entrega" : `o saldo em ${n}× a cada ${intervalo} dias`;
  if (modelo === "a_vista") return "À vista, na aprovação";
  if (modelo === "metade_metade") return "50% na aprovação e 50% na entrega";
  if (modelo === "entrada") {
    const fixo = c.entrada_valor != null && Number(c.entrada_valor) > 0;
    const pct = Math.min(100, Math.max(0, Number(c.entrada_pct ?? 0) || 0));
    const entrada = fixo
      ? `Entrada de ${brl(total != null ? valorDaEntrada(total, c) : Number(c.entrada_valor))}`
      : `Entrada de ${pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%${total != null && total > 0 ? ` (${brl(valorDaEntrada(total, c))})` : ""}`;
    return `${entrada} na aprovação e ${saldo}`;
  }
  if (modelo === "parcelado") return n === 1 ? "Parcela única na entrega" : `${n}× a cada ${intervalo} dias`;
  return `${n}x`;
}

export type Parcela = {
  numero: number;
  valor: number;
  vencimento: string | null;
  /** "Entrada na aprovação", "Saldo na entrega"… — só nos modelos novos. */
  rotulo?: string;
};

/**
 * Os valores das parcelas com a conta de `converter_orcamento_em_os`, lida do
 * corpo da função no banco:
 *
 *   v_valor_parcela := round(COALESCE(v_orc.valor_total, 0) / v_parcelas, 2);
 *   -- todas menos a última: v_valor_parcela
 *   -- a última: COALESCE(v_orc.valor_total, 0) - v_acumulado
 *
 * Em centavos INTEIROS. A conta antiga, em ponto flutuante, fazia
 * `Math.round(total / n * 100)`: R$ 501,15 em 10x dá 50,114999… e virava
 * 50,11 na tela, enquanto o Postgres (numeric exato) chega em 50,115 e grava
 * 50,12 — 1 em cada 116 combinações de total e parcelas divergia assim. Em
 * inteiros, `centavos / n` só dá ,5 quando o quociente é ,5 de verdade (e ,5 é
 * representável), e `Math.round` arredonda esse meio para cima — que, para
 * total positivo, é o "longe do zero" do `round` do Postgres.
 */
export function valoresDasParcelas(total: number, parcelas: number): number[] {
  const n = Math.max(1, Math.round(Number(parcelas) || 1));
  const centavos = Math.round(Number(total || 0) * 100);
  const porParcela = Math.round(centavos / n);
  const ultima = centavos - porParcela * (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? ultima : porParcela) / 100);
}

/**
 * As parcelas, com a MESMA conta da conversão em OS (`converter_orcamento_em_os`):
 *
 *   - entrada (à vista, 50% ou X) é a 1ª parcela e vence na aprovação — aqui a
 *     data fica nula porque o dia em que vira OS ainda não existe;
 *   - o saldo é dividido em `parcelas` iguais (`valoresDasParcelas`, a última
 *     com a sobra dos centavos); em uma só, sem data: vence no prazo da OS ou
 *     na saída do pedido; em várias, a partir do 1º vencimento combinado — ou,
 *     nos modelos com entrada, do prazo de entrega (`referencia.prazo`);
 *   - acordo antigo (sem modelo): tudo como antes, n parcelas iguais do total.
 */
export function parcelasDoOrcamento(
  total: number,
  condicao: CondicaoDePagamento,
  referencia: { prazo?: string | null } = {},
): Parcela[] {
  const modelo = modeloDaCondicao(condicao);
  const n = Math.max(1, Math.round(Number(condicao.parcelas ?? 1) || 1));
  const intervalo = Math.max(0, Math.round(Number(condicao.intervalo_dias ?? 30) || 0));
  const primeiro = typeof condicao.primeiro_vencimento === "string" && condicao.primeiro_vencimento
    ? condicao.primeiro_vencimento
    : null;

  if (!modelo || modelo === "parcelado") {
    return valoresDasParcelas(total, n).map((valor, i) => ({
      numero: i + 1,
      valor,
      vencimento: primeiro ? somarDias(primeiro, intervalo * i) : null,
      ...(modelo ? { rotulo: n === 1 ? "Parcela única na entrega" : `${i + 1}ª de ${n}` } : {}),
    }));
  }

  const totalC = Math.round((Number(total) || 0) * 100);
  const entradaC = Math.round(valorDaEntrada(total, condicao) * 100);
  const saldoC = totalC - entradaC;
  const lista: Parcela[] = [];
  if (entradaC > 0) {
    lista.push({
      numero: 1,
      valor: entradaC / 100,
      vencimento: null,
      rotulo:
        modelo === "a_vista" ? "À vista, na aprovação" : modelo === "metade_metade" ? "50% na aprovação" : "Entrada na aprovação",
    });
  }
  if (saldoC > 0 || lista.length === 0) {
    const base = primeiro ?? (n > 1 && referencia.prazo ? referencia.prazo : null);
    valoresDasParcelas(saldoC / 100, n).forEach((valor, i) => {
      lista.push({
        numero: lista.length + 1,
        valor,
        vencimento: base ? somarDias(base, intervalo * i) : null,
        rotulo:
          n === 1
            ? modelo === "metade_metade"
              ? "50% na entrega"
              : "Saldo na entrega"
            : `Saldo ${i + 1}ª de ${n}`,
      });
    });
  }
  return lista;
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
  /** desconto acima da alçada sem aprovação válida (o banco não deixa virar OS) */
  descontoPendente?: boolean;
}): string[] {
  const falta: string[] = [];
  if (!o.temClienteOuContato) falta.push("cliente ou contato");
  if (!o.dataEntrega) falta.push("data de entrega");
  if (o.verPreco && !o.temCondicao) falta.push("condição de pagamento");
  // O cliente veria no PDF e no link um desconto que a gráfica ainda não deu.
  if (o.verPreco && o.descontoPendente) falta.push("aprovação do desconto");
  if (o.itens.length === 0) falta.push("itens");
  return falta;
}

/**
 * O que NÃO impede de mandar ao cliente, mas a equipe precisa saber (26/10/2026).
 * O layout ia na lista de pendências: a venda parecia travada e a revisão ficava
 * em "1 pendência" por algo que só a produção exige. A OS já barra a produção sem
 * arte aprovada (`os_bloqueios_para`), então aqui é aviso, não pendência.
 */
export function avisosParaEnviar(o: { itens: { arquivo_id: string | null }[] }): string[] {
  const semArte = o.itens.filter((i) => !i.arquivo_id).length;
  if (semArte === 0) return [];
  return [
    semArte === 1
      ? "1 item sem layout: dá para enviar, a produção só começa com a arte aprovada"
      : `${semArte} itens sem layout: dá para enviar, a produção só começa com a arte aprovada`,
  ];
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

/* ------------------------------------------------------------------------- */
/* Conferência antes de converter em OS                                       */
/* ------------------------------------------------------------------------- */

export type ItemDaConferencia = {
  chave: string;
  rotulo: string;
  ok: boolean;
  /** `obrigatorio` e não ok = a OS nasce com um problema; `aviso` e não ok = só atenção. */
  nivel: "obrigatorio" | "aviso";
  detalhe: string;
};

/**
 * O que a pessoa precisa ver ANTES de criar a OS (27/10/2026). Nada aqui bloqueia: o banco já
 * recusa o que não pode (desconto sem aprovação, valor mudado). É a diferença entre descobrir
 * "sem arte" na produção e saber disso na hora de converter.
 */
export function conferenciaAntesDeConverter(o: {
  temCliente: boolean;
  dataEntrega: string | null;
  verPreco: boolean;
  forma: string | null;
  /** Forma E divisão combinadas (`condicaoCompleta`); sem isto o banco não cria a OS. Ausente = só a forma. */
  condicaoCompleta?: boolean;
  pixRecebido: boolean;
  itensSemArte: number;
  descontoPendente: boolean;
}): ItemDaConferencia[] {
  const lista: ItemDaConferencia[] = [
    {
      chave: "cliente",
      rotulo: "Cliente cadastrado",
      ok: o.temCliente,
      nivel: "obrigatorio",
      detalhe: o.temCliente ? "A OS fica ligada ao cadastro." : "Sem cliente cadastrado a OS não pode ser criada.",
    },
    {
      chave: "entrega",
      rotulo: "Data de entrega",
      ok: !!o.dataEntrega,
      nivel: "obrigatorio",
      detalhe: o.dataEntrega ? "A OS herda a data e entra na agenda." : "Sem data a OS nasce sem prazo (e sai nos alertas).",
    },
  ];
  if (o.verPreco) {
    const completa = o.condicaoCompleta ?? !!o.forma;
    lista.push({
      chave: "pagamento",
      rotulo: "Condição de pagamento",
      ok: completa,
      nivel: "obrigatorio",
      // Decisão do dono (28/10/2026): não existe OS sem pagamento combinado — o banco recusa.
      detalhe: completa
        ? `${o.forma}: a conta a receber nasce com as parcelas combinadas.`
        : "Sem forma e divisão combinadas (à vista, 50% + 50%, entrada ou parcelado) a OS não é criada.",
    });
    if (o.forma && o.forma.toLowerCase() === "pix") {
      lista.push({
        chave: "pix",
        rotulo: "Sinal em Pix recebido",
        ok: o.pixRecebido,
        // Decisão do dono (27/10/2026): pagamento em Pix só vira OS com o sinal marcado como recebido.
        nivel: "obrigatorio",
        detalhe: o.pixRecebido
          ? "A baixa vai junto com a OS."
          : "Pagamento em Pix: a OS só nasce com o sinal marcado como recebido. Confira o extrato ou o comprovante e marque \"O Pix chegou\".",
      });
    }
    lista.push({
      chave: "desconto",
      rotulo: "Desconto aprovado",
      ok: !o.descontoPendente,
      nivel: "obrigatorio",
      detalhe: o.descontoPendente ? "O desconto passou da alçada sem aprovação: o banco recusa." : "Dentro da alçada ou aprovado.",
    });
  }
  lista.push({
    chave: "arte",
    rotulo: "Layout dos itens",
    ok: o.itensSemArte === 0,
    nivel: "aviso",
    detalhe:
      o.itensSemArte === 0
        ? "Todos os itens têm arte."
        : `${o.itensSemArte} ${o.itensSemArte === 1 ? "item sem layout" : "itens sem layout"}: a OS nasce em Design e só vai à produção com a arte aprovada.`,
  });
  return lista;
}
