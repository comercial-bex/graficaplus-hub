import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fraseDoAvisoDeFoto, precisaDeFoto, produtosSemFoto } from "../src/domain/catalogo/sem-foto";

/**
 * 21/11/2026: o dono mandou parar de gerar foto por IA para não gastar crédito. O app só avisa e marca quem
 * está sem foto. Estes testes travam as duas metades: a conta do aviso e a ausência de qualquer caminho
 * que chame o gerador de imagem.
 */
const raiz = new URL("..", import.meta.url).pathname;
const ler = (c: string) => readFileSync(join(raiz, c), "utf8");

function arquivos(dir: string): string[] {
  return readdirSync(join(raiz, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(join(raiz, rel)).isDirectory() ? arquivos(rel) : [rel];
  });
}

describe("quem entra no aviso de foto", () => {
  const lista = [
    { id: "1", nome: "Lona", ativo: true, tipo: "produto", imagem_url: null },
    { id: "2", nome: "Placa", ativo: true, tipo: "produto", imagem_url: "   " },
    { id: "3", nome: "Banner", ativo: true, tipo: "produto", imagem_url: "https://x/y.jpg" },
    { id: "4", nome: "Instalação", ativo: true, tipo: "servico", imagem_url: null },
    { id: "5", nome: "Antigo", ativo: false, tipo: "produto", imagem_url: null },
    { id: "6", nome: "Sem campo ativo", tipo: "produto" },
  ];
  it("conta só ativo, que não é serviço, sem endereço de foto", () => {
    expect(produtosSemFoto(lista).map((p) => p.id)).toEqual(["1", "2", "6"]);
  });
  it("endereço só com espaços conta como sem foto; serviço e inativo não precisam", () => {
    expect(precisaDeFoto({ ativo: true, tipo: "produto", imagem_url: " " })).toBe(true);
    expect(precisaDeFoto({ ativo: true, tipo: "servico", imagem_url: null })).toBe(false);
    expect(precisaDeFoto({ ativo: false, tipo: "produto", imagem_url: null })).toBe(false);
  });
  it("a frase usa singular e plural", () => {
    expect(fraseDoAvisoDeFoto(1)).toBe("1 produto ativo está sem foto.");
    expect(fraseDoAvisoDeFoto(7)).toBe("7 produtos ativos estão sem foto.");
    expect(fraseDoAvisoDeFoto(0)).toBe("Todos os produtos ativos têm foto.");
  });
});

describe("nenhum caminho gera foto por IA", () => {
  it("a função de servidor, o lote e a tela do lote não existem mais", () => {
    expect(existsSync(join(raiz, "src/lib/api/produtos-foto-ia.functions.ts"))).toBe(false);
    expect(existsSync(join(raiz, "src/components/produtos/gerar-fotos-que-faltam.tsx"))).toBe(false);
    expect(existsSync(join(raiz, "src/domain/catalogo/lote-de-fotos.ts"))).toBe(false);
  });
  it("nenhum arquivo do app chama o gerador nem mostra o botão", () => {
    const proibidos = ["gerarFotoDoProduto", "GerarFotosQueFaltam", "Gerar foto com IA", "gerar-foto-com-ia", "produtos-foto-ia"];
    for (const f of arquivos("src").filter((x) => /\.(ts|tsx)$/.test(x))) {
      const t = ler(f);
      for (const p of proibidos) expect(t.includes(p), `${f} ainda cita ${p}`).toBe(false);
    }
  });
  it("a foto do produto só envia e remove, e marca 'Sem foto'", () => {
    const c = ler("src/components/produtos/foto-do-produto.tsx");
    expect(c).toContain("marca-sem-foto");
    expect(c).toContain("Enviar foto");
    expect(c).not.toMatch(/Sparkles|Copiar pedido|createServerFn/);
  });
  it("a lista de produtos mostra o aviso e a marca em cada linha", () => {
    const r = ler("src/routes/_authenticated/produtos.tsx");
    expect(r).toContain("<AvisoSemFoto produtos={produtos} />");
    expect(r).toContain("marca-sem-foto-linha");
  });
});
