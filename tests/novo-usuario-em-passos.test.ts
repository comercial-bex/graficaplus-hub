import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cargoSugerido,
  gerarSenhaInicial,
  pendenciaDoPassoDoUsuario,
  PERFIS_DO_CADASTRO,
  RESPOSTAS_VAZIAS_DO_USUARIO,
  usuarioDasRespostas,
  type RespostasDoUsuario,
} from "@/domain/usuarios/novo-usuario-em-passos";

const base = (p: Partial<RespostasDoUsuario>): RespostasDoUsuario => ({
  ...RESPOSTAS_VAZIAS_DO_USUARIO,
  ...p,
});

describe("perfis", () => {
  it("só oferece perfis que existem no sistema, e não oferece o de cliente", () => {
    const existentes = [
      "admin",
      "gestor",
      "financeiro",
      "vendedor",
      "designer",
      "operador",
      "estoque",
      "instalador",
    ];
    expect(PERFIS_DO_CADASTRO.map((p) => p.chave).sort()).toEqual([...existentes].sort());
  });

  it("o cargo sugerido vem do perfil", () => {
    expect(cargoSugerido("operador")).toBe("Impressão e acabamento");
    expect(cargoSugerido("")).toBe("");
  });
});

describe("senha inicial", () => {
  it("tem 10 caracteres mais o sufixo e nunca os que se confundem", () => {
    const s = gerarSenhaInicial(Array.from({ length: 10 }, (_, i) => i * 7));
    expect(s).toHaveLength(12);
    expect(s.endsWith("@7")).toBe(true);
    expect(s.slice(0, 10)).not.toMatch(/[0O1lI]/);
  });

  it("a mesma entrada dá a mesma saída (a aleatoriedade vem de fora)", () => {
    const a = Array.from({ length: 10 }, (_, i) => i + 3);
    expect(gerarSenhaInicial(a)).toBe(gerarSenhaInicial(a));
  });
});

describe("passos", () => {
  it("o perfil é opcional", () => {
    expect(pendenciaDoPassoDoUsuario(1, RESPOSTAS_VAZIAS_DO_USUARIO)).toBeNull();
  });

  it("exige nome e um e-mail de verdade", () => {
    expect(pendenciaDoPassoDoUsuario(2, base({ nome: "A", email: "a@b.com" }))).toMatch(/nome/);
    expect(pendenciaDoPassoDoUsuario(2, base({ nome: "Ana", email: "ana" }))).toMatch(/e-mail/);
    expect(pendenciaDoPassoDoUsuario(2, base({ nome: "Ana", email: "ana@bex.com.br" }))).toBeNull();
  });

  it("a senha inicial precisa de 8 caracteres", () => {
    expect(pendenciaDoPassoDoUsuario(3, base({ senha: "1234567" }))).toBeTruthy();
    expect(pendenciaDoPassoDoUsuario(3, base({ senha: "12345678" }))).toBeNull();
  });
});

describe("o pedido ao servidor", () => {
  it("leva o perfil só quando escolhido e o cargo sugerido quando vazio", () => {
    const com = usuarioDasRespostas(
      base({ perfil: "gestor", nome: " Ana ", email: " ana@bex.com.br ", senha: "abcdefgh" }),
    );
    expect(com).toMatchObject({
      nome: "Ana",
      email: "ana@bex.com.br",
      role: "gestor",
      cargo: "Gerência",
      telefone: null,
      ativo: true,
    });
    const sem = usuarioDasRespostas(
      base({ nome: "Bia", email: "bia@bex.com.br", senha: "abcdefgh" }),
    );
    expect("role" in sem).toBe(false);
    expect(sem.cargo).toBeNull();
  });
});

describe("a tela", () => {
  const tela = readFileSync("src/components/usuarios/novo-usuario-em-passos.tsx", "utf8");
  const pagina = readFileSync("src/routes/_authenticated/usuarios.tsx", "utf8");
  it("'Novo usuário' abre o assistente e o cadastro completo continua", () => {
    expect(pagina).toContain("<NovoUsuarioEmPassos");
    expect(pagina).toContain("setPassosAberto(true)");
    expect(pagina).toContain("Cadastro completo");
  });
  it("cria pela função do servidor (que confere o administrador) e usa crypto para a senha", () => {
    expect(tela).toContain("criarUsuario");
    expect(tela).toContain("crypto.getRandomValues");
  });
});
