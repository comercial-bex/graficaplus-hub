import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { avisoParaFila, avisoParaPessoa } from "@/domain/whatsapp/aviso-de-transferencia";
import { fraseDoEvento } from "@/domain/whatsapp/caixa-de-entrada";

/**
 * 14/10/2026, pedido do dono: "o financeiro transferiu… vai cair lá na
 * produção, e assim vai". Na transferência, o cliente pode receber a frase de
 * passagem — em nome de quem transferiu, assinada pelo despachante com o setor
 * de ORIGEM. O que se segura:
 *   - a frase pronta, por setor e por pessoa;
 *   - no banco, o aviso entra ANTES da transferência (senão o gatilho da 1ª
 *     resposta faria de quem transferiu o responsável de novo) e leva a fila de
 *     origem no payload;
 *   - depois da transferência a conversa espera o novo dono;
 *   - WhatsApp fora não impede a transferência: o aviso diz por que não saiu.
 */

describe("a frase ao cliente", () => {
  it("por setor", () => {
    expect(avisoParaFila("producao")).toBe(
      "Vou passar seu atendimento para o setor de Produção. Em instantes alguém de lá continua com você por aqui.",
    );
    expect(avisoParaFila("financeiro")).toContain("para o setor Financeiro.");
    expect(avisoParaFila("comercial")).toContain("para o setor Comercial.");
    expect(avisoParaFila("administrativo")).toContain("para o setor Administrativo.");
  });

  it("por pessoa: primeiro nome e, se houver, o setor", () => {
    expect(avisoParaPessoa("Yvens Monteiro", "Gerência")).toBe(
      "Vou passar seu atendimento para Yvens (Gerência), que continua com você por aqui.",
    );
    expect(avisoParaPessoa("Fernando Augusto", null)).toBe(
      "Vou passar seu atendimento para Fernando, que continua com você por aqui.",
    );
  });
});

describe("a linha do tempo diz que o cliente foi avisado", () => {
  const nomes = new Map([["c", "Cibele"], ["y", "Yvens"]]);
  const base = { id: "e", conversa_id: "x", created_at: "2026-10-14T12:00:00Z", de_usuario: "c", para_usuario: null };
  it("fila e pessoa", () => {
    expect(
      fraseDoEvento(
        { ...base, tipo: "fila", detalhe: { de: "financeiro", para: "producao", motivo: "arte", aviso_ao_cliente: true } } as never,
        nomes,
      ),
    ).toBe("Cibele passou de Financeiro para Produção — arte e avisou o cliente");
    expect(
      fraseDoEvento({ ...base, tipo: "transferida", para_usuario: "y", detalhe: { aviso_ao_cliente: false } } as never, nomes),
    ).toBe("Cibele transferiu para Yvens");
  });
});

describe("no banco (migração 20261014150000, ensaiada com rollback em 14/10/2026)", () => {
  const sql = readFileSync(
    "supabase/migrations/20261014150000_whatsapp_foto_do_contato_e_aviso_de_transferencia.sql",
    "utf8",
  );
  const corpo = (nome: string) => {
    const i = sql.indexOf(`CREATE FUNCTION public.${nome}(`);
    expect(i, nome).toBeGreaterThan(0);
    return sql.slice(i, sql.indexOf("END $$;", i));
  };

  it("transferir para a fila: aviso (com a fila de origem) antes de mudar a fila", () => {
    const f = corpo("whatsapp_transferir_fila");
    expect(f).toContain("p_aviso text DEFAULT NULL");
    const aviso = f.indexOf("_wa_enfileirar_mensagem_da_equipe(p_conversa_id, p_usuario, v_aviso, v_de, 'transferencia')");
    const muda = f.indexOf("SET fila = p_fila::public.whatsapp_fila");
    expect(aviso).toBeGreaterThan(0);
    expect(aviso).toBeLessThan(muda);
    expect(f).toContain("responsavel_id = NULL");
    expect(f).toContain("aguardando_desde = coalesce(aguardando_desde, now())");
  });

  it("transferir para a pessoa: o mesmo, com a fila atual", () => {
    const f = corpo("whatsapp_transferir");
    expect(f).toContain("p_aviso text DEFAULT NULL");
    expect(f.indexOf("_wa_enfileirar_mensagem_da_equipe(")).toBeLessThan(f.indexOf("SET responsavel_id = p_para"));
  });

  it("o aviso vai para a fila de envio com autor e a fila de quem escreveu", () => {
    const f = sql.slice(sql.indexOf("FUNCTION public._wa_enfileirar_mensagem_da_equipe("));
    expect(f).toContain("jsonb_build_object('tipo', 'texto', 'texto', v_texto, 'fila', p_fila)");
    expect(f).toContain("p_origem || ':' || v_mensagem_id::text, p_usuario");
    // WhatsApp fora: não lança, devolve o motivo (a transferência segue).
    expect(f).toContain("RETURN jsonb_build_object('enfileirado', false, 'motivo', 'WhatsApp desconectado')");
  });

  it("a tela manda o aviso e o servidor repassa como p_aviso", () => {
    const fn = readFileSync("src/lib/api/whatsapp-caixa.functions.ts", "utf8");
    expect(fn.match(/p_aviso: data\.aviso \|\| null/g)?.length).toBe(2);
    const tela = readFileSync("src/components/whatsapp/conversa-aberta.tsx", "utf8");
    expect(tela).toContain("assinatura={minhaAssinatura}");
    expect(tela).toContain('acao: "transferir_fila", conversaId: conversa.id, fila, motivo, aviso: aviso ?? undefined');
  });
});
