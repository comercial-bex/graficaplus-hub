import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  resolucaoNoTamanho,
  textoDaResolucao,
  bucketDoArquivo,
  ehArquivoDeImpressao,
  ehMockup,
  formatoDoArquivo,
  nomeParaBaixar,
  separarArquivos,
  type ArquivoDaOs,
} from "@/domain/os/arquivos-da-os";

/**
 * 14/11/2026, pedido do dono: "que esteja nítido para a produção o que é o visual
 * de visualização — o que a gente vende, o mockup aplicado — e o arquivo que vai
 * para impressão ou diagramação"; e que dê para BAIXAR o arquivo anexado.
 *
 * O que se viu no banco (14/11): o tipo "arte" guardava os mockups do orçamento
 * ("Placa corporativa Ademicon em acrílico.png") e PDFs fechados juntos; a OS 174
 * tinha três versões do mesmo JPG marcadas como final; o "Baixar" da OS só abria
 * uma aba, no bucket fixo — o PDF que veio pelo WhatsApp (whatsapp-midias) nunca
 * abria. O teste com o perfil de uma operadora mostrou que o banco libera o
 * arquivo: o defeito era da tela.
 */

function arq(p: Partial<ArquivoDaOs> & { id: string; nome: string }): ArquivoDaOs {
  return {
    caminho: `os/${p.id}/${p.nome}`,
    mime_type: null,
    final_producao: false,
    created_at: "2026-11-01T10:00:00Z",
    tipo: "outro",
    status: "ativo",
    ativo: true,
    substituido_por: null,
    os_item_id: null,
    bucket: null,
    tamanho_bytes: null,
    versao: 1,
    ...p,
  };
}

describe("quem é o quê", () => {
  it("arquivo de impressão = marcado como final OU tipo producao; mockup = arte ou referência", () => {
    expect(ehArquivoDeImpressao({ final_producao: true, tipo: "outro" })).toBe(true);
    expect(ehArquivoDeImpressao({ final_producao: false, tipo: "producao" })).toBe(true);
    expect(ehArquivoDeImpressao({ final_producao: false, tipo: "arte" })).toBe(false);
    expect(ehMockup({ tipo: "arte" })).toBe(true);
    expect(ehMockup({ tipo: "referencia" })).toBe(true);
    expect(ehMockup({ tipo: "outro" })).toBe(false);
  });

  it("separa impressão, mockup e anexos; o mockup aprovado vem primeiro", () => {
    const s = separarArquivos([
      arq({ id: "pdf", nome: "arte_bem_vindos.pdf", tipo: "producao", final_producao: true }),
      arq({ id: "m1", nome: "Placa aplicada.png", tipo: "arte", created_at: "2026-11-05T10:00:00Z" }),
      arq({ id: "m2", nome: "Placa aprovada.png", tipo: "arte", status: "aprovado", created_at: "2026-11-01T10:00:00Z" }),
      arq({ id: "zap", nome: "Comprovante.pdf", bucket: "whatsapp-midias" }),
    ]);
    expect(s.impressao.map((a) => a.id)).toEqual(["pdf"]);
    expect(s.mockups.map((a) => a.id)).toEqual(["m2", "m1"]);
    expect(s.anexos.map((a) => a.id)).toEqual(["zap"]);
    expect(s.versoesAnteriores).toEqual([]);
  });

  it("a imagem aprovada que também é a que se imprime aparece nos dois lugares", () => {
    const s = separarArquivos([arq({ id: "j", nome: "arte.jpeg", tipo: "arte", status: "aprovado", final_producao: true })]);
    expect(s.impressao.map((a) => a.id)).toEqual(["j"]);
    expect(s.mockups.map((a) => a.id)).toEqual(["j"]);
  });

  it("OS 174: três versões do mesmo arquivo marcadas como final — vale a mais nova, as outras não são para imprimir", () => {
    const s = separarArquivos([
      arq({ id: "v1", nome: "bdc1a372.jpg", final_producao: true, versao: 1, created_at: "2026-10-26T10:00:00Z" }),
      arq({ id: "v3", nome: "bdc1a372.jpg", final_producao: true, versao: 3, created_at: "2026-10-26T12:00:00Z" }),
      arq({ id: "v2", nome: "bdc1a372.jpg", final_producao: true, versao: 2, created_at: "2026-10-26T11:00:00Z" }),
      arq({ id: "outro-item", nome: "bdc1a372.jpg", final_producao: true, os_item_id: "item-2" }),
    ]);
    expect(s.impressao.map((a) => a.id).sort()).toEqual(["outro-item", "v3"]);
    expect(s.versoesAnteriores.map((a) => a.id)).toEqual(["v2", "v1"]);
  });

  it("substituído ou desativado não aparece em lugar nenhum", () => {
    const s = separarArquivos([
      arq({ id: "velho", nome: "a.pdf", final_producao: true, substituido_por: "novo" }),
      arq({ id: "off", nome: "b.png", tipo: "arte", ativo: false }),
    ]);
    expect([...s.impressao, ...s.mockups, ...s.anexos, ...s.versoesAnteriores]).toEqual([]);
  });
});

