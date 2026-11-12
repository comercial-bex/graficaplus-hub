import { beforeEach, describe, expect, it, vi } from "vitest";
import { BancoFalsoEnvio } from "./apoio/banco-falso-envio";

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: { server: () => ({}), options: {} } }));
vi.mock("@tanstack/react-start", () => {
  const cadeia: any = { middleware: () => cadeia, inputValidator: () => cadeia, handler: () => async () => undefined };
  return { createServerFn: () => cadeia };
});

import {
  executarConfirmacaoDoEnvio,
  executarEnvioDoDocumento,
  executarRegistroPorFora,
  origemPublica,
  pedidoDeEnvioSchema,
  type PedidoDeEnvioDoDocumento,
} from "../src/lib/api/documento-whatsapp.functions";
import { MOTIVO_DESCONECTADO } from "../src/domain/whatsapp/envio-de-documento";

const AGORA = new Date("2026-11-12T15:00:00Z");
const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORC = "11111111-1111-4111-8111-111111111111";
const OS = "33333333-3333-4333-8333-333333333333";
const T3D = "44444444-4444-4444-8444-444444444444";
const DOC = "55555555-5555-4555-8555-555555555555";
const CONV = "66666666-6666-4666-8666-666666666666";
const INST = "77777777-7777-4777-8777-777777777777";
const CAMINHO = `orcamento/${ORC}/1762959000000-orcamento-123.pdf`;

const PERFIL_VENDEDOR = ["whatsapp.reply", "orcamentos.send", "orcamentos.create", "os.read", "precos.read", "impressao3d.quote.update"];

