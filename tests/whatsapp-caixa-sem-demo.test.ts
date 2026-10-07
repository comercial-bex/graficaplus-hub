import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A caixa de entrada não volta a ser demonstração.
 *
 * Até 02/10/2026, /whatsapp mostrava conversas fixas no código ("Marcos
 * Silva", "Padaria Aurora"), mensagens fixas (mensagensMock) e sete botões
 * sem ação — e estava no menu como o atendimento de verdade. Esta trava lê os
 * arquivos da tela e acusa:
 *   - dado de demonstração de volta;
 *   - botão sem ação (sem onClick, sem submit, sem asChild de link, nem
 *     desabilitado de propósito);
 *   - coluna pedida ao banco que não existe (o select inteiro cairia).
 */

const ROTA = "src/routes/_authenticated/whatsapp.tsx";
const COMPONENTES = "src/components/whatsapp";
const CONSULTAS = `${COMPONENTES}/usar-caixa-de-entrada.ts`;

const arquivosDaTela = [
  ROTA,
  "src/routes/_authenticated/respostas-rapidas.tsx",
  ...readdirSync(COMPONENTES)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(COMPONENTES, f)),
];

describe("nada de demonstração", () => {
  it("a rota não carrega conversas nem mensagens fixas", () => {
    const rota = readFileSync(ROTA, "utf8");
    for (const proibido of [
      "Marcos Silva",
      "Padaria Aurora",
      "mensagensMock",
      "conversasWhatsappSeed",
      "OS-1042",
    ]) {
      expect(rota, proibido).not.toContain(proibido);
    }
  });

  it("a caixa lê o que o webhook grava, e as respostas rápidas", () => {
    const consultas = readFileSync(CONSULTAS, "utf8");
    for (const tabela of [
      "whatsapp_conversas",
      "whatsapp_mensagens",
      "whatsapp_instancias",
      "respostas_rapidas",
    ]) {
      expect(consultas, tabela).toContain(`from("${tabela}")`);
    }
    expect(consultas).toContain('"whatsapp_responder"');
    expect(consultas).toContain('"/api/whatsapp/enviar"');
  });
});

/**
 * As aberturas de `<Button ...>`, lendo até o `>` fora de chaves e de aspas,
 * com o trecho logo antes (para reconhecer o botão dentro de um Trigger).
 */
