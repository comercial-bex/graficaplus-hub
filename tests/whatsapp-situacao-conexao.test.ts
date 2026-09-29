import { describe, expect, it } from "vitest";
import { origemServeParaWebhook, situacaoDaConexao } from "../src/domain/whatsapp/situacao-conexao";
import { alertasDaConexao } from "../src/domain/whatsapp/diagnostico-webhooks";

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

  it("recém-cadastrada e nunca pareada: manda escanear o QR, não conferir a URL", () => {
    // O estado real de 28/09/2026: instância BEX PRINTS cadastrada,
    // conectado=false, nenhum evento. A ordem antiga testava "sem evento"
    // primeiro e mandava conferir o webhook — escondendo o único passo que
    // destrava tudo.
    const s = situacaoDaConexao({ conectado: false, status: "desconectada", ultimo_evento_at: null, ativa: true });
    expect(s.rotulo).toBe("Falta escanear o QR Code");
    expect(s.tom).toBe("magenta");
    expect(s.proximoPasso).toContain("QR Code");
    expect(s.proximoPasso).toContain("Verificar");
    expect(s.proximoPasso).not.toContain("ainda não chamou");
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

describe("a faixa de aviso no topo do sistema", () => {
  const base = { conectado: true, status: "conectada", ultimo_evento_at: "2026-09-29T10:00:00Z", ativa: true };
  const agora = new Date("2026-09-29T12:00:00Z");

  it("nunca pareada: lembra que falta escanear o QR", () => {
    const a = alertasDaConexao({ ...base, conectado: false, status: "desconectada", ultimo_evento_at: null }, 0, agora);
    expect(a).toHaveLength(1);
    expect(a[0].nivel).toBe("critico");
    expect(a[0].titulo).toBe("Falta escanear o QR Code do WhatsApp");
    // O aviso tem de dizer o que está parado por causa disso, senão vira
    // mais uma faixa amarela que ninguém lê.
    expect(a[0].detalhe).toContain("avisos automáticos");
  });

  it("caiu depois de ter funcionado: pede o QR de novo, com a frase de quem caiu", () => {
    const a = alertasDaConexao({ ...base, conectado: false, status: "desconectada" }, 0, agora);
    expect(a[0].titulo).toBe("WhatsApp desconectado");
    expect(a[0].detalhe).toContain("de novo");
  });

  it("conectada e recebendo: nenhuma faixa", () => {
    expect(alertasDaConexao(base, 0, agora)).toEqual([]);
  });

  it("sem instância ou desativada: nenhuma faixa (é o cartão de conexão que diz o que fazer)", () => {
    expect(alertasDaConexao(null, 0, agora)).toEqual([]);
    expect(alertasDaConexao({ ...base, ativa: false }, 0, agora)).toEqual([]);
  });
});
