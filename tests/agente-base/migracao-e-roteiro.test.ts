import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizarPerguntaDaBase } from "../../src/domain/agente-base/casar";
import { explicarAviso } from "../../src/domain/agente-base/fila";

/**
 * C2, a base de respostas aprovadas do agente: o contrato da migração e do
 * roteiro de ensaio, lidos como TEXTO (nada aqui fala com banco). O que o SQL
 * faz de verdade foi provado no Postgres 17 local e está no roteiro.
 */

const PASTA = join(__dirname, "..", "..", "supabase", "migrations");
const NOME = "20261114120000_agente_base_de_respostas.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(__dirname, "..", "..", "docs", "ensaio-agente-base.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

function comandosSemWhere(s: string): string[] {
  const achados: string[] = [];
  const re = /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of s.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

const blocosSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => semComentarios(m[1]));
const ensaio = (() => {
  const ini = doc.indexOf("DO $ensaio$");
  return doc.slice(ini, doc.indexOf("$ensaio$;", ini) + "$ensaio$;".length);
})();

type Semente = { tema: string; pergunta: string; frases: string[]; contagem: number; texto: string };

/** As 15 tuplas do INSERT de sementes: tema, pergunta, frases, texto (literal ou variável) e contagem. */
function lerSementes(): Semente[] {
  const ini = sql.indexOf("INSERT INTO public.agente_base_respostas (tema, pergunta");
  const fim = sql.indexOf("END $sementes$;", ini);
  const corpo = sql.slice(ini, fim);
  const re =
    /\('([a-z_]+)',\s*'([^']*)',\s*ARRAY\[([^\]]*)\]::text\[\],\s*ARRAY\['cliente'\]::public\.triagem_ramo\[\],\s*(NULL|'[^']*'),\s*([\s\S]*?),\s*'semente',\s*(\d+)\)/g;
  return [...corpo.matchAll(re)].map((m) => ({
    tema: m[1],
    pergunta: m[2],
    frases: [...m[3].matchAll(/'([^']*)'/g)].map((x) => x[1]),
    texto: m[5].trim(),
    contagem: Number(m[6]),
  }));
}
const sementes = lerSementes();

describe("C2: arquivo e escopo", () => {
  it("vem depois da última migração da triagem e o prefixo de data é único", () => {
    expect(NOME > "20261114110000_triagem_metricas.sql").toBe(true);
    const iguais = readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)));
    expect(iguais).toEqual([NOME]);
  });

  it("só cria: nenhuma tabela, função ou gatilho vivo é alterado", () => {
    expect(codigo).not.toMatch(/\bALTER\s+TABLE\s+(?!public\.agente_base_respostas(_historico)?\s+ENABLE ROW LEVEL SECURITY)/i);
    expect(codigo).not.toMatch(/\bDROP\b/i);
    expect(codigo).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(?!_?agente_)/);
    expect(codigo).not.toMatch(/CREATE TRIGGER[^;]*\bON public\.(?!agente_base_respostas)/);
    expect(codigo).not.toMatch(/\bINSERT INTO public\.(?!agente_base_respostas(?:_historico)?\b)/);
    // as únicas tabelas vivas citadas: leitura de produtos (família), empresa_config (endereço), usuários (chave) e termos
    const citadas = new Set(
      [...codigo.matchAll(/\b(?:FROM|JOIN|REFERENCES)\s+public\.(\w+)/gi)].map((m) => m[1].toLowerCase()),
    );
    for (const t of citadas) {
      expect(
        [
          "produtos",
          "empresa_config",
          "usuarios",
          "agente_base_respostas",
          "agente_base_respostas_historico",
          "whatsapp_triagem_termos_proibidos",
        ],
        t,
      ).toContain(t);
    }
  });

  it("abre com lock_timeout e fecha com conferência que desfaz tudo", () => {
    expect(codigo).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';/);
    expect(codigo.trim().endsWith("COMMIT;")).toBe(true);
    expect(codigo).toMatch(/DO \$confere\$/);
  });

  it("nenhum UPDATE nem DELETE sem WHERE, na migração e em todo bloco SQL do roteiro (safeupdate)", () => {
    expect(comandosSemWhere(codigo)).toEqual([]);
    expect(blocosSql.length).toBeGreaterThan(12);
    for (const b of blocosSql) expect(comandosSemWhere(b)).toEqual([]);
  });

  it("o varredor enxerga o que deve", () => {
    expect(comandosSemWhere("UPDATE public.t SET a = 1;")).toHaveLength(1);
    expect(comandosSemWhere("DELETE FROM public.t;")).toHaveLength(1);
    expect(comandosSemWhere("UPDATE public.t SET a = 1 WHERE id = x;")).toEqual([]);
  });
});

