/**
 * "Começar" acende a máquina — a parte que se decide sem tela e sem banco.
 *
 * Até 01/10/2026 o botão "Começar" do painel do impressor chamava
 * `avancar_os_status` com o status genérico `em_producao`. O status mudava, e
 * mais nada: nenhum apontamento abria, a OS não ganhava máquina, e a tabela
 * `apontamentos_producao` tinha ZERO linhas na história. A TV da Oficina só
 * escreve RODANDO quando há apontamento aberto — então a parede nasceria toda
 * "SEM REGISTRO" com a oficina trabalhando.
 *
 * As funções do banco (migrações 20261001110000 e 20261001150000) gravam o
 * fato inteiro numa transação. O que fica aqui é o que a tela precisa decidir
 * antes e depois da chamada:
 *
 *   - que passo oferecer em cada cartão, e a quem;
 *   - o que escrever no botão de uma máquina ocupada;
 *   - como dizer o erro que voltou, em português e SEM dinheiro;
 *   - em que máquina a OS está e desde que horas;
 *   - por qual porta a ficha da OS aponta (status junto, ou só o tempo).
 *
 * Nada daqui tem custo, R$/h, preço ou margem. Quem aponta não vê dinheiro —
 * e a única frase com número de dinheiro que o banco devolve por este caminho
 * (a trava de margem) é cortada em `erroDeMaquina`.
 */

import { mensagemErro } from "@/lib/erros";
import { POR_TIPO, type IdentidadeMaquina } from "@/domain/producao/identidade-da-maquina";
import { etapaDe, rotuloDe, statusPadraoDaEtapa } from "./etapas";

/* ------------------------------------------------------------------ *
 * O que as funções do banco devolvem
 * ------------------------------------------------------------------ */

/** Uma máquina na resposta de `maquinas_para_comecar`. */
export type MaquinaParaComecar = {
  id: string;
  nome: string;
  /** `maquinas.tipo` é texto livre: pode vir nulo ou fora do mapa. */
  tipo: string | null;
  ordem: number;
  /** nulo = tipo sem etapa de produção no sistema; a RPC recusaria */
  status_destino: string | null;
  sugerida: boolean;
  ocupada: boolean;
  /** nulo com `ocupada` = apontamento aberto sem OS */
  ocupada_por_os_numero: number | null;
  ocupada_por_esta_os: boolean;
  ocupada_desde: string | null;
  pode_comecar: boolean;
};

export type MaquinasParaComecar = {
  os_id: string;
  os_numero: number | null;
  os_status: string;
  os_encerrada: boolean;
  sugerida_maquina_id: string | null;
  maquinas: MaquinaParaComecar[];
};

/** Resposta de `comecar_na_maquina`. */
export type ComecouNaMaquina = {
  apontamento_id: string;
  os_id: string;
  os_numero: number | null;
  maquina_id: string;
  maquina_tipo: string | null;
  maquina_nome: string | null;
  status_anterior: string;
  status: string;
  etapa: string | null;
  agenda_id: string | null;
  iniciado_em: string;
  /** HH:MM já no fuso da oficina, calculado no banco */
  iniciado_local: string;
  /**
   * O apontamento JÁ existia (aberto pela ficha da OS, que não muda o status):
   * a função só acertou o status e a máquina da OS. Nenhum apontamento novo.
   */
  ja_estava_rodando?: boolean;
  outras_maquinas_abertas: MaquinaAindaAberta[];
};

/** Um apontamento que continua aberto depois da chamada. */
export type MaquinaAindaAberta = {
  apontamento_id: string;
  maquina_id: string | null;
  maquina_tipo: string | null;
};

type ApontamentoFechado = {
  apontamento_id: string;
  maquina_id: string | null;
  maquina_tipo: string | null;
  minutos: number;
  /**
   * Ficou aberto além do teto (fim do dia ou 10 h; 3D 24 h — a mesma regra que
   * a TV usa para escrever NÃO FECHOU). O tempo corrido continua em `minutos`,
   * mas só o tempo até o teto virou custo, e o registro ficou marcado para o
   * gestor conferir.
   */
  passou_do_teto?: boolean;
};

