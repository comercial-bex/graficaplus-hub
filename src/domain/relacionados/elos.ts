import { rotuloDe as rotuloDoStatusDaOs } from "@/domain/os/etapas";
import { formatarData } from "@/domain/os/prazo";

/**
 * A faixa "Relacionados" das fichas do cliente, do orçamento e da OS (23/11/2026, Onda 1 do diagnóstico).
 *
 * O banco já liga cliente, orçamento, OS, conta a receber, entrega e produto; a tela não mostrava essas ligações
 * (a ficha da OS não linkava o orçamento de origem, a do cliente não dizia o que ele deve). Aqui está só a DECISÃO do que
 * dizer em cada elo, sem React e sem banco, para ser testada:
 *
 *   - cada leitura chega num de quatro estados (carregando, erro, sem acesso, ok);
 *   - **sem acesso não afirma nada**: quem não lê o financeiro não vê "não deve nada", porque o banco devolveria uma
 *     lista vazia (ou recusaria) e isso pareceria dívida zerada. O elo some;
 *   - **erro não vira "vazio"**: uma leitura que falhou diz que falhou;
 *   - o link só existe quando a pessoa abre a tela de destino (a mesma regra do menu: não convidar para sala trancada).
 */

export type Leitura<T> =
  | { estado: "carregando" }
  | { estado: "erro" }
  | { estado: "sem_acesso" }
  | { estado: "ok"; dados: T };

/**
 * O estado de uma consulta do React Query como `Leitura`. Ordem importa: sem acesso vence tudo (a consulta nem devia
 * existir), erro vence "carregando", e só dado presente é "ok".
 */
export function comoLeitura<T>(
  consulta: { isPending: boolean; isError: boolean; data: T | undefined },
  temAcesso = true,
): Leitura<T> {
  if (!temAcesso) return { estado: "sem_acesso" };
  if (consulta.isError) return { estado: "erro" };
  if (consulta.isPending || consulta.data === undefined) return { estado: "carregando" };
  return { estado: "ok", dados: consulta.data };
}

export type Destino =
  | { rota: "cliente"; id: string }
  | { rota: "orcamento"; id: string }
  | { rota: "os"; id: string }
  | { rota: "produto"; id: string }
  | { rota: "conversa"; id: string }
  | { rota: "a-receber" }
  | { rota: "entregas" }
  | { rota: "parceiros" };

/** O caminho cuja permissão decide se a pessoa abre o destino (as chaves estão em `routePermissions`). */
export function caminhoDeAcesso(destino: Destino): string {
  switch (destino.rota) {
    case "cliente":
      return "/clientes";
    case "orcamento":
      return "/orcamentos";
    case "os":
      return "/os";
    case "produto":
      return "/produtos";
    case "conversa":
      return "/whatsapp";
    case "a-receber":
      return "/a-receber";
    case "entregas":
      return "/entregas";
    case "parceiros":
      return "/parceiros";
  }
}

export type Tom = "normal" | "atencao" | "vazio" | "carregando" | "erro";

export interface Elo {
  chave: string;
  /** O que é: "Orçamento de origem", "A receber". */
  rotulo: string;
  /** A resposta curta: "Orçamento #123", "Sem orçamento ligado". */
  texto: string;
  detalhe?: string;
  tom: Tom;
  destino?: Destino;
}

/** Tira o link dos elos cuja tela a pessoa não abre. O texto fica: saber que existe não é abrir. */
export function aplicarAcesso(elos: Elo[], abre: (caminho: string) => boolean): Elo[] {
  return elos.map((e) => {
    if (!e.destino || abre(caminhoDeAcesso(e.destino))) return e;
    const semLink: Elo = { ...e };
    delete semLink.destino;
    return semLink;
  });
}

/* ------------------------------------------------------------------ */
/* Dinheiro e datas                                                    */
/* ------------------------------------------------------------------ */

const FUSO = "America/Belem";

export function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Soma em centavos: 0,1 + 0,2 não pode virar 0,30000000000000004. */
function centavos(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** "23/11/2026 14:02" no fuso da casa, para instantes (com hora). */
export function dataEHora(instante: string | null | undefined): string | null {
  if (!instante) return null;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO });
}

/** "23/11/2026" no fuso da casa, para instantes (timestamptz). Para DATE puro use `formatarData`. */
export function dataDoInstante(instante: string | null | undefined): string | null {
  if (!instante) return null;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { timeZone: FUSO });
}

function plural(n: number, singular: string, pluralizado: string): string {
  return `${n} ${n === 1 ? singular : pluralizado}`;
}

