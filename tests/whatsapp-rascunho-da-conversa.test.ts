import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "Criar orçamento" pela conversa não abre rascunho em cima de rascunho
 * (21/10/2026). Medido: a cliente luanaovilhena ganhou nove "Pedido pelo
 * WhatsApp" em 19/10, das 11:24 às 16:43 — oito vazios (#88–#92, #95–#97),
 * cada volta à conversa um novo; só o #98 ganhou item e virou a OS #168.
 */

const C = readFileSync("src/components/whatsapp/criar-a-partir-da-conversa.tsx", "utf8");

describe("a janela mostra o rascunho que a conversa já tem", () => {
  it("procura os rascunhos desta conversa que ainda não viraram OS", () => {
    expect(C).toContain('.eq("conversa_id", conversa.id)');
    expect(C).toContain('.eq("status", "rascunho")');
    expect(C).toContain('.is("os_id", null)');
  });

  it("continuar no mais recente é o botão principal; criar outro vira secundário", () => {
    expect(C).toContain("Continuar no #{r.numero}");
    expect(C).toContain('variant={i === 0 ? "default" : "outline"}');
    expect(C).toContain('variant={rascunhos.length > 0 ? "outline" : "default"}');
    expect(C).toContain('? "Criar outro orçamento"\n                    : "Criar orçamento"}');
  });

  it("falha na procura não trava a criação", () => {
    expect(C).toContain("// Falha aqui não impede criar: a lista é ajuda, não trava.");
    // Só a conferência em andamento segura o botão — o erro, não.
    expect(C).toContain("const conferindoRascunhos = rascunhosDaConversa.isFetching;");
    expect(C).not.toContain("disabled={gravando || rascunhosDaConversa.isError");
  });
});

describe("o clique rápido não passa na frente da conferência (21/10, tarde)", () => {
  // A Aline Lima ganhou #102 e #103 vazios, com 29 s de diferença: a lista de
  // rascunhos só era buscada DEPOIS de a janela abrir.
  it("a lista nasce com o painel (consulta da conversa), não com o clique", () => {
    expect(C).toContain('queryKey: [...CHAVES.conversas, "rascunhos-da-conversa", conversa.id] as const,');
    expect(C).not.toContain("setRascunhos(");
  });

  it("enquanto confere, criar espera — e diz o porquê", () => {
    expect(C).toContain("disabled={gravando || conferindoRascunhos}");
    expect(C).toContain('"Conferindo rascunhos…"');
    expect(C).toContain("if (gravandoRef.current || conferindoRascunhos) return;");
  });

  it("depois de criar, a volta à conversa já mostra o rascunho novo", () => {
    expect(C).toContain('void qc.invalidateQueries({ queryKey: [...CHAVES.conversas, "rascunhos-da-conversa", conversa.id] });');
  });
});
