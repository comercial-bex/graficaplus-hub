/**
 * O contrato v2 do painel da TV da Oficina — o jsonb que `public.tv_painel_maquinas()`
 * devolve e que `GET /api/tv/painel` repassa sem mexer.
 *
 * Este arquivo é a tradução da função VIVA (lida com pg_get_functiondef em
 * 01/10/2026) para tipos, mais a leitura defensiva: a TV recebe `unknown` da
 * rede e só desenha depois de `lerPainel` dizer que cada chave está no lugar
 * e com o tipo certo. Chave faltando ou tipo errado vira um ERRO NOMEADO com o
 * caminho ("maquinas[2].estado: esperava rodando | nao_fechou | ...") — nunca
 * uma tela vazia que se lê como "oficina parada".
 *
 * O que a tela NÃO faz com o contrato: somar, filtrar OS encerrada, inventar
 * total a partir de lista. Total e lista chegam da mesma consulta; a tela
 * imprime o que veio. O único trabalho de conta que ela faz é a conferência
 * R7 (`tela.ts`), que CONTA o que está escrito e acusa se não bater.
 *
 * Domínio puro: sem rede, sem DOM, sem data do aparelho.
 */

export const VERSAO_DO_PAINEL = 2;
/** `c_topo` da função: cada lista traz no máximo 12 itens; o total vai junto. */
export const TOPO_DA_LISTA = 12;
/** `c_colunas` da função: a tela foi desenhada para cinco máquinas. */
export const COLUNAS_DA_TELA = 5;
export const FUSO_DA_OFICINA = "America/Belem";

export type EstadoDaMaquina =
  | "rodando"
  | "nao_fechou"
  | "bloqueada"
  | "reservada"
  | "pelo_status"
  | "livre"
  | "sem_registro";

export const ESTADOS_DA_MAQUINA: readonly EstadoDaMaquina[] = [
  "rodando",
  "nao_fechou",
  "bloqueada",
  "reservada",
  "pelo_status",
  "livre",
  "sem_registro",
];

export type BlocoDaParede = "entrada_arte" | "oficina" | "acabamento" | "saida";
const BLOCOS: readonly BlocoDaParede[] = ["entrada_arte", "oficina", "acabamento", "saida"];

export type TipoDeItem = "produto" | "sob_medida" | "varios" | "sem_item";
const TIPOS_DE_ITEM: readonly TipoDeItem[] = ["produto", "sob_medida", "varios", "sem_item"];

export type OrigemDoTrabalho = "apontamento" | "reserva" | "maquina_id" | "status" | "produto";
const ORIGENS: readonly OrigemDoTrabalho[] = [
  "apontamento",
  "reserva",
  "maquina_id",
  "status",
  "produto",
];

export type MotivoSemMaquina =
  | "generico"
  | "laser_sem_maquina"
  | "terceiro_uv"
  | "fila_sem_reserva";
const MOTIVOS: readonly MotivoSemMaquina[] = [
  "generico",
  "laser_sem_maquina",
  "terceiro_uv",
  "fila_sem_reserva",
];

export type PrazoNaFila = "hoje" | "amanha";

export type TipoDeSaida = "retirada" | "entrega" | "instalacao" | "bloqueio" | "reserva";
const TIPOS_DE_SAIDA: readonly TipoDeSaida[] = [
  "retirada",
  "entrega",
  "instalacao",
  "bloqueio",
  "reserva",
];

/** Lista fechada: a frase do canto é montada na TV a partir daqui. */
export type TipoDeEvento =
  | "apontamento_iniciado"
  | "apontamento_finalizado"
  | "os_entrou_na_fila"
  | "os_foi_para_acabamento"
  | "os_ficou_pronta";
export const TIPOS_DE_EVENTO: readonly TipoDeEvento[] = [
  "apontamento_iniciado",
  "apontamento_finalizado",
  "os_entrou_na_fila",
  "os_foi_para_acabamento",
  "os_ficou_pronta",
];

