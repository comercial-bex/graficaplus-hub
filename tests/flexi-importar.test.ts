import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { interpretarLinhasDaIa, lerPrintComIa } from "../src/lib/api/flexi-importar.functions";

const IMAGEM = "data:image/png;base64,AAAA";

const resposta = (status: number, corpo: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => corpo }) as unknown as Response;

const comLinhas = (linhas: unknown) =>
  resposta(200, {
    choices: [
      { message: { tool_calls: [{ function: { arguments: JSON.stringify({ linhas }) } }] } },
    ],
  });

const LINHA = {
  nome: "ads 20x15 50 und.pn",
  status: "Concluído",
  dimensao: "20,024 x 15,028cm",
  copias: "50",
  data: "24/10/2026 10:43:25",
};

describe("ler o print do Flexi com IA", () => {
  it("sem a chave da IA, diz que a IA não está ligada — e nem chama a rede", async () => {
    const buscar = vi.fn();
    expect(await lerPrintComIa(IMAGEM, undefined, buscar as unknown as typeof fetch)).toEqual({
      estado: "sem_ia",
    });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("devolve os jobs montados a partir da resposta da ferramenta", async () => {
    const buscar = vi.fn(async () => comLinhas([LINHA]));
    const r = await lerPrintComIa(IMAGEM, "chave", buscar as unknown as typeof fetch);
    expect(r.estado).toBe("ok");
    if (r.estado !== "ok") return;
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({
      copias: 50,
      larguraCm: 20.024,
      alturaCm: 15.028,
      status: "concluido",
    });
  });

  it("manda a imagem e obriga a ferramenta, sem pedir texto livre", async () => {
    const buscar = vi.fn(async () => comLinhas([LINHA]));
    await lerPrintComIa(IMAGEM, "chave", buscar as unknown as typeof fetch);
    const chamada = buscar.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    const corpo = JSON.parse(chamada[1].body);
    expect(chamada[1].headers.Authorization).toBe("Bearer chave");
    expect(corpo.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: IMAGEM } });
    expect(corpo.tool_choice.function.name).toBe("registrar_linhas");
  });

  it("402 e 429 não viram 'nenhuma linha'", async () => {
    expect(
      await lerPrintComIa(IMAGEM, "c", (async () => resposta(402)) as unknown as typeof fetch),
    ).toEqual({ estado: "sem_saldo" });
    expect(
      await lerPrintComIa(IMAGEM, "c", (async () => resposta(429)) as unknown as typeof fetch),
    ).toEqual({ estado: "limite" });
  });

  it("falha de rede e erro do serviço viram 'falhou' com o motivo", async () => {
    const rede = await lerPrintComIa(IMAGEM, "c", (async () => {
      throw new Error("x");
    }) as unknown as typeof fetch);
    expect(rede).toEqual({ estado: "falhou", detalhe: "o serviço de IA não respondeu" });
    const http = await lerPrintComIa(IMAGEM, "c", (async () =>
      resposta(500)) as unknown as typeof fetch);
    expect(http).toEqual({ estado: "falhou", detalhe: "o serviço de IA respondeu HTTP 500" });
  });

  it("resposta fora do formato combinado é falha, não lista vazia", () => {
    expect(interpretarLinhasDaIa("não é json").estado).toBe("falhou");
    expect(interpretarLinhasDaIa({ outra: 1 }).estado).toBe("falhou");
    expect(interpretarLinhasDaIa({ linhas: [] })).toEqual({
      estado: "falhou",
      detalhe: "a IA não encontrou nenhuma linha na imagem",
    });
    expect(interpretarLinhasDaIa(undefined).estado).toBe("falhou");
  });

  it("separa as linhas lidas das rejeitadas", () => {
    const r = interpretarLinhasDaIa({ linhas: [LINHA, { ...LINHA, dimensao: "borrado" }, null] });
    expect(r.estado).toBe("ok");
    if (r.estado !== "ok") return;
    expect(r.jobs).toHaveLength(1);
    expect(r.rejeitadas).toEqual([{ indice: 1, motivo: "medida ilegível" }]);
  });
});

describe("a gravação só passa pelo servidor", () => {
  const funcoes = readFileSync(
    resolve(__dirname, "../src/lib/api/flexi-importar.functions.ts"),
    "utf8",
  );
  const migracao = readFileSync(
    resolve(__dirname, "../supabase/migrations/20261024230000_flexi_jobs_importados.sql"),
    "utf8",
  );

  it("o servidor grava pela função SQL, nunca por insert direto", () => {
    expect(funcoes).toContain('rpc("importar_flexi_jobs"');
    expect(funcoes).not.toMatch(/\.from\("rip_jobs"\)\s*\.(insert|upsert|update|delete)/);
  });

  it("a função SQL só executa para o service_role", () => {
    expect(migracao).toMatch(
      /REVOKE ALL ON FUNCTION public\.importar_flexi_jobs\([^)]*\) FROM PUBLIC, anon, authenticated/,
    );
    expect(migracao).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.importar_flexi_jobs\([^)]*\) TO service_role/,
    );
  });

  it("as tabelas não têm policy de escrita para o navegador", () => {
    expect(migracao).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/i);
    expect(migracao).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON public\.rip_importacoes, public\.rip_jobs FROM authenticated/,
    );
  });
});
