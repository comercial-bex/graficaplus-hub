import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { abasDaPasta } from "@/domain/catalogo/pasta-do-produto";
import { buscaDaPasta } from "@/domain/catalogo/pronto-para-ia";
import {
  ABAS_DA_PLANILHA,
  CAMPOS_DE_CORRECAO_DA_PASTA,
  CAMPO_DO_QUADRO_DO_CUSTO,
  CHAVES_DAS_FALTAS,
  ONDE_CORRIGIR_O_AVISO,
  abaDaPlanilhaPedida,
  enderecoDoAlvo,
  ondeCorrigirAviso,
  ondeCorrigirFalta,
  ondeCorrigirFaltaDoAcabamento,
  ondeCorrigirForaDoRanking,
  type AlvoDaCorrecao,
  type OndeCorrigir,
} from "@/domain/precos/onde-corrigir";
import { fichaDoProduto } from "@/domain/precos/tabela-de-precos";

/**
 * 21/11/2026. O dono abriu o custeio, viu "sem matéria-prima na receita" e perguntou onde se responde isso. Toda
 * pendência do custeio agora diz "Vá até tal seção, tal módulo" e leva até lá. Estes testes travam o mapa
 * (pendência para destino) e conferem que cada destino existe de verdade: a aba, o campo e a rota.
 */

const ler = (arquivo: string) => readFileSync(arquivo, "utf8");
const PASTA = ler("src/routes/_authenticated/produtos_.$id.tsx");
const FRASES_PROIBIDAS = /[—–→←()]|->|<-/;

function todosOsDestinos(): { origem: string; onde: OndeCorrigir }[] {
  const lista: { origem: string; onde: OndeCorrigir }[] = [];
  for (const chave of CHAVES_DAS_FALTAS) lista.push({ origem: `falta ${chave}`, onde: ondeCorrigirFalta(chave) });
  for (const [codigo, onde] of Object.entries(ONDE_CORRIGIR_O_AVISO)) lista.push({ origem: `aviso ${codigo}`, onde: onde! });
  for (const frase of FRASES_DO_ACABAMENTO) {
    lista.push({ origem: `acabamento ${frase}`, onde: ondeCorrigirFaltaDoAcabamento(frase) });
  }
  for (const motivo of ["sem_tempo", "sem_custo"] as const) {
    lista.push({ origem: `fora do ranking ${motivo}`, onde: ondeCorrigirForaDoRanking(motivo) });
  }
  return lista;
}

/** As sete frases vivas de custo_do_acabamento_interno. */
const FRASES_DO_ACABAMENTO = [
  "máquina Laser sem custo por hora",
  "processo de máquina sem máquina escolhida",
  "sem tempo de máquina nem de mão de obra",
  "sem tempo de mão de obra (preparo, depuração, retirada)",
  "sem custo de mão de obra cadastrado",
  "mão de obra sem encargos",
  "material sem custo de compra",
];

