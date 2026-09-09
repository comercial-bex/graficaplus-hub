import { describe, expect, it } from "vitest";
import {
  sugerirMaquina,
  sugestoesParaAplicar,
  type MaquinaDisponivel,
  type Produto,
} from "../src/domain/producao/sugerir-maquina";

/**
 * O parque real da casa. A base de cobrança é o que identifica o papel de cada
 * máquina — o nome muda, o papel não.
 */
const PARQUE: MaquinaDisponivel[] = [
  { id: "i", nome: "Plotter de Impressão i1600 180 — Eco", base_cobranca: "area", velocidade_m2_h: 14 },
  { id: "cnc", nome: "CNC Laser 10060 — CO2 100W", base_cobranca: "tempo", velocidade_m2_h: null },
  { id: "rec", nome: "Plotter de Recorte 120", base_cobranca: "metro_linear", velocidade_m2_h: null },
  { id: "fib", nome: "Fiber 30W", base_cobranca: "peca", velocidade_m2_h: null },
  { id: "b3d", nome: "Bambu Lab A1", base_cobranca: "tempo", velocidade_m2_h: null },
];

const prod = (p: Partial<Produto>): Produto => ({
  id: "p", nome: "", categoria: null, tipo: "produto", unidade: "m2", maquina_padrao_id: null, ...p,
});

describe("impressão em bobina", () => {
  it("lona e adesivo impresso vão para a impressora", () => {
    for (const nome of ["Lona 280g impressa", "Adesivo vinil branco impresso", "Fachada luminosa em lona"]) {
      const s = sugerirMaquina(prod({ nome, categoria: "impressao_grande_formato" }), PARQUE);
      expect(s.tipo === "maquina" && s.maquinaId).toBe("i");
    }
  });

  it("a categoria adesivos leva para a impressora mesmo sem a palavra impresso", () => {
    const s = sugerirMaquina(prod({ nome: "Adesivo Praguinha 7 × 7 cm", categoria: "adesivos" }), PARQUE);
    expect(s.tipo === "maquina" && s.maquinaId).toBe("i");
  });
});

describe("recorte vem antes de impressão", () => {
  it('"adesivo vinil recortado" tem as duas palavras e é do recorte', () => {
    const s = sugerirMaquina(prod({ nome: "Adesivo vinil recortado", categoria: "adesivos" }), PARQUE);
    expect(s.tipo === "maquina" && s.maquinaId).toBe("rec");
  });
});

describe("o produto que NENHUMA máquina da casa faz", () => {
  it("ACM é alumínio: o laser de CO2 não corta metal", () => {
    const s = sugerirMaquina(prod({ nome: "Placa ACM 3mm com adesivo", categoria: "comunicacao_visual" }), PARQUE);
    expect(s.tipo).toBe("fora_do_parque");
    expect(s.motivo).toContain("alumínio");
  });

  it("PVC no laser libera cloro — e isso vale para placa e para letra caixa", () => {
    for (const nome of ["Placa PVC expandido 3mm", "Letra caixa em PVC"]) {
      const s = sugerirMaquina(prod({ nome, categoria: "comunicacao_visual" }), PARQUE);
      expect(s.tipo).toBe("fora_do_parque");
      expect(s.motivo).toContain("cloro");
    }
  });

  it("cartão e panfleto são offset de terceiro", () => {
    const s = sugerirMaquina(prod({ nome: "Cartão de visita 4x4 (milheiro)", categoria: "brindes", unidade: "mil" }), PARQUE);
    expect(s.tipo).toBe("fora_do_parque");
    expect(s.motivo).toContain("offset");
  });

  it("o veto ganha da categoria: placa de ACM está junto com fachada de lona", () => {
    // As duas são comunicacao_visual. A fachada a impressora faz; o ACM, não.
    const fachada = sugerirMaquina(prod({ nome: "Fachada luminosa em lona", categoria: "comunicacao_visual" }), PARQUE);
    const acm = sugerirMaquina(prod({ nome: "Placa ACM 3mm com adesivo", categoria: "comunicacao_visual" }), PARQUE);
    expect(fachada.tipo).toBe("maquina");
    expect(acm.tipo).toBe("fora_do_parque");
  });
});

