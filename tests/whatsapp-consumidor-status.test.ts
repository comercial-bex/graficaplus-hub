import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STATUS_AVISO,
  STATUS_EXECUCAO,
  STATUS_FILA,
  STATUS_MENSAGEM,
} from "../src/domain/whatsapp/status-das-filas";

/**
 * O consumidor da fila só grava status que o banco aceita — e lê o erro.
 *
 * O defeito que esta trava pega: `whatsapp-enviar.server.ts` gravava
 * `status: "falha"` em `notificacoes_fila`, cujo CHECK aceita só
 * pendente|enviando|enviado|falhou|cancelado. O Postgres recusava o UPDATE
 * inteiro; como nenhum update lia o `error`, a linha ficava "pendente" sem
 * `ultimo_erro` e voltava para a fila calada. Nos tipos gerados a coluna é
 * `string`: o tsc não tinha como acusar, e os testes de domínio também não —
 * nenhum deles abria o arquivo do servidor.
 *
 * O teste lê as DUAS pontas: o CHECK e o enum nas migrações, e o arquivo do
 * consumidor. CHECK conferido no banco vivo em 02/10/2026:
 *   CHECK ((status = ANY (ARRAY['pendente','enviando','enviado','falhou','cancelado'])))
 * enum whatsapp_mensagem_status: recebida|pendente|enviada|entregue|lida|falha.
 */

const MIGRACOES = "supabase/migrations";
const CONSUMIDOR = "src/lib/api/whatsapp-enviar.server.ts";

function migracoes(): string[] {
  return readdirSync(MIGRACOES)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRACOES, f), "utf8"));
}

function literais(trecho: string): string[] {
  return [...trecho.matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);
}

/** O CHECK de `notificacoes_fila.status` na ÚLTIMA migração que o define. */
function checkDosAvisos(): string[] | null {
  let achado: string[] | null = null;
  for (const sql of migracoes()) {
    const tabela = sql.match(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?notificacoes_fila\s*\(([\s\S]*?)\n\);/i,
    );
    const coluna = tabela?.[1].match(
      /\bstatus\s+text[^,]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i,
    );
    if (coluna) achado = literais(coluna[1]);
    // Uma migração futura que troque a regra usa o nome da constraint.
    for (const alt of sql.matchAll(
      /notificacoes_fila_status_check\s+CHECK\s*\(([\s\S]*?)\)\s*;/gi,
    )) {
      achado = literais(alt[1]);
    }
  }
  return achado;
}

/** Os valores do enum `whatsapp_mensagem_status`, com os ADD VALUE posteriores. */
function enumDasMensagens(): string[] {
  const valores: string[] = [];
  for (const sql of migracoes()) {
    const criado = sql.match(
      /CREATE TYPE\s+(?:public\.)?whatsapp_mensagem_status\s+AS\s+ENUM\s*\(([^)]*)\)/i,
    );
    if (criado) valores.splice(0, valores.length, ...literais(criado[1]));
    for (const m of sql.matchAll(
      /ALTER TYPE\s+(?:public\.)?whatsapp_mensagem_status\s+ADD VALUE(?: IF NOT EXISTS)?\s+'([a-z_]+)'/gi,
    )) {
      if (!valores.includes(m[1])) valores.push(m[1]);
    }
  }
  return valores;
}

/** O arquivo sem os comentários de linha inteira (eles citam "falha" à vontade). */
const fonte = readFileSync(CONSUMIDOR, "utf8").replace(/^\s*(\/\/|\*|\/\*\*?).*$/gm, "");

/** As chamadas `nome(...)`, com parênteses balanceados e strings respeitadas. */
function chamadas(nome: string): string[] {
  const saida: string[] = [];
  const re = new RegExp(`\\b${nome}\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte))) {
    // A definição (`async function gravarAviso(`) não é gravação.
    if (/function\s+$/.test(fonte.slice(Math.max(0, m.index - 20), m.index))) continue;
    let i = m.index + m[0].length;
    let fundo = 1;
    let aspas: string | null = null;
    for (; i < fonte.length && fundo > 0; i++) {
      const c = fonte[i];
      if (aspas) {
        if (c === "\\") i++;
        else if (c === aspas) aspas = null;
      } else if (c === '"' || c === "'" || c === "`") aspas = c;
      else if (c === "(") fundo++;
      else if (c === ")") fundo--;
    }
    saida.push(fonte.slice(m.index, i));
  }
  return saida;
}

/**
 * Os literais do campo `status` dentro de um trecho — e da condição da
 * reserva (`quandoStatus`), que também é um status da mesma tabela.
 */
function statusEm(trecho: string): string[] {
  return [...trecho.matchAll(/\b(?:status|quandoStatus):\s*([^,\n}]+)/g)].flatMap((m) =>
    literais(m[1]),
  );
}

