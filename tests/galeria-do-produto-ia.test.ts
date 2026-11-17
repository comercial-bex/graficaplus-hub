import { describe, expect, it } from "vitest";
import {
  guardarFotoGerada,
  registrarNaGaleria,
  type GravadorDeFotos,
} from "../src/lib/api/produtos-foto-ia.functions";

/**
 * A geração por IA também grava em produto_imagens, sem apagar as fotos enviadas à mão (17/11/2026).
 * O banco falso modela só o que o servidor usa: produtos.imagem_url e a galeria.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const BASE = "https://x.supabase.co/storage/v1/object/public/produtos-fotos";
const IMAGEM = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", modelo: "m" };

type Linha = { produto_id: string; url: string; origem: string; capa: boolean };

function banco(o: {
  produtos: { id: string; imagem_url: string | null }[];
  galeria?: Linha[];
  semTabela?: boolean;
  galeriaFalha?: boolean;
}) {
  const produtos = o.produtos.map((p) => ({ ...p }));
  const galeria: Linha[] = (o.galeria ?? []).map((l) => ({ ...l }));
  const removidos: string[][] = [];
  const erroTabela = { code: "42P01", message: 'relation "public.produto_imagens" does not exist' };

  function construtor(tab: "produtos" | "produto_imagens") {
    const filtros: ((x: Record<string, unknown>) => boolean)[] = [];
    let modo: "select" | "update" | "delete" = "select";
    let valores: Record<string, unknown> = {};
    let max = Infinity;
    const q = {
      select: () => q,
      update: (v: Record<string, unknown>) => ((modo = "update"), (valores = v), q),
      delete: () => ((modo = "delete"), q),
      eq: (c: string, v: unknown) => (filtros.push((x) => x[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((x) => x[c] !== v), q),
      or: () => (filtros.push((x) => !x.imagem_url), q),
      limit: (n: number) => ((max = n), q),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (r: { data: unknown; error: unknown }) => unknown) => {
        if (tab === "produto_imagens" && (o.semTabela || o.galeriaFalha)) {
          return Promise.resolve({
            data: null,
            error: o.semTabela ? erroTabela : new Error("rede"),
          }).then(ok);
        }
        const fonte = (tab === "produtos" ? produtos : galeria) as Record<string, unknown>[];
        const achados = fonte.filter((x) => filtros.every((f) => f(x))).slice(0, max);
        if (modo === "update") for (const x of achados) Object.assign(x, valores);
        if (modo === "delete") for (const x of achados) fonte.splice(fonte.indexOf(x), 1);
        return Promise.resolve({ data: achados.map((x) => ({ id: "x" })), error: null }).then(ok);
      },
    };
    return q;
  }

  const admin: GravadorDeFotos = {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (c: string) => ({ data: { publicUrl: `${BASE}/${c}` } }),
        remove: async (c: string[]) => (removidos.push(c), {}),
      }),
    },
    from: (t: string) => {
      if (t === "produto_imagens") {
        const q = construtor("produto_imagens") as ReturnType<typeof construtor> & {
          upsert?: unknown;
        };
        q.upsert = (linha: Linha, opcoes: { onConflict: string; ignoreDuplicates: boolean }) => {
          if (o.semTabela) return Promise.resolve({ error: erroTabela });
          if (o.galeriaFalha) return Promise.resolve({ error: new Error("rede") });
          expect(opcoes).toEqual({ onConflict: "produto_id,url", ignoreDuplicates: true });
          if (!galeria.some((g) => g.produto_id === linha.produto_id && g.url === linha.url)) {
            for (const g of galeria)
              if (g.produto_id === linha.produto_id && linha.capa) g.capa = false;
            galeria.push({ ...linha });
          }
          return Promise.resolve({ error: null });
        };
        return q;
      }
      return construtor("produtos");
    },
  };
  return { admin, produtos, galeria, removidos };
}

const gerada = (id: string, n: number) => `${BASE}/ia/${id}/${n}-aa.png`;
const manual = `${BASE}/manual/${ID}/foto.jpg`;

describe("registrar a foto gerada na galeria", () => {
  it("grava origem ia, como capa, e não repete se o gatilho já criou a linha", async () => {
    const b = banco({ produtos: [{ id: ID, imagem_url: null }] });
    const r = await guardarFotoGerada({
      admin: b.admin,
      produtoId: ID,
      fotoLida: null,
      imagem: IMAGEM,
      agora: () => 1,
      sufixoUnico: () => "aa",
    });
    expect(r.estado).toBe("ok");
    expect(b.galeria).toEqual([{ produto_id: ID, url: gerada(ID, 1), origem: "ia", capa: true }]);
    // de novo com a linha já presente (gatilho): continua uma só
    expect(await registrarNaGaleria(b.admin, ID, gerada(ID, 1))).toBe("registrada");
    expect(b.galeria).toHaveLength(1);
  });

  it("NÃO apaga as fotos enviadas à mão: elas ficam na galeria", async () => {
    const b = banco({
      produtos: [{ id: ID, imagem_url: null }],
      galeria: [{ produto_id: ID, url: manual, origem: "manual", capa: false }],
    });
    const r = await guardarFotoGerada({
      admin: b.admin,
      produtoId: ID,
      fotoLida: null,
      imagem: IMAGEM,
      agora: () => 1,
      sufixoUnico: () => "aa",
    });
    expect(r.estado).toBe("ok");
    expect(b.galeria.some((g) => g.url === manual && g.origem === "manual")).toBe(true);
    expect(b.galeria.find((g) => g.origem === "ia")?.capa).toBe(true);
    expect(b.removidos.flat().some((c) => c.includes("manual/"))).toBe(false);
  });

  it("Gerar outra: a gerada anterior (e só ela) sai da galeria e do bucket", async () => {
    const antiga = gerada(ID, 1);
    const b = banco({
      produtos: [{ id: ID, imagem_url: antiga }],
      galeria: [
        { produto_id: ID, url: antiga, origem: "ia", capa: true },
        { produto_id: ID, url: manual, origem: "manual", capa: false },
      ],
    });
    const r = await guardarFotoGerada({
      admin: b.admin,
      produtoId: ID,
      fotoLida: antiga,
      imagem: IMAGEM,
      agora: () => 2,
      sufixoUnico: () => "bb",
    });
    expect(r.estado).toBe("ok");
    expect(b.galeria.some((g) => g.url === antiga)).toBe(false);
    expect(b.galeria.some((g) => g.url === manual)).toBe(true);
    expect(b.removidos).toEqual([[`ia/${ID}/1-aa.png`]]);
  });

  it("o arquivo antigo FICA se outra foto da galeria (de outro produto) aponta para ele", async () => {
    const antiga = gerada(ID, 1);
    const b = banco({
      produtos: [
        { id: ID, imagem_url: antiga },
        { id: OUTRO, imagem_url: null },
      ],
      galeria: [
        { produto_id: ID, url: antiga, origem: "ia", capa: true },
        { produto_id: OUTRO, url: antiga, origem: "manual", capa: false },
      ],
    });
    await guardarFotoGerada({
      admin: b.admin,
      produtoId: ID,
      fotoLida: antiga,
      imagem: IMAGEM,
      agora: () => 2,
      sufixoUnico: () => "bb",
    });
    expect(b.removidos).toEqual([]);
  });

  it("migração não aplicada: a foto grava pela coluna como antes, e o arquivo antigo sai", async () => {
    const antiga = gerada(ID, 1);
    const b = banco({ produtos: [{ id: ID, imagem_url: antiga }], semTabela: true });
    const r = await guardarFotoGerada({
      admin: b.admin,
      produtoId: ID,
      fotoLida: antiga,
      imagem: IMAGEM,
      agora: () => 2,
      sufixoUnico: () => "bb",
    });
    expect(r.estado).toBe("ok");
    expect(b.produtos[0].imagem_url).toBe(`${BASE}/ia/${ID}/2-bb.png`);
    expect(await registrarNaGaleria(b.admin, ID, "u")).toBe("sem_tabela");
    expect(b.removidos).toEqual([[`ia/${ID}/1-aa.png`]]);
  });

  it("falha ao consultar a galeria: o arquivo antigo fica (na dúvida não apaga)", async () => {
    const antiga = gerada(ID, 1);
    const b = banco({ produtos: [{ id: ID, imagem_url: antiga }], galeriaFalha: true });
    const r = await guardarFotoGerada({
      admin: b.admin,
      produtoId: ID,
      fotoLida: antiga,
      imagem: IMAGEM,
      agora: () => 2,
      sufixoUnico: () => "bb",
    });
    expect(r.estado).toBe("ok");
    expect(b.removidos).toEqual([]);
  });
});
