import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lerPainel, type PainelDaOficina } from "../src/domain/tv/painel";
import {
  desvioDoRelogio,
  grauPelaIdade,
  idadeEmSegundos,
  seloDeIdade,
  seloDeRetrato,
} from "../src/domain/tv/frescor";
import {
  esperaAteAProximaBuscaMs,
  interpretarResposta,
  valeTentarDeNovo,
} from "../src/domain/tv/busca";
import { montarTela } from "../src/domain/tv/tela";
import { EXEMPLO_CHEIO, EXEMPLO_HOJE, modoDeExemplo } from "../src/domain/tv/exemplo";

/**
 * A TELA DA TV DA OFICINA — o que ela mostra tem de ser o que o banco disse.
 *
 * A TV2 da agência já teve cinco defeitos que este arquivo existe para não
 * repetir na parede da gráfica: cartão com número diferente da lista; "AO VIVO"
 * pulsando com dado de horas atrás; falha de consulta virando zero (zero na
 * parede parece dia tranquilo); status faltando no conjunto "aberto"; corte de
 * 1000 linhas. Os três primeiros são da tela, e é deles que estes testes cuidam.
 *
 * Os painéis de teste são RETORNOS REAIS de `tv_painel_maquinas()`: o do dia 1
 * (02/10/2026, as 5 máquinas sem registro), o retrato de 01/10 e um ensaio
 * com uma OS em cada estado — todos lidos como service_role num ensaio que
 * terminou em RAISE EXCEPTION.
 */

function fixture(nome: string): unknown {
  return JSON.parse(readFileSync(join("tests/fixtures", nome), "utf8")).painel;
}

const REAIS = ["tv-painel-vivo-02-10.json", "tv-painel-hoje.json", "tv-painel-ensaio-cheio.json"];

function lido(nome: string): PainelDaOficina {
  const l = lerPainel(fixture(nome));
  if (!l.ok) throw new Error(`${nome}: ${l.motivo}`);
  return l.painel;
}

describe("o contrato com a função do banco", () => {
  it.each(REAIS)("o retorno real %s é aceito", (nome) => {
    const l = lerPainel(fixture(nome));
    expect(l.ok, l.ok ? "" : l.motivo).toBe(true);
  });

  it("chave faltando reprova com o caminho dela — nunca vira tela vazia", () => {
    const cru = structuredClone(fixture("tv-painel-ensaio-cheio.json")) as any;
    delete cru.cartoes.atrasadas.total;
    const l = lerPainel(cru);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.motivo).toContain("cartoes.atrasadas");
  });

  it("estado de máquina que a tela não conhece reprova, em vez de sumir com a coluna", () => {
    const cru = structuredClone(fixture("tv-painel-vivo-02-10.json")) as any;
    cru.maquinas[0].estado = "manutencao_nova";
    expect(lerPainel(cru).ok).toBe(false);
  });

  it("outra versão do contrato reprova dizendo qual veio", () => {
    const cru = structuredClone(fixture("tv-painel-vivo-02-10.json")) as any;
    cru.versao = 3;
    const l = lerPainel(cru);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.motivo).toContain("3");
  });

  it("os exemplos embutidos também passam no contrato (não há uma tela só para eles)", () => {
    expect(lerPainel(JSON.parse(JSON.stringify(EXEMPLO_CHEIO))).ok).toBe(true);
    expect(lerPainel(JSON.parse(JSON.stringify(EXEMPLO_HOJE))).ok).toBe(true);
  });
});