/** Resposta de `terminar_na_maquina` — fecha TODAS as abertas da OS. */
export type TerminouNaMaquina = {
  os_id: string;
  os_numero: number | null;
  fechados: number;
  apontamentos: ApontamentoFechado[];
};

/**
 * Resposta de `terminar_so_esta_maquina` — fecha UMA, e diz o que continua.
 *
 * É a que o painel usa. Com a outra, a OS aberta na impressão e no recorte só
 * tinha "terminei nas 2": fechava também a máquina que ainda estava rodando.
 */
export type TerminouSoEstaMaquina = TerminouNaMaquina & {
  maquina_id: string;
  maquina_tipo: string | null;
  continuam_abertas: MaquinaAindaAberta[];
};

/** Resposta de `mandar_para_acabamento`. */
export type MandouParaAcabamento = TerminouNaMaquina & {
  status_anterior: string;
  status: string;
};

/** Um apontamento ainda aberto, como o painel consulta. Sem custo. */
export type ApontamentoAberto = {
  id: string;
  os_id: string | null;
  maquina_id: string | null;
  iniciado_em: string;
  maquinas: { nome: string | null; tipo: string | null } | null;
};

/* ------------------------------------------------------------------ *
 * A cara da máquina
 * ------------------------------------------------------------------ */

const SEM_CARA: IdentidadeMaquina = {
  chave: "desconhecida",
  curto: "Máquina",
  icone: "Factory",
  cor: "#8b94a7",
};

/**
 * Ícone, cor e nome curto de uma máquina do cadastro.
 *
 * O nome curto vem do TIPO ("Impressão", "Recorte", "Laser CO2", "Fiber",
 * "3D") — é como a oficina fala e é o que a parede escreve. Tipo fora do mapa
 * não some: cai no genérico com o nome cadastrado.
 */
export function caraDaMaquina(m: {
  tipo?: string | null;
  nome?: string | null;
}): IdentidadeMaquina {
  if (m.tipo && Object.prototype.hasOwnProperty.call(POR_TIPO, m.tipo)) return POR_TIPO[m.tipo];
  return m.nome ? { ...SEM_CARA, curto: m.nome } : SEM_CARA;
}

/* ------------------------------------------------------------------ *
 * A hora, no relógio da oficina
 * ------------------------------------------------------------------ */

/**
 * O fuso é o da gráfica (Macapá), não o do aparelho: é o mesmo que o banco usa
 * em `iniciado_local` e que a TV escreve na parede. Um celular com o relógio
 * em outro fuso mostraria "desde 22:35" ao lado de uma parede dizendo 19:35.
 */
const FUSO_DA_OFICINA = "America/Belem";

const FMT_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_OFICINA,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const FMT_DIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_OFICINA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * "14:32" quando foi hoje; "30/09 14:32" quando ficou de um dia para o outro.
 *
 * O dia entra só quando muda, porque é aí que ele é a informação: um
 * apontamento aberto desde ontem é o que a parede chama de NÃO FECHOU.
 * `agora` é parâmetro para o teste não depender do dia em que roda.
 */
export function horaDaOficina(
  iso: string | null | undefined,
  agora: Date = new Date(),
): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  const hora = FMT_HORA.format(quando);
  const dia = FMT_DIA.format(quando);
  return dia === FMT_DIA.format(agora) ? hora : `${dia.slice(0, 5)} ${hora}`;
}

