import { test, expect } from "vitest";
import { normalizarRespostaCNPJ } from "../src/lib/api/cnpj.server";

// Resposta real da BrasilAPI v2 (campos que aproveitamos).
const respostaCompleta = {
  cnpj: "19131243000197",
  razao_social: "OPEN KNOWLEDGE BRASIL",
  nome_fantasia: "REDE PELO CONHECIMENTO LIVRE",
  descricao_situacao_cadastral: "ATIVA",
  logradouro: "AVENIDA PAULISTA",
  numero: "37",
  complemento: "ANDAR 4",
  bairro: "BELA VISTA",
  municipio: "SAO PAULO",
  uf: "SP",
  cep: "01311-902",
  ddd_telefone_1: "1123456789",
  ddd_telefone_2: "1198765432",
  email: "Contato@OKBR.ORG",
};

test("resposta completa é convertida para os campos do formulário", () => {
  const d = normalizarRespostaCNPJ("19131243000197", respostaCompleta);
  expect(d.cnpj).toBe("19131243000197");
  expect(d.razao_social).toBe("OPEN KNOWLEDGE BRASIL");
  expect(d.nome_fantasia).toBe("REDE PELO CONHECIMENTO LIVRE");
  expect(d.situacao).toBe("ATIVA");
  expect(d.bairro).toBe("BELA VISTA");
  expect(d.cidade).toBe("SAO PAULO");
  expect(d.estado).toBe("SP");
});

test("endereço junta logradouro, número e complemento", () => {
  expect(normalizarRespostaCNPJ("x", respostaCompleta).endereco).toBe(
    "AVENIDA PAULISTA, 37, ANDAR 4",
  );
});

test("endereço omite partes ausentes sem deixar vírgula solta", () => {
  expect(
    normalizarRespostaCNPJ("x", { logradouro: "RUA A", numero: "10" }).endereco,
  ).toBe("RUA A, 10");
  expect(normalizarRespostaCNPJ("x", { logradouro: "RUA A" }).endereco).toBe("RUA A");
  expect(normalizarRespostaCNPJ("x", {}).endereco).toBeNull();
});

test("CEP fica só com dígitos, para o formulário aplicar a máscara", () => {
  expect(normalizarRespostaCNPJ("x", { cep: "01311-902" }).cep).toBe("01311902");
  expect(normalizarRespostaCNPJ("x", {}).cep).toBeNull();
});

test("telefones são unidos e o segundo é opcional", () => {
  expect(normalizarRespostaCNPJ("x", respostaCompleta).telefones).toBe(
    "1123456789  |  1198765432",
  );
  expect(normalizarRespostaCNPJ("x", { ddd_telefone_1: "1123456789" }).telefones).toBe(
    "1123456789",
  );
  expect(normalizarRespostaCNPJ("x", {}).telefones).toBeNull();
});

test("e-mail vem em minúsculas", () => {
  expect(normalizarRespostaCNPJ("x", respostaCompleta).email).toBe("contato@okbr.org");
});

test("campos vazios ou só com espaço viram null, não string vazia", () => {
  const d = normalizarRespostaCNPJ("19131243000197", {
    razao_social: "   ",
    nome_fantasia: "",
    municipio: "  ",
  });
  expect(d.razao_social).toBeNull();
  expect(d.nome_fantasia).toBeNull();
  expect(d.cidade).toBeNull();
});

test("sem cnpj na resposta, usa o que foi consultado", () => {
  expect(normalizarRespostaCNPJ("37914628000102", {}).cnpj).toBe("37914628000102");
});

test("cnpj da resposta é limpo de pontuação", () => {
  expect(
    normalizarRespostaCNPJ("x", { cnpj: "37.914.628/0001-02" }).cnpj,
  ).toBe("37914628000102");
});

// Resposta real da BrasilAPI para o CNPJ da gráfica que emite o orçamento 1059.
// Serve de contrato: se o formato da API mudar, este teste é o que acusa.
test("resposta real reproduz o cabeçalho do orçamento 1059", () => {
  const d = normalizarRespostaCNPJ("37914628000102", {
    cnpj: "37914628000102",
    razao_social: "GRAFICA DIGITAL PRINT LTDA",
    nome_fantasia: "GRAFICA DIGITAL PRINT",
    descricao_situacao_cadastral: "ATIVA",
    logradouro: "S37 LOTE 04 QUADRA C DEPOSITO 2",
    numero: "SN",
    complemento: "INDUSTRIAL",
    bairro: "MONTE DOURADO",
    municipio: "ALMEIRIM",
    uf: "PA",
    cep: "68240000",
    ddd_telefone_1: "9691095058",
    ddd_telefone_2: "",
    email: null as unknown as string,
  });

  expect(d.razao_social).toBe("GRAFICA DIGITAL PRINT LTDA");
  expect(d.endereco).toBe("S37 LOTE 04 QUADRA C DEPOSITO 2, SN, INDUSTRIAL");
  expect(d.bairro).toBe("MONTE DOURADO");
  expect(d.cidade).toBe("ALMEIRIM");
  expect(d.estado).toBe("PA");
  expect(d.cep).toBe("68240000");
  expect(d.telefones).toBe("9691095058");
  expect(d.situacao).toBe("ATIVA");
  // A Receita não tem e-mail desta empresa, embora o documento traga um.
  expect(d.email).toBeNull();
});
