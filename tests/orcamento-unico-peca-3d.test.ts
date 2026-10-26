import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const le = (p: string) => readFileSync(p, "utf8");
const sql = le("supabase/migrations/20261027300000_orcamento_unico_peca_3d.sql");
const calc = le("src/components/impressao3d/calculadora-3d.tsx");
const escolha = le("src/components/orcamento/escolha-de-produto.tsx");
const pagina = le("src/routes/_authenticated/orcamentos.$id.tsx");
const detalhe = le("src/routes/_authenticated/orcamento-3d.$id.tsx");
const hub = le("src/routes/_authenticated/impressao-3d.tsx");
const rota = le("src/routes/_authenticated/orcamento-3d-novo.tsx");

describe("peça 3D como item do orçamento (banco)", () => {
  it("a peça embutida tem item e o espelho não sobrescreve o orçamento", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS embutido boolean NOT NULL DEFAULT false");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.orcamento_itens(id) ON DELETE SET NULL");
    expect(sql).toContain("IF COALESCE(NEW.embutido, false) THEN RETURN NULL; END IF;");
  });
  it("gravar exige a permissão de quem cria orçamento e grava item + cálculo versionado", () => {
    expect(sql).toContain("v_uid := public.require_permission('orcamentos.create');");
    expect(sql).toContain("origem_calculo, especificacao, parametros, arquivo_id)");
    expect(sql).toContain("SELECT COALESCE(max(versao), 0) + 1 INTO v_versao");
    expect(sql).toContain("Informe o tempo de impressão");
  });
  it("a conversão comum cria os jobs de impressão e só desvia para o 3D no legado", () => {
    expect(sql).toContain("AND NOT COALESCE(t3.embutido, false)) THEN");
    expect(sql).toContain("public.criar_jobs_3d_da_os(v_t3.id, v_os_id)");
    expect(sql).toContain("'jobs_3d', v_jobs_3d");
  });
  it("a OS só é 'de impressão 3D' quando todos os itens são peças 3D", () => {
    expect(sql).toContain("COALESCE(i.origem_calculo, '') NOT IN ('orcamento_3d', 'taxa_prazo')");
    expect(sql).toContain("AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id) THEN");
  });
  it("apagar a peça inteira passa; alterar um cálculo avulso continua proibido", () => {
    expect(sql).toContain("IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.orcamentos_3d WHERE id = OLD.orcamento_3d_id)");
    expect(sql).toContain("orcamento_3d_calculos é imutável; gere nova versão");
  });
});

describe("peça 3D como item do orçamento (tela)", () => {
  it("a calculadora é uma só, com dois modos, e grava pela função nova", () => {
    expect(calc).toContain('modo: "embutido" | "novo-orcamento"');
    expect(calc).toContain('"salvar_item_3d_no_orcamento"');
    expect(calc).toContain('"ler_item_3d"');
    expect(calc).toContain("enviarLayout(fotoModelo, orcId");
    expect(rota).toContain('modo="novo-orcamento"');
    expect(rota).toContain('to: "/orcamentos/$id"');
  });
  it("o cartão Impressão 3D abre a calculadora; a peça gravada reabre nela e sai pela função do banco", () => {
    expect(escolha).toContain('if (t.chave === "impressao_3d" && onCalcularPeca3d) onCalcularPeca3d();');
    expect(escolha).toContain('data-testid="calcular-peca-3d"');
    expect(pagina).toContain("setCalculadora3d({ orcamento3dId: pecaDoItem.get(i.id)!.id })");
    expect(pagina).toContain('"remover_item_3d_do_orcamento"');
    expect(pagina).toContain('data-testid="botao-peca-3d"');
  });
  it("o resumo mostra a metragem por material", () => {
    expect(pagina).toContain('data-testid="metragem-por-material"');
    expect(pagina).toContain("metragemPorMaterial(itensDeProduto");
  });
  it("as telas do módulo 3D levam ao orçamento e não convertem a peça embutida por fora", () => {
    expect(detalhe).toContain("Abrir o orçamento");
    expect(detalhe).toContain("Converter pelo orçamento");
    expect(detalhe).toContain('sessionStorage.setItem("bex.orcamento.editar3d", orc.id)');
    expect(hub).toContain('to="/orcamentos/$id"');
    expect(hub).toContain("o.embutido && o.orcamento_id");
  });
});