export type TrabalhoAgora = {
  os_numero: number;
  /** nome do produto do catálogo — o ÚNICO texto que vem de tabela */
  produto: string | null;
  item: TipoDeItem;
  itens_na_os: number | null;
  origem: OrigemDoTrabalho;
  minutos_previstos: number | null;
  dias_atraso: number | null;
  pausada: boolean;
  /** apontamento aberto numa OS que o status põe em outro bloco (aviso da função) */
  fora_da_oficina?: boolean;
};

export type TrabalhoNaFila = {
  os_numero: number;
  produto: string | null;
  item: TipoDeItem;
  itens_na_os: number | null;
  dias_atraso: number | null;
  prazo: PrazoNaFila | null;
  /** "16:00" hoje · "sex" nesta semana · "28/09" mais longe; null sem reserva */
  reserva_local: string | null;
  reserva_vencida: boolean;
  origem: OrigemDoTrabalho;
  pausada: boolean;
};

export type MaquinaDoPainel = {
  id: string;
  /** `maquinas.tipo` — texto livre no banco; tipo novo cai na identidade genérica */
  tipo: string;
  ordem: number;
  estado: EstadoDaMaquina;
  desde_em: string | null;
  desde_local: string | null;
  /** de onde veio a prova do LIVRE (chave nova da função viva; opcional no retrato antigo) */
  livre_por?: "apontamento" | "job_3d" | null;
  agora: TrabalhoAgora | null;
  janela: { inicio_local: string | null; fim_local: string | null } | null;
  fila: { total: number; itens: TrabalhoNaFila[] };
  a_caminho: number;
  reservas_vencidas: { total: number; mais_antiga_local: string | null };
  ultimo_apontamento_local: string | null;
  ultimo_apontamento_os_numero: number | null;
  ultimo_job_3d_local: string | null;
};

export type ItemDeCartao = {
  os_numero: number;
  bloco: BlocoDaParede;
  pausada: boolean;
  dias_atraso?: number | null;
};

export type ItemSemMaquina = {
  os_numero: number;
  motivo: MotivoSemMaquina;
  dias_atraso: number | null;
  pausada: boolean;
};

export type Saida = {
  tipo: TipoDeSaida;
  quando: "hoje" | "amanha";
  hora_local: string | null;
  os_numero: number | null;
  maquina_id: string | null;
};

export type Evento = {
  id: string;
  tipo: TipoDeEvento;
  maquina_id: string | null;
  os_numero: number | null;
  ocorrido_em: string;
  hora_local: string;
  dia_local: string;
};

export type FalhaDeConsistencia = {
  regra: string;
  esperado: number;
  obtido: number;
  detalhe?: string;
  os_numero?: number | null;
  maquina_id?: string | null;
  quantas?: number;
};

export type PainelDaOficina = {
  versao: number;
  gerado_em: string;
  hoje_local: string;
  fuso: string;
  intervalo_s: number;
  dentro_do_expediente: boolean;
  registro: {
    apontamentos_hoje: number;
    apontamentos_abertos: number;
    ultimo_apontamento_local: string | null;
    /** apontamento OU job 3D, o mais recente (chave nova da função viva) */
    ultimo_registro_local?: string | null;
    sem_apontamento_em_7_dias: boolean;
    jobs_3d_hoje: number;
    ultimo_job_3d_local: string | null;
  };
  rodando: { total: number; de: number };
  cartoes: {
    atrasadas: { total: number; nas_maquinas: number; fora: number; itens: ItemDeCartao[] };
    prazo_hoje: { total: number; ja_prontas: number; itens: ItemDeCartao[] };
    prazo_amanha: { total: number; ja_prontas: number; itens: ItemDeCartao[] };
    abertas_sem_prazo: number;
  };
  blocos: {
    abertas_na_parede: number;
    entrada_arte: { total: number; atrasadas: number; com_cliente: number };
    oficina: { total: number; nas_colunas: number };
    sem_maquina: { total: number; atrasadas: number; itens: ItemSemMaquina[] };
    acabamento: { total: number; atrasadas: number; retrabalho: number };
    saida: {
      total: number;
      no_balcao: number;
      entrega: number;
      instalacao: number;
      atrasadas: number;
    };
  };
  maquinas: MaquinaDoPainel[];
  saidas: { total: number; itens: Saida[] };
  eventos: { ultimo: Evento | null; total_de_hoje: number; itens_de_hoje: Evento[] };
  consistencia: {
    ok: boolean;
    falhas: FalhaDeConsistencia[];
    avisos?: unknown[];
  };
};

