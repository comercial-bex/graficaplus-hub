import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chavesEntre, problemasDoSelect } from "./apoio/contrato-do-banco";

/**
 * /arquivos: A LISTA NUNCA CARREGOU.
 *
 * O select embutia `usuarios(nome)` em `arquivos`, que tem TRÊS chaves para
 * `usuarios` (enviado_por, aprovado_por, created_by). O PostgREST não escolhe
 * por ninguém: recusa a consulta inteira (300 PGRST201, "more than one
 * relationship was found"). A tela lançava o erro, mas não lia `isError` —
 * depois das tentativas a lista ficava vazia, com cara de "nenhum arquivo",
 * para todo mundo que abre a tela. Medido em 05/10/2026 no PostgREST de
 * produção; havia 7 arquivos.
 */

const FONTE = readFileSync("src/routes/_authenticated/arquivos.tsx", "utf8");

function selectDaLista(fonte: string): string {
  const m = fonte.match(/\.from\("arquivos"\)\s*\.select\("([^"]+)"\)/);
  if (!m) throw new Error('não achei o .from("arquivos").select(…) da lista');
  return m[1];
}

describe("/arquivos", () => {
  it("o conferidor acusa o select antigo — a trava não passa por não olhar", () => {
    // A linha exata que estava no ar até 05/10/2026.
    const antigo =
      "*, ordens_servico(id, numero, titulo), clientes(id, nome, telefone, whatsapp_principal), usuarios(nome), aprovacoes(id, aprovado, canal, created_at, observacao, usuarios(nome), cliente_contatos(nome))";
    expect(chavesEntre("arquivos", "usuarios").length).toBe(3);
    expect(problemasDoSelect("arquivos", antigo).join("\n")).toMatch(
      /arquivos→usuarios: 3 chaves .* precisa dizer qual/,
    );
  });

  it("o select da lista é um que o PostgREST aceita: embed de usuarios com a chave dita", () => {
    const select = selectDaLista(FONTE);
    expect(problemasDoSelect("arquivos", select)).toEqual([]);
    expect(select).toContain("usuarios!arquivos_enviado_por_fkey(nome)");
  });

  it("consulta caída aparece como erro, não como lista vazia", () => {
    expect(FONTE).toMatch(/isError\s*\?/);
    expect(FONTE).toContain("Não foi possível carregar os arquivos.");
    // Os contadores também não podem dizer zero com a consulta caída.
    expect(FONTE).toMatch(/isError \? "—"/);
  });
});
