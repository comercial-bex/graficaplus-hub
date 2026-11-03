import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALFABETO_DA_SENHA,
  cadastroPendente,
  gerarSenhaProvisoria,
  mascaraWhatsapp,
  validarCadastroRapido,
  validarComplemento,
} from "../src/domain/parceiros/cadastro-rapido";
import { renderizarTemplate } from "../src/domain/whatsapp/zapi-envio";

/**
 * Convite curto (03/11/2026, decisão do dono): a página pede nome, WhatsApp e
 * e-mail; a senha provisória vai pelo WhatsApp com o link; o resto é pedido no
 * primeiro acesso, antes de qualquer tela do painel.
 */
const ler = (p: string) => readFileSync(p, "utf8");
const CONVITE = ler("src/routes/convite.$codigo.tsx");
const PRIMEIRO_ACESSO = ler("src/components/parceiro/completar-cadastro.tsx");
const LAYOUT = ler("src/routes/parceiro.tsx");
const SQL = ler("supabase/migrations/20261103300000_convite_curto_e_primeiro_acesso.sql");

describe("a senha provisória", () => {
  it("tem 8 caracteres, só do alfabeto sem letras parecidas (0/O, 1/I/l)", () => {
    for (let i = 0; i < 20; i++) {
      const s = gerarSenhaProvisoria();
      expect(s).toHaveLength(8);
      for (const c of s) expect(ALFABETO_DA_SENHA).toContain(c);
    }
    expect(ALFABETO_DA_SENHA).not.toMatch(/[01OIl]/);
  });
  it("é determinística com o sorteio injetado (o teste não depende da sorte)", () => {
    const fixo = (n: number) => Uint32Array.from({ length: n }, (_, i) => i);
    expect(gerarSenhaProvisoria(fixo)).toBe(ALFABETO_DA_SENHA.slice(0, 8));
  });
});

describe("o formulário curto", () => {
  it("aceita nome, WhatsApp com DDD e e-mail; aponta o campo que falta", () => {
    expect(validarCadastroRapido({ nome: "Connecta", telefone: "(96) 99206-1119", email: "d@x.com" })).toBeNull();
    expect(validarCadastroRapido({ nome: "C", telefone: "(96) 99206-1119", email: "d@x.com" })?.campo).toBe("nome");
    expect(validarCadastroRapido({ nome: "Connecta", telefone: "9920", email: "d@x.com" })?.campo).toBe("telefone");
    expect(validarCadastroRapido({ nome: "Connecta", telefone: "(96) 99206-1119", email: "d@x" })?.campo).toBe("email");
  });
  it("máscara do WhatsApp: celular e fixo", () => {
    expect(mascaraWhatsapp("96992061119")).toBe("(96) 99206-1119");
    expect(mascaraWhatsapp("9632231234")).toBe("(96) 3223-1234");
  });
  it("a página tem só três campos e chama o cadastro rápido com a senha provisória e a marca de pendente", () => {
    expect(CONVITE.match(/<CampoDeAcesso/g)?.length).toBe(3);
    expect(CONVITE).toContain('"parceiro_cadastrar_rapido"');
    expect(CONVITE).toContain("p_senha: senha");
    expect(CONVITE).toContain("[CHAVE_CADASTRO_PENDENTE]: true");
    expect(CONVITE).not.toContain("parceiro_cadastrar_por_convite");
    // quem acabou de se cadastrar já está logado: o botão abre o painel com a página inteira
    expect(CONVITE).toContain('<a href="/parceiro"');
    expect(CONVITE).toContain("já está liberado");
  });
});