describe("as faltas da ficha do produto sabem onde se corrigem", () => {
  const base = {
    tipo: "produto",
    categoria: "comunicacao_visual",
    temReceita: false,
    minutos: 60,
    temMaquina: true,
    composicao: null,
  };

  it("o caso da tela do dono: acrílico sem receita diz Materiais deste produto, na aba Parâmetros", () => {
    const f = fichaDoProduto(base);
    expect(f.itens).toEqual([{ chave: "sem_materia_prima", texto: "sem matéria-prima na receita" }]);
    expect(f.faltas).toEqual(["sem matéria-prima na receita"]);
    const onde = ondeCorrigirFalta("sem_materia_prima");
    expect(onde.vaAte).toBe("Vá até a aba Parâmetros desta pasta, no cartão Materiais deste produto.");
    expect(onde.alvo).toEqual({ tipo: "pasta", aba: "parametros", campo: "pasta-materiais" });
    expect(onde.botao).toBe("Ir para Materiais deste produto");
  });

  it("com custo digitado à mão, a frase conta quanto vale hoje (os R$ 400,00 do acrílico espelhado)", () => {
    const com = ondeCorrigirFalta("sem_materia_prima", { custoDigitado: 400 });
    expect(com.fazer).toContain("400,00");
    expect(com.fazer).toContain("digitado à mão");
    const sem = ondeCorrigirFalta("sem_materia_prima", { custoDigitado: 0 });
    expect(sem.fazer).not.toContain("digitado");
    expect(ondeCorrigirFalta("sem_materia_prima").fazer).toBe(sem.fazer);
  });

  it("cada falta que a ficha produz tem chave e destino, e o texto de antes não mudou", () => {
    const todas = fichaDoProduto({
      tipo: "produto",
      categoria: "comunicacao_visual",
      temReceita: false,
      minutos: null,
      temMaquina: false,
      composicao: null,
    });
    expect(todas.itens.map((i) => i.chave)).toEqual(["sem_materia_prima", "sem_tempo", "sem_maquina"]);
    expect(todas.faltas).toEqual(["sem matéria-prima na receita", "sem tempo de produção", "sem máquina padrão"]);

    const semMao = fichaDoProduto({
      ...base,
      temReceita: true,
      composicao: { material: 10, maquina: 2, maoDeObra: 0, indireto: 1 },
    });
    expect(semMao.itens).toEqual([{ chave: "sem_mao_de_obra", texto: "sem custo de mão de obra" }]);

    const revenda = fichaDoProduto({ ...base, categoria: "brindes", minutos: null });
    expect(revenda.itens.map((i) => i.chave)).toEqual(["custo_digitado", "sem_tempo"]);
    expect(revenda.itens[0].texto).toMatch(/custo digitado/);

    const produzidas = new Set([...todas.itens, ...semMao.itens, ...revenda.itens].map((i) => i.chave));
    expect([...produzidas].sort()).toEqual([...CHAVES_DAS_FALTAS].sort());
    for (const chave of CHAVES_DAS_FALTAS) expect(ondeCorrigirFalta(chave).vaAte.length).toBeGreaterThan(20);
  });

  it("ficha completa e serviço com custo inteiro não mostram falta nenhuma", () => {
    expect(
      fichaDoProduto({
        tipo: "produto",
        categoria: "impressao_grande_formato",
        temReceita: true,
        minutos: 20,
        temMaquina: true,
        composicao: { material: 10, maquina: 2, maoDeObra: 3, indireto: 1 },
      }),
    ).toMatchObject({ nivel: "completa", faltas: [], itens: [] });
    expect(
      fichaDoProduto({
        tipo: "servico",
        categoria: "acabamento",
        temReceita: false,
        minutos: 1,
        temMaquina: false,
        composicao: { material: 0.24, maquina: 0, maoDeObra: 0, indireto: 0 },
      }).itens,
    ).toEqual([]);
  });
});

describe("todo destino existe de verdade", () => {
  it("frases do dono: sem travessão, seta nem parênteses, e todas dizem aonde ir", () => {
    for (const { origem, onde } of todosOsDestinos()) {
      for (const texto of [onde.vaAte, onde.fazer, onde.botao]) {
        expect(texto, origem).not.toMatch(FRASES_PROIBIDAS);
      }
      expect(onde.vaAte, origem).toMatch(/^(Vá até|Corrija aqui|Confira aqui)/);
      expect(onde.fazer.length, origem).toBeGreaterThan(20);
      // Quem leva a algum lugar tem texto de botão; quem só diz o que fazer aqui não tem botão.
      if (onde.alvo.tipo === "aqui") expect(onde.botao, origem).toBe("");
      else expect(onde.botao.length, origem).toBeGreaterThan(5);
    }
  });

  it("destino na pasta: a aba existe, o campo é aceito no endereço e está na tela com esse id", () => {
    const abas = abasDaPasta({ canSeePrices: true }).map((a) => a.id);
    const custo = ler("src/components/produtos/custo-da-peca.tsx");
    for (const { origem, onde } of todosOsDestinos()) {
      if (onde.alvo.tipo !== "pasta") continue;
      const { aba, campo } = onde.alvo;
      expect(abas, origem).toContain(aba);
      expect(CAMPOS_DE_CORRECAO_DA_PASTA, origem).toContainEqual({ aba, campo });
      expect(buscaDaPasta({ aba, campo }), origem).toEqual({ aba, campo });
      const naPasta = PASTA.includes(`id="${campo}"`);
      const noQuadro = campo === CAMPO_DO_QUADRO_DO_CUSTO && custo.includes("id={CAMPO_DO_QUADRO_DO_CUSTO}");
      expect(naPasta || noQuadro, `${origem}: id ${campo}`).toBe(true);
    }
    expect(CAMPO_DO_QUADRO_DO_CUSTO).toBe("pasta-custo-da-peca");
  });

  it("campo de custeio só vale na aba dele: o endereço errado perde o campo mas mantém a aba", () => {
    expect(buscaDaPasta({ aba: "preco", campo: "pasta-materiais" })).toEqual({ aba: "preco" });
    expect(buscaDaPasta({ aba: "parametros", campo: "pasta-materiais" })).toEqual({ aba: "parametros", campo: "pasta-materiais" });
    expect(buscaDaPasta({ aba: "parametros", campo: "qualquer-coisa" })).toEqual({ aba: "parametros" });
  });

  it("destino na planilha: a aba é uma das três e a Planilha de custos abre nela", () => {
    const planilha = ler("src/routes/_authenticated/planilha-custos.tsx");
    for (const aba of ABAS_DA_PLANILHA) expect(planilha).toContain(`<TabsTrigger value="${aba}"`);
    expect(planilha).toContain("validateSearch");
    expect(planilha).toContain('defaultValue={busca.aba ?? "materiais"}');
    expect(abaDaPlanilhaPedida({ aba: "mao-obra" })).toBe("mao-obra");
    expect(abaDaPlanilhaPedida({ aba: "tarifas" })).toBe("tarifas");
    expect(abaDaPlanilhaPedida({ aba: "outra" })).toBeUndefined();
    expect(abaDaPlanilhaPedida({})).toBeUndefined();
    expect(ondeCorrigirFalta("sem_mao_de_obra").alvo).toEqual({ tipo: "planilha", aba: "mao-obra" });
  });

  it("destino em outro módulo: a rota existe", () => {
    for (const { origem, onde } of todosOsDestinos()) {
      if (onde.alvo.tipo !== "rota") continue;
      expect(existsSync(`src/routes/_authenticated${onde.alvo.rota}.tsx`), `${origem}: ${onde.alvo.rota}`).toBe(true);
    }
  });

  it("o endereço do botão carrega aba e campo, e o aviso 'aqui' não tem endereço", () => {
    const alvos: AlvoDaCorrecao[] = [
      { tipo: "pasta", aba: "parametros", campo: "pasta-materiais" },
      { tipo: "planilha", aba: "mao-obra" },
      { tipo: "rota", rota: "/materiais" },
      { tipo: "aqui" },
    ];
    expect(alvos.map((a) => enderecoDoAlvo(a, "abc"))).toEqual([
      "/produtos/abc?aba=parametros&campo=pasta-materiais",
      "/planilha-custos?aba=mao-obra",
      "/materiais",
      null,
    ]);
  });
});

