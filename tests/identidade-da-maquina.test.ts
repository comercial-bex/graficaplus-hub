import { describe, expect, it } from "vitest";
import {
  POR_TIPO,
  identidadeDaMaquina,
  legendaDeMaquinas,
  statusIndicaMaquina,
} from "../src/domain/producao/identidade-da-maquina";

/**
 * Os `tipo` das cinco máquinas, conferidos na tabela `maquinas` em 09/09/2026.
 *
 * A coluna é TEXTO LIVRE, não enum — o banco não impede que alguém digite
 * "plotter-impressao" com hífen e o cartão perca a cor. Esta constante é o
 * contrato: máquina cadastrada tem identidade própria.
 */
const TIPOS_NO_BANCO = [
  "plotter_impressao",
  "plotter_recorte",
  "laser_co2",
  "laser_fiber",
  "impressora_3d",
];

describe("toda máquina cadastrada tem cara própria", () => {
  it("os cinco tipos do banco estão mapeados", () => {
    const faltando = TIPOS_NO_BANCO.filter((t) => !POR_TIPO[t]);
    expect(
      faltando,
      `Estes tipos existem na tabela maquinas e cairiam no ícone genérico:\n  ${faltando.join(", ")}`,
    ).toEqual([]);
  });

  it("nenhuma cor se repete — cor repetida não distingue nada", () => {
    const cores = legendaDeMaquinas().map((m) => m.cor);
    expect(new Set(cores).size).toBe(cores.length);
  });

  it("nenhum ícone se repete entre as cinco", () => {
    const icones = legendaDeMaquinas().map((m) => m.icone);
    expect(new Set(icones).size).toBe(icones.length);
  });
});

describe("as cores passam no contraste sobre o cartão escuro", () => {
  // O #7c5cff do --chart-4 dá 4,26 sobre #12131a e reprova. Este teste existe
  // para ninguém "voltar para a cor da paleta" sem refazer a conta.
  const luminancia = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const razao = (a: string, b: string) => {
    const [la, lb] = [luminancia(a), luminancia(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  it.each([
    ["cartão", "#12131a"],
    ["superfície muted", "#1a1c25"],
  ])("todas legíveis sobre %s", (_nome, fundo) => {
    for (const m of legendaDeMaquinas()) {
      expect(razao(m.cor, fundo), `${m.curto} (${m.cor})`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("o cartão não fala duas vezes", () => {
  it("status de máquina já diz o caminho — o chip de status sai", () => {
    // "Laser / CNC · Laser CO2" é a mesma informação repetida, e o selo é o
    // mais específico dos dois.
    expect(statusIndicaMaquina("em_impressao")).toBe(true);
    expect(statusIndicaMaquina("em_corte")).toBe(true);
    expect(statusIndicaMaquina("em_laser_cnc")).toBe(true);
    expect(statusIndicaMaquina("em_3d")).toBe(true);
    expect(statusIndicaMaquina("em_uv")).toBe(true);
  });

  it("status genérico soma com o selo — os dois ficam", () => {
    // "Em produção · Fiber": o status diz o estágio, o selo diz a máquina.
    expect(statusIndicaMaquina("em_producao")).toBe(false);
    expect(statusIndicaMaquina("em_acabamento")).toBe(false);
    expect(statusIndicaMaquina(null)).toBe(false);
  });
});

describe("de onde a identidade vem", () => {
  it("a máquina vinculada manda", () => {
    expect(identidadeDaMaquina({ maquinas: { tipo: "laser_co2" }, status: "em_impressao" })?.curto).toBe(
      "Laser CO2",
    );
  });

  it("sem máquina vinculada, o status diz o caminho", () => {
    // O caso real: as duas OS abertas têm maquina_id nulo.
    expect(identidadeDaMaquina({ status: "em_impressao" })?.curto).toBe("Impressão");
    expect(identidadeDaMaquina({ status: "em_corte" })?.curto).toBe("Recorte");
    expect(identidadeDaMaquina({ status: "em_3d" })?.curto).toBe("3D");
  });

  it("laser sem máquina não escolhe entre CO2 e Fiber", () => {
    // Chutar seria o mesmo erro de gravar vínculo arbitrário: parece
    // informação e é palpite.
    const id = identidadeDaMaquina({ status: "em_laser_cnc" })!;
    expect(id.curto).toBe("Laser");
    expect(id.observacao).toContain("dois lasers");
  });

  it("UV fica cinza e avisa que não é da casa", () => {
    const id = identidadeDaMaquina({ status: "em_uv" })!;
    expect(id.cor).toBe("#8b94a7");
    expect(id.observacao).toContain("não tem máquina UV");
  });

  it("tipo desconhecido mostra o nome da máquina, não some", () => {
    const id = identidadeDaMaquina({ maquinas: { tipo: "prensa_termica", nome: "Prensa 40x60" } })!;
    expect(id.curto).toBe("Prensa 40x60");
    expect(id.icone).toBe("Factory");
  });

  it("OS que não passou por máquina não ganha ícone", () => {
    // Briefing e aprovação de arte não têm máquina. Um ícone ali é ruído.
    expect(identidadeDaMaquina({ status: "aguardando_briefing" })).toBeNull();
    expect(identidadeDaMaquina({ status: "design" })).toBeNull();
    expect(identidadeDaMaquina({})).toBeNull();
  });
});
