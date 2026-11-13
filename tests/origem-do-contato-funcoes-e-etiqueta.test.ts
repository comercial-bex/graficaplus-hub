import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const funcoes = readFileSync("src/lib/api/origem-do-contato.functions.ts", "utf8");
const etiqueta = readFileSync("src/components/whatsapp/etiqueta-de-tipo-do-contato.tsx", "utf8");
const webhook = readFileSync("src/lib/api/whatsapp-webhook.server.ts", "utf8");

/** Corpo de cada server function exportada. */
function corpoDe(nome: string): string {
  const i = funcoes.indexOf(`export const ${nome} =`);
  expect(i, nome).toBeGreaterThan(-1);
  const prox = funcoes.indexOf("\nexport const ", i + 10);
  return funcoes.slice(i, prox === -1 ? undefined : prox);
}

describe("funções de servidor da origem do contato", () => {
  it.each(["listarAnunciosOrigem", "listarConjuntos", "listarPalavras", "salvarConjunto", "classificarAnuncio", "salvarPalavra"])(
    "%s confere configuracoes.manage no servidor antes de tudo",
    (nome) => {
      const c = corpoDe(nome);
      expect(c).toContain("requireSupabaseAuth");
      const exigiu = c.indexOf('exigir(context.supabase, context.userId, "configuracoes.manage")');
      expect(exigiu).toBeGreaterThan(-1);
      for (const marca of [".rpc(\"origem_", ".from(\""]) {
        const i = c.indexOf(marca);
        if (i > -1) expect(exigiu).toBeLessThan(i);
      }
    },
  );
  it("definirTipoDoLead exige whatsapp.reply, só aceita os dois tipos e chama a função do servidor", () => {
    const c = corpoDe("definirTipoDoLead");
    expect(c).toContain('"whatsapp.reply"');
    expect(c).toContain("TIPO.nullable()");
    expect(funcoes).toContain('z.enum(["cliente_final", "parceiro"])');
    expect(c).toContain("whatsapp_definir_tipo_do_contato");
    expect(c).toContain("await admin()");
  });
  it("escrita da gestão usa só as funções origem_* e nunca grava direto nas tabelas", () => {
    expect(funcoes).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    for (const rpc of ["origem_salvar_conjunto", "origem_vincular_anuncio", "origem_salvar_anuncio", "origem_salvar_palavra", "origem_remover_palavra"]) {
      expect(funcoes).toContain(`"${rpc}"`);
    }
  });
  it("ids de conjunto e de anúncio são numéricos", () => {
    expect(funcoes).toContain("\\d{6,40}");
  });
  it("o webhook usa camposDeOrigem só em mensagem de entrada", () => {
    expect(webhook).toMatch(/evento\.deMim \? \{\} : camposDeOrigem\(payloadCru\)/);
  });
});

describe("etiqueta de tipo do contato", () => {
  it("texto fixo, botões e confirmação para tirar", () => {
    expect(readFileSync("src/domain/whatsapp/origem-do-contato.ts", "utf8")).toContain(
      "Só uma etiqueta interna. O preço de parceiro exige cadastro como parceiro.",
    );
    expect(etiqueta).toContain("AVISO_DA_ETIQUETA");
    expect(etiqueta).toContain('"Cliente final"');
    expect(etiqueta).toContain('"Parceiro"') ;
    expect(etiqueta).toContain("Tirar a etiqueta?");
    expect(etiqueta).toContain("Cliente cadastrado. O preço segue o cadastro.");
    expect(etiqueta).toContain("Parceiro cadastrado");
  });
  it("não tem caminho para mensagem, modelo ou documento do cliente", () => {
    expect(etiqueta).not.toMatch(/whatsapp-enviar|documento-whatsapp|enfileirar|acaoNaConversa|template/i);
  });
  it("letra mínima de 16 px e alvo de toque de 44 px", () => {
    expect(etiqueta).not.toMatch(/text-(xs|sm)\b/);
    expect(etiqueta).toContain("h-11");
  });
  it("está montada só no painel da conversa", () => {
    const usos = execSync("grep -rl etiqueta-de-tipo-do-contato src || true", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(usos).toEqual(["src/components/whatsapp/painel-da-conversa.tsx"]);
  });
});
