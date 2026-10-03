import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORMATO_DO_CAMINHO,
  TAMANHO_MAXIMO_BYTES,
  TIPOS_DE_ENVIO,
  TIPOS_DE_MENSAGEM,
  bucketDoEnvio,
  caminhoDoEnvio,
  nomeSeguro,
  problemaNaMensagem,
  problemaNoEnvio,
} from "../src/domain/portal/envio-de-arquivo";

/**
 * O caminho do arquivo que o cliente manda.
 *
 * A pasta é conferida em TRÊS lugares: o navegador (ou a rota de servidor)
 * monta, a policy de storage.objects deixa subir e a função do banco aceita
 * registrar. Se o nome que o navegador monta não passar no regex do banco, o
 * arquivo sobe e o registro recusa — o cliente vê erro com o arquivo já no
 * Storage. Este teste amarra os três ao mesmo formato.
 */

const RAIZ = resolve(__dirname, "..");
const SQL = readFileSync(
  join(RAIZ, "supabase/migrations/20261002101001_portal_do_cliente.sql"),
  "utf8",
);

const CLIENTE = "204f09f6-2249-4454-938b-c938ac5cb530";
const OS = "135e06e7-94ec-4e22-bf4f-67935eb8d6f5";
const AGORA = new Date("2026-10-02T15:00:00Z");

describe("nome seguro para o Storage", () => {
  it.each([
    ["Cartão São João (final).PDF", "Cartao-Sao-Joao-final.pdf"],
    ["banner 3x1 – versão 2.png", "banner-3x1-versao-2.png"],
    ["  arte .jpg", "arte.jpg"],
    [".htaccess", "htaccess"],
    ["arquivo.", "arquivo"],
    ["@@@.cdr", "arquivo.cdr"],
    ["", "arquivo"],
    ["logo_FINAL.v2.ai", "logo_FINAL.v2.ai"],
  ])("%s → %s", (entrada, saida) => {
    expect(nomeSeguro(entrada)).toBe(saida);
  });

  it("nome enorme é cortado sem perder a extensão", () => {
    const n = nomeSeguro(`${"a".repeat(300)}.pdf`);
    expect(n.endsWith(".pdf")).toBe(true);
    expect(n.length).toBeLessThanOrEqual(111);
  });

  it("qualquer nome vira chave que o banco aceita", () => {
    const amostras = [
      "Ação & Reação #1.pdf",
      "😀 emoji.png",
      "中文.jpg",
      "a/b\\c.png",
      "..",
      "x".repeat(500),
      "árvore.JPEG",
      "sem extensão",
      "ponto.final.",
    ];
    for (const nome of amostras) {
      const caminho = caminhoDoEnvio({ clienteId: CLIENTE, osId: OS, nome, agora: AGORA });
      expect(caminho, nome).toMatch(FORMATO_DO_CAMINHO);
      expect(caminho.startsWith(`portal/${CLIENTE}/${OS}/${AGORA.getTime()}-`)).toBe(true);
    }
  });

  it("comprovante sem pedido vai para a pasta sem-os", () => {
    const c = caminhoDoEnvio({ clienteId: CLIENTE, osId: null, nome: "pix.jpg", agora: AGORA });
    expect(c).toBe(`portal/${CLIENTE}/sem-os/${AGORA.getTime()}-pix.jpg`);
    expect(c).toMatch(FORMATO_DO_CAMINHO);
  });
});

describe("o mesmo formato nos três lugares", () => {
  it("o regex do navegador é o do banco (registro) e o da policy (Storage)", () => {
    // Só os regex do caminho inteiro (terminam em $); o de prefixo da leitura fica fora.
    const regexDoBanco = [...SQL.matchAll(/'(\^portal\/\(?\[0-9a-f-\]\{36\}\)?\/[^']*\$)'/g)].map(
      (m) => m[1],
    );
    // portal_gravar_envio e portal_pode_enviar_objeto
    expect(regexDoBanco.length).toBeGreaterThanOrEqual(2);
    // No banco o grupo do cliente é de captura na policy e não no registro: o
    // que importa é que o conjunto aceito seja o mesmo.
    const normalizar = (r: string) => r.replace(/\(\[0-9a-f-\]\{36\}\)/g, "[0-9a-f-]{36}");
    const doNavegador = normalizar(FORMATO_DO_CAMINHO.source.replace(/\\\//g, "/"));
    for (const r of regexDoBanco) expect(normalizar(r)).toBe(doNavegador);
  });

  it("os tipos do formulário são os que o banco aceita", () => {
    const sqlEnvio = /p_tipo NOT IN \(([^)]*)\)/.exec(SQL)?.[1] ?? "";
    expect(sqlEnvio.replace(/[' ]/g, "").split(",").sort()).toEqual(
      TIPOS_DE_ENVIO.map((t) => t.valor).sort(),
    );
    const sqlMensagem = /p_tipo NOT IN \('duvida'[^)]*\)/.exec(SQL)?.[0] ?? "";
    for (const t of TIPOS_DE_MENSAGEM) expect(sqlMensagem).toContain(`'${t.valor}'`);
    // "pagamento" não é assunto de mensagem: é o comprovante, que vai ao financeiro
    expect(TIPOS_DE_MENSAGEM.map((t) => t.valor)).not.toContain("pagamento");
  });
});

describe("para onde vai", () => {
  it("comprovante vai para o bucket que só o financeiro lê; o resto, para o do cliente", () => {
    expect(bucketDoEnvio("comprovante")).toBe("comprovantes");
    for (const t of ["arte", "referencia", "outro"] as const) {
      expect(bucketDoEnvio(t)).toBe("arquivos-clientes");
    }
  });
});

describe("o que barra o envio antes de sair do celular", () => {
  const arquivo = { name: "arte.pdf", size: 1024 };

  it("arquivo sem pedido só vale para comprovante", () => {
    expect(problemaNoEnvio({ tipo: "arte", osId: null, arquivo })).toMatch(/qual pedido/);
    expect(problemaNoEnvio({ tipo: "comprovante", osId: null, arquivo })).toBeNull();
  });

  it("sem arquivo, vazio ou grande demais", () => {
    expect(problemaNoEnvio({ tipo: "arte", osId: OS, arquivo: null })).toBe("Escolha o arquivo.");
    expect(problemaNoEnvio({ tipo: "arte", osId: OS, arquivo: { name: "a", size: 0 } })).toMatch(
      /vazio/,
    );
    expect(
      problemaNoEnvio({
        tipo: "arte",
        osId: OS,
        arquivo: { name: "a", size: TAMANHO_MAXIMO_BYTES + 1 },
      }),
    ).toMatch(/link/);
    expect(problemaNoEnvio({ tipo: "arte", osId: OS, arquivo })).toBeNull();
  });

  it("recado curto ou longo demais", () => {
    expect(problemaNaMensagem("oi")).toMatch(/Escreva/);
    expect(problemaNaMensagem("x".repeat(1001))).toMatch(/1\.000/);
    expect(problemaNaMensagem("Qual o prazo?")).toBeNull();
  });
});
