import { describe, expect, it } from "vitest";
import { destinoDaAutomacao, textoDaAutomacao } from "../src/domain/automacoes/destino";
import { TELEFONE_DO_CLIENTE } from "../src/domain/automacoes/catalogo";

/**
 * Para quem a automação manda — e para quem ela NUNCA manda.
 *
 * `pagamento_atrasado`, `estoque_minimo` e `margem_abaixo_minimo` têm
 * `aceitaCliente: false` no catálogo: cobrança automática é decisão do
 * financeiro, e margem é dinheiro. A tela já não oferece "cliente" nesses
 * gatilhos, mas o payload é JSON livre — a recusa fica no envio.
 */

const cliente = {
  nome: "Maria Silva",
  telefone: "(96) 98121-6527",
  whatsapp_principal: null,
  telefone_normalizado: "96981216527",
};

const contextoOs = { os: { numero: 49, titulo: "Faixa" }, cliente };

describe("o destino", () => {
  it("OS mudou de etapa, para o cliente: aceito, com o 55 que o modelo da tela põe", () => {
    const d = destinoDaAutomacao({
      gatilho: "status_os_alterado",
      contexto: contextoOs,
      payload: {},
      automacao: { payload: { telefone: TELEFONE_DO_CLIENTE, mensagem: "oi" } },
      telefonePadrao: null,
    });
    expect(d).toEqual({ ok: true, telefone: "5596981216527" });
  });

  it("pagamento atrasado apontado para o cliente: RECUSADO, com o motivo", () => {
    const d = destinoDaAutomacao({
      gatilho: "pagamento_atrasado",
      contexto: { ...contextoOs, pagamento: { valor: 150 } },
      payload: {},
      automacao: { payload: { telefone: TELEFONE_DO_CLIENTE, mensagem: "pague" } },
      telefonePadrao: null,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.erro).toMatch(/não manda mensagem ao cliente/);
  });

  it("pagamento atrasado com o número do cliente digitado à mão: também recusado", () => {
    for (const digitado of ["96981216527", "5596981216527", "(96) 98121-6527"]) {
      const d = destinoDaAutomacao({
        gatilho: "pagamento_atrasado",
        contexto: contextoOs,
        payload: { telefone: digitado },
        automacao: { payload: { mensagem: "pague" } },
        telefonePadrao: null,
      });
      expect(d.ok, digitado).toBe(false);
    }
  });

  it("pagamento atrasado para o número da equipe: aceito", () => {
    const d = destinoDaAutomacao({
      gatilho: "pagamento_atrasado",
      contexto: contextoOs,
      payload: { telefone: "96991110000" },
      automacao: { payload: { mensagem: "parcela vencida" } },
      telefonePadrao: null,
    });
    expect(d).toEqual({ ok: true, telefone: "96991110000" });
  });

  it("estoque mínimo sem número: cai no telefone padrão do servidor; sem ele, recusa com motivo", () => {
    const base = {
      gatilho: "estoque_minimo",
      contexto: { material: { nome: "Lona" } },
      payload: {},
      automacao: { payload: { mensagem: "repor" } },
    };
    expect(destinoDaAutomacao({ ...base, telefonePadrao: "96999990000" })).toEqual({
      ok: true,
      telefone: "96999990000",
    });
    const sem = destinoDaAutomacao({ ...base, telefonePadrao: null });
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(sem.erro).toContain("AUTOMATION_DEFAULT_PHONE");
  });

  it("a ordem antiga continua: payload.telefone > contexto.telefone > cliente.telefone > padrão", () => {
    const d = destinoDaAutomacao({
      gatilho: "os_concluida",
      contexto: { ...contextoOs, telefone: "96988887777" },
      payload: {},
      automacao: { payload: { mensagem: "pronto" } },
      telefonePadrao: "96900000000",
    });
    expect(d).toEqual({ ok: true, telefone: "96988887777" });
    const doCliente = destinoDaAutomacao({
      gatilho: "os_concluida",
      contexto: contextoOs,
      payload: {},
      automacao: { payload: { mensagem: "pronto" } },
      telefonePadrao: "96900000000",
    });
    expect(doCliente).toEqual({ ok: true, telefone: "(96) 98121-6527" });
  });

  it("o payload da execução vale por cima do da automação", () => {
    const d = destinoDaAutomacao({
      gatilho: "os_concluida",
      contexto: contextoOs,
      payload: { telefone: "96977776666" },
      automacao: { payload: { telefone: "96911112222", mensagem: "x" } },
      telefonePadrao: null,
    });
    expect(d).toEqual({ ok: true, telefone: "96977776666" });
  });
});

describe("o texto", () => {
  it("troca as variáveis do contexto, como a prévia da tela", () => {
    expect(
      textoDaAutomacao({
        gatilho: "status_os_alterado",
        contexto: { ...contextoOs, status_novo: "arte_rejeitada" },
        payload: {},
        automacao: {
          payload: { mensagem: "{{cliente.nome}}, a OS {{os.numero}} foi para {{status_novo}}." },
        },
        telefonePadrao: null,
      }),
    ).toBe("Maria Silva, a OS 49 foi para arte_rejeitada.");
  });

  it("sem mensagem, texto vazio — o envio recusa com motivo, não manda vazio", () => {
    expect(
      textoDaAutomacao({
        gatilho: "os_concluida",
        contexto: {},
        payload: {},
        automacao: null,
        telefonePadrao: null,
      }),
    ).toBe("");
  });
});
