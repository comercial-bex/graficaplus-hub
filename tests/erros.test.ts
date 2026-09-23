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
  /**
   * 21/09/2026: um item de orçamento não entrava e a tela dizia "Preencha
   * todos os campos obrigatórios" com TODOS os campos da tela preenchidos.
   * O null vinha de `custo_previsto`, que nem aparece no formulário — e a
   * mensagem jogava fora justamente o nome da coluna, que era a única pista.
   */
  it("diz QUAL coluna veio nula, em vez de mandar preencher tudo", () => {
    expect(
      mensagemErro(
        new Error('null value in column "custo_previsto" of relation "orcamento_itens" violates not-null constraint'),
      ),
    ).toBe("Faltou preencher: o custo previsto do item.");
  });

  it("traduz coluna desconhecida em palavras, sem underline", () => {
    expect(mensagemErro(new Error('null value in column "prazo_interno" of relation "x"')))
      .toBe("Faltou preencher: prazo interno.");
  });

  it("sem nome de coluna, cai na mensagem geral", () => {
    expect(mensagemErro(new Error("violates not-null constraint")))
      .toBe("Preencha todos os campos obrigatórios.");
  });

  /**
   * A trava `maquinas_agenda_sem_sobreposicao` impede duas reservas vivas da
   * mesma máquina no mesmo horário. O Postgres devolve 23P01 e uma frase que
   * só cita o nome do índice — quem está agendando precisa ler o que fazer.
   */
  const CONFLITO = "Esta máquina já tem reserva nesse horário. Escolha outro horário ou outra máquina.";

  it("traduz conflito de agenda pelo código 23P01", () => {
    expect(
      mensagemErro({ code: "23P01", message: "conflicting key value violates exclusion constraint" }),
    ).toBe(CONFLITO);
  });

  it("traduz conflito de agenda pelo nome da trava, sem código", () => {
    expect(
      mensagemErro(
        new Error(
          'conflicting key value violates exclusion constraint "maquinas_agenda_sem_sobreposicao"',
        ),
      ),
    ).toBe(CONFLITO);
  });
});
