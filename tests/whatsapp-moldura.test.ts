import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LARGURA_DA_GAVETA,
  LARGURA_DA_LISTA,
  LARGURA_MINIMA_DA_CONVERSA,
  LIMITES_DA_CAIXA,
  TITULO_DA_CAIXA,
  horaDaLinha,
  larguraDaConversa,
  modoPelaLargura,
  tituloDaAba,
} from "../src/domain/whatsapp/moldura";
import { ehTelaCheia } from "../src/lib/tela-cheia";

/**
 * A moldura da caixa do WhatsApp (dono: MOLDURA, onda 1, 12/11/2026).
 *
 * Este arquivo guarda a garantia de fundo que tests/whatsapp-conversa-nao-
 * espremida.test.ts guardava com outra forma: a conversa nunca é espremida.
 * Antes (11/11/2026) a regra era "o painel só é coluna a partir de xl" e o
 * ponto de quebra olhava a JANELA; a 1280 px com o menu aberto a conversa ficava
 * com 244 px. Agora o ponto de quebra olha a LARGURA ÚTIL da área (consulta de
 * contêiner) e a conta está em `larguraDaConversa`.
 */

const ROTA = readFileSync("src/routes/_authenticated/whatsapp.tsx", "utf8");
const LAYOUT = readFileSync("src/routes/_authenticated/route.tsx", "utf8");
const LISTA = readFileSync("src/components/whatsapp/lista-de-conversas.tsx", "utf8");
const NOVA = readFileSync("src/components/whatsapp/nova-conversa.tsx", "utf8");
const ABAS = readFileSync("src/components/menu/abas-da-tela.tsx", "utf8");
const CONSULTAS = readFileSync("src/components/whatsapp/usar-caixa-de-entrada.ts", "utf8");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROTA_SEM = semComentarios(ROTA);
const LISTA_SEM = semComentarios(LISTA);
const NOVA_SEM = semComentarios(NOVA);

describe("os números do contêiner batem com as classes da tela", () => {
  it("o médio começa em LIMITES_DA_CAIXA.medio e o largo em LIMITES_DA_CAIXA.largo", () => {
    expect(ROTA_SEM).toContain("@container/caixa");
    expect(ROTA_SEM).toContain(`@min-[${LIMITES_DA_CAIXA.medio}px]/caixa:`);
    expect(ROTA_SEM).toContain(`@min-[${LIMITES_DA_CAIXA.largo}px]/caixa:`);
  });

  it("as colunas da grade são as larguras do contrato", () => {
    expect(ROTA_SEM).toContain(
      `@min-[${LIMITES_DA_CAIXA.medio}px]/caixa:grid-cols-[${LARGURA_DA_LISTA.medio}px_minmax(0,1fr)]`,
    );
    expect(ROTA_SEM).toContain(
      `@min-[${LIMITES_DA_CAIXA.largo}px]/caixa:grid-cols-[${LARGURA_DA_LISTA.largo}px_minmax(0,1fr)]`,
    );
    expect(ROTA_SEM).toContain(
      `@min-[${LIMITES_DA_CAIXA.largo}px]/caixa:grid-cols-[${LARGURA_DA_LISTA.largo}px_minmax(0,1fr)_${LARGURA_DA_GAVETA}px]`,
    );
  });

  it("construída de baixo para cima (@min): nenhum @max, que no Tailwind 4.2 erra o limite por 1 px", () => {
    expect(ROTA_SEM).not.toMatch(/@max-/);
  });

  it("nenhum ponto de quebra da JANELA decide as colunas (sm:, md:, lg:, xl: de grade)", () => {
    expect(ROTA_SEM).not.toMatch(/\b(sm|md|lg|xl|2xl):(grid-cols|col-span|flex|hidden|block)/);
  });
});

