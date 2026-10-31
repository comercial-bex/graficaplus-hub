import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fluxo, fluxoParaEscolher, faltaEmPalavras, itensDaRecusa, traduzirBloqueios } from "../src/domain/os/etapas";

/**
 * O quadro destrava sem burocracia (31/10/2026).
 *
 * O dono pediu para testar o quadro "de verdade". O teste (ensaio desfeito, como Leonardo,
 * Jhesselem e Cibele) achou que 17 das 18 OS abertas não entravam na Fila de produção, e quatro
 * defeitos: "Arte aprovada" era status e a trava lia o aceite; só designer, gestor e admin subiam
 * arquivo e a ficha oferecia o botão a todos; o aceite exigia um arquivo da OS (a 163, a 166 e a
 * 169 têm zero); e o status legado `producao` passava sem nenhuma trava.
 */

const SQL = readFileSync("supabase/migrations/20261031210000_quadro_destrava_sem_burocracia.sql", "utf8");
const FICHA = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");
const ACEITE = readFileSync("src/components/kanban/aceite-da-arte-rapido.tsx", "utf8");
const FINAL = readFileSync("src/components/kanban/marcar-como-final.tsx", "utf8");
const QUADRO = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");
const CARTAO = readFileSync("src/components/kanban/cartao-os.tsx", "utf8");
const TRILHA = readFileSync("src/components/kanban/trilha-da-os.tsx", "utf8");

describe("a migração: quem produz e quem vende anexa e marca o arquivo final", () => {
  it("operador ganha anexar e marcar final; vendedor ganha também ler (sem ler, o INSERT ... RETURNING do anexo é barrado)", () => {
    for (const par of [
      "('operador', 'arquivos.upload')",
      "('operador', 'arquivos.finalize')",
      "('vendedor', 'arquivos.read')",
      "('vendedor', 'arquivos.upload')",
      "('vendedor', 'arquivos.finalize')",
    ]) {
      expect(SQL, par).toContain(par);
    }
  });

  it("é idempotente: pula a linha que já existe", () => {
    expect(SQL).toContain("WHERE NOT EXISTS (");
    expect(SQL).toContain("p.perfil = x.perfil AND p.permissao = x.permissao");
  });

  it("não dá a quem não é da produção nem da venda: financeiro e instalador ficam como estão", () => {
    expect(SQL).not.toContain("('financeiro'");
    expect(SQL).not.toContain("('instalador'");
  });
});

describe("a migração: o aceite da arte num gesto, com ou sem arquivo", () => {
  it("exige os.update, valida o canal e recusa OS encerrada", () => {
    expect(SQL).toContain("public.require_permission('os.update')");
    expect(SQL).toContain("p_canal NOT IN ('sistema', 'whatsapp', 'email', 'presencial', 'telefone')");
    expect(SQL).toContain("v_os.status IN ('concluido', 'faturado', 'cancelado')");
  });

  it("é SECURITY DEFINER com search_path, fechada ao público e ao anônimo, aberta a quem está logado", () => {
    expect(SQL).toContain("SECURITY DEFINER");
    expect(SQL).toContain("SET search_path TO 'public'");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) FROM PUBLIC;");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) FROM anon;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.registrar_aceite_da_arte(uuid, text, text) TO authenticated;");
  });

  it("é idempotente: OS que já tem o aceite devolve sem gravar de novo", () => {
    expect(SQL).toContain("IF public.arte_aprovada_da_os(p_os_id) THEN");
    expect(SQL).toContain("'ja_aceita', true");
  });

  it("não precisa de arquivo na OS: o arquivo é opcional e o aceite grava com arquivo_id nulo", () => {
    expect(SQL).toContain("v_arquivo uuid;");
    expect(SQL).toContain("VALUES ('arte'::tipo_aprovacao, p_os_id, v_arquivo, true");
    expect(SQL).toContain("IF v_arquivo IS NOT NULL THEN");
    // o histórico da peça só existe quando há peça
    expect(SQL.indexOf("INSERT INTO public.arquivo_aprovacoes")).toBeGreaterThan(SQL.indexOf("IF v_arquivo IS NOT NULL THEN"));
  });

  it("só avança a OS que ainda está antes de Arte aprovada; nunca recua nem salta quem está adiante", () => {
    expect(SQL).toContain(
      "IF v_os.status IN ('entrada', 'aguardando_briefing', 'briefing_ok', 'design', 'aguardando_aprovacao_arte', 'arte_rejeitada') THEN",
    );
    expect(SQL).toContain("set_config('app.avancar_os_status', 'on', true)");
    expect(SQL).toContain("set_config('app.avancar_os_status', '', true)");
  });
});

