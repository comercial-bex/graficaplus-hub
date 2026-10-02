import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ETAPAS, STATUS, etapaDe, osEstaEncerrada, statusInfo } from "../src/domain/os/etapas";
import {
  POR_TIPO,
  identidadeDaMaquina,
  legendaDeMaquinas,
} from "../src/domain/producao/identidade-da-maquina";

/**
 * A PAREDE E O QUADRO FALAM DA MESMA OS.
 *
 * A TV da Oficina conta OS por bloco (entrada e arte, oficina, acabamento, na
 * saída), e conta no banco: `bloco_da_tv(status)`, derivada de
 * `etapa_da_os(status)`. O Kanban e o painel do impressor contam por etapa, e
 * contam no navegador: `etapaDe(status)` em `src/domain/os/etapas.ts`.
 *
 * São duas listas para a mesma verdade, em duas linguagens — exatamente o
 * desenho que já deu errado quatro vezes neste projeto (ver o cabeçalho de
 * etapas.ts) e que na TV2 da agência fez o cartão dizer um número e a lista
 * embaixo dele dizer outro, porque um status terminal faltava em um dos lados.
 *
 * Este teste lê a MIGRAÇÃO (o retrato do que está vivo no banco) e etapas.ts e
 * falha quando:
 *   - um status do enum não tem bloco na parede — a OS nele sumiria da TV;
 *   - a etapa do SQL diverge da etapa do TypeScript;
 *   - "encerrada" quer dizer uma coisa no banco e outra na tela;
 *   - o mapa tipo de máquina → status diverge de identidade-da-maquina.ts.
 *
 * Mudou o enum `status_os`, a lista de etapas ou os tipos de máquina? A
 * migração nova redefine as funções, e este teste passa a ler a migração nova
 * sozinho (ele procura a ÚLTIMA que define cada função).
 *
 * Não substitui o ensaio no banco: o texto da migração pode estar certo e a
 * função viva ser outra. O ensaio (RAISE EXCEPTION no fim) conferiu os 26
 * valores na função viva em 01/10/2026; este teste segura o repositório.
 */

/** Os 26 valores do enum `status_os`, lidos de pg_enum em 01/10/2026. */
const ENUM_STATUS_OS = [
  "entrada", "aguardando_briefing", "briefing_ok",
  "design", "aguardando_aprovacao_arte", "arte_aprovada", "arte_rejeitada", "aguardando_producao",
  "producao", "em_producao", "em_impressao", "em_corte", "em_acabamento", "em_uv", "em_laser_cnc", "em_3d",
  "controle_qualidade", "aguardando_retirada", "aguardando_entrega", "em_entrega", "em_instalacao",
  "concluido", "faturado", "cancelado", "retrabalho", "pausado",
];

/** A partição do desenho da TV: 7 + 8 + 3 + 4 + 1 + 3 = 26. */
const BLOCOS_ESPERADOS: Record<string, number> = {
  entrada_arte: 7,
  oficina: 8,
  acabamento: 3,
  saida: 4,
  pausada: 1,
  fora: 3,
};

const MIGRACOES = "supabase/migrations";

/**
 * O corpo da função, da ÚLTIMA migração que a define.
 *
 * Última e não "a de 01/10": quando alguém redefinir a função numa migração
 * nova, é a nova que vale no banco — conferir a antiga seria passar com o
 * retrato de ontem.
 */
