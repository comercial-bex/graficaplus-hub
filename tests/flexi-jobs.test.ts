import { describe, expect, it } from "vitest";
import {
  areaM2,
  chaveDoJob,
  lerDataHora,
  lerDimensao,
  lerNumero,
  lerStatus,
  lerTamanhoKb,
  montarJobs,
  resumoDosJobs,
} from "../src/domain/flexi/jobs";

/** Linhas reais da fila do FlexiPRINT (print de 24/10/2026). */
const linha = (o: Record<string, unknown>) => ({
  autor: "supor",
  icc: "YP SY I3200 CHETIE",
  cores: "CMYK (2 bits)",
  apos_saida: "Manter",
  ...o,
});

describe("leitura dos campos da tela", () => {
  it("lê número com vírgula decimal e rejeita lixo", () => {
    expect(lerNumero("120,015")).toBe(120.015);
    expect(lerNumero("1.276,3")).toBe(1276.3);
    expect(lerNumero(54)).toBe(54);
    expect(lerNumero("abc")).toBeNull();
    expect(lerNumero("")).toBeNull();
  });

  it("lê a dimensão em cm, com ou sem sufixo", () => {
    expect(lerDimensao("120,015 x 80,010cm")).toEqual({ larguraCm: 120.015, alturaCm: 80.01 });
    expect(lerDimensao("8,000 x 8,000cm")).toEqual({ larguraCm: 8, alturaCm: 8 });
    expect(lerDimensao("11,024 × 7,027")).toEqual({ larguraCm: 11.024, alturaCm: 7.027 });
    expect(lerDimensao("1,2 x 0,8 m")).toEqual({ larguraCm: 120, alturaCm: 80 });
    expect(lerDimensao("sem medida")).toBeNull();
    expect(lerDimensao("0,000 x 5,000cm")).toBeNull();
  });

  it("converte a data da máquina para -03:00, sem deixar o banco (UTC) deslocar", () => {
    expect(lerDataHora("28/09/2026 15:01:56")).toBe("2026-09-28T15:01:56-03:00");
    expect(lerDataHora("5/10/2026 9:05")).toBe("2026-10-05T09:05:00-03:00");
    expect(lerDataHora("31/02/2026 10:00:00")).toBeNull();
    expect(lerDataHora("28/13/2026 10:00:00")).toBeNull();
    expect(lerDataHora("ontem")).toBeNull();
  });

  it("reconhece o status mesmo com acento ou texto cortado", () => {
    expect(lerStatus("Concluído")).toBe("concluido");
    expect(lerStatus("concluido")).toBe("concluido");
    expect(lerStatus("Abortado")).toBe("abortado");
    expect(lerStatus("Mantendo")).toBe("mantendo");
    expect(lerStatus("")).toBe("outro");
    expect(lerStatus(undefined)).toBe("outro");
  });

  it("lê o tamanho do arquivo em KB", () => {
    expect(lerTamanhoKb("1276,3K")).toBe(1276.3);
    expect(lerTamanhoKb("12722,4K")).toBe(12722.4);
    expect(lerTamanhoKb("2,5M")).toBe(2560);
    expect(lerTamanhoKb("")).toBeNull();
  });

  it("calcula m² impressos: medida × cópias", () => {
    expect(areaM2(11.024, 7.027, 54)).toBe(0.4183);
    expect(areaM2(131, 251.899, 1)).toBe(3.2999);
    expect(areaM2(100, 100, 1)).toBe(1);
  });
});

describe("chave do job", () => {
  it("não depende do nome: o mesmo job com a coluna mais larga é o mesmo job", () => {
    const curta = montarJobs([
      linha({
        nome: "Banner Lona Fina 8(",
        status: "Concluído",
        dimensao: "120,015 x 80,010cm",
        copias: 1,
        data: "24/09/2026 15:41:53",
      }),
    ]).jobs[0];
    const longa = montarJobs([
      linha({
        nome: "Banner Lona Fina 80x120.jpg",
        status: "Concluído",
        dimensao: "120,015 x 80,010cm",
        copias: 1,
        data: "24/09/2026 15:41:53",
      }),
    ]).jobs[0];
    expect(curta.chave).toBe(longa.chave);
    expect(curta.nome).not.toBe(longa.nome);
  });

  it("jobs do mesmo segundo com medidas diferentes não colidem", () => {
    expect(chaveDoJob("2026-09-30T16:03:18-03:00", 120.015, 89.992, 1)).not.toBe(
      chaveDoJob("2026-09-30T16:03:18-03:00", 45.009, 80.027, 1),
    );
  });
});

