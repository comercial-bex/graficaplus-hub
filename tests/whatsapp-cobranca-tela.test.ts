import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TELA da cobrança de orçamento no grupo (pedido do dono, 11/11/2026): o cartão no Monitor do
 * WhatsApp, a função que grava a configuração e o rótulo do modelo novo nas telas de avisos.
 *
 * O cartão é lido como texto (as regras visuais do dono, que enxerga mal, e a falha de consulta
 * que não pode virar lista vazia) e as palavras dele são exercidas pelas funções puras de
 * `rotulos.ts`. A função de salvar é chamada como o servidor chamaria, com dublês do Supabase.
 */

const raiz = resolve(__dirname, "..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

const CARTAO = "src/components/cobranca-no-grupo/cartao-da-cobranca.tsx";
const ROTULOS = "src/components/cobranca-no-grupo/rotulos.ts";
const CAIXA = "src/lib/api/whatsapp-caixa.functions.ts";

/* ------------------------------------------------------------------ */
/* Dublês para chamar salvarCobrancaDeOrcamento                        */
/* ------------------------------------------------------------------ */

const dubles = vi.hoisted(() => ({
  temPermissao: true,
  erroDoSalvar: null as null | { message: string },
  permissoesPedidas: [] as string[],
  rpcsDoServico: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const construtor: any = {
      middleware: () => construtor,
      inputValidator: () => construtor,
      handler: (fn: (args: unknown) => Promise<unknown>) => fn,
    };
    return construtor;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      dubles.rpcsDoServico.push({ fn, args });
      return Promise.resolve({ data: null, error: dubles.erroDoSalvar });
    },
  },
}));

import { salvarCobrancaDeOrcamento } from "../src/lib/api/whatsapp-caixa.functions";
import {
  caminhoDaConversa,
  citadosPorExtenso,
  erroDoSabadoFim,
  erroDosMinutos,
  MODOS,
  rotuloDoModo,
  situacaoDaRodada,
  textoSemTelefones,
  rotuloDoMotivo,
  rotuloDoNivel,
  situacaoDaCobranca,
} from "../src/components/cobranca-no-grupo/rotulos";

const USUARIO = "6e6693f1-ea58-42b8-acf6-46fae959566a";
const CONFIG = {
  modo: "ensaio",
  min_pedido: 240,
  min_orcamento: 120,
  min_gestor: 240,
  sabado: true,
  sabado_fim: "12:00",
};

