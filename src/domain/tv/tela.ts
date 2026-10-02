/**
 * Do painel (contrato v2) para o que a parede ESCREVE: textos, cores, listas.
 *
 * O princípio da revisão 2.1 do desenho: o número grande no alto tem de ser
 * contável nas comandas penduradas. Se o cartão diz "2 atrasadas", quem olha
 * acha duas OS marcadas de vermelho — nas colunas ou nas fichas dos minis.
 * Este arquivo monta tudo o que vai para a tela e, no fim, CONFERE isso
 * (regra R7) sobre o que montou. Qualquer diferença vira falha nomeada, que a
 * tela mostra na faixa âmbar "NÚMERO INCONSISTENTE".
 *
 * O que vem pronto do banco a tela não refaz: totais, estados das máquinas,
 * ordem das filas, horas locais. O que a tela deriva está marcado como tal.
 *
 * Domínio puro: sem DOM, sem relógio do aparelho. "Agora" aqui é SEMPRE o
 * instante do dado (gerado_em): duração e barra de progresso congelam quando o
 * dado para de chegar — regra (h) do contrato.
 */

import { POR_TIPO, type IdentidadeMaquina } from "@/domain/producao/identidade-da-maquina";
import { duracao } from "./frescor";
import {
  TOPO_DA_LISTA,
  type BlocoDaParede,
  type Evento,
  type FalhaDeConsistencia,
  type MaquinaDoPainel,
  type PainelDaOficina,
  type Saida,
  type TrabalhoAgora,
  type TrabalhoNaFila,
} from "./painel";

/* ------------------------------------------------------------------------- */
/* Identidade da máquina                                                      */
/* ------------------------------------------------------------------------- */

/** Coluna sem tipo conhecido: ícone genérico, cinza — nunca inventa máquina. */
const IDENTIDADE_GENERICA: IdentidadeMaquina = {
  chave: "desconhecida",
  curto: "Máquina",
  icone: "Factory",
  cor: "#8b94a7",
};

/** A identidade (nome curto, ícone, cor) do arquivo que o Kanban já usa. */
export function identidadePorTipo(tipo: string): IdentidadeMaquina {
  return POR_TIPO[tipo] ?? IDENTIDADE_GENERICA;
}

/** "IMPRESSÃO", "LASER CO2" — como o nome aparece em cima da coluna e nos eventos. */
export function nomeCurto(tipo: string | null | undefined): string {
  return identidadePorTipo(tipo ?? "").curto.toUpperCase();
}

/* ------------------------------------------------------------------------- */
/* Estados, prazos e textos de apoio                                          */
/* ------------------------------------------------------------------------- */

export const PALAVRA_DO_ESTADO: Record<MaquinaDoPainel["estado"], string> = {
  rodando: "RODANDO",
  nao_fechou: "NÃO FECHOU",
  bloqueada: "BLOQUEADA",
  reservada: "RESERVADA",
  pelo_status: "NA MÁQUINA",
  livre: "LIVRE",
  sem_registro: "SEM REGISTRO",
};

/** A classe CSS da coluna: é dela a cor da borda, da palavra e da barra. */
export function classeDoEstado(estado: MaquinaDoPainel["estado"]): string {
  return `e-${estado}`;
}

export type ChaveDePrazo = "atr" | "hoje" | "amanha";

/** Etiqueta de PRAZO: um significado só, nas cores dos três cartões grandes. */
export type EtiquetaDePrazo = { k: ChaveDePrazo; texto: string };

export const CARTOES_DE_PRAZO: {
  k: ChaveDePrazo;
  nome: string;
  icone: "TriangleAlert" | "Clock" | "CalendarClock";
}[] = [
  { k: "atr", nome: "ATRASADAS", icone: "TriangleAlert" },
  { k: "hoje", nome: "PRAZO HOJE", icone: "Clock" },
  { k: "amanha", nome: "PRAZO AMANHÃ", icone: "CalendarClock" },
];

/**
 * A etiqueta de uma linha. Atraso vem com a OS; HOJE/AMANHÃ vêm na linha da
 * fila ou, para o trabalho de agora (que não traz `prazo`), das listas dos
 * cartões. Prazo mais longe não tem etiqueta: a função viva não manda a data.
 */
