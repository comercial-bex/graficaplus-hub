import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { destinoInterno, destinoParaLevarAoLogin } from "../src/domain/acesso/destino-apos-login";
import { codigoDaBusca, formatarCodigo, urlDeAprovacao } from "../src/domain/tv/pareamento";

/**
 * O link que sobrevive ao login.
 *
 * O caso que fez isto nascer: o admin aponta a câmera do celular para o QR da
 * TV da Oficina, o Safari abre sem sessão, ele digita a senha — e caía no
 * Início, sem o código da TV. O guarda mandava para /login sem dizer de onde
 * a pessoa vinha, e o login mandava sempre para /dashboard.
 *
 * Duas coisas são conferidas aqui: que o destino faz a viagem inteira sem se
 * estragar, e que só caminho deste site é aceito como destino (login que
 * obedece `?destino=https://outro.site` é isca de senha).
 */

describe("o que pode ser destino", () => {
  it("caminho deste site passa, com busca e âncora", () => {
    expect(destinoInterno("/telas")).toBe("/telas");
    expect(destinoInterno("/telas?codigo=K7M_Q2X")).toBe("/telas?codigo=K7M_Q2X");
    expect(destinoInterno("/os/123#apontamentos")).toBe("/os/123#apontamentos");
    expect(destinoInterno("/dashboard")).toBe("/dashboard");
  });

  it("endereço de outro site não passa, em nenhum dos disfarces", () => {
    for (const isca of [
      "https://outro.site/telas",
      "http://outro.site",
      "//outro.site/telas",
      "/\\outro.site",
      "/\\/outro.site",
      "\\\\outro.site",
      "javascript:alert(1)",
      "data:text/html,oi",
      "outro.site",
      "telas",
      " /telas",
      "/telas\n//outro.site",
      "/\t/outro.site",
      "/telas\\..\\..",
    ]) {
      expect(destinoInterno(isca), JSON.stringify(isca)).toBeNull();
    }
  });

  it("o que não é texto, ou é grande demais, não passa", () => {
    for (const lixo of [undefined, null, 42, true, {}, ["/telas"], ""]) {
      expect(destinoInterno(lixo), JSON.stringify(lixo)).toBeNull();
    }
    expect(destinoInterno(`/${"a".repeat(600)}`)).toBeNull();
  });

  it("voltar para a própria tela de entrada seria um laço", () => {
    for (const tela of ["/login", "/login?destino=%2Ftelas", "/signup", "/reset-password"]) {
      expect(destinoInterno(tela), tela).toBeNull();
    }
    // Nome parecido não é a tela de entrada.
    expect(destinoInterno("/logins")).toBe("/logins");
  });

  it("o Início não vai na URL do login: é para lá que ele já cai", () => {
    expect(destinoParaLevarAoLogin("/dashboard")).toBeNull();
    expect(destinoParaLevarAoLogin("/dashboard/")).toBeNull();
    expect(destinoParaLevarAoLogin("/")).toBeNull();
    expect(destinoParaLevarAoLogin("/dashboard?aba=hoje")).toBeNull();
    expect(destinoParaLevarAoLogin("/telas?codigo=K7M_Q2X")).toBe("/telas?codigo=K7M_Q2X");
    expect(destinoParaLevarAoLogin("https://outro.site")).toBeNull();
  });
});

describe("o QR da TV lido sem sessão chega a /telas com o código", () => {
  /**
   * A viagem inteira, com o parser e o escritor de busca de verdade do roteador:
   * QR → /telas?codigo= → guarda → /login?destino= → senha → /telas?codigo=.
   */
  function viagem(codigo: string): string | undefined {
    const qr = new URL(urlDeAprovacao("https://print.exemplo.com", codigo));
    // O que o guarda lê em `location.href` é o caminho mais a busca reescrita.
    const href = `${qr.pathname}${defaultStringifySearch(defaultParseSearch(qr.search))}`;
    const levado = destinoParaLevarAoLogin(href);
    if (!levado) return undefined;
    // navigate({ to: "/login", search: { destino } }) → URL do login → validateSearch.
    const urlDoLogin = `/login${defaultStringifySearch({ destino: levado })}`;
    const destino = destinoInterno(
      defaultParseSearch(urlDoLogin.slice(urlDoLogin.indexOf("?"))).destino,
    );
    if (!destino) return undefined;
    // history.push(destino) → /telas lê a busca de novo.
    const volta = new URL(destino, "https://print.exemplo.com");
    expect(volta.pathname).toBe("/telas");
    return codigoDaBusca(defaultParseSearch(volta.search).codigo);
  }

  it("o código chega igual ao que saiu da TV", () => {
    // Inclui os que JSON.parse leria como número se viajassem crus.
    for (const codigo of ["K7MQ2X", "234E56", "22E222", "2E5678", "234567", "ABCDEF"]) {
      expect(formatarCodigo(viagem(codigo) ?? ""), codigo).toBe(formatarCodigo(codigo));
    }
  });
});

describe("o guarda e o login estão ligados a isto", () => {
  const ler = (caminho: string) => readFileSync(resolve(__dirname, "..", caminho), "utf8");

  it("o guarda leva o destino ao login — e só de quem CHEGOU, não de quem saiu", () => {
    const guarda = ler("src/routes/_authenticated/route.tsx");
    expect(guarda).toMatch(/destinoParaLevarAoLogin\(href\)/);
    expect(guarda).toMatch(/to: "\/login", search: destino \? \{ destino \} : \{\}/);
    // Quem saiu não deixa a tela dele para o próximo que entrar neste aparelho.
    expect(guarda).toMatch(/jaEsteveLogado\.current \? null : destinoParaLevarAoLogin\(href\)/);
    expect(guarda).not.toMatch(/navigate\(\{ to: "\/login" \}\)/);
  });

  it("o login volta para o destino, conferido, e sem destino cai no Início", () => {
    const login = ler("src/routes/login.tsx");
    // Conferido na entrada (validateSearch) e de novo na hora de usar.
    expect([...login.matchAll(/destinoInterno\(/g)].length).toBeGreaterThanOrEqual(2);
    expect(login).toMatch(/if \(destino\) router\.history\.push\(destino\);/);
    expect(login).toMatch(/else navigate\(\{ to: "\/dashboard" \}\)/);
    // O destino nunca é entregue ao navegador como endereço completo.
    expect(login).not.toMatch(/window\.location\.(href|assign|replace)\s*[=(]/);
  });
});