describe("a migração: o status legado 'Produção' passa a ter as mesmas travas", () => {
  it("troca na definição viva, com a âncora contada, e para se a função mudou", () => {
    expect(SQL).toContain("pg_get_functiondef('public.status_os_exige_validacoes_producao(public.status_os)'::regprocedure)");
    expect(SQL).toContain("IF v_vezes <> 1 THEN");
    expect(SQL).toContain("a função mudou e nada foi alterado");
  });

  it("é idempotente e põe 'producao' ao lado de 'em_producao'", () => {
    expect(SQL).toContain("IF position(v_novo IN v_def) > 0 THEN");
    expect(SQL).toContain("$b$'aguardando_producao','producao','em_producao',$b$");
  });
});

describe("a migração: o que ela NÃO faz", () => {
  it("não apaga nada, não derruba nada, não inventa aceite e não mexe em OS existente", () => {
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION|POLICY|TRIGGER)\b/i);
    expect(SQL).not.toMatch(/INSERT INTO public\.aprovacoes[^;]*SELECT/is);
    // a única troca de status está dentro da função, quando alguém registra o aceite
    expect((SQL.match(/UPDATE public\.ordens_servico/g) ?? []).length).toBe(1);
  });

  it("não tem BEGIN/COMMIT (o Supabase já roda cada arquivo numa transação) nem data sem fuso", () => {
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT);/im);
    expect(SQL).not.toMatch(/current_date|created_at::date|now\(\)::date/i);
  });
});

describe("o seletor de etapa da ficha", () => {
  const status = (g: ReturnType<typeof fluxo>) => g.flatMap((x) => x.status.map((s) => s.status));

  it("não oferece o status legado 'Produção'; o fluxo inteiro (automações, TV) segue com ele", () => {
    expect(status(fluxo())).toContain("producao");
    expect(status(fluxoParaEscolher("entrada"))).not.toContain("producao");
    expect(status(fluxoParaEscolher(undefined))).not.toContain("producao");
  });

  it("a OS que já está nele o vê, para o seletor mostrar onde ela está", () => {
    expect(status(fluxoParaEscolher("producao"))).toContain("producao");
  });

  it("o resto das opções não muda", () => {
    expect(status(fluxoParaEscolher("entrada")).length).toBe(status(fluxo()).length - 1);
    expect(status(fluxoParaEscolher("entrada"))).toContain("em_producao");
  });

  it("a ficha usa a lista filtrada e troca o '!' sem explicação por duas ou três palavras", () => {
    expect(FICHA).toContain("fluxoParaEscolher(os.status)");
    expect(FICHA).not.toContain("fluxo().map");
    expect(FICHA).toContain("s.dica");
    expect(FICHA).not.toContain('text-[color:var(--bex-amber)]">!</span>');
    const dicas = fluxo().flatMap((g) => g.status).filter((s) => s.dica);
    expect(dicas.map((s) => s.status).sort()).toEqual(["em_producao", "em_uv"]);
  });
});

