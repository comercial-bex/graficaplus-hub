import { describe, expect, it } from "vitest";
import {
  atrasoHumanizado,
  entraNoSorteio,
  escolherVariante,
  numeroDoIdentificador,
  PASSOS_CLIENTE,
  PASSOS_PARCEIRO,
  PASSOS_SEMENTE,
  preencher,
  validarTextoEditavel,
  VALORES_DE_EXEMPLO,
  variaveisDoTexto,
  verificarTexto,
} from "../../src/domain/whatsapp/triagem";

const regras = (t: string, ramo: "cliente" | "parceiro" = "cliente") =>
  verificarTexto(t, ramo).problemas.map((p) => p.regra);

describe("verificarTexto: ramo cliente final", () => {
  it.each([
    ["O valor é R$ 50", "moeda"],
    ["Fica r$50,00", "moeda"],
    ["custa 50 reais", "valor_em_reais"],
    ["sai por 1.200,00", "valor_com_centavos"],
    ["valor de 80 por metro", "valor_depois_de_valor"],
    ["10% de abate", "porcentagem"],
    ["damos desconto para você", "desconto"],
    ["aceitamos Pix", "pix"],
    ["boleto bancário", "boleto"],
    ["parcelamos em 3 vezes", "parcelamento"],
    ["sem juros", "juros"],
    ["emitimos nota fiscal", "nota_fiscal"],
    ["fica pronto em 3 dias", "prazo_em_numero"],
    ["entregamos em 24 horas", "prazo_em_numero"],
    ["Seja parceiro da Bex", "parceiro"],
    ["Temos parceria com gráficas", "parceiro"],
    ["Somos terceirizados", "terceirizado"],
    ["Fale com o revendedor", "revendedor"],
    ["Programa de revenda", "revendedor"],
    ["Veja a tabela", "tabela"],
    ["preço diferenciado", "preco_diferenciado"],
    ["condições especiais para você", "preco_diferenciado"],
    ["preço especial de atacado", "preco_diferenciado"],
    ["Oi — tudo bem?", "travessao"],
    ["Oi – tudo bem?", "travessao"],
    ["vá em frente →", "seta"],
    ["isso -> aquilo", "seta"],
    ["Oi (tudo bem)", "parenteses"],
    ["Olá, {{primeiro_nome}}", "variavel_sem_preencher"],
    ["", "vazio"],
    ["   ", "vazio"],
  ])("reprova %j (%s)", (texto, regra) => {
    expect(regras(texto)).toContain(regra);
  });

  it("reprova texto acima de 600 caracteres", () => {
    expect(regras("a".repeat(601))).toContain("acima_de_600_caracteres");
    expect(regras("a".repeat(600))).toEqual([]);
  });

  it.each([
    "O valor quem passa é a equipe, com tudo certinho para o seu pedido.",
    "Anotei o CEP 68900-000, Centro, Macapá.",
    "Atendemos das 8h às 18h, de segunda a sexta.",
    "Atendemos das 8h30 às 17h30, de segunda a sábado.",
    "Responda sim, ou me diga outro número se preferir.",
    "Escreva só os números, com DDD, por exemplo 96 99999-9999.",
    "Pelo número terminado em 2233.",
    "Ele tem 8 números, por exemplo 68900-000.",
  ])("aprova %j", (texto) => {
    expect(regras(texto)).toEqual([]);
  });

  it("o ramo parceiro pode falar parceiro, mas nunca dinheiro nem prazo", () => {
    expect(regras("O cadastro de parceiro é por aqui", "parceiro")).toEqual([]);
    expect(regras("A tabela de parceiro tem 10% de desconto", "parceiro")).toEqual(
      expect.arrayContaining(["porcentagem", "desconto"]),
    );
    expect(regras("Parceiro paga R$ 10", "parceiro")).toContain("moeda");
    expect(regras("Entrega em 3 dias", "parceiro")).toContain("prazo_em_numero");
    expect(regras("Oi (parceiro)", "parceiro")).toContain("parenteses");
  });

  it("pega a palavra com acento e caixa alta", () => {
    expect(regras("PARCEIRO")).toContain("parceiro");
    expect(regras("Revendedor")).toContain("revendedor");
    expect(regras("PREÇO DIFERENCIADO")).toContain("preco_diferenciado");
    expect(regras("DESCONTO")).toContain("desconto");
  });
});

