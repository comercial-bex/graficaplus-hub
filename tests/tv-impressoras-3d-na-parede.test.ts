import { describe, expect, it } from "vitest";
import { painelDeExemplo } from "../src/domain/tv/exemplo";
import { lerPainel } from "../src/domain/tv/painel";
import { montarTela, organizarParede } from "../src/domain/tv/tela";

describe("impressoras 3D na parede da TV (28/10/2026)", () => {
  const painel = painelDeExemplo("tres_d");
  const geradoEm = Date.parse(painel.gerado_em) + 20_000;

  it("o exemplo traz as quatro impressoras com o nome do cadastro e passa pelo leitor do contrato", () => {
    const rotulos = painel.maquinas.filter((m) => m.tipo === "impressora_3d").map((m) => m.rotulo);
    expect(rotulos).toEqual(["Bambu Lab 3D 01", "Bambu Lab 3D 02", "Bambu Lab 3D 03", "Bambu Lab 3D Mini"]);
    const lido = lerPainel(JSON.parse(JSON.stringify(painel)));
    expect(lido.ok).toBe(true);
  });

  it("a parede continua com CINCO colunas: as quatro impressoras dividem a coluna 3D", () => {
    const tela = montarTela(painel, geradoEm);
    expect(tela.colunas).toHaveLength(8); // uma por máquina (conferência R7 e testes)
    expect(tela.parede).toHaveLength(5);
    const grupo = tela.parede.find((p) => p.tipo === "grupo_3d");
    expect(grupo && grupo.tipo === "grupo_3d" ? grupo.subs.map((s) => s.rotulo) : []).toEqual([
      "Bambu Lab 3D 01",
      "Bambu Lab 3D 02",
      "Bambu Lab 3D 03",
      "Bambu Lab 3D Mini",
    ]);
  });

  it("a plotter de impressão aparece como Plotter", () => {
    const tela = montarTela(painel, geradoEm);
    expect(tela.colunas[0].identidade.curto).toBe("Plotter");
  });

  it("com uma impressora só (ou nenhuma) a parede fica como sempre foi", () => {
    const tela = montarTela(painelDeExemplo("cheio"), geradoEm);
    expect(tela.parede.every((p) => p.tipo === "maquina")).toBe(true);
    expect(tela.parede).toHaveLength(5);
    expect(organizarParede([], [])).toEqual([]);
  });
});
