import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lerEstadoDoMenu, lerEstadoDoMenuNoNavegador } from "../src/lib/estado-do-menu";

/**
 * O menu lateral lembra a escolha (12/11/2026, decisão 4 do dono). O
 * SidebarProvider gravava o cookie `sidebar_state` desde sempre e nunca o lia.
 */
describe("lerEstadoDoMenu", () => {
  it("acha o valor entre os outros cookies", () => {
    expect(lerEstadoDoMenu("a=1; sidebar_state=false; b=2")).toBe(false);
    expect(lerEstadoDoMenu("sidebar_state=true")).toBe(true);
    expect(lerEstadoDoMenu("x=y;sidebar_state=true;z=w")).toBe(true);
  });

  it("vazio, ausente, lixo e valor estranho dão null (a tela usa o padrão)", () => {
    expect(lerEstadoDoMenu("")).toBeNull();
    expect(lerEstadoDoMenu("a=1; b=2")).toBeNull();
    expect(lerEstadoDoMenu("sidebar_state=talvez")).toBeNull();
    expect(lerEstadoDoMenu("sidebar_state=")).toBeNull();
    expect(lerEstadoDoMenu("sidebar_state")).toBeNull();
    expect(lerEstadoDoMenu(";;;")).toBeNull();
  });

  it("não confunde com cookie de nome parecido", () => {
    expect(lerEstadoDoMenu("meu_sidebar_state=false")).toBeNull();
    expect(lerEstadoDoMenu("sidebar_state_2=false")).toBeNull();
  });

  it("em node (sem document) devolve null, como os testes do menu precisam", () => {
    expect(lerEstadoDoMenuNoNavegador()).toBeNull();
  });
});

describe("o provedor do menu lê o cookie ao nascer", () => {
  const SIDEBAR = readFileSync("src/components/ui/sidebar.tsx", "utf8");
  it("o estado inicial vem do cookie, com o padrão como reserva", () => {
    expect(SIDEBAR).toContain("React.useState(() => lerEstadoDoMenuNoNavegador() ?? defaultOpen)");
  });
  it("o nome do cookie lido é o mesmo que é gravado", () => {
    expect(SIDEBAR).toContain('const SIDEBAR_COOKIE_NAME = "sidebar_state";');
    expect(readFileSync("src/lib/estado-do-menu.ts", "utf8")).toContain('const NOME_DO_COOKIE = "sidebar_state";');
  });
});