/* ------------------------------------------------------------------ */
/* A receber (a mesma conta da tela "A receber")                       */
/* ------------------------------------------------------------------ */

/** O que `contas_a_receber()` devolve por conta; o banco já calcula `a_receber` e `vencido` com o "hoje" de Macapá. */
export interface ParcelaLida {
  numero: number;
  valor: number | string;
  vencimento: string | null;
  /** `prevista` ou `paga`. */
  status: string;
  atrasada: boolean;
}

export interface ContaLida {
  conta_id: string;
  cliente_id: string | null;
  os_id: string | null;
  recebido: number | string;
  a_receber: number | string;
  vencido: number | string;
  parcelas: ParcelaLida[] | null;
}

export interface ResumoDeContas {
  contas: number;
  parcelasPagas: number;
  parcelasAbertas: number;
  /** Em reais, somado em centavos. */
  aReceber: number;
  recebido: number;
  parcelasVencidas: number;
  vencido: number;
  /** Vencimento (aaaa-mm-dd) da parcela vencida mais antiga. */
  maisAntigaVencida: string | null;
  /** Vencimento (aaaa-mm-dd) da próxima parcela em aberto que ainda não venceu. */
  proximaAVencer: string | null;
}

/**
 * Soma as contas pelos números que o BANCO já calculou (`a_receber`, `vencido`, `recebido`): a faixa e a tela "A receber"
 * mostram o mesmo valor porque não há segunda conta. As parcelas só servem para contar e achar as datas.
 */
export function resumirContas(contas: ContaLida[]): ResumoDeContas {
  let aReceber = 0;
  let recebido = 0;
  let vencido = 0;
  let pagas = 0;
  let abertas = 0;
  let vencidas = 0;
  let maisAntiga: string | null = null;
  let proxima: string | null = null;
  for (const c of contas) {
    aReceber += centavos(c.a_receber);
    recebido += centavos(c.recebido);
    vencido += centavos(c.vencido);
    for (const p of c.parcelas ?? []) {
      if (p.status === "paga") {
        pagas += 1;
        continue;
      }
      abertas += 1;
      if (p.atrasada) {
        vencidas += 1;
        if (p.vencimento && (!maisAntiga || p.vencimento < maisAntiga)) maisAntiga = p.vencimento;
      } else if (p.vencimento && (!proxima || p.vencimento < proxima)) {
        proxima = p.vencimento;
      }
    }
  }
  return {
    contas: contas.length,
    parcelasPagas: pagas,
    parcelasAbertas: abertas,
    aReceber: aReceber / 100,
    recebido: recebido / 100,
    parcelasVencidas: vencidas,
    vencido: vencido / 100,
    maisAntigaVencida: maisAntiga,
    proximaAVencer: proxima,
  };
}

/** Filtra as contas de um cliente ou de uma OS (a RPC devolve a carteira inteira). */
export function contasDoCliente(contas: ContaLida[], clienteId: string): ContaLida[] {
  return contas.filter((c) => c.cliente_id === clienteId);
}
export function contasDaOs(contas: ContaLida[], osId: string): ContaLida[] {
  return contas.filter((c) => c.os_id === osId);
}

type Escopo = "os" | "cliente";

/** O elo "A receber". `null` quando a pessoa não vê o financeiro: nada a afirmar. */
export function eloDeRecebimento(leitura: Leitura<ContaLida[]>, escopo: Escopo): Elo | null {
  const base = { chave: "a-receber", rotulo: "A receber", destino: { rota: "a-receber" } as Destino };
  if (leitura.estado === "sem_acesso") return null;
  if (leitura.estado === "carregando") return { ...base, texto: "Carregando…", tom: "carregando", destino: undefined };
  if (leitura.estado === "erro") {
    return { ...base, texto: "Não foi possível ler o financeiro", tom: "erro" };
  }
  const contas = leitura.dados;
  if (contas.length === 0) {
    return {
      ...base,
      texto: escopo === "os" ? "Sem conta a receber ligada" : "Nenhuma conta a receber registrada",
      detalhe: escopo === "os" ? "A conta nasce quando o orçamento vira OS." : undefined,
      tom: "vazio",
      destino: undefined,
    };
  }
  const r = resumirContas(contas);
  if (r.parcelasAbertas === 0) {
    return {
      ...base,
      texto: "Tudo recebido",
      detalhe: `${plural(r.parcelasPagas, "parcela paga", "parcelas pagas")} · ${reais(r.recebido)}`,
      tom: "normal",
    };
  }
  const texto = `${plural(r.parcelasAbertas, "parcela em aberto", "parcelas em aberto")} · ${reais(r.aReceber)}`;
  if (r.parcelasVencidas > 0) {
    const desde = r.maisAntigaVencida ? ` · a mais antiga venceu em ${formatarData(r.maisAntigaVencida)}` : "";
    return {
      ...base,
      texto,
      detalhe: `${plural(r.parcelasVencidas, "vencida", "vencidas")} (${reais(r.vencido)})${desde}`,
      tom: "atencao",
    };
  }
  return {
    ...base,
    texto,
    detalhe: r.proximaAVencer ? `Nada vencido · a próxima vence em ${formatarData(r.proximaAVencer)}` : "Nada vencido",
    tom: "normal",
  };
}

