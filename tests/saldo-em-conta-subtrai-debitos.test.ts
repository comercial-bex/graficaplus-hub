import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// Saldo em conta (16/11/2026): importar_extrato grava o valor do débito positivo e diz o sentido
// pelo tipo; saldo_contas_bancarias() somava o débito. A correção troca só a conta da função.
const RAIZ = join(__dirname, "..");
const NOVA = readFileSync(
  join(RAIZ, "supabase/migrations/20261116200000_saldo_em_conta_subtrai_debitos.sql"),
  "utf8",
);
const ANTERIOR = readFileSync(
  join(RAIZ, "supabase/migrations/20260916100000_fecha_portas_abertas.sql"),
  "utf8",
);

/** Cabeçalho e corpo de saldo_contas_bancarias() como o Postgres guarda (prosrc = texto entre os $function$). */
function definicao(texto: string): { cabecalho: string; corpo: string } {
  const m = texto.match(
    /CREATE OR REPLACE FUNCTION public\.saldo_contas_bancarias\(\)([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$/,
  );
  expect(m).not.toBeNull();
  return { cabecalho: m![1], corpo: m![2] };
}

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

describe("saldo em conta subtrai os débitos do extrato", () => {
  it("o md5 do corpo no arquivo é o retrato anotado e o que estava vivo antes é o da guarda", () => {
    const nova = definicao(NOVA);
    expect(md5(nova.corpo)).toBe("253bc1b099da373e3c4873c136daec27");
    expect(NOVA).toContain("253bc1b099da373e3c4873c136daec27");
    // A guarda só troca se o banco ainda tiver a definição de 16/09.
    expect(md5(definicao(ANTERIOR).corpo)).toBe("0b6545c0db77b809434c5fba652dbda6");
    expect(NOVA).toContain("IS DISTINCT FROM '0b6545c0db77b809434c5fba652dbda6'");
  });

  it("mesma assinatura, mesmo retorno, mesmo filtro de quem vê e mesma data de corte", () => {
    const nova = definicao(NOVA);
    const antes = definicao(ANTERIOR);
    expect(nova.cabecalho.replace(/\s+/g, " ")).toBe(antes.cabecalho.replace(/\s+/g, " "));
    for (const trecho of [
      "public.can_see_financials(auth.uid())",
      "(c.saldo_inicial_data is null or t.data >= c.saldo_inicial_data)",
      "where c.ativo",
    ]) {
      expect(nova.corpo, trecho).toContain(trecho);
    }
  });

  it("o saldo é saldo inicial + créditos - débitos, pelo tipo e com abs no valor", () => {
    const { corpo } = definicao(NOVA);
    const saldo = corpo.slice(
      corpo.indexOf("coalesce(c.saldo_inicial, 0)\n"),
      corpo.indexOf("count(t.id) filter"),
    );
    expect(saldo).toContain("when 'debito' then -abs(t.valor)");
    expect(saldo).toContain("when 'credito' then abs(t.valor)");
    // Linha sem tipo continua somando com o sinal que tiver.
    expect(saldo).toContain("else t.valor end");
    // Nada de somar o valor cru, que era o defeito.
    expect(corpo).not.toMatch(/coalesce\(sum\(t\.valor\), 0\)/);
  });

  it("não abre a função para anon e não mexe em mais nada", () => {
    expect(NOVA).not.toMatch(/GRANT|TO anon|TO PUBLIC/i);
    expect(NOVA).toContain("has_function_privilege('anon', 'public.saldo_contas_bancarias()'");
    expect((NOVA.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(1);
    expect(NOVA).not.toMatch(/CREATE (OR REPLACE )?VIEW|DROP |ALTER TABLE|POLICY/i);
  });
});
