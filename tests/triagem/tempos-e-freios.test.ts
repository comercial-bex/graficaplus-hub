import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMPOS_DE_FREIO,
  LIMITES_DA_CONFIG,
  faixaEmTexto,
  lerCampoDeLimite,
} from "../../src/domain/whatsapp/triagem/limites-da-config";
import { lerMigracao, semComentarios, MIGRACAO_B1 } from "./sql-lido-como-texto";

/**
 * Os campos de tempos e freios da tela do robô de boas-vindas (Onda B, restos). Três coisas:
 *   limites   a lista que a tela mostra é a que o servidor usa e a que o banco confere (lida da migração)
 *   servidor  freios só com whatsapp.manage; tempos com qualquer uma das duas; atraso trocado é recusado
 *   tela      rótulo, valor de agora, unidade e faixa à vista; botão de 44 px; freios em leitura sem permissão
 */

const dubles = vi.hoisted(() => ({
  permissoes: new Set<string>(),
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (f: unknown) => f,
  createServerFn: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {
      middleware: () => c,
      inputValidator: (v: (d: unknown) => unknown) => ((c.validar = v), c),
      handler: (fn: (a: unknown) => unknown) => {
        return async (entrada: { data?: unknown; context: unknown }) =>
          fn({ ...entrada, data: c.validar ? c.validar(entrada.data) : entrada.data });
      },
    };
    return c;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (nome: string, args: Record<string, unknown>) => {
      dubles.rpcs.push({ nome, args });
      return Promise.resolve({ data: {}, error: null });
    },
  },
}));

import { TemposEFreios } from "../../src/components/triagem/tempos-e-freios";
import { salvarConfigDaTriagem, type PainelDaTriagem } from "../../src/lib/api/whatsapp-triagem.functions";

const contexto = () => ({
  userId: "u1",
  supabase: {
    rpc: (_f: string, a: { _permission: string }) =>
      Promise.resolve({ data: dubles.permissoes.has(a._permission), error: null }),
  },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const salvar = (data: unknown) => (salvarConfigDaTriagem as any)({ data, context: contexto() }) as Promise<unknown>;

beforeEach(() => {
  dubles.permissoes = new Set();
  dubles.rpcs = [];
});

describe("os limites", () => {
  it("cada limite da tela é o CHECK da coluna no banco", () => {
    const sql = semComentarios(lerMigracao(MIGRACAO_B1));
    for (const l of LIMITES_DA_CONFIG) {
      if (l.campo === "atrasoMinS" || l.campo === "atrasoMaxS") continue; // o par tem CHECK próprio
      const re = new RegExp(`${l.coluna} integer[^,]*CHECK \\(${l.coluna} BETWEEN ${l.min} AND ${l.max}\\)`);
      expect(sql, l.coluna).toMatch(re);
    }
    expect(sql).toMatch(/atraso_min_s BETWEEN 1 AND 15 AND atraso_max_s BETWEEN atraso_min_s AND 15/);
  });

  it("freios são sete e tempos são quatro, como a regra do banco", () => {
    expect([...CAMPOS_DE_FREIO].sort()).toEqual(
      ["freioErrosHora", "freioFalhasEnvio", "intervaloMinimoS", "maxMensagens", "maxNovasPorDia", "maxNovasPorHora", "maxTentativasPorPasso"].sort(),
    );
    expect(LIMITES_DA_CONFIG.filter((l) => l.grupo === "tempo")).toHaveLength(4);
  });

  it("lerCampoDeLimite aceita só inteiro dentro da faixa e explica em português simples", () => {
    expect(lerCampoDeLimite("esperaRespostaMin", "30")).toEqual({ ok: true, valor: 30 });
    expect(lerCampoDeLimite("esperaRespostaMin", "5")).toEqual({ ok: true, valor: 5 });
    expect(lerCampoDeLimite("esperaRespostaMin", "1440")).toEqual({ ok: true, valor: 1440 });
    for (const ruim of ["", " ", "4", "1441", "8,5", "-3", "abc", "1e3"]) {
      const r = lerCampoDeLimite("esperaRespostaMin", ruim);
      expect(r.ok, ruim).toBe(false);
      if (!r.ok) expect(r.erro).toBe("Escreva um número inteiro de 5 a 1440.");
    }
  });

  it("nenhum texto de tela tem parênteses, travessão, seta ou a palavra revendedor", () => {
    for (const l of LIMITES_DA_CONFIG) {
      for (const t of [l.rotulo, l.ajuda, l.unidade, faixaEmTexto(l)]) {
        expect(t).not.toMatch(/[()—–→]|revend/i);
      }
    }
  });
});

describe("salvarConfigDaTriagem com tempos e freios", () => {
  it("tempo: quem tem só configuracoes.manage salva", async () => {
    dubles.permissoes = new Set(["configuracoes.manage"]);
    await salvar({ esperaRespostaMin: 45, retomarAteHoras: 12 });
    expect(dubles.rpcs.at(-1)).toMatchObject({
      nome: "triagem_config_salvar",
      args: { p_usuario: "u1", p_config: { espera_resposta_min: 45, retomar_ate_horas: 12 } },
    });
  });

  it("freio: quem tem só configuracoes.manage é barrado antes do banco, em português simples", async () => {
    dubles.permissoes = new Set(["configuracoes.manage"]);
    for (const l of LIMITES_DA_CONFIG.filter((x) => x.grupo === "freio")) {
      await expect(salvar({ [l.campo]: l.min })).rejects.toThrow("Seu perfil não tem a permissão de gerenciar o WhatsApp.");
    }
    expect(dubles.rpcs).toEqual([]);
  });

  it("freio: quem tem whatsapp.manage salva com os nomes das colunas", async () => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    await salvar({ maxMensagens: 6, freioErrosHora: 20, intervaloMinimoS: 30 });
    expect(dubles.rpcs.at(-1)?.args).toMatchObject({
      p_config: { max_mensagens: 6, freio_erros_hora: 20, intervalo_minimo_s: 30 },
    });
  });

  it("valor fora da faixa de cada campo é recusado antes do banco", async () => {
    dubles.permissoes = new Set(["whatsapp.manage", "configuracoes.manage"]);
    for (const l of LIMITES_DA_CONFIG) {
      await expect(salvar({ [l.campo]: l.min - 1 })).rejects.toThrow();
      await expect(salvar({ [l.campo]: l.max + 1 })).rejects.toThrow();
      await expect(salvar({ [l.campo]: l.min + 0.5 })).rejects.toThrow();
    }
    expect(dubles.rpcs).toEqual([]);
  });

  it("atraso mínimo maior que o máximo é recusado com frase simples", async () => {
    dubles.permissoes = new Set(["configuracoes.manage"]);
    await expect(salvar({ atrasoMinS: 9, atrasoMaxS: 4 })).rejects.toThrow(
      "O atraso mínimo não pode ser maior que o atraso máximo.",
    );
    expect(dubles.rpcs).toEqual([]);
    await salvar({ atrasoMinS: 4, atrasoMaxS: 4 });
    expect(dubles.rpcs).toHaveLength(1);
  });
});

function painel(p: Partial<PainelDaTriagem> = {}): PainelDaTriagem {
  return {
    config: {
      estado: "desligada",
      percentual: 0,
      numeros_teste: [],
      vale_a_partir_de: null,
      link_parceiro: null,
      avisar_grupo: true,
      agente_apos_triagem: false,
      espera_resposta_min: 30,
      retomar_ate_horas: 24,
      intervalo_minimo_s: 20,
      max_mensagens: 8,
      max_tentativas_por_passo: 2,
      max_novas_por_hora: 12,
      max_novas_por_dia: 60,
      atraso_min_s: 3,
      atraso_max_s: 8,
      freio_falhas_envio: 3,
      freio_erros_hora: 10,
      desligada_por: null,
      desligada_em: null,
      atualizado_em: null,
    },
    podeLigar: true,
    podeEditar: true,
    passos: [],
    respostas: [],
    horarios: [],
    feriados: [],
    contagens: { triagensEm7Dias: 0, porStatus: {}, errosEm24h: 0, textosBarradosEm24h: 0 },
    ...p,
  };
}
const html = (p: PainelDaTriagem) =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TemposEFreios, { painel: p, aoMudar: () => {} })),
  );