describe("serviço não tem máquina", () => {
  it("arte, acabamento, instalação e deslocamento ficam sem máquina", () => {
    for (const nome of ["Criação/arte final", "Laminação de adesivo", "Instalação em campo", "Deslocamento"]) {
      const s = sugerirMaquina(prod({ nome, tipo: "servico" }), PARQUE);
      expect(s.tipo).toBe("sem_maquina");
    }
  });

  it('"Laminação de adesivo" NÃO vai para a impressora só por ter "adesivo" no nome', () => {
    const s = sugerirMaquina(prod({ nome: "Laminação de adesivo", tipo: "servico", categoria: "acabamento" }), PARQUE);
    expect(s.tipo).toBe("sem_maquina");
  });

  it('serviço de impressão 3D é a exceção: tem máquina, e não é a de lona', () => {
    const s = sugerirMaquina(prod({ nome: "Impressão 3D (serviço)", tipo: "servico", categoria: "servico" }), PARQUE);
    expect(s.tipo === "maquina" && s.maquinaId).toBe("b3d");
  });
});

describe("corte e marcação", () => {
  it("acrílico e MDF vão para o laser", () => {
    const s = sugerirMaquina(prod({ nome: "Placa de acrílico gravada" }), PARQUE);
    expect(s.tipo === "maquina" && s.maquinaId).toBe("cnc");
  });

  it("chaveiro e copo vão para a fiber", () => {
    const s = sugerirMaquina(prod({ nome: "Chaveiro em aço marcado" }), PARQUE);
    expect(s.tipo === "maquina" && s.maquinaId).toBe("fib");
  });
});

describe("a sugestão nunca grava, e nunca chuta", () => {
  it("nome que não diz nada devolve sem_maquina, não a máquina mais larga", () => {
    const s = sugerirMaquina(prod({ nome: "Item avulso", categoria: null }), PARQUE);
    expect(s.tipo).toBe("sem_maquina");
    expect(s.motivo).toContain("escolha à mão");
  });

  it("parque vazio não inventa máquina", () => {
    const s = sugerirMaquina(prod({ nome: "Lona 280g impressa", categoria: "impressao_grande_formato" }), []);
    expect(s.tipo).toBe("sem_maquina");
  });

  it("produto que JÁ tem máquina fica fora do lote — não sobrescreve escolha de ninguém", () => {
    const lista = [
      prod({ id: "a", nome: "Lona 280g impressa", categoria: "impressao_grande_formato" }),
      prod({ id: "b", nome: "Lona 440g impressa", categoria: "impressao_grande_formato", maquina_padrao_id: "cnc" }),
    ];
    const r = sugestoesParaAplicar(lista, PARQUE);
    expect(r.map((x) => x.produto.id)).toEqual(["a"]);
  });

  it("o lote traz só quem tem máquina a aplicar: serviço e fora-do-parque não entram", () => {
    const lista = [
      prod({ id: "a", nome: "Lona 280g impressa", categoria: "impressao_grande_formato" }),
      prod({ id: "b", nome: "Placa ACM 3mm", categoria: "comunicacao_visual" }),
      prod({ id: "c", nome: "Instalação em campo", tipo: "servico" }),
    ];
    expect(sugestoesParaAplicar(lista, PARQUE).map((x) => x.produto.id)).toEqual(["a"]);
  });
});

describe("A4 e A3 são folha, e a casa só tem bobina", () => {
  it("impressão A4/A3 fica fora do parque, não vai para a i1600", () => {
    for (const nome of ["Impressão A3 colorida", "Impressão A4 colorida"]) {
      const s = sugerirMaquina(prod({ nome, categoria: "impressao_grande_formato" }), PARQUE);
      expect(s.tipo).toBe("fora_do_parque");
      expect(s.motivo).toContain("bobina de 1,80 m");
    }
  });

  it("mas o A5 do panfleto continua sendo offset, não folha da casa", () => {
    const s = sugerirMaquina(prod({ nome: "Panfleto A5 4x4 (milheiro)", categoria: "brindes" }), PARQUE);
    expect(s.motivo).toContain("offset");
  });

  it('"Bolão 48 × 48" não vira A4 por ter número — a regra é a palavra, não o dígito', () => {
    const s = sugerirMaquina(prod({ nome: "Bolão Leitoso 48 × 48 cm", categoria: "adesivos" }), PARQUE);
    expect(s.tipo === "maquina" && s.maquinaId).toBe("i");
  });
});