describe("o que falta, em palavras curtas", () => {
  it("diz tudo na mesma linha, sem repetir (margem e desconto são o mesmo aval)", () => {
    expect(
      faltaEmPalavras([
        { codigo: "sem_pagamento", titulo: "Nenhum pagamento registrado" },
        { codigo: "arte_nao_aprovada", titulo: "Arte ainda não aprovada" },
        { codigo: "sem_arquivo_final", titulo: "Sem arquivo final de produção" },
      ]),
    ).toBe("pagamento · aceite da arte · arquivo final");
    expect(
      faltaEmPalavras([
        { codigo: "margem_baixa", titulo: "Margem de 12% abaixo do mínimo de 20%" },
        { codigo: "desconto_alto", titulo: "Desconto de 15% acima do limite de 10%" },
      ]),
    ).toBe("aval do gestor");
  });

  it("trava que a lista não conhece aparece pelo título; lista vazia, texto vazio", () => {
    expect(faltaEmPalavras([{ codigo: "trava_nova", titulo: "Falta o carimbo" }])).toBe("Falta o carimbo");
    expect(faltaEmPalavras([])).toBe("");
  });
});

describe("a recusa do banco vira o que falta", () => {
  it("separa os motivos da mensagem de avancar_os_status", () => {
    expect(itensDaRecusa("A OS não pode avançar ainda: Arte ainda não aprovada; Sem arquivo final de produção.")).toEqual([
      "Arte ainda não aprovada",
      "Sem arquivo final de produção",
    ]);
    expect(itensDaRecusa("A OS não pode avançar ainda: Nenhum pagamento registrado.")).toEqual(["Nenhum pagamento registrado"]);
  });

  it("outra mensagem fica como está (null), para quem chama cair no texto original", () => {
    expect(itensDaRecusa("Você não tem permissão para realizar esta ação.")).toBeNull();
    expect(itensDaRecusa("A OS nº 44 já foi concluída e não volta pelo quadro.")).toBeNull();
  });

  it("a recusa de FECHAR continua com a tradução própria", () => {
    expect(itensDaRecusa("A OS não pode fechar ainda: pagamentos_pendentes.")).toBeNull();
    expect(traduzirBloqueios("A OS não pode fechar ainda: pagamentos_pendentes.")).toBe("Pagamentos pendentes");
  });

  it("o quadro mostra o que falta e abre a ficha, onde cada pendência tem o seu botão", () => {
    expect(QUADRO).toContain("itensDaRecusa(bruto)");
    expect(QUADRO).toContain("A OS ainda não vai para ${rotuloDe(novoStatus)}");
    expect(QUADRO).toContain('label: "Ver o que falta", onClick: () => setFichaId(osId)');
  });
});

describe("a ficha só oferece o que a pessoa pode fazer", () => {
  it("o quadro passa as três permissões e a ficha recebe como props", () => {
    expect(QUADRO).toContain('podeAnexar={hasPermission("arquivos.upload")}');
    expect(QUADRO).toContain('podeFinalizar={hasPermission("arquivos.finalize")}');
    expect(QUADRO).toContain('podeAceitar={hasPermission("os.update")}');
    expect(FICHA).toContain("podeAnexar = false");
    expect(FICHA).toContain("podeFinalizar = false");
    expect(FICHA).toContain("podeAceitar = false");
  });

  it("anexar só aparece para quem pode; quem não pode lê a quem pedir", () => {
    expect(FICHA).toContain("{podeAnexar && <AnexarArquivoRapido");
    expect(FICHA).toContain("Peça a quem pode anexar o arquivo da arte.");
    expect(FICHA).toContain("Peça a quem pode registrar o aceite da arte.");
    expect(FICHA).toContain("Peça a quem pode marcar o arquivo como final.");
  });
});

