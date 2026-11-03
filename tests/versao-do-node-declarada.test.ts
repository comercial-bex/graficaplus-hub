import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PACOTE = JSON.parse(readFileSync("package.json", "utf8"));

describe("alvo de versão declarado", () => {
  it("o Node mínimo está no package.json (Vite 7 pede 20.19 ou mais)", () => {
    expect(PACOTE.engines?.node).toBe(">=20.19.0");
  });

  // Medido em 03/11/2026 (Tailwind compilado + lightningcss): declarar `browserslist` com Chrome 111 /
  // Safari 16.4 / Firefox 128 achata o aninhamento de CSS (+3% de tamanho, muda a especificidade) em
  // todo o app, e o build local não roda para conferir o visual. O alvo de navegador fica de fora de
  // propósito até haver um build verificável; quem declarar um precisa comparar o CSS antes e depois.
  it("não declara browserslist sem conferir o CSS", () => {
    expect(PACOTE.browserslist).toBeUndefined();
  });
});
