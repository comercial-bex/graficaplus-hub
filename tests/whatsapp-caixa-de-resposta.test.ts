import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A caixa de resposta e o orquestrador da conversa (onda 1, 12/11/2026, dono
 * CONVERSA). Sem jsdom: as garantias de tela se prendem lendo o código. A lógica
 * do teclado em si está em tests/whatsapp-teclado.test.ts.
 */

const CAIXA = readFileSync("src/components/whatsapp/caixa-de-resposta.tsx", "utf8");
const CONVERSA = readFileSync("src/components/whatsapp/conversa-aberta.tsx", "utf8");
const CABECALHO = readFileSync("src/components/whatsapp/cabecalho-da-conversa.tsx", "utf8");
const MENU_DE_RESPOSTAS = readFileSync("src/components/whatsapp/respostas-rapidas-menu.tsx", "utf8");
const ACOES = readFileSync("src/components/whatsapp/acoes-da-conversa.tsx", "utf8");
const BOLHA = readFileSync("src/components/whatsapp/bolha-da-mensagem.tsx", "utf8");
const LINHA = readFileSync("src/components/whatsapp/linha-do-tempo.tsx", "utf8");
const ARQUIVOS = { CAIXA, CONVERSA, CABECALHO, MENU_DE_RESPOSTAS, ACOES, BOLHA, LINHA };

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** As aberturas de `<Button ...>` (até o `>` fora de chaves e aspas). */
function botoes(fonte: string): string[] {
  const saida: string[] = [];
  let i = fonte.indexOf("<Button");
  while (i >= 0) {
    let fundo = 0;
    let aspas: string | null = null;
    let j = i + 7;
    for (; j < fonte.length; j++) {
      const c = fonte[j];
      if (aspas) {
        if (c === aspas) aspas = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") aspas = c;
      else if (c === "{") fundo++;
      else if (c === "}") fundo--;
      else if (c === ">" && fundo === 0 && fonte[j - 1] !== "=") break;
    }
    saida.push(fonte.slice(i, j + 1));
    i = fonte.indexOf("<Button", j);
  }
  return saida;
}

describe("a caixa de resposta", () => {
  it("o [+] tem Documento ou foto e Nota interna (e Orçamento e OS), de 44 px", () => {
    for (const rotulo of ["Documento ou foto", "Nota interna", "Criar orçamento", "Criar OS"])
      expect(CAIXA, rotulo).toContain(rotulo);
    expect(CAIXA).toMatch(/aria-label="Mais: documento ou foto, orçamento, OS e nota interna"/);
    expect(CAIXA).toMatch(/size="icon"\s+className="size-11 shrink-0 rounded-full"\s+aria-label="Mais:/);
  });

  it("Enviar tem 44 px e nome para o leitor de tela", () => {
    expect(CAIXA).toMatch(/"h-11 shrink-0 rounded-full"/);
    expect(CAIXA).toMatch(/"w-11 px-0"/);
    expect(CAIXA).toContain("aria-label={rotuloDoEnvio}");
    expect(CAIXA).toContain('const rotuloDoEnvio = nota ? "Gravar nota" : "Enviar";');
  });

  it("todo botão novo da conversa tem 44 px de alto (h-11 ou size-11)", () => {
    const fora: string[] = [];
    for (const [nome, fonte] of Object.entries({ CAIXA, CABECALHO, BOLHA, LINHA })) {
      for (const b of botoes(fonte)) {
        if (!/\b(h-11|size-11)\b/.test(b)) fora.push(`${nome}: ${b.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
    expect(fora).toEqual([]);
    expect(MENU_DE_RESPOSTAS).toContain('className={cn("size-11 shrink-0", className)}');
  });

  it("a caixa cresce com o texto (de uma linha até seis) usando a regra do domínio", () => {
    expect(CAIXA).toContain("alturaDaCaixa(");
    expect(CAIXA).toContain("rows={1}");
    expect(CAIXA).toMatch(/text-base leading-6/);
  });

  it("o texto é lido em 16 px e nenhuma classe abaixo de 12 px entra", () => {
    for (const [nome, fonte] of Object.entries(ARQUIVOS))
      expect(fonte, nome).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
  });
});

describe('a lista do "/" e o Enter', () => {
  const codigo = semComentarios(CAIXA);

  it("a lista tem papel de lista de opções e o teclado vem da regra do domínio", () => {
    expect(codigo).toContain('role="listbox"');
    expect(codigo).toContain('role="option"');
    expect(codigo).toContain("oQueATeclaFazNaLista(tecla)");
    expect(codigo).toContain("andarNaLista(");
  });

  it("com a lista aberta o Enter é tratado ANTES da regra do envio e nunca envia", () => {
    const lista = codigo.indexOf("if (listaAberta) {");
    const enter = codigo.indexOf("oQueOEnterFaz(tecla,");
    expect(lista).toBeGreaterThan(0);
    expect(enter).toBeGreaterThan(lista);
    // O ramo da lista termina com return antes de chegar ao envio.
    const ramo = codigo.slice(lista, enter);
    expect(ramo).toContain("return;");
    expect(ramo).not.toContain("onEnviar");
    expect(ramo).not.toContain("pedirEnvio");
  });

  it('só há dois caminhos até o envio: o botão/Enter (com a guarda do "/") e a confirmação', () => {
    const chamadas = codigo.match(/onEnviar\(/g) ?? [];
    expect(chamadas).toHaveLength(2);
    expect(codigo).toContain("onEnviar({ confirmouBarra: true })");
    expect(codigo).toMatch(
      /if \(precisaConfirmarBarra\(texto, nota\)\) setConfirmarBarra\(true\);\s*else onEnviar\(\);/,
    );
  });

  it('o orquestrador também recusa texto que começa com "/" sem confirmação', () => {
    expect(semComentarios(CONVERSA)).toContain(
      "if (precisaConfirmarBarra(limpo) && !opcoes?.confirmouBarra) return;",
    );
  });

  it('a confirmação é um AlertDialog do sistema ("Enviar mesmo assim"), nunca confirm() do navegador', () => {
    expect(codigo).toContain("<AlertDialog open={confirmarBarra}");
    expect(codigo).toContain("Enviar mesmo assim");
    expect(codigo).toContain("O texto começa com /");
    expect(codigo).not.toMatch(/(?<![\w.])confirm\(/);
  });

  it("o toque (pointer: coarse) é lido e passado à regra do Enter", () => {
    expect(codigo).toContain('"(pointer: coarse)"');
    expect(codigo).toMatch(/oQueOEnterFaz\(tecla, \{ listaDaBarraAberta: false, toque, texto, nota \}\)/);
  });

  it("a composição de acento chega à regra (isComposing e keyCode)", () => {
    expect(codigo).toContain("isComposing: e.nativeEvent.isComposing");
    expect(codigo).toContain("keyCode: e.keyCode");
  });

  it("o Esc da lista é consumido (preventDefault), para a moldura não fechar a conversa junto", () => {
    const ramo = codigo.slice(codigo.indexOf("if (listaAberta) {"), codigo.indexOf("oQueOEnterFaz(tecla,"));
    expect(ramo).toContain("e.preventDefault()");
    expect(ramo).toContain('acao === "fechar"');
  });
});

describe("a letra digitada vai para a caixa", () => {
  const codigo = semComentarios(CAIXA);
  it("escuta o teclado da janela, respeita diálogo aberto e não perde o caractere", () => {
    expect(codigo).toContain('window.addEventListener("keydown", aoTeclar)');
    expect(codigo).toContain("letraVaiParaACaixa(e, e.target, haCamadaPorCima(document))");
    expect(codigo).toContain("e.preventDefault();");
    expect(codigo).toContain("gravarRascunho(chave, novo)");
    expect(codigo).toContain('window.removeEventListener("keydown", aoTeclar)');
  });
  it("saíram as teclas soltas R, T, E e N", () => {
    for (const [nome, fonte] of Object.entries(ARQUIVOS)) {
      expect(semComentarios(fonte), nome).not.toContain("useAtalhosDaConversa");
      expect(semComentarios(fonte), nome).not.toContain("useAtalhoNovaConversa");
    }
    expect(ACOES).toContain('export { digitando } from "@/domain/whatsapp/teclado"');
  });
});

describe("o rascunho por conversa", () => {
  it("o texto mora em rascunhos.ts, não no estado da conversa, e trocar de conversa não o apaga", () => {
    expect(CAIXA).toContain("useRascunho(chave)");
    expect(CONVERSA).toContain("lerRascunho(chaveDoRascunho(conversa.id");
    expect(CONVERSA).toContain('gravarRascunho(chaveDoRascunho(conversa.id, modo === "nota"), "")');
    expect(semComentarios(CONVERSA)).not.toMatch(/useState<string>\(""\)|const \[texto,/);
  });
  it("enviar só apaga o rascunho depois que a mensagem entrou na fila", () => {
    const enviar = CONVERSA.slice(CONVERSA.indexOf("async function enviar("), CONVERSA.indexOf("async function anexar("));
    expect(enviar.indexOf("enfileirarResposta(")).toBeGreaterThan(0);
    expect(enviar.indexOf("apagarRascunho()", enviar.indexOf("enfileirarResposta("))).toBeGreaterThan(
      enviar.indexOf("enfileirarResposta("),
    );
    // Se a fila recusa, o texto continua na caixa (o return vem antes do apagar).
    const aposRecusa = enviar.slice(enviar.indexOf("toast.error(mensagemErro(e));", enviar.indexOf("enfileirarResposta(")));
    expect(aposRecusa.indexOf("return;")).toBeLessThan(aposRecusa.indexOf("apagarRascunho()"));
  });
});

describe("a nota interna continua existindo", () => {
  it("dentro do [+], com a caixa amarela e o [x] para voltar", () => {
    expect(CAIXA).toContain('onModo("nota")');
    expect(CAIXA).toContain("bg-chat-nota");
    expect(CAIXA).toContain("Cancelar a nota e voltar para a mensagem");
    expect(CONVERSA).toContain('acao: "nota"');
  });
});

describe("texto à vista: sem title=, sem travessão e sem seta", () => {
  it("nenhum dos arquivos novos da conversa tem title= nem travessão ou seta fora de comentário", () => {
    for (const [nome, fonte] of Object.entries(ARQUIVOS)) {
      const codigo = semComentarios(fonte);
      expect(codigo, nome).not.toMatch(/\btitle=/);
      expect(codigo, nome).not.toMatch(/<title>/);
      expect(codigo, nome).not.toMatch(/[—–→←⇒]/);
    }
  });
});

describe("revisão da onda 1 (12/11/2026): nota interna, caixa vazia e busca", () => {
  it("a nota interna tem rascunho próprio e o modo volta com ela: nunca cai na caixa do cliente", () => {
    expect(semComentarios(CAIXA)).toContain("chaveDoRascunho(conversaId, nota)");
    expect(semComentarios(CAIXA)).toContain("useRascunho(chave)");
    const conversa = semComentarios(CONVERSA);
    expect(conversa).toContain('lerRascunho(chaveDoRascunho(conversa.id, true)).trim() ? "nota" : "mensagem"');
    expect(conversa).toContain('chaveDoRascunho(conversa.id, modo === "nota")');
    // Nenhuma leitura crua do rascunho por id da conversa para ENVIAR (a legenda do anexo é da mensagem, de propósito).
    expect(conversa).not.toMatch(/const limpo = lerRascunho\(conversa\.id\)/);
  });

  it("a chave da nota não é a da mensagem (a linha da lista só lê a da mensagem)", async () => {
    const { chaveDoRascunho } = await import("../src/components/whatsapp/rascunhos");
    expect(chaveDoRascunho("c1", false)).toBe("c1");
    expect(chaveDoRascunho("c1", true)).not.toBe("c1");
  });

  it("caixa vazia fica em uma linha sem medir (o texto de ajuda não entra na altura) e o placeholder é curto", () => {
    const caixa = semComentarios(CAIXA);
    expect(caixa).toMatch(/if \(texto === ""\) \{\s*el\.style\.height = `\$\{ALTURA_MINIMA_DA_CAIXA_PX\}px`;\s*return;/);
    expect(caixa).toContain('"Mensagem"');
    expect(caixa).not.toContain("Digite / para as respostas");
  });

  it("a busca na conversa usa o texto que a bolha mostra, não o rótulo com colchete", async () => {
    expect(semComentarios(CONVERSA)).toContain("legendaDaBolha(m)");
    expect(semComentarios(CONVERSA)).not.toContain("conteudoDaMensagem(m)");
    const { legendaDaBolha } = await import("../src/domain/whatsapp/midia");
    const { ocorrenciasDaBusca } = await import("../src/domain/whatsapp/busca-na-conversa");
    const doc = {
      id: "m1",
      tipo: "documento",
      direcao: "entrada",
      texto: null,
      legenda: null,
      media_url: "https://x/y.pdf",
      media_nome: "y.pdf",
    } as never;
    expect(legendaDaBolha(doc)).toBe("");
    expect(ocorrenciasDaBusca([{ id: "m1", texto: legendaDaBolha(doc) }], "documento")).toEqual([]);
  });
});
