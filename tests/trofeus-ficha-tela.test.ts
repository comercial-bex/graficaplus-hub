import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMAGEM_MAXIMA_BYTES, LADO_MAXIMO_PX, dimensoesReduzidas, validarArquivoDeImagem } from "@/lib/imagem-para-ia";

/**
 * O cartão "Ler a ficha" da calculadora de troféu (22/11/2026): o que a tela pode e não pode fazer, travado no código.
 */

const ler = (caminho: string) => readFileSync(caminho, "utf8");
/** O código sem os comentários: os comentários podem CITAR `process.env` ou o Lovable para dizer que não se usam. */
const semComentarios = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TELA = ler("src/components/trofeus/ler-a-ficha.tsx");
const CALCULADORA = ler("src/components/trofeus/calculadora-de-trofeu.tsx");
const SERVIDOR = ler("src/lib/api/trofeus-ficha.functions.ts");
const NOVOS = {
  "ficha-lida.ts": ler("src/domain/trofeus/ficha-lida.ts"),
  "ficha-comparar.ts": ler("src/domain/trofeus/ficha-comparar.ts"),
  "ficha-ia.ts": ler("src/domain/trofeus/ficha-ia.ts"),
  "imagem-para-ia.ts": ler("src/lib/imagem-para-ia.ts"),
  "ler-a-ficha.tsx": TELA,
  "trofeus-ficha.functions.ts": SERVIDOR,
};

describe("a imagem preparada no navegador", () => {
  it("só aceita PNG, JPEG e WEBP, até 10 MB e não vazia", () => {
    expect(validarArquivoDeImagem({ type: "image/png", size: 1000 })).toBeNull();
    expect(validarArquivoDeImagem({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validarArquivoDeImagem({ type: "image/webp", size: 1000 })).toBeNull();
    expect(validarArquivoDeImagem({ type: "image/gif", size: 1000 })).toBe("Use uma imagem PNG, JPEG ou WEBP.");
    expect(validarArquivoDeImagem({ type: "application/pdf", size: 1000 })).toBe("Use uma imagem PNG, JPEG ou WEBP.");
    expect(validarArquivoDeImagem({ type: "image/png", size: IMAGEM_MAXIMA_BYTES + 1 })).toBe("A imagem passa de 10 MB. Use uma menor.");
    expect(validarArquivoDeImagem({ type: "image/png", size: 0 })).toBe("O arquivo está vazio.");
  });

  it("reduz o lado maior, mantém a proporção e não aumenta imagem pequena", () => {
    expect(dimensoesReduzidas(1536, 1024)).toEqual({ largura: 1536, altura: 1024 });
    expect(dimensoesReduzidas(3600, 2400)).toEqual({ largura: LADO_MAXIMO_PX, altura: 1200 });
    expect(dimensoesReduzidas(2400, 3600)).toEqual({ largura: 1200, altura: LADO_MAXIMO_PX });
    expect(dimensoesReduzidas(10000, 1)).toEqual({ largura: LADO_MAXIMO_PX, altura: 1 });
    expect(dimensoesReduzidas(200, 100)).toEqual({ largura: 200, altura: 100 });
  });
});

describe("o cartão nunca calcula preço nem grava", () => {
  it("só chama o servidor de ler a ficha: nem a cotação, nem a gravação do troféu", () => {
    expect(TELA).toContain("lerFichaDoTrofeu");
    expect(TELA).not.toMatch(/cotarTrofeu|salvarTrofeuNoOrcamento|escadaDoTrofeu|remover_trofeu|salvar_trofeu|supabase\b/);
  });

  it("não fala de custo, multiplicador nem preço em texto", () => {
    const texto = TELA.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(texto).not.toMatch(/custo|multiplicador|R\$/i);
  });

  it("só entrega à calculadora campos de escolha (`mudar`), e só para quem pode editar", () => {
    expect(CALCULADORA).toMatch(/\{podeEditar && <LerAFicha onUsar=\{\(parte\) => mudar\(parte\)\} \/>\}/);
  });

  it("diz ao gestor o nome exato das chaves quando a IA não está ligada, sem nunca pedir a chave na tela", () => {
    expect(TELA).toContain("ANTHROPIC_API_KEY");
    expect(TELA).toContain("OPENAI_API_KEY");
    expect(TELA).not.toMatch(/type="password"|sk-[A-Za-z0-9]{6}/);
  });

  it("avisa que a imagem vai ao provedor da IA e que o sistema não a guarda", () => {
    expect(TELA).toMatch(/vai ao provedor da IA da agência só para ser lida/);
    expect(TELA).toMatch(/não a guarda/);
    expect(SERVIDOR).not.toMatch(/\.upload\(|storage\.from|insert\(/);
  });
});

describe("o segredo fica no servidor e o Lovable nunca é o motor", () => {
  it("as chaves só são lidas no arquivo do servidor, e só `process.env` inteiro é passado ao escolhedor", () => {
    for (const [nome, fonte] of Object.entries(NOVOS)) {
      if (nome === "trofeus-ficha.functions.ts") continue;
      expect(semComentarios(fonte), nome).not.toMatch(/process\.env/);
    }
    expect(SERVIDOR).toMatch(/motorDaFicha\(process\.env\)/);
    expect(semComentarios(TELA)).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it("nenhum arquivo novo usa o gateway nem a chave do Lovable como motor", () => {
    for (const [nome, fonte] of Object.entries(NOVOS)) {
      const semComentario = semComentarios(fonte);
      expect(semComentario, nome).not.toMatch(/ai\.gateway\.lovable\.dev/);
      // A chave do Lovable só pode aparecer como "o que NÃO se usa", em comentário.
      expect(semComentario, nome).not.toMatch(/LOVABLE_API_KEY/);
    }
  });

  it("o arquivo do servidor confere a permissão antes de ler o banco e antes de chamar a IA", () => {
    const iPermissao = SERVIDOR.indexOf('"has_permission"');
    expect(iPermissao).toBeGreaterThan(0);
    expect(SERVIDOR.indexOf("lerOCatalogo(supabaseAdmin")).toBeGreaterThan(iPermissao);
    expect(SERVIDOR.indexOf("lerFichaComIa({")).toBeGreaterThan(iPermissao);
    expect(SERVIDOR).toContain('_permission: "orcamentos.create"');
  });
});

describe("regras do projeto para os arquivos novos", () => {
  it("sem `as any`, sem console.log, sem title= e sem text-primary", () => {
    for (const [nome, fonte] of Object.entries(NOVOS)) {
      expect(fonte, nome).not.toMatch(/\bas any\b/);
      expect(fonte, nome).not.toMatch(/console\.log/);
      expect(fonte, nome).not.toMatch(/\stitle=/);
      expect(fonte, nome).not.toMatch(/text-primary/);
    }
  });

  it("a tela e o domínio não leem o banco do navegador", () => {
    for (const nome of ["ficha-lida.ts", "ficha-comparar.ts", "ficha-ia.ts", "ler-a-ficha.tsx"] as const) {
      expect(semComentarios(NOVOS[nome]), nome).not.toMatch(/integrations\/supabase|supabase\.from\(|\.rpc\(/);
    }
  });
});
