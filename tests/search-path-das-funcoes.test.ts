import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Última varredura de 30/10/2026: as duas únicas funções PL/pgSQL do schema public sem `search_path` fixo
 * (`tg_notificacao_templates_touch` e `somar_dias_uteis`; nenhuma é SECURITY DEFINER). Fixadas, a varredura de
 * funções sem `search_path` volta zerada.
 */
const SQL = readFileSync(
  join(
    __dirname,
    "..",
    "supabase/migrations/20261030890000_search_path_das_duas_funcoes_que_faltavam.sql",
  ),
  "utf8",
);

describe("as duas funções que faltavam ganham search_path", () => {
  it("fixa as duas em public", () => {
    expect(SQL).toContain(
      "ALTER FUNCTION public.tg_notificacao_templates_touch() SET search_path TO 'public';",
    );
    expect(SQL).toContain(
      "ALTER FUNCTION public.somar_dias_uteis(date, integer) SET search_path TO 'public';",
    );
  });
});
