import { describe, expect, it } from "vitest";
import {
  MIGRACAO_B1,
  corpoDaFuncao,
  grants,
  lerMigracao,
  lerTuplas,
  semComentarios,
} from "./triagem/sql-lido-como-texto";
import { PASSOS_SEMENTE } from "../src/domain/whatsapp/triagem/textos-sementes";
import { SEMENTES_DO_QUADRO } from "../src/domain/whatsapp/triagem/quadro-sementes";
import { normalizarTexto, semAcento } from "../src/domain/whatsapp/triagem/normalizar";
import { verificarTexto } from "../src/domain/whatsapp/triagem/verificador";

/**
 * B1 da triagem de boas-vindas (Onda B): a migração de dados editáveis, lida como texto.
 *
 * O que estas travas seguram:
 *  - as sementes do banco são IGUAIS às constantes TypeScript (textos e quadro), linha por linha;
 *  - a lista de termos proibidos do banco dá o mesmo veredito que o verificador do código;
 *  - toda tabela nova tem RLS, anon não tem nada, authenticated só lê, e quem escreve é função service_role;
 *  - nenhuma função nova é executável por anon, authenticated ou PUBLIC, e cada nome tem uma assinatura só;
 *  - a triagem nasce DESLIGADA, e a palavra proibida do dono não aparece em lugar nenhum.
 */
const BRUTO = lerMigracao(MIGRACAO_B1);
const SQL = semComentarios(BRUTO);

const TABELAS = [
  "whatsapp_triagem_config",
  "whatsapp_triagem_passos",
  "whatsapp_triagem_respostas",
  "whatsapp_triagem_termos_proibidos",
];

const FUNCOES = [
  "_triagem_texto_plano",
  "_triagem_normalizar_frase",
  "_triagem_numeros_validos",
  "_triagem_toca_atualizado_em",
  "_triagem_config_antes_gravar",
  "_triagem_problemas_de_texto",
  "_triagem_passo_validar",
  "triagem_config_salvar",
  "triagem_passo_salvar",
  "triagem_resposta_salvar",
];

describe("triagem B1: forma da migração", () => {
  it("é transacional, tem precondições e termina com a conferência", () => {
    expect(SQL).toMatch(/^\s*BEGIN;/m);
    expect(SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(SQL).toContain("DO $pre$");
    expect(SQL).toContain("DO $conferencia$");
    expect(SQL.match(/RAISE EXCEPTION/g)!.length).toBeGreaterThanOrEqual(25);
  });

  it("não aplica nada sozinha e não manda mensagem a ninguém", () => {
    expect(SQL).not.toMatch(/notificacoes_fila|whatsapp_fila_envio|whatsapp_mensagens|net\.http|pg_cron|cron\.schedule/i);
    expect(SQL).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+public\.(clientes|leads|parceiros|orcamentos|whatsapp_conversas|whatsapp_configuracoes)\b/i);
  });

  it("a palavra que o dono não reconhece não aparece, nem em comentário", () => {
    expect(BRUTO).not.toMatch(/revendedor/i);
    // só o radical, como termo proibido do ramo cliente
    expect(SQL).toContain("'revend'");
  });

  it("tudo nasce desligado: estado, percentual, números de teste e data de vale", () => {
    expect(SQL).toContain("estado public.triagem_estado NOT NULL DEFAULT 'desligada'");
    expect(SQL).toContain("percentual integer NOT NULL DEFAULT 0");
    expect(SQL).toContain("numeros_teste text[] NOT NULL DEFAULT '{}'");
    expect(SQL).toMatch(/vale_a_partir_de timestamptz,/);
    expect(SQL).toContain("agente_apos_triagem boolean NOT NULL DEFAULT false");
    expect(SQL).toContain("INSERT INTO public.whatsapp_triagem_config (id) VALUES (true);");
    expect(SQL).toContain("v_c.estado <> 'desligada' OR v_c.percentual <> 0 OR cardinality(v_c.numeros_teste) <> 0");
  });

  it("config é uma linha só e não se apaga", () => {
    expect(SQL).toContain("id boolean PRIMARY KEY DEFAULT true CHECK (id)");
    expect(SQL).toContain("BEFORE UPDATE OR DELETE ON public.whatsapp_triagem_config");
    expect(SQL).toContain("BEFORE TRUNCATE ON public.whatsapp_triagem_config");
    expect(SQL).toContain("atraso_min_s BETWEEN 1 AND 15 AND atraso_max_s BETWEEN atraso_min_s AND 15");
  });

  it("vale_a_partir_de é preenchido na primeira saída de desligada e nunca mais muda", () => {
    const c = corpoDaFuncao(SQL, "_triagem_config_antes_gravar");
    expect(c).toContain("IF OLD.vale_a_partir_de IS NOT NULL THEN\n      NEW.vale_a_partir_de := OLD.vale_a_partir_de;");
    expect(c).toContain("ELSIF OLD.estado = 'desligada' AND NEW.estado <> 'desligada' THEN\n      NEW.vale_a_partir_de := now();");
  });
});

