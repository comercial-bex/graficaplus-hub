import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIA_PENDENCIAS } from "../src/lib/pendenciasGuia";
import { RESUMO_POR_ROTULO } from "@/domain/painel/resumo-do-dia";

const SQL = readFileSync("supabase/migrations/20261026300000_decisoes_do_dono.sql", "utf8");
const HOOK = readFileSync("src/hooks/usePendencias.ts", "utf8");
const PAGINA = readFileSync("src/routes/_authenticated/configuracoes-empresa.tsx", "utf8");
const TELA = readFileSync("src/components/configuracoes/decisoes-do-dono.tsx", "utf8");

describe("decisões do dono no banco", () => {
  it("guarda as seis decisões em aberto e a que já foi decidida", () => {
    for (const c of [
      "frente_e_verso",
      "convencao_da_bainha",
      "prazo_de_reposicao",
      "fila_no_expresso",
      "rolo_de_vinil_mais_largo",
      "tempos_de_mao_de_obra",
    ]) {
      expect(SQL, c).toContain(`'${c}'`);
    }
    expect(SQL).toContain("'margem_da_tabela'");
    expect(SQL).toContain("Mantida a tabela do WhatsApp como está");
  });

  it("só administrador, gestor e financeiro leem e resolvem; ninguém escreve direto", () => {
    expect(SQL).toContain("FOR SELECT TO authenticated");
    expect(SQL).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/);
    expect(SQL).toContain("Só administrador, gestor e financeiro resolvem decisões.");
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.resolver_decisao(text, text) FROM PUBLIC, anon",
    );
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.pendencias_de_decisoes() FROM PUBLIC, anon",
    );
  });

  it("guarda quem respondeu e quando, e não deixa resolver duas vezes", () => {
    expect(SQL).toContain("resolvida_por = auth.uid()");
    expect(SQL).toContain("AND resolvida_em IS NULL");
    expect(SQL).toContain("Decisão não encontrada ou já resolvida.");
  });
});

describe("o aviso na tela", () => {
  it("o painel junta a terceira lista e a pendência tem guia e número do dia", () => {
    expect(HOOK).toContain("pendencias_de_decisoes");
    expect(GUIA_PENDENCIAS.decisoes_do_dono).toBeTruthy();
    expect(RESUMO_POR_ROTULO.gestao.some((x) => x.chave === "decisoes_do_dono")).toBe(true);
  });

  it("o cartão está em Dados da empresa para os três papéis e resolve pela função", () => {
    expect(PAGINA).toContain('hasRole("admin") || hasRole("gestor") || hasRole("financeiro")');
    expect(PAGINA).toContain("<DecisoesDoDono />");
    expect(TELA).toContain('rpc("resolver_decisao"');
    expect(TELA).toContain("Marcar como decidido");
  });
});
