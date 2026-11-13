import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lerNumeroColado } from "../src/domain/whatsapp/numero-colado";
import { recebeWhatsApp } from "../src/domain/documentos";

/**
 * Nova conversa pelo número (21/10/2026, pedido do dono: "um atalho para
 * adicionar o contato e chamar direto ao colar o número"). Ensaio com rollback
 * da função do banco antes de aplicar: número novo criou a conversa com o nome
 * digitado; o mesmo número em link wa.me abriu a MESMA; o número da YRLEN abriu
 * a conversa dela já ligada à cliente; fixo recusado; perfil sem
 * whatsapp › reply barrado; 0 envio, 0 aviso, 0 atendimento, 0 lead.
 */

describe("o número colado, do jeito que vier", () => {
  it.each([
    ["(96) 99156-2194", "96991562194"],
    ["+55 (96) 99156-2194", "96991562194"],
    ["5596991562194", "96991562194"],
    ["096 99156-2194", "96991562194"],
    ["wa.me/5596991562194", "96991562194"],
    ["https://wa.me/+5596991562194?text=oi", "96991562194"],
    ["https://api.whatsapp.com/send?phone=5596991562194&text=Ol%C3%A1", "96991562194"],
    ["(11) 9 8765-4321", "11987654321"],
    // O formato antigo, sem o nono dígito, ganha o 9 como no banco.
    ["96 9156-2194", "96991562194"],
  ])("%s → %s", (colado, chave) => {
    const r = lerNumeroColado(colado);
    expect(r.ok && r.chave).toBe(chave);
    expect(r.ok && r.dddPresumido).toBe(false);
  });

  it("sem DDD é de Macapá: ganha o 96 e diz isso", () => {
    const r = lerNumeroColado("99156-2194");
    expect(r).toEqual({ ok: true, chave: "96991562194", legivel: "(96) 99156-2194", dddPresumido: true });
  });

  it.each([
    ["3222-1234", "fixo"],
    ["96 3222-1234", "fixo"],
    ["96 99131-8834 / 96 98140-8722", "mais de um número"],
    ["9915", "Faltam dígitos"],
    ["+1 415 555 1234", "celular do Brasil"],
  ])("%s é recusado (%s)", (colado, motivo) => {
    const r = lerNumeroColado(colado);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toContain(motivo);
  });

  it("campo vazio não acusa nada", () => {
    expect(lerNumeroColado("  ")).toEqual({ ok: false, motivo: null });
  });

  it("o que a tela aceita, o banco aceita (mesma regra de telefone_recebe_whatsapp)", () => {
    for (const t of ["(96) 99156-2194", "wa.me/5596991562194", "99156-2194", "(11) 9 8765-4321"]) {
      const r = lerNumeroColado(t);
      expect(r.ok && recebeWhatsApp(r.chave), t).toBe(true);
    }
  });
});

const SQL = readFileSync("supabase/migrations/20261021200000_whatsapp_conversa_pelo_numero.sql", "utf8");
const FN = readFileSync("src/lib/api/whatsapp-caixa.functions.ts", "utf8");
const DIALOGO = readFileSync("src/components/whatsapp/nova-conversa.tsx", "utf8");
const LISTA = readFileSync("src/components/whatsapp/lista-de-conversas.tsx", "utf8");
const TELA = readFileSync("src/routes/_authenticated/whatsapp.tsx", "utf8");

