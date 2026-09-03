import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Trava contra o defeito mais teimoso deste front: escolher o registro PAI de
 * forma arbitrária na hora de gravar o filho.
 *
 * Apareceu três vezes, sempre com a mesma cara:
 *
 *   entregas.tsx     from("ordens_servico_operacional").select("id").limit(1)
 *   ocorrencias.tsx  from("ordens_servico_operacional").select("id").limit(1)
 *   maquinas-agenda  const maquina = maquinas[0]
 *
 * O resultado não é campo vazio — é vínculo ERRADO, gravado em silêncio.
 * Entrega do cliente A na OS do cliente B parece dado bom e entra no relatório
 * como se fosse. Campo vazio alguém percebe; esse não.
 *
 * `.limit(1)` é legítimo com filtro (`.eq(...)`) e ordenação — "o snapshot mais
 * recente DESTA OS". O que este teste proíbe é `limit(1)` sem nenhum filtro.
 */
function arquivosTsx(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTsx(caminho));
    else if (/\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const PASTAS = ["src/routes", "src/components"];

describe("nenhuma tela escolhe o pai arbitrariamente", () => {
  const arquivos = PASTAS.flatMap((p) => arquivosTsx(p));

  it("encontra arquivos para analisar", () => {
    expect(arquivos.length).toBeGreaterThan(20);
  });

  it("não usa .limit(1) sem filtro para pegar um id", () => {
    const suspeitos: string[] = [];

    for (const caminho of arquivos) {
      const texto = readFileSync(caminho, "utf8");
      // Cada cadeia .from(...) até o ; ou o fechamento da chamada.
      for (const trecho of texto.split(/\.from\(/).slice(1)) {
        const cadeia = trecho.slice(0, 400);
        const corta = cadeia.search(/;|\n\s*\}/);
        const alcance = corta > 0 ? cadeia.slice(0, corta) : cadeia;

        if (!/\.limit\(1\)/.test(alcance)) continue;
        // Com filtro é legítimo: "o mais recente DESTE registro".
        if (/\.eq\(|\.in\(|\.match\(|\.filter\(|\.or\(/.test(alcance)) continue;

        const tabela = alcance.match(/^["'`]([\w.]+)["'`]/)?.[1] ?? "?";
        suspeitos.push(`${caminho}: from("${tabela}") … .limit(1) sem filtro`);
      }
    }

    expect(
      suspeitos,
      `Pegar o "primeiro que aparecer" grava vínculo errado em silêncio. ` +
        `Deixe o usuário escolher, ou filtre pelo registro certo.\n${suspeitos.join("\n")}`,
    ).toEqual([]);
  });

  it("não usa o primeiro item de uma lista carregada como pai de um insert", () => {
    const suspeitos: string[] = [];
    // `const x = lista[0]` seguido, no mesmo arquivo, de um insert que usa x.id
    const padrao = /const\s+(\w+)\s*=\s*(\w+)\s*\[\s*0\s*\]\s*;/g;

    for (const caminho of arquivos) {
      const texto = readFileSync(caminho, "utf8");
      if (!/\.insert\(/.test(texto)) continue;
      for (const m of texto.matchAll(padrao)) {
        const [, alvo, fonte] = m;
        // Só interessa quando a fonte é uma coleção vinda do banco e o alvo
        // vira id de vínculo.
        if (!new RegExp(`${alvo}\\.id`).test(texto)) continue;
        if (!/data|lista|rows|maquinas|ordens|clientes|itens|produtos/i.test(fonte)) continue;
        suspeitos.push(`${caminho}: const ${alvo} = ${fonte}[0] e depois ${alvo}.id num insert`);
      }
    }

    expect(
      suspeitos,
      `O primeiro da lista não é a escolha do usuário.\n${suspeitos.join("\n")}`,
    ).toEqual([]);
  });
});