/** Minutos do jeito que a oficina fala: "42 min", "1h05". */
export function minutosEmPalavras(minutos: number): string {
  const min = Math.max(0, Math.round(Number(minutos) || 0));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h${String(min % 60).padStart(2, "0")}` : `${min} min`;
}

/* ------------------------------------------------------------------ *
 * Que passo oferecer
 * ------------------------------------------------------------------ */

export type Passo =
  /** o caminho de sempre: `avancar_os_status(os, destino)` */
  | { acao: "avancar"; rotulo: string; destino: string }
  /** abre os botões de máquina; o toque chama `comecar_na_maquina` */
  | { acao: "escolher_maquina"; rotulo: string }
  /** `mandar_para_acabamento`: fecha o apontamento e avança, numa transação */
  | { acao: "mandar_para_acabamento"; rotulo: string }
  /** `cliente_retirou`: registra a retirada no balcão e tenta fechar a OS */
  | { acao: "cliente_retirou"; rotulo: string };

export type PassosDaOs = {
  principal: Passo | null;
  /** Só existe para escolher máquina: dizer qual é, ou ir para outra. */
  secundario: Extract<Passo, { acao: "escolher_maquina" }> | null;
  /** Por que o passo principal não pode ser dado por ESTA pessoa. */
  impedimento: string | null;
};

export type QuemAponta = {
  /** `producao.start` — abre apontamento */
  podeApontar: boolean;
  /** `producao.finish` — fecha apontamento */
  podeFinalizar: boolean;
};

/**
 * O próximo passo de um toque, pela etapa em que a OS está e por quem toca.
 *
 * COMEÇAR
 * Quem aponta (`producao.start`) escolhe a máquina: o status vai para o da
 * máquina e o apontamento abre junto. Quem não aponta — hoje o gestor só tem
 * `producao.read` — continua com o caminho antigo, status genérico. O botão
 * não some de ninguém; o que muda é que o de quem opera passa a acender a
 * máquina.
 *
 * EM PRODUÇÃO
 * O passo principal manda para o acabamento. A OS que entrou em produção pelo
 * caminho antigo (ou pelo Kanban) não tem apontamento: quem aponta ganha "Dizer
 * a máquina", que a mesma função do banco aceita. Com apontamento aberto o
 * secundário vira "Outra máquina" — a peça que sai da impressão e vai para o
 * recorte.
 *
 * Fechar apontamento exige `producao.finish`. Quem não tem e encontra a OS
 * rodando recebe o motivo escrito, em vez de um botão que o banco recusaria.
 *
 * O RESTO fica como era: acabamento → "Pronta" (a própria OS diz se é
 * retirada, entrega ou instalação); retirada no balcão → "Cliente retirou".
 */
export function passosDaOs(
  os: {
    status: string;
    precisa_entrega?: boolean | null;
    precisa_instalacao?: boolean | null;
  },
  quem: QuemAponta,
  apontamentosAbertos = 0,
): PassosDaOs {
  const nada: PassosDaOs = { principal: null, secundario: null, impedimento: null };

  switch (etapaDe(os.status)) {
    case "pre_impressao":
      return {
        ...nada,
        principal: quem.podeApontar
          ? // Já tem máquina aberta e ainda está na fila: alguém apontou pela
            // ficha da OS, que não muda o status. "Começar" ao lado de uma
            // máquina que já roda confunde; o que falta é o status.
            {
              acao: "escolher_maquina",
              rotulo: apontamentosAbertos > 0 ? "Pôr em produção" : "Começar",
            }
          : { acao: "avancar", rotulo: "Começar", destino: statusPadraoDaEtapa("producao") },
      };

    case "producao": {
      const rodando = apontamentosAbertos > 0;
      return {
        principal: { acao: "mandar_para_acabamento", rotulo: "Mandar p/ acabamento" },
        secundario: quem.podeApontar
          ? { acao: "escolher_maquina", rotulo: rodando ? "Outra máquina" : "Dizer a máquina" }
          : null,
        impedimento:
          rodando && !quem.podeFinalizar
            ? "Está rodando na máquina — quem aponta é que manda para o acabamento."
            : null,
      };
    }

    case "acabamento":
      return {
        ...nada,
        principal: { acao: "avancar", rotulo: "Pronta", destino: statusPadraoDaEtapa("saida", os) },
      };

    // A saída não tinha passo nenhum: a OS chegava em "Pronta" e o painel
    // parava ali. Para quem entrega, a baixa da entrega fecha a OS sozinha —
    // mas a retirada no balcão, que é o caso mais comum da casa, não tinha
    // botão em lugar nenhum: só mudando o status na tela de detalhe.
    //
    // E o primeiro botão que existiu chamava `avancar_os_status(os,'concluido')`,
    // que exige `os.close` — só administrador. Para o operador, que é quem
    // está no balcão, o banco respondia "Permissão necessária: os.close" e a
    // OS ficava na parede como "no balcão". `cliente_retirou` registra o FATO
    // (a peça saiu, com hora e quem entregou) para qualquer pessoa da equipe;
    // fechar a OS continua sendo do administrador, quando pagamento e custos
    // estiverem em dia.
    case "saida":
      return os.status === "aguardando_retirada"
        ? { ...nada, principal: { acao: "cliente_retirou", rotulo: "Cliente retirou" } }
        : nada;

    default:
      return nada;
  }
}

/* ------------------------------------------------------------------ *
 * Os botões de máquina
 * ------------------------------------------------------------------ */

/**
 * O que escrever no botão de uma máquina ocupada: "OS #90 desde 14:32".
 *
 * É a resposta que o impressor precisa na hora — não "ocupada", mas COM O QUÊ
 * e desde quando, para ele saber se espera ou vai cobrar alguém. Devolve null
 * quando a máquina está livre.
 */
export function textoDaOcupada(
  m: Pick<
    MaquinaParaComecar,
    "ocupada" | "ocupada_por_os_numero" | "ocupada_por_esta_os" | "ocupada_desde"
  >,
  agora: Date = new Date(),
): string | null {
  if (!m.ocupada) return null;
  const hora = horaDaOficina(m.ocupada_desde, agora);
  const desde = hora ? ` desde ${hora}` : "";
  if (m.ocupada_por_esta_os) return `Esta OS já roda aqui${desde}`;
  // Apontamento aberto sem OS (a OS foi apagada, ou alguém apontou avulso):
  // a máquina continua ocupada, só não há número para dizer.
  if (m.ocupada_por_os_numero == null) return `Ocupada${desde}`;
  return `OS #${m.ocupada_por_os_numero}${desde}`;
}