describe("C2: a tabela não guarda preço nem a palavra que a casa não usa", () => {
  const tabela = codigo.slice(
    codigo.indexOf("CREATE TABLE public.agente_base_respostas ("),
    codigo.indexOf("CREATE UNIQUE INDEX agente_base_respostas_tema_unico"),
  );
  const historico = codigo.slice(
    codigo.indexOf("CREATE TABLE public.agente_base_respostas_historico ("),
    codigo.indexOf("CREATE INDEX agente_base_historico_resposta_idx"),
  );

  it("nenhuma coluna de preço, valor, custo, desconto ou orçamento", () => {
    for (const t of [tabela, historico]) {
      expect(t.length).toBeGreaterThan(200);
      const colunas = [...t.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|integer|timestamptz|boolean|public\.)/gm)].map((m) => m[1]);
      expect(colunas.length).toBeGreaterThan(6);
      for (const c of colunas) expect(c).not.toMatch(/preco|valor|custo|desconto|orcamento|revend/);
    }
  });

  it("os ramos são o tipo da triagem (só cliente e parceiro) e o status nasce rascunho", () => {
    expect(tabela).toMatch(/ramos public\.triagem_ramo\[\] NOT NULL/);
    expect(tabela).toMatch(/status public\.agente_resposta_status NOT NULL DEFAULT 'rascunho'/);
    expect(codigo).toMatch(/CREATE TYPE public\.agente_resposta_status AS ENUM \('rascunho', 'aprovada', 'arquivada'\)/);
  });

  it("aprovada exige quem, quando, texto igual à resposta e uma frase gatilho", () => {
    expect(tabela).toMatch(/aprovada_por IS NOT NULL AND aprovada_em IS NOT NULL AND texto_aprovado IS NOT NULL/);
    expect(tabela).toMatch(/texto_aprovado = resposta AND cardinality\(frases_gatilho\) >= 1/);
    expect(tabela).toMatch(/status = 'aprovada' OR \(texto_aprovado IS NULL AND aprovada_por IS NULL AND aprovada_em IS NULL\)/);
  });

  it("a chave de produto é ON DELETE SET NULL e o que se lê de produtos é só id e família", () => {
    expect(tabela).toMatch(/produto_id uuid REFERENCES public\.produtos\(id\) ON DELETE SET NULL/);
    const lidas = [...codigo.matchAll(/SELECT\s+p\.(\w+)\s+INTO\s+v_familia\s+FROM\s+public\.produtos/g)].map((m) => m[1]);
    expect(lidas).toEqual(["familia"]);
    expect(codigo).not.toMatch(/\bp\.preco|produtos\.preco|\bpreco_(base|parceiro|minimo|sugerido|publico)\b|custo_medio|margem_/);
  });

  it("a palavra proibida só aparece onde barra: no validador, na frase gatilho e na conferência", () => {
    const linhas = codigo.split("\n").filter((l) => /revend/i.test(l));
    expect(linhas.length).toBeGreaterThan(0);
    for (const l of linhas) {
      expect(l, l).toMatch(/_agente_frases_ok|LIKE '%revend%'|v_plano ~ 'revend'|'reven%'|revenda de brindes|reven%/);
    }
    // nenhuma semente a guarda
    for (const s of sementes) {
      expect(`${s.pergunta} ${s.frases.join(" ")} ${s.texto}`).not.toMatch(/revend/i);
    }
  });
});