function aberturasDeBotao(fonte: string): { abertura: string; antes: string }[] {
  const saida: { abertura: string; antes: string }[] = [];
  let i = fonte.indexOf("<Button");
  while (i >= 0) {
    let fundo = 0;
    let aspas: string | null = null;
    let j = i + "<Button".length;
    for (; j < fonte.length; j++) {
      const c = fonte[j];
      if (aspas) {
        if (c === aspas) aspas = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") aspas = c;
      else if (c === "{") fundo++;
      else if (c === "}") fundo--;
      else if (c === ">" && fundo === 0) break;
    }
    saida.push({ abertura: fonte.slice(i, j + 1), antes: fonte.slice(Math.max(0, i - 120), i) });
    i = fonte.indexOf("<Button", j);
  }
  return saida;
}

/**
 * Age quem tem onClick, é submit, é link (asChild), está dentro de um
 * `...Trigger asChild` (o Radix passa o clique) ou é desabilitado DE PROPÓSITO
 * (`disabled` sem valor: o botão que diz "WhatsApp desconectado — …").
 * `disabled={x}` sozinho não conta: sem ação, ele só desabilita o nada.
 */
function botaoAge({ abertura, antes }: { abertura: string; antes: string }): boolean {
  return (
    /\bonClick=|type="submit"|\basChild\b|\bdisabled(?![=\w])/.test(abertura) ||
    /Trigger asChild>\s*$/.test(antes)
  );
}

describe("nenhum botão sem ação", () => {
  it("o extrator acha os botões — a trava não passa por não achar nada", () => {
    const total = arquivosDaTela.flatMap((f) => aberturasDeBotao(readFileSync(f, "utf8"))).length;
    expect(total).toBeGreaterThan(15);
    expect(
      aberturasDeBotao('<Button onClick={() => a > b} size="sm">x</Button>').map((b) => b.abertura),
    ).toEqual(['<Button onClick={() => a > b} size="sm">']);
  });

  it("reconhece o botão mudo da tela antiga e o que age", () => {
    expect(
      botaoAge({ abertura: '<Button size="icon" className="bg-emerald-600">', antes: "" }),
    ).toBe(false);
    expect(botaoAge({ abertura: "<Button disabled={gravando}>", antes: "" })).toBe(false);
    expect(botaoAge({ abertura: '<Button disabled className="w-full">', antes: "" })).toBe(true);
    expect(
      botaoAge({ abertura: '<Button variant="outline">', antes: "<PopoverTrigger asChild>\n  " }),
    ).toBe(true);
  });

  it("todo <Button> faz alguma coisa ou diz que está desabilitado", () => {
    const mudos: string[] = [];
    for (const arquivo of arquivosDaTela) {
      for (const b of aberturasDeBotao(readFileSync(arquivo, "utf8"))) {
        if (!botaoAge(b))
          mudos.push(`${arquivo}: ${b.abertura.replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
    expect(mudos, "botão sem ação — foi assim que a tela antiga tinha sete").toEqual([]);
  });
});

/**
 * Colunas conferidas em information_schema.columns em 02/10/2026. Mudou o
 * banco? Atualize aqui junto com a migração — o teste aponta o select que
 * ficou para trás.
 */
const COLUNAS: Record<string, string[]> = {
  whatsapp_conversas: [
    "id",
    "instancia_id",
    "telefone",
    "nome_contato",
    "cliente_id",
    "lead_id",
    "os_id",
    "status",
    "etiquetas",
    "ultima_mensagem",
    "ultima_mensagem_at",
    "nao_lidas",
    "atribuido_para",
    "metadados",
    "created_at",
    "updated_at",
    "responsavel_id",
    "unread_count",
    "telefone_normalizado",
    // Caixa v3 (drizzle/0002), conferidas em information_schema em 07/10/2026.
    "fila",
    "modo",
    "aguardando_desde",
    "atendimento_ativo_id",
  ],
  whatsapp_mensagens: [
    "id",
    "conversa_id",
    "instancia_id",
    "zapi_message_id",
    "direcao",
    "tipo",
    "status",
    "texto",
    "legenda",
    "media_url",
    "storage_bucket",
    "storage_path",
    "arquivo_id",
    "cliente_id",
    "os_id",
    "payload",
    "erro",
    "enviada_por",
    "origem",
    "recebido_em",
    "enviado_em",
    "entregue_em",
    "lido_em",
    "created_at",
    "updated_at",
  ],
  clientes: ["id", "nome"],
  leads: ["id", "nome", "status"],
};

/** "a, b, rel:tabela!fk(c, d)" → colunas da base e de cada embed. */
function colunasDoSelect(select: string): { tabela: string | null; colunas: string[] }[] {
  const embeds: { tabela: string | null; colunas: string[] }[] = [];
  const base = select.replace(
    /(\w+):(\w+)(?:!\w+)?\(([^)]*)\)/g,
    (_, _apelido, tabela: string, cols: string) => {
      embeds.push({
        tabela,
        colunas: cols
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      });
      return "";
    },
  );
  return [
    {
      tabela: null,
      colunas: base
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    },
    ...embeds,
  ];
}

function constante(fonte: string, nome: string): string {
  const m = fonte.match(new RegExp(`export const ${nome} =([\\s\\S]*?);`));
  expect(m, `constante ${nome} não encontrada`).not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
}

describe("os selects da caixa só pedem colunas que existem", () => {
  const fonte = readFileSync(CONSULTAS, "utf8");

  it("conversas, com cliente e lead pelo nome da chave", () => {
    const partes = colunasDoSelect(constante(fonte, "SELECT_CONVERSAS"));
    const [base, ...embeds] = partes;
    expect(base.colunas.filter((c) => !COLUNAS.whatsapp_conversas.includes(c))).toEqual([]);
    // `leads` tem duas ligações com whatsapp_conversas: sem o nome da chave o
    // PostgREST recusa o select inteiro (PGRST201).
    expect(constante(fonte, "SELECT_CONVERSAS")).toContain(
      "leads!whatsapp_conversas_lead_id_fkey(",
    );
    for (const e of embeds) {
      expect(
        e.colunas.filter((c) => !(COLUNAS[e.tabela ?? ""] ?? []).includes(c)),
        e.tabela ?? "",
      ).toEqual([]);
    }
    // `nao_lidas` é a que o webhook incrementa; `unread_count` nunca é escrita.
    expect(base.colunas).toContain("nao_lidas");
    expect(base.colunas).not.toContain("unread_count");
  });

  it("mensagens", () => {
    const [base] = colunasDoSelect(constante(fonte, "SELECT_MENSAGENS"));
    expect(base.colunas.filter((c) => !COLUNAS.whatsapp_mensagens.includes(c))).toEqual([]);
  });

  it("instâncias: nunca o hash do segredo (grant por coluna derrubaria o select)", () => {
    const m = fonte.match(/from\("whatsapp_instancias"\)\s*\.select\("([^"]+)"\)/);
    expect(m).not.toBeNull();
    expect(m?.[1]).not.toContain("webhook_secret_hash");
    expect(m?.[1]).not.toContain("*");
  });
});
