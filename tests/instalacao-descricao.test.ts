import { describe, expect, it } from "vitest";
import { descricaoAoEscolherOrigem, descricaoDaInstalacao, origemPadrao } from "@/domain/orcamentos/instalacao";

describe("descrição da instalação", () => {
  it("monta 'Instalação do <item>'", () => {
    expect(descricaoDaInstalacao("Adesivo perfurado (one way)")).toBe("Instalação do adesivo perfurado (one way)");
  });
  it("pré-seleciona só com um item de produto", () => {
    expect(origemPadrao([{ id: "a" }])).toBe("a");
    expect(origemPadrao([{ id: "a" }, { id: "b" }])).toBeNull();
  });
  it("troca o nome do produto pela descrição automática", () => {
    expect(
      descricaoAoEscolherOrigem({ atual: "Instalação em campo", nomeDaOrigem: "Lona", nomeDoProduto: "Instalação em campo", automaticas: [] }),
    ).toBe("Instalação do lona");
  });
  it("trocar de item atualiza o texto que ainda é automático", () => {
    expect(
      descricaoAoEscolherOrigem({
        atual: "Instalação do adesivo", nomeDaOrigem: "Placa ACM", nomeDoProduto: "Instalação em campo",
        automaticas: ["Instalação do adesivo", "Instalação do placa ACM"],
      }),
    ).toBe("Instalação do placa ACM");
  });
  it("não sobrescreve a descrição editada pelo vendedor", () => {
    expect(
      descricaoAoEscolherOrigem({
        atual: "Instalação na fachada, 2 técnicos", nomeDaOrigem: "Placa ACM", nomeDoProduto: "Instalação em campo",
        automaticas: ["Instalação do adesivo"],
      }),
    ).toBe("Instalação na fachada, 2 técnicos");
  });
});
