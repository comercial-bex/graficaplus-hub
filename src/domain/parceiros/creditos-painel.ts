/**
 * A TELA DE CRÉDITOS DOS PARCEIROS (22/11/2026). Função pura: sem banco e sem React. O banco entrega o livro de créditos de
 * cada parceiro (`parceiros_creditos_painel()`, migração 20261122700000) e o SALDO pela mesma conta do cartão e do aviso do
 * grupo. Aqui se calcula o que o banco não entrega pronto:
 *   * o que cada lançamento PAGOU: cada uso (pedido da gráfica) é abatido dos créditos que valiam naquele dia, o que vence
 *     primeiro antes (o mesmo critério da conta do saldo no banco), e cada crédito guarda "pagou R$ X do pedido nº N";
 *   * o que VENCE e quando: por dia (no horário de Macapá), com os dias que faltam;
 *   * a conferência: a soma do que resta nos créditos vivos tem que bater com o saldo do banco; se não bater, a tela avisa
 *     em vez de mostrar dois números diferentes sem dizer nada.
 * Nada aqui grava. Nada aqui calcula preço nem custo.
 */

export type Lancamento = {
  id: string;
  criadoEm: Date;
  tipo: string;
  valor: number;
  descricao: string | null;
  expiraEm: Date | null;
  osId: string | null;
  osNumero: string | null;
  orcamentoId: string | null;
  orcamentoNumero: string | null;
  pedidoTotal: number | null;
  criadoPorNome: string | null;
};

export type ProgramaDeCredito = {
  entradaAtiva: boolean;
  entradaValor: number;
  validadeDias: number;
  pedidoMinimo: number;
  maxPct: number;
  lembreteAtivo: boolean;
  lembreteDias: number;
};

export type ParceiroComCredito = {
  parceiroId: string;
  nome: string;
  status: string;
  responsavelNome: string | null;
  /** O saldo do BANCO (a mesma conta do cartão e do aviso). */
  saldo: number;
  lancamentos: Lancamento[];
};

export type Painel = { agora: Date; programa: ProgramaDeCredito | null; parceiros: ParceiroComCredito[] };

export const ERRO_DO_PAINEL = "A resposta do banco para os créditos veio fora do formato. Atualize a página; se continuar, avise a gerência.";

type Solto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Solto => typeof v === "object" && v !== null && !Array.isArray(v);
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : v == null ? null : String(v));
const data = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Lê a resposta do banco. Linha sem id, valor ou data é descartada; resposta que não é objeto é erro (nunca "tudo zerado"). */
export function lerPainel(bruto: unknown): Painel {
  if (!ehObjeto(bruto) || !Array.isArray(bruto.parceiros)) throw new Error(ERRO_DO_PAINEL);
  const agora = data(bruto.agora) ?? new Date();
  const p = ehObjeto(bruto.programa) ? bruto.programa : null;
  const programa: ProgramaDeCredito | null = p
    ? {
        entradaAtiva: p.entrada_ativa === true,
        entradaValor: numero(p.entrada_valor) ?? 0,
        validadeDias: numero(p.validade_dias) ?? 0,
        pedidoMinimo: numero(p.pedido_minimo) ?? 0,
        maxPct: numero(p.max_pct) ?? 0,
        lembreteAtivo: p.lembrete_ativo !== false,
        lembreteDias: numero(p.lembrete_dias) ?? 7,
      }
    : null;
  const parceiros: ParceiroComCredito[] = [];
  for (const x of bruto.parceiros) {
    if (!ehObjeto(x) || typeof x.parceiro_id !== "string") continue;
    const lancamentos: Lancamento[] = [];
    for (const l of Array.isArray(x.lancamentos) ? x.lancamentos : []) {
      if (!ehObjeto(l) || typeof l.id !== "string") continue;
      const valor = numero(l.valor);
      const criadoEm = data(l.criado_em);
      if (valor == null || !criadoEm) continue;
      lancamentos.push({
        id: l.id,
        criadoEm,
        tipo: String(l.tipo ?? ""),
        valor,
        descricao: texto(l.descricao),
        expiraEm: data(l.expira_em),
        osId: texto(l.os_id),
        osNumero: texto(l.os_numero),
        orcamentoId: texto(l.orcamento_id),
        orcamentoNumero: texto(l.orcamento_numero),
        pedidoTotal: numero(l.pedido_total),
        criadoPorNome: texto(l.criado_por_nome),
      });
    }
    parceiros.push({
      parceiroId: x.parceiro_id,
      nome: texto(x.nome) ?? "Parceiro",
      status: texto(x.status) ?? "",
      responsavelNome: texto(x.responsavel_nome),
      saldo: numero(x.saldo) ?? 0,
      lancamentos,
    });
  }
  return { agora, programa, parceiros };
}