export function etiquetaDePrazo(
  diasAtraso: number | null,
  prazo: "hoje" | "amanha" | null,
): EtiquetaDePrazo | null {
  if (diasAtraso !== null && diasAtraso > 0) return { k: "atr", texto: `${diasAtraso}d` };
  if (prazo === "hoje") return { k: "hoje", texto: "HOJE" };
  if (prazo === "amanha") return { k: "amanha", texto: "AMANHÃ" };
  return null;
}

/** O texto do trabalho: SÓ o nome do produto do catálogo; nunca descrição digitada. */
export function nomeDoItem(t: Pick<TrabalhoAgora, "produto" | "item" | "itens_na_os">): string {
  switch (t.item) {
    case "produto":
      return t.produto ?? "item sob medida";
    case "sob_medida":
      return "item sob medida";
    case "varios":
      return `${t.itens_na_os ?? "vários"} itens`;
    case "sem_item":
      return "sem item cadastrado";
  }
}

/* ------------------------------------------------------------------------- */
/* Eventos e saídas                                                           */
/* ------------------------------------------------------------------------- */

/** A frase do canto, montada do tipo (lista fechada) + máquina + nº. Nada vem pronto do banco. */
export function fraseDoEvento(
  e: Evento,
  tipoDaMaquina: (id: string | null) => string | null,
): string {
  const os = e.os_numero === null ? "OS sem número" : `#${e.os_numero}`;
  const maq = nomeCurto(tipoDaMaquina(e.maquina_id));
  switch (e.tipo) {
    case "apontamento_iniciado":
      return `${maq} começou ${os}`;
    case "apontamento_finalizado":
      return `${maq} terminou ${os}`;
    case "os_entrou_na_fila":
      return `${os} entrou na fila`;
    case "os_foi_para_acabamento":
      return `${os} foi para o acabamento`;
    case "os_ficou_pronta":
      return `${os} ficou pronta`;
  }
}

export const COR_DA_SAIDA: Record<Saida["tipo"], string> = {
  retirada: "#BCF125",
  entrega: "#10B981",
  instalacao: "#F97316",
  bloqueio: "#8b94a7",
  reserva: "#8b94a7",
};

const NOME_DA_SAIDA: Record<Exclude<Saida["tipo"], "bloqueio" | "reserva">, string> = {
  retirada: "RETIRADA",
  entrega: "ENTREGA",
  instalacao: "INSTALAÇÃO",
};

export type CartaoDeSaida = {
  chave: string;
  quando: "hoje" | "amanha";
  /** "HOJE 16:30" / "AMANHÃ" */
  quandoTexto: string;
  /** "INSTALAÇÃO #204" / "FIBER · BLOQUEIO" */
  oQue: string;
  cor: string;
};

/**
 * Os cartões do letreiro. Reserva de máquina com OS NÃO entra (decisão j do
 * desenho: ela já é uma linha da fila da coluna) — a função manda e a tela
 * deixa de fora.
 */
export function cartoesDeSaida(
  saidas: Saida[],
  tipoDaMaquina: (id: string | null) => string | null,
): CartaoDeSaida[] {
  const cartoes: CartaoDeSaida[] = [];
  saidas.forEach((s, i) => {
    if (s.tipo === "reserva") return;
    cartoes.push({
      chave: `${s.tipo}-${s.os_numero ?? s.maquina_id ?? i}-${s.quando}`,
      quando: s.quando,
      quandoTexto:
        (s.quando === "hoje" ? "HOJE" : "AMANHÃ") + (s.hora_local ? ` ${s.hora_local}` : ""),
      oQue:
        s.tipo === "bloqueio"
          ? `${nomeCurto(tipoDaMaquina(s.maquina_id))} · BLOQUEIO`
          : `${NOME_DA_SAIDA[s.tipo]} ${s.os_numero === null ? "sem número" : `#${s.os_numero}`}`,
      cor: COR_DA_SAIDA[s.tipo],
    });
  });
  return cartoes;
}