describe("o primeiro acesso", () => {
  it("exige senha de 8+ com letra e número, ramo da lista e comprovação", () => {
    const ramos = ["grafica", "outro"];
    const ok = { ramo: "grafica", ramoOutro: "", comprovacao: "@conecta", novaSenha: "abc12345" };
    expect(validarComplemento(ok, ramos)).toBeNull();
    expect(validarComplemento({ ...ok, novaSenha: "abc1234" }, ramos)?.campo).toBe("novaSenha");
    expect(validarComplemento({ ...ok, novaSenha: "abcdefgh" }, ramos)?.campo).toBe("novaSenha");
    expect(validarComplemento({ ...ok, ramo: "" }, ramos)?.campo).toBe("ramo");
    expect(validarComplemento({ ...ok, ramo: "outro" }, ramos)?.campo).toBe("ramoOutro");
    expect(validarComplemento({ ...ok, comprovacao: "ab" }, ramos)?.campo).toBe("comprovacao");
  });
  it("a marca de pendente é lida dos dados da conta", () => {
    expect(cadastroPendente({ cadastro_pendente: true })).toBe(true);
    expect(cadastroPendente({ cadastro_pendente: false })).toBe(false);
    expect(cadastroPendente({})).toBe(false);
    expect(cadastroPendente(null)).toBe(false);
  });
  it("o layout do parceiro mostra a tela antes da casca; ela grava os dados e só depois troca a senha e apaga a marca", () => {
    expect(LAYOUT).toContain("cadastroPendente(user.user_metadata)");
    expect(LAYOUT.indexOf("<CompletarCadastro")).toBeLessThan(LAYOUT.indexOf("<Casca painel"));
    expect(PRIMEIRO_ACESSO.indexOf('"parceiro_completar_cadastro"')).toBeLessThan(PRIMEIRO_ACESSO.indexOf("supabase.auth.updateUser"));
    expect(PRIMEIRO_ACESSO).toContain("data: { [CHAVE_CADASTRO_PENDENTE]: false }");
    expect(PRIMEIRO_ACESSO).toContain('autoComplete="new-password"');
  });
});

describe("a mensagem que sai", () => {
  it("o modelo renderizado pelo despachante leva link, e-mail e senha em linhas próprias", () => {
    const corpo = SQL.match(/E'(Olá, \{\{nome\}\}![^']+)'/)?.[1]?.replace(/\\n/g, "\n");
    expect(corpo).toBeTruthy();
    const texto = renderizarTemplate(corpo!, {
      nome: "Connecta",
      email: "d@x.com",
      senha: "ABCD2345",
      link: "https://bexprint.com.br/login?como=parceiro",
    });
    expect(texto).toContain("Olá, Connecta!");
    expect(texto).toContain("Entre em https://bexprint.com.br/login?como=parceiro\nE-mail: d@x.com\nSenha provisória: ABCD2345");
    expect(texto).toContain("No primeiro acesso você cria a sua senha");
  });
});

describe("a migração", () => {
  it("troca o modelo da boas-vindas já enfileirada para o que leva e-mail e senha; se não houver, enfileira", () => {
    expect(SQL).toContain("('parceiro_acesso', 'whatsapp'");
    expect(SQL).toContain("Senha provisória: {{senha}}");
    expect(SQL).toContain("v_chave := 'parceiro:' || v_parceiro_id::text || ':boas_vindas';");
    expect(SQL).toContain("SET template = 'parceiro_acesso', evento = 'parceiro_acesso', variaveis = v_variaveis");
    expect(SQL).toContain("IF v_trocadas = 0 THEN");
    expect(SQL).toContain("PERFORM public.enfileirar_notificacao('whatsapp'");
  });
  it("mesmas travas do cadastro antigo: conta de até 15 min, uma vez só, nasce ativo e com papel", () => {
    expect(SQL).toContain("interval '15 minutes'");
    expect(SQL).toContain("'Esta conta já é de um parceiro'");
    expect(SQL).toContain("VALUES (v_cliente_id, p_usuario_id, 'ativo', v_nome");
    expect(SQL).toContain("INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro')");
  });
  it("o primeiro acesso é só do próprio parceiro logado e apaga a senha provisória da fila", () => {
    expect(SQL).toContain("v_id uuid := public.parceiro_do_usuario();");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.parceiro_completar_cadastro(jsonb) FROM PUBLIC, anon;");
    expect(SQL).toContain("SET variaveis = variaveis - 'senha'");
    // as duas funções chamáveis explicam o porquê (regra de 02/11)
    expect(SQL).toContain("COMMENT ON FUNCTION public.parceiro_cadastrar_rapido(");
    expect(SQL).toContain("COMMENT ON FUNCTION public.parceiro_completar_cadastro(jsonb) IS");
  });
});
