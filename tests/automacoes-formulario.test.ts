import { describe, expect, it } from "vitest";
import {
  FORM_VAZIO,
  lerAutomacao,
  resumoDaAutomacao,
  validarAutomacao,
  type FormAutomacao,
  type LinhaAutomacao,
} from "../src/domain/automacoes/formulario";
import { MODELOS } from "../src/domain/automacoes/modelos";
import { TELEFONE_DO_CLIENTE } from "../src/domain/automacoes/catalogo";
import {
  dadosDeExemplo,
  renderizarMensagem,
  variaveisUsadas,
} from "../src/domain/automacoes/mensagem";
import { CATALOGO } from "../src/domain/automacoes/catalogo";

const base: FormAutomacao = {
  ...FORM_VAZIO,
  nome: "OS atrasada — equipe",
  gatilho: "os_atrasada",
  destino: "fixo",
  telefone: "(96) 99111-6169",
  mensagem: "A OS {{os.numero}} atrasou.",
  intervaloSegundos: 86400,
};

describe("o que sai do formulário é o que o motor executa", () => {
  it("monta a linha com ação whatsapp e o telefone no formato do Z-API", () => {
    const r = validarAutomacao(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registro).toEqual({
      nome: "OS atrasada — equipe",
      descricao: null,
      gatilho: "os_atrasada",
      condicao: {},
      acao: "whatsapp",
      payload: { mensagem: "A OS {{os.numero}} atrasou.", telefone: "5596991116169" },
      cooldown_segundos: 86400,
      delay_segundos: 0,
      ativo: false,
    });
  });

  it("mudança de etapa grava a lista em `status`, a chave que automacao_condicao_ok lê", () => {
    const r = validarAutomacao({
      ...base,
      gatilho: "status_os_alterado",
      etapas: ["arte_rejeitada", "arte_aprovada"],
    });
    expect(r.ok && r.registro.condicao).toEqual({ status: ["arte_rejeitada", "arte_aprovada"] });
  });

  it("estoque: vazio usa o mínimo de cada material; número vira estoque_minimo", () => {
    const vazio = validarAutomacao({
      ...base,
      gatilho: "estoque_minimo",
      mensagem: "{{material.nome}} acabando",
    });
    expect(vazio.ok && vazio.registro.condicao).toEqual({});
    const comNumero = validarAutomacao({
      ...base,
      gatilho: "estoque_minimo",
      estoqueMinimo: "2,5",
      mensagem: "{{material.nome}} acabando",
    });
    expect(comNumero.ok && comNumero.registro.condicao).toEqual({ estoque_minimo: 2.5 });
  });

  it("margem: grava margem_minima em %", () => {
    const r = validarAutomacao({ ...base, gatilho: "margem_abaixo_minimo", margemMinima: "25" });
    expect(r.ok && r.registro.condicao).toEqual({ margem_minima: 25 });
    const fora = validarAutomacao({
      ...base,
      gatilho: "margem_abaixo_minimo",
      margemMinima: "120",
    });
    expect(!fora.ok && fora.erros.margemMinima).toBeTruthy();
  });

  it("destino cliente grava o telefone do cadastro com o 55 explícito", () => {
    const r = validarAutomacao({ ...base, destino: "cliente", telefone: "" });
    expect(r.ok && r.registro.payload.telefone).toBe(TELEFONE_DO_CLIENTE);
  });
});

describe("o que o formulário recusa", () => {
  it("variável que o evento não tem — sairia em branco", () => {
    const r = validarAutomacao({
      ...base,
      mensagem: "Olá {{cliente.nome}}, material {{material.nome}}",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erros.mensagem).toContain("{{material.nome}}");
  });

  it("status_novo só existe quando a etapa muda", () => {
    const atrasada = validarAutomacao({ ...base, mensagem: "Foi para {{status_novo}}" });
    expect(atrasada.ok).toBe(false);
    const mudanca = validarAutomacao({
      ...base,
      gatilho: "status_os_alterado",
      etapas: ["arte_rejeitada"],
      mensagem: "Foi para {{status_novo}}",
    });
    expect(mudanca.ok).toBe(true);
  });

  it("número fixo que não recebe WhatsApp", () => {
    for (const telefone of ["", "96 3222-1234", "123", "96 99131-8834 / 96 98140-8722"]) {
      const r = validarAutomacao({ ...base, telefone });
      expect(!r.ok && r.erros.telefone, telefone).toBeTruthy();
    }
  });

  it("evento sem cliente não manda para o cliente", () => {
    for (const gatilho of [
      "estoque_minimo",
      "pagamento_atrasado",
      "margem_abaixo_minimo",
    ] as const) {
      const r = validarAutomacao({
        ...base,
        gatilho,
        destino: "cliente",
        mensagem: "Aviso importante",
      });
      expect(!r.ok && r.erros.destino, gatilho).toBeTruthy();
    }
  });

  it("para o cliente em qualquer mudança de etapa: exige escolher as etapas", () => {
    const r = validarAutomacao({
      ...base,
      gatilho: "status_os_alterado",
      etapas: [],
      destino: "cliente",
    });
    expect(!r.ok && r.erros.etapas).toBeTruthy();
    // Para a equipe, qualquer mudança é escolha legítima.
    const equipe = validarAutomacao({ ...base, gatilho: "status_os_alterado", etapas: [] });
    expect(equipe.ok && equipe.registro.condicao).toEqual({});
  });

  it("etapa que não existe no enum", () => {
    const r = validarAutomacao({ ...base, gatilho: "status_os_alterado", etapas: ["em_design"] });
    expect(!r.ok && r.erros.etapas).toContain("em_design");
  });

  it("sem gatilho, sem nome, mensagem curta", () => {
    const r = validarAutomacao({ ...FORM_VAZIO });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.gatilho).toBeTruthy();
    expect(r.erros.nome).toBeTruthy();
    expect(r.erros.mensagem).toBeTruthy();
  });
});

