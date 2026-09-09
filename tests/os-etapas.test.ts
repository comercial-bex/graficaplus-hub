import { describe, expect, it } from "vitest";
import {
  ETAPAS,
  ETAPAS_QUADRO,
  STATUS,
  etapaDe,
  fluxo,
  porEtapa,
  progressoDaEtapa,
  rotuloDe,
  setorDe,
  statusInfo,
  statusPadraoDaEtapa,
} from "../src/domain/os/etapas";

/**
 * O CONTRATO com o banco.
 *
 * Estes são os 26 valores do enum `status_os`, conferidos no Postgres em
 * 09/09/2026. Esta constante existe para o teste falhar quando alguém mexer só
 * de um lado — foi a divergência entre listas que fez a tela de detalhe da OS
 * oferecer `em_design` e `novo`, dois valores que o banco RECUSA. Selecionar um
 * deles e salvar devolvia "invalid input value for enum status_os".
 *
 * Mudou o enum? Atualize aqui NA MESMA migração, e o teste diz se a lista de
 * etapas ficou para trás.
 */
const ENUM_STATUS_OS = [
  "entrada", "aguardando_briefing", "briefing_ok",
  "design", "aguardando_aprovacao_arte", "arte_aprovada", "arte_rejeitada", "aguardando_producao",
  "producao", "em_producao", "em_impressao", "em_corte", "em_acabamento", "em_uv", "em_laser_cnc", "em_3d",
  "controle_qualidade", "aguardando_retirada", "aguardando_entrega", "em_entrega", "em_instalacao",
  "concluido", "faturado", "cancelado", "retrabalho", "pausado",
];

describe("a lista de etapas bate com o enum do banco", () => {
  it("nenhum status na tela que o banco recusa", () => {
    const inventados = STATUS.map((s) => s.status).filter((s) => !ENUM_STATUS_OS.includes(s));
    expect(
      inventados,
      `Estes status não existem no enum — a tela ofereceria e o banco recusaria:\n  ${inventados.join(", ")}`,
    ).toEqual([]);
  });

  it("nenhum status do banco sem lugar no fluxo", () => {
    const orfaos = ENUM_STATUS_OS.filter((s) => !STATUS.some((x) => x.status === s));
    expect(
      orfaos,
      `Estes status existem no banco e não têm etapa — a OS neles desaparece do quadro:\n  ${orfaos.join(", ")}`,
    ).toEqual([]);
  });

  it("nenhum status repetido", () => {
    const vistos = STATUS.map((s) => s.status);
    expect(new Set(vistos).size).toBe(vistos.length);
  });
});

describe("as cinco etapas do fluxo", () => {
  it("toda etapa tem pelo menos um status", () => {
    for (const e of ETAPAS) {
      expect(porEtapa(e).length, `etapa ${e} está vazia`).toBeGreaterThan(0);
    }
  });

  it("a soma das etapas é o total — nenhum status conta duas vezes nem falta", () => {
    expect(fluxo().reduce((n, f) => n + f.status.length, 0)).toBe(STATUS.length);
  });

  it("as etapas de máquina são as paralelas, e só elas", () => {
    // Impressão, recorte, laser, 3D e UV: a peça entra em UMA.
    const paralelas = STATUS.filter((s) => s.paralela).map((s) => s.status);
    expect(paralelas.sort()).toEqual(["em_3d", "em_corte", "em_impressao", "em_laser_cnc", "em_uv"]);
    expect(STATUS.filter((s) => s.paralela).every((s) => s.etapa === "producao")).toBe(true);
  });

  it("o UV avisa que a casa não tem a máquina", () => {
    expect(statusInfo("em_uv")?.observacao).toContain("não tem máquina UV");
  });

  it("os dois status de produção genérica dizem que se duplicam", () => {
    expect(statusInfo("producao")?.observacao).toContain("duplica");
    expect(statusInfo("em_producao")?.observacao).toContain("genérico");
  });
});