describe("o número do cartão é o número do banco", () => {
  it.each(REAIS)("%s: os três cartões grandes repetem os totais da função", (nome) => {
    const p = lido(nome);
    const tela = montarTela(p, Date.parse(p.gerado_em));
    const porChave = Object.fromEntries(tela.cartoes.map((c) => [c.k, c.total]));
    expect(porChave).toEqual({
      atr: p.cartoes.atrasadas.total,
      hoje: p.cartoes.prazo_hoje.total,
      amanha: p.cartoes.prazo_amanha.total,
    });
  });

  it("as cinco colunas saem na ordem da oficina, uma por máquina", () => {
    for (const nome of REAIS) {
      const p = lido(nome);
      const tela = montarTela(p, Date.parse(p.gerado_em));
      expect(tela.colunas.map((c) => c.id)).toEqual(
        [...p.maquinas].sort((a, b) => a.ordem - b.ordem).map((m) => m.id),
      );
    }
  });

  it("dia 1 de verdade: as 5 em SEM REGISTRO, e a tela não finge que há alguém rodando", () => {
    const p = lido("tv-painel-vivo-02-10.json");
    const tela = montarTela(p, Date.parse(p.gerado_em));
    expect(tela.colunas.map((c) => c.estado)).toEqual(Array(5).fill("sem_registro"));
    // Sem nenhum registro hoje o chip não diz "0/5 RODANDO": não se sabe.
    expect(tela.chips[0].texto).toBe("— RODANDO");
    expect(tela.cartoes.find((c) => c.k === "atr")?.total).toBe(1);
  });
});

describe("o selo de idade nunca diz AO VIVO sem prova", () => {
  const base = { intervaloS: 60, dentroDoExpediente: true } as const;

  it("busca que falhou nunca é AO VIVO, por mais novo que seja o último dado", () => {
    const s = seloDeIdade({ ...base, idadeS: 5, falha: "rede" });
    expect(s.tipo).toBe("sem_conexao");
    expect(s.pulsa).toBe(false);
    expect(s.velho).toBe(true);
  });

  it("dado que não passou no contrato é DADO INVÁLIDO, não tela tranquila", () => {
    expect(seloDeIdade({ ...base, idadeS: 5, falha: "contrato" }).tipo).toBe("dado_invalido");
  });

  it("os limites seguem o intervalo do servidor: 2,5x atrasado, 5x parado", () => {
    expect(grauPelaIdade(150, 60)).toBe("vivo");
    expect(grauPelaIdade(151, 60)).toBe("atrasado");
    expect(grauPelaIdade(300, 60)).toBe("atrasado");
    expect(grauPelaIdade(301, 60)).toBe("parado");
    // Se o servidor um dia mandar 5 min, 7 min de idade ainda é vivo — e o
    // selo não grita PARADO toda noite.
    expect(grauPelaIdade(420, 300)).toBe("vivo");
  });

  it("PARADO apaga o brilho; só o AO VIVO pulsa", () => {
    const parado = seloDeIdade({ ...base, idadeS: 999, falha: null });
    expect(parado.tipo).toBe("parado");
    expect(parado.velho).toBe(true);
    expect(parado.pulsa).toBe(false);
    const vivo = seloDeIdade({ ...base, idadeS: 10, falha: null });
    expect(vivo).toMatchObject({ tipo: "vivo", texto: "AO VIVO", pulsa: true });
  });

  it("o modo de exemplo nunca escreve AO VIVO puro", () => {
    expect(seloDeIdade({ ...base, idadeS: 10, falha: null, simulado: true }).texto).toBe(
      "AO VIVO SIMULADO",
    );
    expect(seloDeRetrato("01/10 19:54").tipo).toBe("retrato");
  });

  it("fora do expediente não pulsa e diz de quando é o dado", () => {
    const s = seloDeIdade({
      intervaloS: 60,
      dentroDoExpediente: false,
      idadeS: 10,
      falha: null,
      horaDoDado: "18:40",
    });
    expect(s.tipo).toBe("fora_do_expediente");
    expect(s.texto).toContain("18:40");
    expect(s.pulsa).toBe(false);
  });

  it("resposta repetida (gerado_em parado) não rejuvenesce o dado", () => {
    const primeira = desvioDoRelogio(null, 1_000_000, 1_000_500);
    const repetida = desvioDoRelogio(primeira, 1_000_000, 1_090_000);
    expect(repetida).toBe(primeira);
    expect(idadeEmSegundos(1_090_000, repetida.desvioMs, repetida.geradoEmMs)).toBeGreaterThan(80);
  });

  it("relógio da TV adiantado não deixa a idade negativa nem zerada à toa", () => {
    // TV 10 min adiantada: o desvio corrige pelo carimbo do servidor.
    const d = desvioDoRelogio(null, 5_000_000, 5_600_000);
    expect(idadeEmSegundos(5_630_000, d.desvioMs, d.geradoEmMs)).toBeCloseTo(30, 0);
  });
});