/* ------------------------------------------------------------------------- */
/* Falhas de consistência, em português                                       */
/* ------------------------------------------------------------------------- */

/** A frase da faixa âmbar para cada `detalhe` que a função devolve. */
export function fraseDaFalha(f: FalhaDeConsistencia): string {
  switch (f.detalhe) {
    case "os_sem_bloco":
      return `R1: ${f.quantas ?? "?"} OS com status sem bloco (${f.esperado} abertas na parede, os blocos somam ${f.obtido})`;
    case "abertas_divergem":
      return `R1: ${f.esperado} abertas na parede pela contagem direta e ${f.obtido} pela parede`;
    case "oficina_diverge_das_colunas":
      return `R2: oficina ${f.esperado}, colunas + sem máquina ${f.obtido}`;
    case "os_em_coluna_e_sem_maquina":
      return `R2: ${f.obtido} OS em coluna e em FILA SEM MÁQUINA ao mesmo tempo`;
    case "atrasadas_divergem":
      return `R3 em ATRASADAS: as partes somam ${f.obtido} e o cartão diz ${f.esperado}`;
    case "rodando_diverge":
      return `R4: ${f.obtido} colunas rodando para ${f.esperado} apontamentos abertos no teto`;
    case "apontamento_aberto_sem_maquina_ativa":
      return `R4: apontamento aberto da OS ${f.os_numero == null ? "sem número" : `#${f.os_numero}`} sem máquina ativa`;
    case "prontas_maior_que_saida":
      return `R5: ${f.obtido} prontas hoje para ${f.esperado} OS na saída`;
    case "fila_menor_que_a_lista":
      return `R5: fila com total ${f.obtido} e lista de ${f.esperado}`;
    case "maquinas_ativas_demais":
      return `R6: ${f.obtido} máquinas ativas; a tela foi desenhada para ${f.esperado}`;
    case "colunas_divergem_das_ativas":
      return `R6: ${f.esperado} máquinas ativas e ${f.obtido} colunas`;
    default:
      return `${f.regra}: esperado ${f.esperado}, obtido ${f.obtido}${f.detalhe ? ` (${f.detalhe})` : ""}`;
  }
}

/* ------------------------------------------------------------------------- */
/* O que vai para a tela                                                      */
/* ------------------------------------------------------------------------- */

export type Chip = { texto: string; cor: "neon" | "branco" | "cinza" | "amarelo" };

export type CartaoGrande = {
  k: ChaveDePrazo;
  nome: string;
  icone: "TriangleAlert" | "Clock" | "CalendarClock";
  total: number;
  /** a sublinha ("MÁQUINAS 2 · FORA 0", "1 JÁ PRONTA", "1 ABERTA SEM PRAZO") */
  sub: string;
  zero: boolean;
  pulsa: boolean;
};

export type Fichas = Record<ChaveDePrazo, number | null>;

export type Mini = {
  chave: "entrada_e_arte" | "sem_maquina" | "acabamento" | "na_saida";
  rotulo: string;
  total: number;
  /** quantas OS de cada cartão grande estão neste bloco (null = a lista veio cortada, não dá para saber) */
  fichas: Fichas;
  /** "2 c/ cliente", "1 retrabalho", "2 no balcão" */
  apoio: string | null;
  /** FILA SEM MÁQUINA: o nº da OS em destaque ("#220", "#220 · +2") */
  destaque: string | null;
  alerta: boolean;
};

export type LinhaDaFila = {
  chave: string;
  osNumero: number;
  /** "1/2" (OS em 2 máquinas), "?" (máquina provável) ou "" */
  marca: string;
  prazo: EtiquetaDePrazo | null;
  /** "PAUSADA" à direita, ou "" */
  direita: string;
  classe: "" | "prov" | "pausa";
  produto: string;
};

