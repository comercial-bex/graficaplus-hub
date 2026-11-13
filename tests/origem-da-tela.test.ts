import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alertaDoAnuncio,
  filtrarAnuncios,
  haQuantoTempo,
  ordenarAnuncios,
  prever,
  validarConjunto,
  validarIdDoAnuncio,
  type AnuncioOrdenavel,
} from "../src/domain/whatsapp/origem-da-tela";
import { getRoutePermissions } from "../src/lib/permissions";
import { FORA_DO_MENU } from "../src/lib/menu";
import { dicaMenu, dicaTela } from "../src/lib/dicas";

const AGORA = new Date("2026-11-12T12:00:00Z");
const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString();

const ad = (id: string, p: Partial<AnuncioOrdenavel> = {}): AnuncioOrdenavel => ({
  anuncio_id: id,
  ativo: true,
  ultima_vez: null,
  motivo_sem_tipo: "ok",
  ...p,
});

describe("haQuantoTempo", () => {
  it("diz a data em palavras", () => {
    expect(haQuantoTempo(null, AGORA)).toBe("nunca");
    expect(haQuantoTempo("lixo", AGORA)).toBe("nunca");
    expect(haQuantoTempo(dias(0), AGORA)).toBe("hoje");
    expect(haQuantoTempo(dias(1), AGORA)).toBe("ontem");
    expect(haQuantoTempo(dias(3), AGORA)).toBe("há 3 dias");
    expect(haQuantoTempo(dias(45), AGORA)).toBe("há 1 mês");
    expect(haQuantoTempo(dias(95), AGORA)).toBe("há 3 meses");
    expect(haQuantoTempo(dias(400), AGORA)).toBe("há 1 ano");
  });
  it("data no futuro não vira número negativo", () => {
    expect(haQuantoTempo(dias(-2), AGORA)).toBe("hoje");
  });
});

describe("ordenar e filtrar anúncios", () => {
  it("sem conjunto primeiro, depois a última vez mais recente, quem nunca chegou por último", () => {
    const lista = [
      ad("111111", { ultima_vez: dias(1) }),
      ad("222222", { ultima_vez: dias(5), motivo_sem_tipo: "sem_conjunto" }),
      ad("333333", { ultima_vez: null }),
      ad("444444", { ultima_vez: dias(0) }),
      ad("555555", { ultima_vez: dias(2), motivo_sem_tipo: "conjunto_inativo" }),
    ];
    expect(ordenarAnuncios(lista).map((a) => a.anuncio_id)).toEqual([
      "555555",
      "222222",
      "444444",
      "111111",
      "333333",
    ]);
  });
  it("não muda a lista original e desempata pelo id", () => {
    const lista = [ad("999999"), ad("100000")];
    const r = ordenarAnuncios(lista);
    expect(r.map((a) => a.anuncio_id)).toEqual(["100000", "999999"]);
    expect(lista[0].anuncio_id).toBe("999999");
  });
  it("pausados saem por padrão", () => {
    const lista = [ad("111111"), ad("222222", { ativo: false })];
    expect(filtrarAnuncios(lista, false).map((a) => a.anuncio_id)).toEqual(["111111"]);
    expect(filtrarAnuncios(lista, true)).toHaveLength(2);
  });
});

describe("alerta do anúncio", () => {
  it("só avisa quando falta conjunto utilizável, e o texto não revela preço", () => {
    expect(alertaDoAnuncio("ok")).toBeNull();
    for (const m of ["sem_conjunto", "conjunto_inativo", "conjunto_desconhecido"] as const) {
      const t = alertaDoAnuncio(m);
      expect(t, m).toBeTruthy();
      expect(t).toMatch(/Tipo a confirmar|tipo fica a confirmar/i);
    }
    expect(alertaDoAnuncio("sem_conjunto")).toContain("Anúncio sem conjunto.");
  });
});