/**
 * A OS tem máquina aberta, mas o status dela não é o de nenhuma dessas
 * máquinas? Então alguém apontou pela ficha da OS (`iniciar_apontamento`, que
 * não mexe no status) e falta o status alcançar o apontamento.
 *
 * É a MESMA pergunta que `comecar_na_maquina` faz no banco antes de decidir
 * entre acertar e recusar com `ja_rodando_aqui`. Aberta em duas máquinas com o
 * status de uma delas, não há o que acertar — senão cada toque trocaria o
 * status de lugar.
 */
export function precisaAcertarStatus(
  lista: Pick<MaquinasParaComecar, "os_status" | "os_encerrada" | "maquinas">,
): boolean {
  if (lista.os_encerrada) return false;
  const abertas = lista.maquinas.filter((m) => m.ocupada_por_esta_os);
  if (abertas.length === 0) return false;
  return !abertas.some((m) => m.status_destino === lista.os_status);
}

/**
 * Pode tocar? E, se não pode, por quê.
 *
 * Quem manda é `pode_comecar`, que o banco calcula com a mesma regra que a
 * função de começar aplica. Aqui só se escolhe a frase do motivo.
 *
 * Uma exceção, e ela também vem do banco: a máquina em que ESTA OS já roda
 * fica tocável quando o status ainda não a alcançou (`acertarStatus`, de
 * `precisaAcertarStatus`). Medido em 01/10/2026: sem isso a OS apontada pela
 * ficha ficava na fila com a máquina acesa, o botão certo desabilitado e o
 * banco recusando — um beco. O toque não abre apontamento novo.
 */
export function situacaoDoBotao(
  m: MaquinaParaComecar,
  osEncerrada: boolean,
  agora: Date = new Date(),
  acertarStatus = false,
): { habilitado: boolean; motivo: string | null; acerto: boolean } {
  if (m.pode_comecar) return { habilitado: true, motivo: null, acerto: false };
  if (m.ocupada_por_esta_os && acertarStatus && m.status_destino && !osEncerrada)
    return {
      habilitado: true,
      motivo: `${textoDaOcupada(m, agora)} — toque para acertar o status`,
      acerto: true,
    };
  if (m.ocupada) return { habilitado: false, motivo: textoDaOcupada(m, agora), acerto: false };
  if (osEncerrada) return { habilitado: false, motivo: "OS já encerrada", acerto: false };
  if (!m.status_destino)
    return { habilitado: false, motivo: "Sem etapa no sistema — avise o gestor", acerto: false };
  return { habilitado: false, motivo: "Indisponível agora", acerto: false };
}

/* ------------------------------------------------------------------ *
 * Em que máquina a OS está
 * ------------------------------------------------------------------ */

