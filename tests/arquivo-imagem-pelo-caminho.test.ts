import { describe, expect, it } from "vitest";
import { ehImagemVisivel, ehPdf } from "@/domain/os/arquivos-da-os";

describe("arte sem extensão no nome", () => {
  it("reconhece a imagem pelo caminho guardado", () => {
    expect(ehImagemVisivel("Foto do modelo — Kit", null, "orcamentos-3d/1_modelo.png")).toBe(true);
  });
  it("sem extensão em lugar nenhum não é imagem", () => {
    expect(ehImagemVisivel("Foto do modelo — Kit", null, "orcamentos-3d/arquivo")).toBe(false);
  });
  it("PDF pelo caminho", () => {
    expect(ehPdf("Arte final", null, "orcamento/x.pdf")).toBe(true);
  });
});