export type LeituraDoPainel = { ok: true; painel: PainelDaOficina } | { ok: false; motivo: string };

/* ------------------------------------------------------------------------- */
/* A leitura defensiva                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Erro de leitura com o CAMINHO da chave. É o que a faixa vermelha mostra
 * ("DADO FORA DO CONTRATO — maquinas[1].fila.total: esperava número").
 */
class ForaDoContrato extends Error {}

type Obj = Record<string, unknown>;

function falhar(caminho: string, esperava: string, valor: unknown): never {
  const visto =
    valor === null
      ? "null"
      : valor === undefined
        ? "ausente"
        : Array.isArray(valor)
          ? "lista"
          : typeof valor === "object"
            ? "objeto"
            : JSON.stringify(valor).slice(0, 40);
  throw new ForaDoContrato(`${caminho}: esperava ${esperava}, veio ${visto}`);
}

function obj(valor: unknown, caminho: string): Obj {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    falhar(caminho, "objeto", valor);
  }
  return valor as Obj;
}

function lista(valor: unknown, caminho: string): unknown[] {
  if (!Array.isArray(valor)) falhar(caminho, "lista", valor);
  return valor;
}

function num(valor: unknown, caminho: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) falhar(caminho, "número", valor);
  return valor;
}

function inteiro(valor: unknown, caminho: string): number {
  const n = num(valor, caminho);
  if (!Number.isInteger(n) || n < 0) falhar(caminho, "inteiro ≥ 0", valor);
  return n;
}

function texto(valor: unknown, caminho: string): string {
  if (typeof valor !== "string") falhar(caminho, "texto", valor);
  return valor;
}

function bool(valor: unknown, caminho: string): boolean {
  if (typeof valor !== "boolean") falhar(caminho, "verdadeiro/falso", valor);
  return valor;
}

function ouNulo<T>(valor: unknown, caminho: string, ler: (v: unknown, c: string) => T): T | null {
  return valor === null || valor === undefined ? null : ler(valor, caminho);
}

function umDe<T extends string>(valor: unknown, caminho: string, opcoes: readonly T[]): T {
  if (typeof valor !== "string" || !(opcoes as readonly string[]).includes(valor)) {
    falhar(caminho, opcoes.join(" | "), valor);
  }
  return valor as T;
}

/** Data ISO que o `new Date` entende; a hora da TV depende dela. */
function instante(valor: unknown, caminho: string): string {
  const t = texto(valor, caminho);
  if (!Number.isFinite(Date.parse(t))) falhar(caminho, "data/hora ISO", valor);
  return t;
}

function lerTrabalhoAgora(v: unknown, c: string): TrabalhoAgora {
  const o = obj(v, c);
  return {
    os_numero: inteiro(o.os_numero, `${c}.os_numero`),
    produto: ouNulo(o.produto, `${c}.produto`, texto),
    item: umDe(o.item, `${c}.item`, TIPOS_DE_ITEM),
    itens_na_os: ouNulo(o.itens_na_os, `${c}.itens_na_os`, inteiro),
    origem: umDe(o.origem, `${c}.origem`, ORIGENS),
    minutos_previstos: ouNulo(o.minutos_previstos, `${c}.minutos_previstos`, inteiro),
    dias_atraso: ouNulo(o.dias_atraso, `${c}.dias_atraso`, inteiro),
    pausada: bool(o.pausada, `${c}.pausada`),
    ...(o.fora_da_oficina !== undefined && o.fora_da_oficina !== null
      ? { fora_da_oficina: bool(o.fora_da_oficina, `${c}.fora_da_oficina`) }
      : {}),
  };
}

