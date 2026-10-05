import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rolePermissions } from "../src/lib/permissions";

/**
 * VER O FINANCEIRO NÃO É LANÇAR.
 *
 * Decisão do dono em 03/10/2026: o gestor vê o financeiro como o financeiro
 * vê, mas não lança, não dá baixa e não estorna. Até 05/10 o banco não
 * cumpria isso: a regra de acesso das tabelas de dinheiro era uma policy ALL
 * aberta pela chave de LEITURA (financeiro.read), e a tela mostrava Pagar,
 * Movimento, Conta a pagar e Registrar pagamento a quem só via. Ensaiado com a
 * conta do Yvens: ele lançava e dava baixa em tudo.
 *
 * A migração 20261005100000 acrescentou regras RESTRICTIVE (somam por E com as
 * de hoje) e trocou o PAPEL pela CHAVE nas 4 funções de compromisso. Este teste
 * segura as duas pontas:
 *   - a migração (o retrato do que está vivo; md5 dos corpos conferido contra
 *     pg_proc depois de aplicada) continua tendo as regras e as guardas;
 *   - toda gravação de dinheiro feita pela tela confere a mesma chave que o
 *     banco cobra, e os botões de lançar e dar baixa ficam atrás dela.
 *
 * Não substitui o ensaio no banco (claims + SET LOCAL ROLE, antes e depois, 7
 * contas), que provou o comportamento. Este segura o que o repositório pode
 * vir a mudar: um botão novo de "Pagar" sem chave, ou a regra perdida numa
 * migração refeita.
 */

const RAIZ = join(__dirname, "..");
const MIGRACAO = join(RAIZ, "supabase/migrations/20261005100000_financeiro_ver_nao_e_lancar.sql");
const sql = readFileSync(MIGRACAO, "utf8");

const DINHEIRO = [
  "pagamentos",
  "contas_receber",
  "parcelas_receber",
  "contas_pagar",
  "caixa_movimentos",
  "contas_bancarias",
  "banco_transacoes",
  "compromissos_financeiros",
] as const;

const ESPELHOS = [
  "produto_precos",
  "orcamento_custos",
  "orcamento_item_custos",
  "item_os_custos",
  "material_custos",
  "os_resultados_financeiros",
] as const;

type Politica = {
  nome: string;
  esquema: string;
  tabela: string;
  tipo: string;
  comando: string;
  papel: string;
  regra: string;
};

/** As policies que a migração cria, lidas do texto. */
function politicasDaMigracao(): Politica[] {
  const re =
    /CREATE POLICY "([^"]+)" ON (\w+)\.(\w+)\s+AS (\w+) FOR (\w+) TO (\w+)([\s\S]*?);\s*\n\s*END IF;/g;
  return [...sql.matchAll(re)].map((m) => ({
    nome: m[1],
    esquema: m[2],
    tabela: m[3],
    tipo: m[4],
    comando: m[5],
    papel: m[6],
    regra: m[7],
  }));
}

function politica(tabela: string, comando: string, esquema = "public"): Politica {
  const achadas = politicasDaMigracao().filter(
    (p) => p.esquema === esquema && p.tabela === tabela && p.comando === comando,
  );
  expect(achadas, `${esquema}.${tabela} ${comando}`).toHaveLength(1);
  return achadas[0];
}

/** Corpo de cada função, entre os $function$ — o mesmo texto que vira prosrc. */
function corpos(): Map<string, string> {
  const re =
    /CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g;
  return new Map([...sql.matchAll(re)].map((m) => [m[1], m[2]]));
}

const ADMIN = "public.has_role((select auth.uid()), 'admin'::public.app_role)";
const chave = (k: string) => `public.has_permission((select auth.uid()), '${k}')`;

