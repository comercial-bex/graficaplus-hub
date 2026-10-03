import { describe, expect, it } from "vitest";
import { situacaoDaExecucao } from "../src/domain/automacoes/execucoes";
import { envioFunciona, saudeDoEnvio } from "../src/domain/automacoes/saude";

const agora = new Date("2026-10-02T15:00:00Z");
const ha = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();

describe("cada execução diz em que pé está", () => {
  it("pendente: agendada, na fila ou parada", () => {
    expect(
      situacaoDaExecucao({ status: "pendente", erro: null, scheduled_at: ha(-10) }, agora).rotulo,
    ).toBe("Agendada");
    expect(
      situacaoDaExecucao({ status: "pendente", erro: null, scheduled_at: ha(5) }, agora).rotulo,
    ).toBe("Na fila");
    const parada = situacaoDaExecucao(
      { status: "pendente", erro: null, scheduled_at: ha(16) },
      agora,
    );
    expect(parada.rotulo).toBe("Parada na fila");
    expect(parada.tom).toBe("amber");
  });

  it("erro de desligar é cancelamento, não falha", () => {
    const c = situacaoDaExecucao(
      {
        status: "erro",
        erro: "Cancelada: a automação foi desligada antes do envio.",
        scheduled_at: null,
      },
      agora,
    );
    expect(c.rotulo).toBe("Cancelada");
    const f = situacaoDaExecucao(
      { status: "erro", erro: "Z-API retornou HTTP 400", scheduled_at: null },
      agora,
    );
    expect(f.rotulo).toBe("Falhou");
    expect(f.detalhe).toContain("HTTP 400");
  });

  it("enviada e enviando", () => {
    expect(
      situacaoDaExecucao({ status: "sucesso", erro: null, scheduled_at: null }, agora).tom,
    ).toBe("lime");
    expect(
      situacaoDaExecucao({ status: "processando", erro: null, scheduled_at: null }, agora).rotulo,
    ).toBe("Enviando");
  });
});

describe("por que a mensagem não sai", () => {
  const desconectada = {
    conectado: false,
    status: "desconectada",
    ultimo_evento_at: null,
    ativa: true,
  };

  it("o estado real de 02/10/2026: WhatsApp nunca pareado e avisos parados desde 28/09", () => {
    const itens = saudeDoEnvio({
      instancias: [desconectada],
      paradas: {
        automacoes: 0,
        automacoesDesde: null,
        avisos: 4,
        avisosDesde: "2026-09-28T16:17:37Z",
      },
      falhasDoMotor: { total: 0, ultimoErro: null, ultimoEm: null },
    });
    const zap = itens.find((i) => i.chave === "whatsapp")!;
    expect(zap.estado).toBe("problema");
    expect(zap.detalhe).toContain("QR Code");
    const proc = itens.find((i) => i.chave === "processador")!;
    expect(proc.estado).toBe("problema");
    expect(proc.detalhe).toContain("4 avisos ao cliente esperam");
    // Sem automação parada ainda, a tela avisa que a próxima ficaria parada também.
    expect(proc.detalhe).toContain("Automação ligada hoje ficaria parada");
    expect(envioFunciona(itens)).toBe(false);
  });

  it("automação parada aponta para quem a envia: só a função process-automations", () => {
    const itens = saudeDoEnvio({
      instancias: [desconectada],
      paradas: { automacoes: 2, automacoesDesde: ha(40), avisos: 0, avisosDesde: null },
      falhasDoMotor: { total: 0, ultimoErro: null, ultimoEm: null },
    });
    const proc = itens.find((i) => i.chave === "processador")!;
    expect(proc.detalhe).toContain("2 mensagens de automação esperam");
    expect(proc.detalhe).toContain("process-automations");
  });

  it("fila vazia não prova que o processador roda — não pinta de verde", () => {
    const itens = saudeDoEnvio({
      instancias: [
        { ...desconectada, conectado: true, status: "conectada", ultimo_evento_at: ha(1) },
      ],
      paradas: { automacoes: 0, automacoesDesde: null, avisos: 0, avisosDesde: null },
      falhasDoMotor: { total: 0, ultimoErro: null, ultimoEm: null },
    });
    expect(itens.find((i) => i.chave === "processador")!.estado).toBe("desconhecido");
    expect(envioFunciona(itens)).toBe(true);
  });

  it("consulta que falhou é 'não deu para conferir', nunca 'ok'", () => {
    const itens = saudeDoEnvio({ instancias: null, paradas: null, falhasDoMotor: null });
    expect(itens.every((i) => i.estado === "desconhecido")).toBe(true);
    expect(envioFunciona(itens)).toBe(false);
  });

  it("falha do motor aparece com o motivo", () => {
    const itens = saudeDoEnvio({
      instancias: [],
      paradas: { automacoes: 0, automacoesDesde: null, avisos: 0, avisosDesde: null },
      falhasDoMotor: { total: 3, ultimoErro: "operator does not exist", ultimoEm: ha(30) },
    });
    const motor = itens.find((i) => i.chave === "motor")!;
    expect(motor.estado).toBe("problema");
    expect(motor.detalhe).toContain("operator does not exist");
    expect(itens.find((i) => i.chave === "whatsapp")!.detalhe).toContain("Cadastre");
  });
});