function corpoDaFuncao(nome: string): { arquivo: string; corpo: string } {
  const cabecalho = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nome}\\s*\\(`,
    "i",
  );
  const arquivos = readdirSync(MIGRACOES)
    .filter((a) => a.endsWith(".sql"))
    .sort();
  for (const arquivo of arquivos.reverse()) {
    const texto = readFileSync(join(MIGRACOES, arquivo), "utf8");
    const m = cabecalho.exec(texto);
    if (!m) continue;
    const resto = texto.slice(m.index);
    const corpo = /AS\s+\$function\$([\s\S]*?)\$function\$/.exec(resto);
    if (!corpo) {
      throw new Error(`${arquivo}: achei public.${nome} mas não o corpo entre $function$ … $function$`);
    }
    return { arquivo, corpo: corpo[1] };
  }
  throw new Error(`Nenhuma migração define public.${nome}`);
}

function listaDeStatus(entreParenteses: string): string[] {
  return [...entreParenteses.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

/** etapa_da_os: `WHEN p_status IN ('a', 'b') THEN 'etapa'`. */
function etapasDoSql(): Map<string, string> {
  const { corpo } = corpoDaFuncao("etapa_da_os");
  const mapa = new Map<string, string>();
  for (const m of corpo.matchAll(/WHEN\s+p_status\s+IN\s*\(([^)]*)\)\s*THEN\s*'([a-z_]+)'/gi)) {
    for (const status of listaDeStatus(m[1])) {
      if (mapa.has(status)) throw new Error(`etapa_da_os cita ${status} duas vezes`);
      mapa.set(status, m[2]);
    }
  }
  return mapa;
}

/** os_esta_encerrada: `p_status IN ('concluido', …)`. */
function encerradasDoSql(): string[] {
  const { corpo } = corpoDaFuncao("os_esta_encerrada");
  const m = /p_status\s+IN\s*\(([^)]*)\)/i.exec(corpo);
  if (!m) throw new Error("os_esta_encerrada: não achei a lista `p_status IN (…)`");
  return listaDeStatus(m[1]);
}

type RegraDeBloco =
  | { tipo: "status"; status: string; bloco: string }
  | { tipo: "encerrada"; bloco: string };

/**
 * bloco_da_tv, lida na ORDEM em que o CASE avalia:
 *   WHEN p_status = 'x' THEN 'bloco'                  exceção por status
 *   WHEN public.os_esta_encerrada(p_status) THEN 'b'  exceção das encerradas
 *   ELSE CASE public.etapa_da_os(p_status)
 *     WHEN 'etapa' THEN 'bloco'                       a regra geral
 */
function regrasDoBloco(): { excecoes: RegraDeBloco[]; porEtapa: Map<string, string> } {
  const { corpo } = corpoDaFuncao("bloco_da_tv");
  const [antes, depois] = corpo.split(/ELSE\s+CASE\s+public\.etapa_da_os\s*\(\s*p_status\s*\)/i);
  if (depois === undefined) {
    throw new Error("bloco_da_tv deixou de derivar de etapa_da_os — o teste não sabe mais ler a função");
  }

  const excecoes: RegraDeBloco[] = [];
  const re =
    /WHEN\s+(?:p_status\s*=\s*'([a-z0-9_]+)'|public\.os_esta_encerrada\s*\(\s*p_status\s*\))\s+THEN\s+'([a-z_]+)'/gi;
  for (const m of antes.matchAll(re)) {
    excecoes.push(m[1] ? { tipo: "status", status: m[1], bloco: m[2] } : { tipo: "encerrada", bloco: m[2] });
  }

  const porEtapa = new Map<string, string>();
  for (const m of depois.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([a-z_]+)'/gi)) {
    porEtapa.set(m[1], m[2]);
  }
  return { excecoes, porEtapa };
}

/** O que `bloco_da_tv(status)` devolve, calculado SÓ com o que o SQL diz. */
function blocoPeloSql(status: string): string | null {
  const { excecoes, porEtapa } = regrasDoBloco();
  const encerradas = encerradasDoSql();
  for (const regra of excecoes) {
    if (regra.tipo === "status" && regra.status === status) return regra.bloco;
    if (regra.tipo === "encerrada" && encerradas.includes(status)) return regra.bloco;
  }
  const etapa = etapasDoSql().get(status);
  return etapa ? (porEtapa.get(etapa) ?? null) : null;
}

type TipoDeMaquina = { tipo: string; status: string; ordem: number; etapaPadrao: string };

/** tipos_de_maquina: as linhas do VALUES. */
function tiposDoSql(): TipoDeMaquina[] {
  const { corpo } = corpoDaFuncao("tipos_de_maquina");
  const re =
    /\(\s*'([a-z0-9_]+)'(?:::text)?\s*,\s*'([a-z0-9_]+)'(?:::public\.status_os)?\s*,\s*(\d+)\s*,\s*'([^']+)'(?:::text)?\s*\)/g;
  return [...corpo.matchAll(re)].map((m) => ({
    tipo: m[1],
    status: m[2],
    ordem: Number(m[3]),
    etapaPadrao: m[4],
  }));
}

describe("o teste lê alguma coisa — não pode passar por não achar nada", () => {
  it("acha as funções na migração e extrai as regras", () => {
    // Uma trava que não inspeciona nada passa sempre, e é pior que trava
    // nenhuma. Se o formato do SQL mudar e o extrator ficar cego, é aqui que
    // aparece — e não num "tudo certo" falso lá embaixo.
    expect(etapasDoSql().size).toBe(26);
    expect(encerradasDoSql().length).toBe(3);
    const { excecoes, porEtapa } = regrasDoBloco();
    expect(excecoes.length).toBe(3);
    expect(porEtapa.size).toBe(5);
    expect(tiposDoSql().length).toBe(5);
  });

  it("a lista de status do TypeScript é o enum do banco", () => {
    // os-etapas.test.ts já segura isto; repetido aqui porque tudo abaixo
    // compara contra STATUS, e comparar contra uma lista errada não prova nada.
    expect(STATUS.map((s) => s.status).sort()).toEqual([...ENUM_STATUS_OS].sort());
  });
});

describe("etapa_da_os é o espelho exato de etapas.ts", () => {
  it("todo status do enum tem etapa no SQL, e nenhum status inventado", () => {
    const doSql = [...etapasDoSql().keys()].sort();
    expect(doSql).toEqual([...ENUM_STATUS_OS].sort());
  });

  it("a etapa de cada status é a mesma nos dois lados", () => {
    const sql = etapasDoSql();
    const divergentes = ENUM_STATUS_OS.filter((s) => sql.get(s) !== etapaDe(s)).map(
      (s) => `${s}: SQL diz ${sql.get(s) ?? "nada"}, etapas.ts diz ${etapaDe(s) ?? "nada"}`,
    );
    expect(
      divergentes,
      `A etapa do banco e a da tela divergem — a TV e o Kanban contariam a mesma OS em lugares diferentes:\n  ${divergentes.join("\n  ")}`,
    ).toEqual([]);
  });

  it("o SQL só usa etapas que existem em etapas.ts", () => {
    const usadas = [...new Set(etapasDoSql().values())].sort();
    expect(usadas).toEqual([...ETAPAS].sort());
  });
});

describe("os_esta_encerrada é o espelho de osEstaEncerrada", () => {
  it("concluido, faturado e cancelado — nos dois lados, e só eles", () => {
    expect(encerradasDoSql().sort()).toEqual(ENUM_STATUS_OS.filter(osEstaEncerrada).sort());
  });
});

describe("bloco_da_tv: cada status em exatamente um bloco", () => {
  it("nenhum status do enum fica sem bloco", () => {
    const orfaos = ENUM_STATUS_OS.filter((s) => blocoPeloSql(s) === null);
    expect(
      orfaos,
      `Estes status não têm bloco na parede — a OS neles some da TV e a conferência R1 acusa em produção:\n  ${orfaos.join(", ")}`,
    ).toEqual([]);
  });

  it("a contagem por bloco é a do desenho: 7 + 8 + 3 + 4 + 1 + 3 = 26", () => {
    const contagem: Record<string, number> = {};
    for (const s of ENUM_STATUS_OS) {
      const bloco = blocoPeloSql(s) ?? "SEM BLOCO";
      contagem[bloco] = (contagem[bloco] ?? 0) + 1;
    }
    expect(contagem).toEqual(BLOCOS_ESPERADOS);
    expect(Object.values(contagem).reduce((a, b) => a + b, 0)).toBe(ENUM_STATUS_OS.length);
  });

  it("as três exceções, escritas uma vez", () => {
    // A fila de produção é pré-impressão no Kanban, mas na parede já é da
    // oficina: é o impressor quem olha para ela.
    expect(etapaDe("aguardando_producao")).toBe("pre_impressao");
    expect(blocoPeloSql("aguardando_producao")).toBe("oficina");
    // Pausada não é bloco de destino: a TV devolve a OS ao bloco de onde veio.
    expect(blocoPeloSql("pausado")).toBe("pausada");
    // Encerrada sai da parede — inclusive concluido e faturado, que em
    // etapas.ts pertencem à etapa "saida".
    for (const s of ["concluido", "faturado", "cancelado"]) expect(blocoPeloSql(s)).toBe("fora");
    expect(etapaDe("concluido")).toBe("saida");
  });

  it("fora as exceções, o bloco segue a etapa do TypeScript", () => {
    const esperado: Record<string, string> = {
      entrada: "entrada_arte",
      pre_impressao: "entrada_arte",
      producao: "oficina",
      acabamento: "acabamento",
      saida: "saida",
    };
    const excecoes = new Set(["aguardando_producao", "pausado", "concluido", "faturado", "cancelado"]);
    for (const s of ENUM_STATUS_OS) {
      if (excecoes.has(s)) continue;
      expect(blocoPeloSql(s), `${s} (etapa ${etapaDe(s)})`).toBe(esperado[etapaDe(s) as string]);
    }
  });

  it("toda etapa do fluxo tem bloco; fora_do_fluxo só entra por exceção escrita", () => {
    const { porEtapa } = regrasDoBloco();
    for (const etapa of ETAPAS) {
      if (etapa === "fora_do_fluxo") {
        // De propósito sem regra geral: um status novo nessa etapa tem de
        // FALHAR (bloco nulo) até alguém decidir onde ele aparece.
        expect(porEtapa.has(etapa)).toBe(false);
      } else {
        expect(porEtapa.has(etapa), `etapa ${etapa} sem bloco`).toBe(true);
      }
    }
  });

  it("os oito status da oficina são a fila mais as sete máquinas/genéricos", () => {
    const oficina = ENUM_STATUS_OS.filter((s) => blocoPeloSql(s) === "oficina").sort();
    const esperado = ["aguardando_producao", ...STATUS.filter((s) => s.etapa === "producao").map((s) => s.status)];
    expect(oficina).toEqual(esperado.sort());
  });
});

describe("tipos_de_maquina é o mesmo mapa de identidade-da-maquina.ts", () => {
  it("os tipos do SQL são os tipos que a tela conhece", () => {
    expect(tiposDoSql().map((t) => t.tipo).sort()).toEqual(Object.keys(POR_TIPO).sort());
  });

  it("a ordem das colunas é a da legenda", () => {
    const doSql = [...tiposDoSql()].sort((a, b) => a.ordem - b.ordem).map((t) => t.tipo);
    expect(doSql).toEqual(legendaDeMaquinas().map((m) => m.chave));
    expect(new Set(tiposDoSql().map((t) => t.ordem)).size).toBe(tiposDoSql().length);
  });

  it("todo status de máquina existe no enum e é caminho paralelo de produção", () => {
    for (const t of tiposDoSql()) {
      expect(ENUM_STATUS_OS, `${t.tipo} → ${t.status}`).toContain(t.status);
      expect(statusInfo(t.status)?.etapa, `${t.tipo} → ${t.status}`).toBe("producao");
      expect(statusInfo(t.status)?.paralela, `${t.tipo} → ${t.status}`).toBe(true);
      expect(t.etapaPadrao.trim().length, `${t.tipo} sem etapa padrão`).toBeGreaterThan(0);
    }
  });

  it("status que identifica UMA máquina aponta para o mesmo tipo dos dois lados", () => {
    const porStatus = new Map<string, string[]>();
    for (const t of tiposDoSql()) porStatus.set(t.status, [...(porStatus.get(t.status) ?? []), t.tipo]);

    const identificam = [...porStatus.entries()].filter(([, tipos]) => tipos.length === 1);
    expect(identificam.map(([s]) => s).sort()).toEqual(["em_3d", "em_corte", "em_impressao"]);
    for (const [status, [tipo]] of identificam) {
      expect(identidadeDaMaquina({ status })?.chave, status).toBe(tipo);
    }
  });

  it("em_laser_cnc continua ambíguo dos dois lados — a casa tem dois lasers", () => {
    const lasers = tiposDoSql().filter((t) => t.status === "em_laser_cnc").map((t) => t.tipo).sort();
    expect(lasers).toEqual(["laser_co2", "laser_fiber"]);
    // A tela também não escolhe: mostra o selo genérico "Laser", que não é
    // nenhum dos dois tipos. Se um dia escolher, o SQL tem de escolher junto.
    const chave = identidadeDaMaquina({ status: "em_laser_cnc" })?.chave ?? "";
    expect(Object.keys(POR_TIPO)).not.toContain(chave);
  });

  it("UV e os genéricos não têm máquina no mapa", () => {
    const comMaquina = new Set(tiposDoSql().map((t) => t.status));
    for (const s of ["em_uv", "em_producao", "producao"]) expect(comMaquina.has(s), s).toBe(false);
  });
});
