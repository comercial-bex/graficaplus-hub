import { describe, expect, it } from "vitest";
import {
  avisoDoTelefone,
  caminhoDaFoto,
  conferirDados,
  conferirFoto,
  conferirSenha,
  iniciais,
  pedeReautenticacao,
  telefoneParaGravar,
  telefoneParaMostrar,
  TAMANHO_MAXIMO_DA_FOTO,
} from "../src/components/configuracoes/perfil";

/**
 * "Meu perfil" era uma tela de 34 linhas que mostrava e-mail e papéis, sem
 * nenhuma ação, e só abria para admin. Estes testes travam o que ela confere
 * antes de gravar o nome, o telefone, a foto e a senha da própria pessoa.
 */

const UID = "152120d6-08b8-4e91-9fed-5712ac40d469";

describe("nome e telefone", () => {
  it("nome é obrigatório: é ele que sai no orçamento", () => {
    expect(conferirDados({ nome: "  ", telefone: "" })).toEqual([
      "Informe seu nome: é ele que sai no orçamento enviado ao cliente.",
    ]);
    expect(conferirDados({ nome: "Ana", telefone: "" })).toEqual([]);
  });

  it("telefone é opcional, mas quando vem precisa de DDD", () => {
    expect(conferirDados({ nome: "Ana", telefone: "99111-2233" })).toEqual([
      "Confira o telefone: DDD e número, com 10 ou 11 dígitos.",
    ]);
    expect(conferirDados({ nome: "Ana", telefone: "(96) 99111-2233" })).toEqual([]);
  });

  it("dois números colados na mesma caixa não passam", () => {
    expect(conferirDados({ nome: "Ana", telefone: "96 99131-8834 / 96 98140-8722" })).toHaveLength(1);
  });

  it("grava só dígitos, na régua canônica — como os telefones que já estão em usuarios", () => {
    expect(telefoneParaGravar("(96) 99111-2233")).toBe("96991112233");
    expect(telefoneParaGravar("+55 96 99111-2233")).toBe("96991112233");
    // celular antigo de 10 dígitos ganha o nono dígito
    expect(telefoneParaGravar("96 9111-2233")).toBe("96991112233");
    expect(telefoneParaGravar("   ")).toBeNull();
  });

  it("mostra formatado", () => {
    expect(telefoneParaMostrar("96991112233")).toBe("(96) 99111-2233");
    expect(telefoneParaMostrar(null)).toBe("");
  });

  it("fixo é aceito, com o aviso de que não recebe WhatsApp", () => {
    expect(conferirDados({ nome: "Ana", telefone: "(96) 3222-1234" })).toEqual([]);
    expect(avisoDoTelefone("(96) 3222-1234")).toBe("Número fixo: não recebe WhatsApp.");
    expect(avisoDoTelefone("(96) 99111-2233")).toBeNull();
  });
});

describe("senha", () => {
  it("pede a atual, 8 caracteres e confirmação igual", () => {
    expect(conferirSenha({ atual: "", nova: "12345678", confirmacao: "12345678" })).toEqual(["Digite sua senha atual."]);
    expect(conferirSenha({ atual: "velha-senha", nova: "curta", confirmacao: "curta" })).toEqual([
      "A nova senha precisa de pelo menos 8 caracteres.",
    ]);
    expect(conferirSenha({ atual: "velha-senha", nova: "nova-senha-1", confirmacao: "nova-senha-2" })).toEqual([
      "A confirmação não é igual à nova senha.",
    ]);
  });

  it("a nova não pode ser a mesma", () => {
    expect(conferirSenha({ atual: "mesma-senha", nova: "mesma-senha", confirmacao: "mesma-senha" })).toEqual([
      "A nova senha precisa ser diferente da atual.",
    ]);
  });

  it("tudo certo, nenhum problema", () => {
    expect(conferirSenha({ atual: "velha-senha", nova: "nova-senha-1", confirmacao: "nova-senha-1" })).toEqual([]);
  });

  it("reconhece o pedido de reautenticação do Auth", () => {
    expect(pedeReautenticacao(new Error("Password update requires reauthentication"))).toBe(true);
    expect(pedeReautenticacao({ message: "reauthentication_needed" })).toBe(true);
    expect(pedeReautenticacao(new Error("weak password"))).toBe(false);
  });
});

describe("foto", () => {
  it("só imagem, até 2 MB — o mesmo limite da logo de cliente", () => {
    expect(conferirFoto({ type: "application/pdf", size: 10 })).toBe("Envie uma imagem (PNG, JPG ou WEBP).");
    expect(conferirFoto({ type: "image/png", size: TAMANHO_MAXIMO_DA_FOTO + 1 })).toBe("A foto pode ter até 2 MB.");
    expect(conferirFoto({ type: "image/jpeg", size: 300_000 })).toBeNull();
  });

  it("o caminho começa pelo id de quem está logado — a policy do bucket exige", () => {
    expect(caminhoDaFoto(UID, "Minha Foto.JPG", "abc")).toBe(`${UID}/perfil/abc.jpg`);
    expect(caminhoDaFoto(UID, "sem-extensao", "abc")).toBe(`${UID}/perfil/abc.png`);
    expect(caminhoDaFoto(UID, "estranho.p n g", "abc")).toBe(`${UID}/perfil/abc.png`);
  });
});

describe("iniciais", () => {
  it("do nome; sem nome, do e-mail", () => {
    expect(iniciais("Harison Rodrigues", null)).toBe("HR");
    expect(iniciais("Harison", null)).toBe("HA");
    expect(iniciais("", "suporte@agencia.com")).toBe("SU");
    expect(iniciais(null, null)).toBe("?");
  });
});