/** Os apontamentos abertos, agrupados por OS, do mais antigo para o mais novo. */
export function abertosPorOs(lista: ApontamentoAberto[]): Map<string, ApontamentoAberto[]> {
  const mapa = new Map<string, ApontamentoAberto[]>();
  const emOrdem = [...lista].sort((a, b) => a.iniciado_em.localeCompare(b.iniciado_em));
  for (const a of emOrdem) {
    if (!a.os_id) continue;
    const da = mapa.get(a.os_id);
    if (da) da.push(a);
    else mapa.set(a.os_id, [a]);
  }
  return mapa;
}

/**
 * A linha "Impressão · desde 14:32" do cartão — uma por máquina aberta.
 *
 * Mais de uma linha É a informação: a mesma OS pode rodar em duas máquinas (um
 * item na impressão, outro no recorte), e cada uma segue ocupada até alguém
 * terminar.
 */
export function ondeEstaRodando(
  abertos: ApontamentoAberto[],
  agora: Date = new Date(),
): {
  id: string;
  /** para terminar SÓ esta; nulo = máquina apagada do cadastro */
  maquina_id: string | null;
  maquina: IdentidadeMaquina;
  desde: string | null;
}[] {
  return abertos.map((a) => ({
    id: a.id,
    maquina_id: a.maquina_id,
    maquina: caraDaMaquina(a.maquinas ?? {}),
    desde: horaDaOficina(a.iniciado_em, agora),
  }));
}

/* ------------------------------------------------------------------ *
 * O que dizer depois do toque
 * ------------------------------------------------------------------ */

function numeroDaOs(n: number | null | undefined): string {
  return `OS #${n ?? "—"}`;
}

/** Lista de nomes curtos sem repetir: "Impressão, Recorte". */
function nomesDasMaquinas(lista: { maquina_tipo: string | null }[]): string {
  const nomes = lista.map((x) => caraDaMaquina({ tipo: x.maquina_tipo }).curto);
  return [...new Set(nomes)].join(", ");
}

export function avisoDeComecou(
  r: ComecouNaMaquina,
  agora: Date = new Date(),
): { titulo: string; descricao: string | null } {
  const maquina = caraDaMaquina({ tipo: r.maquina_tipo, nome: r.maquina_nome }).curto;
  const outras = r.outras_maquinas_abertas ?? [];
  // A máquina anterior NÃO fecha sozinha: quem começou em outra precisa saber
  // que aquela continua ocupada — e ONDE se termina: na mesma folha, em
  // "Outra máquina", cada máquina aberta tem o seu "Terminei".
  const continua =
    outras.length > 0
      ? `Continua aberta também em: ${nomesDasMaquinas(outras)}. Quando parar lá, toque em Outra máquina e em Terminei.`
      : null;

  if (r.ja_estava_rodando) {
    // Nada começou agora: o apontamento vinha da ficha da OS e o que mudou foi
    // o status. A hora é a do início de verdade (com o dia, se ficou de ontem).
    const desde = horaDaOficina(r.iniciado_em, agora) ?? r.iniciado_local;
    return {
      titulo: `${numeroDaOs(r.os_numero)} em produção · ${maquina} desde ${desde}`,
      descricao: ["A máquina já estava apontada; o status da OS foi acertado.", continua]
        .filter(Boolean)
        .join(" "),
    };
  }
  return {
    titulo: `${numeroDaOs(r.os_numero)} rodando · ${maquina} desde ${r.iniciado_local}`,
    descricao: continua,
  };
}

function resumoDosFechados(lista: ApontamentoFechado[]): string {
  const resumo = lista
    .map((a) => `${caraDaMaquina({ tipo: a.maquina_tipo }).curto} ${minutosEmPalavras(a.minutos)}`)
    .join(" · ");
  // Sem esta frase, "Laser 20h00" se lê como 20 horas de máquina cobradas da
  // OS. Não foram: só o tempo até o teto virou custo, e o registro ficou
  // marcado. Quem fechou precisa saber que alguém vai conferir.
  const esquecidas = lista.filter((a) => a.passou_do_teto);
  if (esquecidas.length === 0) return resumo;
  const quais = nomesDasMaquinas(esquecidas);
  return `${resumo}. ${quais}: ficou aberto além do fim do dia — só o tempo até lá virou custo; o gestor confere`;
}