describe("o quadro tem cinco colunas, não vinte e cinco", () => {
  it("a coluna é a etapa, e pausado/cancelado não são coluna", () => {
    // Vinte e cinco colunas não é quadro, é lista deitada. E OS pausada não é
    // estágio da produção: é exceção, vira selo no cartão.
    expect(ETAPAS_QUADRO).toEqual(["entrada", "pre_impressao", "producao", "acabamento", "saida"]);
    expect(ETAPAS_QUADRO.length).toBeLessThanOrEqual(5);
  });

  it("todo status do banco cai em alguma coluna, ou no fora do fluxo", () => {
    for (const s of ENUM_STATUS_OS) {
      const etapa = etapaDe(s);
      expect(etapa, `${s} não tem etapa — a OS nele sumiria do quadro`).not.toBeNull();
    }
  });
});

describe("soltar o cartão numa coluna", () => {
  it("o status de entrada de cada etapa existe no banco", () => {
    // Se a coluna mandasse um status inventado, arrastar devolveria
    // "invalid input value for enum status_os" — o mesmo defeito que a tela de
    // detalhe tinha, só que agora no gesto principal do quadro.
    for (const etapa of ETAPAS) {
      const padrao = statusPadraoDaEtapa(etapa);
      expect(ENUM_STATUS_OS, `etapa ${etapa} → ${padrao}`).toContain(padrao);
    }
  });

  it("o status de entrada pertence à própria etapa", () => {
    for (const etapa of ETAPAS) {
      expect(etapaDe(statusPadraoDaEtapa(etapa))).toBe(etapa);
    }
  });

  it("a saída pergunta à OS se é retirada, entrega ou instalação", () => {
    expect(statusPadraoDaEtapa("saida", null)).toBe("aguardando_retirada");
    expect(statusPadraoDaEtapa("saida", { precisa_entrega: true })).toBe("aguardando_entrega");
    expect(statusPadraoDaEtapa("saida", { precisa_instalacao: true })).toBe("em_instalacao");
    // Instalação manda: quem instala também entrega, e o contrário não vale.
    expect(statusPadraoDaEtapa("saida", { precisa_entrega: true, precisa_instalacao: true })).toBe(
      "em_instalacao",
    );
  });
});

describe("progresso do fluxo", () => {
  it("avança etapa por etapa até 100%", () => {
    expect(progressoDaEtapa("entrada")).toBeCloseTo(1 / 5, 3);
    expect(progressoDaEtapa("design")).toBeCloseTo(2 / 5, 3);
    expect(progressoDaEtapa("em_impressao")).toBeCloseTo(3 / 5, 3);
    expect(progressoDaEtapa("em_acabamento")).toBeCloseTo(4 / 5, 3);
    expect(progressoDaEtapa("concluido")).toBe(1);
  });

  it("pausado e cancelado devolvem null, não zero", () => {
    // Zero desenharia barra vazia e diria que a OS está no começo. Ela está
    // FORA da conta — é diferente, e a tela precisa poder mostrar isso.
    expect(progressoDaEtapa("pausado")).toBeNull();
    expect(progressoDaEtapa("cancelado")).toBeNull();
  });

  it("status inventado não vira progresso", () => {
    expect(progressoDaEtapa("em_design")).toBeNull();
    expect(progressoDaEtapa(null)).toBeNull();
  });
});

describe("rótulo e setor", () => {
  it("traduz o status para o que a equipe fala", () => {
    expect(rotuloDe("em_laser_cnc")).toBe("Laser / CNC");
    expect(rotuloDe("aguardando_producao")).toBe("Fila de produção");
    expect(setorDe("controle_qualidade")).toBe("Qualidade");
  });

  it("status desconhecido mostra o valor cru, não some da tela", () => {
    expect(rotuloDe("coisa_nova")).toBe("coisa_nova");
    expect(rotuloDe(null)).toBe("—");
    expect(setorDe("coisa_nova")).toBe("—");
  });
});
