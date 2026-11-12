import { describe, expect, it } from "vitest";
import {
  CANAIS_DE_INTENCAO,
  chavesParaConferir,
  desfechoDoEnvioDoDocumento,
  documentoServeParaEnvio,
  instanciaConectada,
  instanciaDoEnvio,
  legendaDoDocumento,
  nomeDoArquivo,
  nomeDoDocumento,
  PERMISSOES_PARA_ENVIAR,
  podeEnviarDocumento,
  podeRegistrarPorFora,
  telefoneDoEnvio,
  textoAoCliente,
  type LinhaDoDocumentoGerado,
} from "../src/domain/whatsapp/envio-de-documento";

const SEM_TRAVESSAO = /[—–→←⇒➜➔]/;
const so = (...chaves: string[]) => (p: string) => chaves.includes(p);

describe("quem pode mandar cada documento", () => {
  it("orçamento: whatsapp.reply e orcamentos.send", () => {
    expect(podeEnviarDocumento("orcamento", so("whatsapp.reply", "orcamentos.send", "orcamentos.create"))).toEqual({ pode: true });
    const sem = podeEnviarDocumento("orcamento", so("orcamentos.send"));
    expect(sem).toEqual({
      pode: false,
      motivo: "Seu perfil não pode mandar o orçamento ao cliente: falta a permissão whatsapp › reply.",
    });
  });
  it("OS: só quem vê o preço (precos.read ou financeiro.read) manda a via do cliente", () => {
    expect(podeEnviarDocumento("os", so("whatsapp.reply", "os.read", "precos.read", "orcamentos.create")).pode).toBe(true);
    expect(podeEnviarDocumento("os", so("whatsapp.reply", "os.read", "financeiro.read", "orcamentos.create")).pode).toBe(true);
    expect(podeEnviarDocumento("os", so("whatsapp.reply", "os.read", "orcamentos.create"))).toEqual({
      pode: false,
      motivo: "Só quem vê o preço da OS manda a via do cliente.",
    });
    expect(podeEnviarDocumento("os", so("os.read", "precos.read")).pode).toBe(false);
  });
  it("3D: precisa de impressao3d.quote.update", () => {
    expect(podeEnviarDocumento("orcamento_3d", so("whatsapp.reply", "impressao3d.read", "orcamentos.create"))).toEqual({
      pode: false,
      motivo: "Seu perfil não pode mandar o orçamento 3D ao cliente: falta a permissão impressao3d › quote.update.",
    });
    expect(podeEnviarDocumento("orcamento_3d", so("whatsapp.reply", "impressao3d.quote.update", "orcamentos.create")).pode).toBe(true);
  });
  it("o servidor pergunta todas as chaves da regra, sem repetir", () => {
    expect(chavesParaConferir(PERMISSOES_PARA_ENVIAR.os)).toEqual([
      "whatsapp.reply",
      "os.read",
      "orcamentos.create",
      "precos.read",
      "financeiro.read",
    ]);
  });
  it("wa.me e link copiado: orcamentos.send", () => {
    expect(podeRegistrarPorFora(so("orcamentos.send")).pode).toBe(true);
    expect(podeRegistrarPorFora(so()).pode).toBe(false);
    expect(CANAIS_DE_INTENCAO).toEqual(["wa_me", "link_copiado"]);
  });
});

