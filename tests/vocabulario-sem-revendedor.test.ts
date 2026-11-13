import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O dono só reconhece duas modalidades: parceiro (terceirizado) e cliente final.
 * As palavras revendedor, revenda e revender não existem para ele, então não
 * podem voltar em texto que alguém lê na tela, no título da aba, na prévia do
 * link ou na mensagem. O teste varre todos os .ts e .tsx de src.
 *
 * Fica de fora, de propósito: comentários, a coluna clientes.revendedor, os
 * tipos gerados, o valor gravado "revendedor_brindes", identificadores internos
 * do código e as exceções listadas abaixo, cada uma com o motivo.
 */
const EXCECOES_POR_ARQUIVO: Record<string, string> = {
  // Termo fiscal: a destinação da compra (revenda) decide ISS ou ICMS.
  "src/components/parceiros/contador-tab.tsx": "pergunta ao contador sobre compra para revenda",
  // Variável interna sobre brinde comprado pronto, nunca exibida.
  "src/domain/precos/tabela-de-precos.ts": "variável local revenda",
  // Evento do Meta Pixel já cadastrado com este nome.
  "src/lib/metaPixel.ts": "content_name parceiro_revendedor",
  // Tipos gerados do banco.
  "src/integrations/supabase/types.ts": "tipos gerados",
};

function arquivosDe(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return arquivosDe(caminho);
    return /\.(ts|tsx)$/.test(e.name) ? [caminho] : [];
  });
}

/** Tira o que não é texto de tela: comentários e identificadores do banco. */
function textoVisivel(src: string): string {
  return src
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/^\s*\*.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "")
    .replace(/revendedor_brindes/g, "")
    .replace(/clienteRevendedor/g, "")
    .replace(/cliente-revendedor/g, "")
    .replace(/\.select\("revendedor"\)|data\?\.revendedor/g, "")
    .replace(/margemSobreVenda/g, "");
}

describe("vocabulário: revendedor e revenda não voltam na tela", () => {
  // A triagem reconhece o que o CONTATO digita ("sou revendedor"), então a palavra
  // aparece ali como padrão de leitura, nunca como texto mostrado a alguém.
  const arquivos = arquivosDe("src").filter(
    (a) => !(a in EXCECOES_POR_ARQUIVO) && !a.startsWith("src/domain/whatsapp/triagem/"),
  );

  it("varre os arquivos de src", () => {
    expect(arquivos.length).toBeGreaterThan(100);
  });

  it("nenhum arquivo diz revend", () => {
    const achados = arquivos.flatMap((a) =>
      textoVisivel(readFileSync(a, "utf8"))
        .split("\n")
        .filter((l) => /revend/i.test(l))
        .map((l) => `${a}: ${l.trim()}`),
    );
    expect(achados).toEqual([]);
  });

  it("a prévia global do site não promete preço de parceiro", () => {
    expect(readFileSync("src/routes/__root.tsx", "utf8")).not.toMatch(/preço de parceiro/i);
  });

  it("o robô de WhatsApp sem uso saiu e nada o importa", () => {
    expect(existsSync("src/lib/whatsapp-bot.ts")).toBe(false);
  });
});