/**
 * O aviso do "Mandar p/ acabamento".
 *
 * `fechados: 0` NÃO quer dizer "sem tempo registrado": quer dizer só que
 * nenhuma máquina estava aberta NAQUELE toque. Depois de "Terminei" — que é o
 * caminho que a própria folha ensina — o tempo já ficou gravado no toque
 * anterior. A primeira versão escrevia "o tempo de máquina desta OS não ficou
 * registrado" nesse caso (medido em 01/10/2026: 2 apontamentos finalizados e a
 * frase dizendo que não havia nenhum), e o impressor que lê isso aponta de novo.
 *
 * Por isso a tela conta os apontamentos já finalizados da OS antes de afirmar
 * qualquer coisa, e passa em `jaRegistrados`. Sem a contagem (não deu para
 * consultar), o aviso diz só o que a resposta prova.
 */
export function avisoDeMandouParaAcabamento(
  r: MandouParaAcabamento,
  jaRegistrados?: number | null,
): {
  titulo: string;
  descricao: string;
} {
  const titulo = `${numeroDaOs(r.os_numero)} → Acabamento`;
  if (r.fechados > 0)
    return {
      titulo,
      descricao: `Tempo de máquina registrado: ${resumoDosFechados(r.apontamentos ?? [])}.`,
    };
  if (jaRegistrados == null)
    return { titulo, descricao: "Nenhuma máquina estava aberta nesta OS agora." };
  if (jaRegistrados > 0)
    return {
      titulo,
      descricao: `Nenhuma máquina estava aberta agora — o tempo já tinha ficado registrado (${
        jaRegistrados === 1 ? "1 apontamento" : `${jaRegistrados} apontamentos`
      }).`,
    };
  // Não é erro, mas é verdade: a OS que entrou em produção pelo caminho antigo
  // passa pelo acabamento sem deixar tempo de máquina nenhum.
  return {
    titulo,
    descricao: "Esta OS passou pela produção sem máquina apontada: não há tempo registrado.",
  };
}

/**
 * O aviso do "Terminei" — serve às duas funções: a que fecha tudo e a que
 * fecha uma máquina só (que diz também o que continua rodando).
 */
export function avisoDeTerminou(r: TerminouNaMaquina | TerminouSoEstaMaquina): {
  titulo: string;
  descricao: string;
} {
  const restam = "continuam_abertas" in r ? (r.continuam_abertas ?? []) : [];
  // "O status não mudou", e não "continua em produção": terminar também serve
  // à OS que foi apontada pela ficha e ainda está na fila.
  const continua =
    restam.length > 0
      ? `Continua rodando em: ${nomesDasMaquinas(restam)}.`
      : "O status da OS não mudou.";
  if (r.fechados > 0)
    return {
      titulo: `${numeroDaOs(r.os_numero)} · máquina liberada`,
      descricao: `Tempo registrado: ${resumoDosFechados(r.apontamentos ?? [])}. ${continua}`,
    };
  return {
    titulo: `${numeroDaOs(r.os_numero)} · nada para terminar`,
    descricao:
      "maquina_tipo" in r
        ? `Esta OS não estava aberta em ${caraDaMaquina({ tipo: r.maquina_tipo }).curto} — outra pessoa já terminou.`
        : "Não havia apontamento aberto nesta OS.",
  };
}

/** Resposta de `cliente_retirou`. Sem dinheiro. */
export type ClienteRetirou = {
  os_id: string;
  os_numero: number | null;
  status_anterior: string;
  status: string;
  /** A retirada já estava registrada (outro toque, outra pessoa): nada novo. */
  ja_estava_registrada: boolean;
  /** A OS fechou junto (só acontece com quem pode fechar e tudo em dia). */
  fechou: boolean;
  /** Saiu do "no balcão" da parede e do painel. */
  saiu_da_parede: boolean;
};

/**
 * O aviso do "Cliente retirou".
 *
 * O fato registrado é a retirada; fechar a OS é outra coisa, que depende de
 * pagamento, custos e de quem tem `os.close`. Dizer "OS fechada" quando só a
 * retirada foi registrada seria mentir para o balcão — e dizer "não deu" seria
 * mentir também, porque a peça saiu e isso ficou gravado.
 */
