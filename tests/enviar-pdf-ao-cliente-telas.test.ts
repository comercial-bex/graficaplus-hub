import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { telaDoOrcamento } from "./apoio/tela-do-orcamento";

/**
 * As garantias da TELA do "Enviar PDF ao cliente", lendo o código (o vitest roda em node, sem jsdom):
 * onde o botão aparece, que todos chamam a mesma função de servidor, que a tela não grava mais
 * `enviado_em` no caminho do sistema nem no wa.me, e as regras visuais do dono.
 */
const le = (c: string) => readFileSync(c, "utf8");
const botao = le("src/components/whatsapp/botao-enviar-pdf-ao-cliente.tsx");
const fluxo = le("src/components/whatsapp/fluxo-enviar-pdf-ao-cliente.ts");
const dominioDaTela = le("src/domain/whatsapp/enviar-pdf-na-tela.ts");
const rota = le("src/routes/_authenticated/orcamentos.$id.tsx");
const passo = le("src/components/orcamento/tela/PassoRevisao.tsx");
const os = le("src/routes/_authenticated/os.$id.tsx");
const tres = le("src/routes/_authenticated/orcamento-3d.$id.tsx");
const previa = le("src/lib/pdf/PDFPreviewDialog.tsx");
const painel = le("src/components/whatsapp/vinculos-da-conversa.tsx");

