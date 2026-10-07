import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A tela de entrada (/login), renderizada de verdade (HTML do servidor).
 *
 * O que ela promete e este teste segura:
 *   - os dois campos com rótulo, o botão de entrar, "Recuperar acesso" e
 *     "Solicitar registro" continuam lá, com os atributos que o gerenciador
 *     de senhas e o teclado do celular usam (autocomplete, inputmode);
 *   - a conferência antes do servidor aponta o campo certo, com a mensagem
 *     embaixo dele, e não inventa erro para e-mail bom;
 *   - a logo de fundo escuro existe e é a do painel escuro;
 *   - nenhuma cor fixa: o tema é a classe `dark` no <html>, trocada pelo
 *     ThemeToggle, e o que o formulário usa são os tokens (background, card,
 *     muted-foreground…), que mudam com ela. O painel da marca é a exceção
 *     de propósito: usa os tokens da barra lateral, escuros nos dois temas;
 *   - o rodapé não diz mais "SERVER_ON" nem versão inventada.
 *
 * O destino depois da senha certa é assunto de destino-apos-login.test.ts.
 */

const RAIZ = join(__dirname, "..");
const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (opcoes: Record<string, unknown>) => ({
    ...opcoes,
    useSearch: () => ({}),
  }),
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) =>
    createElement("a", { href: to, className }, children),
  useNavigate: () => () => undefined,
  useRouter: () => ({ history: { push: () => undefined } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: async () => {
        throw new Error("a renderização não fala com o servidor");
      },
      resetPasswordForEmail: async () => {
        throw new Error("a renderização não fala com o servidor");
      },
    },
  },
}));

// Tooltip do Radix exige provider; fora do assunto aqui.
vi.mock("@/components/bex/Dica", () => ({
  Dica: ({ children }: { children?: ReactNode }) => children,
  DicaIcone: () => null,
}));

import { Route } from "../src/routes/login";
import { LOGO_FUNDO_ESCURO } from "../src/lib/marca";
import { temErro, validarEntrada } from "../src/domain/acesso/formulario-de-entrada";

function renderizar(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Tela = (Route as any).component as () => ReactNode;
  return renderToStaticMarkup(createElement(Tela));
}

describe("a tela de entrada renderiza o que sempre teve", () => {
  const html = renderizar();

  it("e-mail e senha com rótulo, e os atributos do gerenciador de senhas", () => {
    expect(html).toMatch(/<label for="login-email"[^>]*>E-mail<\/label>/);
    expect(html).toMatch(/<label for="login-senha"[^>]*>Senha<\/label>/);
    const email = html.match(/<input[^>]*id="login-email"[^>]*>/)?.[0] ?? "";
    const senha = html.match(/<input[^>]*id="login-senha"[^>]*>/)?.[0] ?? "";
    // O renderizador do React 19 escreve inputMode/autoComplete em camelCase;
    // atributo HTML não distingue maiúscula, o navegador lê igual.
    expect(email).toContain('type="email"');
    expect(email).toMatch(/inputmode="email"/i);
    expect(email).toMatch(/autocomplete="username"/i);
    expect(email).toMatch(/autofocus/i);
    expect(senha).toContain('type="password"');
    expect(senha).toMatch(/autocomplete="current-password"/i);
    // Sem erro, o campo não está marcado como inválido (o atributo; a classe
    // `aria-invalid:` do Tailwind é só o estilo de quando ele existir).
    expect(email).not.toMatch(/aria-invalid="/);
    expect(senha).not.toMatch(/aria-invalid="/);
  });

  it("entrar, recuperar acesso, solicitar registro e o olho da senha", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*?Entrar[\s\S]*?<\/button>/);
    expect(html).toContain("Recuperar acesso");
    expect(html).toMatch(/<a href="\/signup"[^>]*>Solicitar registro<\/a>/);
    expect(html).toContain('aria-label="Mostrar senha"');
    expect(html).toContain('aria-pressed="false"');
    // A conferência é da tela, com a mensagem embaixo do campo.
    expect(html).toMatch(/<form[^>]*novalidate/i);
  });

  it("o painel escuro leva a logo de letras brancas", () => {
    expect(html).toMatch(new RegExp(`<img[^>]*src="${LOGO_FUNDO_ESCURO}"[^>]*alt="Bex Print"`));
    expect(html).toContain("Do orçamento à entrega");
  });

  it("o rodapé não finge telemetria", () => {
    for (const falso of ["SERVER_ON", "SECURE_AUTH", "V 4.2.0"]) {
      expect(html).not.toContain(falso);
    }
  });
});