export type Coluna = {
  id: string;
  identidade: IdentidadeMaquina;
  estado: MaquinaDoPainel["estado"];
  palavra: string;
  classe: string;
  /** "desde 14:05 · 1h20", "15:00 às 16:30", "até 17:00", "pelo status há 2h15" */
  desde: string;
  agora: {
    osNumero: number;
    produto: string;
    parte: string | null;
    prazo: EtiquetaDePrazo | null;
    nota: string;
    estourou: boolean;
    /** apontamento numa OS de outro bloco: a coluna mostra, mas ela conta no bloco dela */
    foraDaOficina: boolean;
  } | null;
  /** barra de progresso 0–100, sempre no instante do dado */
  pct: number;
  estourou: boolean;
  /** linhas de apoio quando não há trabalho de agora */
  notas: string[];
  /** nunca houve apontamento: a coluna ensina o próximo passo */
  dica: boolean;
  fila: LinhaDaFila[];
  filaTotal: number;
  /** a fila veio cortada em TOPO_DA_LISTA: a conferência R7 não enxerga o resto */
  filaCortada: boolean;
  /** aviso na linha do DEPOIS, um por vez */
  aviso: { texto: string; ambar: boolean } | null;
};

export type Canto = { c1: string; c2: string };

export type FaixaDoPainel = {
  classe: "ambar" | "cinza";
  icone: "TriangleAlert" | "CircleAlert";
  texto: string;
};

export type TelaDaOficina = {
  chips: Chip[];
  cartoes: CartaoGrande[];
  minis: Mini[];
  colunas: Coluna[];
  saidas: CartaoDeSaida[];
  canto: Canto;
  /** as falhas da função + as da conferência R7, já em frase */
  falhas: string[];
  faixa: FaixaDoPainel | null;
  /** o resumo da conferência R7, para log e teste */
  conferencia: string;
};

