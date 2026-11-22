import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metragemPorMaterial } from "@/domain/orcamentos/metragem-por-material";
import { FORA_DO_MENU, menuDaPessoa, paginasDaBusca, podeAbrirRota } from "@/lib/menu";
import { getRoutePermissions, rolePermissions } from "@/lib/permissions";

/**
 * 22/11/2026. O troféu entra no orçamento por três portas (o botão "Troféu" da tela do orçamento, a porta nova
 * /orcamento-trofeu-novo e a busca) e sai por uma (a função do banco que tira o troféu com a arte). Estes testes
 * travam as ligações: quem chama quem, o que a tela NÃO faz (calcular preço, ler custo) e o que o orçamento faz com
 * as linhas de troféu e de arte.
 */
const ler = (c: string) => readFileSync(c, "utf8");
const tela = ler("src/routes/_authenticated/orcamentos.$id.tsx");
const calculadora = ler("src/components/trofeus/calculadora-de-trofeu.tsx");
const rota = ler("src/routes/_authenticated/orcamento-trofeu-novo.tsx");
const dialogo = ler("src/components/trofeus/dialogo-do-trofeu.tsx");

describe("a calculadora NÃO calcula preço nem lê custo: tudo vem do servidor", () => {
  it("não importa a conta, a cotação nem o banco de custo", () => {
    expect(calculadora).not.toContain("calcularTrofeu");
    expect(calculadora).not.toContain("cotarTrofeuComABase");
    expect(calculadora).not.toContain("@/domain/trofeus/conta");
    expect(calculadora).not.toMatch(/from\("(custos_tabela|custos_mao_de_obra|maquinas|trofeu_regras|trofeu_pecas|materiais)"\)/);
    // só importa TIPOS de cotacao, nunca funções
    const importaDeCotacao = calculadora.match(/import[^;]*from "@\/domain\/trofeus\/cotacao";/g) ?? [];
    for (const i of importaDeCotacao) expect(i).toMatch(/^import type /);
  });

  it("pede o preço por cotarTrofeu, a escada por escadaDoTrofeu, os modelos por dadosDoTrofeu e grava por salvarTrofeuNoOrcamento", () => {
    for (const nome of ["cotarTrofeu", "escadaDoTrofeu", "dadosDoTrofeu", "lerTrofeuGravado", "salvarTrofeuNoOrcamento"]) {
      expect(calculadora, nome).toContain(nome);
    }
    expect(calculadora).toContain('from "@/lib/api/trofeus.functions"');
  });

  it("só manda ao servidor as escolhas e o total que viu (precoVisto), nunca o preço", () => {
    expect(calculadora).toContain("precoVisto: atual.totalGeral");
    expect(calculadora).toContain("...entrada, orcamentoId: orcId, itemId");
    expect(calculadora).not.toMatch(/precoUnitario:\s*atual/);
    expect(calculadora).not.toMatch(/valor_unitario|custo_unitario/);
  });

  it("o simulador só aparece quando a resposta do servidor traz custo (quem não vê custo não tem o quadro)", () => {
    expect(calculadora).toContain('"custoCheio" in c');
    expect(calculadora).toContain("{simulador && (");
    expect(calculadora).toContain('data-testid="simulador-de-preco"');
  });

  it("o aval: abaixo do piso trava o salvar até o aval ser confirmado, e só quem pode dar vê a caixa", () => {
    expect(calculadora).toContain("podeDarAval: simulador?.podeDarAval ?? false");
    expect(calculadora).toContain('data-testid="confirmar-aval"');
    expect(calculadora).toContain("disabled={!situacao.pode || salvar.isPending}");
    expect(calculadora).toContain("setAvalConfirmado(false)");
  });

  it("falta de estoque só avisa: nada na tela bloqueia por estoque", () => {
    expect(calculadora).toContain('data-testid="aviso-de-estoque"');
    expect(calculadora).toContain("Estoque: o orçamento sai normalmente");
    expect(calculadora).not.toMatch(/disabled=\{[^}]*estoque/i);
    expect(calculadora).not.toMatch(/\.estoque\s*[<>]/);
  });

  it("o preço de agora ou nada: digitou de novo, a cotação some até a nova chegar; o preço mudou, pede de novo", () => {
    expect(calculadora).toContain("useAtrasado(chave, 400)");
    expect(calculadora).toContain("const atual = entrada && !esperandoDigitar && cotacao.isSuccess ? cotacao.data : null;");
    expect(calculadora).toContain("PRECO_MUDOU_TROFEU");
    expect(calculadora).toContain("void cotacao.refetch()");
  });

  it("falha vira aviso com 'Tentar de novo', nunca tela em branco nem 'nenhum modelo'", () => {
    for (const id of ["trofeu-falha-dos-dados", "trofeu-falha-do-gravado", "trofeu-falha-da-cotacao"]) expect(calculadora, id).toContain(`data-testid="${id}"`);
    expect(calculadora).toContain("Tentar de novo");
    expect(calculadora).toContain('role="alert"');
  });

  it("a porta nova cria UM orçamento por tentativa (nova tentativa depois de falha reaproveita o mesmo)", () => {
    expect(calculadora).toContain("orcamentoCriado.current = orcId");
    expect(calculadora).toContain("orcamentoId ?? orcamentoCriado.current");
    expect(calculadora).toContain("Escolha o cliente ou escreva o nome do contato.");
  });

  it("segue os guardas de interface do projeto: sem text-primary, sem title=, sem letra fixa pequena", () => {
    expect(calculadora).not.toMatch(/\btext-primary\b/);
    expect(calculadora).not.toMatch(/\btitle=/);
    expect(calculadora).not.toMatch(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/);
    expect(calculadora).not.toMatch(/text-(accent)\b/);
  });

  it("acessível: campos com label, cartões com grupo, avisos com role", () => {
    expect(calculadora).toContain('htmlFor={id}');
    expect(calculadora).toContain('rotulo="Modelos de troféu"');
    expect(calculadora).toContain('rotulo="Tipo de arte"');
    expect(calculadora).toContain('role="status"');
  });
});