describe("a escrita passa pelo servidor (AGENTS.md)", () => {
  it("a função SQL só aceita a chave de serviço e confere a permissão de novo", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.whatsapp_conversa_do_numero(text, text, uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.whatsapp_conversa_do_numero(text, text, uuid) TO service_role;");
    expect(SQL).toContain("PERFORM public._wa_exigir_resposta(p_usuario);");
    expect(SQL).toContain("IF NOT public.telefone_recebe_whatsapp(p_telefone) THEN");
  });

  it("não envia nada: nem fila de envio, nem aviso", () => {
    expect(SQL).not.toContain("whatsapp_fila_envio");
    expect(SQL).not.toContain("notificacoes_fila");
  });

  it("acha a conversa do número antes de criar; liga ao cliente só se for UM ativo", () => {
    expect(SQL).toContain("WHERE instancia_id = v_instancia AND telefone_normalizado = v_chave");
    expect(SQL).toContain("IF coalesce(array_length(v_clientes, 1), 0) = 1 THEN v_cliente := v_clientes[1]; END IF;");
    expect(SQL).toContain("c.ativo IS NOT FALSE");
  });

  it("o servidor exige whatsapp.reply e chama a função com quem pediu", () => {
    const corpo = FN.slice(FN.indexOf("export const abrirConversaPeloNumero"), FN.indexOf("export const marcarLidaPorMim"));
    expect(corpo).toContain('await exigir(context.supabase, context.userId, "whatsapp.reply");');
    expect(corpo).toContain('db.rpc("whatsapp_conversa_do_numero"');
    expect(corpo).toContain("p_usuario: context.userId");
  });

  it("o diálogo não escreve direto no banco", () => {
    expect(DIALOGO).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(DIALOGO).not.toMatch(/\.rpc\(/);
    expect(DIALOGO).toContain("useServerFn(abrirConversaPeloNumero)");
  });
});

describe("o atalho na caixa", () => {
  // Onda 1 da caixa (12/11/2026, MOLDURA): o botão Nova saiu de ao lado da busca
  // para o topo da lista, com 44 px; a garantia (só para quem responde) é a mesma.
  it("botão Nova conversa no topo da lista, só para quem responde", () => {
    expect(LISTA).toContain("{onNovaConversa && <BotaoNovaConversa onClick={() => onNovaConversa()} />}");
    expect(TELA).toContain("onNovaConversa={temPermissaoDeResponder ? abrirNova : undefined}");
  });

  it("número colado na busca sem conversa: o botão Chamar já leva o número", () => {
    expect(LISTA).toContain("numeroDaBusca.ok && onNovaConversa ? (");
    expect(LISTA).toContain("onClick={() => onNovaConversa(numeroDaBusca.chave)}");
  });

  // Onda 1 da caixa (12/11/2026, MOLDURA): o caso "tecla N" foi trocado de
  // propósito (decisão 5 do dono: nenhuma letra solta faz ação; a Ctrl+Alt+N
  // que se pensou também não entra, é o AltGr do teclado ABNT2). A garantia de
  // fundo agora é a contrária: nenhum ouvinte de letra solta na nova conversa.
  it("nenhuma tecla solta abre a Nova conversa (só o botão e o Chamar da busca)", () => {
    expect(DIALOGO).not.toContain("useAtalhoNovaConversa");
    expect(DIALOGO).not.toContain('addEventListener("keydown"');
    expect(TELA).not.toContain("useAtalhoNovaConversa");
    expect(DIALOGO).toContain('aria-label="Nova conversa"');
  });

  it("sem clique duplo, e a conversa aberta já vem com o cursor na resposta", () => {
    expect(DIALOGO).toContain("if (!lido.ok || abrindoRef.current) return;");
    expect(DIALOGO).toContain('disabled={!lido.ok || abrindo}');
    expect(TELA).toContain("focarResposta={focarRespostaEm === selecionada.id}");
  });

  it("o cursor vai para a resposta só depois de o diálogo fechar (senão ele devolve o foco ao botão)", () => {
    // Visto na tela publicada em 21/10: com autoFocus na montagem o foco caía no
    // cabeçalho. O diálogo não devolve o foco quando abriu uma conversa, e o
    // pedido de foco só nasce no fim do fechamento.
    expect(DIALOGO).toContain("onCloseAutoFocus={(e) => {");
    expect(DIALOGO).toContain("e.preventDefault();\n          onFechouNaConversa?.(id);");
    expect(TELA).toContain("onFechouNaConversa={setFocarRespostaEm}");
    // A outra metade (a conversa põe o cursor na resposta, sem autoFocus) foi,
    // sem mudar, para tests/whatsapp-conversa-travas.test.ts (onda 1, 12/11/2026).
  });

  it("a dica mora em dicas.ts", () => {
    expect(DIALOGO).toContain('dicaAcao("/whatsapp", "nova_conversa")');
    expect(readFileSync("src/lib/dicas.ts", "utf8")).toContain("nova_conversa:");
  });
});