describe("a ficha enxuta: o que falta, com o botão que resolve", () => {
  it("cada pendência traz a sua ação: aceite, marcar como final, ir para a OS", () => {
    expect(FICHA).toContain("<AceiteDaArteRapido");
    expect(FICHA).toContain("<MarcarComoFinal");
    expect(FICHA).toContain('rotulo="Registrar na OS"');
    expect(FICHA).toContain('rotulo="Definir na OS"');
    expect(FICHA).toContain("Ver estoque");
  });

  it("o que já está certo vira uma linha só, e o resumo continua dizendo quanto falta", () => {
    expect(FICHA).toContain("certas.map((c) => c.rotulo).join(\" · \")");
    expect(FICHA).toContain("Para produzir · falta ${pendentes} de ${condicoes.length}");
    expect(FICHA).toContain("Para produzir · tudo certo");
  });

  it("sai a frase técnica e as três linhas 'não definido'; entra 'Ainda sem …'", () => {
    expect(FICHA).not.toContain("As mesmas regras que o banco aplica");
    expect(FICHA).not.toContain('"não definido"');
    expect(FICHA).not.toContain("Linha rotulo=");
    expect(FICHA).toContain("Ainda sem {emFrase(semDefinir)}");
  });

  it("tudo certo e antes da fila: um toque envia para a fila de produção", () => {
    expect(FICHA).toContain('(etapaAtual === "entrada" || etapaAtual === "pre_impressao")');
    expect(FICHA).toContain('onMudarStatus(os.id, "aguardando_producao")');
    expect(FICHA).toContain("Enviar para a fila de produção");
  });

  it("escolher 'Arte aprovada' sem o aceite abre o registro do aceite, em vez de mudar só o status", () => {
    expect(FICHA).toContain('novo === "arte_aprovada" && falta.has("arte_nao_aprovada") && podeAceitar');
    expect(FICHA).toContain("setAceiteAberto(true)");
    expect(FICHA).toContain("Para marcar “Arte aprovada”, registre o aceite do cliente.");
  });

  it("não duplica o botão de anexar: sem arquivo, a pendência aponta para o da área da arte", () => {
    expect(FICHA).toContain("Use o botão “Anexar arquivo” na área da arte.");
  });
});

describe("o registro do aceite e o marcar como final", () => {
  it("o aceite chama a função nova, sem exigir arquivo, e confere a resposta", () => {
    expect(ACEITE).toContain('"registrar_aceite_da_arte"');
    expect(ACEITE).toContain("p_canal: canal");
    expect(ACEITE).not.toContain("p_arquivo_id");
    expect(ACEITE).toContain("resposta?.ja_aceita");
    for (const c of ["whatsapp", "telefone", "presencial", "email"]) expect(ACEITE).toContain(`valor: "${c}"`);
  });

  it("o aceite atualiza o quadro, as travas e a tela da OS", () => {
    for (const chave of ['["kanban-os"]', '["kanban-bloqueios"]', '["os", osId]']) {
      expect(ACEITE).toContain(chave);
    }
  });

  it("marcar como final confere que gravou (a política barra em silêncio com 0 linhas)", () => {
    expect(FINAL).toContain('.update({ final_producao: true })');
    expect(FINAL).toContain("data.length === 0");
    expect(FINAL).toContain("Seu perfil não pode marcar o arquivo como final. Peça a quem pode.");
  });
});

describe("o cartão enxuto", () => {
  it("diz a pendência inteira numa linha, em palavras curtas, e guarda o texto completo para o leitor de tela", () => {
    expect(CARTAO).toContain("faltaEmPalavras(bloqueios)");
    expect(CARTAO).toContain('bloqueios.map((b) => b.titulo).join(", ")');
  });

  it("não avisa 'sem designer nem operador' em todo cartão e não mostra 'aberta por' em OS que nunca andou", () => {
    expect(CARTAO).not.toContain("sem designer nem operador");
    expect(CARTAO).toContain('os.ultimo_movimento.verbo !== "aberta"');
  });

  it("'parada há' só de um dia para cima", () => {
    expect(CARTAO).toContain("/d$/.test(paradaTotal)");
  });

  it("a trilha compacta não repete o nome da etapa nem o passo 'Entrada'", () => {
    expect(TRILHA).toContain('status !== "entrada"');
    expect(TRILHA).not.toContain("{foraDoFluxo ? detalhe : nomeAtual}");
  });

  it("o cabeçalho do quadro fala em ação, não em estrutura", () => {
    expect(QUADRO).toContain("Arraste o cartão para mudar de etapa. Clique nele para ver o que falta e o que fazer.");
    expect(QUADRO).not.toContain("Kanban: uma coluna por etapa");
  });
});