/** O corpo de uma função da rota, do `async function nome` até a próxima função do mesmo nível. */
function corpo(texto: string, nome: string): string {
  const i = texto.indexOf(`async function ${nome}(`);
  expect(i, `função ${nome}`).toBeGreaterThan(-1);
  const resto = texto.slice(i + 10);
  const f = resto.search(/\n  (async )?function |\n  const \[/);
  // Sem comentários: eles explicam o que NÃO se faz mais e citam os mesmos nomes.
  return resto.slice(0, f === -1 ? undefined : f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("um botão só, a mesma função de servidor em todo lugar", () => {
  it("o botão chama enviarDocumentoAoCliente e nenhum outro caminho de envio de arquivo", () => {
    expect(botao).toContain("enviarDocumentoAoCliente({ data: pedido })");
    expect(botao).not.toContain("enfileirarArquivo");
    expect(botao).not.toContain("enviarOrcamentoPeloSistema");
  });
  it("passo 4 do orçamento, OS, 3D, prévia e painel usam o mesmo componente", () => {
    expect(passo).toContain('<BotaoEnviarPdfAoCliente tipo="orcamento" referenciaId={id} numero={orc.numero} />');
    expect(os).toContain('tipo="os"');
    expect(os).toContain("ItemDoMenuEnviarPdf");
    expect(os).toContain("useEnviarPdfAoCliente");
    expect(tres).toContain('tipo="orcamento_3d"');
    expect(previa).toContain("BotaoEnviarPdfAoCliente");
    expect(painel).toContain("BotaoEnviarPdfAoCliente");
    expect(painel).toContain("conversaId={conversa.id}");
    expect(painel).toContain("instanciaId={conversa.instancia_id}");
  });
  it("o painel não monta mais o próprio PDF nem enfileira arquivo por conta própria", () => {
    expect(painel).not.toContain("enfileirarArquivo");
    expect(painel).not.toContain("carregarPropsOrcamento");
    expect(painel).not.toContain("subirAnexo");
  });
  it("a OS mostra o botão no cabeçalho do computador e no menu Mais do celular", () => {
    expect(os).toMatch(/hidden md:inline-flex">\s*<BotaoEnviarPdfAoCliente tipo="os"/);
    expect(os).toMatch(/<ItemDoMenuEnviarPdf envio=\{envioDoPdf\} \/>/);
  });
  it("a prévia só oferece o envio na via do cliente (nunca produção nem custos)", () => {
    expect(previa).toContain("const viaDoCliente = mostrarValores && !comCustos;");
    expect(previa).toMatch(/\{viaDoCliente && \(\s*<BotaoEnviarPdfAoCliente/);
    // O arquivo enviado é o da tela, registrado como via do cliente.
    expect(previa).toContain("registrarPDFDoClienteParaEnvio({ blob, tipo, referenciaId: referencia_id, numero: props.numero })");
  });
});

describe("a tela não escreve mais enviado_em no caminho do sistema nem no wa.me", () => {
  it("o passo 4 não tem mais o 'Enviar pelo sistema' nem o antigo enviarPeloSistema", () => {
    const tela = telaDoOrcamento();
    expect(tela).not.toContain("Enviar pelo sistema");
    expect(tela).not.toContain("enviarPeloSistema");
    expect(tela).not.toContain("enviandoPeloSistema");
    expect(tela).not.toContain("gerarPDFOrcamentoParaEnvio");
  });
  it("wa.me: pede o registro ao servidor, não troca o status pela tela", () => {
    const c = corpo(rota, "enviarWhatsApp");
    expect(c).toContain('await registrarPorFora("wa_me")');
    expect(c).not.toContain("setStatus(");
    expect(c).not.toContain("enviado_em");
  });
  it("link do cliente: registra a intenção (canal link_copiado)", () => {
    expect(corpo(rota, "copiarLinkCliente")).toContain('await registrarPorFora("link_copiado")');
    expect(corpo(rota, "registrarPorFora")).toContain('registrarEnvioPorFora({ data: { tipo: "orcamento", referenciaId: id, canal } })');
  });
  it("o registro que falha só avisa e não impede o clique", () => {
    const c = corpo(rota, "registrarPorFora");
    expect(c).toContain("toast.warning(");
    expect(c).not.toContain("throw");
  });
  it("o wa.me usa a mesma frase do envio pelo sistema, sem travessão", () => {
    const c = corpo(rota, "enviarWhatsApp");
    expect(c).toContain("legendaDoDocumento({");
    expect(rota).not.toMatch(/orçamento nº \$\{[^}]*\} [—–]/);
  });
});

describe("a pergunta antes de mandar só o link e o botão desligado", () => {
  it("o fluxo pergunta só no orçamento e a pergunta tem os dois botões de 44 px", () => {
    expect(fluxo).toContain('if (d.tipo !== "orcamento")');
    expect(fluxo).toContain("await d.perguntarSoOLink(motivo)");
    expect(botao).toContain("Mandar só o link");
    expect(botao).toContain("Não enviar nada");
    expect((botao.match(/className="h-11 text-base"/g) ?? []).length).toBe(2);
  });
  it("o botão fica desligado com a Dica quando o WhatsApp está desconectado", () => {
    expect(botao).toContain("disabled={!estado.ligado}");
    expect(botao).toContain("<Dica texto={estado.dica}>");
    expect(dominioDaTela).toContain("DICAS_DO_PDF_AO_CLIENTE.desconectado");
    expect(le("src/lib/dicas.ts")).toContain('desconectado: "Reconecte o WhatsApp no Monitor"');
  });
  it("o aviso final vem do desfecho da linha da fila", () => {
    expect(fluxo).toContain("desfechoDoEnvioDoDocumento(http, resultado.filaId");
  });
});

describe("regras visuais do dono nos arquivos novos", () => {
  const novos = { botao, fluxo, dominioDaTela };
  it("sem title=, sem text-primary, text-accent nem #fd4746, sem travessão nem seta no texto", () => {
    for (const [nome, t] of Object.entries(novos)) {
      expect(t, nome).not.toMatch(/\btitle=/);
      expect(t, nome).not.toMatch(/text-primary|text-accent|#fd4746/i);
      // Comentários podem ter qualquer pontuação; o texto visível não.
      const semComentarios = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(semComentarios, nome).not.toMatch(/[—–→←⇒➜➔]/);
    }
  });
  it("o botão tem 44 px e 16 px e nada abaixo de 12 px", () => {
    expect(dominioDaTela).toContain('CLASSE_DO_BOTAO_PDF = "h-11 min-w-11 text-base"');
    expect(botao).toContain("CLASSE_DO_BOTAO_PDF");
    expect(botao).not.toMatch(/text-\[(\d|1[01])px\]/);
  });
});
