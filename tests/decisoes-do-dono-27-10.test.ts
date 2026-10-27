import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mensagensDoPix, notaDoSinal, pedidoDeSinal } from "../src/domain/pagamento/sinal";
import { acaoDoBotaoDoPix, BOTOES_DO_PIX, textoDeReservaDosBotoes } from "../src/domain/pagamento/botoes-do-pix";
import { montarEnvio } from "../src/domain/whatsapp/zapi-envio";

const le = (p: string) => readFileSync(p, "utf8");

describe("o sinal em Pix que vai junto com o orçamento", () => {
  it("à vista: 50% do total; parcelado: a 1ª parcela", () => {
    expect(pedidoDeSinal({ total: 155, condicao: { forma: "PIX", parcelas: 1 }, chaveConfigurada: true })).toMatchObject({ enviar: true, valor: 77.5, parcelas: 1 });
    expect(pedidoDeSinal({ total: 300, condicao: { forma: "PIX", parcelas: 3, intervalo_dias: 30 }, chaveConfigurada: true })).toMatchObject({ enviar: true, valor: 100, parcelas: 3 });
    expect(notaDoSinal(1)).toContain("50%");
    expect(notaDoSinal(3)).toContain("1ª de 3");
  });
  it("sem forma escolhida ainda manda Pix; cartão, dinheiro ou Pix já recebido não mandam", () => {
    expect(pedidoDeSinal({ total: 100, condicao: null, chaveConfigurada: true }).enviar).toBe(true);
    expect(pedidoDeSinal({ total: 100, condicao: { forma: "Cartão de crédito" }, chaveConfigurada: true })).toMatchObject({ enviar: false, motivo: "pagamento combinado em Cartão de crédito" });
    expect(pedidoDeSinal({ total: 100, condicao: { forma: "PIX", pix_recebido: { valor: 50 } }, chaveConfigurada: true }).motivo).toBe("Pix já recebido");
    expect(pedidoDeSinal({ total: 100, condicao: { forma: "PIX" }, chaveConfigurada: false }).motivo).toBe("sem chave Pix cadastrada");
    expect(pedidoDeSinal({ total: 0, condicao: { forma: "PIX" }, chaveConfigurada: true }).enviar).toBe(false);
  });
});

describe("decisões do dono gravadas no banco e no código", () => {
  const sql = le("supabase/migrations/20261027330000_decisoes_do_dono_27_10.sql");
  it("atendimento ganha baixa, status, finalizar e kanban", () => {
    for (const p of ["os.update", "os.status.advance", "os.close", "pagamentos.create", "pagamentos.confirm", "kanban.read", "kanban.move"]) {
      expect(sql).toContain(`'${p}'`);
    }
  });
  it("Pix combinado só converte com o sinal recebido; o comprovante do WhatsApp vira anexo", () => {
    expect(sql).toContain("(b3) Sinal em Pix");
    expect(sql).toContain("Sinal em Pix ainda não marcado como recebido");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.anexar_comprovante_recebido");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.anexar_comprovante_recebido(uuid, text, text, text, bigint) TO service_role");
  });
  it("o envio do orçamento manda o QR Code do sinal e grava pix_enviado; o webhook anexa o comprovante", () => {
    const envio = le("src/lib/api/orcamento-whatsapp.functions.ts");
    expect(envio).toContain('await import("qrcode")');
    expect(envio).toContain("condicao.pix_enviado = { valor: pedido.valor, em: new Date().toISOString(), copia_e_cola: copiaECola }");
    expect(envio).toContain('p_tipo: "imagem"');
    const webhook = le("src/lib/api/whatsapp-webhook.server.ts");
    expect(webhook).toContain('"anexar_comprovante_recebido"');
    expect(webhook).toContain("if (!evento.deMim)");
    expect(le("src/lib/api/orcamento-comprovante.functions.ts")).toContain('from(c.bucket || "comprovantes")');
  });
  it("na tela: Pix recebido é obrigatório na conferência e 'O Pix chegou' num aprovado abre a conversão", () => {
    expect(le("src/domain/orcamentos/acordo.ts")).toContain('rotulo: "Sinal em Pix recebido"');
    const pagina = le("src/routes/_authenticated/orcamentos.$id.tsx");
    expect(pagina).toContain("aoMarcarPixRecebido={() => {");
    expect(pagina).toContain('data-testid="pix-do-sinal-enviado"');
    expect(le("src/components/orcamento/acordo-do-orcamento.tsx")).toContain("marca ? aoMarcarPixRecebido : undefined");
  });
});