describe("a grade tem UMA linha explícita e nada espreme a conversa", () => {
  it("grid-rows-[minmax(0,1fr)] e nenhum col-span-2 (o defeito de 11/11 era a segunda linha implícita)", () => {
    expect(ROTA_SEM).toContain("grid-rows-[minmax(0,1fr)]");
    expect(ROTA_SEM).not.toMatch(/col-span-2/);
    expect(ROTA_SEM).not.toMatch(/row-span/);
  });

  it("nada de número mágico de altura", () => {
    for (const fonte of [ROTA_SEM, LISTA_SEM]) {
      expect(fonte).not.toMatch(/calc\(100d?vh-/);
      expect(fonte).not.toMatch(/\bh-\[calc\(/);
    }
    // A linha da lista tem 72 px de propósito (min-h-[72px], decisão 7); a tela, nenhum.
    expect(ROTA_SEM).not.toMatch(/\b(h|min-h|max-h)-\[\d+(px|rem|vh|dvh)\]/);
    expect(LISTA_SEM.match(/\b(h|min-h|max-h)-\[\d+(px|rem|vh|dvh)\]/g)).toEqual(["min-h-[72px]"]);
  });

  it("nada `fixed` dentro do contêiner de consulta (ele prenderia o filho)", () => {
    expect(ROTA_SEM).not.toMatch(/\bfixed\b/);
    expect(LISTA_SEM).not.toMatch(/\bfixed\b/);
  });

  it("o painel dos dados nunca vira coluna abaixo de 1280 px: no médio e no estreito é a gaveta por cima", () => {
    expect(ROTA_SEM).toContain("<GavetaDoContato");
    expect(ROTA_SEM).not.toContain("<PainelDaConversa");
  });

  it("a conversa tem 520 px ou mais em toda largura útil de 440 a 2200", () => {
    for (let w = 440; w <= 2200; w += 4) {
      for (const gaveta of [false, true]) {
        const modo = modoPelaLargura(w);
        if (modo === "estreito") continue; // uma peça por vez: a conversa tem a área toda
        expect(larguraDaConversa(w, gaveta), `${w}px, gaveta ${gaveta}`).toBeGreaterThanOrEqual(
          LARGURA_MINIMA_DA_CONVERSA,
        );
      }
    }
  });

  it("o caso do print do dono: 1280 px de janela com o menu aberto (952 úteis) dá 632 px, não 244", () => {
    expect(modoPelaLargura(952)).toBe("medio");
    expect(larguraDaConversa(952, false)).toBe(632);
  });

  it("a gaveta encaixada só tira largura da conversa no modo largo", () => {
    expect(larguraDaConversa(1302, true)).toBe(1302 - LARGURA_DA_LISTA.largo - LARGURA_DA_GAVETA);
    expect(larguraDaConversa(1000, true)).toBe(larguraDaConversa(1000, false));
  });
});

describe("tela cheia: a página não rola, quem rola é a lista e as mensagens", () => {
  it("ehTelaCheia: só /whatsapp (com ou sem barra no fim)", () => {
    expect(ehTelaCheia("/whatsapp")).toBe(true);
    expect(ehTelaCheia("/whatsapp/")).toBe(true);
    expect(ehTelaCheia("/whatsapp-monitor")).toBe(false);
    expect(ehTelaCheia("/whatsapp-fila-humana")).toBe(false);
    expect(ehTelaCheia("/dashboard")).toBe(false);
    expect(ehTelaCheia("/")).toBe(false);
  });

  it("a casca vira h-dvh com overflow-hidden e min-h-0 só quando é tela cheia", () => {
    expect(LAYOUT).toContain("const telaCheia = canAccessRoute && ehTelaCheia(pathname);");
    expect(LAYOUT).toContain('telaCheia ? "h-dvh overflow-hidden" : "min-h-screen"');
    expect(LAYOUT).toContain('telaCheia && "min-h-0"');
    expect(LAYOUT).toContain('"relative flex min-h-0 flex-col overflow-hidden p-0"');
    // As outras telas ficam como estavam.
    expect(LAYOUT).toContain('"p-4 md:p-7 lg:p-8 overflow-auto"');
  });

  it("o <main> é posicionado: o texto sr-only de dentro das listas não escapa e faz a PÁGINA rolar", () => {
    // Medido no laboratório em 12/11/2026: sem `relative`, 8 spans sr-only das
    // linhas da lista davam 1144 px de rolagem à página numa janela de 800 px.
    expect(LAYOUT).toMatch(/relative flex min-h-0 flex-col overflow-hidden p-0/);
    expect(LISTA_SEM).toContain("relative min-h-0 flex-1 overflow-y-auto");
  });

  it("o layout continua com as abas seguidas da tela (teste do menu)", () => {
    expect(LAYOUT).toMatch(/<AbasDaTela \/>\s*<Outlet \/>/);
  });

  it("a raiz da tela e o contêiner ocupam o que sobra, com min-h-0", () => {
    expect(ROTA_SEM).toContain('"flex min-h-0 flex-1 flex-col"');
    expect(ROTA_SEM).toContain("@container/caixa flex min-h-0 min-w-0 flex-1 flex-col");
  });

  it("quem rola: a lista de linhas (overflow-y-auto) e a lista nunca estica a coluna", () => {
    expect(LISTA_SEM).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(LISTA_SEM).toContain("flex min-h-0 flex-col");
  });

  it("no celular com a conversa aberta as abas somem; ao fechar voltam", () => {
    expect(ROTA_SEM).toContain('definirAbasEscondidas(modo === "estreito" && haConversa)');
    expect(ROTA_SEM).toContain("return () => definirAbasEscondidas(false)");
    expect(ABAS).toContain("if (cheia && escondidas) return null;");
  });

  it("as abas do hub ficam numa linha só, de 44 px, sem margem, nas telas cheias", () => {
    expect(ABAS).toContain("compacta?: boolean");
    expect(ABAS).toContain('"shrink-0 bg-card px-2"');
    expect(ABAS).toContain("h-11");
    expect(ABAS).toContain('!compacta && "md:h-10"');
    expect(ABAS).toContain("overflow-x-auto");
  });
});

describe("o cabeçalho grande saiu", () => {
  it("a tela não usa SectionHeader nem repete os botões que são abas do hub", () => {
    expect(ROTA_SEM).not.toContain("SectionHeader");
    expect(ROTA_SEM).not.toContain("breadcrumb");
    expect(ROTA_SEM).not.toContain("Atendimento · Caixa de entrada");
  });

  it("Respostas rápidas e Monitor continuam no menu de três pontos da lista", () => {
    expect(LISTA_SEM).toContain("Respostas rápidas");
    expect(LISTA_SEM).toContain("Monitor do WhatsApp");
    expect(LISTA_SEM).toContain("Atalhos do teclado");
  });

  it("a explicação da tela vai para um botão ? de 44 px, que abre no toque também (Popover)", () => {
    expect(LISTA_SEM).toContain('aria-label="Ajuda da caixa de entrada"');
    expect(LISTA_SEM).toContain('dicaTela("/whatsapp")');
    expect(LISTA_SEM).toContain("<Popover>");
  });

  it("o estado da conexão é um ponto com texto curto; desconectado vira o link Conectar", () => {
    expect(LISTA_SEM).toContain('"Conectado"');
    expect(LISTA_SEM).toContain("Conectar");
    expect(ROTA_SEM).toContain('abre("/whatsapp-monitor") && !!principal && principal.conectado !== true');
  });
});

describe("a lista no jeito do WhatsApp", () => {
  it("todos os botões novos têm alvo de 44 px (size-11, h-11 ou min-h-11)", () => {
    expect(LISTA_SEM.match(/size-11/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // ? e três pontos
    expect(NOVA_SEM).toContain('className="size-11"');
    // chips: o botão tem 44 px de altura; a pílula de dentro é só desenho
    expect(LISTA_SEM).toMatch(/group flex h-11 shrink-0/);
    expect(LISTA_SEM).toContain("min-h-[72px]");
    expect(LISTA_SEM).toContain("size-12 shrink-0"); // foto de 48 px
  });

  it("nome da conversa de 16 px (text-base) e hora de 13 px (text-xs), nada abaixo de 12 px", () => {
    expect(LISTA_SEM).toMatch(/truncate text-base/);
    expect(LISTA_SEM).not.toMatch(/text-\[(\d|1[01])px\]/);
  });

  it("UMA fileira de seis chips, e o filtro de fila só quando há mais de uma fila", () => {
    expect(LISTA_SEM).toContain("CHIPS_DA_LISTA.map");
    expect(LISTA_SEM).toContain("mostrarFiltroDeFila({");
    expect(LISTA_SEM).toContain("{mostrarFila && (");
  });

  it("o contador de não lidas é o verde escuro com número branco, nunca o verde claro", () => {
    expect(LISTA_SEM).toContain("bg-chat-contador");
    expect(LISTA_SEM).toContain("text-chat-contador-texto");
    expect(LISTA_SEM).not.toMatch(/25d366/i);
    expect(LISTA_SEM).not.toMatch(/bg-positive/);
  });

  it("o rascunho aparece na linha, e só a linha daquela conversa muda (memo)", () => {
    expect(LISTA_SEM).toContain("Rascunho:");
    expect(LISTA_SEM).toContain("useRascunhos()");
    expect(LISTA_SEM).toContain("memo(function LinhaDaConversa");
    expect(LISTA_SEM).toContain('rascunho={rascunhos.get(c.id) ?? ""}');
  });

  it("o tique vem da última mensagem NOSSA; sem a resposta, sem tique (nada inventado)", () => {
    expect(LISTA_SEM).toContain("{ultima && <TiqueDaMensagem");
    expect(CONSULTAS).toContain('.select("conversa_id, direcao, status, created_at")');
  });

  it("o ícone do tipo da mensagem vem de previaDaConversa, sem colchete", () => {
    expect(LISTA_SEM).toContain("previaDaConversa(c.ultima_mensagem)");
    expect(LISTA_SEM).toContain("{previa.texto}");
    expect(LISTA_SEM).not.toContain("resumoDaConversa");
  });

  it("sem title= e sem <title> de SVG (a ajuda vai pela Dica ou pelo Popover)", () => {
    expect(LISTA_SEM).not.toMatch(/<title\b/);
    expect(LISTA_SEM).not.toMatch(/\btitle=/);
  });

  it("sem grupos de dia na lista (a hora vem na linha)", () => {
    expect(LISTA_SEM).not.toContain("agruparPorDia");
  });

  it("a tecla N saiu: nenhum ouvinte de letra solta na nova conversa nem na tela", () => {
    expect(NOVA_SEM).not.toMatch(/addEventListener\(["']keydown/);
    expect(NOVA_SEM).not.toContain("useAtalhoNovaConversa");
    expect(ROTA_SEM).not.toContain("useAtalhoNovaConversa");
    expect(NOVA_SEM).not.toMatch(/toLowerCase\(\) !== "n"/);
  });
});

describe("sem travessão nem seta nas frases à vista", () => {
  const ARQUIVOS: [string, string][] = [
    ["whatsapp.tsx", ROTA_SEM],
    ["lista-de-conversas.tsx", LISTA_SEM],
    ["nova-conversa.tsx", NOVA_SEM],
    ["abas-da-tela.tsx", semComentarios(ABAS)],
    ["usar-caixa-de-entrada.ts", semComentarios(CONSULTAS)],
    ["moldura.ts", semComentarios(readFileSync("src/domain/whatsapp/moldura.ts", "utf8"))],
    ["filtros-da-lista.ts", semComentarios(readFileSync("src/domain/whatsapp/filtros-da-lista.ts", "utf8"))],
  ];
  it.each(ARQUIVOS)("%s", (_nome, fonte) => {
    expect(fonte).not.toMatch(/[—–→←⇒]/);
  });

  it("as dicas da moldura também", () => {
    const dicas = readFileSync("src/lib/dicas.ts", "utf8");
    const bloco = dicas.slice(
      dicas.indexOf("/* ---- início MOLDURA ---- */"),
      dicas.indexOf("/* ---- fim MOLDURA ---- */"),
    );
    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).not.toMatch(/[—–→←⇒]/);
    expect(semComentarios(dicas)).not.toMatch(/tecla N/);
  });

  it("o título da rota usa ponto médio", () => {
    expect(ROTA).toContain("meta: [{ title: TITULO_DA_CAIXA }]");
    expect(TITULO_DA_CAIXA).toBe("WhatsApp · BEX PRINT OS");
  });
});

describe("título da aba com as conversas não lidas", () => {
  it("(N) WhatsApp · BEX PRINT OS, com N de CONVERSAS", () => {
    expect(tituloDaAba(0)).toBe("WhatsApp · BEX PRINT OS");
    expect(tituloDaAba(3)).toBe("(3) WhatsApp · BEX PRINT OS");
    expect(tituloDaAba(150)).toBe("(99+) WhatsApp · BEX PRINT OS");
    expect(tituloDaAba(-2)).toBe("WhatsApp · BEX PRINT OS");
    expect(tituloDaAba(Number.NaN)).toBe("WhatsApp · BEX PRINT OS");
  });

  it("a tela usa a conta do chip e só restaura o título que ela mesma escreveu", () => {
    expect(ROTA_SEM).toContain("useTituloDaAba(contarNaoLidas(naoLidasPorMim.data))");
    const hook = readFileSync("src/components/whatsapp/usar-titulo-da-aba.ts", "utf8");
    expect(hook).toContain("if (document.title === escrito) document.title = TITULO_DA_CAIXA;");
  });
});

describe("Esc fecha a camada de cima; sem nada por cima, a conversa", () => {
  it("um ouvinte só, na janela, que respeita quem já consumiu o Esc", () => {
    expect(ROTA_SEM).toContain("escFechaAConversa(e, document)");
    expect(ROTA_SEM).toContain('window.addEventListener("keydown", aoTeclar)');
  });

  it("no largo, com a coluna encaixada aberta, o primeiro Esc fecha a coluna e o segundo a conversa", () => {
    const i = ROTA_SEM.indexOf("function aoTeclar");
    const corpo = ROTA_SEM.slice(i, ROTA_SEM.indexOf('window.addEventListener("keydown"', i));
    const daGaveta = corpo.indexOf('modo === "largo" && dadosLargo');
    const daConversa = corpo.indexOf("fecharConversa()");
    expect(daGaveta).toBeGreaterThan(-1);
    expect(daConversa).toBeGreaterThan(daGaveta);
  });

  it("ao fechar, o foco volta à linha da conversa", () => {
    expect(ROTA_SEM).toContain("[data-conversa-id=");
    expect(LISTA_SEM).toContain("data-conversa-id={c.id}");
  });

  it("Esc na busca com texto limpa a busca e não fecha a conversa", () => {
    expect(LISTA_SEM).toContain('e.key === "Escape" && busca');
    expect(LISTA_SEM).toContain('onBusca("")');
  });
});

describe("os dados do contato", () => {
  it("começam fechados em todos os modos; só o largo lembra (localStorage em try/catch)", () => {
    expect(ROTA_SEM).toContain("useState(false)"); // dadosPorCima
    expect(ROTA_SEM).toContain('=== "1"');
    expect(ROTA_SEM).toMatch(/try \{[\s\S]*localStorage[\s\S]*\} catch/);
    expect(readFileSync("src/domain/whatsapp/moldura.ts", "utf8")).toContain(
      'CHAVE_DOS_DADOS_DO_CONTATO = "wa-dados-do-contato"',
    );
  });

  it("a tela não passa as props antigas (painelAberto, onAlternarPainel, acoes) à conversa", () => {
    expect(ROTA_SEM).not.toContain("painelAberto");
    expect(ROTA_SEM).not.toContain("onAlternarPainel");
    expect(ROTA_SEM).not.toMatch(/\bacoes=/);
  });

  it("os diálogos de trabalho ficam montados com a conversa", () => {
    expect(ROTA_SEM).toContain("<DialogosDaConversa");
    expect(ROTA_SEM).toContain("key={selecionada.id}");
  });
});

describe("o chip Não lidas", () => {
  it("é aplicado dentro de filtrarConsulta, e lista vazia significa nenhuma conversa (nunca todas)", () => {
    expect(CONSULTAS).toContain("naoLidasIds?: string[];");
    expect(CONSULTAS).toContain("if (f.naoLidasIds) {");
    expect(CONSULTAS).toContain('["00000000-0000-0000-0000-000000000000"]');
    // Os testes de cliente-sem-duplicata prendem estas duas linhas como estão.
    expect(CONSULTAS).toContain("q = filtrarConsulta(q, f, clientesDaBusca);");
    expect(CONSULTAS).toContain("async function clientesComONome(");
  });

  it("os ids se acumulam enquanto o chip está ativo: a conversa recém-lida não some debaixo do dedo", () => {
    expect(ROTA_SEM).toContain("acumuladas.current.add(id)");
  });
});

describe("horaDaLinha: hora, Ontem ou a data, sempre no fuso de Belém", () => {
  const agora = new Date("2026-11-12T15:00:00Z"); // 12:00 em Belém
  it("hoje mostra a hora", () => {
    expect(horaDaLinha("2026-11-12T14:32:00Z", agora)).toBe("11:32");
  });
  it("o dia anterior no calendário de Belém é Ontem (02:00 UTC ainda é a noite de ontem)", () => {
    expect(horaDaLinha("2026-11-12T02:00:00Z", agora)).toBe("Ontem");
    expect(horaDaLinha("2026-11-11T20:00:00Z", agora)).toBe("Ontem");
  });
  it("antes disso, a data completa", () => {
    expect(horaDaLinha("2026-10-30T12:00:00Z", agora)).toBe("30/10/2026");
    expect(horaDaLinha("2026-11-10T12:00:00Z", agora)).toBe("10/11/2026");
  });
  it("virada de mês e de ano", () => {
    expect(horaDaLinha("2026-12-31T20:00:00Z", new Date("2027-01-01T15:00:00Z"))).toBe("Ontem");
    expect(horaDaLinha("2026-10-31T20:00:00Z", new Date("2026-11-01T15:00:00Z"))).toBe("Ontem");
  });
  it("sem data ou com data inválida, vazio", () => {
    expect(horaDaLinha(null, agora)).toBe("");
    expect(horaDaLinha("lixo", agora)).toBe("");
  });
});
