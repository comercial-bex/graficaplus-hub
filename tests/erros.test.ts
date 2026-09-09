import { describe, expect, it } from "vitest";
import { mensagemErro } from "@/lib/erros";

describe("mensagemErro", () => {
  it("traduz violação de RLS", () => {
    expect(mensagemErro({ message: "new row violates row-level security policy" })).toBe(
      "Você não tem permissão para realizar esta ação.",
    );
  });

  it("traduz credenciais inválidas", () => {
    expect(mensagemErro(new Error("Invalid login credentials"))).toBe("E-mail ou senha inválidos.");
  });

  it("traduz senha curta mantendo o número", () => {
    expect(mensagemErro("Password should be at least 8 characters")).toBe(
      "A senha deve ter pelo menos 8 caracteres.",
    );
  });

  it("traduz duplicidade", () => {
    expect(mensagemErro({ message: 'duplicate key value violates unique constraint "x"' })).toBe(
      "Já existe um registro com esses dados.",
    );
  });

  it("traduz arquivo grande demais", () => {
    expect(mensagemErro({ message: "The object exceeded the maximum allowed size" })).toBe(
      "Arquivo maior que o tamanho máximo permitido.",
    );
  });

  it("traduz falha de rede", () => {
    expect(mensagemErro(new Error("Failed to fetch"))).toBe(
      "Falha de conexão. Verifique sua internet e tente novamente.",
    );
  });

  it("mantém mensagens já em português", () => {
    expect(mensagemErro(new Error("Não foi possível gerar a OS"))).toBe("Não foi possível gerar a OS");
  });

  it("usa mensagem padrão para erros desconhecidos em inglês", () => {
    expect(mensagemErro(new Error("something weird happened"), "Falhou aqui")).toBe("Falhou aqui");
  });
});