describe("o que a TV faz com cada resposta do servidor", () => {
  it("401 revogada volta ao PIN dizendo o motivo", () => {
    expect(interpretarResposta(401, { erro: "tv_revogada" })).toEqual({
      tipo: "recusada",
      motivo: "tv_revogada",
    });
    expect(interpretarResposta(401, {})).toEqual({ tipo: "recusada", motivo: "tv_nao_pareada" });
  });

  it("503 mantém o crachá e tenta de novo em 5 s e 15 s; depois volta ao ritmo normal", () => {
    expect(interpretarResposta(503, { erro: "banco_indisponivel" }).tipo).toBe("servidor");
    expect(valeTentarDeNovo("servidor", 0)).toBe(true);
    expect(valeTentarDeNovo("servidor", 2)).toBe(false);
    expect(esperaAteAProximaBuscaMs(1, 60)).toBe(5_000);
    expect(esperaAteAProximaBuscaMs(2, 60)).toBe(15_000);
    expect(esperaAteAProximaBuscaMs(3, 60)).toBe(60_000);
  });

  it("200 com corpo fora do contrato é erro nomeado, nunca 'painel vazio'", () => {
    const r = interpretarResposta(200, { versao: 2 });
    expect(r.tipo).toBe("contrato");
    expect(valeTentarDeNovo("contrato", 0)).toBe(false);
  });

  it("modo de exemplo só aceita os dois nomes conhecidos", () => {
    expect(modoDeExemplo("cheio")).toBe("cheio");
    expect(modoDeExemplo("hoje")).toBe("hoje");
    expect(modoDeExemplo("qualquer")).toBeUndefined();
    expect(modoDeExemplo(undefined)).toBeUndefined();
  });
});

describe("a parede não mostra dinheiro, cliente nem texto digitado", () => {
  const ARQUIVOS = [
    "src/routes/tv.maquinas.tsx",
    ...readdirSync("src/components/tv").map((f) => `src/components/tv/${f}`),
    ...readdirSync("src/domain/tv").map((f) => `src/domain/tv/${f}`),
  ];

  it("nenhum valor em reais nos exemplos nem nas frases montadas", () => {
    const textoDosExemplos = JSON.stringify([EXEMPLO_CHEIO, EXEMPLO_HOJE]);
    expect(textoDosExemplos).not.toMatch(/R\$\s?\d|\d+,\d{2}\b/);
    for (const nome of REAIS) {
      const p = lido(nome);
      const tela = JSON.stringify(montarTela(p, Date.parse(p.gerado_em)));
      expect(tela, nome).not.toMatch(/R\$\s?\d|\d+,\d{2}\b/);
    }
  });

  it("a tela pública não importa o cliente do banco do navegador nem nada da área logada", () => {
    for (const arq of ARQUIVOS) {
      const fonte = readFileSync(arq, "utf8");
      expect(fonte, arq).not.toMatch(/from\s+["']@\/integrations\/supabase\/client["']/);
      expect(fonte, arq).not.toMatch(/routes\/_authenticated/);
    }
  });

  it("o crachá não vai para a URL nem para o console", () => {
    for (const arq of ARQUIVOS) {
      const fonte = readFileSync(arq, "utf8");
      expect(fonte, arq).not.toMatch(/console\.(log|info|debug)\([^)]*token/i);
      expect(fonte, arq).not.toMatch(/[?&]token=/);
    }
  });

  it("nenhum campo de dinheiro ou de cliente é lido do painel", () => {
    // Procura LEITURA de campo (`.margem`, `"preco"`), não a palavra solta: a
    // "margem" branca em volta do QR Code é zona de silêncio do desenho, não
    // dinheiro — uma trava que acusa o inocente ninguém mais respeita.
    for (const arq of ARQUIVOS.filter((a) => !a.endsWith(".css"))) {
      const fonte = readFileSync(arq, "utf8");
      expect(fonte, arq).not.toMatch(
        /[."'`](valor_total|custo\w*|preco\w*|margem\w*|cliente_nome|observacoes|descricao)\b/,
      );
    }
  });
});