/* ------------------------------------------------------------------ */
/* Ficha da OS                                                         */
/* ------------------------------------------------------------------ */

const ROTULO_DO_ORCAMENTO: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  convertido: "Virou OS",
  expirado: "Expirado",
  rejeitado: "Rejeitado",
};

function rotuloDoStatusDoOrcamento(status: string | null | undefined): string | null {
  if (!status) return null;
  return ROTULO_DO_ORCAMENTO[status] ?? null;
}

export interface OrcamentoResumo {
  numero: number | string | null;
  status: string | null;
}

export interface ProdutosDaOs {
  /** Itens da OS. */
  itens: number;
  /** Itens sem produto do catálogo (texto livre). */
  semProduto: number;
  /** Produtos distintos do catálogo, na ordem em que aparecem. */
  produtos: { id: string; nome: string }[];
}

export interface EntregaLida {
  tipo: string | null;
  status: string | null;
  data_agendada: string | null;
  data_realizada: string | null;
}

/** Status da OS em que já deveria existir registro de entrega ou retirada. */
const STATUS_COM_SAIDA = new Set([
  "aguardando_retirada",
  "aguardando_entrega",
  "em_entrega",
  "em_instalacao",
  "concluido",
  "faturado",
]);

export interface DadosDaOs {
  status: string | null;
  orcamento_id: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
}

