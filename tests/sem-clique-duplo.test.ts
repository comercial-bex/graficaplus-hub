import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Botão de criar trava enquanto grava (21/10/2026). Medido no banco: os
 * orçamentos #93 e #94 "PLACA ACRILICA" nasceram com 0,08 s de diferença
 * (dois toques no "Criar"), e a YRLEN entrou cinco vezes pelo "Novo cliente".
 * Varri orçamentos, OS, materiais, produtos, leads e contas a pagar por pares
 * iguais em menos de 3 s: só o #93/#94. Fechados agora os quatro botões de
 * criar que restavam sem trava — orçamento, OS, pagamento e apontamento 3D.
 */

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("o segundo toque não cria de novo", () => {
  it.each([
    ["src/routes/_authenticated/orcamentos.index.tsx", "criandoRef", "criando"],
    ["src/routes/_authenticated/os.index.tsx", "gravandoRef", "gravando"],
    ["src/routes/_authenticated/financeiro.tsx", "gravandoRef", "gravando"],
    ["src/routes/_authenticated/producao-3d.tsx", "gravandoRef", "gravando"],
  ])("%s: a ref barra o toque, o botão desabilita e diz que está gravando", (caminho, ref, estado) => {
    const s = readFileSync(caminho, "utf8");
    expect(s).toContain(`if (${ref}.current) return;`);
    expect(s).toContain(`${ref}.current = false;`); // solta no finally, mesmo com erro
    expect(s).toContain(`disabled={${estado}}`);
  });

  it("nenhum botão de criar, registrar ou salvar fica sem disabled", () => {
    const achados: string[] = [];
    for (const f of arquivos("src")) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (/<Button[^>]*onClick=\{(handleCreate|criar\w*|salvar\w*|handleSave|cadastrar\w*|handleSubmit)\}[^>]*>/.test(l) && !/disabled=/.test(l)) {
          achados.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(achados, "trave o botão enquanto grava (ref + disabled)").toEqual([]);
  });
});