describe("triagem B1: acesso", () => {
  it("toda tabela tem RLS ligada e REVOKE pelo nome de PUBLIC, anon e authenticated", () => {
    for (const t of TABELAS) {
      expect(SQL, t).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(SQL, t).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(SQL, t).toContain(`GRANT SELECT ON public.${t} TO authenticated;`);
      expect(SQL, t).toContain(`GRANT ALL ON public.${t} TO service_role;`);
    }
  });

  it("só existem políticas de leitura, para authenticated, com is_staff e permissão", () => {
    const politicas = [...SQL.matchAll(/CREATE POLICY "([^"]+)" ON public\.(\w+)\s+FOR (\w+) TO (\w+)/g)];
    expect(politicas.length).toBe(TABELAS.length);
    for (const [, , tabela, comando, papel] of politicas) {
      expect(TABELAS).toContain(tabela);
      expect(comando).toBe("SELECT");
      expect(papel).toBe("authenticated");
    }
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*FOR (ALL|INSERT|UPDATE|DELETE)/);
    expect(SQL.match(/public\.is_staff\(\(SELECT auth\.uid\(\)\)\)/g)!.length).toBe(TABELAS.length);
    expect(SQL.match(/'configuracoes\.manage'/g)!.length).toBeGreaterThanOrEqual(TABELAS.length);
  });

  it("nenhum GRANT vai para anon ou PUBLIC; authenticated só recebe SELECT em tabela; função só service_role", () => {
    const todos = grants(SQL);
    expect(todos.length).toBeGreaterThan(10);
    for (const g of todos) {
      expect(g.para, g.alvo).not.toContain("anon");
      expect(g.para, g.alvo).not.toContain("public");
      if (g.para.includes("authenticated")) expect(g.alvo).toMatch(/^SELECT ON public\.whatsapp_triagem_/);
      if (/^EXECUTE ON FUNCTION/.test(g.alvo)) expect(g.para, g.alvo).toEqual(["service_role"]);
    }
  });

  it("cada função: REVOKE de PUBLIC, anon e authenticated e GRANT só ao service_role", () => {
    for (const f of FUNCOES) {
      expect(SQL, f).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(SQL, f).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`));
    }
  });

  it("assinatura única: nenhuma função aparece criada duas vezes", () => {
    for (const f of FUNCOES) {
      const n = SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${f}\\(`, "g"))?.length ?? 0;
      expect(n, f).toBe(1);
    }
    // e todas as criadas estão na lista que o teste conhece
    const criadas = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect(criadas).toEqual([...FUNCOES].sort());
    expect(SQL).toContain("tem % versões (esperado 1): sobrecarga quebra o PostgREST");
  });

  it("as funções de salvar são definer, com search_path, e conferem a permissão de quem pediu", () => {
    for (const f of ["triagem_config_salvar", "triagem_passo_salvar", "triagem_resposta_salvar"]) {
      const c = corpoDaFuncao(SQL, f);
      expect(c, f).toContain("SECURITY DEFINER");
      expect(c, f).toContain("SET search_path TO 'public'");
      expect(c, f).toContain("public.has_permission(p_usuario, 'configuracoes.manage')");
    }
    expect(corpoDaFuncao(SQL, "triagem_config_salvar")).toContain("Para desligar use triagem_desligar");
  });

  it("triagem_config_salvar: estado, percentual e números de teste exigem whatsapp.manage, e o estado sobe um degrau por vez", () => {
    const c = corpoDaFuncao(SQL, "triagem_config_salvar");
    // qualquer campo: configuracoes.manage OU whatsapp.manage; usuário nulo nunca passa
    expect(c).toContain("IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'configuracoes.manage')");
    expect(c).toContain("public.has_permission(p_usuario, 'whatsapp.manage')");
    // ligar, mudar o percentual ou os números de teste: só whatsapp.manage (a mesma exigência da tela antiga)
    const critico = c.slice(c.indexOf("IF (v_estado IS DISTINCT FROM c.estado"));
    expect(critico).toContain("v_percentual IS DISTINCT FROM c.percentual");
    expect(critico).toContain("v_numeros <@ c.numeros_teste AND c.numeros_teste <@ v_numeros");
    expect(critico.slice(0, critico.indexOf("RAISE EXCEPTION"))).toContain("AND NOT public.has_permission(p_usuario, 'whatsapp.manage')");
    // a escada: desligada, ensaio, teste, parcial, ligada; para cima só um degrau, para baixo qualquer um
    expect(c).toContain("ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada']");
    expect(c).toContain("IF v_para > v_de + 1 THEN");
    expect(c).toContain("sobe um degrau por vez");
    // o percentual agora é calculado uma vez e é o que se grava
    expect(c).toContain("percentual = v_percentual,");
  });

  it("os freios (freio_*, max_* e intervalo_minimo_s) também exigem whatsapp.manage, só quando o valor muda de verdade", () => {
    const c = corpoDaFuncao(SQL, "triagem_config_salvar");
    const trecho = c.slice(c.indexOf("v_mexe_em_freio :="), c.indexOf("UPDATE public.whatsapp_triagem_config SET"));
    for (const coluna of [
      "freio_falhas_envio",
      "freio_erros_hora",
      "max_mensagens",
      "max_tentativas_por_passo",
      "max_novas_por_hora",
      "max_novas_por_dia",
      "intervalo_minimo_s",
    ]) {
      expect(trecho, coluna).toContain(`(p_config ? '${coluna}') AND (p_config ->> '${coluna}')::integer IS DISTINCT FROM c.${coluna}`);
    }
    expect(trecho).toContain("IF v_mexe_em_freio AND NOT public.has_permission(p_usuario, 'whatsapp.manage') THEN");
    expect(trecho).toContain("exige a permissão whatsapp.manage");
    // o cabeçalho e o comentário de permissões dizem o mesmo
    expect(BRUTO).toContain("FREIOS (freio_*,");
  });

  it("o gatilho da configuração também recusa pular degrau (defesa em profundidade) e deixa descer", () => {
    const g = corpoDaFuncao(SQL, "_triagem_config_antes_gravar");
    expect(g).toContain("NEW.estado IS DISTINCT FROM OLD.estado");
    expect(g).toContain("array_position(ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'], NEW.estado::text)");
    expect(g).toContain("> array_position(ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'], OLD.estado::text) + 1");
    expect(g).toContain("A triagem sobe um degrau por vez");
    // só a SUBIDA de mais de um degrau é recusada: descer (triagem_desligar, freio automático) passa
    expect(g).not.toMatch(/<\s*array_position/);
    expect(SQL).toContain("o gatilho da configuração deixou pular degrau da escada");
  });

  it("nenhuma função de B1 engole erro", () => {
    expect(SQL).not.toMatch(/EXCEPTION WHEN OTHERS THEN\s+NULL/i);
    for (const f of FUNCOES) expect(corpoDaFuncao(SQL, f), f).not.toMatch(/WHEN OTHERS/);
  });
});