describe("os avisos de Preços por produto", () => {
  /** Aviso que é só informação, ou cuja correção é decisão de preço fora desta tela: fica sem destino, e o motivo está aqui. */
  const SEM_DESTINO: Record<string, string> = {
    parceiro_abaixo_do_piso_liquido: "decisão da gerência sobre o preço do parceiro",
    parceiro_acima_do_balcao: "preço do parceiro e do balcão são decisão da gerência",
    abaixo_da_regra_de_tres: "o próprio aviso diz que é só referência e não manda subir o preço",
    velocidade_com_margem: "informação: a margem de segurança é de propósito",
    mercado_local_da_lona: "informação: referência de mercado",
  };

  it("todo código de avisosDoProduto tem destino ou um motivo escrito para não ter", () => {
    const fonte = ler("src/domain/precos/custo-real.ts");
    const codigos = [...fonte.matchAll(/codigo: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(codigos.length).toBeGreaterThan(10);
    for (const codigo of new Set(codigos)) {
      const tem = ondeCorrigirAviso(codigo) !== null;
      const dispensado = codigo in SEM_DESTINO;
      expect(tem !== dispensado, `${codigo}: ou tem destino, ou tem motivo, nunca os dois nem nenhum`).toBe(true);
    }
  });

  it("aviso desconhecido não inventa destino", () => {
    expect(ondeCorrigirAviso("codigo_que_nao_existe")).toBeNull();
  });

  it("custo sem material, mão de obra e tinta levam ao lugar onde se preenche", () => {
    expect(ondeCorrigirAviso("material_sem_custo")?.alvo).toEqual({ tipo: "rota", rota: "/materiais" });
    expect(ondeCorrigirAviso("sem_tinta")?.alvo).toEqual({ tipo: "pasta", aba: "parametros", campo: "pasta-materiais" });
    expect(ondeCorrigirAviso("sem_custo_real")?.alvo).toEqual({ tipo: "pasta", aba: "preco", campo: "pasta-custo-da-peca" });
    expect(ondeCorrigirAviso("sem_mao_de_obra")?.alvo).toEqual({ tipo: "pasta", aba: "preco", campo: "pasta-custo-da-peca" });
    expect(ondeCorrigirAviso("custo_incompleto")?.alvo).toEqual({ tipo: "rota", rota: "/custos-producao" });
    expect(ondeCorrigirAviso("tempo_presumido")?.alvo).toEqual({ tipo: "rota", rota: "/maquinas" });
  });

  it("aviso de preço baixo diz para corrigir na própria tela, sem botão, e explica que o gerente aprova", () => {
    for (const codigo of ["abaixo_do_custo", "margem_liquida_abaixo_do_minimo", "abaixo_do_minimo_recomendado"]) {
      const onde = ondeCorrigirAviso(codigo)!;
      expect(onde.alvo).toEqual({ tipo: "aqui" });
      expect(onde.fazer).toContain("O gerente aprova");
    }
  });
});

describe("as faltas do custo do acabamento", () => {
  it("as sete frases do banco existem na migração que as escreve", () => {
    const sql = ler("supabase/migrations/20261025400000_acabamentos_do_produto.sql");
    for (const trecho of [
      "' sem custo por hora'",
      "processo de máquina sem máquina escolhida",
      "sem tempo de máquina nem de mão de obra",
      "sem tempo de mão de obra (preparo, depuração, retirada)",
      "sem custo de mão de obra cadastrado",
      "mão de obra sem encargos",
      "material sem custo de compra",
    ]) {
      expect(sql, trecho).toContain(trecho);
    }
  });

  it("nenhuma das sete cai no destino geral, e cada uma aponta para o lugar certo", () => {
    const geral = ondeCorrigirFaltaDoAcabamento("frase que o banco ainda não escreve").vaAte;
    for (const frase of FRASES_DO_ACABAMENTO) {
      expect(ondeCorrigirFaltaDoAcabamento(frase).vaAte, frase).not.toBe(geral);
    }
    expect(ondeCorrigirFaltaDoAcabamento("máquina Laser sem custo por hora").alvo).toEqual({ tipo: "rota", rota: "/maquinas" });
    expect(ondeCorrigirFaltaDoAcabamento("material sem custo de compra").alvo).toEqual({ tipo: "rota", rota: "/materiais" });
    expect(ondeCorrigirFaltaDoAcabamento("sem custo de mão de obra cadastrado").alvo).toEqual({ tipo: "planilha", aba: "mao-obra" });
    expect(ondeCorrigirFaltaDoAcabamento("mão de obra sem encargos").alvo).toEqual({ tipo: "planilha", aba: "mao-obra" });
    expect(ondeCorrigirFaltaDoAcabamento("sem tempo de máquina nem de mão de obra").alvo).toEqual({ tipo: "aqui" });
    expect(ondeCorrigirFaltaDoAcabamento("processo de máquina sem máquina escolhida").vaAte).toContain("escolha a máquina");
  });

  it("frase nova do banco nunca fica sem orientação: cai no destino geral", () => {
    const onde = ondeCorrigirFaltaDoAcabamento("uma falta nova");
    expect(onde.vaAte).toMatch(/^Confira aqui/);
    expect(onde.alvo).toEqual({ tipo: "aqui" });
  });
});

describe("produtos fora do ranking da Meta", () => {
  it("sem tempo vai para o campo Tempo estimado; sem custo vai para o Custo do cadastro", () => {
    expect(ondeCorrigirForaDoRanking("sem_tempo").alvo).toEqual({ tipo: "pasta", aba: "parametros", campo: "pasta-tempo" });
    expect(ondeCorrigirForaDoRanking("sem_custo").alvo).toEqual({ tipo: "pasta", aba: "preco", campo: "pasta-custo-medio" });
  });

  it("a tela da Meta mostra um link por motivo, na pasta do produto, no campo certo", () => {
    const meta = ler("src/routes/_authenticated/meta.tsx");
    expect(meta).toContain('data-testid="corrigir-fora-do-ranking"');
    expect(meta).toContain("ondeCorrigirForaDoRanking(m)");
    expect(meta).toContain("search={{ aba: onde.alvo.aba, campo: onde.alvo.campo }}");
    expect(meta).toContain("text-link");
    // A frase fica à vista: o projeto proíbe title= que esconde informação (a CI pegou isso na primeira rodada).
    expect(meta).toContain('<span className="text-sm text-foreground">{onde.vaAte}</span>');
    expect(meta).not.toContain("title={onde.vaAte}");
  });
});

describe("as telas usam o mapa (contrato do código)", () => {
  it("o quadro do custo na pasta troca a lista de frases por frase mais Vá até e botão", () => {
    const fonte = ler("src/components/produtos/custo-da-peca.tsx");
    expect(fonte).toContain('data-testid="o-que-falta-para-o-custo-fechar"');
    expect(fonte).toContain("ondeCorrigirFalta(i.chave");
    expect(fonte).toContain("<OndeCorrigir");
    expect(fonte).toContain("aoIrParaCampo={p.aoIrParaCampo}");
    expect(fonte).not.toContain("<li key={f}>{f}</li>");
    expect(fonte).toContain("id={CAMPO_DO_QUADRO_DO_CUSTO}");
  });

  it("o quadro fica logo abaixo dos números do custo, antes da lista de matéria-prima", () => {
    const fonte = ler("src/components/produtos/custo-da-peca.tsx");
    expect(fonte.indexOf('data-testid="o-que-falta-para-o-custo-fechar"')).toBeGreaterThan(fonte.indexOf("Este produto ainda não tem o custo calculado."));
    expect(fonte.indexOf('data-testid="o-que-falta-para-o-custo-fechar"')).toBeLessThan(fonte.indexOf('<h3 className="text-sm font-semibold">Matéria-prima</h3>'));
  });

  it("a pasta liga o botão à troca de aba, rola, destaca e põe id nos três campos que não tinham", () => {
    expect(PASTA).toContain("aoIrParaCampo={irParaCampo}");
    expect(PASTA).toContain("const irParaCampo = (destino: AbaDaPasta, campo: string) => {");
    expect(PASTA).toContain('el.classList.add("destaque-da-correcao")');
    expect(PASTA).toContain('id="pasta-materiais" tabIndex={-1}');
    expect(PASTA).toContain('id="pasta-tempo"');
    expect(PASTA).toContain('id="pasta-custo-medio"');
    expect(PASTA).toContain('id="pasta-maquina"');
    expect(ler("src/styles.css")).toContain(".destaque-da-correcao {");
  });

  it("o destaque não depende de movimento: é contorno, sem animação", () => {
    const css = ler("src/styles.css");
    const bloco = css.slice(css.indexOf(".destaque-da-correcao {"));
    expect(bloco.slice(0, bloco.indexOf("}"))).not.toMatch(/animation|transition/);
  });

  it("a ficha da Tabela de preços, o painel de avisos e os acabamentos também dizem onde corrigir", () => {
    const ficha = ler("src/components/precos/ficha-do-produto.tsx");
    expect(ficha).toContain("ficha.itens.map");
    expect(ficha).toContain("<OndeCorrigir");
    expect(ficha).not.toMatch(/ficha\.faltas\.map\(\(f\) => \(\s*<li key=\{f\}>\{f\}<\/li>/);

    const painel = ler("src/components/precos/painel-de-precos.tsx");
    expect(painel).toContain("ondeCorrigirAviso(a.codigo)");
    expect(painel).toContain("<ListaDeAvisos avisos={avisos} produtoId={linha.id} />");
    // Preços por produto não tem letra menor que 16 px.
    expect(painel).toContain("<OndeCorrigir onde={onde} produtoId={produtoId} letraGrande />");

    const acabamentos = ler("src/components/acabamentos/gerenciador-de-acabamentos.tsx");
    expect(acabamentos).toContain("ondeCorrigirFaltaDoAcabamento(f)");
    expect(acabamentos).not.toContain('c.faltas.join(" · ")');
  });

  it("o botão quebra a linha e cresce em vez de vazar do quadro no celular (visto em 21/11/2026)", () => {
    const fonte = ler("src/components/produtos/onde-corrigir.tsx");
    const classe = fonte.match(/const CLASSE_DO_BOTAO = "([^"]+)"/)?.[1] ?? "";
    // O botão do projeto nasce com whitespace-nowrap e altura fixa; sem estes três, o texto longo passa da borda.
    for (const util of ["whitespace-normal", "h-auto", "max-w-full", "min-h-11"]) expect(classe, util).toContain(util);
    expect(classe).not.toContain("whitespace-nowrap");
  });

  it("o componente deixa o botão para o link quando não está dentro da pasta, e some sem id de produto", () => {
    const fonte = ler("src/components/produtos/onde-corrigir.tsx");
    expect(fonte).toContain('data-testid="onde-corrigir"');
    expect(fonte).toContain("if (aoIrParaCampo) {");
    expect(fonte).toContain("if (!produtoId) return null;");
    expect(fonte).toContain('if (alvo.tipo === "aqui") return null;');
    expect(fonte).toContain('<Link to="/produtos/$id" params={{ id: produtoId }} search={{ aba: alvo.aba, campo: alvo.campo }}>');
    expect(fonte).toContain('<Link to="/planilha-custos" search={{ aba: alvo.aba }}>');
  });
});