/** Os literais atribuídos a variáveis tipadas (`const situacao: StatusFila = a ? "x" : "y"`). */
function variaveisTipadas(tipo: string): string[] {
  return [...fonte.matchAll(new RegExp(`:\\s*${tipo}\\s*=\\s*([^;]+);`, "g"))].flatMap((m) =>
    literais(m[1]),
  );
}

/**
 * Os status de qualquer `.from("tabela")...update({...})` escrito direto, fora
 * das funções de gravação — é exatamente a forma do defeito original.
 */
function updatesDiretos(tabela: string): string[] {
  return [...fonte.matchAll(new RegExp(`from\\(\\s*"${tabela}"\\s*\\)([^;]*)`, "g"))]
    .map((m) => m[1])
    .filter((cadeia) => cadeia.includes(".update("))
    .flatMap(statusEm);
}

describe("as listas do domínio são as do banco", () => {
  it("notificacoes_fila: a lista é o CHECK da migração", () => {
    const check = checkDosAvisos();
    expect(check, "não achei o CHECK de notificacoes_fila.status nas migrações").not.toBeNull();
    expect([...(check ?? [])].sort()).toEqual([...STATUS_AVISO].sort());
    // O par que mordeu: no CHECK é "falhou", nunca "falha".
    expect(check).toContain("falhou");
    expect(check).not.toContain("falha");
  });

  it("whatsapp_mensagens: a lista é o enum da migração", () => {
    const valores = enumDasMensagens();
    expect(valores.length).toBeGreaterThan(0);
    expect([...valores].sort()).toEqual([...STATUS_MENSAGEM].sort());
    expect(valores).toContain("falha");
    expect(valores).not.toContain("falhou");
  });
});

