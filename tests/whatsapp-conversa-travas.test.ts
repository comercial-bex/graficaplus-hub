import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * Travas da conversa aberta (dono: CONVERSA, onda 1 da caixa do WhatsApp,
 * 12/11/2026).
 *
 * Moraram até 12/11/2026 em quatro testes que também prendiam arquivos de
 * outros construtores (title-vira-texto-visivel, whatsapp-conversa-nao-
 * espremida, whatsapp-nova-conversa-pelo-numero, whatsapp-aviso-de-
 * transferencia e whatsapp-midia-na-conversa). Vieram para cá SEM MUDAR o que
 * garantem, para cada construtor mexer só no próprio teste. Elas leem o
 * conjunto dos arquivos da conversa: quando conversa-aberta.tsx for dividido
 * (cabeçalho, linha do tempo, bolha, caixa de resposta), as travas seguem o
 * código. Trava que muda de propósito (a tecla R, T e E e a gaveta "Ações"
 * saem nesta onda) é trocada aqui pela garantia nova, nunca apagada.
 */

const PASTA = "src/components/whatsapp";
const ARQUIVOS_DA_CONVERSA = [
  "conversa-aberta.tsx",
  "cabecalho-da-conversa.tsx",
  "linha-do-tempo.tsx",
  "bolha-da-mensagem.tsx",
  "caixa-de-resposta.tsx",
].map((f) => `${PASTA}/${f}`);

const CONVERSA = ARQUIVOS_DA_CONVERSA.filter((f) => existsSync(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("a conversa (travas que vieram de outros testes, 12/11/2026)", () => {
  // De tests/title-vira-texto-visivel.test.ts (20/10/2026). MUDOU DE PROPÓSITO em
  // 12/11/2026 (onda 1, CONVERSA): a trava velha exigia "(tecla R/T/E)" na dica de
  // Assumir, Transferir e Resolver. As teclas soltas saíram (a R assumia a
  // conversa de outra pessoa sem perguntar). A garantia de fundo continua: as
  // ações mostram o nome em todo tamanho, e agora NENHUMA tecla solta faz ação.
  it("conversa: as ações mostram o nome em todo tamanho e nenhuma tecla solta faz ação", () => {
    expect(CONVERSA).not.toContain('className="hidden sm:inline"');
    for (const nome of ["Assumir", "Resolver", "Reabrir", "Transferir", "Arquivar", "Marcar pendente"]) {
      expect(CONVERSA, nome).toMatch(new RegExp(`>\\s*(?:<[^>]+>\\s*)?${nome}\\s*<`));
    }
    for (const tecla of ["R", "T", "E", "N"]) {
      expect(CONVERSA, tecla).not.toContain(`aria-keyshortcuts="${tecla}"`);
      expect(CONVERSA, tecla).not.toContain(`(tecla ${tecla})`);
    }
    expect(CONVERSA).not.toContain("useAtalhosDaConversa");
  });

  // De tests/whatsapp-conversa-nao-espremida.test.ts (11/11/2026). MUDOU DE
  // PROPÓSITO em 12/11/2026 (onda 1): a gaveta "Ações" (xl:hidden) saiu; o painel
  // virou a gaveta de dados do contato, da moldura. A garantia de fundo (o painel
  // do cliente continua ao alcance em toda largura) passa a ser: o cabeçalho tem
  // o botão que abre os dados do contato (foto e nome) e o item do menu, e nenhum
  // Sheet próprio sobrou na conversa.
  it("os dados do contato abrem pelo nome e pelo menu, sem gaveta própria na conversa", () => {
    const conversa = semComentarios(CONVERSA);
    expect(conversa).toContain("onClick={p.onAlternarDados}");
    expect(conversa).toContain("aria-expanded={p.dadosAbertos}");
    expect(conversa).toContain("Dados do contato");
    expect(conversa).not.toContain("SheetTrigger");
    expect(conversa).not.toContain("xl:hidden");
  });

  // De tests/whatsapp-nova-conversa-pelo-numero.test.ts (21/10/2026).
  it("aberta pela Nova conversa, o cursor vai para a resposta (sem autoFocus, que perdia para o diálogo)", () => {
    expect(CONVERSA).toContain(
      "if (focarResposta && temPermissaoDeResponder) respostaRef.current?.focus();",
    );
    expect(CONVERSA).not.toContain("autoFocus={focarResposta");
  });

  // De tests/whatsapp-midia-na-conversa.test.ts (19/10/2026).
  it("a conversa desenha o miolo da bolha (ConteudoDaBolha) e mantém o fim à vista quando a mídia carrega", () => {
    expect(CONVERSA).toContain("<ConteudoDaBolha");
    expect(CONVERSA).toContain("aoMudarAltura=");
    expect(CONVERSA).not.toContain("link do Z-API, vale 30 dias");
  });

  // De tests/whatsapp-aviso-de-transferencia.test.ts (14/10/2026).
  it("transferir leva a assinatura de quem transfere e o aviso ao cliente", () => {
    expect(CONVERSA).toContain("assinatura={minhaAssinatura}");
    expect(CONVERSA).toContain(
      'acao: "transferir_fila", conversaId: conversa.id, fila, motivo, aviso: aviso ?? undefined',
    );
  });
});
