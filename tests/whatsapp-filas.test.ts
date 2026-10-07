import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  atendidoPermitido,
  esperaDe,
  filtroDaUrl,
  ordenarPorEspera,
  setoresDoFiltro,
} from "@/domain/whatsapp/filas";

/**
 * Filas por setor, espera e atendimentos (caixa v3). As regras de banco
 * (resolver 'atendido' e reabertura) moram em funções SQL da migração
 * drizzle/0002; aqui elas são conferidas no texto da função — e, a tela, pela
 * mesma regra em TypeScript.
 */

const V3 = readFileSync("drizzle/migrations/0002_whatsapp_caixa_v3_filas_atendimentos_ia.sql", "utf8");

function corpo(nome: string): string {
  const m = new RegExp(`FUNCTION public\\.${nome}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`).exec(V3);
  expect(m, `função ${nome} não encontrada na migração`).not.toBeNull();
  return m?.[1] ?? "";
}

describe("resolver como 'Atendido' com a última mensagem do cliente", () => {
  it("o banco recusa, com a frase que a tela mostra", () => {
    const f = corpo("whatsapp_resolver");
    expect(f).toMatch(/p_motivo = 'atendido' AND v_ultima = 'entrada'/);
    expect(f).toContain("O cliente mandou a última mensagem; responda ou marque outro motivo.");
  });

  it("a tela avisa antes, pela mesma regra", () => {
    const entrada = { direcao: "entrada", recebido_em: "2026-10-07T10:05:00Z", enviado_em: null, created_at: "2026-10-07T10:05:01Z" };
    const saida = { direcao: "saida", recebido_em: null, enviado_em: "2026-10-07T10:01:00Z", created_at: "2026-10-07T10:01:00Z" };
    expect(atendidoPermitido([saida, entrada])).toBe(false);
    expect(atendidoPermitido([entrada, { ...saida, enviado_em: "2026-10-07T10:09:00Z" }])).toBe(true);
    expect(atendidoPermitido([])).toBe(true);
  });
});

describe("reabertura cria atendimento novo e tira o responsável", () => {
  it("mensagem nova numa conversa sem atendimento aberto abre outro, ligado ao anterior", () => {
    const f = corpo("_wa_abrir_atendimento");
    expect(f).toMatch(/WHEN p_origem = 'mensagem_recebida' AND v_anterior IS NOT NULL THEN 'reaberto'/);
    expect(f).toMatch(/reaberto_de/);
    expect(f).toMatch(/ON CONFLICT \(conversa_id\) WHERE fechado_em IS NULL DO NOTHING/);
  });

  it("e a conversa perde o responsável e volta ao modo automático", () => {
    const f = corpo("_wa_abrir_atendimento");
    expect(f).toMatch(/responsavel_id = CASE WHEN v_anterior IS NOT NULL AND p_origem = 'mensagem_recebida' THEN NULL/);
    expect(f).toMatch(/modo = CASE WHEN v_anterior IS NOT NULL AND p_origem = 'mensagem_recebida' THEN 'auto'/);
  });

  it("só um atendimento aberto por conversa (índice único parcial)", () => {
    expect(V3).toMatch(/CREATE UNIQUE INDEX whatsapp_atendimentos_um_aberto ON public\.whatsapp_atendimentos \(conversa_id\) WHERE fechado_em IS NULL/);
  });
});

describe("filtro de setor", () => {
  it("vem da URL e cai em 'minhas filas' quando não reconhece", () => {
    expect(filtroDaUrl("producao")).toBe("producao");
    expect(filtroDaUrl("todas")).toBe("todas");
    expect(filtroDaUrl("qualquer")).toBe("minhas_filas");
    expect(filtroDaUrl(undefined)).toBe("minhas_filas");
  });

  it("minhas filas: as da pessoa; sem nenhuma, não filtra (não esconde tudo)", () => {
    expect(setoresDoFiltro("minhas_filas", ["comercial", "producao"])).toEqual(["comercial", "producao"]);
    expect(setoresDoFiltro("minhas_filas", [])).toBeNull();
    expect(setoresDoFiltro("todas", ["comercial"])).toBeNull();
    expect(setoresDoFiltro("financeiro", ["comercial"])).toEqual(["financeiro"]);
  });
});

describe("tempo de espera", () => {
  const agora = new Date("2026-10-07T13:00:00Z");
  const ha = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();

  it("régua 15 / 60 min", () => {
    expect(esperaDe(ha(5), agora)).toMatchObject({ texto: "5 min", nivel: "ok" });
    expect(esperaDe(ha(15), agora)).toMatchObject({ nivel: "atencao" });
    expect(esperaDe(ha(65), agora)).toMatchObject({ texto: "1 h 05", nivel: "atrasada" });
    expect(esperaDe(ha(60 * 50), agora)).toMatchObject({ texto: "2 d" });
    expect(esperaDe(null, agora)).toBeNull();
  });

  it("a fila humana começa por quem espera há mais tempo e ignora quem não espera", () => {
    const lista = [
      { id: "b", aguardando_desde: ha(5) },
      { id: "x", aguardando_desde: null },
      { id: "a", aguardando_desde: ha(70) },
    ];
    expect(ordenarPorEspera(lista).map((c) => c.id)).toEqual(["a", "b"]);
  });
});