describe("o arquivo que chega no computador", () => {
  it("nome legível; sem extensão no nome, usa a do caminho", () => {
    expect(nomeParaBaixar({ nome: "chaveiro_10kits.pdf", caminho: "orcamento/x/9b7e.pdf" })).toBe("chaveiro_10kits.pdf");
    expect(
      nomeParaBaixar({ nome: "Foto do modelo — KIT DE PINTURA", caminho: "orcamentos-3d/1792_modelo_Captura.png" }),
    ).toBe("Foto do modelo — KIT DE PINTURA.png");
    expect(nomeParaBaixar({ nome: "", caminho: "x/sem-extensao" })).toBe("arquivo");
  });

  it("o formato em uma palavra: PDF, CDR, 3MF", () => {
    expect(formatoDoArquivo({ nome: "fachada.cdr", mime_type: null, caminho: "a/fachada.cdr" })).toBe("CDR");
    expect(formatoDoArquivo({ nome: "Star_Keychain.3mf", mime_type: "", caminho: "a/Star.3mf" })).toBe("3MF");
    expect(formatoDoArquivo({ nome: "x", mime_type: "application/pdf", caminho: "a/x" })).toBe("PDF");
    expect(formatoDoArquivo({ nome: "Foto do modelo — Kit", mime_type: null, caminho: "a/b" })).toBe("Arquivo");
  });

  it("o bucket é o da linha; nulo é arquivos-clientes", () => {
    expect(bucketDoArquivo({ bucket: null })).toBe("arquivos-clientes");
    expect(bucketDoArquivo({ bucket: "whatsapp-midias" })).toBe("whatsapp-midias");
  });
});

describe("baixar de verdade", () => {
  const LIB = readFileSync("src/lib/baixar-arquivo.ts", "utf8");
  const BOTOES = readFileSync("src/components/arquivos/botoes-do-arquivo.tsx", "utf8");

  it("a URL assinada leva o nome (Content-Disposition: attachment) e o bucket da linha", () => {
    expect(LIB).toContain(".createSignedUrl(a.caminho, segundos, { download: nomeParaBaixar(a) })");
    expect(LIB).toContain(".from(bucketDoArquivo(a))");
    expect(LIB).not.toContain('from("arquivos-clientes")');
  });

  it("abrir abre a aba no clique (o Safari bloqueia aba aberta depois de await)", () => {
    const abrir = LIB.slice(LIB.indexOf("export async function abrirArquivo"));
    expect(abrir.indexOf('window.open("", "_blank")')).toBeLessThan(abrir.indexOf("await supabase"));
  });

  it("falha vira aviso com o nome do arquivo — nunca um clique que não faz nada", () => {
    expect(BOTOES).toContain("Não foi possível baixar ${nomeParaBaixar(arquivo)}");
    expect(BOTOES).toContain("Não foi possível abrir ${nomeParaBaixar(arquivo)}");
  });
});

