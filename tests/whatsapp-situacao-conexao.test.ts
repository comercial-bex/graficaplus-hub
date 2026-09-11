import { describe, expect, it } from "vitest";
import { origemServeParaWebhook, situacaoDaConexao } from "../src/domain/whatsapp/situacao-conexao";

const conectada = { conectado: true, status: "conectada", ultimo_evento_at: "2026-09-11T10:00:00Z", ativa: true };

describe("situação da conexão", () => {
  it("sem instância: diz o que fazer primeiro", () => {
    const s = situacaoDaConexao(null);
    expect(s.rotulo).toBe("Não configurado");
    expect(s.proximoPasso).toContain("Cadastre");
  });

  it("instância que nunca recebeu evento NÃO está recebendo, mesmo marcada como conectada", () => {
    // O erro mais provável do primeiro dia: webhook mal colado. O status
    // declarado mente; o sinal é o Z-API chamando o endereço.
    const s = situacaoDaConexao({ ...conectada, ultimo_evento_at: null });
    expect(s.tom).toBe("amber");
    expect(s.proximoPasso).toContain("ainda não chamou");
  });

  it("desconectada depois de ter recebido: pede o QR Code de novo", () => {
    const s = situacaoDaConexao({ ...conectada, conectado: false, status: "desconectada" });
    expect(s.tom).toBe("magenta");
    expect(s.proximoPasso).toContain("QR Code");
  });

  it("recebendo: sem próximo passo", () => {
    expect(situacaoDaConexao(conectada)).toEqual({ rotulo: "Recebendo", tom: "lime", proximoPasso: null });
  });

  it("desativada", () => {
    expect(situacaoDaConexao({ ...conectada, ativa: false }).rotulo).toBe("Desativada");
  });
});

describe("a URL precisa sair do endereço publicado", () => {
  it("aceita o domínio publicado", () => {
    expect(origemServeParaWebhook("https://bexprint.lovable.app")).toBe(true);
  });

  it("recusa pré-visualização, localhost e http", () => {
    expect(
      origemServeParaWebhook("https://id-preview--ac34095e-c679-402e-90c7-5e6cc505cfc3.lovable.app"),
    ).toBe(false);
    expect(origemServeParaWebhook("http://localhost:8080")).toBe(false);
    expect(origemServeParaWebhook("http://bexprint.lovable.app")).toBe(false);
    expect(origemServeParaWebhook("lixo")).toBe(false);
  });
});
