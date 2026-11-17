import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Contrato da migração 20261117210000 e das telas da galeria (17/11/2026). Texto, não banco: a migração não foi aplicada. */
const ler = (c: string) => readFileSync(c, "utf8");
const sql = ler("supabase/migrations/20261117210000_produto_imagens_galeria.sql");

describe("migração produto_imagens", () => {
  it("tem as colunas pedidas, uma capa por produto e a mesma url só uma vez", () => {
    for (const c of ["produto_id", "url", "legenda", "ordem", "capa", "origem", "created_by"])
      expect(sql).toContain(c);
    expect(sql).toContain("CHECK (origem IN ('manual', 'ia'))");
    expect(sql).toContain(
      "produto_imagens_uma_capa ON public.produto_imagens (produto_id) WHERE capa",
    );
    expect(sql).toContain("produto_imagens_url_unica ON public.produto_imagens (produto_id, url)");
  });

  it("RLS ligada, escrita só admin e gestor, leitura herdada de produtos", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(
      /FOR SELECT TO authenticated\s+USING \(EXISTS \(SELECT 1 FROM public\.produtos p/,
    );
    expect(sql).toMatch(
      /FOR ALL TO authenticated[\s\S]*has_role\(\(SELECT auth\.uid\(\)\), 'admin'\)[\s\S]*'gestor'/,
    );
  });

  it("GRANTs explícitos e REVOKE de anon (e PUBLIC)", () => {
    expect(sql).toContain("REVOKE ALL ON public.produto_imagens FROM PUBLIC, anon;");
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_imagens TO authenticated;",
    );
    expect(sql).toContain("GRANT ALL ON public.produto_imagens TO service_role;");
    for (const f of [
      "tg_produto_imagens_capa_antes",
      "tg_produto_imagens_sincroniza_depois",
      "tg_produtos_foto_para_galeria",
    ]) {
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.${f}() FROM PUBLIC, anon, authenticated;`,
      );
    }
  });

  it("o backfill vem ANTES dos gatilhos e põe as fotos atuais como capa", () => {
    const backfill = sql.indexOf(
      "INSERT INTO public.produto_imagens (produto_id, url, ordem, capa, origem, created_by)\nSELECT",
    );
    expect(backfill).toBeGreaterThan(0);
    expect(backfill).toBeLessThan(sql.indexOf("CREATE TRIGGER"));
    expect(sql).toContain(
      "true,\n       CASE WHEN p.imagem_url LIKE '%/produtos-fotos/ia/%' THEN 'ia' ELSE 'manual' END",
    );
  });

  it("o gatilho mantém produtos.imagem_url igual à capa, nos dois sentidos, sem girar em círculo", () => {
    expect(sql).toContain("UPDATE public.produtos SET imagem_url = url_da_capa");
    expect(sql).toContain("AFTER UPDATE OF imagem_url ON public.produtos");
    expect(sql).toContain("bex.sincronizando_foto");
    // a primeira foto vira capa; marcar capa desmarca a anterior; apagar a capa promove a próxima
    expect(sql).toContain("NEW.capa := true;");
    expect(sql).toContain(
      "SET capa = false\n     WHERE produto_id = NEW.produto_id AND capa AND id <> NEW.id",
    );
    expect(sql).toContain("IF TG_OP = 'DELETE' AND OLD.capa THEN");
  });

  it("transação, ensaio e como desfazer documentados; nada de dado de cliente", () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toContain("COMO DESFAZER");
    expect(sql).toContain("docs/ensaio-produto-imagens-galeria.md");
    const ensaio = ler("docs/ensaio-produto-imagens-galeria.md");
    expect(ensaio).toContain("RAISE EXCEPTION");
  });
});

describe("telas da galeria", () => {
  it("toda miniatura do Custeio usa FotoAmpliavel", () => {
    expect(ler("src/components/produtos/miniatura-do-produto.tsx")).toContain("<FotoAmpliavel");
    expect(ler("src/components/precos/icone-do-produto.tsx")).toContain("<FotoAmpliavel");
  });

  it("FotoAmpliavel: cartão no mouse, tela cheia no clique, Esc pelo Dialog, alt descritivo, não propaga o clique", () => {
    const f = ler("src/components/produtos/foto-ampliavel.tsx");
    expect(f).toContain("HoverCard");
    expect(f).toContain("<Dialog");
    expect(f).toContain("e.stopPropagation()");
    expect(f).toContain('role="button"');
    expect(f).toContain("onKeyDown");
    expect(f).toContain("alt={descricao}");
    expect(f).toContain("h-[100dvh]");
  });

  it("a galeria mostra carregando, erro e vazio, confirma a remoção em palavras e nunca grava direto em produtos", () => {
    const g = ler("src/components/produtos/galeria-do-produto.tsx");
    expect(g).toContain("Carregando as fotos do produto");
    expect(g).toContain('role="alert"');
    expect(g).toContain("Tentar de novo");
    expect(g).toContain("galeria-vazia");
    expect(g).toContain("Sim, remover a foto");
    expect(g.replace(/\s+/g, " ")).toContain("Isto não volta.");
    expect(g).not.toMatch(/from\("produtos"\)/);
    const api = ler("src/lib/api/produto-imagens.ts");
    expect(api).not.toMatch(/\.from\("produtos"\)\s*\.update/);
    expect(api).not.toContain('from("produtos").update');
    // letra: nenhum text-sm / text-xs na galeria
    expect(/text-(sm|xs)\b/.test(g)).toBe(false);
  });

  it("a geração por IA registra em produto_imagens com origem ia", () => {
    const ia = ler("src/lib/api/produtos-foto-ia.functions.ts");
    expect(ia).toContain('origem: "ia"');
    expect(ia).toContain("registrarNaGaleria(admin, produtoId, url)");
  });
});