describe("a conferência antes do servidor", () => {
  it("campo vazio aponta o campo, com a mensagem dele", () => {
    expect(validarEntrada("", "")).toEqual({
      email: "Informe o e-mail.",
      senha: "Informe a senha.",
    });
    expect(validarEntrada("   ", "x")).toEqual({ email: "Informe o e-mail." });
    expect(validarEntrada("a@b.com", "")).toEqual({ senha: "Informe a senha." });
  });

  it("e-mail pela metade não vai ao servidor", () => {
    for (const metade of [
      "harison",
      "harison@",
      "harison@bexprint",
      "@bexprint.com.br",
      "a b@c.com",
    ]) {
      expect(validarEntrada(metade, "x").email, metade).toMatch(/Confira o e-mail/);
    }
  });

  it("e-mail bom passa, mesmo com espaço nas pontas", () => {
    for (const bom of ["harison@bexprint.com.br", " vendas@gmail.com ", "a.b+c@d.co"]) {
      expect(validarEntrada(bom, "x"), bom).toEqual({});
    }
    expect(temErro({})).toBe(false);
    expect(temErro({ senha: "Informe a senha." })).toBe(true);
  });
});

describe("a tela funciona nos dois temas", () => {
  const arquivos = [
    "src/routes/login.tsx",
    "src/components/acesso/CampoDeAcesso.tsx",
    "src/components/acesso/PainelDaMarca.tsx",
  ];

  it("nenhuma cor fixa: só token do tema ou da marca", () => {
    for (const arquivo of arquivos) {
      const fonte = ler(arquivo);
      expect(fonte, `${arquivo}: cor em hexadecimal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(fonte, `${arquivo}: paleta crua do Tailwind`).not.toMatch(
        /\b(bg|text|border|from|to|via|ring|decoration)-(white|black|zinc|slate|gray|neutral|stone|red|rose|pink|blue|sky|cyan|emerald|green)\b/,
      );
    }
  });

  it("o formulário fica no fundo do conteúdo; o painel, nos tokens da barra lateral", () => {
    const login = ler("src/routes/login.tsx");
    expect(login).toMatch(/bg-background/);
    expect(login).toContain("<ThemeToggle />");
    const painel = ler("src/components/acesso/PainelDaMarca.tsx");
    expect(painel).toMatch(/bg-sidebar\b/);
    expect(painel).toMatch(/text-sidebar-foreground/);
    // O tema é a classe `dark` no <html>; o painel não depende dela.
    expect(painel).not.toMatch(/\bdark:/);
  });

  it("o celular rola a página: nada de altura travada que o teclado cubra", () => {
    const login = ler("src/routes/login.tsx");
    expect(login).toMatch(/min-h-dvh/);
    // altura mínima pode; altura fixa (h-screen, h-dvh) e overflow-hidden na página, não.
    expect(login).not.toMatch(/(?<!min-)\bh-screen\b|(?<!min-)\bh-dvh\b|overflow-hidden/);
  });
});

describe("a logo para fundo escuro", () => {
  const arquivo = readFileSync(join(RAIZ, "public", LOGO_FUNDO_ESCURO));

  it("existe em /public, é PNG com canal alfa e é a de letras brancas (larga)", () => {
    expect([...arquivo.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(arquivo[25]).toBe(6); // tipo de cor 6 = RGBA
    const largura = arquivo.readUInt32BE(16);
    const altura = arquivo.readUInt32BE(20);
    expect([largura, altura]).toEqual([1165, 532]);
  });

  it("só o painel escuro a usa; PDF e tela branca seguem com a de fundo claro", () => {
    expect(LOGO_FUNDO_ESCURO).toBe("/marca/bex-print-fundo-escuro.png");
    const pdf = ler("src/domain/parceiros/pdf.ts");
    expect(pdf).not.toContain("LOGO_FUNDO_ESCURO");
  });
});
