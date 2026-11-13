import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { oQueDaPraFazer } from "@/domain/whatsapp/acoes-de-trabalho";
import { DICAS_WA_GAVETA } from "@/lib/dicas";

/**
 * A gaveta "Dados do contato" e os diálogos de trabalho (onda 1, 12/11/2026).
 * Lê os arquivos como texto: os testes rodam em node, sem jsdom.
 */
const ler = (f: string) => readFileSync(`src/components/whatsapp/${f}`, "utf8");
const PAINEL = ler("painel-da-conversa.tsx");
const GAVETA = ler("gaveta-do-contato.tsx");
const DIALOGOS = ler("dialogos-da-conversa.tsx");
const ATEND = ler("atendimentos-da-conversa.tsx");
const CRIAR = ler("criar-a-partir-da-conversa.tsx");
const VINCULAR = ler("vincular-cliente.tsx");
const TODOS = { PAINEL, GAVETA, DIALOGOS, ATEND, CRIAR, VINCULAR };

/** Tira os comentários de código: neles o travessão pode (regra do dono vale para texto visível). */
function semComentarios(f: string): string {
  return f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
}

/** As aberturas de <Button ...> e <Input ...>, lendo até o `>` fora de chaves e de aspas (o `=>` não fecha). */
function aberturasDe(fonte: string): string[] {
  const saida: string[] = [];
  const re = /<(Button|Input)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte))) {
    let fundo = 0;
    let aspas: string | null = null;
    let j = m.index + m[0].length;
    for (; j < fonte.length; j++) {
      const c = fonte[j];
      if (aspas) {
        if (c === aspas) aspas = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") aspas = c;
      else if (c === "{") fundo++;
      else if (c === "}") fundo--;
      else if (c === ">" && fundo === 0) break;
    }
    saida.push(fonte.slice(m.index, j + 1));
  }
  return saida;
}