export function avisoDeClienteRetirou(r: ClienteRetirou): { titulo: string; descricao: string } {
  const os = numeroDaOs(r.os_numero);
  if (r.fechou) return { titulo: `${os} retirada e fechada`, descricao: "A OS foi encerrada." };
  if (r.ja_estava_registrada)
    return {
      titulo: `${os} · retirada já registrada`,
      descricao: "Alguém já tinha registrado esta retirada. O fechamento fica com o administrador.",
    };
  return {
    titulo: `${os} retirada pelo cliente`,
    descricao: "Retirada registrada — a OS saiu do balcão. O fechamento fica com o administrador.",
  };
}

/* ------------------------------------------------------------------ *
 * A ficha da OS: por qual porta apontar
 * ------------------------------------------------------------------ */

/**
 * `comecar` = `comecar_na_maquina` (status + máquina + apontamento, juntos).
 * `so_apontar` = `iniciar_apontamento` (só o tempo; o status não muda).
 */
export type PortaDoApontamento = "comecar" | "so_apontar";

/**
 * Por qual porta o "Iniciar produção" da ficha da OS entra.
 *
 * A ficha abria apontamento sempre por `iniciar_apontamento`, que não mexe no
 * status: a OS ficava em "Fila de produção" com a máquina acesa na parede.
 * Agora, OS na fila ou já em produção e SEM etapa escolhida é o mesmo fato do
 * "Começar" do painel — e entra pela mesma porta.
 *
 * Com etapa escolhida (Laminação, Aplicação…) a intenção é apontar o tempo
 * daquela etapa, não dizer em que máquina a OS "está": fica a porta antiga, e
 * a tela avisa que o status não mudou. O mesmo para OS fora da produção
 * (acabamento, retrabalho) e para quando não se sabe o status.
 */
export function portaDoApontamento(
  status: string | null | undefined,
  etapaEscolhida: string | null | undefined,
): PortaDoApontamento {
  if (etapaEscolhida) return "so_apontar";
  if (status === "aguardando_producao" || etapaDe(status) === "producao") return "comecar";
  return "so_apontar";
}

/** O que dizer quando só o tempo foi apontado — o status ficou onde estava. */
export function avisoDeSoApontou(status: string | null | undefined): {
  titulo: string;
  descricao: string;
} {
  return {
    titulo: "Tempo de máquina apontado",
    descricao: status
      ? `O status da OS não mudou: continua em ${rotuloDe(status)}.`
      : "O status da OS não mudou.",
  };
}

/* ------------------------------------------------------------------ *
 * O erro, em português e sem dinheiro
 * ------------------------------------------------------------------ */

/**
 * Os códigos estáveis que as funções de máquina mandam em DETAIL (o PostgREST
 * entrega em `error.details`). A mensagem já vem pronta em português; o código
 * serve para o título e para saber se a lista de máquinas ficou velha.
 */
export const TITULO_DO_ERRO = {
  os_nao_informada: "OS não informada",
  os_nao_encontrada: "OS não encontrada",
  os_encerrada: "OS já encerrada",
  maquina_nao_encontrada: "Máquina não encontrada",
  maquina_inativa: "Máquina inativa",
  maquina_sem_status: "Máquina sem etapa no sistema",
  maquina_ocupada: "Máquina ocupada",
  ja_rodando_aqui: "Já está rodando nesta máquina",
  quantidade_invalida: "Quantidade inválida",
  os_fora_do_balcao: "OS não está no balcão",
} as const;

export type CodigoDeMaquina = keyof typeof TITULO_DO_ERRO;

export type ErroDeMaquina = {
  /** código do banco, ou a classe do erro quando ele não manda código */
  codigo: CodigoDeMaquina | "travada" | "sem_permissao" | "outro";
  titulo: string;
  descricao: string | null;
  /** O que a tela mostrava já não vale: outra pessoa mexeu na máquina ou na OS. */
  listaMudou: boolean;
};

/** Depois destes, os botões na tela estão desatualizados. */
const LISTA_MUDOU: ReadonlySet<string> = new Set([
  "maquina_ocupada",
  "ja_rodando_aqui",
  "maquina_inativa",
  "maquina_nao_encontrada",
  "os_encerrada",
]);