export function elosDaOs(p: {
  os: DadosDaOs;
  orcamento: Leitura<OrcamentoResumo | null>;
  produtos: Leitura<ProdutosDaOs>;
  entregas: Leitura<EntregaLida[]>;
  contas: Leitura<ContaLida[]>;
  osId: string;
}): Elo[] {
  const elos: Elo[] = [];

  // Orçamento de origem. O id já vem da própria OS; a leitura só dá o número. Se ela falha, o link continua certo.
  if (!p.os.orcamento_id) {
    elos.push({
      chave: "orcamento",
      rotulo: "Orçamento de origem",
      texto: "Sem orçamento ligado",
      detalhe: "OS de balcão ou de antes do fluxo de orçamento.",
      tom: "vazio",
    });
  } else {
    const destino: Destino = { rota: "orcamento", id: p.os.orcamento_id };
    const o = p.orcamento;
    if (o.estado === "ok" && o.dados) {
      elos.push({
        chave: "orcamento",
        rotulo: "Orçamento de origem",
        texto: o.dados.numero != null ? `Orçamento #${o.dados.numero}` : "Orçamento de origem",
        detalhe: rotuloDoStatusDoOrcamento(o.dados.status) ?? undefined,
        tom: "normal",
        destino,
      });
    } else {
      elos.push({
        chave: "orcamento",
        rotulo: "Orçamento de origem",
        texto: o.estado === "carregando" ? "Carregando…" : "Orçamento de origem ligado",
        tom: o.estado === "carregando" ? "carregando" : "normal",
        destino,
      });
    }
  }

  // Cliente.
  if (p.os.cliente_id) {
    elos.push({
      chave: "cliente",
      rotulo: "Cliente",
      texto: p.os.cliente_nome?.trim() || "Cliente ligado",
      tom: "normal",
      destino: { rota: "cliente", id: p.os.cliente_id },
    });
  } else {
    elos.push({ chave: "cliente", rotulo: "Cliente", texto: "Sem cliente ligado", tom: "atencao" });
  }

  // Produtos: o produto da OS vive nos itens (ordens_servico.produto_id não é preenchido).
  const prod = p.produtos;
  if (prod.estado === "carregando") {
    elos.push({ chave: "produtos", rotulo: "Produtos", texto: "Carregando…", tom: "carregando" });
  } else if (prod.estado === "erro") {
    elos.push({ chave: "produtos", rotulo: "Produtos", texto: "Não foi possível ler os itens", tom: "erro" });
  } else if (prod.estado === "ok") {
    const d = prod.dados;
    const aviso = d.semProduto > 0 ? `${plural(d.semProduto, "item", "itens")} sem produto do catálogo` : undefined;
    if (d.itens === 0) {
      elos.push({ chave: "produtos", rotulo: "Produtos", texto: "Sem itens na OS", tom: "vazio" });
    } else if (d.produtos.length === 0) {
      elos.push({
        chave: "produtos",
        rotulo: "Produtos",
        texto: "Nenhum item é de produto do catálogo",
        detalhe: aviso,
        tom: "vazio",
      });
    } else if (d.produtos.length === 1) {
      elos.push({
        chave: "produtos",
        rotulo: "Produto",
        texto: d.produtos[0].nome,
        detalhe: aviso,
        tom: "normal",
        destino: { rota: "produto", id: d.produtos[0].id },
      });
    } else {
      const nomes = d.produtos.map((x) => x.nome);
      const mostrados = nomes.slice(0, 3).join(", ") + (nomes.length > 3 ? "…" : "");
      elos.push({
        chave: "produtos",
        rotulo: "Produtos",
        texto: `${d.produtos.length} produtos do catálogo`,
        detalhe: aviso ? `${mostrados} · ${aviso}` : mostrados,
        tom: "normal",
      });
    }
  }

  // Entrega ou retirada.
  const ent = p.entregas;
  if (ent.estado === "carregando") {
    elos.push({ chave: "entrega", rotulo: "Entrega ou retirada", texto: "Carregando…", tom: "carregando" });
  } else if (ent.estado === "erro") {
    elos.push({
      chave: "entrega",
      rotulo: "Entrega ou retirada",
      texto: "Não foi possível ler as entregas",
      tom: "erro",
    });
  } else if (ent.estado === "ok") {
    const entregas = ent.dados;
    if (entregas.length === 0) {
      const devia = p.os.status ? STATUS_COM_SAIDA.has(p.os.status) : false;
      elos.push({
        chave: "entrega",
        rotulo: "Entrega ou retirada",
        texto: "Sem registro de entrega ou retirada",
        detalhe: devia ? "A OS já saiu da produção e ninguém registrou a saída." : undefined,
        tom: devia ? "atencao" : "vazio",
        destino: { rota: "entregas" },
      });
    } else {
      const ultima = [...entregas].sort((a, b) =>
        String(b.data_realizada ?? b.data_agendada ?? "").localeCompare(String(a.data_realizada ?? a.data_agendada ?? "")),
      )[0];
      const tipo = ultima.tipo === "retirada" ? "Retirada" : ultima.tipo === "entrega" ? "Entrega" : "Saída";
      const situacao =
        ultima.status === "concluida" ? "concluída" : ultima.status === "agendada" ? "agendada" : (ultima.status ?? "registrada");
      const quando = dataDoInstante(ultima.data_realizada ?? ultima.data_agendada);
      elos.push({
        chave: "entrega",
        rotulo: "Entrega ou retirada",
        texto: `${tipo} ${situacao}`,
        detalhe: [quando, entregas.length > 1 ? `${entregas.length} registros` : null].filter(Boolean).join(" · ") || undefined,
        tom: "normal",
        destino: { rota: "entregas" },
      });
    }
  }

  const receber = eloDeRecebimento(p.contas, "os");
  if (receber) elos.push(receber);
  return elos;
}

/* ------------------------------------------------------------------ */
/* Ficha do orçamento                                                  */
/* ------------------------------------------------------------------ */

export interface DadosDoOrcamento {
  status: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  os_id: string | null;
  enviado_em: string | null;
}

export interface OsResumo {
  numero: number | string | null;
  status: string | null;
}

export interface EnvioLido {
  canal: string | null;
  enviado_em: string | null;
}

function rotuloDoCanal(canal: string | null): string {
  if (canal === "whatsapp_sistema") return "pelo WhatsApp do sistema";
  if (canal === "wa_me") return "pelo WhatsApp do celular (wa.me)";
  return canal ? `por ${canal}` : "";
}