describe("a tela de tempos e freios", () => {
  it("mostra rótulo, valor de agora, unidade e faixa de cada campo", () => {
    const h = html(painel());
    for (const l of LIMITES_DA_CONFIG) {
      expect(h, l.campo).toContain(l.rotulo);
      expect(h, l.campo).toContain(faixaEmTexto(l));
      expect(h, l.campo).toContain(`id="limite-${l.campo}"`);
    }
    expect(h).toContain("Valor agora: 30. De 5 a 1440 minutos.");
    expect(h).toContain("Valor agora: 8. De 1 a 12 mensagens.");
  });

  it("quem pode tudo: dois botões de salvar, parados enquanto nada mudou, e nenhum campo em leitura", () => {
    const h = html(painel());
    expect(h).toMatch(/<button[^>]*\sdisabled=""[^>]*>Salvar tempos/);
    expect(h).toMatch(/<button[^>]*\sdisabled=""[^>]*>Salvar freios/);
    expect(h).toContain("min-h-11");
    expect(h).not.toContain('readOnly=""');
    expect(h).not.toContain("Só quem pode ligar o robô muda os freios");
  });

  it("só configuracoes.manage: tempos editáveis, freios em leitura com o motivo e sem botão", () => {
    const h = html(painel({ podeLigar: false, podeEditar: true }));
    expect(h).toContain("Salvar tempos");
    expect(h).not.toContain("Salvar freios");
    expect(h).toContain("Só quem pode ligar o robô muda os freios");
    const freio = h.slice(h.indexOf('id="grupo-freio"'));
    expect(freio.match(/readOnly=""/g)?.length).toBe(7);
    expect(freio).toContain("Valor agora: 10.");
    expect(h).not.toMatch(/whatsapp\.manage|configuracoes\.manage/);
  });

  it("usa só texto de 16 px ou mais e só cores do tema", () => {
    // o Input compartilhado traz `file:text-sm` para o botão de escolher arquivo, que esta tela nunca usa
    const h = html(painel()).replaceAll("file:text-sm", "");
    expect(h).not.toMatch(/text-(xs|sm)\b|text-\[1[0-5]px\]/);
    expect(h).not.toMatch(/#[0-9a-f]{3,6}\b|text-(gray|slate|zinc)-/i);
  });
});