function lerTrabalhoNaFila(v: unknown, c: string): TrabalhoNaFila {
  const o = obj(v, c);
  return {
    os_numero: inteiro(o.os_numero, `${c}.os_numero`),
    produto: ouNulo(o.produto, `${c}.produto`, texto),
    item: umDe(o.item, `${c}.item`, TIPOS_DE_ITEM),
    itens_na_os: ouNulo(o.itens_na_os, `${c}.itens_na_os`, inteiro),
    dias_atraso: ouNulo(o.dias_atraso, `${c}.dias_atraso`, inteiro),
    prazo: ouNulo(o.prazo, `${c}.prazo`, (x, cc) => umDe(x, cc, ["hoje", "amanha"] as const)),
    reserva_local: ouNulo(o.reserva_local, `${c}.reserva_local`, texto),
    reserva_vencida: bool(o.reserva_vencida, `${c}.reserva_vencida`),
    origem: umDe(o.origem, `${c}.origem`, ORIGENS),
    pausada: bool(o.pausada, `${c}.pausada`),
  };
}

function lerMaquina(v: unknown, c: string): MaquinaDoPainel {
  const o = obj(v, c);
  const fila = obj(o.fila, `${c}.fila`);
  const vencidas = obj(o.reservas_vencidas, `${c}.reservas_vencidas`);
  const janela = ouNulo(o.janela, `${c}.janela`, (x, cc) => {
    const j = obj(x, cc);
    return {
      inicio_local: ouNulo(j.inicio_local, `${cc}.inicio_local`, texto),
      fim_local: ouNulo(j.fim_local, `${cc}.fim_local`, texto),
    };
  });
  const itens = lista(fila.itens, `${c}.fila.itens`).map((x, i) =>
    lerTrabalhoNaFila(x, `${c}.fila.itens[${i}]`),
  );
  const total = inteiro(fila.total, `${c}.fila.total`);
  // regra (a) do contrato: total é count(*) da mesma CTE de que itens é o top-N
  if (total < itens.length)
    falhar(`${c}.fila.total`, `≥ ${itens.length} (tamanho da lista)`, total);
  return {
    id: texto(o.id, `${c}.id`),
    tipo: texto(o.tipo, `${c}.tipo`),
    ordem: inteiro(o.ordem, `${c}.ordem`),
    estado: umDe(o.estado, `${c}.estado`, ESTADOS_DA_MAQUINA),
    desde_em: ouNulo(o.desde_em, `${c}.desde_em`, instante),
    desde_local: ouNulo(o.desde_local, `${c}.desde_local`, texto),
    ...(o.livre_por !== undefined
      ? {
          livre_por: ouNulo(o.livre_por, `${c}.livre_por`, (x, cc) =>
            umDe(x, cc, ["apontamento", "job_3d"] as const),
          ),
        }
      : {}),
    agora: ouNulo(o.agora, `${c}.agora`, lerTrabalhoAgora),
    janela,
    fila: { total, itens },
    a_caminho: inteiro(o.a_caminho, `${c}.a_caminho`),
    reservas_vencidas: {
      total: inteiro(vencidas.total, `${c}.reservas_vencidas.total`),
      mais_antiga_local: ouNulo(
        vencidas.mais_antiga_local,
        `${c}.reservas_vencidas.mais_antiga_local`,
        texto,
      ),
    },
    ultimo_apontamento_local: ouNulo(
      o.ultimo_apontamento_local,
      `${c}.ultimo_apontamento_local`,
      texto,
    ),
    ultimo_apontamento_os_numero: ouNulo(
      o.ultimo_apontamento_os_numero,
      `${c}.ultimo_apontamento_os_numero`,
      inteiro,
    ),
    ultimo_job_3d_local: ouNulo(o.ultimo_job_3d_local, `${c}.ultimo_job_3d_local`, texto),
  };
}