/** "28/09 17:10" → "28/09"; "17:10" (hoje) → "hoje". */
function diaDaHoraLocal(horaLocal: string | null): string {
  if (!horaLocal) return "nunca";
  const partes = horaLocal.trim().split(" ");
  return partes.length > 1 ? partes[0] : "hoje";
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

/**
 * Monta a tela inteira a partir do painel. `agoraDoDadoMs` é o `gerado_em` em
 * milissegundos — é com ele que a duração e a barra são calculadas.
 */
export function montarTela(painel: PainelDaOficina, agoraDoDadoMs: number): TelaDaOficina {
  const tipoDaMaquina = (id: string | null): string | null =>
    id ? (painel.maquinas.find((m) => m.id === id)?.tipo ?? null) : null;
  const maquinas = [...painel.maquinas].sort(
    (a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id),
  );

  /* ---------- chips do cabeçalho ---------- */
  const registrosHoje = painel.registro.apontamentos_hoje + painel.registro.jobs_3d_hoje;
  const chips: Chip[] = [];
  if (registrosHoje === 0) chips.push({ texto: "— RODANDO", cor: "cinza" });
  else {
    chips.push({
      texto: `${painel.rodando.total}/${painel.rodando.de} RODANDO`,
      cor: painel.rodando.total > 0 ? "neon" : "branco",
    });
  }
  if (painel.registro.apontamentos_hoje > 0) {
    chips.push({
      texto: `${painel.registro.apontamentos_hoje} APONT. HOJE · ${painel.registro.ultimo_apontamento_local ?? "—"}`,
      cor: "cinza",
    });
  } else if (painel.registro.jobs_3d_hoje > 0) {
    chips.push({
      texto: `${painel.registro.jobs_3d_hoje} JOB 3D HOJE · ${painel.registro.ultimo_job_3d_local ?? "—"}`,
      cor: "cinza",
    });
  } else if (!painel.registro.sem_apontamento_em_7_dias) {
    const ultimo =
      painel.registro.ultimo_registro_local ?? painel.registro.ultimo_apontamento_local;
    chips.push({ texto: `SEM APONT. HOJE · ÚLT. ${diaDaHoraLocal(ultimo)}`, cor: "amarelo" });
  }

  /* ---------- quem está em qual coluna (derivado: a função não manda "1/2") ---------- */
  const colunasDaOs = new Map<number, number[]>();
  maquinas.forEach((m, i) => {
    const nesta = new Set<number>();
    if (m.agora) nesta.add(m.agora.os_numero);
    for (const f of m.fila.itens) nesta.add(f.os_numero);
    for (const os of nesta) colunasDaOs.set(os, [...(colunasDaOs.get(os) ?? []), i]);
  });
  const parteDe = (os: number, coluna: number): string | null => {
    const cols = colunasDaOs.get(os) ?? [];
    return cols.length > 1 ? `${cols.indexOf(coluna) + 1}/${cols.length}` : null;
  };

  /* ---------- prazo do trabalho de agora: pelas listas dos cartões ---------- */
  const prazoHojeSet = new Set(painel.cartoes.prazo_hoje.itens.map((i) => i.os_numero));
  const prazoAmanhaSet = new Set(painel.cartoes.prazo_amanha.itens.map((i) => i.os_numero));
  const prazoDoAgora = (t: TrabalhoAgora): EtiquetaDePrazo | null =>
    etiquetaDePrazo(
      t.dias_atraso,
      prazoHojeSet.has(t.os_numero) ? "hoje" : prazoAmanhaSet.has(t.os_numero) ? "amanha" : null,
    );

  /* ---------- as cinco colunas ---------- */
  const colunas: Coluna[] = maquinas.map((m, i) => {
    const identidade = identidadePorTipo(m.tipo);
    const c: Coluna = {
      id: m.id,
      identidade,
      estado: m.estado,
      palavra: PALAVRA_DO_ESTADO[m.estado],
      classe: classeDoEstado(m.estado),
      desde: "",
      agora: null,
      pct: 0,
      estourou: false,
      notas: [],
      dica: false,
      fila: [],
      filaTotal: m.fila.total,
      filaCortada: m.fila.total > m.fila.itens.length,
      aviso: null,
    };
    const desdeMs = m.desde_em ? Date.parse(m.desde_em) : NaN;
    const passouMs = Number.isFinite(desdeMs) ? Math.max(0, agoraDoDadoMs - desdeMs) : null;
    const agoraDe = (t: TrabalhoAgora, nota: string) => ({
      osNumero: t.os_numero,
      produto: nomeDoItem(t),
      parte: parteDe(t.os_numero, i),
      // Apontamento numa OS de outro bloco: o nº aparece, mas sem etiqueta —
      // ela já está na ficha do bloco dela, e marcar aqui faria o cartão não fechar.
      prazo: t.fora_da_oficina ? null : prazoDoAgora(t),
      nota,
      estourou: false,
      foraDaOficina: t.fora_da_oficina === true,
    });

    switch (m.estado) {
      case "rodando": {
        c.desde = `desde ${m.desde_local ?? "—"}${passouMs !== null ? ` · ${duracao(passouMs)}` : ""}`;
        if (m.agora) {
          const min = m.agora.minutos_previstos;
          let nota = "sem previsão";
          if (min && min > 0 && passouMs !== null) {
            c.pct = Math.min(100, Math.round((passouMs / 60_000 / min) * 100));
            c.estourou = passouMs / 60_000 > min;
            nota = `${c.estourou ? "passou de" : "previsto"} ${duracao(min * 60_000)}`;
          }
          c.agora = { ...agoraDe(m.agora, nota), estourou: c.estourou };
        }
        break;
      }
      case "nao_fechou": {
        c.desde = `desde ${m.desde_local ?? "—"}`;
        if (m.agora) c.agora = agoraDe(m.agora, "não encerrado");
        break;
      }
      case "bloqueada": {
        c.desde = `até ${m.janela?.fim_local ?? "—"}`;
        c.notas = ["bloqueio da agenda", "(reserva sem OS)"];
        break;
      }
      case "reservada": {
        c.desde = `${m.janela?.inicio_local ?? m.desde_local ?? "—"} às ${m.janela?.fim_local ?? "—"}`;
        if (m.agora) c.agora = agoraDe(m.agora, "falta apontar");
        break;
      }
      case "pelo_status": {
        c.desde = `pelo status${passouMs !== null ? ` há ${duracao(passouMs)}` : ""}`;
        if (m.agora) c.agora = agoraDe(m.agora, "falta apontar");
        break;
      }
      case "livre": {
        c.desde = `desde ${m.desde_local ?? "—"}`;
        // A prova do LIVRE: a tela não junta a hora do job 3D com o nº da OS do último apontamento.
        if (m.livre_por === "job_3d")
          c.notas = ["último: job 3D", `terminou ${m.desde_local ?? "—"}`];
        else if (m.ultimo_apontamento_os_numero !== null) {
          c.notas = [
            `último: OS #${m.ultimo_apontamento_os_numero}`,
            `terminou ${m.desde_local ?? "—"}`,
          ];
        } else c.notas = [`terminou ${m.desde_local ?? "—"}`];
        break;
      }
      case "sem_registro": {
        c.desde = "ninguém apontou hoje";
        if (m.ultimo_apontamento_local)
          c.notas = ["último apontamento:", m.ultimo_apontamento_local];
        else if (m.ultimo_job_3d_local) c.notas = ["último job 3D:", m.ultimo_job_3d_local];
        else c.dica = true;
        break;
      }
    }

    c.fila = m.fila.itens.map((f: TrabalhoNaFila, j): LinhaDaFila => {
      const provavel = f.origem === "produto";
      const parte = parteDe(f.os_numero, i);
      return {
        chave: `${f.os_numero}-${j}`,
        osNumero: f.os_numero,
        marca: parte ?? (provavel && !f.pausada ? "?" : ""),
        prazo: etiquetaDePrazo(f.dias_atraso, f.prazo),
        direita: f.pausada ? "PAUSADA" : "",
        classe: f.pausada ? "pausa" : provavel ? "prov" : "",
        produto: nomeDoItem(f),
      };
    });

    if (m.reservas_vencidas.total > 0) {
      c.aviso = {
        texto: `${m.reservas_vencidas.total} ${plural(m.reservas_vencidas.total, "res. vencida", "res. vencidas")}`,
        ambar: true,
      };
    } else if (m.a_caminho > 0) c.aviso = { texto: `+${m.a_caminho} na arte`, ambar: false };
    else if (c.fila.some((f) => f.classe === "prov"))
      c.aviso = { texto: "? = sem reserva", ambar: false };
    return c;
  });

  /* ---------- fichas dos minis (derivadas dos totais e das listas dos cartões) ---------- */
  const semMaquinaSet = new Set(painel.blocos.sem_maquina.itens.map((i) => i.os_numero));
  const semMaquinaCortada =
    painel.blocos.sem_maquina.total > painel.blocos.sem_maquina.itens.length;
  const fichasDePrazo = (cartao: {
    total: number;
    ja_prontas: number;
    itens: { os_numero: number; bloco: BlocoDaParede }[];
  }) => {
    const acabamento = cartao.itens.filter((x) => x.bloco === "acabamento").length;
    const oficina = cartao.itens.filter((x) => x.bloco === "oficina");
    const semMaquina = oficina.filter((x) => semMaquinaSet.has(x.os_numero)).length;
    // A lista numera oficina + acabamento e vem cortada em 12. Com corte, o que
    // sobra para ENTRADA E ARTE não se calcula — fica null, nunca um chute.
    const completa =
      cartao.itens.length < TOPO_DA_LISTA ||
      cartao.total - cartao.ja_prontas === cartao.itens.length;
    const entradaArte = completa
      ? Math.max(0, cartao.total - cartao.ja_prontas - cartao.itens.length)
      : null;
    return {
      entradaArte,
      semMaquina: semMaquinaCortada ? null : semMaquina,
      acabamento: completa ? acabamento : null,
      saida: cartao.ja_prontas,
      completa: completa && !semMaquinaCortada,
      nasColunas: completa ? oficina.length - semMaquina : null,
    };
  };
  const fHoje = fichasDePrazo(painel.cartoes.prazo_hoje);
  const fAmanha = fichasDePrazo(painel.cartoes.prazo_amanha);
  const b = painel.blocos;

  const sm = painel.blocos.sem_maquina.itens;
  const outras = painel.blocos.sem_maquina.total - 1;
  const destaque =
    sm.length === 0
      ? null
      : outras > 0
        ? `#${sm[0].os_numero} · +${outras}`
        : `#${sm[0].os_numero}`;
  const minis: Mini[] = [
    {
      chave: "entrada_e_arte",
      rotulo: "ENTRADA E ARTE",
      total: b.entrada_arte.total,
      fichas: {
        atr: b.entrada_arte.atrasadas,
        hoje: fHoje.entradaArte,
        amanha: fAmanha.entradaArte,
      },
      apoio: b.entrada_arte.com_cliente > 0 ? `${b.entrada_arte.com_cliente} c/ cliente` : null,
      destaque: null,
      alerta: false,
    },
    {
      chave: "sem_maquina",
      rotulo: "FILA SEM MÁQUINA",
      total: b.sem_maquina.total,
      fichas: { atr: b.sem_maquina.atrasadas, hoje: fHoje.semMaquina, amanha: fAmanha.semMaquina },
      apoio: null,
      destaque,
      alerta: b.sem_maquina.total > 0,
    },
    {
      chave: "acabamento",
      rotulo: "ACABAMENTO",
      total: b.acabamento.total,
      fichas: { atr: b.acabamento.atrasadas, hoje: fHoje.acabamento, amanha: fAmanha.acabamento },
      apoio: b.acabamento.retrabalho > 0 ? `${b.acabamento.retrabalho} retrabalho` : null,
      destaque: null,
      alerta: false,
    },
    {
      chave: "na_saida",
      rotulo: "NA SAÍDA",
      total: b.saida.total,
      fichas: { atr: b.saida.atrasadas, hoje: fHoje.saida, amanha: fAmanha.saida },
      apoio:
        b.saida.no_balcao > 0
          ? `${b.saida.no_balcao} no balcão`
          : b.saida.entrega > 0
            ? `${b.saida.entrega} entrega`
            : null,
      destaque: null,
      alerta: false,
    },
  ];

  /* ---------- os três cartões grandes ---------- */
  // A função conta a FILA SEM MÁQUINA em "nas_maquinas"; na parede ela é uma
  // ficha num mini, então a sublinha a reparte: MÁQUINAS = marcadas nas colunas.
  const atrasadasNasColunas = painel.cartoes.atrasadas.nas_maquinas - b.sem_maquina.atrasadas;
  const atrasadasFora = painel.cartoes.atrasadas.fora + b.sem_maquina.atrasadas;
  let semPrazoUsado = false;
  const semPrazo = (): string => {
    const n = painel.cartoes.abertas_sem_prazo;
    if (n === 0 || semPrazoUsado) return "";
    semPrazoUsado = true;
    return `${n} ${plural(n, "ABERTA", "ABERTAS")} SEM PRAZO`;
  };
  const prontas = (n: number) => `${n} ${plural(n, "JÁ PRONTA", "JÁ PRONTAS")}`;
  const cartoes: CartaoGrande[] = [
    {
      k: "atr",
      nome: "ATRASADAS",
      icone: "TriangleAlert",
      total: painel.cartoes.atrasadas.total,
      sub:
        painel.cartoes.atrasadas.total > 0
          ? `MÁQUINAS ${atrasadasNasColunas} · FORA ${atrasadasFora}`
          : semPrazo(),
      zero: painel.cartoes.atrasadas.total === 0,
      pulsa: painel.cartoes.atrasadas.total > 0,
    },
    {
      k: "hoje",
      nome: "PRAZO HOJE",
      icone: "Clock",
      total: painel.cartoes.prazo_hoje.total,
      sub:
        painel.cartoes.prazo_hoje.total > 0
          ? prontas(painel.cartoes.prazo_hoje.ja_prontas)
          : semPrazo(),
      zero: painel.cartoes.prazo_hoje.total === 0,
      pulsa: false,
    },
    {
      k: "amanha",
      nome: "PRAZO AMANHÃ",
      icone: "CalendarClock",
      total: painel.cartoes.prazo_amanha.total,
      sub:
        painel.cartoes.prazo_amanha.total > 0
          ? prontas(painel.cartoes.prazo_amanha.ja_prontas)
          : semPrazo(),
      zero: painel.cartoes.prazo_amanha.total === 0,
      pulsa: false,
    },
  ];

  /* ---------- letreiro e canto ---------- */
  const saidas = cartoesDeSaida(painel.saidas.itens, tipoDaMaquina);
  const ultimoDeHoje = painel.eventos.itens_de_hoje[0] ?? null;
  const canto: Canto = ultimoDeHoje
    ? {
        c1: `Evento ${painel.eventos.total_de_hoje} de hoje · ${ultimoDeHoje.hora_local}`,
        c2: fraseDoEvento(ultimoDeHoje, tipoDaMaquina),
      }
    : {
        c1: "Sem evento hoje",
        c2: painel.eventos.ultimo
          ? `último movimento: ${painel.eventos.ultimo.dia_local}`
          : "nenhum movimento registrado",
      };

  /* ---------- R7: conta o que está ESCRITO e compara com o cartão ---------- */
  const falhas = painel.consistencia.falhas.map(fraseDaFalha);
  const algumaFilaCortada = colunas.some((c) => c.filaCortada);
  const resumo: string[] = [];
  for (const cartao of cartoes) {
    const nasColunas = new Set<number>();
    for (const c of colunas) {
      if (c.agora?.prazo?.k === cartao.k) nasColunas.add(c.agora.osNumero);
      for (const f of c.fila) if (f.prazo?.k === cartao.k) nasColunas.add(f.osNumero);
    }
    const fichas = minis.map((m) => m.fichas[cartao.k]);
    const daParaConferir = !algumaFilaCortada && fichas.every((f) => f !== null);
    const nosMinis = fichas.reduce<number>((s, f) => s + (f ?? 0), 0);
    resumo.push(
      `${cartao.nome} ${cartao.total} = ${nasColunas.size} nas colunas + ${nosMinis} nos minis${daParaConferir ? "" : " (lista cortada: não conferido)"}`,
    );
    if (!daParaConferir) continue;
    if (nasColunas.size + nosMinis !== cartao.total) {
      falhas.push(
        `${cartao.nome}: o cartão diz ${cartao.total} e a tela marca ${nasColunas.size + nosMinis} (${nasColunas.size} nas colunas + ${nosMinis} nos minis)`,
      );
    }
    if (
      cartao.k === "atr" &&
      cartao.total > 0 &&
      (atrasadasNasColunas !== nasColunas.size || atrasadasFora !== nosMinis)
    ) {
      falhas.push(
        `ATRASADAS: a sublinha diz MÁQUINAS ${atrasadasNasColunas} · FORA ${atrasadasFora} e a tela marca ${nasColunas.size} e ${nosMinis}`,
      );
    }
  }
  if (colunas.filter((c) => c.estado === "rodando").length !== painel.rodando.total) {
    falhas.push(
      `R4 na tela: ${colunas.filter((c) => c.estado === "rodando").length} colunas RODANDO para o chip ${painel.rodando.total}/${painel.rodando.de}`,
    );
  }
  const conferencia = `${resumo.join(" · ")} · ${colunas.reduce((s, c) => s + c.fila.length, 0)} linhas de fila`;

  /* ---------- a faixa condicional do painel (a de SEM CONEXÃO é da tela, por cima) ---------- */
  let faixa: FaixaDoPainel | null = null;
  if (falhas.length > 0) {
    faixa = {
      classe: "ambar",
      icone: "TriangleAlert",
      texto: `NÚMERO INCONSISTENTE — ${falhas[0]}. Avise o gestor.`,
    };
  } else if (painel.registro.sem_apontamento_em_7_dias) {
    const ultimo =
      painel.registro.ultimo_registro_local ?? painel.registro.ultimo_apontamento_local;
    faixa = {
      classe: "cinza",
      icone: "CircleAlert",
      texto: `NINGUÉM APONTOU PRODUÇÃO NO SISTEMA (último apontamento: ${diaDaHoraLocal(ultimo)}). Esta tela não sabe se as máquinas estão paradas.`,
    };
  }

  return { chips, cartoes, minis, colunas, saidas, canto, falhas, faixa, conferencia };
}
