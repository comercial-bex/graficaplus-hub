import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Correções de preço no banco (15/11/2026): o contrato da migração e do roteiro de ensaio, lidos como TEXTO
 * (nada aqui fala com banco). O que o SQL faz de verdade foi provado no banco vivo, dentro de uma transação
 * desfeita, e está em docs/ensaio-precos-correcoes-15-11.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261115190000_precos_correcoes_de_banco.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-precos-correcoes-15-11.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

function comandosSemWhere(s: string): string[] {
  const achados: string[] = [];
  const re =
    /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+(?:\w+\s+)?SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of s.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

/** O corpo de uma função: entre o primeiro delimitador depois do nome e o que fecha. */
function corpoDe(nome: string): string {
  const i = codigo.indexOf(`FUNCTION public.${nome}(`);
  if (i < 0) throw new Error(`sem ${nome}`);
  const m = /\$(\w*)\$/.exec(codigo.slice(codigo.indexOf("AS $", i)));
  const delim = `$${m![1]}$`;
  const ini = codigo.indexOf(delim, i) + delim.length;
  return codigo.slice(ini, codigo.indexOf(delim, ini));
}

const blocosSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const ensaio = blocosSql.find((b) => b.includes("ENSAIO OK"))!;
const volta = blocosSql.find((b) => b.includes("DO $volta$"))!;

describe("migração: arquivo e escopo", () => {
  it("vem depois da última migração e o prefixo de data é único", () => {
    expect(NOME > "20261115180000_precos_pendentes_e_alertas_de_integridade.sql").toBe(true);
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
  });

  it("abre com BEGIN e lock_timeout curto e fecha com COMMIT", () => {
    const i = sql.indexOf("BEGIN;");
    expect(i).toBeGreaterThan(-1);
    expect(sql.indexOf("SET LOCAL lock_timeout = '5s';")).toBeGreaterThan(i);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("nenhum UPDATE nem DELETE sem WHERE (safeupdate) e nada destrutivo", () => {
    expect(comandosSemWhere(codigo)).toEqual([]);
    expect(codigo).not.toMatch(/\bTRUNCATE\b|\bDROP\s+(TABLE|FUNCTION|VIEW)\b/i);
  });

  it("confere o corpo vivo antes de trocar (md5 do histórico e colunas da view)", () => {
    expect(codigo).toContain("'da8e14c4208ca0a42d2230a448537e3c'");
    expect(codigo).toContain("md5(prosrc)");
    expect(codigo).toContain("produto_id:uuid,nome:text,tempo_producao_min:integer");
    expect(codigo.indexOf("DO $guarda$")).toBeLessThan(
      codigo.indexOf("CREATE OR REPLACE VIEW public.produto_custo_cheio"),
    );
  });

  it("nenhum preço de produto muda: não existe escrita em produtos nem em produto_precos", () => {
    expect(codigo).not.toMatch(/\b(UPDATE|DELETE\s+FROM)\s+public\.produtos\b/i);
    expect(codigo).not.toMatch(
      /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.produto_precos\b/i,
    );
    expect(codigo).not.toMatch(/SET\s+preco_base\b/i);
  });

  it("a migração não manda mensagem a ninguém", () => {
    expect(codigo).not.toMatch(/enfileirar_notificacao|notificacoes_fila|whatsapp|aviso_grupo/i);
  });
});

describe("1. produto_custo_cheio com uma linha por produto", () => {
  const view = codigo.slice(
    codigo.indexOf("CREATE OR REPLACE VIEW public.produto_custo_cheio"),
    codigo.indexOf("ALTER TABLE public.precos_propostas"),
  );

  it("escolhe UMA linha de produto_precificacao por produto, a de maior custo cheio", () => {
    expect(view).toContain("LEFT JOIN LATERAL");
    expect(view).toContain("LIMIT 1");
    expect(view).toMatch(/ORDER BY[\s\S]*DESC[\s\S]*'Composição do custo'[\s\S]*q\.id/);
  });

  it("mantém as 14 colunas, na mesma ordem", () => {
    const marcas = [
      "p.id AS produto_id",
      "p.nome,",
      "p.tempo_producao_min,",
      "pr.preco_base,",
      "pr.custo_medio,",
      "AS custo_material",
      "AS custo_maquina",
      "AS custo_mao_obra",
      "AS custo_indireto",
      "AS custo_cheio",
      "AS sem_ficha_de_material",
      "AS sem_hora_de_maquina",
      "AS sem_mao_de_obra",
      "AS sem_rateio",
    ];
    let pos = view.indexOf("SELECT");
    for (const m of marcas) {
      const i = view.indexOf(m, pos);
      expect(i, m).toBeGreaterThan(-1);
      pos = i;
    }
  });

  it("reaplica security_invoker e os GRANTs, sem abrir para anon nem authenticated", () => {
    expect(view).toContain("WITH (security_invoker = true)");
    expect(codigo).toContain(
      "REVOKE ALL ON TABLE public.produto_custo_cheio FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(codigo).toContain("GRANT SELECT ON TABLE public.produto_custo_cheio TO service_role;");
    expect(codigo).not.toMatch(/GRANT[^;]*produto_custo_cheio[^;]*\b(anon|authenticated|PUBLIC)\b/);
  });
});

describe("2. preco_proposta_criar", () => {
  const corpo = corpoDe("preco_proposta_criar");

  it("só admin ou gestor que vê custo, com a mesma checagem de aprovar e recusar", () => {
    expect(corpo).toContain(
      "public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gestor'::public.app_role)",
    );
    expect(corpo).toContain("public.pode_ver_custo(v_uid)");
    expect(corpo).toContain("USING ERRCODE = '42501'");
  });

  it("recusa preço nulo, zero e negativo e motivo em branco", () => {
    expect(corpo).toContain("v_preco IS NULL OR v_preco <= 0");
    expect(corpo).toContain("length(v_motivo) < 3");
  });

  it("grava a origem manual com piso e margens pela conta das propostas existentes", () => {
    expect(corpo).toContain("'manual'");
    expect(corpo).toContain("public._preco_piso(v_prod.custo_medio, v_prod.margem_minima)");
    expect(corpo).toContain("public._preco_margem(v_preco, v_prod.custo_medio)");
    expect(corpo).toContain("public._preco_margem(v_prod.preco_base, v_prod.custo_medio)");
  });

  it("não cria pendente repetida: devolve a mesma se o preço é igual e recusa se é outro", () => {
    expect(corpo).toContain("ON CONFLICT (produto_id) WHERE status = 'pendente' DO NOTHING");
    expect(corpo).toContain("v_pend.preco_proposto = v_preco");
    expect(corpo).toContain("RETURN v_pend.id");
  });

  it("nunca escreve em produtos nem em orçamento", () => {
    expect(corpo).not.toMatch(
      /UPDATE\s+public\.produtos|INSERT\s+INTO\s+public\.produtos|public\.orcamento/i,
    );
  });

  it("o CHECK de origem só acrescenta manual", () => {
    expect(codigo).toContain("CHECK (origem IN ('abaixo_do_piso', 'referencia_m2', 'manual'))");
  });

  it("ACL: revoga de todos e só authenticated executa", () => {
    const rev =
      "REVOKE ALL ON FUNCTION public.preco_proposta_criar(uuid, numeric, text) FROM PUBLIC, anon, authenticated, service_role;";
    expect(codigo).toContain(rev);
    expect(
      codigo.indexOf(
        "GRANT EXECUTE ON FUNCTION public.preco_proposta_criar(uuid, numeric, text) TO authenticated;",
      ),
    ).toBeGreaterThan(codigo.indexOf(rev));
    const grants = [...codigo.matchAll(/GRANT EXECUTE ON FUNCTION[^;]*;/g)].map((m) => m[0]);
    expect(grants).toHaveLength(1);
  });
});

describe("3. aviso de custo fora da faixa", () => {
  const corpo = corpoDe("tg_orcamento_item_aviso_custo_fora_da_faixa");

  it("é AFTER e devolve NULL: não bloqueia nem altera valor", () => {
    expect(codigo).toMatch(
      /CREATE TRIGGER tg_orcamento_itens_zz_aviso_custo\s+AFTER INSERT OR UPDATE OF/,
    );
    expect(corpo).not.toMatch(/RETURN NEW|NEW\.\w+\s*:=/);
    expect(corpo).not.toMatch(/\b(UPDATE|DELETE\s+FROM)\s+public\./i);
  });

  it("compara com custo_medio vezes a área cobrada, com limite de 30 por cento", () => {
    expect(corpo).toContain("v_custo_medio *");
    expect(corpo).toContain("NEW.area_cobrada");
    expect(corpo).toContain("abs(v_dif) <= 30");
  });

  it("só grava um registro em logs_auditoria, sem EXCEPTION mudo", () => {
    expect([...corpo.matchAll(/INSERT INTO/g)]).toHaveLength(1);
    expect(corpo).toContain("INSERT INTO public.logs_auditoria");
    expect(corpo).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING[^;]*SQLERRM/);
  });

  it("não mexe no gatilho de custo do produto", () => {
    expect(codigo).not.toMatch(/FUNCTION public\.tg_orcamento_item_custo_do_produto/);
    expect(codigo).not.toMatch(/tg_orcamento_itens_zz_custo_do_produto/);
  });
});

describe("4. preco_minimo do cálculo 3D", () => {
  const corpo = corpoDe("tg_orcamento_3d_calculos_piso");

  it("grava custo operacional dividido por 0,70 só quando o preço mínimo vem zero", () => {
    expect(corpo).toContain("COALESCE(NEW.preco_minimo, 0) = 0");
    expect(corpo).toContain("round(NEW.custo_operacional / 0.70, 2)");
  });

  it("é só BEFORE INSERT: a tabela é imutável, então não há backfill nem UPDATE", () => {
    expect(codigo).toContain("BEFORE INSERT ON public.orcamento_3d_calculos");
    expect(codigo).not.toMatch(/UPDATE\s+public\.orcamento_3d_calculos/i);
    expect(codigo).not.toMatch(/DISABLE TRIGGER|trg_immutable_orcamento_3d_calculos/i);
    expect(doc).toContain("Backfill dos 30 registros: não feito");
  });
});

describe("5. histórico de preço da pasta do produto", () => {
  const corpo = corpoDe("tg_historico_da_pasta_do_produto");

  it("grava preço de e para, piso e margem antes e depois, se o custo mudou e o autor", () => {
    for (const k of [
      "preco_de",
      "preco_para",
      "piso_antes",
      "piso_depois",
      "margem_antes",
      "margem_depois",
      "custo_mudou",
      "autor_tipo",
      "autor_id",
    ]) {
      expect(corpo, k).toContain(`'${k}'`);
    }
    expect(corpo).toContain("'chave_de_servico'");
    expect(corpo).toContain("'sem_sessao'");
    expect(corpo).toContain("auth.uid()");
  });

  it("dispara para preço, custo e margem mínima, e não grava o custo em reais", () => {
    expect(corpo).toContain("ARRAY['preco_base', 'custo_medio', 'margem_minima']");
    const bloco = corpo.slice(
      corpo.indexOf("v_detalhes || jsonb_build_object("),
      corpo.indexOf("'autor_id', v_uid);"),
    );
    const chaves = [...bloco.matchAll(/'(\w+)',/g)].map((m) => m[1]);
    expect(chaves.filter((c) => c.includes("custo"))).toEqual(["custo_mudou"]);
  });

  it("a gravação com preço não engole erro; as outras mantêm o aviso", () => {
    const i = corpo.indexOf("IF v_com_preco THEN");
    const ate = corpo.indexOf("ELSE", i);
    expect(corpo.slice(i, ate)).not.toContain("EXCEPTION");
    expect(corpo.slice(ate)).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it("mantém a lista de colunas vigiadas e o ramo das tabelas da pasta", () => {
    for (const c of [
      "nome",
      "descricao",
      "unidade",
      "ativo",
      "maquina_padrao_id",
      "material_principal_id",
      "tempo_producao_min",
      "area_minima_cobrada",
    ]) {
      expect(corpo, c).toContain(`'${c}'`);
    }
    expect(corpo).toContain("jsonb_object_keys(v_novo)");
    expect(corpo).toContain("lower(TG_OP)");
  });

  it("segue com SECURITY DEFINER e sem EXECUTE para ninguém", () => {
    expect(codigo).toMatch(
      /FUNCTION public\.tg_historico_da_pasta_do_produto\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'/,
    );
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public.tg_historico_da_pasta_do_produto() FROM PUBLIC, anon, authenticated;",
    );
  });
});

describe("6. custo zero preenchido", () => {
  const bloco = codigo.slice(codigo.indexOf("DO $custo_zero$"), codigo.indexOf("END $custo_zero$"));

  it("só custo exatamente zero, em orçamento fora de aprovado e convertido, com produto de custo", () => {
    expect(bloco).toContain("i.custo_unitario = 0");
    expect(bloco).toContain("o.status NOT IN ('aprovado', 'convertido')");
    expect(bloco).toContain("COALESCE(p.custo_medio, 0) > 0");
  });

  it("usa a regra do gatilho de custo: regrava a coluna e deixa o gatilho preencher", () => {
    expect(bloco).toContain("SET custo_unitario = i.custo_unitario");
    expect(bloco).toContain("AND i.custo_unitario = 0");
  });

  it("para tudo se valor do item mudar ou se aprovado ou convertido entrar", () => {
    expect(bloco).toMatch(
      /IS DISTINCT FROM a\.valor_unitario[\s\S]*IS DISTINCT FROM a\.valor_total/,
    );
    expect(bloco).toContain("RAISE EXCEPTION 'Preencher o custo mudou valor");
    expect(bloco).toContain("status_orcamento IN ('aprovado', 'convertido')");
  });

  it("deixa o antes e o depois em logs_auditoria", () => {
    expect(bloco).toContain("'custo_zero_preenchido'");
    expect(bloco).toContain("'custo_antes'");
    expect(bloco).toContain("'custo_depois'");
  });

  it("o ensaio lista cada item afetado, antes e depois", () => {
    expect(ensaio).toContain("custo_zero_antes");
    expect(doc).toContain("| 39 rejeitado | Bola Leitoso 33 × 33 cm | 30 | 0,00 | 0,79 |");
    expect(doc).toContain("| 39 rejeitado | Bolão Leitoso 48 × 48 cm | 20 | 0,00 | 1,66 |");
  });
});

describe("7. IA desligada, nunca ligada", () => {
  const i = codigo.indexOf("WITH alvo AS");
  const bloco = codigo.slice(i);

  it("só desliga: nenhum ia_habilitado = true na migração", () => {
    expect(bloco).toContain("SET ia_habilitado = false");
    expect(codigo).not.toMatch(/ia_habilitado\s*=\s*true/i);
  });

  it("os três critérios: sem preço válido, abaixo do piso, proposta pendente", () => {
    expect(bloco).toContain("p.preco_base IS NULL OR p.preco_base <= 0");
    expect(bloco).toContain(
      "p.preco_base < COALESCE(public._preco_piso(p.custo_medio, p.margem_minima), 0)",
    );
    expect(bloco).toContain("x.status = 'pendente'");
  });

  it("só produto ativo com a IA ligada, e deixa o rastro para religar", () => {
    expect(bloco).toContain("WHERE p.ativo AND f.ia_habilitado");
    expect(bloco).toContain("'ia_desligada_por_preco'");
    expect(bloco).toContain("'ia_habilitado_antes', true");
  });

  it("o ensaio mostra a lista exata, com os 13 produtos e os dois ids do pedido tratados", () => {
    expect(doc).toContain("Lista exata (13 produtos)");
    expect(doc).toContain("1dc26b82-fefa-41a7-92c5-f880668a978f");
    expect(doc).toContain("046eb529-4a08-42dc-82df-404f851fbcfb");
    const linhas = doc
      .split("\n")
      .filter(
        (l) =>
          (/^\| .* [0-9a-f]{8}-[0-9a-f]{4}-/.test(l) && l.includes("| proposta pendente |")) ||
          /abaixo do piso, proposta pendente \|$/.test(l) ||
          l.includes("| sem preço válido |"),
      );
    expect(linhas.length).toBeGreaterThanOrEqual(13);
  });
});

describe("ensaio: roteiro e provas", () => {
  it("roda dentro de uma transação desfeita por RAISE EXCEPTION final e confere o preço de todos os produtos", () => {
    expect(ensaio.trimEnd().endsWith("END $ensaio$;")).toBe(true);
    expect(ensaio).toMatch(/RAISE EXCEPTION E'ENSAIO OK/);
    expect(ensaio).not.toMatch(/\bCOMMIT\b/);
    expect(ensaio).toContain("produtos com preco_base diferente do de antes da migracao");
    expect(ensaio).toContain("produtos.preco_base antes=");
  });

  it("prova cada item com antes e depois", () => {
    for (const marca of ["[0]", "[1] ANTES", "DEPOIS:", "[2]", "[3]", "[4]", "[5]", "[6]", "[7]"]) {
      expect(ensaio, marca).toContain(marca);
    }
  });

  it("o ensaio testa quem não pode: vendedor, anon e entradas inválidas", () => {
    expect(ensaio).toContain("SET LOCAL ROLE anon");
    expect(ensaio).toContain("vendedor criou proposta");
    expect(ensaio).toContain("preco negativo passou");
    expect(ensaio).toContain("has_function_privilege('public'");
  });

  it("o roteiro de volta existe e religa só o que a migração desligou", () => {
    expect(volta).toContain("l.acao = 'ia_desligada_por_preco'");
    expect(volta).toContain("l.acao = 'custo_zero_preenchido'");
    expect(volta).toContain("DROP TRIGGER IF EXISTS tg_orcamento_itens_zz_aviso_custo");
    expect(volta).toContain(
      "DROP FUNCTION IF EXISTS public.preco_proposta_criar(uuid, numeric, text)",
    );
    expect(volta).toContain("da8e14c4208ca0a42d2230a448537e3c");
  });

  it("o doc diz que não foi aplicada", () => {
    expect(doc).toContain("NÃO aplicada");
    expect(doc).toContain("desfeita por RAISE EXCEPTION final");
  });
});

describe("textos do documento", () => {
  it("sem travessão e sem seta", () => {
    const fora = doc.replace(/```[\s\S]*?```/g, "");
    expect(fora).not.toMatch(/—|→|⇒/);
    expect(sql).not.toMatch(/—|→/);
  });
});
