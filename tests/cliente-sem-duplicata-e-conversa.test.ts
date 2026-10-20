import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Cliente sem duplicata, e a conversa do WhatsApp aberta a partir do cliente
 * (20/10/2026). A dúvida da Jhessy: cadastrou a YRLEN, buscou "YRLEN" no
 * WhatsApp e não achou nada — "como faço para colocar a pessoa no sistema?".
 *
 * Medido no banco: a YRLEN estava cadastrada CINCO vezes com o mesmo telefone
 * (uma em 19/10, quatro em 20/10 às 10:39:28, :29.3, :29.5 e :29.8 — cliques
 * repetidos num botão que não travava e num cadastro que não conferia o
 * telefone). E a caixa de entrada só conhecia conversa que CHEGOU pelo Z-API.
 *
 * O ensaio no banco (rollback, como a Jhessy): a sexta YRLEN é recusada citando
 * a que existe; telefone novo entra; mudar outro cliente para um telefone em uso
 * é barrado; cliente inativo não trava; a conversa da YRLEN nasce ligada a ela
 * (aberta/comercial/humano) e a segunda chamada devolve a mesma; a Cibele, sem
 * whatsapp.reply, é barrada; nem anon nem authenticated executam a função.
 * Aqui: as travas que o ensaio não repete.
 */

const SQL = readFileSync("supabase/migrations/20261020120000_cliente_sem_duplicata_e_conversa_pelo_cliente.sql", "utf8");
const LISTA = readFileSync("src/routes/_authenticated/clientes.index.tsx", "utf8");
const FICHA = readFileSync("src/routes/_authenticated/clientes.$id.tsx", "utf8");
const CAIXA = readFileSync("src/components/whatsapp/usar-caixa-de-entrada.ts", "utf8");
const VAZIO = readFileSync("src/components/whatsapp/lista-de-conversas.tsx", "utf8");
const SERVIDOR = readFileSync("src/lib/api/whatsapp-caixa.functions.ts", "utf8");

describe("um cliente ativo por WhatsApp", () => {
  it("o banco recusa o segundo cliente ATIVO com o mesmo WhatsApp e diz quem já existe", () => {
    expect(SQL).toContain("CREATE TRIGGER ac_cliente_sem_duplicata_de_whatsapp");
    expect(SQL).toContain("BEFORE INSERT OR UPDATE OF telefone, ativo ON public.clientes");
    expect(SQL).toContain("IF NEW.ativo IS DISTINCT FROM true THEN RETURN NEW; END IF;");
    expect(SQL).toContain("c.ativo = true AND c.id <> NEW.id");
    expect(SQL).toContain("ERRCODE = '23505'");
    // A mensagem é em português com acento: passa inteira pelo tradutor de erros
    // da tela, que junta message, details e hint — por isso sem DETAIL nem HINT.
    expect(SQL).toContain("Este WhatsApp já é de \"%\", que está cadastrado.");
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.tg_cliente_sem_duplicata_de_whatsapp"), SQL.indexOf("CREATE TRIGGER ac_cliente"));
    expect(fn).not.toMatch(/DETAIL\s*=|HINT\s*=/);
  });

  it("o cadastro de parceiro por convite não trava (cria o cliente da marca com o telefone do próprio parceiro)", () => {
    expect(SQL).toContain("IF NEW.origem = 'convite_parceiro' THEN RETURN NEW; END IF;");
  });

  it("a conferência olha todos os clientes (DEFINER), não só os que quem cadastra enxerga, e fica fechada ao público", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.tg_cliente_sem_duplicata_de_whatsapp"), SQL.indexOf("CREATE TRIGGER ac_cliente"));
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("REVOKE ALL ON FUNCTION public.tg_cliente_sem_duplicata_de_whatsapp() FROM PUBLIC, anon, authenticated;");
  });

  it("a tela avisa ANTES do clique, com link para o cadastro que existe, e trava o botão enquanto salva", () => {
    expect(LISTA).toContain('.eq("telefone_normalizado", chaveDoWhatsApp as string)');
    expect(LISTA).toContain('.eq("ativo", true)');
    expect(LISTA).toContain('data-ja-cadastrado=""');
    expect(LISTA).toContain("Abrir o cadastro");
    expect(LISTA).toContain("const [salvando, setSalvando] = useState(false);");
    expect(LISTA).toContain("if (salvando) return;");
    expect(LISTA).toContain("disabled={salvando || !!jaCadastrado.data}");
    expect(LISTA).toContain('{salvando ? "Cadastrando…" : "Cadastrar"}');
    // O banco confere de novo: a tela não é a única porta.
    expect(LISTA).toContain("ac_cliente_sem_duplicata_de_whatsapp");
  });
});