describe("as telas", () => {
  const FICHA = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");
  const OS = readFileSync("src/routes/_authenticated/os.$id.tsx", "utf8");
  const ANEXAR = readFileSync("src/components/kanban/anexar-arquivo-rapido.tsx", "utf8");
  const PAINEL = readFileSync("src/components/painel/PainelProducao.tsx", "utf8");
  const QUADRO = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");

  it("a ficha do quadro separa impressão, mockup e anexos, com Baixar em cada um", () => {
    expect(FICHA).toContain("separarArquivos(os?.arquivos");
    expect(FICHA).toContain("Arquivo de impressão · o que vai para a máquina");
    expect(FICHA).toContain("Mockup · o que o cliente viu e aprovou");
    expect(FICHA).toContain("Outros anexos (");
    expect(FICHA).toContain("Versões anteriores (");
    expect(FICHA).toContain('<BotaoBaixar arquivo={arquivo} variante="default" />');
    // as miniaturas são assinadas no bucket de cada arquivo
    expect(FICHA).toContain("urlsParaVer(todos, 900)");
    expect(FICHA).not.toContain("urlsAssinadas(");
  });

  it("o quadro manda à ficha o bucket, o tamanho e a versão", () => {
    expect(QUADRO).toContain("os_item_id, bucket, tamanho_bytes, versao");
  });

  it("anexar diz o que sobe: impressão (tipo producao, final) ou mockup (tipo arte); nome seguro no Storage", () => {
    expect(ANEXAR).toContain('tipo: deImpressao ? "producao" : "arte"');
    expect(ANEXAR).toContain("nomeSeguro(arquivo.name)");
    expect(ANEXAR).toContain('status: "substituido", substituido_por: novo.id, ativo: false');
    // marcação conferida (0 linhas = o perfil não pode)
    expect(ANEXAR).toContain("final = !marcaErr && !!marcado && marcado.length > 0");
  });

  it("nova versão só quando o nome aponta UM arquivo: mesmo nome em dois itens sobe como arquivo novo (revisão do PR #466)", () => {
    expect(ANEXAR).toContain("const anterior = mesmoNome.length === 1 ? mesmoNome[0] : null;");
    expect(ANEXAR).toContain("mesmoNome.length > 1");
  });

  it("arquivo de impressão sem a marcação de final pode ser marcado na própria ficha (revisão do PR #466)", () => {
    expect(FICHA).toContain("impressao.find((a) => !a.final_producao) ?? mockup ?? anexos[0] ?? null");
    expect(FICHA).toContain("{!arquivo.final_producao && podeFinalizar && (");
    expect(FICHA).toContain("podeFinalizar={podeFinalizar}");
  });

  it("a tela da OS: Baixar de verdade, tipo gravado, marcação conferida, nome seguro", () => {
    expect(OS).toContain('<BotaoBaixar arquivo={a} variante="ghost" />');
    expect(OS).not.toContain('window.open(data.signedUrl, "_blank")');
    expect(OS).toContain("tipo: uploadMeta.tipo,");
    expect(OS).toContain("nomeSeguro(file.name)");
    expect(OS).toMatch(/if \(!data \|\| data\.length === 0\) \{\s*return toast\.error\("Seu perfil não pode marcar o arquivo como final/);
    expect(OS).toContain('["producao", "Arquivo de impressão (vai para a máquina)"]');
  });

  it("a Minha oficina do operador traz o arquivo de impressão, e a falha da consulta é dita", () => {
    expect(PAINEL).toContain(".or(\"final_producao.eq.true,tipo.eq.producao\")");
    expect(PAINEL).toContain("separarArquivos(lista).impressao");
    expect(PAINEL).toContain("<BotaoBaixar");
    expect(PAINEL).toContain("arquivosDeImpressao.isError");
  });
});

describe("conferência de resolução (preflight simples)", () => {
  it("faixa 1,50 × 0,50 m com imagem de 4500 × 1500 px: ~76 dpi, serve para grande formato", () => {
    const r = resolucaoNoTamanho({ largura: 4500, altura: 1500 }, { largura: 1.5, altura: 0.5 });
    expect(r).toEqual({ dpi: 76, nivel: "grande_formato" });
    expect(textoDaResolucao(r!)).toContain("grande formato");
  });

  it("imagem em pé numa peça deitada: casa lado maior com lado maior", () => {
    expect(resolucaoNoTamanho({ largura: 1500, altura: 4500 }, { largura: 1.5, altura: 0.5 })?.dpi).toBe(76);
  });

  it("print de WhatsApp (1280 px) numa placa de 0,60 m: baixa", () => {
    const r = resolucaoNoTamanho({ largura: 1280, altura: 853 }, { largura: 0.6, altura: 0.4 });
    expect(r?.nivel).toBe("baixa");
    expect(textoDaResolucao(r!)).toContain("baixa para imprimir");
  });

  it("adesivo de 5 cm com 1000 px: boa", () => {
    expect(resolucaoNoTamanho({ largura: 1000, altura: 1000 }, { largura: 0.05, altura: 0.05 })?.nivel).toBe("boa");
  });

  it("sem medida ou sem pixel: não afirma nada", () => {
    expect(resolucaoNoTamanho({ largura: 0, altura: 10 }, { largura: 1, altura: 1 })).toBeNull();
    expect(resolucaoNoTamanho({ largura: 10, altura: 10 }, { largura: 0, altura: 1 })).toBeNull();
  });
});

describe("o resto das pendências da análise (14/11/2026)", () => {
  const CARTAO = readFileSync("src/components/kanban/cartao-os.tsx", "utf8");
  const PDF = readFileSync("src/lib/pdf/generate.ts", "utf8");
  const FICHA = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");

  it("o cartão diz se tem mockup e arquivo de impressão, da criação até a máquina", () => {
    expect(CARTAO).toContain('<SeloDoArquivo rotulo="Mockup"');
    expect(CARTAO).toContain('<SeloDoArquivo rotulo="Impressão"');
    expect(CARTAO).toContain('["pre_impressao", "fila_producao", "producao"].includes(etapaDe(os.status)');
  });

  it("o PDF de produção usa o arquivo de impressão (imagem) do item, não o mockup", () => {
    expect(PDF).toContain("impressaoDaOs: mostrarValores ? undefined : osId");
    expect(PDF).toContain('.eq("final_producao", true)');
    // falhar ao ler não derruba o PDF
    expect(PDF).toContain('console.warn("[pdf] não leu os arquivos de impressão:", error)');
  });

  it("a ficha mede a imagem de impressão e confere a resolução no tamanho da peça", () => {
    expect(FICHA).toContain("resolucaoNoTamanho(px, medida)");
    expect(FICHA).toContain("e.currentTarget.naturalWidth");
  });
});
