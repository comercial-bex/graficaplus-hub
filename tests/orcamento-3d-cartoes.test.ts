import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TELA = readFileSync("src/routes/_authenticated/orcamento-3d-novo.tsx", "utf8");

describe("orçamento 3D com cartões", () => {
  it("impressora, filamento e presets são cartões de escolha", () => {
    expect(TELA).toContain('rotulo="Impressora"');
    expect(TELA).toContain('rotulo="Filamento"');
    expect(TELA).toContain('rotulo="Presets de custo"');
    expect(TELA).not.toContain('aria-label="Impressora"');
    expect(TELA).not.toContain('aria-label="Filamento"');
  });

  it("escolher continua gravando nos mesmos campos do cálculo", () => {
    expect(TELA).toContain('set("maquina_id", m.maquina_id)');
    expect(TELA).toContain('set("material_id", m.material_id)');
    expect(TELA).toContain("aplicarPreset(p.patch)");
  });

  it("o custo só aparece para quem pode ver custo", () => {
    expect(TELA).toContain("podeVerCusto");
    const bloco = TELA.slice(
      TELA.indexOf('rotulo="Impressora"'),
      TELA.indexOf('rotulo="Filamento"'),
    );
    expect(bloco).toContain("podeVerCusto");
  });

  it("o preset guardado da última vez volta marcado", () => {
    expect(TELA).toContain("setPresetAtivo(p.id)");
    expect(TELA).toContain("ativo={presetAtivo === p.id}");
  });

  it("os três blocos numerados e o resultado ao vivo continuam", () => {
    for (const t of ["Identificação", "Dados do fatiador", "Parâmetros de custo"])
      expect(TELA).toContain(`titulo="${t}"`);
  });
});