describe("textos semente", () => {
  const exemplo = (t: string) => preencher(t, VALORES_DE_EXEMPLO).texto;
  const todosDoCliente = PASSOS_CLIENTE.flatMap((p) => [
    { codigo: p.codigo, onde: "texto", texto: p.texto },
    ...(p.variantes ?? []).map((t, i) => ({
      codigo: p.codigo,
      onde: `variante ${i + 1}`,
      texto: t,
    })),
    ...(p.repeticao ? [{ codigo: p.codigo, onde: "repeticao", texto: p.repeticao }] : []),
  ]);

  it("carrega TODAS as sementes de texto do ramo cliente final e nenhuma é reprovada pelo verificador", () => {
    expect(todosDoCliente.length).toBeGreaterThanOrEqual(30);
    const reprovadas = todosDoCliente
      .map((t) => ({
        ...t,
        problemas: verificarTexto(exemplo(t.texto), "cliente").problemas.map((p) => p.regra),
      }))
      .filter((t) => t.problemas.length > 0);
    expect(reprovadas).toEqual([]);
  });

  it("nenhum texto do ramo cliente usa a variável link_parceiro", () => {
    for (const t of todosDoCliente)
      expect(variaveisDoTexto(t.texto), `${t.codigo} ${t.onde}`).not.toContain("link_parceiro");
  });

  it("todos os textos do ramo parceiro passam no verificador de dinheiro, prazo e estilo", () => {
    for (const p of PASSOS_PARCEIRO) {
      for (const t of [p.texto, ...(p.variantes ?? []), ...(p.repeticao ? [p.repeticao] : [])]) {
        expect(verificarTexto(exemplo(t), "parceiro").problemas, `${p.codigo}: ${t}`).toEqual([]);
      }
    }
  });

  it("nenhuma semente tem travessão, seta ou parênteses, nem fala revendedor", () => {
    for (const p of PASSOS_SEMENTE) {
      for (const t of [p.texto, ...(p.variantes ?? []), p.repeticao ?? ""]) {
        expect(t, p.codigo).not.toMatch(/[—–()→]|->|revend/i);
      }
    }
  });

  it("os textos têm até 600 caracteres e só variáveis permitidas", () => {
    for (const p of PASSOS_SEMENTE) {
      expect(validarTextoEditavel(p.texto, p.ramo), p.codigo).toEqual([]);
      for (const v of p.variantes ?? [])
        expect(validarTextoEditavel(v, p.ramo), p.codigo).toEqual([]);
      if (p.repeticao) expect(validarTextoEditavel(p.repeticao, p.ramo), p.codigo).toEqual([]);
    }
  });

  it("o texto que mostra o telefone mostra só o final", () => {
    const tel = PASSOS_CLIENTE.find((p) => p.codigo === "telefone");
    expect(tel?.texto).toContain("{{telefone}}");
    expect(VALORES_DE_EXEMPLO.telefone).toBe("terminado em 2233");
  });

  it("cada código existe uma vez por ramo", () => {
    const chaves = PASSOS_SEMENTE.map((p) => `${p.ramo}:${p.codigo}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe("validarTextoEditavel: o que o dono não pode salvar", () => {
  it("recusa vazio, texto longo, variável fora da lista e termo proibido", () => {
    expect(validarTextoEditavel("", "cliente")[0].regra).toBe("vazio");
    expect(validarTextoEditavel("a".repeat(601), "cliente").map((p) => p.regra)).toContain(
      "acima_de_600_caracteres",
    );
    expect(
      validarTextoEditavel("Oi {{sobrenome_secreto}}", "cliente").map((p) => p.regra),
    ).toContain("variavel_nao_permitida");
    expect(validarTextoEditavel("Fale com o parceiro", "cliente").map((p) => p.regra)).toContain(
      "parceiro",
    );
    expect(validarTextoEditavel("Sai por R$ 10", "parceiro").map((p) => p.regra)).toContain(
      "moeda",
    );
  });
  it("o link de parceiro só vale no ramo parceiro", () => {
    expect(
      validarTextoEditavel("Cadastre-se: {{link_parceiro}}", "cliente").map((p) => p.regra),
    ).toContain("variavel_nao_permitida");
    expect(validarTextoEditavel("Cadastre-se: {{link_parceiro}}", "parceiro")).toEqual([]);
  });
  it("aceita um texto bom", () => {
    expect(validarTextoEditavel("Olá, {{primeiro_nome}}! Como posso ajudar?", "cliente")).toEqual(
      [],
    );
  });
});

describe("preencher", () => {
  it("preenche, colapsa espaços e aceita ack vazio", () => {
    expect(
      preencher("{{ack}} Para registrar, {{primeiro_nome}}.", { primeiro_nome: "Maria", ack: "" }),
    ).toEqual({ texto: "Para registrar, Maria.", faltando: [] });
  });
  it("aponta variável faltando", () => {
    expect(preencher("Oi, {{primeiro_nome}} {{cep}}", { primeiro_nome: "Maria" }).faltando).toEqual(
      ["cep"],
    );
    expect(preencher("Oi, {{primeiro_nome}}", { primeiro_nome: "" }).faltando).toEqual([
      "primeiro_nome",
    ]);
  });
});

describe("variante, sorteio e atraso: estáveis por conversa", () => {
  const ids = Array.from(
    { length: 60 },
    (_, i) => `00000000-0000-4000-8000-${String(i * 7919).padStart(12, "0")}`,
  );

  it("o mesmo contato sempre recebe a mesma variante", () => {
    const nome = PASSOS_CLIENTE.find((p) => p.codigo === "nome")!;
    for (const id of ids) expect(escolherVariante(nome, id)).toBe(escolherVariante(nome, id));
  });

  it("distribui as três escritas do passo do nome", () => {
    const nome = PASSOS_CLIENTE.find((p) => p.codigo === "nome")!;
    const usadas = new Set(ids.map((id) => escolherVariante(nome, id)));
    expect(usadas.size).toBe(3);
  });

  it("sem variantes devolve o texto principal", () => {
    expect(escolherVariante({ texto: "x" }, "abc")).toBe("x");
    expect(escolherVariante({ texto: "x", variantes: ["", "  "] }, "abc")).toBe("x");
  });

  it("número do identificador usa os 8 últimos dígitos hexadecimais do uuid", () => {
    expect(numeroDoIdentificador("11111111-2222-4333-8444-5555deadbeef")).toBe(0xdeadbeef);
    expect(numeroDoIdentificador("não é uuid")).toBeGreaterThanOrEqual(0);
  });

  it("sorteio estável: 0% ninguém, 100% todos, 10% perto de 10%", () => {
    expect(ids.every((id) => !entraNoSorteio(id, 0))).toBe(true);
    expect(ids.every((id) => entraNoSorteio(id, 100))).toBe(true);
    const grandes = Array.from(
      { length: 2000 },
      (_, i) =>
        `00000000-0000-4000-8000-${((i * 2654435761) % 0xffffffffffff).toString(16).padStart(12, "0")}`,
    );
    const dentro = grandes.filter((id) => entraNoSorteio(id, 10)).length;
    expect(dentro).toBeGreaterThan(100);
    expect(dentro).toBeLessThan(320);
    expect(entraNoSorteio(grandes[5], 10)).toBe(entraNoSorteio(grandes[5], 10));
  });

  it("atraso fica entre 3 e 8 s, fixo por conversa e passo, e nunca passa de 15", () => {
    for (const id of ids) {
      const a = atrasoHumanizado(id, "cep", 3, 8);
      expect(a).toBeGreaterThanOrEqual(3);
      expect(a).toBeLessThanOrEqual(8);
      expect(atrasoHumanizado(id, "cep", 3, 8)).toBe(a);
    }
    expect(atrasoHumanizado(ids[1], "cep", 1, 99)).toBeLessThanOrEqual(15);
    expect(atrasoHumanizado(ids[1], "cep", 0, 0)).toBe(1);
  });
});
