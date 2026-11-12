import { describe, expect, it } from "vitest";
import {
  CLASSE_DO_BOTAO_PDF,
  ROTULO_DO_BOTAO_PDF,
  estadoDoBotaoPdf,
  perguntaDoPdfQueFalhou,
} from "../src/domain/whatsapp/enviar-pdf-na-tela";
import { DICAS_DO_PDF_AO_CLIENTE } from "../src/lib/dicas";

const SEM_TRAVESSAO = /[—–→←⇒➜➔]/;
const so = (...chaves: string[]) => (p: string) => chaves.includes(p);
const conectada = { id: "i1", ativa: true, conectado: true, status: "conectada", created_at: "2026-01-01T00:00:00Z" };
const caida = { id: "i2", ativa: true, conectado: false, status: "desconectada", created_at: "2026-01-02T00:00:00Z" };

describe("o botão Enviar PDF ao cliente na tela", () => {
  it("tem 44 px de altura e letra de 16 px", () => {
    expect(CLASSE_DO_BOTAO_PDF).toContain("h-11");
    expect(CLASSE_DO_BOTAO_PDF).toContain("text-base");
    expect(ROTULO_DO_BOTAO_PDF).toBe("Enviar PDF ao cliente");
  });

  it("sem permissão do tipo o botão nem aparece (a mesma regra do servidor)", () => {
    const s = estadoDoBotaoPdf({ tipo: "orcamento", tem: so("orcamentos.send"), instancias: [conectada] });
    expect(s.visivel).toBe(false);
    // Vendedor sem preço não manda a via do cliente da OS.
    expect(estadoDoBotaoPdf({ tipo: "os", tem: so("whatsapp.reply", "os.read", "orcamentos.create"), instancias: [conectada] }).visivel).toBe(false);
    expect(estadoDoBotaoPdf({ tipo: "os", tem: so("whatsapp.reply", "os.read", "precos.read", "orcamentos.create"), instancias: [conectada] }).visivel).toBe(true);
    expect(estadoDoBotaoPdf({ tipo: "orcamento_3d", tem: so("whatsapp.reply", "impressao3d.quote.update", "orcamentos.create"), instancias: [conectada] }).visivel).toBe(true);
  });

  it("WhatsApp desconectado: aparece desligado com a Dica 'Reconecte o WhatsApp no Monitor'", () => {
    const s = estadoDoBotaoPdf({ tipo: "orcamento", tem: so("whatsapp.reply", "orcamentos.send", "orcamentos.create"), instancias: [caida] });
    expect(s).toEqual({ visivel: true, ligado: false, dica: "Reconecte o WhatsApp no Monitor" });
    expect(DICAS_DO_PDF_AO_CLIENTE.desconectado).toBe("Reconecte o WhatsApp no Monitor");
  });

  it("nenhuma instância ativa também é desconectado", () => {
    const s = estadoDoBotaoPdf({ tipo: "orcamento", tem: so("whatsapp.reply", "orcamentos.send", "orcamentos.create"), instancias: [] });
    expect(s.ligado).toBe(false);
  });

  it("sem conseguir ler as instâncias o botão NÃO desliga (o servidor confere)", () => {
    const s = estadoDoBotaoPdf({ tipo: "orcamento", tem: so("whatsapp.reply", "orcamentos.send", "orcamentos.create"), instancias: undefined });
    expect(s).toMatchObject({ visivel: true, ligado: true });
  });

  it("conectada: ligado, com a Dica do que o botão faz", () => {
    const s = estadoDoBotaoPdf({ tipo: "orcamento", tem: so("whatsapp.reply", "orcamentos.send", "orcamentos.create"), instancias: [caida, conectada] });
    expect(s).toEqual({ visivel: true, ligado: true, dica: DICAS_DO_PDF_AO_CLIENTE.orcamento });
  });

  it("no painel da conversa vale a instância DA conversa, não a de uma conversa nova", () => {
    const tem = so("whatsapp.reply", "orcamentos.send", "orcamentos.create");
    expect(estadoDoBotaoPdf({ tipo: "orcamento", tem, instancias: [caida, conectada], instanciaId: "i2" }).ligado).toBe(false);
    expect(estadoDoBotaoPdf({ tipo: "orcamento", tem, instancias: [caida, conectada], instanciaId: "i1" }).ligado).toBe(true);
  });

  it("enviando ou esperando o documento: desligado, sem confundir com desconectado", () => {
    const tem = so("whatsapp.reply", "orcamentos.send", "orcamentos.create");
    expect(estadoDoBotaoPdf({ tipo: "orcamento", tem, instancias: [conectada], enviando: true })).toMatchObject({
      ligado: false,
      dica: DICAS_DO_PDF_AO_CLIENTE.enviando,
    });
    expect(estadoDoBotaoPdf({ tipo: "orcamento", tem, instancias: [conectada], esperandoODocumento: true })).toMatchObject({
      ligado: false,
      dica: DICAS_DO_PDF_AO_CLIENTE.esperando_o_pdf,
    });
  });

  it("os textos que a pessoa lê não têm travessão nem seta", () => {
    for (const t of Object.values(DICAS_DO_PDF_AO_CLIENTE)) expect(t).not.toMatch(SEM_TRAVESSAO);
    const p = perguntaDoPdfQueFalhou("Falha ao montar a página 2.");
    expect(p.texto).toBe(
      "Falha ao montar a página 2. Quer mandar só o texto com o link de aprovação, sem o PDF? Se não, nada é enviado.",
    );
    expect(`${p.titulo} ${p.texto}`).not.toMatch(SEM_TRAVESSAO);
  });
});