describe("validações do formulário", () => {
  it("conjunto: id numérico, nome e tipo", () => {
    expect(validarConjunto({ conjuntoId: "120252255931120481", nome: "Cliente final", tipo: "cliente_final" })).toEqual({
      ok: true,
    });
    const r = validarConjunto({ conjuntoId: "abc", nome: "  ", tipo: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(["conjuntoId", "nome", "tipo"]);
  });
  it("id do anúncio", () => {
    expect(validarIdDoAnuncio("120252258241960481")).toBeNull();
    expect(validarIdDoAnuncio("AD-111")).toBeTruthy();
    expect(validarIdDoAnuncio("12345")).toBeTruthy();
  });
  it("palavra: mostra como será guardada, recusa curta e acusa repetida", () => {
    expect(prever("", [])).toEqual({ guardada: null, erro: null, repetida: false });
    expect(prever("  Quero SER Parceiro! ", []).guardada).toBe("quero ser parceiro");
    expect(prever("oi", []).erro).toBeTruthy();
    expect(prever("Parceria", ["parceria"]).repetida).toBe(true);
    expect(prever("Parcéria", ["parceria"]).repetida).toBe(true);
  });
});

describe("a tela e o registro da rota", () => {
  const tela = readFileSync("src/routes/_authenticated/configuracoes-origem.tsx", "utf8");

  it("reaproveita configuracoes.manage e fica fora do menu aprovado, com motivo", () => {
    expect(getRoutePermissions("/configuracoes-origem")).toEqual(["configuracoes.manage"]);
    expect(FORA_DO_MENU["/configuracoes-origem"]?.titulo).toBe("Origem dos contatos");
  });
  it("tem dica de tela e de menu", () => {
    expect(dicaMenu("/configuracoes-origem")).toBeTruthy();
    expect(dicaTela("/configuracoes-origem")).toContain("etiqueta");
    expect(tela).toContain('dicaTela("/configuracoes-origem")');
  });
  it("só chama as funções de servidor e nunca grava direto no banco", () => {
    expect(tela).not.toMatch(/supabase\.(from|rpc)|supabaseAdmin/);
    expect(tela).toContain("useServerFn(classificarAnuncio)");
    expect(tela).toContain("useServerFn(salvarConjunto)");
    expect(tela).toContain("useServerFn(salvarPalavra)");
  });
  it("texto da tela: sem revendedor, sem preço revelado ao cliente, sem travessão, seta ou title=", () => {
    expect(/revendedor/i.test(tela)).toBe(false);
    expect(/<(button|div|span|a|svg|input|select|li|p|label)\b[^>]*\stitle=/.test(tela)).toBe(false);
    const textos = [...tela.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)].map((m) => m[1]);
    for (const t of textos) {
      expect(t, t).not.toMatch(/[—–→←]/);
    }
  });
  it("letra mínima de 16 px: nada de text-xs, text-sm nem text-[1x px] menor", () => {
    expect(/\btext-(xs|sm)\b/.test(tela)).toBe(false);
    expect(/text-\[(\d+)px\]/.test(tela) ? Number(/text-\[(\d+)px\]/.exec(tela)![1]) >= 16 : true).toBe(true);
  });
  it("palavras: o dono escolhe o tipo com dois botões grandes e a lista mostra o tipo em texto", () => {
    expect(tela).toContain("Marca como cliente final");
    expect(tela).toContain("Marca como parceiro");
    expect(tela).toContain('adicionar("cliente_final")');
    expect(tela).toContain('adicionar("parceiro")');
    expect(tela).toContain("Marca como {rotuloDoTipo(p.tipo).toLowerCase()}");
    expect(tela).toContain("vence a de parceiro");
    // ligar e desligar não zeram o tipo da palavra
    expect(tela).toContain("mutacao.mutate({ palavra: p.palavra, tipo: p.tipo, ativo: !p.ativo })");
  });
  it("palavras: sem parênteses nos textos de tela", () => {
    const i = tela.indexOf("function BlocoPalavras");
    const textos = [...tela.slice(i).matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)].map((m) => m[1]);
    for (const t of textos.filter((x) => /^[A-ZÁÉÍÓÚ]/.test(x))) expect(t, t).not.toMatch(/[()]/);
  });
  it("erro de leitura e de gravação aparece em texto, sem engolir", () => {
    expect(tela).toContain("Não consegui carregar os anúncios");
    expect(tela).toContain("Não consegui carregar os conjuntos");
    expect(tela).toContain("Não consegui carregar as palavras");
    expect(/catch\s*\{\s*\}/.test(tela)).toBe(false);
    expect(tela.match(/onError/g)!.length).toBeGreaterThanOrEqual(6);
  });
  it("os textos exigidos pelo dono estão na tela", () => {
    for (const t of [
      "Anúncios que chegaram",
      "Conjuntos de anúncios",
      "Palavras que identificam o tipo",
      "O tipo vale para o conjunto inteiro.",
      "Nenhum anúncio chegou ainda.",
      "Nenhum conjunto cadastrado.",
      "Nenhuma palavra cadastrada.",
      "Para quem é",
      "Cadastrar anúncio pelo id",
      "Mostrar anúncios pausados",
    ]) {
      expect(tela, t).toContain(t);
    }
  });
  it("a página da empresa tem o caminho até ela", () => {
    const empresa = readFileSync("src/routes/_authenticated/configuracoes-empresa.tsx", "utf8");
    expect(empresa).toContain('to="/configuracoes-origem"');
  });
});
