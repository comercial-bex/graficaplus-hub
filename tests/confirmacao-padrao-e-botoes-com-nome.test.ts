import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const arquivos = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
const fontes = arquivos("src").filter((f) => /\.tsx?$/.test(f));

describe("confirmação no padrão do sistema", () => {
  it("nenhuma tela usa o confirm do navegador", () => {
    const usam = fontes.filter(
      (f) => !f.endsWith("ConfirmarAcao.tsx") && /window\.confirm\(|(?<![\w.])confirm\(/.test(readFileSync(f, "utf8")),
    );
    expect(usam).toEqual([]);
  });
  it("o componente padrão só roda a ação no botão de confirmar", () => {
    const s = readFileSync("src/components/bex/ConfirmarAcao.tsx", "utf8");
    expect(s).toContain("<AlertDialogAction");
    expect(s).toContain("onClick={aoConfirmar}");
  });
});

describe("botão só de ícone tem nome para leitor de tela", () => {
  it("os cinco que estavam sem nome agora têm", () => {
    const casos: [string, string][] = [
      ["src/routes/_authenticated/clientes.$id.tsx", 'aria-label="Voltar para clientes"'],
      ["src/routes/_authenticated/clientes.$id.tsx", 'aria-label="Excluir cliente"'],
      ["src/components/os/itens-da-os.tsx", 'aria-label="Remover item da OS"'],
      ["src/components/produto-materiais-editor.tsx", 'aria-label="Tirar material do produto"'],
      ["src/routes/_authenticated/filamentos-3d.tsx", 'aria-label="Remover filamento"'],
    ];
    for (const [f, trecho] of casos) expect(readFileSync(f, "utf8")).toContain(trecho);
  });
});
