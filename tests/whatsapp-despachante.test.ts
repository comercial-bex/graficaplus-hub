import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONFERIR_A_CADA_MS,
  INTERVALO_DO_DESPACHANTE_MS,
  PRESA_APOS_MS,
  deveChamarAgora,
  limiteDePresa,
  minutosAteAProximaTentativa,
  proximaTentativaEm,
} from "../src/domain/whatsapp/despachante";

/**
 * O despachante dos avisos ao cliente: cada aba visível de quem tem
 * `whatsapp.reply` chama o envio a cada 2 minutos (decisão do dono em
 * 02/10/2026, com o WhatsApp recém-conectado: os avisos saem na hora).
 */

const T0 = Date.parse("2026-10-02T19:40:00Z");
const pronto = {
  temPermissao: true,
  abaVisivel: true,
  emAndamento: false,
  ultimaChamadaEm: null as number | null,
  agora: T0,
};

describe("chamar o envio agora?", () => {
  it("logo ao montar, com permissão e aba visível: chama", () => {
    expect(deveChamarAgora(pronto)).toBe(true);
  });

  it("sem whatsapp.reply: nunca chama", () => {
    expect(deveChamarAgora({ ...pronto, temPermissao: false })).toBe(false);
  });

  it("aba escondida: não chama — dez abas esquecidas não viram dez despachantes", () => {
    expect(deveChamarAgora({ ...pronto, abaVisivel: false })).toBe(false);
  });

  it("uma chamada por vez: com a anterior em andamento, espera", () => {
    expect(deveChamarAgora({ ...pronto, emAndamento: true })).toBe(false);
    expect(
      deveChamarAgora({ ...pronto, emAndamento: true, ultimaChamadaEm: T0 - 10 * 60_000 }),
    ).toBe(false);
  });

  it("respeita o intervalo de 2 minutos desde o COMEÇO da última chamada", () => {
    expect(INTERVALO_DO_DESPACHANTE_MS).toBe(120_000);
    expect(deveChamarAgora({ ...pronto, ultimaChamadaEm: T0 - 119_999 })).toBe(false);
    expect(deveChamarAgora({ ...pronto, ultimaChamadaEm: T0 - 120_000 })).toBe(true);
    // Voltar para a aba depois de 30 min chama na hora, sem esperar o relógio.
    expect(deveChamarAgora({ ...pronto, ultimaChamadaEm: T0 - 30 * 60_000 })).toBe(true);
  });

  it("a conferência local é bem mais curta que o intervalo — não atrasa a chamada", () => {
    expect(CONFERIR_A_CADA_MS).toBeLessThan(INTERVALO_DO_DESPACHANTE_MS / 4);
  });
});

describe("espera antes de tentar de novo um aviso", () => {
  it("1, 5, 15 e depois 60 minutos", () => {
    expect([1, 2, 3, 4, 5, 9].map(minutosAteAProximaTentativa)).toEqual([1, 5, 15, 60, 60, 60]);
    // Contagem estranha não quebra: zero ou negativo vira a primeira espera.
    expect(minutosAteAProximaTentativa(0)).toBe(1);
    expect(minutosAteAProximaTentativa(-3)).toBe(1);
  });

  it("as cinco tentativas padrão cobrem mais de uma hora de instabilidade, não dez minutos", () => {
    const total = [1, 2, 3, 4].reduce((s, t) => s + minutosAteAProximaTentativa(t), 0);
    expect(total).toBe(81);
  });

  it("a data gravada é agora + a espera", () => {
    const agora = new Date("2026-10-02T19:40:00.000Z");
    expect(proximaTentativaEm(agora, 2)).toBe("2026-10-02T19:45:00.000Z");
  });
});

describe("reserva esquecida", () => {
  it("volta à fila depois de 10 minutos em 'enviando'", () => {
    expect(PRESA_APOS_MS).toBe(600_000);
    expect(limiteDePresa(new Date("2026-10-02T19:40:00.000Z"))).toBe("2026-10-02T19:30:00.000Z");
  });
});

describe("o componente obedece a decisão e não faz barulho", () => {
  const componente = readFileSync("src/components/whatsapp/despachante-de-avisos.tsx", "utf8");

  it("decide pela função testada, com a permissão de responder e a aba visível", () => {
    expect(componente).toContain("deveChamarAgora(");
    expect(componente).toContain('hasPermission("whatsapp.reply")');
    expect(componente).toContain('document.visibilityState === "visible"');
  });

  it("chama o consumidor com a sessão, e nunca mostra toast", () => {
    expect(componente).toContain("acionarEnvio()");
    // Nem importa o sonner nem chama toast — o comentário pode citar a palavra.
    expect(componente).not.toMatch(/from "sonner"/);
    expect(componente).not.toMatch(/\btoast[.(]/);
    expect(componente).toContain("console.debug");
  });

  it("não renderiza nada", () => {
    expect(componente).toMatch(/return null;\s*\}\s*$/);
  });
});