const contexto = () => ({
  userId: USUARIO,
  supabase: {
    rpc: (fn: string, args: { _permission: string }) => {
      if (fn !== "has_permission") return Promise.resolve({ data: null, error: null });
      dubles.permissoesPedidas.push(args._permission);
      return Promise.resolve({ data: dubles.temPermissao, error: null });
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const salvar = (data: unknown) => (salvarCobrancaDeOrcamento as any)({ data, context: contexto() });

beforeEach(() => {
  dubles.temPermissao = true;
  dubles.erroDoSalvar = null;
  dubles.permissoesPedidas = [];
  dubles.rpcsDoServico = [];
});

/* ------------------------------------------------------------------ */
/* O cartão                                                            */
/* ------------------------------------------------------------------ */

describe("cartão Cobrança de orçamento no grupo", () => {
  const cartao = ler(CARTAO);
  const rotulos = ler(ROTULOS);

  it("está no Monitor do WhatsApp, logo depois da assistente", () => {
    const monitor = ler("src/routes/_authenticated/whatsapp-monitor.tsx");
    expect(monitor).toMatch(/<ConfiguracaoDoAssistente \/>\s*<CartaoDaCobranca \/>/);
    expect(cartao).toContain("Cobrança de orçamento no grupo");
  });

  it("só configuracoes.manage edita; os outros veem sem os botões de salvar", () => {
    expect(cartao).toContain('hasPermission("configuracoes.manage")');
    // whatsapp.manage é só do admin: o gestor ficaria de fora.
    expect(cartao).not.toContain('hasPermission("whatsapp.manage")');
    // O botão de gravar só existe no ramo de quem pode editar.
    expect(cartao).toMatch(/\{podeEditar \? \([\s\S]*Gravar cobrança[\s\S]*\) : \(/);
    // E os controles ficam travados para os outros.
    expect(cartao).toMatch(/const travado = !podeEditar \|\| salvando/);
    expect(cartao).toContain("salvarCobrancaDeOrcamento");
  });

  it("lê as colunas da configuração e as 20 últimas cobranças, com a situação da fila", () => {
    for (const c of [
      "cobranca_modo",
      "cobranca_min_pedido",
      "cobranca_min_orcamento",
      "cobranca_min_gestor",
      "cobranca_sabado",
      "cobranca_sabado_fim",
      "cobranca_ligada_em",
      "cobranca_ensaio_desde",
    ]) {
      expect(cartao).toContain(c);
    }
    expect(cartao).toContain('.from("whatsapp_cobrancas")');
    expect(cartao).toContain(".limit(20)");
    expect(cartao).toContain('.order("created_at", { ascending: false })');
    expect(cartao).toContain('.select("id, status, entregue_em, lido_em")');
  });

  it("falha da consulta aparece como FalhaDeConsulta, nunca como lista vazia", () => {
    expect(cartao).toContain('from "@/components/whatsapp/falha-de-consulta"');
    // Duas consultas, duas falhas ditas: a configuração e a lista.
    expect(cartao.match(/<FalhaDeConsulta/g)?.length).toBe(2);
    expect(cartao).toMatch(/config\.isError \? \(\s*<FalhaDeConsulta/);
    expect(cartao).toMatch(/lista\.isError \? \(\s*<FalhaDeConsulta/);
    // O erro de cada leitura sobe (vira isError), inclusive o da fila e o da linha que falta.
    expect(cartao.match(/if \(error\) throw error;/g)?.length).toBe(2);
    expect(cartao).toContain("if (r.error) throw r.error;");
    expect(cartao).toContain('throw new Error("A configuração do WhatsApp não foi encontrada.")');
  });

  it("sem title=, sem text-primary, text-accent nem #fd4746; botões de 44 px; texto principal de 16 px", () => {
    for (const f of [cartao, rotulos]) {
      expect(f).not.toMatch(/\stitle=/);
      expect(f).not.toContain("text-primary");
      expect(f).not.toContain("text-accent");
      expect(f.toLowerCase()).not.toContain("#fd4746");
      // nada abaixo de 13 px (text-xs) nem tamanho escrito à mão
      expect(f).not.toMatch(/text-\[\d+px\]/);
      expect(f).not.toMatch(/\btext-(?:xs|sm)\b/);
    }
    // Todo <Button> do cartão tem 44 px.
    // Do <Button até o className dele (as setas de função no onClick não cortam o trecho).
    const botoes = cartao.match(/<Button\b[\s\S]*?className="[^"]*"/g) ?? [];
    expect(botoes.length).toBe(cartao.match(/<Button\b/g)?.length);
    expect(botoes.length).toBeGreaterThanOrEqual(3);
    for (const b of botoes) expect(b).toMatch(/className="[^"]*\bh-11\b[^"]*"$/);
    // Campos, link e "ver a mensagem" também.
    expect(cartao.match(/<Input\b[\s\S]*?\/>/g)?.every((i) => i.includes("h-11"))).toBe(true);
    expect(cartao).toMatch(/inline-flex h-11 items-center gap-2 rounded-md border/);
    expect(cartao).toMatch(/<summary className="inline-flex h-11/);
    expect(cartao).toContain('<CardContent className="space-y-5 text-base">');
    // Ajuda pela Dica, com o texto em dicas.ts.
    expect(cartao).toContain('from "@/components/bex/Dica"');
    expect(cartao).toContain('dicaAcao(ROTA, "cobranca_salvar")');
  });

  it("sem travessão nem seta no texto visível", () => {
    for (const f of [cartao, rotulos]) {
      expect(f).not.toMatch(/[—–→⇒›]/);
      expect(f).not.toContain("->");
    }
    const textos = [
      ...MODOS.flatMap((m) => [m.rotulo, m.explica]),
      rotuloDoMotivo("pedido_sem_orcamento"),
      rotuloDoMotivo("orcamento_parado"),
      rotuloDoNivel(1),
      rotuloDoNivel(2),
      citadosPorExtenso([{ nome: "Ana Paula", papel: "responsavel", mencao: "5596991112233" }]),
      erroDosMinutos("10") ?? "",
      erroDoSabadoFim("19:00", "08:00") ?? "",
    ];
    for (const t of textos) expect(t).not.toMatch(/[—–→⇒›]|->/);
  });
});

/* ------------------------------------------------------------------ */
/* As palavras do cartão                                               */
/* ------------------------------------------------------------------ */

describe("palavras do cartão", () => {
  it("modo e motivo por extenso; modo desconhecido é Desligada", () => {
    expect(MODOS.map((m) => m.rotulo)).toEqual(["Desligada", "Ensaio", "Ligada"]);
    expect(rotuloDoModo("ensaio")).toBe("Ensaio");
    expect(rotuloDoModo("qualquer")).toBe("Desligada");
    expect(rotuloDoMotivo("pedido_sem_orcamento")).toBe("Pediu e não recebeu");
    expect(rotuloDoMotivo("orcamento_parado")).toBe("Orçamento parado");
    expect(rotuloDoNivel(2)).toContain("gerência");
  });

  it("no ensaio é o que teria mandado; no ligado, o que a fila diz", () => {
    expect(situacaoDaCobranca("ensaio", null, undefined).rotulo).toBe("Teria mandado");
    const vazio = { status: null, entregue_em: null, lido_em: null };
    expect(situacaoDaCobranca("ligada", "f1", { ...vazio, status: "pendente" }).rotulo).toBe("Na fila");
    expect(situacaoDaCobranca("ligada", "f1", { ...vazio, status: "enviado" }).rotulo).toBe("Enviado");
    expect(
      situacaoDaCobranca("ligada", "f1", { ...vazio, status: "enviado", entregue_em: "2026-11-12T13:00:00Z" })
        .rotulo,
    ).toBe("Entregue");
    expect(
      situacaoDaCobranca("ligada", "f1", {
        status: "enviado",
        entregue_em: "2026-11-12T13:00:00Z",
        lido_em: "2026-11-12T13:05:00Z",
      }).rotulo,
    ).toBe("Lido");
    const falhou = situacaoDaCobranca("ligada", "f1", { ...vazio, status: "falhou" });
    expect(falhou).toEqual({ rotulo: "Falhou", tom: "magenta" });
    // Linha da fila que não veio não é "enviado": é falta de notícia.
    expect(situacaoDaCobranca("ligada", "f1", undefined).rotulo).toBe("Sem notícia da fila");
  });

  it("citados pelo primeiro nome e o papel; sem telefone fica dito", () => {
    expect(
      citadosPorExtenso([
        { nome: "Ana Paula Souza", papel: "responsavel", sem_telefone: false },
        { nome: "Bruno", papel: "vendedor", sem_telefone: true },
        { nome: "Carla", papel: "gerencia", sem_telefone: false },
      ]),
    ).toBe("Ana (responsável), Bruno (vendedor, sem telefone), Carla (gerência)");
    expect(citadosPorExtenso([])).toBe("ninguém");
    expect(citadosPorExtenso(null)).toBe("ninguém");
  });

  it("minutos de 30 a 1440, só números; sábado termina depois do início e até as 18h", () => {
    expect(erroDosMinutos("240")).toBeNull();
    expect(erroDosMinutos("30")).toBeNull();
    expect(erroDosMinutos("1440")).toBeNull();
    expect(erroDosMinutos("29")).not.toBeNull();
    expect(erroDosMinutos("1441")).not.toBeNull();
    expect(erroDosMinutos("2,5")).not.toBeNull();
    expect(erroDosMinutos("")).not.toBeNull();
    expect(erroDoSabadoFim("12:00", "08:00:00")).toBeNull();
    expect(erroDoSabadoFim("18:00", "08:00")).toBeNull();
    expect(erroDoSabadoFim("08:00", "08:00")).not.toBeNull();
    expect(erroDoSabadoFim("18:30", "08:00")).not.toBeNull();
    expect(erroDoSabadoFim("", "08:00")).not.toBeNull();
  });

  it("o link abre a conversa no sistema", () => {
    expect(caminhoDaConversa("0b9d7c1e-5a43-4f6e-9d21-7c3e8a1f2b40")).toBe(
      "/whatsapp?conversa=0b9d7c1e-5a43-4f6e-9d21-7c3e8a1f2b40",
    );
  });
});

/* ------------------------------------------------------------------ */
/* A função que grava                                                  */
/* ------------------------------------------------------------------ */

describe("salvarCobrancaDeOrcamento", () => {
  it("confere configuracoes.manage e chama whatsapp_cobranca_salvar com p_usuario e p_config", async () => {
    await expect(salvar(CONFIG)).resolves.toEqual({ ok: true });
    expect(dubles.permissoesPedidas).toEqual(["configuracoes.manage"]);
    expect(dubles.rpcsDoServico).toEqual([
      { fn: "whatsapp_cobranca_salvar", args: { p_usuario: USUARIO, p_config: CONFIG } },
    ]);
  });

  it("sem a permissão, recusa e não grava nada", async () => {
    dubles.temPermissao = false;
    await expect(salvar(CONFIG)).rejects.toThrow(/configuracoes › manage/);
    expect(dubles.rpcsDoServico).toEqual([]);
  });

  it("erro do banco vira erro (por exemplo, ligar sem o grupo)", async () => {
    dubles.erroDoSalvar = { message: "Para ligar a cobrança, o aviso no grupo da equipe precisa estar ligado." };
    await expect(salvar({ ...CONFIG, modo: "ligada" })).rejects.toThrow(/grupo da equipe/);
  });

  it("no arquivo: a permissão antes da chave de serviço, no lugar que o esqueleto marcou", () => {
    const caixa = ler(CAIXA);
    const inicio = caixa.indexOf("export const salvarCobrancaDeOrcamento");
    const corpo = caixa.slice(inicio, caixa.indexOf("});", inicio));
    expect(corpo.indexOf('exigir(context.supabase, context.userId, "configuracoes.manage")')).toBeGreaterThan(0);
    expect(corpo.indexOf('"whatsapp_cobranca_salvar"')).toBeGreaterThan(
      corpo.indexOf('exigir(context.supabase, context.userId, "configuracoes.manage")'),
    );
    // Depois de salvarConfiguracoesWhatsapp; os testes que fatiam o arquivo dependem disso.
    expect(inicio).toBeGreaterThan(caixa.indexOf("export const salvarConfiguracoesWhatsapp"));
  });
});

/* ------------------------------------------------------------------ */
/* Rótulo do modelo novo                                               */
/* ------------------------------------------------------------------ */

describe("rótulo do modelo novo", () => {
  it("cobranca_orcamento aparece com nome nas telas de avisos e no Monitor", () => {
    for (const f of [
      "src/routes/_authenticated/whatsapp-monitor.tsx",
      "src/components/avisos/avisos-enviados.tsx",
      "src/routes/_authenticated/avisos.tsx",
    ]) {
      expect(ler(f)).toContain('cobranca_orcamento: "Cobrança de orçamento no grupo"');
    }
    expect(ler("src/components/notificacoes/templates-automaticos-card.tsx")).toContain(
      'cobranca_orcamento: ["texto"]',
    );
  });

  it("as dicas da cobrança estão em dicas.ts", async () => {
    const { dicaCampo, dicaAcao } = await import("../src/lib/dicas");
    for (const c of ["cobranca_modo", "cobranca_min_pedido", "cobranca_min_orcamento", "cobranca_min_gestor", "cobranca_sabado"]) {
      const t = dicaCampo("/whatsapp-monitor", c);
      expect(t, c).toBeTruthy();
      expect(t).not.toMatch(/[—–→]/);
    }
    expect(dicaAcao("/whatsapp-monitor", "cobranca_salvar")).toBeTruthy();
  });
});

describe("revisão: a rodada que falha aparece, e o telefone não", () => {
  const agora = new Date("2026-11-12T15:00:00.000Z");
  const antes = (min: number) => new Date(agora.getTime() - min * 60000).toISOString();

  it("desligada não diz nada; ensaio ou ligada sem rodada, parada ou falha são problema", () => {
    expect(situacaoDaRodada("desligada", null, null, null, agora)).toBeNull();
    expect(situacaoDaRodada("ligada", null, null, null, agora)?.problema).toBe(true);
    expect(situacaoDaRodada("ligada", antes(3), true, null, agora)).toEqual({ problema: false, texto: "Última rodada às 11:57: ok." });
    const parada = situacaoDaRodada("ensaio", antes(16), true, null, agora);
    expect(parada?.problema).toBe(true);
    expect(parada?.texto).toContain("não está rodando");
    const falhou = situacaoDaRodada("ligada", antes(2), false, "o destino não é o grupo da equipe", agora);
    expect(falhou).toEqual({ problema: true, texto: "Última rodada às 11:58 falhou: o destino não é o grupo da equipe." });
  });

  it("acabou de ligar: espera a primeira rodada sem alarme; passou de 15 minutos sem rodada, alarme", () => {
    expect(situacaoDaRodada("ligada", null, null, null, agora, antes(2))).toEqual({
      problema: false,
      texto: "Aguardando a primeira rodada, que acontece a cada 5 minutos.",
    });
    expect(situacaoDaRodada("ligada", antes(600), true, null, agora, antes(3))?.problema).toBe(false);
    expect(situacaoDaRodada("ligada", null, null, null, agora, antes(30))?.problema).toBe(true);
  });

  it("nenhum texto da rodada tem travessão nem seta", () => {
    const todos = [
      situacaoDaRodada("ligada", null, null, null, agora)?.texto,
      situacaoDaRodada("ligada", antes(3), true, null, agora)?.texto,
      situacaoDaRodada("ligada", antes(2), false, null, agora)?.texto,
      situacaoDaRodada("ligada", antes(60), true, null, agora)?.texto,
    ].join(" ");
    expect(todos).not.toMatch(/[—–→←⇒]|->|=>/);
  });

  it("o texto mostrado não traz o @número dos colegas", () => {
    expect(textoSemTelefones("Cliente: Maria\n@5596991112233 @5596994445566\nAbrir: x")).toBe(
      "Cliente: Maria\n@menção @menção\nAbrir: x",
    );
  });

  it("o cartão só pede o histórico a quem pode ler e usa o texto sem telefone", () => {
    const cartao = ler(CARTAO);
    expect(cartao).toContain("useUltimasCobrancas(podeEditar)");
    expect(cartao).toContain("textoSemTelefones(c.texto)");
    expect(cartao).toContain("cobranca_rodada_em");
  });
});