describe("a linha de documentos_gerados que serve para o envio", () => {
  const agora = new Date("2026-11-12T15:00:00Z");
  const ORC = "11111111-1111-4111-8111-111111111111";
  const pedido = { tipo: "orcamento" as const, referenciaId: ORC, usuarioId: "u1" };
  const linha = (m: Partial<LinhaDoDocumentoGerado> = {}): LinhaDoDocumentoGerado => ({
    id: "d1",
    tipo: "orcamento",
    referencia_id: ORC,
    variante: "cliente",
    caminho: `orcamento/${ORC}/1700000000000-orcamento-12.pdf`,
    gerado_por: "u1",
    created_at: new Date(agora.getTime() - 14 * 60_000).toISOString(),
    ...m,
  });
  const motivo = (l: LinhaDoDocumentoGerado | null) => {
    const r = documentoServeParaEnvio(l, pedido, agora);
    return r.ok ? null : r.motivo;
  };

  it("aceita a via do cliente gerada por quem manda há 14 minutos", () => {
    expect(documentoServeParaEnvio(linha(), pedido, agora)).toEqual({ ok: true });
  });
  it("recusa linha nula, via de produção ou de custos, outro tipo e outra referência", () => {
    expect(motivo(null)).toBe("O PDF gerado não foi encontrado. Gere de novo.");
    expect(motivo(linha({ variante: "producao" }))).toBe("Só a via do cliente vai ao cliente.");
    expect(motivo(linha({ variante: "custos" }))).toBe("Só a via do cliente vai ao cliente.");
    expect(motivo(linha({ tipo: "os" }))).toBe("Este PDF é de outro documento.");
    expect(motivo(linha({ referencia_id: "22222222-2222-4222-8222-222222222222" }))).toBe(
      "Este PDF é de outro documento.",
    );
  });
  it("recusa PDF de outra pessoa ou sem autor", () => {
    expect(motivo(linha({ gerado_por: "u2" }))).toBe("Este PDF foi gerado por outra pessoa. Gere de novo.");
    expect(motivo(linha({ gerado_por: null }))).toBe("Este PDF foi gerado por outra pessoa. Gere de novo.");
  });
  it("recusa com 15 minutos e 1 segundo, e no futuro além da folga", () => {
    const velho = new Date(agora.getTime() - 15 * 60_000 - 1000).toISOString();
    expect(motivo(linha({ created_at: velho }))).toBe("Este PDF foi gerado há mais de 15 minutos. Gere de novo.");
    const futuro = new Date(agora.getTime() + 2 * 60_000).toISOString();
    expect(motivo(linha({ created_at: futuro }))).toMatch(/15 minutos/);
    const folga = new Date(agora.getTime() + 30_000).toISOString();
    expect(motivo(linha({ created_at: folga }))).toBeNull();
  });
  it("recusa caminho fora da pasta do documento ou que não é PDF", () => {
    expect(motivo(linha({ caminho: `orcamento/outro/${ORC}.pdf` }))).toMatch(/pasta/);
    expect(motivo(linha({ caminho: `orcamento/${ORC}/x.png` }))).toMatch(/pasta/);
    expect(motivo(linha({ caminho: `orcamento/${ORC}/../os/x.pdf` }))).toMatch(/pasta/);
  });
});

describe("nome do arquivo e legenda", () => {
  it("nomes dos três tipos", () => {
    expect(nomeDoArquivo("orcamento", 123)).toBe("orcamento-123.pdf");
    expect(nomeDoArquivo("os", 456)).toBe("OS-456.pdf");
    expect(nomeDoArquivo("orcamento_3d", "123")).toBe("Orcamento-3D-123.pdf");
    expect(nomeDoDocumento("os", 456)).toBe("a ordem de serviço nº 456");
  });
  it("orçamento: começa com 'Olá! Segue o orçamento nº' (a cobrança lê essa frase) e leva o link", () => {
    const l = legendaDoDocumento({ tipo: "orcamento", numero: 123, titulo: "Banner da fachada", link: "https://x/y" });
    expect(l).toBe("Olá! Segue o orçamento nº 123: Banner da fachada.\nVocê pode conferir e aprovar por aqui: https://x/y");
    expect(l.startsWith("Olá! Segue o orçamento nº")).toBe(true);
  });
  it("OS e 3D", () => {
    expect(legendaDoDocumento({ tipo: "os", numero: 456, titulo: "Banner da fachada" })).toBe(
      "Olá! Segue a ordem de serviço nº 456: Banner da fachada.",
    );
    expect(legendaDoDocumento({ tipo: "orcamento_3d", numero: 123, titulo: "Chaveiro personalizado" })).toBe(
      "Olá! Segue o orçamento 3D nº 123: Chaveiro personalizado.",
    );
    // OS não leva link mesmo que venha um.
    expect(legendaDoDocumento({ tipo: "os", numero: 1, titulo: "x", link: "https://x" })).not.toContain("http");
  });
  it("título vazio, com ponto final, com travessão e com seta", () => {
    expect(legendaDoDocumento({ tipo: "orcamento", numero: 123, titulo: "" })).toBe("Olá! Segue o orçamento nº 123.");
    expect(legendaDoDocumento({ tipo: "orcamento", numero: 123, titulo: null })).toBe("Olá! Segue o orçamento nº 123.");
    expect(legendaDoDocumento({ tipo: "orcamento", numero: 1, titulo: "Banner." })).toBe("Olá! Segue o orçamento nº 1: Banner.");
    expect(legendaDoDocumento({ tipo: "orcamento", numero: 1, titulo: "Banner — fachada" })).toBe(
      "Olá! Segue o orçamento nº 1: Banner, fachada.",
    );
    const seta = legendaDoDocumento({ tipo: "os", numero: 1, titulo: "Lona → Ilhós – 2 un" });
    expect(seta).not.toMatch(SEM_TRAVESSAO);
    expect(seta).toBe("Olá! Segue a ordem de serviço nº 1: Lona Ilhós, 2 un.");
    expect(textoAoCliente("  a  —  b  ")).toBe("a, b");
  });
});