describe("seções na ordem do uso (a1 8.6)", () => {
  it("contato, trabalho, atendimentos, etiquetas e histórico, nesta ordem", () => {
    const pos = [
      PAINEL.indexOf('aria-labelledby="gaveta-contato"'),
      PAINEL.indexOf('aria-labelledby="gaveta-trabalho"'),
      PAINEL.indexOf("<AtendimentosDaConversa"),
      PAINEL.indexOf("<Etiquetas conversa"),
      PAINEL.indexOf('aria-labelledby="gaveta-historico"'),
    ];
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it("os orçamentos e OS ligados continuam, na seção de trabalho, sem mudar o componente", () => {
    expect(PAINEL).toContain("<VinculosDaConversa conversa={conversa} podeEditar={podeResponder} />");
    expect(PAINEL.indexOf("<VinculosDaConversa")).toBeGreaterThan(PAINEL.indexOf("gaveta-trabalho"));
    expect(PAINEL.indexOf("<VinculosDaConversa")).toBeLessThan(PAINEL.indexOf("<AtendimentosDaConversa"));
  });

  it("histórico do cliente e atendimentos anteriores ficam recolhidos", () => {
    expect(PAINEL).toContain("<details>");
    expect(ATEND).toContain("<details");
    expect(ATEND).toContain("Atendimentos anteriores");
  });

  it("títulos de seção sem caixa-alta espaçada", () => {
    for (const [nome, f] of Object.entries(TODOS)) {
      expect(f, nome).not.toMatch(/uppercase|tracking-wider/);
    }
  });
});

describe("alvos de 44 px", () => {
  it("todo botão e campo da gaveta tem h-11 ou size-11", () => {
    // Cada <Button ...> e <Input ...> do painel declara a altura de 44 px.
    for (const f of [PAINEL, VINCULAR, CRIAR]) {
      const aberturas = aberturasDe(f);
      for (const a of aberturas) {
        // Aceita as que passam por `className` em várias linhas.
        expect(a, a.slice(0, 80)).toMatch(/h-11|size-11/);
      }
    }
    expect(GAVETA).toContain("size-11");
  });

  it("o botão de remover etiqueta tem 44 px e nome", () => {
    expect(PAINEL).toContain("inline-flex size-11 items-center justify-center rounded-full");
    expect(PAINEL).toContain("aria-label={`Tirar a etiqueta ${e}`}");
  });

  it("links da gaveta têm 44 px de altura", () => {
    expect(PAINEL).toContain("min-h-11");
    expect(PAINEL).not.toMatch(/<Link[^>]*className="[^"]*text-link underline underline-offset-2"/);
  });
});

describe("sem travessão, seta, title nem fonte de máquina", () => {
  it("nenhuma frase visível tem — – → ← ⇒ (comentário de código pode)", () => {
    for (const [nome, f] of Object.entries(TODOS)) {
      expect(semComentarios(f), nome).not.toMatch(/[—–→←⇒]/);
    }
    for (const t of Object.values(DICAS_WA_GAVETA)) expect(t).not.toMatch(/[—–→←⇒]/);
  });

  it("nenhum title= e o número do atendimento em fonte normal", () => {
    for (const [nome, f] of Object.entries(TODOS)) expect(f, nome).not.toMatch(/\btitle=/);
    expect(ATEND).not.toContain("font-mono");
  });

  it("nada abaixo de 13 px nas frases novas (text-xs só em rótulo curto)", () => {
    for (const f of Object.values(TODOS)) expect(f).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
  });
});

describe("a regra de quem pode (oQueDaPraFazer)", () => {
  const base = { podeResponder: true, podeOrcar: true, podeAbrirOs: true, clienteId: "c1" };

  it("quem pode tudo, com cliente, abre os três", () => {
    const r = oQueDaPraFazer(base);
    expect(r.orcamento.pode && r.os.pode && r.vincular_cliente.pode).toBe(true);
  });

  it("sem cliente a OS não abre, e diz o caminho (vincular ou orçamento)", () => {
    const r = oQueDaPraFazer({ ...base, clienteId: null });
    expect(r.os.pode).toBe(false);
    if (!r.os.pode) expect(r.os.motivo).toMatch(/cliente cadastrado/);
  });

  it("sem os.create o motivo manda para o orçamento", () => {
    const r = oQueDaPraFazer({ ...base, podeAbrirOs: false });
    expect(!r.os.pode && r.os.motivo).toMatch(/orçamento/);
  });

  it("sem permissão nada some: cada item volta com motivo", () => {
    const r = oQueDaPraFazer({ podeResponder: false, podeOrcar: false, podeAbrirOs: false, clienteId: null });
    for (const d of Object.values(r)) {
      expect(d.pode).toBe(false);
      if (!d.pode) expect(d.motivo.length).toBeGreaterThan(10);
    }
  });

  it("o botão desabilitado mostra o motivo à vista, não em title", () => {
    expect(PAINEL).toContain("{d.motivo}");
    expect(PAINEL).toContain("disabled>");
  });
});

describe("os três diálogos são controlados", () => {
  it("aceitam aberto e onAberto e só desenham o botão próprio quando não controlados", () => {
    for (const [nome, f] of [["criar", CRIAR], ["vincular", VINCULAR]] as const) {
      expect(f, nome).toContain("onAberto?: (aberto: boolean) => void;");
      expect(f, nome).toContain("abertoPeloPai !== undefined");
      expect(f, nome).toContain("{!controlado && (");
    }
    // Orçamento e OS, os dois, no mesmo arquivo.
    expect(CRIAR.match(/aberto\?: boolean;/g)?.length).toBe(2);
  });

  it("a moldura desenha os três uma vez, ligados ao `qual`", () => {
    expect(DIALOGOS).toContain('aberto={qual === "orcamento"}');
    expect(DIALOGOS).toContain('aberto={qual === "os"}');
    expect(DIALOGOS).toContain('aberto={qual === "vincular_cliente"}');
    expect(DIALOGOS).toContain("useMensagens(conversa.id)");
    expect(DIALOGOS).toContain("onQual(null)");
  });

  it("só desenha o diálogo de quem pode (segunda porta da permissão)", () => {
    expect(DIALOGOS).toContain("pode.orcamento.pode &&");
    expect(DIALOGOS).toContain("pode.os.pode && conversa.cliente_id &&");
    expect(DIALOGOS).toContain("pode.vincular_cliente.pode &&");
  });

  it("o formulário é preenchido na abertura, nos dois modos", () => {
    expect(CRIAR.match(/if \(!aberto\) return;/g)?.length).toBe(2);
    expect(CRIAR).toContain("}, [aberto]);");
  });

  it("a gaveta chama onAbrirDialogo nos dois formatos (aside e Sheet)", () => {
    expect(GAVETA.match(/onAbrirDialogo=\{onAbrirDialogo\}/g)?.length).toBe(2);
    expect(PAINEL).toContain('abrir("orcamento")');
    expect(PAINEL).toContain('abrir("os")');
    expect(PAINEL).toContain('abrir("vincular_cliente")');
  });

  it("a hora do rascunho sai no fuso de Belém", () => {
    expect(CRIAR).toContain('timeZone: "America/Belem"');
  });
});

describe("revisão da onda 1 (12/11/2026): alvos de 44 px e ajuda na mídia", () => {
  const ler = (c: string) => readFileSync(c, "utf8");

  it("a gaveta e os diálogos da caixa trazem o x de fechar de 44 px", () => {
    expect(ler("src/components/whatsapp/fechar-de-44-px.ts")).toContain('"[&>button.absolute]:size-11"');
    for (const f of [
      "gaveta-do-contato",
      "acoes-da-conversa",
      "criar-a-partir-da-conversa",
      "vincular-cliente",
      "nova-conversa",
    ]) {
      expect(ler(`src/components/whatsapp/${f}.tsx`), f).toContain("FECHAR_DE_44_PX");
    }
  });

  it("o ? das seções da gaveta tem 44 px e não usa mais o DicaIcone de 16 px", () => {
    expect(ler("src/components/whatsapp/ajuda-da-secao.tsx")).toContain("size-11");
    for (const f of ["painel-da-conversa", "atendimentos-da-conversa"]) {
      const fonte = ler(`src/components/whatsapp/${f}.tsx`);
      expect(fonte, f).toContain("<AjudaDaSecao");
      expect(fonte, f).not.toContain("<DicaIcone");
    }
  });

  it("a mídia tem Dica (velocidade, posição, abrir, baixar), com o texto em dicas.ts", () => {
    const dicas = ler("src/lib/dicas.ts");
    for (const chave of ["velocidade", "posicao", "abrir", "baixar"]) expect(dicas).toContain(`  ${chave}: `);
    for (const f of ["capa-do-documento", "tocador-de-voz", "midia-da-mensagem"]) {
      expect(ler(`src/components/whatsapp/${f}.tsx`), f).toContain("DICAS_WA_MIDIA");
    }
  });

  it("a foto na bolha tem caixa fixa (não troca de razão ao carregar) e o documento reserva a altura do cartão", () => {
    const fonte = ler("src/components/whatsapp/midia-da-mensagem.tsx");
    expect(fonte).toContain('const LADO_DA_FOTO = "size-64"');
    expect(fonte).not.toContain("setMedida");
    expect(fonte).not.toContain("aspectRatio");
    expect(fonte).toContain('ALTURA_DO_CARTAO_DE_DOCUMENTO = "h-[306px] w-72"');
  });
});
