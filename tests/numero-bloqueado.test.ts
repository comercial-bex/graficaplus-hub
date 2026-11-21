import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chaveDoNumeroBloqueado,
  MOTIVO_NUMERO_BLOQUEADO,
  numeroBloqueado,
} from "@/domain/whatsapp/numero-bloqueado";

/**
 * O dono mandou parar as mensagens do Léo e do Yvens em 17/11/2026. O bloqueio só barrava na entrada de duas das três
 * filas; a fila de automações mandava direto para o telefone do payload e o "Lembrete à operação" ("Olá, Leonardo!")
 * continuou saindo às 09:00 de 18, 19, 20 e 21/11. Estes testes travam a última porta: o envio.
 */
describe("a chave do número bloqueado é a do banco (_wa_chave_numero)", () => {
  it("o mesmo número em qualquer formato dá a mesma chave", () => {
    const formatos = [
      "(96) 99142-3082",
      "96991423082",
      "5596991423082",
      "+55 (96) 99142-3082",
      "5596991423082@s.whatsapp.net",
    ];
    for (const f of formatos) expect(chaveDoNumeroBloqueado(f)).toBe("9691423082");
    expect(chaveDoNumeroBloqueado("(96) 99156-4805")).toBe("9691564805");
  });

  it("com ou sem o nono dígito dá a mesma chave (DDD e os 8 últimos)", () => {
    expect(chaveDoNumeroBloqueado("559691423082")).toBe(chaveDoNumeroBloqueado("5596991423082"));
    expect(chaveDoNumeroBloqueado("9691423082")).toBe("9691423082");
  });

  it("sem número de pessoa não há chave: vazio, curto e grupo", () => {
    expect(chaveDoNumeroBloqueado(null)).toBeNull();
    expect(chaveDoNumeroBloqueado("")).toBeNull();
    expect(chaveDoNumeroBloqueado("12345")).toBeNull();
    expect(chaveDoNumeroBloqueado("120363431862625987-group")).toBeNull();
  });
});

describe("numeroBloqueado", () => {
  const bloqueados = new Set(["9691423082", "9691564805"]);

  it("barra os dois números do dono, escritos de qualquer jeito", () => {
    expect(numeroBloqueado(bloqueados, "5596991423082")).toBe(true);
    expect(numeroBloqueado(bloqueados, "(96) 99156-4805")).toBe(true);
    expect(numeroBloqueado(bloqueados, "559691564805@s.whatsapp.net")).toBe(true);
  });

  it("deixa passar quem não está na lista, e o grupo da equipe", () => {
    expect(numeroBloqueado(bloqueados, "5596984079775")).toBe(false);
    expect(numeroBloqueado(bloqueados, "5596981176844")).toBe(false);
    expect(numeroBloqueado(bloqueados, "120363431862625987-group")).toBe(false);
    expect(numeroBloqueado(bloqueados, null)).toBe(false);
  });

  it("lista vazia não barra ninguém", () => {
    expect(numeroBloqueado(new Set(), "5596991423082")).toBe(false);
  });

  it("o motivo diz a mesma frase do gatilho do banco", () => {
    expect(MOTIVO_NUMERO_BLOQUEADO).toBe("Número bloqueado pelo dono: nenhuma mensagem é enviada.");
  });
});

describe("o consumidor das filas confere o bloqueio antes de chamar o Z-API", () => {
  const fonte = readFileSync("src/lib/api/whatsapp-enviar.server.ts", "utf8");

  it("a rodada lê os bloqueados antes de ler qualquer fila, e sem conseguir ler não envia nada", () => {
    const leitura = fonte.indexOf("await lerNumerosBloqueados()");
    expect(leitura).toBeGreaterThan(0);
    expect(leitura).toBeLessThan(fonte.indexOf('.from("whatsapp_fila_envio")\n    .select("id, conversa_id'));
    const trecho = fonte.slice(leitura, leitura + 700);
    expect(trecho).toContain("if (!bloqueios.ok)");
    expect(trecho).toContain("nada foi enviado");
  });

  it("a fila das conversas confere o telefone da conversa antes de montar o envio", () => {
    const de = fonte.indexOf("const pedido = pedidoDaLinha(linha");
    const ate = fonte.indexOf("const resposta = await chamarZapi(montado, clientToken);", de);
    const trecho = fonte.slice(de, ate);
    expect(trecho).toContain("numeroBloqueado(bloqueios.chaves,");
    expect(trecho).toContain("MOTIVO_NUMERO_BLOQUEADO");
    expect(trecho.indexOf("numeroBloqueado(")).toBeLessThan(trecho.indexOf("montarEnvio("));
  });

  it("os avisos ao cliente conferem o destino final antes de montar o envio", () => {
    const de = fonte.indexOf("async function processarAvisosAoCliente(");
    const corpo = fonte.slice(de, fonte.indexOf("async function processarAutomacoes(", de));
    expect(corpo).toContain("bloqueados: ReadonlySet<string>");
    const guarda = corpo.indexOf("numeroBloqueado(bloqueados, destinoDoEnvio)");
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeLessThan(corpo.indexOf("montarEnvio("));
    // cancela a linha em vez de deixá-la voltar para a fila
    expect(corpo.slice(guarda, guarda + 400)).toContain('status: "cancelado"');
  });

  it("a fila de automações confere o telefone do destino: foi por ela que o Léo seguiu recebendo", () => {
    const de = fonte.indexOf("async function processarAutomacoes(");
    const corpo = fonte.slice(de);
    expect(corpo).toContain("bloqueados: ReadonlySet<string>");
    const guarda = corpo.indexOf("numeroBloqueado(bloqueados, destino.telefone)");
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeGreaterThan(corpo.indexOf("destinoDaAutomacao(execucao)"));
    expect(guarda).toBeLessThan(corpo.indexOf("montarEnvio("));
    expect(corpo.slice(guarda, guarda + 200)).toContain("await falhar(MOTIVO_NUMERO_BLOQUEADO, true)");
  });

  it("a rodada passa os bloqueados às duas filas que recebem a lista", () => {
    expect(fonte).toContain(
      "processarAvisosAoCliente(instancia, token, clientToken, agora, bloqueios.chaves)",
    );
    expect(fonte).toMatch(/processarAutomacoes\(\s*instancia,\s*token,\s*clientToken,\s*telefonePadrao,\s*agora,\s*bloqueios\.chaves,\s*\)/);
  });

  it("não nasce um quinto ponto de envio sem conferir o bloqueio", () => {
    // 3 chamadas diretas das filas + 1 segunda tentativa da fila das conversas (mesmo telefone, já conferido).
    // Quem criar outro `await chamarZapi(` precisa conferir `numeroBloqueado` antes e atualizar este número.
    expect((fonte.match(/await chamarZapi\(/g) ?? []).length).toBe(4);
  });
});