export function elosDoOrcamento(p: {
  orc: DadosDoOrcamento;
  os: Leitura<OsResumo | null>;
  envios: Leitura<EnvioLido[]>;
  conversa: Leitura<{ id: string } | null>;
}): Elo[] {
  const elos: Elo[] = [];
  const jaSaiuDoRascunho = p.orc.status != null && p.orc.status !== "rascunho";

  if (p.orc.cliente_id) {
    elos.push({
      chave: "cliente",
      rotulo: "Cliente",
      texto: p.orc.cliente_nome?.trim() || "Cliente ligado",
      tom: "normal",
      destino: { rota: "cliente", id: p.orc.cliente_id },
    });
  } else {
    elos.push({
      chave: "cliente",
      rotulo: "Cliente",
      texto: "Sem cliente cadastrado ligado",
      detalhe: jaSaiuDoRascunho ? "A OS só nasce com o cliente ligado." : undefined,
      tom: jaSaiuDoRascunho ? "atencao" : "vazio",
    });
  }

  // OS gerada.
  if (p.orc.os_id) {
    const destino: Destino = { rota: "os", id: p.orc.os_id };
    const o = p.os;
    if (o.estado === "ok" && o.dados) {
      elos.push({
        chave: "os",
        rotulo: "OS gerada",
        texto: o.dados.numero != null ? `OS #${o.dados.numero}` : "OS ligada",
        detalhe: o.dados.status ? rotuloDoStatusDaOs(o.dados.status) : undefined,
        tom: "normal",
        destino,
      });
    } else {
      elos.push({
        chave: "os",
        rotulo: "OS gerada",
        texto: o.estado === "carregando" ? "Carregando…" : "OS ligada",
        tom: o.estado === "carregando" ? "carregando" : "normal",
        destino,
      });
    }
  } else if (p.orc.status === "aprovado") {
    elos.push({
      chave: "os",
      rotulo: "OS gerada",
      texto: "Aprovado e ainda sem OS",
      detalhe: "Converta em OS para a produção começar.",
      tom: "atencao",
    });
  } else {
    elos.push({ chave: "os", rotulo: "OS gerada", texto: "Ainda sem OS", tom: "vazio" });
  }

  // Envios registrados pelo sistema.
  const env = p.envios;
  if (env.estado === "carregando") {
    elos.push({ chave: "envios", rotulo: "Envios ao cliente", texto: "Carregando…", tom: "carregando" });
  } else if (env.estado === "erro") {
    elos.push({ chave: "envios", rotulo: "Envios ao cliente", texto: "Não foi possível ler os envios", tom: "erro" });
  } else if (env.estado === "ok") {
    const envios = env.dados;
    if (envios.length > 0) {
      const ultimo = [...envios].sort((a, b) => String(b.enviado_em ?? "").localeCompare(String(a.enviado_em ?? "")))[0];
      const quando = dataEHora(ultimo.enviado_em);
      const canal = rotuloDoCanal(ultimo.canal);
      elos.push({
        chave: "envios",
        rotulo: "Envios ao cliente",
        texto: envios.length === 1 ? "Enviado 1 vez" : `Enviado ${envios.length} vezes`,
        detalhe: [quando ? `último em ${quando}` : null, canal || null].filter(Boolean).join(" · ") || undefined,
        tom: "normal",
      });
    } else {
      const marcado = dataDoInstante(p.orc.enviado_em);
      elos.push({
        chave: "envios",
        rotulo: "Envios ao cliente",
        texto: marcado ? "Sem registro de envio pelo sistema" : "Ainda não enviado",
        detalhe: marcado ? `Marcado como enviado em ${marcado}.` : undefined,
        tom: "vazio",
      });
    }
  }

  // Conversa: só aparece quando existe e a pessoa lê o WhatsApp. Não achar não é prova de que não houve conversa.
  if (p.conversa.estado === "ok" && p.conversa.dados) {
    elos.push({
      chave: "conversa",
      rotulo: "Conversa",
      texto: "Conversa com o cliente",
      tom: "normal",
      destino: { rota: "conversa", id: p.conversa.dados.id },
    });
  }
  return elos;
}

/* ------------------------------------------------------------------ */
/* Ficha do cliente                                                    */
/* ------------------------------------------------------------------ */

export interface ParceiroResumo {
  id: string;
  marca_nome: string | null;
  status: string | null;
}

export function elosDoCliente(p: {
  contas: Leitura<ContaLida[]>;
  parceiro: Leitura<ParceiroResumo | null>;
}): Elo[] {
  const elos: Elo[] = [];
  const receber = eloDeRecebimento(p.contas, "cliente");
  if (receber) elos.push(receber);
  // É parceiro: aparece só quando é. Quem não lê parceiros não vê, e não ser parceiro não precisa de aviso.
  if (p.parceiro.estado === "ok" && p.parceiro.dados) {
    const pa = p.parceiro.dados;
    elos.push({
      chave: "parceiro",
      rotulo: "Parceiro",
      texto: pa.marca_nome?.trim() ? `Parceiro: ${pa.marca_nome.trim()}` : "É parceiro da casa",
      detalhe: pa.status ? `Cadastro ${pa.status}` : undefined,
      tom: "normal",
      destino: { rota: "parceiros" },
    });
  }
  return elos;
}