describe("avisos que não impedem de salvar", () => {
  it("cliente em etapa que já tem aviso automático", () => {
    const r = validarAutomacao({
      ...base,
      gatilho: "status_os_alterado",
      etapas: ["aguardando_retirada"],
      destino: "cliente",
      mensagem: "Seu pedido {{os.numero}} está pronto.",
    });
    expect(r.ok).toBe(true);
    expect(r.avisos.join(" ")).toContain("Aguardando retirada");
  });

  it("situação com intervalo curto diz quantas mensagens por dia", () => {
    const r = validarAutomacao({ ...base, intervaloSegundos: 3600 });
    expect(r.avisos.join(" ")).toContain("24 mensagens por dia");
    const umDia = validarAutomacao({ ...base, intervaloSegundos: 86400 });
    expect(umDia.avisos).toEqual([]);
  });
});

describe("editar: a linha volta a ser formulário", () => {
  const linha: LinhaAutomacao = {
    id: "1",
    nome: "Ajuste",
    descricao: null,
    gatilho: "status_os_alterado",
    condicao: { status: ["arte_rejeitada"] },
    acao: "whatsapp",
    payload: { mensagem: "Ajuste na OS {{os.numero}}", telefone: "5596991116169" },
    ativo: true,
    cooldown_segundos: 3600,
    delay_segundos: 300,
  };

  it("ida e volta sem perder nada", () => {
    const form = lerAutomacao(linha);
    expect(form.telefone).toBe("(96) 99111-6169");
    expect(form.etapas).toEqual(["arte_rejeitada"]);
    const r = validarAutomacao(form);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registro.payload).toEqual(linha.payload);
    expect(r.registro.condicao).toEqual(linha.condicao);
    expect(r.registro.delay_segundos).toBe(300);
    expect(r.registro.ativo).toBe(true);
  });

  it("destino do cliente é reconhecido", () => {
    const form = lerAutomacao({
      ...linha,
      payload: { mensagem: "x", telefone: TELEFONE_DO_CLIENTE },
    });
    expect(form.destino).toBe("cliente");
    expect(form.telefone).toBe("");
  });

  it("o resumo diz o que a automação faz e o que o motor recusaria", () => {
    const r = resumoDaAutomacao(linha);
    expect(r.quando).toBe("A OS muda de etapa");
    expect(r.condicao).toBe("nas etapas: Arte rejeitada");
    expect(r.destino).toBe("(96) 99111-6169");
    expect(r.intervalo).toBe("no máximo 1 aviso por OS a cada 1 hora");
    expect(r.espera).toBe("espera 5 min");
    expect(r.executavel).toBe(true);

    expect(resumoDaAutomacao({ ...linha, gatilho: "orcamento_vencido" }).executavel).toBe(false);
    expect(resumoDaAutomacao({ ...linha, acao: "email" }).problema).toContain("só manda WhatsApp");
  });

  it("linha gravada sem destino é acusada, não maquiada", () => {
    // O processador cairia no telefone cru do cadastro (sem 55) ou no telefone
    // padrão do servidor — nenhum dos dois é o que alguém escolheu.
    const semDestino = resumoDaAutomacao({ ...linha, payload: { mensagem: "x" } });
    expect(semDestino.problema).toContain("sem o 55");
    const estoque = resumoDaAutomacao({
      ...linha,
      gatilho: "estoque_minimo",
      condicao: {},
      payload: { mensagem: "x" },
    });
    expect(estoque.destino).toBe("nenhum número definido");
    expect(estoque.executavel).toBe(false);
  });
});

describe("modelos prontos", () => {
  it("cada modelo vira automação válida assim que recebe o número", () => {
    for (const m of MODELOS) {
      const sem = validarAutomacao(m.form);
      expect(!sem.ok && sem.erros.telefone, `${m.id} deveria pedir o número`).toBeTruthy();
      const com = validarAutomacao({ ...m.form, telefone: "96991116169" });
      expect(com.ok, `${m.id}: ${JSON.stringify(!com.ok && com.erros)}`).toBe(true);
    }
  });

  it("nenhum modelo manda para o cliente e nenhum nasce ligado", () => {
    for (const m of MODELOS) {
      expect(m.form.destino).toBe("fixo");
      expect(m.form.ativo).toBe(false);
    }
  });

  it("a prévia de cada modelo não deixa variável em branco", () => {
    for (const m of MODELOS) {
      const info = CATALOGO[m.form.gatilho as keyof typeof CATALOGO];
      const previa = renderizarMensagem(m.form.mensagem, dadosDeExemplo(info.variaveis));
      expect(previa, m.id).not.toMatch(/\(\)|\s{2,}/);
      expect(variaveisUsadas(m.form.mensagem).length).toBeGreaterThan(0);
    }
  });
});
