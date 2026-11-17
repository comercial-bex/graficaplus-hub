import { describe, expect, it } from "vitest";
import {
  capaDaGaleria,
  caminhoDoEnvio,
  caminhoNoBucket,
  depoisDeAdicionar,
  depoisDeDefinirCapa,
  depoisDeRemover,
  emOrdem,
  migracaoDaGaleriaAusente,
  movimentoNaOrdem,
  podeApagarOArquivo,
  proximaOrdem,
  validarArquivoDaFoto,
  type ImagemDaGaleria,
} from "../src/domain/catalogo/galeria-do-produto";

/** Galeria de fotos do produto (17/11/2026): a regra de capa e a de remover o arquivo do bucket. */

const P = "11111111-1111-4111-8111-111111111111";
const BASE = "https://x.supabase.co/storage/v1/object/public/produtos-fotos";
const foto = (
  id: string,
  ordem: number,
  capa = false,
  extra: Partial<ImagemDaGaleria> = {},
): ImagemDaGaleria => ({
  id,
  produto_id: P,
  url: `${BASE}/manual/${P}/${id}.jpg`,
  legenda: null,
  ordem,
  capa,
  origem: "manual",
  created_by: null,
  ...extra,
});

describe("capa", () => {
  it("é só a foto marcada: sem marca não há capa", () => {
    expect(capaDaGaleria([foto("a", 0), foto("b", 1)])).toBeNull();
    expect(capaDaGaleria([foto("a", 0), foto("b", 1, true)])?.id).toBe("b");
    expect(capaDaGaleria([])).toBeNull();
  });

  it("a primeira foto do produto vira capa; as seguintes NUNCA tiram a capa de quem tem", () => {
    const primeira = depoisDeAdicionar([], foto("a", 0));
    expect(primeira).toHaveLength(1);
    expect(primeira[0].capa).toBe(true);

    const segunda = depoisDeAdicionar(primeira, foto("b", 0));
    expect(segunda.find((i) => i.id === "a")?.capa).toBe(true);
    expect(segunda.find((i) => i.id === "b")?.capa).toBe(false);
    expect(segunda.filter((i) => i.capa)).toHaveLength(1);
    // a antiga continua lá: adicionar não perde foto
    expect(segunda.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("a nova entra no fim da fila", () => {
    const lista = depoisDeAdicionar([foto("a", 0, true), foto("b", 4)], foto("c", 0));
    expect(lista.find((i) => i.id === "c")?.ordem).toBe(5);
    expect(proximaOrdem([])).toBe(0);
  });

  it("definir capa deixa uma só, e as outras ficam na galeria", () => {
    const antes = [foto("a", 0, true), foto("b", 1), foto("c", 2)];
    const depois = depoisDeDefinirCapa(antes, "c");
    expect(depois.filter((i) => i.capa).map((i) => i.id)).toEqual(["c"]);
    expect(depois).toHaveLength(3);
    // id que não existe não muda nada (nem tira a capa atual)
    expect(depoisDeDefinirCapa(antes, "x").find((i) => i.capa)?.id).toBe("a");
  });

  it("remover a capa passa a capa para a primeira da fila; remover outra não mexe na capa", () => {
    const antes = [foto("a", 2, true), foto("b", 1), foto("c", 0)];
    const semCapa = depoisDeRemover(antes, "a");
    expect(semCapa.novaCapaId).toBe("c");
    expect(semCapa.restantes.filter((i) => i.capa).map((i) => i.id)).toEqual(["c"]);

    const semOutra = depoisDeRemover(antes, "b");
    expect(semOutra.novaCapaId).toBeNull();
    expect(semOutra.restantes.find((i) => i.capa)?.id).toBe("a");
  });

  it("remover a única foto deixa o produto sem capa", () => {
    const r = depoisDeRemover([foto("a", 0, true)], "a");
    expect(r.restantes).toEqual([]);
    expect(r.novaCapaId).toBeNull();
  });
});

describe("ordem", () => {
  it("ordena por ordem e desempata pelo id", () => {
    expect(emOrdem([foto("b", 1), foto("a", 1), foto("c", 0)]).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("subir e descer trocam com a vizinha; na ponta não fazem nada", () => {
    const fila = [foto("a", 0), foto("b", 1), foto("c", 2)];
    expect(movimentoNaOrdem(fila, "b", "subir")).toEqual([
      { id: "a", ordem: 1 },
      { id: "b", ordem: 0 },
    ]);
    expect(movimentoNaOrdem(fila, "b", "descer")).toEqual([
      { id: "b", ordem: 2 },
      { id: "c", ordem: 1 },
    ]);
    expect(movimentoNaOrdem(fila, "a", "subir")).toEqual([]);
    expect(movimentoNaOrdem(fila, "c", "descer")).toEqual([]);
    expect(movimentoNaOrdem(fila, "x", "subir")).toEqual([]);
  });

  it("funciona mesmo com ordens empatadas (a fila é renumerada)", () => {
    const fila = [foto("a", 0), foto("b", 0), foto("c", 0)];
    const m = movimentoNaOrdem(fila, "c", "subir");
    const final = fila.map((i) => ({
      ...i,
      ordem: m.find((x) => x.id === i.id)?.ordem ?? i.ordem,
    }));
    expect(emOrdem(final).map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
});

describe("arquivo do bucket", () => {
  it("o caminho vem só de endereço do bucket produtos-fotos", () => {
    expect(caminhoNoBucket(`${BASE}/manual/${P}/a.jpg`)).toBe(`manual/${P}/a.jpg`);
    expect(caminhoNoBucket(`${BASE}/ia/${P}/1-aa.png?v=2`)).toBe(`ia/${P}/1-aa.png`);
    expect(
      caminhoNoBucket("https://x.supabase.co/storage/v1/object/public/outro-bucket/a.jpg"),
    ).toBeNull();
    expect(caminhoNoBucket("https://outro.site/foto.jpg")).toBeNull();
    expect(caminhoNoBucket("")).toBeNull();
    expect(caminhoNoBucket(null)).toBeNull();
    expect(caminhoNoBucket(`${BASE}/../segredo.jpg`)).toBeNull();
    expect(caminhoNoBucket(`${BASE}/a/%2e%2e/b.jpg`)).toBeNull();
  });

  it("só apaga quando NENHUM outro registro aponta para o arquivo", () => {
    const url = `${BASE}/manual/${P}/a.jpg`;
    expect(podeApagarOArquivo({ url, outrosRegistros: 0 })).toBe(true);
    expect(podeApagarOArquivo({ url, outrosRegistros: 1 })).toBe(false);
    expect(podeApagarOArquivo({ url, outrosRegistros: 3 })).toBe(false);
  });

  it("na dúvida o arquivo fica (conferência que falhou), e o que não é do bucket nunca sai", () => {
    const url = `${BASE}/manual/${P}/a.jpg`;
    expect(podeApagarOArquivo({ url, outrosRegistros: null })).toBe(false);
    expect(podeApagarOArquivo({ url: "https://outro.site/a.jpg", outrosRegistros: 0 })).toBe(false);
    expect(podeApagarOArquivo({ url: "", outrosRegistros: 0 })).toBe(false);
  });

  it("o envio novo vai para a pasta manual do produto", () => {
    expect(caminhoDoEnvio(P, "webp", "abc")).toBe(`manual/${P}/abc.webp`);
  });
});

describe("validação do arquivo", () => {
  it("aceita JPG, PNG e WebP até 5 MB", () => {
    expect(validarArquivoDaFoto({ type: "image/jpeg", size: 1000 })).toEqual({
      ok: true,
      extensao: "jpg",
    });
    expect(validarArquivoDaFoto({ type: "image/png", size: 5 * 1024 * 1024 })).toEqual({
      ok: true,
      extensao: "png",
    });
    expect(validarArquivoDaFoto({ type: "image/webp", size: 10 })).toEqual({
      ok: true,
      extensao: "webp",
    });
  });

  it("recusa tipo estranho, vazio e grande, com a razão escrita", () => {
    expect(validarArquivoDaFoto({ type: "application/pdf", size: 10 })).toMatchObject({
      ok: false,
      motivo: expect.stringContaining("JPG, PNG ou WebP"),
    });
    expect(validarArquivoDaFoto({ type: "image/gif", size: 10 }).ok).toBe(false);
    expect(validarArquivoDaFoto({ type: "image/png", size: 0 }).ok).toBe(false);
    const grande = validarArquivoDaFoto({ type: "image/png", size: 5 * 1024 * 1024 + 1 });
    expect(grande).toMatchObject({ ok: false, motivo: expect.stringContaining("5 MB") });
  });
});

describe("migração ainda não aplicada", () => {
  it("reconhece a tabela ausente pelo código ou pelo texto, e não confunde com outro erro", () => {
    expect(migracaoDaGaleriaAusente({ code: "42P01" })).toBe(true);
    expect(migracaoDaGaleriaAusente({ code: "PGRST205" })).toBe(true);
    expect(
      migracaoDaGaleriaAusente({ message: 'relation "public.produto_imagens" does not exist' }),
    ).toBe(true);
    expect(
      migracaoDaGaleriaAusente({
        message: "Could not find the table 'public.produto_imagens' in the schema cache",
      }),
    ).toBe(true);
    expect(
      migracaoDaGaleriaAusente({
        code: "42501",
        message: "permission denied for table produto_imagens",
      }),
    ).toBe(false);
    expect(migracaoDaGaleriaAusente({ message: "fetch failed" })).toBe(false);
    expect(migracaoDaGaleriaAusente(null)).toBe(false);
  });
});