function lerItemDeCartao(v: unknown, c: string): ItemDeCartao {
  const o = obj(v, c);
  return {
    os_numero: inteiro(o.os_numero, `${c}.os_numero`),
    bloco: umDe(o.bloco, `${c}.bloco`, BLOCOS),
    pausada: bool(o.pausada, `${c}.pausada`),
    ...(o.dias_atraso !== undefined
      ? { dias_atraso: ouNulo(o.dias_atraso, `${c}.dias_atraso`, inteiro) }
      : {}),
  };
}

function lerListaComTotal<T>(
  v: unknown,
  c: string,
  lerItem: (x: unknown, cc: string) => T,
): { total: number; itens: T[] } {
  const o = obj(v, c);
  const itens = lista(o.itens, `${c}.itens`).map((x, i) => lerItem(x, `${c}.itens[${i}]`));
  const total = inteiro(o.total, `${c}.total`);
  if (total < itens.length) falhar(`${c}.total`, `≥ ${itens.length} (tamanho da lista)`, total);
  return { total, itens };
}

function lerEvento(v: unknown, c: string): Evento {
  const o = obj(v, c);
  return {
    id: texto(o.id, `${c}.id`),
    tipo: umDe(o.tipo, `${c}.tipo`, TIPOS_DE_EVENTO),
    maquina_id: ouNulo(o.maquina_id, `${c}.maquina_id`, texto),
    os_numero: ouNulo(o.os_numero, `${c}.os_numero`, inteiro),
    ocorrido_em: instante(o.ocorrido_em, `${c}.ocorrido_em`),
    hora_local: texto(o.hora_local, `${c}.hora_local`),
    dia_local: texto(o.dia_local, `${c}.dia_local`),
  };
}

function lerSaida(v: unknown, c: string): Saida {
  const o = obj(v, c);
  return {
    tipo: umDe(o.tipo, `${c}.tipo`, TIPOS_DE_SAIDA),
    quando: umDe(o.quando, `${c}.quando`, ["hoje", "amanha"] as const),
    hora_local: ouNulo(o.hora_local, `${c}.hora_local`, texto),
    os_numero: ouNulo(o.os_numero, `${c}.os_numero`, inteiro),
    maquina_id: ouNulo(o.maquina_id, `${c}.maquina_id`, texto),
  };
}

function lerFalha(v: unknown, c: string): FalhaDeConsistencia {
  const o = obj(v, c);
  return {
    regra: texto(o.regra, `${c}.regra`),
    esperado: num(o.esperado, `${c}.esperado`),
    obtido: num(o.obtido, `${c}.obtido`),
    ...(typeof o.detalhe === "string" ? { detalhe: o.detalhe } : {}),
    ...(typeof o.os_numero === "number" ? { os_numero: o.os_numero } : {}),
    ...(typeof o.maquina_id === "string" ? { maquina_id: o.maquina_id } : {}),
    ...(typeof o.quantas === "number" ? { quantas: o.quantas } : {}),
  };
}

/**
 * Lê o que veio da rede. Devolve o painel tipado ou o MOTIVO, com o caminho da
 * chave que não bateu. Chaves a mais são ignoradas (a função pode ganhar
 * campos antes da tela); chave do contrato faltando ou com tipo errado reprova.
 */
