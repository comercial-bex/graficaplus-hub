import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aplicarDadosDaReceita,
  clienteDasRespostas,
  pendenciaDoPassoDoCliente,
  RESPOSTAS_VAZIAS_DO_CLIENTE,
  type RespostasDoCliente,
} from "@/domain/clientes/novo-cliente-em-passos";

const base = (p: Partial<RespostasDoCliente>): RespostasDoCliente => ({
  ...RESPOSTAS_VAZIAS_DO_CLIENTE,
  ...p,
});

describe("passos do cliente", () => {
  it("não avança sem tipo e sem nome na revisão", () => {
    expect(pendenciaDoPassoDoCliente(1, RESPOSTAS_VAZIAS_DO_CLIENTE)).toBeTruthy();
    expect(pendenciaDoPassoDoCliente(6, RESPOSTAS_VAZIAS_DO_CLIENTE)).toBeTruthy();
    expect(pendenciaDoPassoDoCliente(6, base({ nome: " Gráfica Norte " }))).toBeNull();
  });

  it("documento, endereço e responsável são opcionais", () => {
    for (const p of [2, 4, 5] as const)
      expect(pendenciaDoPassoDoCliente(p, RESPOSTAS_VAZIAS_DO_CLIENTE)).toBeNull();
  });

  it("o WhatsApp é obrigatório e precisa ser celular com DDD e o 9", () => {
    expect(pendenciaDoPassoDoCliente(3, base({ telefone: "" }))).toMatch(/WhatsApp/);
    expect(pendenciaDoPassoDoCliente(3, base({ telefone: "(96) 3222-1234" }))).toMatch(
      /não recebe/,
    );
    expect(pendenciaDoPassoDoCliente(3, base({ telefone: "(96) 99123-4567" }))).toBeNull();
  });

  it("o mesmo WhatsApp de outro cliente bloqueia o passo e diz de quem é", () => {
    const p = pendenciaDoPassoDoCliente(3, base({ telefone: "(96) 99123-4567" }), " YRLEN ");
    expect(p).toContain("YRLEN");
    expect(p).toContain("já é de");
  });
});

describe("dados da Receita", () => {
  const dados = {
    razao_social: "YRLEN COMERCIO LTDA",
    nome_fantasia: "Yrlen",
    endereco: "Rua A, 10",
    bairro: "Centro",
    cidade: "Macapá",
    estado: "AP",
    cep: "68900000",
    telefones: "9632221234",
    email: "contato@yrlen.com.br",
  } as never;

  it("preenche o que está vazio", () => {
    const r = aplicarDadosDaReceita(base({ tipo: "pj" }), dados);
    expect(r).toMatchObject({
      razao_social: "YRLEN COMERCIO LTDA",
      nome: "Yrlen",
      cidade: "Macapá",
      estado: "AP",
    });
    expect(r.cep).toBe("68900-000");
  });

  it("não sobrescreve nome, telefone e e-mail já digitados", () => {
    const r = aplicarDadosDaReceita(
      base({ nome: "Meu nome", telefone: "(96) 99123-4567", email: "a@b.com" }),
      dados,
    );
    expect(r.nome).toBe("Meu nome");
    expect(r.telefone).toBe("(96) 99123-4567");
    expect(r.email).toBe("a@b.com");
  });
});

describe("a linha de clientes", () => {
  it("não manda vendedor quando não há, e pessoa física não leva razão social", () => {
    const pf = clienteDasRespostas(
      base({ tipo: "pf", nome: " Maria ", razao_social: "X", telefone: "(96) 99123-4567" }),
    );
    expect(pf).toMatchObject({ tipo: "pf", nome: "Maria", razao_social: "" });
    expect("vendedor_id" in pf).toBe(false);
    expect(clienteDasRespostas(base({ tipo: "pj", nome: "A", vendedor_id: "v1" }))).toMatchObject({
      vendedor_id: "v1",
    });
  });
});

describe("a tela", () => {
  const tela = readFileSync("src/components/cliente/novo-cliente-em-passos.tsx", "utf8");
  const pagina = readFileSync("src/routes/_authenticated/clientes.index.tsx", "utf8");

  it("'Novo cliente' abre o assistente e o cadastro completo continua num botão", () => {
    expect(pagina).toContain("<NovoClienteEmPassos");
    expect(pagina).toContain("setPassosAberto(true)");
    expect(pagina).toContain("Cadastro completo");
  });

  it("avisa o WhatsApp duplicado antes do clique e usa o consultor de CNPJ", () => {
    expect(tela).toContain("telefone_normalizado");
    expect(tela).toContain("<CampoDocumento");
    expect(tela).toContain("aplicarDadosDaReceita");
  });
});
