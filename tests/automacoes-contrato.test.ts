import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CATALOGO,
  ETAPAS_COM_AVISO_AO_CLIENTE,
  GATILHOS,
  TELEFONE_DO_CLIENTE,
} from "../src/domain/automacoes/catalogo";
import { PADRAO_VARIAVEL, renderizarMensagem } from "../src/domain/automacoes/mensagem";
import { PREFIXO_CANCELADA } from "../src/domain/automacoes/execucoes";
import { STATUS } from "../src/domain/os/etapas";

/**
 * O CONTRATO da tela de automações com quem de fato executa.
 *
 * A tela não manda mensagem nenhuma: ela grava uma linha em `automacoes`. Quem
 * enfileira é o banco (enqueue_automacoes) e quem manda é a função
 * process-automations. Se a tela oferecer o que os dois não fazem, a automação
 * fica "Ativa" e nunca dispara — foi exatamente o estado do motor até
 * 02/10/2026, quando a comparação text = enum devolvia 0 para todo evento.
 */

const PROCESSADOR = readFileSync("supabase/functions/process-automations/index.ts", "utf8");
const MIGRACAO = readFileSync(
  "supabase/migrations/20261002103002_motor_de_automacoes_volta_a_enfileirar.sql",
  "utf8",
);

describe("os gatilhos são os do banco", () => {
  it("a lista bate com o enum automacao_gatilho (lido no banco em 02/10/2026; o 7º em 10/10/2026)", () => {
    const DO_ENUM = [
      "status_os_alterado",
      "pagamento_atrasado",
      "estoque_minimo",
      "margem_abaixo_minimo",
      "os_atrasada",
      "os_concluida",
      // ALTER TYPE da migração 20261010120000 (lembrete à gerência).
      "orcamento_aprovado_sem_os",
    ];
    expect([...GATILHOS].sort()).toEqual([...DO_ENUM].sort());
    for (const g of GATILHOS) expect(CATALOGO[g].gatilho).toBe(g);
  });

  it("só oferece as três chaves de condição que automacao_condicao_ok lê", () => {
    const usadas = new Set(
      Object.values(CATALOGO)
        .map((i) => i.condicao)
        .filter(Boolean),
    );
    expect([...usadas].sort()).toEqual(["estoque_minimo", "margem_minima", "status"]);
  });

  it("etapa com aviso automático ao cliente é etapa que existe", () => {
    const validas = new Set(STATUS.map((s) => s.status));
    for (const e of ETAPAS_COM_AVISO_AO_CLIENTE) expect(validas.has(e), e).toBe(true);
  });

  it("evento sem cliente no contexto não oferece mandar para o cliente", () => {
    // Material não tem cliente: o processador cairia no telefone padrão do
    // servidor. Pagamento e margem são dinheiro: vão para a equipe.
    expect(CATALOGO.estoque_minimo.aceitaCliente).toBe(false);
    expect(CATALOGO.pagamento_atrasado.aceitaCliente).toBe(false);
    expect(CATALOGO.margem_abaixo_minimo.aceitaCliente).toBe(false);
  });
});

describe("a mensagem é montada como o processador monta", () => {
  it("a expressão das variáveis é a mesma de renderTemplate", () => {
    expect(PROCESSADOR).toContain(`/${PADRAO_VARIAVEL.source}/g`);
  });

  it("caminho desconhecido vira vazio, como no processador", () => {
    expect(
      renderizarMensagem("OS {{os.numero}} de {{cliente.apelido}}.", { os: { numero: 49 } }),
    ).toBe("OS 49 de .");
    expect(renderizarMensagem("{{ os.numero }}", { os: { numero: 7 } })).toBe("7");
  });

  it("o processador só executa a ação whatsapp", () => {
    expect(PROCESSADOR).toMatch(/acao\s*!==\s*"whatsapp"/);
  });

  it("o destino do cliente leva o 55 que o cadastro não tem", () => {
    // O processador usa payload.telefone ANTES do telefone do contexto — por
    // isso o destino do cliente vai explícito, com o 55.
    expect(PROCESSADOR).toMatch(/payload\.telefone[\s\S]{0,120}renderTemplate\(payload\.telefone/);
    expect(TELEFONE_DO_CLIENTE.startsWith("55{{")).toBe(true);
    const numero = renderizarMensagem(TELEFONE_DO_CLIENTE, {
      cliente: { telefone_normalizado: "96991116169" },
    });
    expect(numero).toBe("5596991116169");
  });
});

describe("o motor vivo é o da migração", () => {
  it("enqueue_automacoes compara o gatilho com ::text", () => {
    expect(MIGRACAO).toContain("gatilho = p_gatilho::text");
  });

  it("desligar cancela a fila com o texto que a tela reconhece", () => {
    expect(MIGRACAO).toContain(`'${PREFIXO_CANCELADA} a automação foi desligada antes do envio.'`);
  });

  it("a falha do motor deixa rastro onde a tela lê", () => {
    expect(MIGRACAO).toMatch(/'automacoes',\s*NULL,\s*'motor_falhou'/);
  });
});