export function lerPainel(cru: unknown): LeituraDoPainel {
  try {
    const p = obj(cru, "painel");
    const versao = inteiro(p.versao, "versao");
    if (versao !== VERSAO_DO_PAINEL) {
      return {
        ok: false,
        motivo: `versao: esta tela lê a versão ${VERSAO_DO_PAINEL} do painel e veio a ${versao}`,
      };
    }
    const registro = obj(p.registro, "registro");
    const rodando = obj(p.rodando, "rodando");
    const cartoes = obj(p.cartoes, "cartoes");
    const atrasadas = obj(cartoes.atrasadas, "cartoes.atrasadas");
    const blocos = obj(p.blocos, "blocos");
    const ea = obj(blocos.entrada_arte, "blocos.entrada_arte");
    const ofi = obj(blocos.oficina, "blocos.oficina");
    const sm = obj(blocos.sem_maquina, "blocos.sem_maquina");
    const ac = obj(blocos.acabamento, "blocos.acabamento");
    const sa = obj(blocos.saida, "blocos.saida");
    const eventos = obj(p.eventos, "eventos");
    const consistencia = obj(p.consistencia, "consistencia");

    const atrasadasLidas = lerListaComTotal(atrasadas, "cartoes.atrasadas", lerItemDeCartao);
    const semMaquina = lerListaComTotal(sm, "blocos.sem_maquina", (x, c) => {
      const o = obj(x, c);
      return {
        os_numero: inteiro(o.os_numero, `${c}.os_numero`),
        motivo: umDe(o.motivo, `${c}.motivo`, MOTIVOS),
        dias_atraso: ouNulo(o.dias_atraso, `${c}.dias_atraso`, inteiro),
        pausada: bool(o.pausada, `${c}.pausada`),
      };
    });

    const painel: PainelDaOficina = {
      versao,
      gerado_em: instante(p.gerado_em, "gerado_em"),
      hoje_local: texto(p.hoje_local, "hoje_local"),
      fuso: texto(p.fuso, "fuso"),
      intervalo_s: inteiro(p.intervalo_s, "intervalo_s"),
      dentro_do_expediente: bool(p.dentro_do_expediente, "dentro_do_expediente"),
      registro: {
        apontamentos_hoje: inteiro(registro.apontamentos_hoje, "registro.apontamentos_hoje"),
        apontamentos_abertos: inteiro(
          registro.apontamentos_abertos,
          "registro.apontamentos_abertos",
        ),
        ultimo_apontamento_local: ouNulo(
          registro.ultimo_apontamento_local,
          "registro.ultimo_apontamento_local",
          texto,
        ),
        ...(registro.ultimo_registro_local !== undefined
          ? {
              ultimo_registro_local: ouNulo(
                registro.ultimo_registro_local,
                "registro.ultimo_registro_local",
                texto,
              ),
            }
          : {}),
        sem_apontamento_em_7_dias: bool(
          registro.sem_apontamento_em_7_dias,
          "registro.sem_apontamento_em_7_dias",
        ),
        jobs_3d_hoje: inteiro(registro.jobs_3d_hoje, "registro.jobs_3d_hoje"),
        ultimo_job_3d_local: ouNulo(
          registro.ultimo_job_3d_local,
          "registro.ultimo_job_3d_local",
          texto,
        ),
      },
      rodando: {
        total: inteiro(rodando.total, "rodando.total"),
        de: inteiro(rodando.de, "rodando.de"),
      },
      cartoes: {
        atrasadas: {
          ...atrasadasLidas,
          nas_maquinas: inteiro(atrasadas.nas_maquinas, "cartoes.atrasadas.nas_maquinas"),
          fora: inteiro(atrasadas.fora, "cartoes.atrasadas.fora"),
        },
        prazo_hoje: {
          ...lerListaComTotal(cartoes.prazo_hoje, "cartoes.prazo_hoje", lerItemDeCartao),
          ja_prontas: inteiro(
            obj(cartoes.prazo_hoje, "cartoes.prazo_hoje").ja_prontas,
            "cartoes.prazo_hoje.ja_prontas",
          ),
        },
        prazo_amanha: {
          ...lerListaComTotal(cartoes.prazo_amanha, "cartoes.prazo_amanha", lerItemDeCartao),
          ja_prontas: inteiro(
            obj(cartoes.prazo_amanha, "cartoes.prazo_amanha").ja_prontas,
            "cartoes.prazo_amanha.ja_prontas",
          ),
        },
        abertas_sem_prazo: inteiro(cartoes.abertas_sem_prazo, "cartoes.abertas_sem_prazo"),
      },
      blocos: {
        abertas_na_parede: inteiro(blocos.abertas_na_parede, "blocos.abertas_na_parede"),
        entrada_arte: {
          total: inteiro(ea.total, "blocos.entrada_arte.total"),
          atrasadas: inteiro(ea.atrasadas, "blocos.entrada_arte.atrasadas"),
          com_cliente: inteiro(ea.com_cliente, "blocos.entrada_arte.com_cliente"),
        },
        oficina: {
          total: inteiro(ofi.total, "blocos.oficina.total"),
          nas_colunas: inteiro(ofi.nas_colunas, "blocos.oficina.nas_colunas"),
        },
        sem_maquina: {
          ...semMaquina,
          atrasadas: inteiro(sm.atrasadas, "blocos.sem_maquina.atrasadas"),
        },
        acabamento: {
          total: inteiro(ac.total, "blocos.acabamento.total"),
          atrasadas: inteiro(ac.atrasadas, "blocos.acabamento.atrasadas"),
          retrabalho: inteiro(ac.retrabalho, "blocos.acabamento.retrabalho"),
        },
        saida: {
          total: inteiro(sa.total, "blocos.saida.total"),
          no_balcao: inteiro(sa.no_balcao, "blocos.saida.no_balcao"),
          entrega: inteiro(sa.entrega, "blocos.saida.entrega"),
          instalacao: inteiro(sa.instalacao, "blocos.saida.instalacao"),
          atrasadas: inteiro(sa.atrasadas, "blocos.saida.atrasadas"),
        },
      },
      maquinas: lista(p.maquinas, "maquinas").map((x, i) => lerMaquina(x, `maquinas[${i}]`)),
      saidas: lerListaComTotal(p.saidas, "saidas", lerSaida),
      eventos: {
        ultimo: ouNulo(eventos.ultimo, "eventos.ultimo", lerEvento),
        total_de_hoje: inteiro(eventos.total_de_hoje, "eventos.total_de_hoje"),
        itens_de_hoje: lista(eventos.itens_de_hoje, "eventos.itens_de_hoje").map((x, i) =>
          lerEvento(x, `eventos.itens_de_hoje[${i}]`),
        ),
      },
      consistencia: {
        ok: bool(consistencia.ok, "consistencia.ok"),
        falhas: lista(consistencia.falhas, "consistencia.falhas").map((x, i) =>
          lerFalha(x, `consistencia.falhas[${i}]`),
        ),
        ...(Array.isArray(consistencia.avisos) ? { avisos: consistencia.avisos } : {}),
      },
    };
    // `ok` e `falhas` têm que contar a mesma história: ok=true com falha dentro
    // esconderia a faixa âmbar atrás de um booleano.
    if (painel.consistencia.ok && painel.consistencia.falhas.length > 0) {
      return { ok: false, motivo: "consistencia: ok=true com falhas na lista" };
    }
    if (painel.eventos.total_de_hoje < painel.eventos.itens_de_hoje.length) {
      return {
        ok: false,
        motivo: `eventos.total_de_hoje: esperava ≥ ${painel.eventos.itens_de_hoje.length}, veio ${painel.eventos.total_de_hoje}`,
      };
    }
    return { ok: true, painel };
  } catch (erro) {
    if (erro instanceof ForaDoContrato) return { ok: false, motivo: erro.message };
    throw erro;
  }
}