describe("telefone e instância", () => {
  it("telefone na ordem: documento, orçamento, WhatsApp do cadastro, telefone do cadastro", () => {
    const cli = { whatsapp_principal: " 96 3 ", telefone: "96 4" };
    expect(telefoneDoEnvio({ doDocumento: "96 1", doOrcamento: "96 2", doCliente: cli })).toBe("96 1");
    expect(telefoneDoEnvio({ doDocumento: "  ", doOrcamento: "96 2", doCliente: cli })).toBe("96 2");
    expect(telefoneDoEnvio({ doCliente: cli })).toBe("96 3");
    expect(telefoneDoEnvio({ doCliente: { whatsapp_principal: "", telefone: "96 4" } })).toBe("96 4");
    expect(telefoneDoEnvio({ doCliente: null })).toBeNull();
  });
  it("instância: ativa, conectada primeiro, a mais antiga", () => {
    const a = { id: "a", ativa: true, conectado: false, status: "desconectada", created_at: "2026-01-01" };
    const b = { id: "b", ativa: true, conectado: true, status: "conectada", created_at: "2026-02-01" };
    const c = { id: "c", ativa: false, conectado: true, status: "conectada", created_at: "2025-01-01" };
    const d = { id: "d", ativa: true, conectado: true, status: "conectada", created_at: "2026-03-01" };
    expect(instanciaDoEnvio([a, b, c, d])?.id).toBe("b");
    expect(instanciaDoEnvio([a, c])?.id).toBe("a");
    expect(instanciaDoEnvio([c])).toBeNull();
  });
  it("conectada só com ativa, conectado e status 'conectada'", () => {
    expect(instanciaConectada({ ativa: true, conectado: true, status: "conectada" })).toBe(true);
    expect(instanciaConectada({ ativa: true, conectado: false, status: "desconectada" })).toBe(false);
    expect(instanciaConectada({ ativa: true, conectado: true, status: "conectando" })).toBe(false);
    expect(instanciaConectada({ ativa: false, conectado: true, status: "conectada" })).toBe(false);
    expect(instanciaConectada(null)).toBe(false);
  });
});