export type VisaoDeDinheiro = { canSeeFinancials: boolean; canSeePrices: boolean };

// Os mesmos dois textos de `semDinheiro` (bloqueio-sem-dinheiro.ts). Lá o corte
// é por código, porque a lista de travas vem estruturada; aqui só há a frase
// que `avancar_os_status` levantou. O teste confere que os dois dizem o mesmo.
const MARGEM_SEM_NUMERO = "Margem abaixo do mínimo — precisa de aprovação do gestor";
const DESCONTO_SEM_NUMERO = "Desconto acima do limite — precisa de aprovação do gestor";

/**
 * Uma trava, sem o número que quem lê não pode ver.
 *
 * `comecar_na_maquina` passa pelas travas do Kanban, e duas delas trazem
 * dinheiro no título: "Margem de 5.00% abaixo do mínimo de 20.00%" (custo) e
 * "Desconto de 15% acima do limite de 10%" (preço). Medido em 01/10/2026: o
 * erro chega ao operador com a margem escrita.
 */
function travaSemDinheiro(titulo: string, visao: VisaoDeDinheiro): string {
  if (!visao.canSeeFinancials && /^margem\b/i.test(titulo)) return MARGEM_SEM_NUMERO;
  if (!visao.canSeePrices && /^desconto\b/i.test(titulo)) return DESCONTO_SEM_NUMERO;
  return titulo;
}

function campo(erro: unknown, nome: string): string {
  if (!erro || typeof erro !== "object") return "";
  const v = (erro as Record<string, unknown>)[nome];
  return typeof v === "string" ? v.trim() : "";
}

const PERMISSAO_EM_PALAVRAS: Record<string, string> = {
  "producao.start": "iniciar produção na máquina",
  "producao.finish": "encerrar produção na máquina",
};

/**
 * Traduz o erro de `maquinas_para_comecar`, `comecar_na_maquina`,
 * `terminar_na_maquina`, `terminar_so_esta_maquina` e `mandar_para_acabamento`
 * — e o de `avancar_os_status`, que traz as mesmas travas.
 *
 * Três formas chegam do banco:
 *   1. erro próprio, com código em `details` — a mensagem já é a frase certa;
 *   2. trava do Kanban, sem código: "A OS não pode avançar ainda: a; b; c." —
 *      vira lista, sem o número de margem ou desconto para quem não pode ver;
 *   3. permissão: "Permissão necessária: producao.start".
 * O que sobrar passa pelo tradutor geral.
 *
 * Sem `visao`, vale a mais restrita: na dúvida, o número não aparece.
 */
export function erroDeMaquina(
  erro: unknown,
  visao: VisaoDeDinheiro = { canSeeFinancials: false, canSeePrices: false },
): ErroDeMaquina {
  const mensagem = erro instanceof Error ? erro.message.trim() : campo(erro, "message");
  const codigo = campo(erro, "details");

  if (Object.prototype.hasOwnProperty.call(TITULO_DO_ERRO, codigo)) {
    const c = codigo as CodigoDeMaquina;
    return {
      codigo: c,
      titulo: TITULO_DO_ERRO[c],
      descricao: mensagem || null,
      listaMudou: LISTA_MUDOU.has(c),
    };
  }

  const travas = /n[aã]o pode avan[cç]ar ainda:\s*(.+?)\.?$/i.exec(mensagem);
  if (travas) {
    return {
      codigo: "travada",
      titulo: "A OS ainda não pode avançar",
      descricao: travas[1]
        .split(";")
        .map((t) => travaSemDinheiro(t.trim(), visao))
        .filter(Boolean)
        .join(" · "),
      listaMudou: false,
    };
  }

  const permissao = /^Permiss[aã]o necess[aá]ria:\s*(\S+)/i.exec(mensagem);
  if (permissao) {
    const oQue = PERMISSAO_EM_PALAVRAS[permissao[1]] ?? `fazer isto (${permissao[1]})`;
    return {
      codigo: "sem_permissao",
      titulo: "Seu perfil não pode fazer isto",
      descricao: `Falta a permissão de ${oQue}. Peça ao gestor.`,
      listaMudou: false,
    };
  }

  return { codigo: "outro", titulo: mensagemErro(erro), descricao: null, listaMudou: false };
}