describe("triagem B1: sementes iguais às constantes TypeScript", () => {
  const passos = lerTuplas(SQL, "whatsapp_triagem_passos");
  const respostas = lerTuplas(SQL, "whatsapp_triagem_respostas");
  const termos = lerTuplas(SQL, "whatsapp_triagem_termos_proibidos");

  it("textos das etapas: mesmo código, ramo, texto, variantes, repetição e ativo, na mesma ordem", () => {
    expect(passos.length).toBe(PASSOS_SEMENTE.length);
    const ordem: Record<string, number> = { cliente: 0, parceiro: 0 };
    PASSOS_SEMENTE.forEach((p, i) => {
      ordem[p.ramo] += 1;
      const [codigo, ramo, ord, texto, variantes, repeticao, ajuda, ativo] = passos[i];
      expect(codigo).toBe(p.codigo);
      expect(ramo).toBe(p.ramo);
      expect(ord).toBe(ordem[p.ramo]);
      expect(texto).toBe(p.texto);
      expect(variantes).toEqual([...(p.variantes ?? [])]);
      expect(repeticao).toBe(p.repeticao ?? null);
      expect(typeof ajuda).toBe("string");
      expect((ajuda as string).length).toBeGreaterThan(20);
      expect(ativo).toBe(p.ativo !== false);
    });
    expect(PASSOS_SEMENTE.length).toBe(32);
    expect(PASSOS_SEMENTE.filter((p) => p.ramo === "cliente").length).toBe(22);
  });

  it("não há dois textos com o mesmo código no mesmo ramo", () => {
    const chaves = passos.map((p) => `${p[0]}|${p[1]}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("quadro de respostas: mesma frase, passo, intenção, casamento e ativo, na mesma ordem", () => {
    expect(respostas.length).toBe(SEMENTES_DO_QUADRO.length);
    SEMENTES_DO_QUADRO.forEach((r, i) => {
      const [passo, intencao, frase, casamento, ativo] = respostas[i];
      expect(passo).toBe(r.passo);
      expect(intencao).toBe(r.intencao);
      expect(frase).toBe(r.frase);
      expect(casamento).toBe(r.casamento);
      expect(ativo).toBe(r.ativo !== false);
    });
    expect(SEMENTES_DO_QUADRO.length).toBe(770);
  });

  it("chave única do quadro (passo, frase, casamento) sem repetição", () => {
    const chaves = respostas.map((r) => `${r[0] ?? ""}|${r[2]}|${r[3]}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("toda frase semeada sobrevive à normalização, exceto as marcas de emoji, e cabe no CHECK do banco", () => {
    for (const r of respostas) {
      const frase = r[2] as string;
      expect(frase, frase).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
      expect(normalizarTexto(frase), frase).toBe(frase);
      if (r[3] !== "igual") expect(frase.length, frase).toBeGreaterThanOrEqual(2);
    }
  });

  it("o quadro semeado não tem a palavra proibida nem frase da intenção nao_sei", () => {
    for (const r of respostas) {
      expect(r[2] as string).not.toMatch(/revend/);
      expect(r[1]).not.toBe("nao_sei");
    }
  });

  it("nenhum texto semeado do ramo cliente fala de parceiro, revenda, tabela nem usa link_parceiro", () => {
    for (const [codigo, ramo, , texto, variantes, repeticao] of passos) {
      if (ramo !== "cliente") continue;
      const tudo = [texto, ...(variantes as string[]), repeticao ?? ""].join(" ");
      expect(semAcento(tudo).toLowerCase(), codigo as string).not.toMatch(/parceir|parceri|terceiriz|revend|tabela|diferenciad/);
      expect(tudo, codigo as string).not.toContain("link_parceiro");
    }
  });

  it("nenhum travessão, seta ou parêntese em texto que o cliente lê, e nenhuma palavra proibida do dono", () => {
    for (const [codigo, , , texto, variantes, repeticao] of passos) {
      const tudo = [texto, ...(variantes as string[]), repeticao ?? ""].join(" ");
      expect(tudo, codigo as string).not.toMatch(/[—–]/);
      expect(tudo, codigo as string).not.toMatch(/[←-⇿➔➡]|->|=>|<-/);
      expect(tudo, codigo as string).not.toMatch(/[()]/);
      expect(tudo, codigo as string).not.toMatch(/revendedor/i);
    }
  });

  it("todo texto semeado passa no verificador do código, e o que tem variável usa só as permitidas", () => {
    const permitidas = ["primeiro_nome", "nome_completo", "telefone", "cep", "bairro", "cidade", "abre", "fecha", "dias", "link_parceiro", "ack"];
    for (const [codigo, ramo, , texto, variantes, repeticao] of passos) {
      const todos = [texto, ...(variantes as string[]), ...(repeticao ? [repeticao] : [])] as string[];
      for (const t of todos) {
        const sem = t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, v: string) => {
          expect(permitidas, `${codigo}: ${v}`).toContain(v);
          return "Maria";
        });
        expect(verificarTexto(sem, ramo as "cliente" | "parceiro").problemas, `${codigo}: ${t}`).toEqual([]);
      }
    }
  });

  it("nenhuma semente tem -- dentro do texto (o teste tira comentário por linha)", () => {
    for (const p of passos) expect(JSON.stringify(p)).not.toContain("--");
  });

  it("termos proibidos: banco e verificador dão o mesmo veredito em frases de prova", () => {
    expect(termos.length).toBe(24);
    const regras = termos.map((t) => ({
      regra: t[0] as string,
      termo: t[1] as string,
      tipo: t[2] as string,
      sobre: t[3] as string,
      ramo: t[4] as string,
    }));
    const pgParaJs = (r: string) => new RegExp(r.replace(/\\y/g, "\\b"));
    function bancoReprova(texto: string, ramo: "cliente" | "parceiro"): boolean {
      const plano = semAcento(texto).toLowerCase();
      const norm = normalizarTexto(texto);
      return regras.some((r) => {
        if (r.ramo === "nome") return false;
        if (r.ramo === "cliente" && ramo !== "cliente") return false;
        if (r.tipo === "trecho") return norm.includes(r.termo);
        return pgParaJs(r.termo).test(r.sobre === "bruto" ? texto.toLowerCase() : plano);
      });
    }
    const provas = [
      "Olá, seja bem-vindo à Bex Print!",
      "O valor quem passa é a equipe.",
      "Sai por R$ 50",
      "Custa 50 reais",
      "Fica 10% mais barato",
      "Temos desconto para você",
      "Pode pagar no pix",
      "Mandamos o boleto",
      "Em 3 vezes sem juros",
      "Parcelamos em 12 vezes",
      "Emitimos nota fiscal",
      "Fica pronto em 3 dias",
      "Entrega em 24 horas",
      "Atendemos das 8h às 18h, de segunda a sexta",
      "Nosso CEP é 68900-000",
      "Ligue 96 99999-9999",
      "Seja bem-vindo ao programa de parceiros",
      "Tenho uma parceria com vocês",
      "Sou terceirizado",
      "Quero ser revendedor",
      "Vocês têm tabela de preço?",
      "Preço diferenciado para parceiro",
      "Condições especiais para atacado",
      "Valor especial hoje",
      "Isso — aquilo",
      "Veja a seta → aqui",
      "Fale com a equipe (sem custo)",
      "Maria, anotei o seu endereço.",
      "Total de 1.500,00",
      "Pagamento de 49,90",
      "Prazo de 5 dias úteis",
      "Meu parceiro indicou vocês",
    ];
    // travessões e setas de Unicode além do em dash e da seta comum: banco e código reprovam os mesmos, e aprovam o hífen comum
    const unicode = [
      "Oi ― tudo bem?", // U+2015 barra horizontal
      "Oi ‒ tudo bem?", // U+2012 traço de figura
      "Oi − tudo bem?", // U+2212 sinal de menos
      "Oi ⸺ tudo bem?", // U+2E3A
      "Oi ⸻ tudo bem?", // U+2E3B
      "Oi ﹘ tudo bem?", // U+FE58
      "Oi ﹣ tudo bem?", // U+FE63
      "Oi － tudo bem?", // U+FF0D
      "Vá ➜ aqui", // U+279C
      "Vá ➡ aqui", // U+27A1
      "Vá ➔ aqui", // U+2794
      "Vá ⟶ aqui", // U+27F6
      "Vá ⤴ aqui", // U+2934
      "Vá ⬅ aqui", // U+2B05
      "Vá ↩ aqui", // U+21A9
      "Vá ⇒ aqui", // U+21D2
      "Ana-Clara, tudo bem?",
      "Atendemos de segunda a sexta, com alegria.",
      "Tudo certo ✅ e ✓",
    ];
    for (const ramo of ["cliente", "parceiro"] as const) {
      for (const p of [...provas, ...unicode]) {
        const codigoOk = verificarTexto(p, ramo).ok;
        expect(!bancoReprova(p, ramo), `${ramo}: ${p}`).toBe(codigoOk);
      }
    }
  });

  it("travessao e seta: o mesmo desenho de caracteres no banco e no código, cobrindo U+2015, U+2012, U+2212 e U+279C", () => {
    const sql = (regra: string) => termos.find((t) => t[0] === regra)![1] as string;
    expect(sql("travessao")).toBe(/[—–―‒−⸺⸻﹘﹣－]/.source);
    expect(sql("seta")).toBe(/[←-⇿➔➘-➯➱-➾⟰-⟿⤀-⥿⬅-⬇]|->|=>|<-/.source);
    for (const ch of ["\u2015", "\u2012", "\u2212"]) expect(new RegExp(sql("travessao")).test(ch), ch).toBe(true);
    expect(new RegExp(sql("seta")).test("\u279c")).toBe(true);
    // o hífen comum nunca é travessão
    expect(new RegExp(sql("travessao")).test("Ana-Clara")).toBe(false);
    // a conferência da própria migração também prova
    expect(SQL).toContain("travessão ou seta de Unicode passou no verificador");
    expect(SQL).toContain("o hífen comum foi barrado como travessão");
  });

  it("termos: cada regra com tipo, sobre e ramo válidos, e as de cliente cobrem o que o dono proibiu", () => {
    for (const t of termos) {
      expect(["trecho", "padrao"]).toContain(t[2]);
      expect(["plano", "bruto"]).toContain(t[3]);
      expect(["todos", "cliente", "nome"]).toContain(t[4]);
      expect(typeof t[5]).toBe("string");
    }
    const cliente = termos.filter((t) => t[4] === "cliente").map((t) => t[1]);
    for (const radical of ["parceir", "parceri", "terceiriz", "revend", "tabela", "diferenciad"]) expect(cliente).toContain(radical);
    const todos = termos.filter((t) => t[4] === "todos").map((t) => t[0]);
    for (const regra of ["moeda", "valor_em_reais", "porcentagem", "desconto", "pix", "boleto", "parcelamento", "juros", "nota_fiscal", "prazo_em_numero", "travessao", "seta", "parenteses"]) {
      expect(todos).toContain(regra);
    }
  });
});

describe("triagem B1: validação do texto no banco", () => {
  const c = corpoDaFuncao(SQL, "_triagem_problemas_de_texto");

  it("recusa texto vazio, longo, variável fora da lista e link_parceiro no ramo cliente", () => {
    expect(c).toContain("RETURN ARRAY['vazio']");
    expect(c).toContain("> 600");
    expect(c).toContain("variavel_fora_da_lista:");
    expect(c).toContain("p_ramo = 'cliente'");
    expect(c).toContain("link_parceiro_no_ramo_cliente");
    expect(c).toContain("variavel_sem_preencher");
    expect(c).toContain("chaves_soltas");
  });

  it("só devolve o código da regra, nunca o trecho do texto", () => {
    expect(c).not.toMatch(/substring\(|regexp_match\(.*v_texto.*\)\s*\[/);
    expect(c).toContain("array_append(v_problemas, t.regra)");
  });

  it("o gatilho dos passos valida texto, repetição e variantes, e sobe a versão ao editar", () => {
    const g = corpoDaFuncao(SQL, "_triagem_passo_validar");
    expect(g).toContain("_triagem_problemas_de_texto(NEW.texto, NEW.ramo, true)");
    expect(g).toContain("_triagem_problemas_de_texto(NEW.repeticao, NEW.ramo, true)");
    expect(g).toContain("_triagem_problemas_de_texto(v_v, NEW.ramo, true)");
    expect(g).toContain("NEW.versao := OLD.versao + 1");
    expect(SQL).toContain("BEFORE INSERT OR UPDATE ON public.whatsapp_triagem_passos");
    expect(SQL).toContain("CHECK (NOT (ramo = 'cliente' AND codigo LIKE 'parceiro%'))");
  });

  it("o quadro só aceita intenção da lista, frase normalizada e chave única com passo nulo", () => {
    expect(SQL).toContain("CHECK (intencao <> 'nao_sei')");
    expect(SQL).toContain("CHECK (frase ~ '^[a-z0-9]+( [a-z0-9]+)*$')");
    expect(SQL).toContain("CREATE UNIQUE INDEX whatsapp_triagem_respostas_chave ON public.whatsapp_triagem_respostas (coalesce(passo, ''), frase, casamento);");
    const f = corpoDaFuncao(SQL, "triagem_resposta_salvar");
    expect(f).toContain("public._triagem_normalizar_frase(p_frase)");
    expect(f).toContain("p_intencao = 'nao_sei'");
  });

  it("os tipos têm os valores do projeto, e os passos do CHECK são os da máquina de etapas", () => {
    const lista = (nome: string) =>
      [...(new RegExp(`CREATE TYPE public\\.${nome} AS ENUM \\(([^)]*)\\)`).exec(SQL)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(lista("triagem_estado")).toEqual(["desligada", "ensaio", "teste", "parcial", "ligada"]);
    expect(lista("triagem_ramo")).toEqual(["cliente", "parceiro"]);
    expect(lista("triagem_casamento")).toEqual(["igual", "comeca", "contem"]);
    expect(lista("triagem_status")).toEqual([
      "ativa", "concluida", "expirada", "pausada_humano", "pausada_desligada", "parada_pelo_contato", "entregue_equipe", "pulada", "ensaio",
    ]);
    const intencoes = lista("triagem_intencao");
    expect(intencoes).toHaveLength(16);
    for (const r of SEMENTES_DO_QUADRO) expect(intencoes).toContain(r.intencao);
    expect(lista("triagem_evento_tipo")).toEqual([
      "entrada", "interpretada", "envio_enfileirado", "envio_ensaio", "pulou", "pausa", "texto_barrado", "erro", "gate", "aviso_grupo", "nome_nao_gravado", "expirou", "freio",
    ]);
    const passosDaMaquina = ["nome", "sobrenome", "primeira_vez", "cep", "telefone", "telefone_novo", "fechamento", "parceiro_nome", "parceiro_link"];
    const check = /passo IS NULL OR passo IN \(([^)]*)\)/.exec(SQL)![1];
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(passosDaMaquina);
    for (const r of SEMENTES_DO_QUADRO) if (r.passo) expect(passosDaMaquina).toContain(r.passo);
  });
});
