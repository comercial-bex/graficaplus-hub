import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RESPOSTAS_VAZIAS_DO_CLIENTE,
  clienteDasRespostas,
} from "../src/domain/clientes/novo-cliente-em-passos";

/**
 * Origem do cliente no cadastro guiado "Novo cliente" (01/11/2026). É o caminho que a equipe
 * mais usa, e a origem estava vazia em 24 dos 31 clientes: sem ela não há como saber de qual
 * canal vem o dinheiro (o Holdprint filtra as contas por origem).
 */

const PJ = { ...RESPOSTAS_VAZIAS_DO_CLIENTE, tipo: "pj" as const, nome: "Gráfica Exemplo", telefone: "(96) 99999-0000" };

describe("o que o cadastro guiado grava", () => {
  it("a origem dita vai junto, sem espaço sobrando", () => {
    expect(clienteDasRespostas({ ...PJ, origem: "  Instagram " })).toMatchObject({ origem: "Instagram" });
  });

  it("origem em branco não vai: fica 'não informada' no banco, não texto vazio", () => {
    expect("origem" in clienteDasRespostas(PJ)).toBe(false);
    expect("origem" in clienteDasRespostas({ ...PJ, origem: "   " })).toBe(false);
  });

  it("o responsável continua indo junto com a origem", () => {
    const linha = clienteDasRespostas({ ...PJ, origem: "Balcão", vendedor_id: "v1" });
    expect(linha).toMatchObject({ origem: "Balcão", vendedor_id: "v1" });
  });

  it("as respostas começam sem origem", () => {
    expect(RESPOSTAS_VAZIAS_DO_CLIENTE.origem).toBe("");
  });
});

describe("o cadastro guiado pergunta a origem na revisão", () => {
  const TELA = readFileSync("src/components/cliente/novo-cliente-em-passos.tsx", "utf8");

  it("usa o mesmo campo de origem do cadastro completo e a mostra no resumo", () => {
    expect(TELA).toContain("<CampoDeOrigem");
    expect(TELA).toContain('valor={r.origem}');
    expect(TELA).toContain('rotulo="Origem" valor={r.origem.trim() || "não informada"}');
  });
});