describe("montar os jobs", () => {
  it("monta o job do orçamento 115 como está na tela", () => {
    const { jobs, rejeitadas } = montarJobs([
      linha({
        nome: "50 und 11x7.png",
        status: "Concluído",
        dimensao: "11,024 x 7,027cm",
        copias: "54",
        tipo: "Imagens Bitmap",
        tamanho: "1447,1K",
        data: "24/10/2026 10:43:25",
      }),
    ]);
    expect(rejeitadas).toEqual([]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      nome: "50 und 11x7.png",
      status: "concluido",
      larguraCm: 11.024,
      alturaCm: 7.027,
      copias: 54,
      areaM2: 0.4183,
      impressoEm: "2026-10-24T10:43:25-03:00",
      aninhado: false,
      paiChave: null,
    });
  });

  it("rejeita linha sem medida, sem data ou sem cópia — nunca chuta", () => {
    const { jobs, rejeitadas } = montarJobs([
      linha({ nome: "a", dimensao: "??", copias: 1, data: "24/10/2026 10:43:25" }),
      linha({ nome: "b", dimensao: "10,000 x 10,000cm", copias: 1, data: "" }),
      linha({ nome: "c", dimensao: "10,000 x 10,000cm", copias: 0, data: "24/10/2026 10:43:25" }),
      linha({ nome: "d", dimensao: "10,000 x 10,000cm", copias: 1.5, data: "24/10/2026 10:43:25" }),
      linha({ nome: "ok", dimensao: "10,000 x 10,000cm", copias: 2, data: "24/10/2026 10:43:25" }),
    ]);
    expect(jobs.map((j) => j.nome)).toEqual(["ok"]);
    expect(rejeitadas).toEqual([
      { indice: 0, motivo: "medida ilegível" },
      { indice: 1, motivo: "data ilegível" },
      { indice: 2, motivo: "cópias inválidas" },
      { indice: 3, motivo: "cópias inválidas" },
    ]);
  });

  it("liga os filhos de um aninhamento ao pai e não conta a mídia duas vezes", () => {
    const { jobs } = montarJobs([
      linha({
        nome: "Otimizar Distribuição",
        status: "Concluído",
        dimensao: "146,001 x 120,015cm",
        copias: 1,
        data: "30/09/2026 16:03:18",
      }),
      linha({
        nome: "Banner lona Fi",
        filho: true,
        dimensao: "120,015 x 89,992cm",
        copias: 1,
        data: "30/09/2026 16:03:18",
      }),
      linha({
        nome: "Banner lona Fi",
        filho: true,
        dimensao: "45,009 x 80,027cm",
        copias: 1,
        data: "30/09/2026 16:03:18",
      }),
    ]);
    expect(jobs).toHaveLength(3);
    const pai = jobs[0];
    expect(pai.aninhado).toBe(false);
    expect(jobs[1].paiChave).toBe(pai.chave);
    expect(jobs[2].paiChave).toBe(pai.chave);
    // Os filhos não têm status na tela; só o pai entra na soma de m².
    expect(resumoDosJobs(jobs).areaConcluidaM2).toBe(1.75);
  });

  it("a mesma linha duas vezes no mesmo print vale uma", () => {
    const l = linha({
      nome: "x",
      dimensao: "10,000 x 10,000cm",
      copias: 1,
      data: "24/10/2026 10:43:25",
    });
    expect(montarJobs([l, l]).jobs).toHaveLength(1);
  });

  it("resume concluídos, abortados e mantendo", () => {
    const { jobs } = montarJobs([
      linha({
        nome: "a",
        status: "Concluído",
        dimensao: "100,000 x 100,000cm",
        copias: 1,
        data: "01/10/2026 10:00:00",
      }),
      linha({
        nome: "b",
        status: "Abortado",
        dimensao: "100,000 x 100,000cm",
        copias: 1,
        data: "01/10/2026 11:00:00",
      }),
      linha({
        nome: "c",
        status: "Mantendo",
        dimensao: "100,000 x 100,000cm",
        copias: 1,
        data: "01/10/2026 12:00:00",
      }),
    ]);
    expect(resumoDosJobs(jobs)).toEqual({
      total: 3,
      concluidos: 1,
      abortados: 1,
      mantendo: 1,
      areaConcluidaM2: 1,
    });
  });
});