// ---------------------------------------------------------------------------------------------------------
// Datas no horário de Macapá (UTC-3, sem horário de verão)
// ---------------------------------------------------------------------------------------------------------

const TRES_HORAS = 3 * 3_600_000;
const DIA = 86_400_000;
const emMacapa = (d: Date) => new Date(d.getTime() - TRES_HORAS);
const dd = (n: number) => String(n).padStart(2, "0");

/** "2026-12-14": o dia no horário de Macapá. */
export function chaveDoDia(d: Date): string {
  const l = emMacapa(d);
  return `${l.getUTCFullYear()}-${dd(l.getUTCMonth() + 1)}-${dd(l.getUTCDate())}`;
}
export function diaMes(d: Date): string {
  const l = emMacapa(d);
  return `${dd(l.getUTCDate())}/${dd(l.getUTCMonth() + 1)}`;
}
export function dataCompleta(d: Date): string {
  const l = emMacapa(d);
  return `${dd(l.getUTCDate())}/${dd(l.getUTCMonth() + 1)}/${l.getUTCFullYear()}`;
}
/** Dias de calendário (em Macapá) de `agora` até `alvo`: 22 para 14/12 visto de 22/11; 0 é hoje; negativo já passou. */
export function diasAte(alvo: Date, agora: Date): number {
  const a = emMacapa(alvo);
  const b = emMacapa(agora);
  return Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) - Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / DIA);
}

/** O dia (dd/mm) em que o lembrete de crédito vencendo começa a avisar para um vencimento: `dias` antes. */
export function diaDoAviso(chaveDoVencimento: string, dias: number): string {
  const d = new Date(`${chaveDoVencimento}T12:00:00-03:00`);
  return diaMes(new Date(d.getTime() - dias * DIA));
}

