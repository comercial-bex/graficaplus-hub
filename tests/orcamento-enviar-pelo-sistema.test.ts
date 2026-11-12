import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { telaDoOrcamento } from "./apoio/tela-do-orcamento";

const servidor = readFileSync("src/lib/api/documento-whatsapp.functions.ts", "utf8");
const tela = telaDoOrcamento();

describe("Enviar pelo sistema (orçamento → Z-API)", () => {
  it("confere whatsapp.reply, gera o link no banco e enfileira o PDF como documento", () => {
    expect(servidor).toContain("PERMISSOES_PARA_ENVIAR[tipo]");
    expect(servidor).toContain("orcamento_link_publico");
    expect(servidor).toContain("whatsapp_responder_arquivo");
    expect(servidor).toContain('p_tipo: "documento"');
  });
  it("só aceita PDF da pasta deste orçamento e copia para a pasta da conversa", () => {
    // O arquivo é sempre o da linha conferida de documentos_gerados (via do cliente, mesma pessoa, 15 minutos).
    expect(servidor).toContain("documentoServeParaEnvio(");
    expect(servidor).toContain("download(linha.caminho)");
    expect(servidor).toContain("caixa/${conversaId}/");
  });
  it("a tela usa o botão único Enviar PDF ao cliente, que gera o PDF sem baixar e aciona o despachante", () => {
    // O passo 4 chama o botão compartilhado; o fluxo (gerar, enviar, acionar) mora nele.
    expect(tela).toContain("BotaoEnviarPdfAoCliente");
    expect(tela).not.toContain("Enviar pelo sistema");
    expect(tela).not.toContain("enviarOrcamentoPeloSistema");
    const botao = readFileSync("src/components/whatsapp/botao-enviar-pdf-ao-cliente.tsx", "utf8");
    expect(botao).toContain("gerarPDFDoClienteParaEnvio");
    expect(botao).toContain("acionar: acionarEnvio");
  });
});