describe("migração: ver o financeiro não abre escrita", () => {
  it("cada tabela de dinheiro pede a chave de pagamento para lançar, corrigir e apagar", () => {
    for (const t of DINHEIRO) {
      const lancar = politica(t, "INSERT");
      const corrigir = politica(t, "UPDATE");
      const apagar = politica(t, "DELETE");
      for (const p of [lancar, corrigir, apagar]) {
        expect(p.tipo, `${t} ${p.comando}`).toBe("RESTRICTIVE");
        expect(p.papel, `${t} ${p.comando}`).toBe("authenticated");
        // O admin passa sempre; e a chave de LEITURA não pode reabrir a escrita.
        expect(p.regra, `${t} ${p.comando}`).toContain(ADMIN);
        expect(p.regra, `${t} ${p.comando}`).not.toMatch(/financeiro\.read|can_see_financials/);
      }
      expect(lancar.regra, `${t} INSERT`).toContain(chave("pagamentos.create"));
      expect(lancar.regra).toMatch(/^\s*WITH CHECK/);
      expect(corrigir.regra, `${t} UPDATE`).toContain(chave("pagamentos.update"));
      expect(corrigir.regra, `${t} UPDATE`).toContain(chave("pagamentos.confirm"));
      expect(corrigir.regra, `${t} UPDATE: USING e WITH CHECK`).toMatch(/USING[\s\S]*WITH CHECK/);
      expect(apagar.regra, `${t} DELETE`).toContain(chave("pagamentos.reverse"));
    }
    // Cadastrar conta bancária também vale para quem corrige lançamento.
    expect(politica("contas_bancarias", "INSERT").regra).toContain(chave("pagamentos.update"));
  });

  it("nenhuma regra nova mexe na leitura", () => {
    const comandos = new Set(politicasDaMigracao().map((p) => p.comando));
    expect([...comandos].sort()).toEqual(["DELETE", "INSERT", "UPDATE"]);
    expect(politicasDaMigracao().every((p) => p.tipo === "RESTRICTIVE")).toBe(true);
  });

  it("os espelhos de custo só são gravados pelo gatilho", () => {
    for (const t of ESPELHOS) {
      for (const comando of ["INSERT", "UPDATE", "DELETE"]) {
        const p = politica(t, comando);
        expect(p.tipo).toBe("RESTRICTIVE");
        expect(p.regra.replace(/\s+/g, " ").trim(), `${t} ${comando}`).toMatch(
          /^(USING \(false\)( WITH CHECK \(false\))?|WITH CHECK \(false\))$/,
        );
      }
    }
  });

  it("mão de obra pede custos.update; evento só em nome próprio", () => {
    for (const comando of ["INSERT", "UPDATE", "DELETE"]) {
      const p = politica("custos_mao_de_obra", comando);
      expect(p.regra).toContain(chave("custos.update"));
      expect(p.regra).toContain(ADMIN);
    }
    const evento = politica("eventos_negocio", "INSERT");
    expect(evento.regra).toContain("usuario_id = (select auth.uid())");
    expect(evento.regra).not.toContain("logs.read");
  });

  it("comprovante no Storage: chave de pagamento ou o cliente do portal na própria pasta", () => {
    const p = politica("objects", "INSERT", "storage");
    expect(p.tipo).toBe("RESTRICTIVE");
    expect(p.regra).toContain("IS DISTINCT FROM 'comprovantes' THEN true");
    for (const k of ["pagamentos.create", "pagamentos.update", "pagamentos.confirm"]) {
      expect(p.regra).toContain(`'${k}'`);
    }
    expect(p.regra).toContain("portal_pode_enviar_objeto(bucket_id, name)");
    expect(p.regra).not.toMatch(/can_see_financials|financeiro\.read/);
  });

  it("as funções de compromisso pedem a chave, não o papel", () => {
    const esperado: Record<string, string[]> = {
      gerar_parcelas_compromisso: ["pagamentos.create"],
      baixar_parcela_compromisso: ["pagamentos.confirm"],
      quitar_parcelas_ate: ["pagamentos.confirm"],
      anexar_comprovante_parcela: ["pagamentos.update", "pagamentos.confirm"],
    };
    const c = corpos();
    expect([...c.keys()].sort()).toEqual(Object.keys(esperado).sort());
    for (const [fn, chaves] of Object.entries(esperado)) {
      const corpo = c.get(fn)!;
      expect(corpo, fn).toContain("public.has_role(auth.uid(),'admin')");
      expect(corpo, fn).not.toMatch(/has_role\(auth\.uid\(\),\s*'(gestor|financeiro)'\)/);
      for (const k of chaves) {
        expect(corpo, `${fn} → ${k}`).toContain(`public.has_permission(auth.uid(),'${k}')`);
      }
    }
  });

  it("o corpo das funções no repositório é o que está no banco (md5 do retrato)", () => {
    // O cabeçalho anota o md5(prosrc) medido em pg_proc depois de aplicada.
    // Mudou o corpo aqui? Então mudou no banco também — e o md5 anotado junto.
    const anotados = new Map(
      [...sql.matchAll(/^--\s+(\w+)\s+([0-9a-f]{32})$/gm)].map((m) => [m[1], m[2]]),
    );
    for (const [fn, corpo] of corpos()) {
      const md5 = createHash("md5").update(corpo, "utf8").digest("hex");
      expect(md5, fn).toBe(anotados.get(fn));
    }
  });

  it("EXECUTE fora de PUBLIC e anon; a tela logada continua chamando", () => {
    for (const assinatura of [
      "anexar_comprovante_parcela(uuid, text)",
      "baixar_parcela_compromisso(uuid, date, text, text, boolean)",
      "gerar_parcelas_compromisso(uuid, date)",
      "quitar_parcelas_ate(uuid, date)",
      "conciliar_transacao(uuid, uuid)",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${assinatura} FROM PUBLIC, anon;`);
      expect(sql).toContain(
        `GRANT EXECUTE ON FUNCTION public.${assinatura} TO authenticated, service_role;`,
      );
    }
  });

  it("a migração só acrescenta: nada é apagado, alterado nem regravado fora das funções", () => {
    // Comentário sai antes: o cabeçalho cita "$function$" e desalinharia os pares.
    const semFuncoes = sql.replace(/--.*$/gm, "").replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(semFuncoes).not.toMatch(/\bDROP\b/i);
    expect(semFuncoes).not.toMatch(/ALTER\s+(POLICY|TABLE)/i);
    expect(semFuncoes).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(semFuncoes).not.toMatch(/\bUPDATE\s+\w+\.?\w*\s+SET\b/i);
  });
});

/* -------------------------------------------------------------------------- */
/* A tela                                                                      */
/* -------------------------------------------------------------------------- */

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

/** O que o banco cobra de cada gravação — basta a tela conferir uma delas. */
const COBRA: Record<string, string[]> = {
  insert: ["pagamentos.create"],
  upsert: ["pagamentos.create"],
  update: ["pagamentos.update", "pagamentos.confirm"],
  delete: ["pagamentos.reverse"],
};
const COBRA_RPC: Record<string, string[]> = {
  gerar_parcelas_compromisso: ["pagamentos.create"],
  baixar_parcela_compromisso: ["pagamentos.confirm"],
  quitar_parcelas_ate: ["pagamentos.confirm"],
  anexar_comprovante_parcela: ["pagamentos.update", "pagamentos.confirm"],
  confirmar_pagamento: ["pagamentos.confirm"],
  confirmar_pagamento_registrado: ["pagamentos.confirm"],
  estornar_pagamento: ["pagamentos.reverse"],
  importar_extrato: ["pagamentos.confirm"],
  conciliar_transacao: ["pagamentos.confirm"],
  comissoes_pagar: ["pagamentos.confirm"],
  portal_conferir_comprovante: ["pagamentos.confirm"],
};

type Gravacao = { arquivo: string; alvo: string; chaves: string[] };

function gravacoesDeDinheiro(): Gravacao[] {
  const achadas: Gravacao[] = [];
  for (const caminho of arquivos(join(RAIZ, "src"))) {
    if (caminho.includes("integrations/supabase/types")) continue;
    const src = readFileSync(caminho, "utf8");
    const arquivo = caminho.slice(RAIZ.length + 1);
    for (const t of [...DINHEIRO, "custos_mao_de_obra"]) {
      const re = new RegExp(
        `\\.from\\(\\s*["'\`]${t}["'\`](?:\\s+as\\s+\\w+)?\\s*\\)\\s*\\.(insert|upsert|update|delete)\\(`,
        "g",
      );
      for (const m of src.matchAll(re)) {
        const op = m[1];
        let chaves = t === "custos_mao_de_obra" ? ["custos.update"] : COBRA[op];
        if (t === "contas_bancarias" && op === "insert") {
          chaves = ["pagamentos.create", "pagamentos.update"];
        }
        achadas.push({ arquivo, alvo: `${t}.${op}`, chaves });
      }
    }
    for (const [fn, chaves] of Object.entries(COBRA_RPC)) {
      if (new RegExp(`["'\`]${fn}["'\`]`).test(src) && /\.rpc\b|\brpc\(/.test(src)) {
        achadas.push({ arquivo, alvo: `rpc ${fn}`, chaves });
      }
    }
    if (/\.from\(\s*["']comprovantes["']\s*\)\s*\.upload\(/.test(src)) {
      achadas.push({
        arquivo,
        alvo: "upload comprovantes",
        chaves: ["pagamentos.create", "pagamentos.update", "pagamentos.confirm"],
      });
    }
  }
  return achadas;
}

describe("tela: quem grava dinheiro confere a mesma chave que o banco", () => {
  it("acha as gravações que existem hoje (o detector não está cego)", () => {
    const alvos = new Set(gravacoesDeDinheiro().map((g) => `${g.arquivo} ${g.alvo}`));
    for (const esperado of [
      "src/routes/_authenticated/fluxo-caixa.tsx contas_pagar.insert",
      "src/routes/_authenticated/fluxo-caixa.tsx contas_pagar.update",
      "src/routes/_authenticated/fluxo-caixa.tsx caixa_movimentos.insert",
      "src/routes/_authenticated/financeiro.tsx pagamentos.insert",
      "src/routes/_authenticated/contas-bancarias.tsx contas_bancarias.insert",
      "src/routes/_authenticated/compromissos.tsx compromissos_financeiros.insert",
      "src/routes/_authenticated/compromissos.tsx upload comprovantes",
      "src/routes/_authenticated/os.$id.tsx pagamentos.insert",
      "src/routes/_authenticated/custos-producao.tsx custos_mao_de_obra.update",
      "src/routes/_authenticated/planilha-custos.tsx custos_mao_de_obra.update",
    ]) {
      expect(alvos, esperado).toContain(esperado);
    }
  });

  it("cada arquivo que grava confere ao menos uma das chaves exigidas", () => {
    const sem = gravacoesDeDinheiro().filter(({ arquivo, chaves }) => {
      const src = readFileSync(join(RAIZ, arquivo), "utf8");
      return !chaves.some((k) => src.includes(`hasPermission("${k}")`));
    });
    expect(sem.map((g) => `${g.arquivo} → ${g.alvo} (pede ${g.chaves.join(" ou ")})`)).toEqual([]);
  });
});

/**
 * O gatilho está DENTRO do bloco que a guarda abre: `{podeX && ( ... )}` ou
 * `podeX ? ( ... )`. Conta os parênteses do "(" da guarda até o gatilho (o que
 * está entre aspas não conta); se o bloco fecha antes, a guarda é de outro
 * botão. Uma janela de caracteres não serve: aceitaria a guarda do vizinho.
 */
function dentroDaGuarda(src: string, gatilho: number, guarda: string): boolean {
  for (let i = src.lastIndexOf(guarda, gatilho); i >= 0; i = src.lastIndexOf(guarda, i - 1)) {
    // Entre a guarda e o "(" do bloco cabe o resto da condição
    // (`podeDarBaixa && c.parcelas_atrasadas > 0 && (`), nunca outro bloco.
    const abre = src.indexOf("(", i + guarda.length);
    if (abre < 0 || abre > gatilho || !/^[^(){};]*$/.test(src.slice(i + guarda.length, abre)))
      continue;
    let profundidade = 0;
    let aspas: string | null = null;
    let fechou = false;
    for (let k = abre; k < gatilho; k++) {
      const ch = src[k];
      if (aspas) {
        if (ch === aspas && src[k - 1] !== "\\") aspas = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") aspas = ch;
      else if (ch === "(") profundidade++;
      else if (ch === ")" && --profundidade === 0) {
        fechou = true;
        break;
      }
    }
    if (!fechou) return true;
    if (i === 0) break;
  }
  return false;
}

/** Quantas ocorrências do gatilho estão fora da guarda (0 = todas guardadas). */
function semGuarda(arquivo: string, gatilho: string, guarda: string): number {
  const src = readFileSync(join(RAIZ, arquivo), "utf8");
  let faltam = 0;
  let achou = 0;
  for (let i = src.indexOf(gatilho); i >= 0; i = src.indexOf(gatilho, i + gatilho.length)) {
    achou++;
    if (!dentroDaGuarda(src, i, guarda)) faltam++;
  }
  expect(achou, `${arquivo}: "${gatilho}" não foi achado`).toBeGreaterThan(0);
  return faltam;
}

describe("tela: os botões de lançar e dar baixa ficam atrás da chave", () => {
  const casos: [string, string, string][] = [
    // /fluxo-caixa
    ["src/routes/_authenticated/fluxo-caixa.tsx", "setMovOpen(true)", "podeLancar &&"],
    ["src/routes/_authenticated/fluxo-caixa.tsx", "setContaOpen(true)", "podeLancar &&"],
    ["src/routes/_authenticated/fluxo-caixa.tsx", "pagar.mutate(", "podeDarBaixa &&"],
    // /financeiro
    ["src/routes/_authenticated/financeiro.tsx", "<DialogTrigger", "podeLancar &&"],
    ["src/routes/_authenticated/financeiro.tsx", "marcarPago(p)", "podeDarBaixa &&"],
    ["src/routes/_authenticated/financeiro.tsx", "setEstorno(p)", "podeEstornar &&"],
    // /contas-bancarias
    [
      "src/routes/_authenticated/contas-bancarias.tsx",
      "setContaOpen(true)",
      "podeCadastrarConta &&",
    ],
    ["src/routes/_authenticated/contas-bancarias.tsx", "setImportOpen(true)", "podeImportar &&"],
    // /compromissos
    ["src/routes/_authenticated/compromissos.tsx", "setAberto(true)", "podeLancar &&"],
    ["src/routes/_authenticated/compromissos.tsx", "gerar.mutate(", "podeLancar &&"],
    ["src/routes/_authenticated/compromissos.tsx", "quitar.mutate(", "podeDarBaixa &&"],
    ["src/routes/_authenticated/compromissos.tsx", "setBaixa(p)", "podeDarBaixa ?"],
    ["src/routes/_authenticated/compromissos.tsx", "anexar.mutate(", "podeAnexar ?"],
    // /os/$id, aba Financeiro
    ["src/routes/_authenticated/os.$id.tsx", "onClick={addPag}", "podeLancar ?"],
    ["src/routes/_authenticated/os.$id.tsx", "marcarPago(p.id)", "podeDarBaixa &&"],
    // mão de obra
    ["src/routes/_authenticated/custos-producao.tsx", "setOpen(true)", "podeMudarCusto &&"],
    [
      "src/routes/_authenticated/custos-producao.tsx",
      "aplicarEncargos.mutate(",
      "podeMudarCusto &&",
    ],
    [
      "src/routes/_authenticated/planilha-custos.tsx",
      "salvarMaoObra.mutate(",
      "podeEditarMaoDeObra ?",
    ],
    [
      "src/routes/_authenticated/planilha-custos.tsx",
      'importar(f, "mao_de_obra")',
      "podeEditarMaoDeObra &&",
    ],
  ];

  it.each(casos)("%s: %s atrás de %s", (arquivo, gatilho, guarda) => {
    expect(semGuarda(arquivo, gatilho, guarda)).toBe(0);
  });

  it("cada guarda é a chave de pagamento, não ver o financeiro", () => {
    const definicoes: [string, RegExp][] = [
      [
        "src/routes/_authenticated/fluxo-caixa.tsx",
        /podeLancar = hasPermission\("pagamentos\.create"\)/,
      ],
      [
        "src/routes/_authenticated/fluxo-caixa.tsx",
        /podeDarBaixa = podeLancar && hasPermission\("pagamentos\.confirm"\)/,
      ],
      [
        "src/routes/_authenticated/financeiro.tsx",
        /podeLancar = hasPermission\("pagamentos\.create"\)/,
      ],
      [
        "src/routes/_authenticated/financeiro.tsx",
        /podeDarBaixa = hasPermission\("pagamentos\.confirm"\)/,
      ],
      [
        "src/routes/_authenticated/contas-bancarias.tsx",
        /podeCadastrarConta =\s*hasPermission\("pagamentos\.create"\) \|\| hasPermission\("pagamentos\.update"\)/,
      ],
      [
        "src/routes/_authenticated/contas-bancarias.tsx",
        /podeImportar = hasPermission\("pagamentos\.confirm"\)/,
      ],
      [
        "src/routes/_authenticated/compromissos.tsx",
        /podeLancar = hasPermission\("pagamentos\.create"\)/,
      ],
      [
        "src/routes/_authenticated/compromissos.tsx",
        /podeDarBaixa = hasPermission\("pagamentos\.confirm"\)/,
      ],
      [
        "src/routes/_authenticated/compromissos.tsx",
        /podeAnexar = hasPermission\("pagamentos\.update"\) \|\| podeDarBaixa/,
      ],
      [
        "src/routes/_authenticated/os.$id.tsx",
        /podeLancar = hasPermission\("pagamentos\.create"\)/,
      ],
      [
        "src/routes/_authenticated/os.$id.tsx",
        /podeDarBaixa = hasPermission\("pagamentos\.confirm"\)/,
      ],
      [
        "src/routes/_authenticated/custos-producao.tsx",
        /podeMudarCusto = hasPermission\("custos\.update"\)/,
      ],
      [
        "src/routes/_authenticated/planilha-custos.tsx",
        /podeEditarMaoDeObra = hasPermission\("custos\.update"\)/,
      ],
    ];
    const faltam = definicoes.filter(
      ([arquivo, re]) => !re.test(readFileSync(join(RAIZ, arquivo), "utf8")),
    );
    expect(faltam.map(([a, re]) => `${a}: ${re}`)).toEqual([]);
  });

  it("quem só vê enxerga a frase, não um botão que daria erro", () => {
    for (const arquivo of [
      "src/routes/_authenticated/fluxo-caixa.tsx",
      "src/routes/_authenticated/financeiro.tsx",
      "src/routes/_authenticated/contas-bancarias.tsx",
      "src/routes/_authenticated/compromissos.tsx",
      "src/routes/_authenticated/os.$id.tsx",
    ]) {
      expect(readFileSync(join(RAIZ, arquivo), "utf8"), arquivo).toContain(
        "Lançar e dar baixa é com o financeiro.",
      );
    }
  });
});

describe("reserva estática do gestor = banco", () => {
  // perfil_permissoes em 05/10/2026: 69 chaves para o gestor. A reserva só vale
  // quando a matriz não carrega, mas não pode prometer o que o banco nega.
  it("69 chaves, vê o financeiro e não tem nenhuma de pagamento", () => {
    const gestor = rolePermissions.gestor as readonly string[];
    expect(gestor).toHaveLength(69);
    expect(new Set(gestor).size).toBe(69);
    expect(gestor).toContain("financeiro.read");
    expect(gestor).toContain("financeiro.sensitive.read");
    expect(gestor.filter((p) => p.startsWith("pagamentos."))).toEqual([]);
  });

  it("o financeiro tem as 4 chaves de pagamento", () => {
    const fin = rolePermissions.financeiro as readonly string[];
    for (const k of [
      "pagamentos.create",
      "pagamentos.update",
      "pagamentos.confirm",
      "pagamentos.reverse",
    ]) {
      expect(fin).toContain(k);
    }
  });
});