export function reais(v: number): string {
  return "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ---------------------------------------------------------------------------------------------------------
// O livro: o que cada lançamento pagou
// ---------------------------------------------------------------------------------------------------------

export const ROTULO_DO_TIPO: Record<string, string> = {
  entrada: "Crédito de entrada",
  boas_vindas: "Boas-vindas",
  indicacao: "Indicação",
  cashback: "Cashback",
  recompensa: "Recompensa",
  ajuste: "Ajuste da gerência",
  uso: "Usado em pedido",
  estorno_uso: "Uso devolvido",
  expirado: "Venceu sem uso",
};
export const rotuloDoTipo = (tipo: string) => ROTULO_DO_TIPO[tipo] ?? tipo;

export type Natureza = "credito" | "uso" | "devolucao" | "vencimento" | "ajuste";
export type SituacaoDoCredito = "a_vencer" | "em_uso" | "usado" | "vencido" | "sem_vencimento";
/** `uso` é pedido da gráfica pago com o crédito; `ajuste` é baixa manual da gerência (não é pedido). */
export type Pagamento = { rotulo: string; valor: number; pedidoTotal: number | null; tipo: "uso" | "ajuste" };

export type LinhaDoLivro = {
  lancamento: Lancamento;
  natureza: Natureza;
  /** Crédito: o que ele pagou, pedido por pedido. */
  pagou: Pagamento[];
  usado: number;
  /** Crédito: o que ainda não pagou nada (vivo ou vencido). Zero nas outras linhas. */
  restante: number;
  situacao: SituacaoDoCredito | null;
  /** Dias até vencer, só para crédito vivo com vencimento; negativo se já venceu. */
  dias: number | null;
  /** Uso, devolução e ajuste negativo: o pedido a que se refere ("pedido nº 12"). */
  pedido: string | null;
  /** Uso: quanto do valor não foi devolvido e quanto saiu de crédito nenhum (inconsistência do livro). */
  liquido: number;
  semCredito: number;
};

export type Livro = {
  linhas: LinhaDoLivro[];
  concedido: number;
  /** Tudo o que saiu dos créditos: pedidos pagos e ajustes da gerência. */
  usado: number;
  /** Só o que pagou pedido da gráfica (o ajuste não conta como pedido pago). */
  usadoEmPedidos: number;
  /** Crédito que venceu sem pagar nada. */
  vencidoSemUso: number;
  /** O que resta nos créditos que ainda valem (com ou sem vencimento). Deve bater com o saldo do banco. */
  vivo: number;
  /** Uso maior do que os créditos que valiam: o livro está inconsistente. */
  semCredito: number;
};

function rotuloDoPedido(l: Lancamento): string {
  if (l.orcamentoNumero) return `pedido nº ${l.orcamentoNumero}`;
  if (l.osNumero) return `OS nº ${l.osNumero}`;
  return l.tipo === "ajuste" ? "ajuste da gerência" : (l.descricao ?? "pedido");
}

const chaveDoPedido = (l: Lancamento) => (l.orcamentoId ? `o:${l.orcamentoId}` : l.osId ? `s:${l.osId}` : null);

/**
 * Abate cada uso dos créditos que valiam no dia, o que vence primeiro antes. Devolução de uso (`estorno_uso`) desfaz o uso do
 * mesmo pedido; devolução sem uso correspondente vale como crédito. Linha de "venceu sem uso" é só a baixa do saldo.
 */
export function montarLivro(lancamentos: Lancamento[], agora: Date): Livro {
  const ordenados = [...lancamentos].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || a.id.localeCompare(b.id));
  const linhas: LinhaDoLivro[] = ordenados.map((l) => ({
    lancamento: l,
    natureza: l.valor > 0 ? "credito" : l.tipo === "uso" ? "uso" : l.tipo === "expirado" ? "vencimento" : "ajuste",
    pagou: [],
    usado: 0,
    restante: 0,
    situacao: null,
    dias: null,
    pedido: null,
    liquido: l.valor < 0 ? -l.valor : 0,
    semCredito: 0,
  }));

  // Devolução do uso: abate o uso do mesmo pedido; sem uso para abater, continua sendo crédito.
  for (const dev of linhas.filter((x) => x.lancamento.tipo === "estorno_uso" && x.lancamento.valor > 0)) {
    const chave = chaveDoPedido(dev.lancamento);
    const uso = chave ? linhas.find((u) => u.natureza === "uso" && chaveDoPedido(u.lancamento) === chave && u.liquido > 0) : undefined;
    if (!uso) continue;
    uso.liquido = Math.max(0, Math.round((uso.liquido - dev.lancamento.valor) * 100) / 100);
    dev.natureza = "devolucao";
    dev.pedido = rotuloDoPedido(uso.lancamento);
  }

  const creditos = linhas.filter((x) => x.natureza === "credito");
  for (const c of creditos) c.restante = c.lancamento.valor;

  // Cada uso (e ajuste negativo) sai dos créditos que valiam na data dele, vencendo primeiro o que vence primeiro.
  for (const u of linhas.filter((x) => x.natureza === "uso" || x.natureza === "ajuste")) {
    u.pedido = rotuloDoPedido(u.lancamento);
    let falta = u.liquido;
    const quando = u.lancamento.criadoEm.getTime();
    const elegiveis = creditos
      .filter((c) => c.restante > 0.004 && c.lancamento.criadoEm.getTime() <= quando && (!c.lancamento.expiraEm || c.lancamento.expiraEm.getTime() > quando))
      .sort(
        (a, b) =>
          (a.lancamento.expiraEm?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.lancamento.expiraEm?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
          a.lancamento.criadoEm.getTime() - b.lancamento.criadoEm.getTime(),
      );
    for (const c of elegiveis) {
      if (falta <= 0.004) break;
      const x = Math.round(Math.min(c.restante, falta) * 100) / 100;
      c.restante = Math.round((c.restante - x) * 100) / 100;
      c.pagou.push({ rotulo: u.pedido, valor: x, pedidoTotal: u.lancamento.pedidoTotal, tipo: u.natureza === "uso" ? "uso" : "ajuste" });
      falta = Math.round((falta - x) * 100) / 100;
    }
    u.semCredito = falta > 0.004 ? falta : 0;
  }

  const t = agora.getTime();
  let concedido = 0;
  let usado = 0;
  let usadoEmPedidos = 0;
  let vencidoSemUso = 0;
  let vivo = 0;
  for (const c of creditos) {
    const valor = c.lancamento.valor;
    c.usado = Math.round((valor - c.restante) * 100) / 100;
    const venceu = !!c.lancamento.expiraEm && c.lancamento.expiraEm.getTime() <= t;
    c.situacao = c.restante <= 0.004 ? "usado" : venceu ? "vencido" : c.usado > 0 ? "em_uso" : c.lancamento.expiraEm ? "a_vencer" : "sem_vencimento";
    c.dias = c.lancamento.expiraEm && c.situacao !== "usado" ? diasAte(c.lancamento.expiraEm, agora) : null;
    concedido += valor;
    usado += c.usado;
    usadoEmPedidos += c.pagou.filter((x) => x.tipo === "uso").reduce((soma, x) => soma + x.valor, 0);
    if (c.situacao === "vencido") vencidoSemUso += c.restante;
    else if (c.situacao !== "usado") vivo += c.restante;
  }
  const arred = (n: number) => Math.round(n * 100) / 100;
  return {
    linhas,
    concedido: arred(concedido),
    usado: arred(usado),
    usadoEmPedidos: arred(usadoEmPedidos),
    vencidoSemUso: arred(vencidoSemUso),
    vivo: arred(vivo),
    semCredito: arred(linhas.reduce((s, l) => s + l.semCredito, 0)),
  };
}

/** A frase de "o que este lançamento paga" (ou pagou), para a coluna da tela. */
export function queOLancamentoPaga(l: LinhaDoLivro, programa: ProgramaDeCredito | null): string {
  const lan = l.lancamento;
  if (l.natureza === "credito") {
    if (l.pagou.length > 0) {
      const partes = l.pagou.map((p) =>
        p.tipo === "uso"
          ? `pagou ${reais(p.valor)} do ${p.rotulo}${p.pedidoTotal ? ` (total ${reais(p.pedidoTotal)})` : ""}`
          : `teve ${reais(p.valor)} baixados por ${p.rotulo}`,
      );
      const frase = partes.join(" e ");
      const resta = l.restante > 0.004 ? (l.situacao === "vencido" ? ` Venceu com ${reais(l.restante)} sem uso.` : ` Ainda resta ${reais(l.restante)}.`) : "";
      return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.${resta}`;
    }
    if (l.situacao === "vencido") return "Venceu sem pagar nenhum pedido.";
    if (lan.tipo === "entrada" && programa && programa.entradaAtiva) {
      return `Ainda sem uso. Vale na 1ª compra, até ${programa.maxPct}% de um pedido de no mínimo ${reais(programa.pedidoMinimo)}.`;
    }
    return "Ainda sem uso.";
  }
  if (l.natureza === "uso") {
    if (l.liquido <= 0.004) return `Devolvido: o ${l.pedido} não seguiu e o valor voltou para o saldo.`;
    return `Pagou parte do ${l.pedido}${lan.pedidoTotal ? ` (total ${reais(lan.pedidoTotal)})` : ""}.${l.semCredito > 0 ? ` Atenção: ${reais(l.semCredito)} não têm crédito que cubra.` : ""}`;
  }
  if (l.natureza === "devolucao") return `Devolveu o uso do ${l.pedido}.`;
  if (l.natureza === "vencimento") return "Baixa de crédito que venceu sem uso.";
  // O motivo já aparece na linha do lançamento; aqui só o que o ajuste fez.
  return "Baixa manual da gerência: saiu do crédito que vence primeiro.";
}

// ---------------------------------------------------------------------------------------------------------
// O parceiro e o painel
// ---------------------------------------------------------------------------------------------------------

export type ParceiroCalculado = ParceiroComCredito & {
  livro: Livro;
  /** O vencimento mais próximo entre os créditos que ainda valem e têm vencimento. */
  venceEm: Date | null;
  diasParaVencer: number | null;
  /** Quanto vence nesse dia. */
  valorQueVence: number;
  /** A soma do que resta nos créditos vivos bate com o saldo do banco (centavo de tolerância). */
  confere: boolean;
};

export function calcularParceiro(p: ParceiroComCredito, agora: Date): ParceiroCalculado {
  const livro = montarLivro(p.lancamentos, agora);
  const vivos = livro.linhas.filter((l) => l.natureza === "credito" && l.lancamento.expiraEm && l.situacao !== "usado" && l.situacao !== "vencido");
  const primeiro = vivos.map((l) => l.lancamento.expiraEm as Date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const valorQueVence = primeiro ? vivos.filter((l) => chaveDoDia(l.lancamento.expiraEm as Date) === chaveDoDia(primeiro)).reduce((s, l) => s + l.restante, 0) : 0;
  return {
    ...p,
    livro,
    venceEm: primeiro,
    diasParaVencer: primeiro ? diasAte(primeiro, agora) : null,
    valorQueVence: Math.round(valorQueVence * 100) / 100,
    confere: Math.abs(p.saldo - livro.vivo) <= 0.011,
  };
}

export type Vencimento = { chave: string; dia: string; dataCompleta: string; dias: number; valor: number; parceiros: number; nomes: string[] };

export type Resumo = {
  saldoTotal: number;
  parceirosComSaldo: number;
  concedido: number;
  /** O que pagou pedidos da gráfica (ajuste da gerência não entra). */
  usado: number;
  vencidoSemUso: number;
  pedidosPagos: number;
  vencimentos: Vencimento[];
  /** Parceiros em que o saldo do banco não bate com a soma do livro. */
  divergentes: string[];
  semCredito: number;
};

export function resumir(parceiros: ParceiroCalculado[]): Resumo {
  const porDia = new Map<string, Vencimento>();
  const pedidos = new Set<string>();
  for (const p of parceiros) {
    for (const l of p.livro.linhas) {
      if (l.natureza === "credito" && l.lancamento.expiraEm && l.situacao !== "usado" && l.situacao !== "vencido") {
        const chave = chaveDoDia(l.lancamento.expiraEm);
        const atual = porDia.get(chave) ?? { chave, dia: diaMes(l.lancamento.expiraEm), dataCompleta: dataCompleta(l.lancamento.expiraEm), dias: 0, valor: 0, parceiros: 0, nomes: [] };
        atual.valor += l.restante;
        if (!atual.nomes.includes(p.nome)) {
          atual.nomes.push(p.nome);
          atual.parceiros++;
        }
        porDia.set(chave, atual);
      }
      if (l.natureza === "uso" && l.liquido > 0.004) pedidos.add(`${p.parceiroId}:${l.pedido}`);
    }
  }
  const arred = (n: number) => Math.round(n * 100) / 100;
  return {
    saldoTotal: arred(parceiros.reduce((s, p) => s + p.saldo, 0)),
    parceirosComSaldo: parceiros.filter((p) => p.saldo > 0.004).length,
    concedido: arred(parceiros.reduce((s, p) => s + p.livro.concedido, 0)),
    usado: arred(parceiros.reduce((s, p) => s + p.livro.usadoEmPedidos, 0)),
    vencidoSemUso: arred(parceiros.reduce((s, p) => s + p.livro.vencidoSemUso, 0)),
    pedidosPagos: pedidos.size,
    vencimentos: [...porDia.values()].sort((a, b) => a.chave.localeCompare(b.chave)).map((v) => ({ ...v, valor: arred(v.valor), nomes: [...v.nomes].sort((a, b) => a.localeCompare(b, "pt-BR")) })),
    divergentes: parceiros.filter((p) => !p.confere).map((p) => p.nome),
    semCredito: arred(parceiros.reduce((s, p) => s + p.livro.semCredito, 0)),
  };
}

/** Preenche os dias que faltam de cada vencimento a partir de `agora`. */
export function comDias(v: Vencimento[], agora: Date): Vencimento[] {
  return v.map((x) => ({ ...x, dias: diasAte(new Date(`${x.chave}T12:00:00-03:00`), agora) }));
}

export function calcularPainel(p: Painel): { parceiros: ParceiroCalculado[]; resumo: Resumo } {
  const parceiros = p.parceiros.map((x) => calcularParceiro(x, p.agora));
  const resumo = resumir(parceiros);
  return { parceiros, resumo: { ...resumo, vencimentos: comDias(resumo.vencimentos, p.agora) } };
}

// ---------------------------------------------------------------------------------------------------------
// Filtros e ordem da lista
// ---------------------------------------------------------------------------------------------------------

export type Mostrar = "todos" | "com_saldo" | "vence_logo" | "usaram" | "vencidos";
export type Ordem = "vence" | "saldo" | "nome";

export const OPCOES_DE_MOSTRAR: { valor: Mostrar; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "com_saldo", rotulo: "Com saldo" },
  { valor: "vence_logo", rotulo: "Vencem em até 7 dias" },
  { valor: "usaram", rotulo: "Já usaram" },
  { valor: "vencidos", rotulo: "Com crédito vencido" },
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarParceiros(
  lista: ParceiroCalculado[],
  f: { busca: string; responsavel: string; mostrar: Mostrar; ordem: Ordem; dias?: number },
): ParceiroCalculado[] {
  const t = semAcento(f.busca.trim());
  const limite = f.dias ?? 7;
  const saida = lista.filter((p) => {
    if (t && !semAcento(`${p.nome} ${p.responsavelNome ?? ""}`).includes(t)) return false;
    if (f.responsavel && (p.responsavelNome ?? "Sem responsável") !== f.responsavel) return false;
    if (f.mostrar === "com_saldo") return p.saldo > 0.004;
    if (f.mostrar === "vence_logo") return p.diasParaVencer != null && p.diasParaVencer <= limite && p.saldo > 0.004;
    if (f.mostrar === "usaram") return p.livro.usadoEmPedidos > 0.004;
    if (f.mostrar === "vencidos") return p.livro.vencidoSemUso > 0.004;
    return true;
  });
  const porNome = (a: ParceiroCalculado, b: ParceiroCalculado) => a.nome.localeCompare(b.nome, "pt-BR");
  return saida.sort((a, b) => {
    if (f.ordem === "saldo") return b.saldo - a.saldo || porNome(a, b);
    if (f.ordem === "nome") return porNome(a, b);
    // vence: o que vence primeiro; quem não tem vencimento por último
    return (a.venceEm?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.venceEm?.getTime() ?? Number.MAX_SAFE_INTEGER) || porNome(a, b);
  });
}

export function responsaveisDaLista(lista: ParceiroCalculado[]): string[] {
  return [...new Set(lista.map((p) => p.responsavelNome ?? "Sem responsável"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** "vence hoje", "vence amanhã", "vence em 22 dias", "venceu há 3 dias". */
export function frasePrazo(dias: number): string {
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias > 1) return `vence em ${dias} dias`;
  return dias === -1 ? "venceu ontem" : `venceu há ${-dias} dias`;
}
