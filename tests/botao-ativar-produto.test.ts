import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (c: string) => readFileSync(c, "utf8");

describe("o botão de ativar e desativar produto (02/11/2026)", () => {
  const botao = ler("src/components/produtos/botao-ativar-produto.tsx");
  const lista = ler("src/routes/_authenticated/produtos.tsx");
  const pasta = ler("src/routes/_authenticated/produtos_.$id.tsx");

  it("a gravação é conferida: política que barra não vira sucesso", () => {
    expect(botao).toContain('.select("id")');
    expect(botao).toContain("Nada mudou: seu perfil não pode ativar ou desativar produtos.");
  });

  it("o seletor do orçamento fica sabendo na hora", () => {
    expect(botao).toContain('"produtos-catalog-picker"');
  });

  it("está à vista na lista, nas duas visões, e na pasta, só para quem pode", () => {
    expect(lista.match(/isAdmin && <BotaoAtivarProduto produto=\{p\} \/>/g)?.length).toBe(2);
    expect(pasta).toContain("podeEditar && <BotaoAtivarProduto produto={p} rotuloCompleto />");
    expect(lista).toContain("Mostrar inativos ({produtos.filter((p) => !p.ativo).length})");
  });

  it("inativo sai da venda: seletor, autocompletar, IA e WhatsApp filtram", () => {
    expect(ler("src/components/orcamento/use-produtos-para-escolha.ts")).toContain('.eq("ativo", true)');
    expect(ler("src/components/produto-autocomplete.tsx")).toContain('.eq("ativo", true)');
    expect(ler("src/lib/api/orcamento-ia.functions.ts")).toContain('.eq("produtos.ativo", true)');
    expect(ler("src/lib/api/whatsapp-assistente.server.ts")).toContain('.eq("produtos.ativo", true)');
  });
});
