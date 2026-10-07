import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ROTULO_SITUACAO,
  eventoTemMidia,
  lerMedidasDeEntrada,
  situacaoDoEvento,
} from "../src/domain/whatsapp/diagnostico-webhooks";

const EVENTOS = JSON.parse(
  readFileSync("tests/fixtures/zapi-eventos-06-10.json", "utf8"),
) as Record<string, Record<string, unknown>>;

describe("a situação de cada evento do webhook", () => {
  it("processado com erro é um estado próprio — a mensagem entrou, a mídia não", () => {
    expect(
      situacaoDoEvento({
        processado_em: "2026-10-06T17:36:00Z",
        erro: "cópia da mídia falhou: 404",
      }),
    ).toBe("processado_com_falha");
    expect(situacaoDoEvento({ processado_em: "2026-10-06T17:36:00Z", erro: null })).toBe(
      "processado",
    );
    expect(situacaoDoEvento({ processado_em: null, erro: "banco fora" })).toBe("erro");
    expect(situacaoDoEvento({ processado_em: null, erro: null })).toBe("pendente");
  });

  it("todo estado tem rótulo em português para o filtro e o selo", () => {
    for (const s of ["processado", "processado_com_falha", "erro", "pendente"] as const) {
      expect(ROTULO_SITUACAO[s]).toBeTruthy();
    }
  });

  it("só evento de mensagem com mídia ganha o botão de reprocessar", () => {
    expect(eventoTemMidia(EVENTOS.documento_pdf)).toBe(true);
    expect(eventoTemMidia(EVENTOS.modelo_claro)).toBe(false);
    expect(eventoTemMidia(EVENTOS.recibo_sem_mensagem)).toBe(false);
    expect(eventoTemMidia(null)).toBe(false);
  });
});

describe("as medidas permanentes da entrada", () => {
  it("lê o jsonb da função; o formato de 06/10/2026 era 1 e 1", () => {
    const m = lerMedidasDeEntrada({
      recibos_sem_mensagem: 1,
      midias_sem_copia: 1,
      recibos: [
        {
          id: "3EB0824240D4323CD37480",
          telefone: "559684327152",
          momento: "2026-10-06T17:35:54+00:00",
        },
      ],
      medido_em: "2026-10-06T20:00:00+00:00",
    });
    expect(m.recibos_sem_mensagem).toBe(1);
    expect(m.midias_sem_copia).toBe(1);
    expect(m.recibos[0].id).toBe("3EB0824240D4323CD37480");
  });

  it("formato inesperado é ERRO, nunca zero — zero é a resposta boa", () => {
    expect(() => lerMedidasDeEntrada(null)).toThrow(/formato/);
    expect(() =>
      lerMedidasDeEntrada({ recibos_sem_mensagem: "um", midias_sem_copia: 0, medido_em: "x" }),
    ).toThrow(/formato/);
    expect(() => lerMedidasDeEntrada({ recibos_sem_mensagem: 0, midias_sem_copia: 0 })).toThrow(
      /formato/,
    );
  });
});
