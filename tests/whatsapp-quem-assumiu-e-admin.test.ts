import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  mapaDeRotulos,
  mapaDeSetores,
  primeiroNome,
  rotuloDaPessoa,
  setorDaPessoa,
} from "../src/domain/whatsapp/equipe";
import { fraseDoEvento } from "../src/domain/whatsapp/caixa-de-entrada";

/**
 * 13/10/2026, três achados do dono navegando no WhatsApp:
 *   - "quando assume, aparece o nome de quem assumiu: o primeiro nome, barra a
 *     função" → "assumida por Yvens · Gerência";
 *   - o admin barrado ("Você não tem permissão") na Visão geral e em "Ligados a
 *     esta conversa": três colunas de ligação do orçamento sem GRANT;
 *   - a OS 3D barrada por "sem arquivo final" depois de dispensada a arte.
 */

const EQUIPE = [
  { id: "y", nome: "Yvens", papeis: ["gestor"] },
  { id: "c", nome: "Cibele  Oliveira", papeis: ["financeiro"] },
  { id: "l", nome: "Leonardo Pimentel de Almeida", papeis: ["operador", "vendedor"] },
  { id: "h", nome: "Harison", papeis: ["admin"] },
  { id: "s", nome: "SERGIO COSTA DA CRUZ", papeis: ["operador"] },
  { id: "x", nome: null, papeis: [] },
];

describe("quem é cada pessoa: primeiro nome · setor", () => {
  it("o setor vem do papel, do mais amplo ao mais específico", () => {
    expect(setorDaPessoa(["gestor"])).toBe("Gerência");
    expect(setorDaPessoa(["financeiro"])).toBe("Financeiro");
    expect(setorDaPessoa(["operador", "vendedor"])).toBe("Comercial/Produção");
    expect(setorDaPessoa(["admin"])).toBe("Direção");
    expect(setorDaPessoa([])).toBeNull();
    expect(setorDaPessoa(null)).toBeNull();
    expect(setorDaPessoa(["papel_que_nao_existe"])).toBeNull();
  });

  it("o rótulo é o primeiro nome com o setor; sem papel, só o nome; sem nome, 'Equipe'", () => {
    expect(rotuloDaPessoa(EQUIPE[0])).toBe("Yvens · Gerência");
    expect(rotuloDaPessoa(EQUIPE[1])).toBe("Cibele · Financeiro");
    expect(rotuloDaPessoa(EQUIPE[2])).toBe("Leonardo · Comercial/Produção");
    expect(rotuloDaPessoa({ nome: "Fulano", papeis: null })).toBe("Fulano");
    expect(rotuloDaPessoa(EQUIPE[5])).toBe("Equipe");
    expect(primeiroNome("  Maria   Silva ")).toBe("Maria");
  });

  it("os mapas servem a conversa e a lista", () => {
    expect(mapaDeRotulos(EQUIPE).get("y")).toBe("Yvens · Gerência");
    expect(mapaDeSetores(EQUIPE).get("l")).toBe("Comercial/Produção");
    expect(mapaDeSetores(EQUIPE).has("x")).toBe(false);
    expect(mapaDeRotulos(undefined).size).toBe(0);
  });

  it("a linha do tempo diz o setor de quem assumiu e de quem recebeu", () => {
    const nomes = new Map([["y", "Yvens"], ["c", "Cibele"]]);
    const setores = mapaDeSetores(EQUIPE);
    const base = { id: "e1", conversa_id: "k", detalhe: {}, created_at: "2026-10-13T12:00:00Z" };
    expect(fraseDoEvento({ ...base, tipo: "assumida", de_usuario: "y", para_usuario: "y" } as never, nomes, setores)).toBe(
      "Yvens (Gerência) assumiu o atendimento",
    );
    expect(fraseDoEvento({ ...base, tipo: "transferida", de_usuario: "y", para_usuario: "c" } as never, nomes, setores)).toBe(
      "Yvens (Gerência) transferiu para Cibele (Financeiro)",
    );
    // Sem o mapa de setores, a frase de antes.
    expect(fraseDoEvento({ ...base, tipo: "assumida", de_usuario: "y", para_usuario: "y" } as never, nomes)).toBe(
      "Yvens assumiu o atendimento",
    );
    expect(fraseDoEvento({ ...base, tipo: "assumida", de_usuario: "zzz", para_usuario: null } as never, nomes, setores)).toBe(
      "Alguém da equipe assumiu o atendimento",
    );
  });
});

describe("a migração 20261013150000", () => {
  const SQL = readFileSync("supabase/migrations/20261013150000_whatsapp_admin_3d_e_equipe.sql", "utf8");

  it("abre só as três colunas de ligação do orçamento, não as de dinheiro", () => {
    expect(SQL).toMatch(/GRANT SELECT \(conversa_id, lead_id, contato_id\) ON public\.orcamentos TO authenticated;/);
    expect(SQL).not.toMatch(/GRANT SELECT ON public\.orcamentos/);
    expect(SQL).not.toMatch(/valor_total|custo_estimado|margem_estimada|token_publico/);
  });

  it("a OS 3D é reconhecida pelo orçamento 3D, e só a trava do arquivo final é dispensada", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.os_e_impressao_3d\(p_os_id uuid, p_orcamento_id uuid\)/);
    expect(SQL).toMatch(/AND NOT public\.os_e_impressao_3d\(os_bloqueios_para\.os_id, v_os\.orcamento_id\) THEN/);
    expect(SQL).not.toMatch(/sem_pagamento|material_insuficiente|margem_baixa/);
  });

  it("o aviso automático liga a conversa ao orçamento e à OS de que fala; só preenche o que está vazio", () => {
    expect(SQL).toMatch(/CREATE TRIGGER whatsapp_mensagens_liga_entidade\s+AFTER INSERT ON public\.whatsapp_mensagens/);
    expect(SQL).toMatch(/UPDATE public\.orcamentos SET conversa_id = NEW\.conversa_id WHERE id = v_id AND conversa_id IS NULL;/);
    expect(SQL).toMatch(/UPDATE public\.whatsapp_conversas SET os_id = v_os WHERE id = NEW\.conversa_id AND os_id IS NULL;/);
    // Só mensagem de saída vinda da fila de avisos; id que não é uuid é ignorado.
    expect(SQL).toMatch(/NEW\.direcao <> 'saida' OR coalesce\(NEW\.payload->>'fonte', ''\) <> 'notificacoes_fila'/);
    expect(SQL).toMatch(/!~ '\^\[0-9a-fA-F-\]\{36\}\$'/);
  });

  it("a equipe devolve papéis e continua só para quem lê o WhatsApp", () => {
    expect(SQL).toMatch(/RETURNS TABLE\(id uuid, nome text, avatar_url text, filas whatsapp_fila\[\], papeis text\[\]\)/);
    expect(SQL).toMatch(/has_permission\(auth\.uid\(\), 'whatsapp\.read'\)/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.whatsapp_equipe\(\) FROM PUBLIC, anon;/);
  });
});

describe("a casca estática", () => {
  it("o modo SPA está ligado no vite.config.ts", () => {
    const cfg = readFileSync("vite.config.ts", "utf8");
    expect(cfg).toMatch(/spa:\s*\{\s*enabled:\s*true\s*\}/);
  });
});