function montar(o: { permissoes?: string[]; conectado?: boolean; comPix?: boolean } = {}) {
  const b = new BancoFalsoEnvio();
  const permissoes = new Set(o.permissoes ?? PERFIL_VENDEDOR);
  b.tabelas.orcamentos = [
    {
      id: ORC,
      numero: 123,
      titulo: "Banner — fachada",
      status: "rascunho",
      contato_nome: "Maria",
      contato_telefone: "96991116169",
      cliente_id: "cli-1",
      valor_total: 200,
      condicao_pagamento: { forma: "PIX", parcelas: 1 },
      conversa_id: null,
      os_id: null,
    },
  ];
  b.tabelas.clientes = [{ id: "cli-1", nome: "Maria Souza", whatsapp_principal: "96999990000", telefone: null }];
  b.tabelas.ordens_servico = [{ id: OS, numero: 456, titulo: "Lona", cliente_id: "cli-1", orcamento_id: ORC }];
  b.tabelas.orcamentos_3d = [
    { id: T3D, titulo: "Chaveiro", cliente_id: "cli-1", contato_nome: null, contato_telefone: null, orcamento_id: ORC, os_id: null },
  ];
  b.tabelas.documentos_gerados = [
    {
      id: DOC,
      tipo: "orcamento",
      referencia_id: ORC,
      variante: "cliente",
      caminho: CAMINHO,
      gerado_por: U,
      created_at: new Date(AGORA.getTime() - 60_000).toISOString(),
    },
  ];
  b.tabelas.whatsapp_instancias = [
    {
      id: INST,
      ativa: true,
      conectado: o.conectado ?? true,
      status: (o.conectado ?? true) ? "conectada" : "desconectada",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  b.tabelas.whatsapp_conversas = [];
  b.tabelas.empresa_config = [{ id: true, nome: "BEX PRINT", razao_social: null, cidade: "Macapa", pix_chave: o.comPix ? "pix@bex.com" : "" }];
  b.arquivos.set(`documentos-pdf/${CAMINHO}`, "PDF-BYTES");

  b.rpcs.has_permission = (a) => permissoes.has(String(a._permission));
  b.rpcs.orcamento_link_publico = () => "tok123";
  // O objeto no Storage: dono e hora que o navegador não escolhe.
  b.rpcs.arquivo_do_pdf_gerado = () => ({ owner_id: U, created_at: new Date(AGORA.getTime() - 60_000).toISOString() });
  b.rpcs.whatsapp_conversa_do_numero = () => {
    b.tabelas.whatsapp_conversas.push({ id: CONV, instancia_id: INST, os_id: null });
    return { id: CONV };
  };
  b.rpcs.whatsapp_responder_arquivo = (a) => {
    const msg = { id: b.novoId("msg"), conversa_id: a.p_conversa_id, enviada_por: a.p_usuario, tipo: a.p_tipo, legenda: a.p_legenda };
    b.linhas("whatsapp_mensagens").push(msg);
    const fila = { id: b.novoId("fila"), mensagem_id: msg.id };
    b.linhas("whatsapp_fila_envio").push(fila);
    return { mensagem_id: msg.id, fila_id: fila.id, status: "pendente" };
  };
  b.rpcs.registrar_envio_documento = () => ({ envio_id: "envio-1", enviado_em: AGORA.toISOString(), status_mudou: true, enviado_em_gravado: true });

  const dep = { usuario: b.cliente("usuario"), admin: b.cliente("admin"), usuarioId: U, agora: () => AGORA };
  return { b, dep };
}

const pedido = (m: Partial<PedidoDeEnvioDoDocumento> = {}): PedidoDeEnvioDoDocumento => ({
  tipo: "orcamento",
  referenciaId: ORC,
  documentoId: DOC,
  ...m,
});

function argsDe(b: BancoFalsoEnvio, nome: string) {
  const fn = b.rpcs[nome];
  const chamadas: Record<string, unknown>[] = [];
  b.rpcs[nome] = (a, q) => {
    chamadas.push(a);
    return fn(a, q);
  };
  return chamadas;
}

describe("enviarDocumentoAoCliente: o caminho bom", () => {
  it("baixa o caminho DA LINHA, copia para a conversa, enfileira como documento, registra e devolve o fila_id", async () => {
    const { b, dep } = montar();
    const resp = argsDe(b, "whatsapp_responder_arquivo");
    const reg = argsDe(b, "registrar_envio_documento");
    const r = await executarEnvioDoDocumento(dep, pedido());

    expect(b.houve(`admin:download:documentos-pdf/${CAMINHO}`)).toBe(true);
    expect(resp).toHaveLength(1);
    expect(resp[0]).toMatchObject({
      p_conversa_id: CONV,
      p_usuario: U,
      p_tipo: "documento",
      p_nome_arquivo: "orcamento-123.pdf",
      p_legenda: "Olá! Segue o orçamento nº 123: Banner, fachada.\nVocê pode conferir e aprovar por aqui: https://bexprint.com.br/orcamento-publico/tok123",
    });
    expect(String(resp[0].p_storage_path)).toMatch(new RegExp(`^caixa/${CONV}/\\d+-orcamento-123\\.pdf$`));

    expect(reg).toEqual([
      {
        p_usuario: U,
        p_tipo: "orcamento",
        p_referencia_id: ORC,
        p_canal: "whatsapp_sistema",
        p_documento_id: DOC,
        p_mensagem_id: r.mensagemId,
        p_conversa_id: CONV,
      },
    ]);
    expect(r).toMatchObject({
      conversaId: CONV,
      comPdf: true,
      nomeArquivo: "orcamento-123.pdf",
      link: "https://bexprint.com.br/orcamento-publico/tok123",
      registro: { ok: true, envioId: "envio-1", statusMudou: true, enviadoEmGravado: true },
    });
    expect(r.filaId).toMatch(/^fila-/);
    // O servidor não escreve status nem enviado_em por fora da função do banco.
    expect(b.houve("update:orcamentos")).toBe(false);
  });

  it("o link sai com a sessão de quem clicou; a conversa e a fila com a chave de serviço", async () => {
    const { b, dep } = montar();
    await executarEnvioDoDocumento(dep, pedido());
    expect(b.houve("usuario:rpc:orcamento_link_publico")).toBe(true);
    expect(b.houve("usuario:rpc:has_permission")).toBe(true);
    expect(b.houve("admin:rpc:whatsapp_conversa_do_numero")).toBe(true);
    expect(b.houve("admin:rpc:whatsapp_responder_arquivo")).toBe(true);
    expect(b.houve("usuario:rpc:whatsapp")).toBe(false);
  });

  it("o Pix do sinal sai DEPOIS do PDF e do registro, quando há chave Pix", async () => {
    const { b, dep } = montar({ comPix: true });
    const resp = argsDe(b, "whatsapp_responder_arquivo");
    const r = await executarEnvioDoDocumento(dep, pedido());
    expect(r.pix).toMatchObject({ enviado: true, valor: 100 });
    expect(resp.map((a) => a.p_tipo)).toEqual(["documento", "imagem"]);
    const registro = b.indice("rpc:registrar_envio_documento");
    expect(registro).toBeGreaterThan(b.indice("rpc:whatsapp_responder_arquivo"));
    expect(b.chamadas.lastIndexOf("admin:rpc:whatsapp_responder_arquivo")).toBeGreaterThan(registro);
  });

  it("sem chave Pix: o Pix não sai e o motivo volta", async () => {
    const { dep } = montar();
    const r = await executarEnvioDoDocumento(dep, pedido());
    expect(r.pix).toEqual({ enviado: false, valor: 0, motivo: "sem chave Pix cadastrada" });
  });

  it("falha do registro não derruba o envio: registro.ok = false com o motivo", async () => {
    const { b, dep } = montar();
    b.erros["rpc:registrar_envio_documento"] = "function registrar_envio_documento does not exist";
    const r = await executarEnvioDoDocumento(dep, pedido());
    expect(r.registro).toEqual({ ok: false, motivo: "function registrar_envio_documento does not exist" });
    expect(r.filaId).toMatch(/^fila-/);
  });

  it("orçamento sem PDF (documentoId null) vai pela fila de texto e devolve o filaId", async () => {
    const { b, dep } = montar();
    const reg = argsDe(b, "registrar_envio_documento");
    const r = await executarEnvioDoDocumento(dep, pedido({ documentoId: null }));
    expect(r.comPdf).toBe(false);
    expect(r.nomeArquivo).toBeNull();
    const fila = b.linhas("whatsapp_fila_envio").find((f) => f.id === r.filaId);
    expect(fila).toBeTruthy();
    expect(r.mensagemId).toBe(fila!.mensagem_id);
    expect(b.houve("upload:")).toBe(false);
    expect(b.houve("rpc:whatsapp_responder_arquivo")).toBe(false);
    expect(reg[0]).toMatchObject({ p_documento_id: null, p_mensagem_id: r.mensagemId, p_canal: "whatsapp_sistema" });
  });

  it("OS: vai a via do cliente para o telefone do orçamento de origem, sem link e sem Pix", async () => {
    const { b, dep } = montar({ comPix: true });
    b.tabelas.documentos_gerados[0] = {
      ...b.tabelas.documentos_gerados[0],
      tipo: "os",
      referencia_id: OS,
      caminho: `os/${OS}/1762959000000-os-456.pdf`,
    };
    b.arquivos.set(`documentos-pdf/os/${OS}/1762959000000-os-456.pdf`, "PDF");
    const numero = argsDe(b, "whatsapp_conversa_do_numero");
    const resp = argsDe(b, "whatsapp_responder_arquivo");
    const r = await executarEnvioDoDocumento(dep, pedido({ tipo: "os", referenciaId: OS }));
    expect(numero[0]).toMatchObject({ p_telefone: "96991116169", p_nome: "Maria" });
    expect(resp[0]).toMatchObject({ p_nome_arquivo: "OS-456.pdf", p_legenda: "Olá! Segue a ordem de serviço nº 456: Lona." });
    expect(r.link).toBeNull();
    expect(r.pix).toBeNull();
    expect(b.houve("orcamento_link_publico")).toBe(false);
  });

  it("3D: número do orçamento de origem, arquivo Orcamento-3D", async () => {
    const { b, dep } = montar();
    b.tabelas.documentos_gerados[0] = {
      ...b.tabelas.documentos_gerados[0],
      tipo: "orcamento_3d",
      referencia_id: T3D,
      caminho: `orcamento_3d/${T3D}/1762959000000-orcamento_3d-123.pdf`,
    };
    b.arquivos.set(`documentos-pdf/orcamento_3d/${T3D}/1762959000000-orcamento_3d-123.pdf`, "PDF");
    const resp = argsDe(b, "whatsapp_responder_arquivo");
    await executarEnvioDoDocumento(dep, pedido({ tipo: "orcamento_3d", referenciaId: T3D }));
    expect(resp[0]).toMatchObject({
      p_nome_arquivo: "Orcamento-3D-123.pdf",
      p_legenda: "Olá! Segue o orçamento 3D nº 123: Chaveiro.",
    });
  });
});

describe("enviarDocumentoAoCliente: as recusas, sem escrita nenhuma", () => {
  let cenario: ReturnType<typeof montar>;
  beforeEach(() => {
    cenario = montar();
  });

  const recusa = async (p: Partial<PedidoDeEnvioDoDocumento>, motivo: RegExp | string) => {
    await expect(executarEnvioDoDocumento(cenario.dep, pedido(p))).rejects.toThrow(motivo);
    expect(cenario.b.escritas()).toEqual([]);
    expect(cenario.b.houve("whatsapp_conversa_do_numero")).toBe(false);
  };

  it("sem permissão", async () => {
    cenario = montar({ permissoes: ["orcamentos.send"] });
    await recusa({}, "falta a permissão whatsapp › reply");
  });
  it("OS sem ver preço", async () => {
    cenario = montar({ permissoes: ["whatsapp.reply", "os.read", "orcamentos.create"] });
    await recusa({ tipo: "os", referenciaId: OS }, "Só quem vê o preço da OS manda a via do cliente.");
  });
  it("via de produção", async () => {
    cenario.b.tabelas.documentos_gerados[0].variante = "producao";
    await recusa({}, "Só a via do cliente vai ao cliente.");
  });
  it("via de custos", async () => {
    cenario.b.tabelas.documentos_gerados[0].variante = "custos";
    await recusa({}, "Só a via do cliente vai ao cliente.");
  });
  it("PDF gerado por outra pessoa", async () => {
    cenario.b.tabelas.documentos_gerados[0].gerado_por = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await recusa({}, "Este PDF foi gerado por outra pessoa. Gere de novo.");
  });
  it("linha velha", async () => {
    cenario.b.tabelas.documentos_gerados[0].created_at = new Date(AGORA.getTime() - 16 * 60_000).toISOString();
    await recusa({}, /há mais de 15 minutos/);
  });
  it("tipo trocado (a linha do orçamento mandada como OS)", async () => {
    await recusa({ tipo: "os", referenciaId: OS }, "Este PDF é de outro documento.");
  });
  it("documento que não existe", async () => {
    await recusa({ documentoId: "99999999-9999-4999-8999-999999999999" }, "O PDF gerado não foi encontrado. Gere de novo.");
  });
  it("OS sem PDF (documentoId null)", async () => {
    await recusa({ tipo: "os", referenciaId: OS, documentoId: null }, "Sem o PDF não há o que mandar: gere o PDF de novo.");
  });
  it("WhatsApp desconectado: recusa ANTES de abrir conversa e de copiar o arquivo", async () => {
    cenario = montar({ conectado: false });
    await recusa({}, MOTIVO_DESCONECTADO);
    expect(cenario.b.houve("download:")).toBe(false);
    expect(cenario.b.houve("upload:")).toBe(false);
  });
  it("WhatsApp desconectado também sem PDF (antes enfileirava texto sem conferir)", async () => {
    cenario = montar({ conectado: false });
    await recusa({ documentoId: null }, MOTIVO_DESCONECTADO);
  });
  it("painel com conversa não ligada ao documento", async () => {
    cenario.b.tabelas.whatsapp_conversas.push({ id: CONV, instancia_id: INST, os_id: null });
    await recusa({ conversaId: CONV }, "Este documento não está ligado a esta conversa. Ligue antes de mandar.");
  });
  it("painel com a OS de outra conversa", async () => {
    cenario.b.tabelas.whatsapp_conversas.push({ id: CONV, instancia_id: INST, os_id: null });
    Object.assign(cenario.b.tabelas.documentos_gerados[0], { tipo: "os", referencia_id: OS, caminho: `os/${OS}/1762959000000-os-456.pdf` });
    await recusa({ tipo: "os", referenciaId: OS, conversaId: CONV }, /não está ligado a esta conversa/);
  });
  it("painel com conversa de instância desconectada", async () => {
    cenario.b.tabelas.orcamentos[0].conversa_id = CONV;
    cenario.b.tabelas.whatsapp_conversas.push({ id: CONV, instancia_id: "outra", os_id: null });
    cenario.b.tabelas.whatsapp_instancias.push({ id: "outra", ativa: true, conectado: false, status: "erro", created_at: null });
    await recusa({ conversaId: CONV }, MOTIVO_DESCONECTADO);
  });
});

describe("enviarDocumentoAoCliente: depois da cópia", () => {
  it("recusa do whatsapp_responder_arquivo apaga a cópia e lança", async () => {
    const { b, dep } = montar();
    b.erros["rpc:whatsapp_responder_arquivo"] = "WhatsApp desconectado: o arquivo não foi enfileirado.";
    await expect(executarEnvioDoDocumento(dep, pedido())).rejects.toThrow("WhatsApp desconectado");
    const subida = b.chamadas.find((c) => c.startsWith("admin:upload:whatsapp-midias/"))!;
    const caminho = subida.replace("admin:upload:", "");
    expect(b.chamadas).toContain(`admin:remove:${caminho}`);
    expect([...b.arquivos.keys()].some((k) => k.startsWith("whatsapp-midias/"))).toBe(false);
    expect(b.houve("registrar_envio_documento")).toBe(false);
  });

  it("painel: manda NA conversa ligada, sem procurar pelo telefone", async () => {
    const { b, dep } = montar();
    b.tabelas.orcamentos[0].conversa_id = CONV;
    b.tabelas.whatsapp_conversas.push({ id: CONV, instancia_id: INST, os_id: null });
    const r = await executarEnvioDoDocumento(dep, pedido({ conversaId: CONV }));
    expect(r.conversaId).toBe(CONV);
    expect(b.houve("whatsapp_conversa_do_numero")).toBe(false);
  });

  it("a entrada exige documentoId explícito (null ou uuid)", () => {
    expect(() => pedidoDeEnvioSchema.parse({ tipo: "orcamento", referenciaId: ORC, origem: "https://x" })).toThrow();
    expect(pedidoDeEnvioSchema.parse({ tipo: "orcamento", referenciaId: ORC, origem: "https://x", documentoId: null }).documentoId).toBeNull();
  });
});

describe("registrarEnvioPorFora (wa.me e link copiado)", () => {
  it("wa.me: registra com p_canal wa_me, sem mensagem, documento nem conversa", async () => {
    const { b, dep } = montar();
    const reg = argsDe(b, "registrar_envio_documento");
    const r = await executarRegistroPorFora(dep, { tipo: "orcamento", referenciaId: ORC, canal: "wa_me" });
    expect(reg).toEqual([{ p_usuario: U, p_tipo: "orcamento", p_referencia_id: ORC, p_canal: "wa_me" }]);
    expect(r).toEqual({ envioId: "envio-1", statusMudou: true, enviadoEmGravado: true });
    expect(b.houve("update:orcamentos")).toBe(false);
  });
  it("sem orcamentos.send recusa sem registrar", async () => {
    const { b, dep } = montar({ permissoes: ["whatsapp.reply"] });
    await expect(executarRegistroPorFora(dep, { tipo: "orcamento", referenciaId: ORC, canal: "link_copiado" })).rejects.toThrow(
      "falta a permissão orcamentos › send",
    );
    expect(b.houve("registrar_envio_documento")).toBe(false);
  });
  it("erro do banco lança (a tela avisa e segue)", async () => {
    const { b, dep } = montar();
    b.erros["rpc:registrar_envio_documento"] = "Canal sem porta";
    await expect(executarRegistroPorFora(dep, { tipo: "orcamento", referenciaId: ORC, canal: "wa_me" })).rejects.toThrow("Canal sem porta");
  });
});


describe("a guarda não confia nos campos que o navegador grava", () => {
  const recusaSemEscrita = async (c: ReturnType<typeof montar>, motivo: RegExp | string) => {
    await expect(executarEnvioDoDocumento(c.dep, pedido())).rejects.toThrow(motivo);
    expect(c.b.escritas()).toEqual([]);
  };

  it("linha forjada (variante cliente) apontando para o arquivo de custos: o nome barra", async () => {
    const c = montar();
    const custos = `orcamento/${ORC}/1762959000000-orcamento-123-custos.pdf`;
    c.b.tabelas.documentos_gerados[0].caminho = custos;
    c.b.arquivos.set(`documentos-pdf/${custos}`, "CUSTOS");
    await recusaSemEscrita(c, "não é o de uma via do cliente");
  });

  it("linha forjada sobre arquivo de outra pessoa no Storage: o dono do objeto barra", async () => {
    const c = montar();
    c.b.rpcs.arquivo_do_pdf_gerado = () => ({ owner_id: "outro-usuario", created_at: new Date(AGORA.getTime() - 60_000).toISOString() });
    await recusaSemEscrita(c, "outra pessoa");
  });

  it("linha com created_at forjado sobre objeto antigo: a hora do Storage barra", async () => {
    const c = montar();
    c.b.rpcs.arquivo_do_pdf_gerado = () => ({ owner_id: U, created_at: new Date(AGORA.getTime() - 3_600_000).toISOString() });
    await recusaSemEscrita(c, "mais de 15 minutos");
  });

  it("objeto que não existe no Storage ou erro ao conferir: recusa", async () => {
    const c = montar();
    c.b.rpcs.arquivo_do_pdf_gerado = () => ({ owner_id: null, created_at: null });
    await recusaSemEscrita(c, "não está no Storage");
    const d = montar();
    d.b.erros["rpc:arquivo_do_pdf_gerado"] = "função inexistente";
    await recusaSemEscrita(d, "Não consegui conferir o arquivo");
  });
});

describe("origem do link, duplicado, Pix e registro", () => {
  it("o link usa a origem do servidor, e o pedido não aceita origem da tela", async () => {
    const { dep } = montar();
    const r = await executarEnvioDoDocumento(dep, { ...pedido(), origem: "https://preview.exemplo.dev" } as PedidoDeEnvioDoDocumento);
    expect(r.link).toBe("https://bexprint.com.br/orcamento-publico/tok123");
    expect(pedidoDeEnvioSchema.parse({ ...pedido(), origem: "https://x.dev" })).not.toHaveProperty("origem");
    vi.stubEnv("PUBLIC_APP_URL", "https://app.bexprint.com.br/qualquer/caminho");
    expect(origemPublica()).toBe("https://app.bexprint.com.br");
    vi.unstubAllEnvs();
  });

  it("o mesmo PDF não sai duas vezes; recusa antes de copiar o arquivo", async () => {
    const { b, dep } = montar();
    b.tabelas.documentos_enviados = [
      { documento_id: DOC, conversa_id: CONV, tipo: "orcamento", referencia_id: ORC, canal: "whatsapp_sistema", enviado_em: AGORA.toISOString() },
    ];
    await expect(executarEnvioDoDocumento(dep, pedido())).rejects.toThrow("acabou de ser enviado");
    // A conversa do número já existia (o envio anterior a abriu); nada é copiado nem enfileirado.
    expect(b.chamadas.filter((c) => /upload|remove|responder_arquivo|registrar_envio/.test(c))).toEqual([]);
  });

  it("Pix só em rascunho ou enviado", async () => {
    const { b, dep } = montar({ comPix: true });
    b.tabelas.orcamentos[0].status = "aprovado";
    const r = await executarEnvioDoDocumento(dep, pedido());
    expect(r.pix).toMatchObject({ enviado: false });
    expect(r.pix?.motivo).toContain("aprovado");
  });

  it("Pix já pedido nas últimas 24 horas não repete", async () => {
    const { b, dep } = montar({ comPix: true });
    b.tabelas.orcamentos[0].condicao_pagamento = { forma: "PIX", parcelas: 1, pix_enviado: { valor: 100, em: new Date(AGORA.getTime() - 3_600_000).toISOString() } };
    const r = await executarEnvioDoDocumento(dep, pedido());
    expect(r.pix).toMatchObject({ enviado: false });
    expect(r.pix?.motivo).toContain("24 horas");
  });

  it("o registro é tentado duas vezes antes de desistir", async () => {
    const { b, dep } = montar();
    let n = 0;
    b.rpcs.registrar_envio_documento = () => {
      n += 1;
      if (n === 1) throw new Error("statement timeout");
      return { envio_id: "envio-2", status_mudou: false, enviado_em_gravado: false };
    };
    const r = await executarEnvioDoDocumento(dep, pedido());
    expect(n).toBe(2);
    expect(r.registro).toMatchObject({ ok: true, envioId: "envio-2" });

    const f = montar();
    let m = 0;
    f.b.rpcs.registrar_envio_documento = () => {
      m += 1;
      throw new Error("sempre falha");
    };
    const r2 = await executarEnvioDoDocumento(f.dep, pedido());
    expect(m).toBe(2);
    expect(r2.registro).toMatchObject({ ok: false });
  });
});

describe("confirmarEnvioDoDocumento: status e enviado_em só com a mensagem fora", () => {
  const MSG = "88888888-8888-4888-8888-888888888888";
  function cenario(status: string, extra: Record<string, unknown> = {}) {
    const c = montar();
    c.b.tabelas.whatsapp_mensagens = [{ id: MSG, status, enviada_por: U, direcao: "saida" }];
    c.b.tabelas.documentos_enviados = [{ id: "envio-1", mensagem_id: MSG, tipo: "orcamento", referencia_id: ORC }];
    c.b.rpcs.confirmar_envio_documento = () => ({ status_mudou: true, enviado_em_gravado: true });
    Object.assign(c.b.tabelas.orcamentos[0], extra);
    return c;
  }
  const pedidoC = { tipo: "orcamento" as const, referenciaId: ORC, mensagemId: MSG };

  it("mensagem enviada: chama a função do banco", async () => {
    const { b, dep } = cenario("enviada");
    const r = await executarConfirmacaoDoEnvio(dep, pedidoC);
    expect(r).toMatchObject({ ok: true, statusMudou: true, pelaContingencia: false });
    expect(b.houve("admin:rpc:confirmar_envio_documento")).toBe(true);
  });

  it("mensagem na fila ou com falha: recusa sem tocar no orçamento", async () => {
    for (const st of ["pendente", "falha"]) {
      const { b, dep } = cenario(st);
      const r = await executarConfirmacaoDoEnvio(dep, pedidoC);
      expect(r).toMatchObject({ ok: false });
      expect(b.houve("update:orcamentos")).toBe(false);
      expect(b.houve("confirmar_envio_documento")).toBe(false);
    }
  });

  it("mensagem de outra pessoa: recusa", async () => {
    const { b, dep } = cenario("enviada");
    b.tabelas.whatsapp_mensagens[0].enviada_por = "outro";
    expect(await executarConfirmacaoDoEnvio(dep, pedidoC)).toMatchObject({ ok: false });
  });

  it("sem a função no banco (front antes da migração): contingência passa rascunho a enviado", async () => {
    const { b, dep } = cenario("enviada");
    delete b.rpcs.confirmar_envio_documento;
    const r = await executarConfirmacaoDoEnvio(dep, pedidoC);
    expect(r).toMatchObject({ ok: true, statusMudou: true, pelaContingencia: true });
    expect(b.tabelas.orcamentos[0].status).toBe("enviado");
    expect(b.tabelas.orcamentos[0].enviado_em).toBe(AGORA.toISOString());
  });

  it("contingência com registro que falhou (sem linha em documentos_enviados)", async () => {
    const { b, dep } = cenario("entregue");
    b.tabelas.documentos_enviados = [];
    const r = await executarConfirmacaoDoEnvio(dep, pedidoC);
    expect(r).toMatchObject({ ok: true, pelaContingencia: true });
    expect(b.tabelas.orcamentos[0].status).toBe("enviado");
  });

  it("contingência não mexe em orçamento aprovado", async () => {
    const { b, dep } = cenario("enviada", { status: "aprovado" });
    b.tabelas.documentos_enviados = [];
    const r = await executarConfirmacaoDoEnvio(dep, pedidoC);
    expect(r).toMatchObject({ ok: true, statusMudou: false, enviadoEmGravado: false });
    expect(b.tabelas.orcamentos[0].status).toBe("aprovado");
    expect(b.tabelas.orcamentos[0].enviado_em).toBeUndefined();
  });
});