describe("a tela do orçamento: abrir, editar e tirar o troféu", () => {
  it("tem o botão Troféu ao lado da Peça 3D e o diálogo da calculadora embutida", () => {
    expect(tela).toContain('data-testid="botao-trofeu"');
    expect(tela).toContain("setCalculadoraTrofeu({ itemId: null })");
    expect(tela).toContain("<DialogoDoTrofeu");
    expect(tela).toContain("itemId={calculadoraTrofeu?.itemId ?? null}");
    expect(tela).toContain("orcamentoId={id}");
    expect(dialogo).toContain('data-testid="dialogo-trofeu"');
    expect(dialogo).toContain('modo="embutido"');
  });

  it("o diálogo só monta a calculadora quando está aberto (nada de cotar com o diálogo fechado)", () => {
    expect(dialogo).toContain("{aberto && (");
    expect(dialogo).toContain("<CalculadoraDeTrofeu");
  });

  it("depois de salvar, relê os itens e as capas e recalcula o total do orçamento", () => {
    const bloco = tela.slice(tela.indexOf("<DialogoDoTrofeu"), tela.indexOf("<ConferenciaAntesDeConverter"));
    expect(bloco).toContain('queryKey: ["orc-itens", id]');
    expect(bloco).toContain('queryKey: ["orc-capas", id]');
    expect(bloco).toContain("await recalcular()");
    expect(bloco).toContain("setCalculadoraTrofeu(null)");
  });

  it("'Editar' num troféu reabre a calculadora pelo id da linha; na arte, não há 'Editar'", () => {
    expect(tela).toContain("setCalculadoraTrofeu({ itemId: i.id })");
    expect(tela).toContain("{!ehItemDeArteDeTrofeu(i) && (\n                                      <Dica texto={ehItemDeTrofeu(i) ? \"Editar o troféu\" : \"Editar item\"}>");
  });

  it("troféu e arte não se duplicam, e a arte não se tira à parte (a arte só muda editando o troféu)", () => {
    expect(tela).toContain("!pecaDoItem.has(i.id) && !ehItemDeTrofeu(i) && !ehItemDeArteDeTrofeu(i)");
    expect(dialogo).toContain("Arte do troféu: para mudar, edite o troféu.");
    expect(tela).toContain('texto={ehItemDeTrofeu(i) ? "Tirar o troféu e a arte dele" : "Tirar o item"}');
    expect(tela).toContain("{!ehItemDeArteDeTrofeu(i) && (\n                                      <Dica texto={ehItemDeTrofeu(i) ? \"Tirar");
  });

  it("tirar o troféu chama a função do banco que leva a arte junto, e não um DELETE solto", () => {
    expect(tela).toContain('(supabase.rpc as any)("remover_trofeu_do_orcamento", { p_item_id: itemId })');
    const i = tela.indexOf("remover_trofeu_do_orcamento");
    const delecaoGenerica = tela.indexOf('supabase.from("orcamento_itens").delete().eq("id", itemId)');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(delecaoGenerica);
    expect(tela).toContain("ehItemDeTrofeu(x)");
  });

  it("o aviso 'sem produto ligado' não aparece em troféu nem em arte (eles têm custo gravado)", () => {
    expect(tela).toContain("{!i.produto_id && !ehItemDeTrofeu(i) && !ehItemDeArteDeTrofeu(i) && (");
  });

  it("a linha diz que é troféu, pelo componente de nota (e a rota fica abaixo do teto de linhas)", () => {
    expect(tela).toContain("<NotaDoItemDeTrofeu item={i} />");
    expect(dialogo).toContain('data-trofeu=""');
    expect(dialogo).toContain("Troféu de acrílico: o preço vem da calculadora do troféu");
    expect(tela.split("\n").length).toBeLessThan(2800);
  });
});