describe("o produto de prateleira da impressão 3D fica escondido quando a calculadora está ligada", () => {
  it("some dos atalhos, da busca e da lista; o tipo mostra 'calculadora'", () => {
    expect(escolha).toContain('const ocultar = (p: ProdutoDaEscolha) => !!onCalcularPeca3d && tipoDoProduto(p).chave === "impressao_3d";');
    expect(escolha).toContain(".filter((p): p is ProdutoDaEscolha => !!p && !ocultar(p))");
    expect(escolha).toContain("grupoAtual!.produtos.filter((p) => !ocultar(p))");
    expect(escolha).toContain('? "calculadora"');
  });
});

describe("o tempo de impressão na especificação do item sai em português", () => {
  it("troca o ponto por vírgula (1,00 h), só no texto", () => {
    const fix = readFileSync("supabase/migrations/20261027310000_peca_3d_tempo_com_virgula.sql", "utf8");
    expect(fix).toContain("replace(round(p_tempo_segundos / 3600.0, 2)::text, '.', ',') || ' h de impressão'");
  });
});

describe("arquivo do fatiador (.3mf/.gcode) ligado à calculadora", () => {
  const fn = readFileSync("src/lib/api/fatiador.functions.ts", "utf8");
  const dropzone = readFileSync("src/components/bex/Dropzone.tsx", "utf8");
  it("o servidor só lê da pasta do fatiador, com a permissão de quem cria orçamento, e o leitor roda só no servidor", () => {
    expect(fn).toContain("^orcamentos-3d\\/[0-9]+_slicer_[A-Za-z0-9._-]+\\.(3mf|gcode)$");
    expect(fn).toContain('_permission: "orcamentos.create"');
    expect(fn).toContain('await import("@/domain/impressao3d/slicer-import")');
  });
  it("a calculadora aceita o arquivo, sobe uma vez só e reaproveita o caminho ao salvar", () => {
    expect(calc).toContain('accept="image/*,.3mf,.gcode"');
    expect(calc).toContain("lerArquivoDoFatiador({ data: { caminho: path } })");
    expect(calc).toContain("slicerPath = slicerSubidoPath;");
  });
  it("o Dropzone mostra arquivo sem miniatura em vez de imagem quebrada", () => {
    expect(dropzone).toContain('if (!file || !file.type.startsWith("image/"))');
    expect(dropzone).toContain('data-testid="arquivo-sem-previa"');
  });
  it("a lista de orçamentos mostra a metragem de cada um", () => {
    const lista = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");
    expect(lista).toContain('queryKey: ["orcamentos-m2"');
    expect(lista).toContain("<TableHead className=\"hidden md:table-cell\">Metragem</TableHead>");
  });
});

describe("a consulta da metragem na lista só pede colunas que a view operacional tem", () => {
  it("não pede origem_calculo (a view não tem; a consulta inteira cairia e a coluna ficaria '—')", () => {
    const lista = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");
    const bloco = lista.slice(lista.indexOf('queryKey: ["orcamentos-m2"'), lista.indexOf("return soma;"));
    expect(bloco).toContain('.select("orcamento_id, area_cobrada, area_total, tipo_produto")');
    // o comentário do código cita a coluna; o que não pode é pedi-la ou lê-la
    expect(bloco).not.toContain("i.origem_calculo");
    expect(bloco).not.toMatch(/select\([^)]*origem_calculo/);
  });
});

describe("restos resolvidos em 27/10: WhatsApp pelo sistema, aviso do webhook, hub 3D", () => {
  it("link do catálogo e pedidos de cotação saem pela caixa do sistema", () => {
    expect(readFileSync("src/components/catalogo/links-do-catalogo.tsx", "utf8")).toContain('origem="catalogo"');
    const cot = readFileSync("src/components/catalogo/pedidos-de-cotacao.tsx", "utf8");
    expect(cot).toContain("abrirConversaPeloNumero({ data: { telefone: p.telefone, nome: p.nome } })");
    expect(cot).toContain('navigate({ to: "/whatsapp", search: { conversa: r.id } })');
  });
  it("o aviso 'Eventos com falha' conta só evento sem processado_em; mídia copia até 45 MB", () => {
    expect(readFileSync("src/components/whatsapp/alerta-whatsapp.tsx", "utf8")).toContain('.is("processado_em", null)');
    const wh = readFileSync("src/lib/api/whatsapp-webhook.server.ts", "utf8");
    expect(wh).toContain("const LIMITE_MIDIA_BYTES = 45 * 1024 * 1024;");
    expect(wh).not.toContain("acima de 16 MB");
  });
  it("a tela Impressão 3D não mostra mais o cartão de exemplo com números fictícios", () => {
    expect(hub).not.toContain("Referência do motor de custo (exemplo)");
  });
});
