import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nomeParecendoEndereco, sugerirEmail, validarCadastroRapido } from "../src/domain/parceiros/cadastro-rapido";

/**
 * Endurecimento do convite curto (03/11/2026). A função do banco é chamável sem
 * login e põe texto na mensagem do WhatsApp da gráfica: o que ela recebe tem de
 * ser conferido, e a página tem de aplicar a mesma regra ANTES de criar a conta
 * (a conta nasce antes da função rodar; recusar depois deixaria conta órfã).
 */
const SQL = readFileSync("supabase/migrations/20261103400000_convite_curto_endurecimento.sql", "utf8");
const CONVITE = readFileSync("src/routes/convite.$codigo.tsx", "utf8");

describe("o nome que vai na mensagem do WhatsApp", () => {
  it("recusa endereço de site, link e e-mail; aceita nome de empresa comum", () => {
    for (const ruim of ["Loja www.golpe.com", "http://x.co", "https://golpe.link/x", "joao@gmail.com", "Gráfica.br", "ver bit.ly"]) {
      expect(nomeParecendoEndereco(ruim), ruim).toBe(true);
    }
    for (const bom of ["Gráfica J.R. Ltda", "Connecta IA", "Cia. do Letreiro", "Studio Ana & Filhos", "Zé @graficadoze", "Comunicação Visual Macapá"]) {
      expect(nomeParecendoEndereco(bom), bom).toBe(false);
    }
  });
  it("a validação do formulário aponta o campo nome antes de criar a conta", () => {
    expect(validarCadastroRapido({ nome: "Loja www.x.com", telefone: "(96) 99206-1119", email: "d@x.com" })?.campo).toBe("nome");
  });
  it("a regra da página é a do banco: mesmos termos nas duas", () => {
    const termos = "com|net|org|br|io|app|dev|me|co|info|biz|xyz|link|site|online|store|shop|click|ly|gl";
    expect(SQL).toContain(`\\.(${termos})(\\y|$)`);
    const ts = readFileSync("src/domain/parceiros/cadastro-rapido.ts", "utf8");
    expect(ts).toContain(`\\.(${termos})(\\b|$)`);
  });
});

describe("o e-mail digitado errado", () => {
  it("sugere o provedor comum quando o domínio está a uma edição", () => {
    expect(sugerirEmail("ruanny.amanda1609@gmai.com")).toBe("ruanny.amanda1609@gmail.com");
    expect(sugerirEmail("a@gmial.com")).toBe("a@gmail.com");
    expect(sugerirEmail("a@hotmial.com")).toBe("a@hotmail.com");
    expect(sugerirEmail("A@Gmail.com.br")).toBe("a@gmail.com");
    expect(sugerirEmail("a@gmail.con")).toBe("a@gmail.com");
  });
  it("não mexe em e-mail certo nem em domínio de empresa", () => {
    expect(sugerirEmail("a@gmail.com")).toBeNull();
    expect(sugerirEmail("a@outlook.com.br")).toBeNull();
    expect(sugerirEmail("contato@graficaplus.com.br")).toBeNull();
    expect(sugerirEmail("contato@connecta.ia")).toBeNull();
    expect(sugerirEmail("sem-arroba")).toBeNull();
  });
  it("a página avisa uma vez antes de criar a conta e deixa corrigir com um toque", () => {
    expect(CONVITE).toContain("sugerirEmail(email)");
    expect(CONVITE.indexOf("sugerirEmail(email)")).toBeLessThan(CONVITE.indexOf("supabase.auth.signUp"));
    expect(CONVITE).toContain("Usar {sugestaoEmail}");
    expect(CONVITE).toContain("setEmailConferido(false)");
  });
});

describe("a migração de endurecimento", () => {
  it("só confia na função se ela não mudou desde a anterior (guarda de md5)", () => {
    expect(SQL).toContain("'3a2fc200b41ee22dfe1eff8426ac3c83'");
    expect(SQL).toContain("'5e0a281d0e9e95d69fe6e86b86f7019c'");
  });
  it("a senha tem de ter a forma da página E ser a da conta; o e-mail tem de ser o da conta", () => {
    expect(SQL).toContain("v_senha !~ '^[2-9A-HJ-NP-Z]{8}$'");
    expect(SQL).toContain("extensions.crypt(v_senha, v_hash) <> v_hash");
    expect(SQL).toContain("v_email_conta IS DISTINCT FROM v_email");
  });
  it("limita os avisos por WhatsApp e cancela o excedente em vez de apagar", () => {
    expect(SQL).toContain("IF v_recentes >= 3 THEN");
    expect(SQL).toContain("SET status = 'cancelado'");
  });
  it("a senha some da fila, da mensagem, do log e da prévia da conversa; a função interna não é chamável de fora", () => {
    expect(SQL).toContain("variaveis = variaveis - 'senha'");
    expect(SQL).toContain("UPDATE public.whatsapp_mensagens");
    expect(SQL).toContain("UPDATE public.whatsapp_logs");
    expect(SQL).toContain("SET ultima_mensagem = regexp_replace");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.ocultar_senha_provisoria_do_parceiro(uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("PERFORM public.ocultar_senha_provisoria_do_parceiro(v_id);");
    expect(SQL).toContain("COMMENT ON FUNCTION public.ocultar_senha_provisoria_do_parceiro(uuid) IS");
  });
  it("mantém o que o resto do sistema depende: assinatura, travas de 15 min e papel do parceiro", () => {
    expect(SQL).toContain("p_origem jsonb DEFAULT NULL");
    expect(SQL).toContain("interval '15 minutes'");
    expect(SQL).toContain("INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro')");
    expect(SQL).toContain("COMMENT ON FUNCTION public.parceiro_cadastrar_rapido(");
  });
});