describe("a conversa do cliente, achada ou criada", () => {
  it("exige whatsapp.reply (abrir é começar a responder), telefone válido e a instância ativa", () => {
    expect(SQL).toContain("PERFORM public._wa_exigir_resposta(p_usuario);");
    expect(SQL).toContain("NOT public.telefone_recebe_whatsapp(v_telefone)");
    expect(SQL).toContain("FROM public.whatsapp_instancias\n   WHERE ativa ORDER BY conectado DESC NULLS LAST, created_at LIMIT 1");
  });

  it("acha a conversa que já existe pelo telefone (e liga ao cliente, e reabre); senão cria vazia, humana, na fila comercial", () => {
    expect(SQL).toContain("WHERE instancia_id = v_instancia AND telefone_normalizado = v_chave");
    expect(SQL).toContain("SET cliente_id = coalesce(cliente_id, p_cliente_id)");
    expect(SQL).toContain("WHEN status IN ('resolvida', 'arquivada') THEN 'aberta'::whatsapp_conversa_status");
    expect(SQL).toContain("'aberta', 'comercial', 'humano'");
    expect(SQL).toContain("'Conversa aberta por ' || coalesce(v_quem, 'alguém da equipe') || ' pelo cadastro do cliente'");
    expect(SQL).toContain("RETURN jsonb_build_object('id', v_conversa_id, 'nova', v_nova, 'telefone', v_telefone);");
  });

  it("como as outras escritas da caixa (AGENTS.md): só a chave de serviço executa; o navegador nunca", () => {
    expect(SQL).toContain("DROP FUNCTION IF EXISTS public.whatsapp_conversa_do_cliente(uuid);");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.whatsapp_conversa_do_cliente(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.whatsapp_conversa_do_cliente(uuid, uuid) TO service_role;");
    expect(SQL).not.toMatch(/whatsapp_conversa_do_cliente\([^)]*\) TO [^;]*authenticated/);
  });

  it("o servidor confere a permissão de quem pediu e passa o id dele à função", () => {
    const fn = SERVIDOR.slice(SERVIDOR.indexOf("export const abrirConversaDoCliente"), SERVIDOR.indexOf("export const marcarLidaPorMim"));
    expect(fn).toContain(".middleware([requireSupabaseAuth])");
    expect(fn).toContain('await exigir(context.supabase, context.userId, "whatsapp.reply");');
    expect(fn).toContain("const db = (await admin()) as any;");
    expect(fn).toContain("p_usuario: context.userId,");
    // O navegador não chama a função SQL direto.
    expect(FICHA).not.toContain('rpc("whatsapp_conversa_do_cliente"');
  });

  it("a ficha do cliente tem o botão, só para quem responde, e leva direto à conversa", () => {
    expect(FICHA).toContain('const podeConversar = hasPermission("whatsapp.reply");');
    expect(FICHA).toContain("const abrirConversa = useServerFn(abrirConversaDoCliente);");
    expect(FICHA).toContain("await abrirConversa({ data: { clienteId: id } });");
    expect(FICHA).toContain('navigate({ to: "/whatsapp", search: { conversa: r.id } });');
    expect(FICHA).toContain("Conversar no WhatsApp");
    expect(FICHA).toContain("podeConversar && cliente.ativo && (");
  });
});

describe("a busca da caixa acha pelo nome do CLIENTE ligado", () => {
  it("termo só de letras procura em clientes e entra na mesma consulta; termo com dígito é telefone", () => {
    expect(CAIXA).toContain("async function clientesComONome(termo: string): Promise<string[]>");
    expect(CAIXA).toContain('if (!termo || /\\d/.test(termo)) return [];');
    expect(CAIXA).toContain("partes.push(`cliente_id.in.(${clientesDaBusca.join(\",\")})`)");
    expect(CAIXA).toContain("const clientesDaBusca = await clientesComONome(termoSeguro(f.busca));");
    expect(CAIXA).toContain("q = filtrarConsulta(q, f, clientesDaBusca);");
  });

  it("os contadores das pílulas continuam sem busca (não pagam a consulta de clientes)", () => {
    const contadores = CAIXA.slice(CAIXA.indexOf("export function useContadores"), CAIXA.indexOf("/** Uma conversa pelo id"));
    expect(contadores).toContain('{ fila, status: st, busca: "", userId, setores }');
    expect(contadores).not.toContain("clientesComONome");
  });

  it("a lista vazia diz o caminho: Clientes › ficha › Conversar no WhatsApp", () => {
    expect(VAZIO).toContain("Abra a ficha dele em Clientes e toque em Conversar no WhatsApp.");
  });
});
