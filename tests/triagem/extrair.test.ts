import { describe, expect, it } from "vitest";
import {
  extrairCep,
  extrairNome,
  extrairSobrenome,
  extrairTelefone,
  finalDoTelefone,
  pareceEndereco,
  telefoneDoChatUtilizavel,
} from "../../src/domain/whatsapp/triagem";

const nome = (t: string) => {
  const r = extrairNome(t);
  return r.ok ? r.nome : `X:${r.motivo}`;
};

describe("extrairNome: com e sem prefixo", () => {
  it.each([
    ["Maria Souza", "Maria Souza"],
    ["maria souza", "Maria Souza"],
    ["MARIA SOUZA", "Maria Souza"],
    ["Maria", "Maria"],
    ["joão", "João"],
    ["meu nome é Maria Souza", "Maria Souza"],
    ["Meu nome é maria", "Maria"],
    ["me chamo Carlos Lima", "Carlos Lima"],
    ["pode me chamar de Ana", "Ana"],
    ["sou o Pedro Alves", "Pedro Alves"],
    ["sou a Fernanda", "Fernanda"],
    ["aqui é o Carlos", "Carlos"],
    ["aqui é a Joana Pires", "Joana Pires"],
    ["Oi, meu nome é Rosa Dias", "Rosa Dias"],
    ["Bom dia! Me chamo Paulo Neves.", "Paulo Neves"],
    ["seu João", "João"],
    ["Seu João Batista", "João Batista"],
    ["dona Maria", "Maria"],
    ["Dona Maria das Graças", "Maria das Graças"],
    ["Dr. Carlos Lima", "Carlos Lima"],
    ["Dra Helena Costa", "Helena Costa"],
    ["sr. Antônio", "Antônio"],
    ["professora Lúcia Prado", "Lúcia Prado"],
    ["José da Silva", "José da Silva"],
    ["maria de fátima souza", "Maria de Fátima Souza"],
    ["João dos Santos", "João dos Santos"],
    ["Ana-Clara Souza", "Ana-Clara Souza"],
    ["Jean D'Ávila", "Jean D'Ávila"],
    ["  Luiz   Gomes  ", "Luiz Gomes"],
    ["Maria Souza.", "Maria Souza"],
    ["Maria Souza!!", "Maria Souza"],
    ["Ana Paula de Oliveira Santos", "Ana Paula de Oliveira Santos"],
  ])("%j vira %j", (entrada, esperado) => {
    expect(nome(entrada)).toBe(esperado);
  });

  it("guarda o tratamento e marca nome completo", () => {
    const r = extrairNome("Dr. Carlos Lima");
    expect(r).toMatchObject({
      ok: true,
      primeiroNome: "Carlos",
      completo: true,
      tratamento: "Dr.",
    });
    expect(extrairNome("seu João")).toMatchObject({ ok: true, completo: false, tratamento: "seu" });
    expect(extrairNome("dona Maria")).toMatchObject({
      ok: true,
      primeiroNome: "Maria",
      completo: false,
    });
  });

  it.each([
    "sim",
    "ok",
    "Ok!",
    "obrigado",
    "valeu",
    "oi",
    "bom dia",
    "quero um orçamento de banner",
    "quero banner",
    "preciso urgente",
    "Preciso de 100 cartões",
    "Bloqueio de Linha",
    "Atendimento Banco",
    "pode ser o tamanho 2x1",
    "quanto custa?",
    "Maria 123",
    "João99",
    "https://exemplo.com",
    "joao@exemplo.com",
    "www.site.com.br",
    "Maria 😊",
    "👍",
    "",
    "   ",
    "Dr.",
    "seu",
    "Parceiro Silva",
    "Parceria Gráfica",
    "Revendedor",
    "Tabela Preço",
    "Desconto Jose",
    "Maria Tabela",
    "um nome muito longo com cinco palavras",
    "Maria Souza Lima Santos Costa",
    "Bruna Porra",
    "Fulano Merda",
    "Caralho",
    "pular",
    "não quero",
    "já sou cliente",
    "primeira vez",
    "Terceirizado",
    "A",
    "J S",
    "Lona",
    "Quero",
    "Maria de",
    "da Silva",
    "Sou cliente",
    "Atendente",
    "robô",
    "Cupom",
  ])("recusa %j como nome", (entrada) => {
    expect(nome(entrada)).toMatch(/^X:/);
  });

  it("recusa primeiro nome acima de 15 letras (só se repete até 15)", () => {
    expect(nome("Maximiliano Fernandes")).toBe("Maximiliano Fernandes");
    expect(nome("Pneumoultramicroscopico Silva")).toMatch(/^X:/);
  });

  it("nome com palavra de parceiro não sobe de ramo: é recusado como nome", () => {
    expect(extrairNome("Parceiro Silva")).toEqual({ ok: false, motivo: "palavra_barrada" });
  });
});