describe("C2: gatilhos, funções e permissões", () => {
  it("aprovar só pela função: o gatilho exige a marca da transação e roda o validador", () => {
    expect(codigo).toMatch(/current_setting\('agente_base\.aprovando', true\)/);
    expect(codigo).toMatch(/Aprovar só pela função agente_resposta_aprovar/);
    expect(codigo).toMatch(/v_p := public\._agente_problemas_de_texto\(NEW\.resposta, NEW\.ramos\)/);
  });

  it("mudar o conteúdo de uma aprovada a devolve a rascunho e sobe a versão", () => {
    expect(codigo).toMatch(/NEW\.versao := CASE WHEN v_mudou THEN OLD\.versao \+ 1 ELSE OLD\.versao END/);
    expect(codigo).toMatch(/NEW\.status := 'rascunho';\s*NEW\.texto_aprovado := NULL;/);
  });

  it("DELETE e TRUNCATE são recusados nas duas tabelas, e o histórico também recusa UPDATE", () => {
    expect(codigo).toMatch(/tg_agente_base_sem_apagar BEFORE DELETE ON public\.agente_base_respostas/);
    expect(codigo).toMatch(/tg_agente_base_sem_truncate BEFORE TRUNCATE ON public\.agente_base_respostas/);
    expect(codigo).toMatch(/tg_agente_historico_so_cresce BEFORE UPDATE OR DELETE ON public\.agente_base_respostas_historico/);
    expect(codigo).toMatch(/tg_agente_historico_sem_truncate BEFORE TRUNCATE ON public\.agente_base_respostas_historico/);
  });

  it("não há aprovar em lote: duas aprovações na mesma instrução são recusadas", () => {
    expect(codigo).toMatch(/REFERENCING OLD TABLE AS antigas NEW TABLE AS novas/);
    expect(codigo).toMatch(/IF v_n > 1 THEN/);
    expect(codigo).toMatch(/Aprovação em lote não existe/);
  });

  it("toda função de escrita é SECURITY DEFINER com search_path e só o service_role executa", () => {
    for (const f of ["agente_resposta_salvar", "agente_resposta_aprovar", "agente_resposta_rascunho", "agente_resposta_arquivar"]) {
      const ini = codigo.indexOf(`CREATE OR REPLACE FUNCTION public.${f}(`);
      expect(ini, f).toBeGreaterThan(0);
      const cab = codigo.slice(ini, codigo.indexOf("AS $function$", ini));
      expect(cab, f).toMatch(/SECURITY DEFINER/);
      expect(cab, f).toMatch(/SET search_path TO 'public'/);
      expect(codigo, f).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(codigo, f).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`));
    }
    expect(codigo).not.toMatch(/GRANT EXECUTE[^;]*TO (anon|authenticated|PUBLIC)/i);
  });

  it("aprovar exige whatsapp.manage e as outras escritas aceitam as duas permissões", () => {
    const aprovar = codigo.slice(
      codigo.indexOf("CREATE OR REPLACE FUNCTION public.agente_resposta_aprovar("),
      codigo.indexOf("CREATE OR REPLACE FUNCTION public.agente_resposta_rascunho("),
    );
    expect(aprovar).toMatch(/NOT public\.has_permission\(p_usuario, 'whatsapp\.manage'\)/);
    expect(aprovar).not.toMatch(/configuracoes\.manage/);
    expect(aprovar).toMatch(/r\.versao <> p_versao_vista/);
    expect(aprovar).toMatch(/FOR UPDATE/);
    for (const f of ["agente_resposta_salvar", "agente_resposta_rascunho", "agente_resposta_arquivar"]) {
      const ini = codigo.indexOf(`CREATE OR REPLACE FUNCTION public.${f}(`);
      const corpo = codigo.slice(ini, codigo.indexOf("END $function$;", ini));
      expect(corpo, f).toMatch(/has_permission\(p_usuario, 'configuracoes\.manage'\) OR public\.has_permission\(p_usuario, 'whatsapp\.manage'\)/);
    }
  });

  it("RLS ligada, leitura só da equipe e nenhuma escrita direta para ninguém, nem service_role", () => {
    expect(codigo).toMatch(/ALTER TABLE public\.agente_base_respostas ENABLE ROW LEVEL SECURITY/);
    expect(codigo).toMatch(/ALTER TABLE public\.agente_base_respostas_historico ENABLE ROW LEVEL SECURITY/);
    expect(codigo).toMatch(/REVOKE ALL ON public\.agente_base_respostas FROM PUBLIC, anon, authenticated, service_role;/);
    expect(codigo).toMatch(/GRANT SELECT ON public\.agente_base_respostas TO authenticated, service_role;/);
    expect(codigo).not.toMatch(/GRANT (ALL|INSERT|UPDATE|DELETE|TRUNCATE)[^;]*ON public\.agente_/i);
    const politicas = [...codigo.matchAll(/CREATE POLICY[^;]*;/g)].map((m) => m[0]);
    expect(politicas).toHaveLength(2);
    for (const p of politicas) {
      expect(p).toMatch(/FOR SELECT TO authenticated/);
      expect(p).toMatch(/configuracoes\.manage/);
      expect(p).toMatch(/whatsapp\.manage/);
    }
  });

  it("o validador reaproveita o da triagem e acrescenta as regras do agente", () => {
    const v = codigo.slice(
      codigo.indexOf("CREATE OR REPLACE FUNCTION public._agente_problemas_de_texto("),
      codigo.indexOf("-- 5. Gatilhos"),
    );
    expect(v).toMatch(/public\._triagem_problemas_de_texto\(p_texto, v_ramo, false\)/);
    for (const c of [
      "preco_com_numero",
      "valor_em_reais",
      "condicao_de_preco",
      "desconto_disfarcado",
      "preco_especial",
      "preco_diferenciado",
      "tabela",
      "prazo_prometido",
      "pagamento_com_numero",
      "forma_de_pagamento",
      "orcamento_feito_pelo_agente",
      "palavra_que_a_casa_nao_usa",
    ]) {
      expect(v, c).toContain(`'${c}'`);
    }
    // o código que traz a palavra proibida nunca sai
    expect(v).toMatch(/c LIKE 'reven%' THEN 'palavra_que_a_casa_nao_usa'/);
  });

  it("todo código que o validador pode devolver tem explicação em português para o dono", () => {
    const v = codigo.slice(
      codigo.indexOf("CREATE OR REPLACE FUNCTION public._agente_problemas_de_texto("),
      codigo.indexOf("-- 5. Gatilhos"),
    );
    const proprios = [...v.matchAll(/array_append\(v_(?:out|novos), '([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(new Set(proprios).size).toBeGreaterThanOrEqual(12);
    // os da triagem, lidos das sementes da B1 (menos os do ramo "nome", que a base nunca usa)
    const b1 = readFileSync(join(PASTA, "20261113130000_triagem_dados.sql"), "utf8");
    const termos = [...b1.matchAll(/\('([a-z_]+)', '[^\n]*?', '(?:trecho|padrao)', '(?:plano|bruto)', '(todos|cliente|nome)'/g)]
      .filter((m) => m[2] !== "nome")
      .map((m) => m[1])
      .filter((c) => c !== "revenda");
    expect(termos.length).toBeGreaterThanOrEqual(20);
    const padrao = explicarAviso("codigo_que_nao_existe");
    for (const c of [...proprios, ...termos, "vazio", "acima_de_600_caracteres", "variavel_sem_preencher"]) {
      expect(explicarAviso(c), c).not.toBe(padrao);
    }
  });
});

describe("C2: as 15 sementes", () => {
  it("são 15, todas rascunho de cliente final sem produto, e nenhuma nasce aprovada", () => {
    expect(sementes).toHaveLength(15);
    const bloco = codigo.slice(codigo.indexOf("DO $sementes$"), codigo.indexOf("END $sementes$;"));
    expect(bloco).not.toMatch(/'aprovada'/);
    expect(bloco).not.toMatch(/texto_aprovado|aprovada_por/);
    expect(new Set(sementes.map((s) => s.tema)).size).toBe(15);
  });

  it("vêm em ordem de frequência, com contagens de conversas de entrada", () => {
    const c = sementes.map((s) => s.contagem);
    expect(c).toEqual([...c].sort((a, b) => b - a));
    expect(c[0]).toBe(49);
    expect(Math.max(...c)).toBeLessThanOrEqual(148);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(1);
  });

  it("cada frase gatilho já está normalizada, é única na semente e há ao menos três", () => {
    for (const s of sementes) {
      expect(s.frases.length, s.tema).toBeGreaterThanOrEqual(3);
      expect(new Set(s.frases).size, s.tema).toBe(s.frases.length);
      for (const f of s.frases) {
        expect(normalizarPerguntaDaBase(f), `${s.tema}: ${f}`).toBe(f);
        expect(f.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it("os textos escritos não têm preço, prazo em número, desconto, forma de pagamento nem símbolo proibido", () => {
    const literais = sementes.filter((s) => s.texto.startsWith("'"));
    expect(literais.length).toBeGreaterThanOrEqual(13);
    for (const s of literais) {
      const t = s.texto.slice(1, -1);
      expect(t.length, s.tema).toBeLessThanOrEqual(600);
      expect(t, s.tema).not.toMatch(/\d/);
      expect(t, s.tema).not.toMatch(/R\$|reais|%|desconto|promo|gr[aá]tis|barato|pix|boleto|parcel|juros|nota fiscal|tabela|parceir|revend|terceiriz/i);
      expect(t, s.tema).not.toMatch(/[—–―→←⇒()]/);
      expect(t, s.tema).not.toMatch(/\b(amanhã|hoje mesmo|em até|no mesmo dia)\b/i);
    }
  });

  it("o horário e o endereço vêm do cadastro vivo, nunca escritos na migração", () => {
    const horario = sementes.find((s) => s.tema === "horario_de_atendimento");
    const endereco = sementes.find((s) => s.tema === "endereco_da_loja");
    expect(horario?.texto).toBe("v_atende");
    expect(endereco?.texto).toBe("v_endereco");
    expect(codigo).toMatch(/public\.whatsapp_horario_em_texto\(\)/);
    expect(codigo).toMatch(/FROM public\.empresa_config e/);
    expect(codigo).not.toMatch(/Cândido Mendes|Perpétuo Socorro|Macapá/);
  });

  it("cobrem os assuntos do pedido: horário, endereço, arquivo, arte, medida, quantidade, orçamento, prazo, valor e item fora do catálogo", () => {
    const temas = sementes.map((s) => s.tema);
    for (const t of [
      "horario_de_atendimento",
      "endereco_da_loja",
      "formato_do_arquivo",
      "enviar_a_arte",
      "medida_do_produto",
      "quantidade_minima",
      "como_pedir_orcamento",
      "prazo_do_pedido",
      "valor_do_produto",
      "item_fora_do_catalogo",
    ]) {
      expect(temas).toContain(t);
    }
  });

  it("valor e prazo respondem que a equipe confirma, sem número", () => {
    for (const t of ["valor_do_produto", "prazo_do_pedido", "quantidade_minima"]) {
      const s = sementes.find((x) => x.tema === t)!;
      expect(s.texto, t).toMatch(/equipe/);
      expect(s.texto, t).toMatch(/confirma/);
    }
  });

  it("a conferência da migração barra semente aprovada, reprovada pelo validador ou fora do ramo cliente", () => {
    expect(codigo).toMatch(/esperava 15 sementes/);
    expect(codigo).toMatch(/status <> 'rascunho' OR origem <> 'semente' OR produto_id IS NOT NULL/);
    expect(codigo).toMatch(/semente reprovada pelo validador/);
  });
});

describe("C2: o roteiro de ensaio", () => {
  it("tem as seções ANTES, aplicar, DEPOIS, ENSAIO, depois do ensaio, voltar atrás e o que não resolve", () => {
    for (const t of [
      "## 0. ANTES de aplicar",
      "## 1. Aplicar",
      "## 2. DEPOIS: estrutura",
      "## 3. ENSAIO",
      "## 4. DEPOIS do ensaio: nada ficou",
      "## 5. Voltar atrás, se for preciso",
      "## 6. O que este diff NÃO resolve",
    ]) {
      expect(doc, t).toContain(t);
    }
    expect(doc).toContain(NOME);
  });

  it("o ensaio trava em 2 s, não faz DDL, termina em RAISE EXCEPTION e só escreve com WHERE", () => {
    expect(ensaio).toMatch(/BEGIN\s+(--[^\n]*\n\s*)?SET LOCAL lock_timeout = '2s';/);
    expect(ensaio).not.toMatch(/\b(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?(TRIGGER|FUNCTION|TABLE|INDEX|TYPE)\b/i);
    expect(ensaio).toMatch(/RAISE EXCEPTION E'ENSAIO OK \(tudo desfeito de propósito\):\\n%'/);
    expect(comandosSemWhere(semComentarios(ensaio))).toEqual([]);
    expect(ensaio).not.toMatch(/\bCOMMIT\b/);
  });

  it("o ensaio prova as regras principais", () => {
    for (const trecho of [
      "FALHOU 4", // o gestor não aprova
      "FALHOU 5b", // texto com preço recusado
      "FALHOU 6b", // versão velha recusada
      "FALHOU 7", // UPDATE direto recusado
      "FALHOU 8a", // editar aprovada volta a rascunho
      "FALHOU 10a", // lote recusado
      "FALHOU 12a", // DELETE recusado
      "FALHOU 12b", // TRUNCATE recusado
      "FALHOU 15c", // arquivada não vai direto a aprovada
      "FALHOU 16b", // palavra proibida não chega ao código
      "FALHOU 16e", // ramo parceiro: preço especial, diferenciado e tabela
      "FALHOU 16f", // ramo parceiro: texto limpo e as palavras parceiro e parceria
      "FALHOU 17", // anon e authenticated não executam
    ]) {
      expect(ensaio, trecho).toContain(trecho);
    }
  });

  it("o ensaio prova cada frase nova: o que barra (preço, prazo, pagamento, parceiro) e o que passa (horário da casa, medidas)", () => {
    const bloco = ensaio.slice(ensaio.indexOf("v_casos text[][]"), ensaio.indexOf("BEGIN\n  -- se alguma linha"));
    for (const frase of [
      "O preço é cem",
      "Sai por duzentos cada",
      "Cobramos mil e quinhentos",
      "Sai por dois contos",
      "Fica pronto em 48h",
      "Pronto em 3d",
      "Fica pronto em dois dias",
      "Leva uma semana",
      "Entrego dia 15",
      "Fica pronto no mesmo dia",
      "Entregamos esta semana",
      "Fica pronto em 30 minutos",
      "Pagamento à vista",
      "Aceitamos cartão de crédito",
      "Dividimos em três vezes",
      "Dividimos em 3x",
      "Metade na entrada e metade na retirada",
      "Pedimos um sinal",
      // ramo parceiro
      "Temos preço especial para parceiros",
      "Parceiro tem preço diferenciado",
      "O valor de atacado é combinado depois",
      "Vou mandar a tabela de preços",
      "Temos condições especiais",
      "Aqui é preço de custo",
      // o que passa
      "Abrimos às 8h e fechamos às 18h, de segunda a sexta.",
      "A equipe atende de segunda a sexta, das 8h às 17h.",
      "Atendemos até 17h.",
      "A medida é 90 x 60 cm e o arquivo precisa ter 300 dpi.",
      "O pedido mínimo é de cem unidades.",
      "A partir de 100 unidades a equipe confirma o mínimo.",
      "Fazemos cartão de visita, panfleto e banner.",
      "Fazemos impressão 3D e impressão em 3D.",
      "A parceria começa pelo cadastro.",
    ]) {
      expect(bloco, frase).toContain(frase);
    }
    expect(bloco).toMatch(/v_casos_parceiro text\[\]\[\]/);
    expect(bloco).toMatch(/v_limpos_parceiro text\[\]/);
  });

  it("o voltar atrás avisa das travas do DROP TABLE e usa lock_timeout de 2 s", () => {
    const ini = doc.indexOf("### 5.2 Derrubar");
    const bloco = doc.slice(ini, doc.indexOf("### 5.3"));
    expect(bloco).toMatch(/BEGIN;\s*(--[^\n]*\n\s*)*SET LOCAL lock_timeout = '2s';/);
    expect(bloco).not.toMatch(/lock_timeout = '5s'/);
    expect(bloco).toMatch(/ACCESS EXCLUSIVE em produtos e em usuarios/);
    const intro = doc.slice(doc.indexOf("## 5. Voltar atrás"), ini);
    expect(intro).toMatch(/ACCESS EXCLUSIVE/);
    expect(intro).toMatch(/`produtos`/);
    expect(intro).toMatch(/`usuarios`/);
    expect(intro).toMatch(/pouco movimento/);
    expect(intro).toMatch(/lock_timeout. de 2 s/);
  });

  it("o resumo do roteiro descreve as duas camadas do validador e o que ele não barra", () => {
    expect(doc).toMatch(/duas camadas/);
    expect(doc).toMatch(/SÓ para o ramo cliente/);
    expect(doc).toMatch(/Não barram:/);
    expect(doc).toMatch(/forma_de_pagamento/);
  });

  it("o voltar atrás derruba tudo, mas se recusa a descartar aprovação sem aviso", () => {
    expect(doc).toMatch(/Há % respostas aprovadas pelo dono/);
    expect(doc).toMatch(/DROP TABLE public\.agente_base_respostas_historico;/);
    expect(doc).toMatch(/DROP TYPE public\.agente_resposta_status;/);
  });

  it("diz a verdade sobre onde rodou e o que não rodou", () => {
    expect(doc).toMatch(/Rodado em 14\/11\/2026 num Postgres 17 local/);
    expect(doc).toMatch(/NÃO foi rodado no banco vivo/);
    expect(doc).toMatch(/whatsapp_configuracoes.*VAZIAS/s);
    expect(doc).toMatch(/NÃO consta no cadastro de produto/);
  });
});