describe("o Pix chega em três mensagens: QR Code, apresentação e o código sozinho", () => {
  const m = mensagensDoPix({ cliente: "Maria Souza", valor: 77.5, numeroDoOrcamento: 150, empresa: "BEX PRINT", parcelas: 1, copiaECola: "000201...6304ABCD" });
  it("o código vai numa mensagem só dele, para copiar com um toque", () => {
    expect(m.codigo).toBe("000201...6304ABCD");
    expect(m.introducao).not.toContain("000201");
  });
  it("a legenda do QR traz o valor e a apresentação pede o comprovante", () => {
    expect(m.legendaDoQr).toContain("Maria,");
    expect(m.legendaDoQr).toContain("#150");
    expect(m.legendaDoQr).toMatch(/R\$\s?77,50/);
    expect(m.introducao).toContain("comprovante");
    expect(m.introducao).toContain("50%");
  });
  it("o servidor enfileira QR, apresentação e código nessa ordem", () => {
    const s = le("src/lib/api/orcamento-whatsapp.functions.ts");
    const i = (t: string) => s.indexOf(t);
    expect(i("p_legenda: msgs.legendaDoQr")).toBeGreaterThan(0);
    expect(i('enfileirarTexto(db, conversaId, usuarioId, msgs.introducao, "pix_sinal")')).toBeGreaterThan(i("p_legenda: msgs.legendaDoQr"));
    expect(i('msgs.codigo, "pix_sinal_codigo"')).toBeGreaterThan(i("msgs.introducao"));
    expect(i('"pix_sinal_botoes"')).toBeGreaterThan(i('msgs.codigo, "pix_sinal_codigo"'));
  });
});

describe("botões do Pix: Já paguei, Ver orçamento, Falar com a equipe", () => {
  it("o toque no botão e a frase digitada levam à mesma ação; outra frase não", () => {
    expect(acaoDoBotaoDoPix("Já paguei")).toBe("paguei");
    expect(acaoDoBotaoDoPix("  ja PAGUEI! ")).toBe("paguei");
    expect(acaoDoBotaoDoPix("Ver orçamento")).toBe("orcamento");
    expect(acaoDoBotaoDoPix("Falar com a equipe")).toBe("equipe");
    expect(acaoDoBotaoDoPix("já paguei ontem o outro")).toBeNull();
    expect(acaoDoBotaoDoPix("")).toBeNull();
    expect(BOTOES_DO_PIX.length).toBeLessThanOrEqual(3);
    expect(BOTOES_DO_PIX.every((b) => b.rotulo.length <= 20)).toBe(true);
  });
  it("o pedido 'botoes' vira send-button-list e a reserva em texto lista as opções", () => {
    const m = montarEnvio({ tipo: "botoes", para: "(96) 99111-6169", texto: "Precisa de mais?", botoes: BOTOES_DO_PIX.map(({ id, rotulo }) => ({ id, rotulo })) }, { instanceId: "I", token: "T" });
    expect("url" in m && m.url).toContain("/send-button-list");
    expect("corpo" in m && (m.corpo as any).buttonList.buttons).toHaveLength(3);
    expect(textoDeReservaDosBotoes("Precisa de mais?", BOTOES_DO_PIX)).toContain("*Já paguei*, *Ver orçamento*, *Falar com a equipe*");
  });
  it("fila: o código vai sem assinatura, a resposta automática tem chave 'auto:' e o botão cai para texto se o Z-API recusar", () => {
    const f = le("src/lib/api/whatsapp-enviar.server.ts");
    expect(f).toContain("linha.payload?.sem_assinatura !== true");
    expect(f).toContain("/^(ia|auto):/.test(linha.idempotency_key");
    expect(f).toContain("textoDeReservaDosBotoes(pedido.texto");
    const o = le("src/lib/api/orcamento-whatsapp.functions.ts");
    expect(o).toContain('"pix_sinal_codigo", { sem_assinatura: true }');
    expect(o).toContain('tipo: "botoes"');
  });
  it("o webhook reage ao toque só com orçamento esperando o sinal, e a conversa vira humana em 'equipe'", () => {
    const w = le("src/lib/api/whatsapp-webhook.server.ts");
    expect(w).toContain('await reagirAoBotaoDoPix(gravada.conversa_id, evento.texto)');
    expect(w).toContain('"orcamento_do_pix_da_conversa"');
    expect(w).toContain('update({ modo: "humano" } as never)');
  });
});