describe("a porta nova (/orcamento-trofeu-novo)", () => {
  it("abre a calculadora em modo novo-orcamento e leva ao orçamento criado", () => {
    expect(rota).toContain('createFileRoute("/_authenticated/orcamento-trofeu-novo")');
    expect(rota).toContain('modo="novo-orcamento"');
    expect(rota).toContain('navigate({ to: "/orcamentos/$id", params: { id: r.orcamentoId } })');
  });

  it("exige orcamentos.create, a mesma permissão que a gravação confere no banco", () => {
    expect(getRoutePermissions("/orcamento-trofeu-novo")).toEqual(["orcamentos.create"]);
  });

  const buscaDe = (papel: string) => {
    const tem = new Set((rolePermissions as unknown as Record<string, readonly string[]>)[papel] ?? []);
    const temPermissao = (p: string) => tem.has(p);
    const podeAbrir = (url: string) => podeAbrirRota(url, temPermissao);
    return paginasDaBusca(menuDaPessoa(podeAbrir, temPermissao), podeAbrir).map((p) => p.url);
  };

  it("está fora da árvore do menu (é uma ação) mas aparece na busca, depois do 3D", () => {
    expect(FORA_DO_MENU["/orcamento-trofeu-novo"]?.titulo).toBe("Novo orçamento de troféu");
    const urls = buscaDe("admin");
    expect(urls).toContain("/orcamento-trofeu-novo");
    expect(urls.indexOf("/orcamento-trofeu-novo")).toBeGreaterThan(urls.indexOf("/orcamento-3d-novo"));
  });

  it("quem cria orçamento (vendedor, gestor) acha a tela na busca; quem não cria (designer, operador) não", () => {
    for (const papel of ["vendedor", "gestor", "admin"]) expect(buscaDe(papel), papel).toContain("/orcamento-trofeu-novo");
    for (const papel of ["designer", "operador"]) expect(buscaDe(papel), papel).not.toContain("/orcamento-trofeu-novo");
  });

  it("a rota está no arquivo gerado do roteador", () => {
    const arvore = ler("src/routeTree.gen.ts");
    expect(arvore).toContain("'/_authenticated/orcamento-trofeu-novo'");
    expect(arvore).toContain("./routes/_authenticated/orcamento-trofeu-novo");
  });
});

describe("a metragem do orçamento com troféu", () => {
  const item = (o: Record<string, unknown>) => ({ id: "i", descricao: "x", quantidade: 1, produto_id: null, ...o }) as never;

  it("o troféu conta como troféus (sem m² nem 'material' inventado) e a arte não conta", () => {
    const linhas = metragemPorMaterial(
      [
        item({ id: "t", descricao: "Troféu premium em camadas 28 cm", quantidade: 5, tipo_produto: "Troféu de acrílico" }),
        item({ id: "a", descricao: "Criação exclusiva da arte", quantidade: 1, tipo_produto: "Arte do troféu" }),
      ],
      [],
    );
    expect(linhas).toEqual([{ material: "Troféus de acrílico", m2: 0, pecas: 5, gramas: 0, itens: 1 }]);
  });

  it("um item comum continua como antes", () => {
    const linhas = metragemPorMaterial([item({ descricao: "Lona 440g", quantidade: 2, area_total: 3 })], []);
    expect(linhas[0]).toMatchObject({ material: "Lona 440g", m2: 3, pecas: 2 });
  });
});

describe("a função do banco que tira o troféu com a arte", () => {
  const sql = ler("supabase/migrations/20261122500000_remover_trofeu_do_orcamento.sql");
  const codigo = sql.replace(/--[^\n]*/g, "");

  it("nasce fechada (REVOKE ALL de PUBLIC, anon e authenticated; só authenticated volta) e confere a permissão por dentro", () => {
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.remover_trofeu_do_orcamento(uuid) FROM PUBLIC, anon, authenticated;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.remover_trofeu_do_orcamento(uuid) TO authenticated;");
    expect(codigo.match(/GRANT /g)).toHaveLength(1);
    expect(codigo).toContain("v_uid := public.require_permission('orcamentos.create');");
    expect(codigo).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
  });

  it("só tira item de origem trofeu, em orçamento que não virou OS, e a arte pelo vínculo do próprio troféu", () => {
    expect(codigo).toContain("WHERE id = p_item_id AND origem_calculo = 'trofeu' FOR UPDATE");
    expect(codigo).toContain("v_orc.os_id IS NOT NULL OR v_orc.status::text = 'convertido'");
    expect(codigo).toContain("origem_calculo = 'trofeu_arte' AND parametros ->> 'trofeu_item_id' = p_item_id::text");
    expect(codigo).not.toContain("gerado_por_item_id");
  });

  it("confere depois que anon e PUBLIC não executam, e traz o DESFAZER", () => {
    expect(codigo).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(codigo).toContain("a.grantee = 0 AND a.privilege_type = 'EXECUTE'");
    expect(codigo.indexOf("DO $final$")).toBeLessThan(codigo.indexOf("COMMIT;"));
    expect(sql).toContain("DROP FUNCTION public.remover_trofeu_do_orcamento(uuid);");
  });
});