describe("o desfecho daquela linha da fila", () => {
  const doc = { tipo: "orcamento" as const, numero: 123, comPdf: true };
  const res = (situacao: string, erro: string | null = null, mensagem_id = "m1") => ({
    status: 200,
    corpo: { ok: true, resultados: [{ fila_id: "f1", mensagem_id, situacao, erro }] },
  });

  const casos = [
    desfechoDoEnvioDoDocumento({ falhaDeRede: "Failed to fetch" }, "f1", doc),
    desfechoDoEnvioDoDocumento(res("enviada"), "f1", doc),
    desfechoDoEnvioDoDocumento(
      { status: 200, corpo: { ...res("enviada").corpo, erros_de_gravacao: [{ tabela: "whatsapp_mensagens", id: "m1", erro: "timeout" }] } },
      "f1",
      doc,
    ),
    desfechoDoEnvioDoDocumento(res("falha", null), "f1", doc),
    desfechoDoEnvioDoDocumento(res("pendente", null), "f1", doc),
    desfechoDoEnvioDoDocumento({ status: 503, corpo: { erro: "WhatsApp desconectado", comoResolver: "Reconecte no Monitor." } }, "f1", doc),
    desfechoDoEnvioDoDocumento({ status: 200, corpo: { ok: true, resultados: [] } }, "f1", doc),
  ];

  it("os sete casos", () => {
    expect(casos[0]).toEqual({
      situacao: "na_fila",
      tom: "aviso",
      texto:
        "O PDF do orçamento nº 123 está na fila e ainda não saiu: o envio não foi acionado (Failed to fetch). Use Tentar de novo na mensagem, na conversa.",
    });
    expect(casos[1]).toEqual({ situacao: "saiu", tom: "sucesso", texto: "O PDF do orçamento nº 123 saiu pelo WhatsApp da gráfica." });
    expect(casos[2]).toEqual({
      situacao: "saiu",
      tom: "aviso",
      texto: "O PDF do orçamento nº 123 saiu pelo WhatsApp, mas o sistema não conseguiu registrar: timeout.",
    });
    expect(casos[3]).toEqual({ situacao: "nao_saiu", tom: "erro", texto: "O PDF do orçamento nº 123 não saiu: o WhatsApp recusou." });
    expect(casos[4].texto).toBe("O PDF do orçamento nº 123 está na fila e ainda não saiu: o envio vai ser tentado de novo.");
    expect(casos[5].texto).toBe(
      "O PDF do orçamento nº 123 está na fila e ainda não saiu: WhatsApp desconectado. Reconecte no Monitor.",
    );
    expect(casos[6]).toEqual({
      situacao: "na_fila",
      tom: "aviso",
      texto: "O PDF do orçamento nº 123 está na fila: outra rodada de envio pode estar com ele. O selo da mensagem na conversa muda quando sair.",
    });
  });
  it("outra linha enviada no mesmo lote não conta como a minha", () => {
    const outra = { status: 200, corpo: { resultados: [{ fila_id: "f9", mensagem_id: "m9", situacao: "enviada", erro: null }] } };
    expect(desfechoDoEnvioDoDocumento(outra, "f1", doc).situacao).toBe("na_fila");
  });
  it("sem PDF diz 'O link'; OS e 3D com o artigo certo", () => {
    expect(desfechoDoEnvioDoDocumento(res("enviada"), "f1", { ...doc, comPdf: false }).texto).toBe(
      "O link do orçamento nº 123 saiu pelo WhatsApp da gráfica.",
    );
    expect(desfechoDoEnvioDoDocumento(res("falha", "número inválido"), "f1", { tipo: "os", numero: 456, comPdf: true }).texto).toBe(
      "O PDF da ordem de serviço nº 456 não saiu: número inválido.",
    );
    expect(desfechoDoEnvioDoDocumento(res("enviada"), "f1", { tipo: "orcamento_3d", numero: 7, comPdf: true }).texto).toBe(
      "O PDF do orçamento 3D nº 7 saiu pelo WhatsApp da gráfica.",
    );
  });
  it("nenhuma legenda nem desfecho tem travessão ou seta", () => {
    for (const d of casos) expect(d.texto).not.toMatch(SEM_TRAVESSAO);
    for (const tipo of ["orcamento", "os", "orcamento_3d"] as const) {
      expect(legendaDoDocumento({ tipo, numero: 1, titulo: "a — b → c", link: "https://x" })).not.toMatch(SEM_TRAVESSAO);
    }
  });
});