describe("extrairSobrenome", () => {
  it("junta ao primeiro nome", () => {
    const r = extrairSobrenome("Souza", "Maria");
    expect(r).toMatchObject({ ok: true, nome: "Maria Souza", completo: true });
  });
  it("aceita o nome completo repetido, sem duplicar", () => {
    expect(extrairSobrenome("Maria Souza", "Maria")).toMatchObject({
      ok: true,
      nome: "Maria Souza",
    });
  });
  it("aceita sobrenome composto", () => {
    expect(extrairSobrenome("da Silva Lima", "Maria")).toMatchObject({ ok: false });
    expect(extrairSobrenome("Silva Lima", "Maria")).toMatchObject({
      ok: true,
      nome: "Maria Silva Lima",
    });
  });
  it("recusa resposta que não é sobrenome", () => {
    expect(extrairSobrenome("sim", "Maria")).toMatchObject({ ok: false });
    expect(extrairSobrenome("quero um banner", "Maria")).toMatchObject({ ok: false });
    expect(extrairSobrenome("123", "Maria")).toMatchObject({ ok: false });
  });
});

describe("extrairCep: com e sem hífen e dentro de frase", () => {
  it.each([
    ["68900-000", "68900000"],
    ["68900000", "68900000"],
    ["68.900-000", "68900000"],
    ["68900 000", "68900000"],
    ["meu cep é 68900-000", "68900000"],
    ["CEP: 68908-210, obrigado", "68908210"],
    ["moro na rua x, cep 68900000 perto do centro", "68900000"],
    ["Cep 01310-100.", "01310100"],
    ["é 68900-000!", "68900000"],
  ])("%j", (entrada, cep) => {
    expect(extrairCep(entrada)).toEqual({
      ok: true,
      cep,
      formatado: `${cep.slice(0, 5)}-${cep.slice(5)}`,
    });
  });

  it.each([
    "",
    "sem cep",
    "68900-00",
    "6890-000",
    "123456789",
    "00000-000",
    "11111111",
    "(96) 99111-2233",
    "96 99111 2233",
    "5596991112233",
    "96991112233",
    "2 banners 100x100",
  ])("não acha CEP em %j", (entrada) => {
    expect(extrairCep(entrada).ok).toBe(false);
  });
});

describe("pareceEndereco", () => {
  it("reconhece endereço escrito", () => {
    expect(pareceEndereco("Rua Cândido Mendes, 23, Perpétuo Socorro")).toBe(true);
    expect(pareceEndereco("Av. FAB número 100")).toBe(true);
    expect(pareceEndereco("moro no bairro Trem")).toBe(true);
  });
  it("não confunde com conversa", () => {
    expect(pareceEndereco("não sei")).toBe(false);
    expect(pareceEndereco("quero um banner grande")).toBe(false);
    expect(pareceEndereco("")).toBe(false);
  });
});

describe("extrairTelefone: celular brasileiro", () => {
  it.each([
    ["96 99111-2233", "96991112233"],
    ["(96) 99111-2233", "96991112233"],
    ["96991112233", "96991112233"],
    ["+55 96 99111-2233", "96991112233"],
    ["5596991112233", "96991112233"],
    ["55 (96) 99111-2233", "96991112233"],
    ["9691112233", "96991112233"],
    ["(96) 9111-2233", "96991112233"],
    ["+55 96 9111-2233", "96991112233"],
    ["096 99111-2233", "96991112233"],
    ["meu número é 96 99111-2233 pode registrar", "96991112233"],
    ["o outro é (11) 98765-4321 obrigado", "11987654321"],
    ["96.99111.2233", "96991112233"],
    ["wa.me/5596991112233", "96991112233"],
  ])("%j", (entrada, chave) => {
    const r = extrairTelefone(entrada);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chave).toBe(chave);
      expect(r.final).toBe(chave.slice(-4));
    }
  });

  it("devolve o número legível", () => {
    const r = extrairTelefone("5596991112233");
    expect(r.ok && r.legivel).toBe("(96) 99111-2233");
  });

  it.each([
    ["", "sem_numero"],
    ["não sei", "sem_numero"],
    ["12345", "curto"],
    ["99111-2233", "sem_ddd"],
    ["991112233", "sem_ddd"],
    ["(96) 3222-1234", "nao_e_celular"],
    ["96 99111-2233 / 96 98140-8722", "varios"],
    ["96991112233 e 96981408722", "varios"],
    ["123456789012345", "longo"],
  ])("recusa %j (%s)", (entrada, motivo) => {
    expect(extrairTelefone(entrada)).toEqual({ ok: false, motivo });
  });

  it("presume o DDD só se o dono mandar", () => {
    expect(extrairTelefone("99111-2233", { dddPadrao: "96" })).toMatchObject({
      ok: true,
      chave: "96991112233",
    });
    expect(extrairTelefone("99111-2233", { dddPadrao: null }).ok).toBe(false);
  });
});

describe("número do chat", () => {
  it("serve quando é celular brasileiro e não é lid", () => {
    expect(telefoneDoChatUtilizavel({ normalizado: "96991112233", ehLid: false })).toBe(true);
    expect(telefoneDoChatUtilizavel({ normalizado: "5596991112233", ehLid: false })).toBe(true);
  });
  it("decide pelo sufixo lid, não pelo tamanho", () => {
    expect(telefoneDoChatUtilizavel({ normalizado: "96991112233", ehLid: true })).toBe(false);
    expect(telefoneDoChatUtilizavel({ normalizado: "123456789012345", ehLid: false })).toBe(false);
    expect(telefoneDoChatUtilizavel({ normalizado: null, ehLid: false })).toBe(false);
  });
  it("mostra só o final", () => {
    expect(finalDoTelefone("96991112233")).toBe("2233");
    expect(finalDoTelefone(null)).toBe("");
  });
});