describe("o consumidor só grava status que o banco aceita", () => {
  const avisos = chamadas("gravarAviso");
  const filas = chamadas("gravarFila");
  const mensagens = chamadas("gravarMensagem");

  it("encontra as gravações — a trava não pode passar por não achar nada", () => {
    expect(avisos.length).toBeGreaterThanOrEqual(4);
    expect(filas.length).toBeGreaterThanOrEqual(2);
    expect(mensagens.length).toBeGreaterThanOrEqual(2);
    expect(avisos.flatMap(statusEm)).toEqual(
      expect.arrayContaining(["falhou", "enviado", "pendente"]),
    );
  });

  it('notificacoes_fila recebe só valores do CHECK (o defeito era "falha")', () => {
    const check = checkDosAvisos() ?? [];
    const gravados = [
      ...avisos.flatMap(statusEm),
      ...variaveisTipadas("StatusAviso"),
      ...updatesDiretos("notificacoes_fila"),
    ];
    const fora = gravados.filter((s) => !check.includes(s));
    expect(fora, `status fora do CHECK de notificacoes_fila: ${fora.join(", ")}`).toEqual([]);
    expect(gravados).not.toContain("falha");
  });

  it("whatsapp_mensagens recebe só valores do enum", () => {
    const valores = enumDasMensagens();
    const gravados = [
      ...mensagens.flatMap(statusEm),
      ...variaveisTipadas("StatusMensagem"),
      ...updatesDiretos("whatsapp_mensagens"),
    ];
    expect(gravados.length).toBeGreaterThan(0);
    const fora = gravados.filter((s) => !valores.includes(s));
    expect(fora, `status fora do enum whatsapp_mensagem_status: ${fora.join(", ")}`).toEqual([]);
  });

  it("whatsapp_fila_envio recebe só os valores da lista (sem CHECK no banco, a lista é a régua)", () => {
    const gravados = [
      ...filas.flatMap(statusEm),
      ...variaveisTipadas("StatusFila"),
      ...updatesDiretos("whatsapp_fila_envio"),
    ];
    expect(gravados.length).toBeGreaterThan(0);
    const fora = gravados.filter((s) => !(STATUS_FILA as readonly string[]).includes(s));
    expect(fora).toEqual([]);
  });

  it("cada tabela é gravada por UMA função tipada — nenhum update escapa da trava", () => {
    // Um `.from("notificacoes_fila").update({ status: "falha" })` solto no meio
    // do arquivo passaria pelas checagens de cima; esta não deixa.
    for (const tabela of [
      "notificacoes_fila",
      "whatsapp_fila_envio",
      "whatsapp_mensagens",
      "automacao_execucoes",
    ]) {
      const updates = [
        ...fonte.matchAll(new RegExp(`from\\(\\s*"${tabela}"\\s*\\)\\s*\\.update\\(`, "g")),
      ];
      expect(updates.length, `${tabela}: esperava exatamente um .update(`).toBe(1);
    }
    expect(fonte).toMatch(/function gravarAviso\([\s\S]*?status:\s*StatusAviso/);
    expect(fonte).toMatch(/function gravarFila\([\s\S]*?status:\s*StatusFila/);
    expect(fonte).toMatch(/function gravarMensagem\([\s\S]*?status:\s*StatusMensagem/);
    expect(fonte).toMatch(/function gravarExecucao\([\s\S]*?status:\s*StatusExecucao/);
  });

  it("automacao_execucoes recebe só os valores do CHECK (pendente|processando|sucesso|erro)", () => {
    const gravados = [
      ...chamadas("gravarExecucao").flatMap(statusEm),
      ...updatesDiretos("automacao_execucoes"),
    ];
    expect(gravados.length).toBeGreaterThan(0);
    const fora = gravados.filter((s) => !(STATUS_EXECUCAO as readonly string[]).includes(s));
    expect(fora).toEqual([]);
  });
});

describe("três chamadas ao mesmo tempo não mandam a mesma linha duas vezes", () => {
  // O despachante do navegador chama de 2 em 2 minutos de cada aba visível, o
  // do servidor (pg_cron) de 2 em 2 minutos, e a caixa de entrada chama a cada
  // resposta: chamadas simultâneas são o caso normal.
  it("as três filas reservam (pendente → enviando/processando) antes de mandar, e só segue quem reservou", () => {
    for (const [nome, reserva] of [
      ["gravarFila", "enviando"],
      ["gravarAviso", "enviando"],
      ["gravarExecucao", "processando"],
    ] as const) {
      const achada = chamadas(nome).find(
        (c) =>
          new RegExp(`status:\\s*"${reserva}"`).test(c) && /quandoStatus:\s*"pendente"/.test(c),
      );
      expect(achada, `${nome}: falta a reserva condicionada a "pendente"`).toBeDefined();
    }
    expect(fonte.match(/if\s*\(!reservada\)\s*continue/g)?.length).toBe(3);
    // A reserva precisa vir ANTES da chamada ao Z-API, nas três filas.
    const reservas = [...fonte.matchAll(/quandoStatus:\s*"pendente"/g)].map((m) => m.index ?? 0);
    const envios = [...fonte.matchAll(/await chamarZapi\(montado/g)].map((m) => m.index ?? 0);
    expect(envios).toHaveLength(3);
    expect(reservas).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(reservas[i], `fila ${i}`).toBeLessThan(envios[i]);
      if (i > 0) expect(reservas[i], `fila ${i}`).toBeGreaterThan(envios[i - 1]);
    }
  });

  it("a condição da reserva é aplicada no UPDATE (só grava se o status ainda for o esperado)", () => {
    expect(fonte).toMatch(
      /if \(condicao\) consulta = consulta\.eq\("status", condicao\.quandoStatus\)/,
    );
    expect(fonte.match(/consulta\.select\("id"\)/g)?.length).toBe(3);
  });

  it("a varredura das situações roda antes de ler a fila de automações", () => {
    const varredura = fonte.indexOf('"criar_eventos_automacoes_recorrentes"');
    const leitura = fonte.search(
      /\.from\("automacao_execucoes"\)\s*\.select\(\s*"id, automacao_id/,
    );
    expect(varredura).toBeGreaterThan(0);
    expect(leitura).toBeGreaterThan(varredura);
  });

  it("reserva esquecida em 'enviando' volta à fila no começo da rodada", () => {
    const devolver = chamadas("devolverReservasEsquecidas");
    expect(devolver).toHaveLength(1);
    const chamada = fonte.indexOf("await devolverReservasEsquecidas(");
    const leituraDaFila = fonte.search(
      /\.from\("whatsapp_fila_envio"\)\s*\.select\("id, conversa_id/,
    );
    expect(chamada).toBeGreaterThan(0);
    expect(leituraDaFila).toBeGreaterThan(0);
    expect(chamada).toBeLessThan(leituraDaFila);
    const devolucoes = [...chamadas("gravarFila"), ...chamadas("gravarAviso")].filter((c) =>
      /quandoStatus:\s*"enviando"/.test(c),
    );
    expect(devolucoes).toHaveLength(2);
  });

  it("aviso respeita proxima_tentativa_em ao ler e grava a espera na falha que vale repetir", () => {
    expect(fonte).toMatch(/proxima_tentativa_em\.is\.null,proxima_tentativa_em\.lte\./);
    const comEspera = chamadas("gravarAviso").filter((c) => /proxima_tentativa_em:/.test(c));
    expect(comEspera.length).toBeGreaterThanOrEqual(2);
  });
});

describe("o consumidor lê o erro de cada ida ao banco", () => {
  it("toda chamada ao banco desestrutura o error", () => {
    // `consulta` é o UPDATE montado em partes (a reserva acrescenta a
    // condição): a leitura do erro tem de estar no `await` dele também.
    const comandos = fonte.split(";").filter((c) => /await\s+(supabaseAdmin|consulta)\b/.test(c));
    expect(comandos.length).toBeGreaterThanOrEqual(11);
    const cegos = comandos.filter(
      (c) => !/const\s*\{[^}]*\berror\b[^}]*\}\s*=\s*await\s+(supabaseAdmin|consulta)/.test(c),
    );
    expect(
      cegos.map((c) => c.trim().slice(0, 120)),
      "chamada ao banco que descarta o erro — foi assim que o UPDATE recusado sumiu",
    ).toEqual([]);
  });

  it("o erro de gravação vai para o log e para a resposta", () => {
    expect(fonte).toMatch(/console\.error\(\s*"\[whatsapp-enviar\] gravação recusada pelo banco"/);
    expect(fonte).toMatch(/erros_de_gravacao:\s*erros/);
  });
});

describe("o que saiu fica registrado em whatsapp_logs (06/10/2026)", () => {
  it("UM insert em whatsapp_logs, dentro de registrarLog, chamado em toda ida ao Z-API", () => {
    expect(fonte.match(/from\("whatsapp_logs"\)\s*\.insert\(/g)?.length).toBe(1);
    // fila das conversas (rede + resposta), avisos (rede, recusa, sucesso),
    // automações (rede + resposta): no mínimo sete chamadas.
    expect(chamadas("registrarLog").length).toBeGreaterThanOrEqual(7);
  });

  it("o tipo do log é do enum whatsapp_log_tipo — nunca um valor inventado", () => {
    const tipos = chamadas("registrarLog").flatMap((c) =>
      [...c.matchAll(/tipo:\s*([^,\n]+)/g)].flatMap((m) => literais(m[1])),
    );
    expect(tipos.length).toBeGreaterThan(0);
    const enumDoBanco = [
      "envio_texto",
      "envio_imagem",
      "envio_documento",
      "webhook_mensagem",
      "webhook_status",
      "webhook_conexao",
      "erro",
    ];
    expect(tipos.filter((t) => !enumDoBanco.includes(t))).toEqual([]);
    expect(fonte).not.toMatch(/tipo:\s*"automacao"/);
  });

  it("o token nunca vai para o log: a URL montada não entra em registrarLog", () => {
    for (const c of chamadas("registrarLog")) {
      expect(c).not.toMatch(/\burl\b|\btoken\b/);
    }
    // O request guarda telefone, texto final, fila e id da linha.
    expect(fonte).toMatch(
      /request: \{ phone: string; message: string; fila: string; fila_id: string \}/,
    );
  });

  it("o aviso que saiu vira mensagem da conversa, depois do 'enviado' e sem desfazê-lo", () => {
    const enviado = fonte.search(/status:\s*"enviado"/);
    const registro = fonte.indexOf('"whatsapp_registrar_mensagem"');
    expect(enviado).toBeGreaterThan(0);
    expect(registro).toBeGreaterThan(enviado);
    const chamada = fonte.slice(registro, registro + 600);
    expect(chamada).toMatch(/p_direcao:\s*"saida"/);
    expect(chamada).toMatch(/p_texto:\s*textoDoAviso/);
    // A falha do registro vai para erros_de_gravacao, não para um novo status.
    expect(fonte).toMatch(/o aviso saiu, mas não ficou na conversa/);
  });
});

describe("a porta lateral da fila está fechada no consumidor", () => {
  it("o destino é o telefone da conversa; payload.para não é lido", () => {
    expect(fonte).not.toMatch(/p\.para\b/);
    expect(fonte).toMatch(/para:\s*telefoneDaConversa/);
  });

  it("linha sem conversa ou sem autor é falha definitiva, com o motivo — só a IA (chave 'ia:') passa sem autor", () => {
    // `whatsapp_ia_enviar` (caixa v3, SECURITY DEFINER, só service_role)
    // enfileira sem created_by. Sem esta exceção, ligar a assistente faria
    // toda resposta dela virar "pedido de fora".
    expect(fonte).toMatch(/const daIa = \(linha\.idempotency_key \?\? ""\)\.startsWith\("ia:"\)/);
    expect(fonte).toMatch(/if \(!linha\.conversa_id \|\| \(!linha\.created_by && !daIa\)\)/);
    expect(fonte).toMatch(/sem conversa ou sem autor/);
    expect(fonte).toMatch(
      /\.select\("id, conversa_id, mensagem_id, payload, tentativas, created_by, idempotency_key"\)/,
    );
  });
});
