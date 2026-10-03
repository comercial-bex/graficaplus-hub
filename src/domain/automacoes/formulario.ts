/**
 * Formulário de automação ⇄ linha da tabela `automacoes`.
 *
 * A validação mora aqui, e não no banco, porque `automacoes.gatilho` é texto
 * livre e `condicao`/`payload` são jsonb sem CHECK: o banco aceita qualquer
 * coisa, e uma automação com gatilho escrito errado ou condição com chave que
 * `automacao_condicao_ok` não lê fica "Ativa" na tela sem disparar nunca. A
 * regra é: só sai daqui o que o motor executa (ver ./catalogo.ts).
 */
import { formatarTelefone, chaveWhatsApp } from "@/domain/documentos";
import { STATUS, rotuloDe } from "@/domain/os/etapas";
import { telefoneParaZapi } from "@/domain/whatsapp/zapi-envio";
import {
  ETAPAS_COM_AVISO_AO_CLIENTE,
  TELEFONE_DO_CLIENTE,
  infoDoGatilho,
  rotuloDeDuracao,
  type Gatilho,
} from "./catalogo";
import { variaveisDesconhecidas } from "./mensagem";

export type Destino = "cliente" | "fixo";

export type FormAutomacao = {
  nome: string;
  descricao: string | null;
  gatilho: Gatilho | "";
  /** status_os_alterado: em quais etapas avisa. Vazio = qualquer mudança. */
  etapas: string[];
  /** estoque_minimo: vazio = o mínimo cadastrado em cada material. */
  estoqueMinimo: string;
  /** margem_abaixo_minimo, em %. */
  margemMinima: string;
  destino: Destino;
  telefone: string;
  mensagem: string;
  intervaloSegundos: number;
  esperaSegundos: number;
  ativo: boolean;
};

export const FORM_VAZIO: FormAutomacao = {
  nome: "",
  descricao: null,
  gatilho: "",
  etapas: [],
  estoqueMinimo: "",
  margemMinima: "30",
  destino: "fixo",
  telefone: "",
  mensagem: "",
  intervaloSegundos: 3600,
  esperaSegundos: 0,
  ativo: false,
};

/** O que vai para o INSERT/UPDATE. `acao` é sempre whatsapp: é a única que o processador executa. */
export type RegistroAutomacao = {
  nome: string;
  descricao: string | null;
  gatilho: Gatilho;
  condicao: Record<string, unknown>;
  acao: "whatsapp";
  payload: { mensagem: string; telefone: string };
  cooldown_segundos: number;
  delay_segundos: number;
  ativo: boolean;
};

export type CampoForm =
  | "nome"
  | "gatilho"
  | "etapas"
  | "estoqueMinimo"
  | "margemMinima"
  | "destino"
  | "telefone"
  | "mensagem"
  | "intervaloSegundos"
  | "esperaSegundos";

export type Validacao =
  | { ok: true; registro: RegistroAutomacao; avisos: string[] }
  | { ok: false; erros: Partial<Record<CampoForm, string>>; avisos: string[] };

const STATUS_VALIDOS = new Set(STATUS.map((s) => s.status));
const TRINTA_DIAS = 30 * 86400;

function numero(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** O que a pessoa vai ver como aviso, sem impedir de salvar. */
function avisosDe(form: FormAutomacao): string[] {
  const avisos: string[] = [];
  const info = infoDoGatilho(form.gatilho);
  if (!info) return avisos;

  if (form.destino === "cliente") {
    const repetidas =
      form.gatilho === "os_concluida"
        ? ["concluido"]
        : form.etapas.filter((e) => (ETAPAS_COM_AVISO_AO_CLIENTE as readonly string[]).includes(e));
    if (form.gatilho === "status_os_alterado" || form.gatilho === "os_concluida") {
      if (repetidas.length > 0) {
        avisos.push(
          `O cliente já pode estar recebendo o aviso automático de ${repetidas
            .map((e) => `“${rotuloDe(e)}”`)
            .join(
              ", ",
            )} (Respostas rápidas › Avisos automáticos ao cliente). Com os dois ligados, ele recebe duas mensagens sobre a mesma coisa.`,
        );
      }
    }
  }

  if (info.situacao && form.intervaloSegundos < 86400) {
    const porDia = Math.floor(86400 / Math.max(form.intervaloSegundos, 1));
    const mesmo = info.alvo === "material" ? "o mesmo material" : `a mesma ${info.alvo}`;
    avisos.push(
      `“${info.rotulo}” é uma situação que dura: com intervalo de ${rotuloDeDuracao(form.intervaloSegundos)}, ${mesmo} pode gerar até ${porDia} mensagens por dia enquanto não for resolvido.`,
    );
  }
  return avisos;
}

export function validarAutomacao(form: FormAutomacao): Validacao {
  const erros: Partial<Record<CampoForm, string>> = {};
  const avisos = avisosDe(form);
  const info = infoDoGatilho(form.gatilho);

  const nome = form.nome.trim();
  if (nome.length < 3 || nome.length > 80) erros.nome = "Dê um nome à automação (3 a 80 letras).";

  if (!info) erros.gatilho = "Escolha quando a automação dispara.";

  // Condição: só as três chaves que automacao_condicao_ok lê.
  const condicao: Record<string, unknown> = {};
  if (info?.condicao === "status") {
    const invalidas = form.etapas.filter((e) => !STATUS_VALIDOS.has(e));
    if (invalidas.length > 0) {
      erros.etapas = `Etapa que não existe no banco: ${invalidas.join(", ")}.`;
    } else if (form.etapas.length > 0) {
      condicao.status = [...form.etapas];
    } else if (form.destino === "cliente") {
      erros.etapas =
        "Para mandar ao cliente, escolha as etapas — sem escolha ele receberia uma mensagem a cada mudança de etapa.";
    }
  }
  if (info?.condicao === "estoque_minimo") {
    const n = numero(form.estoqueMinimo);
    if (form.estoqueMinimo.trim() !== "" && (n === null || n < 0)) {
      erros.estoqueMinimo =
        "Informe um número (ou deixe em branco para usar o mínimo de cada material).";
    } else if (n !== null) {
      condicao.estoque_minimo = n;
    }
  }
  if (info?.condicao === "margem_minima") {
    const n = numero(form.margemMinima);
    if (n === null || n < 0 || n > 100) {
      erros.margemMinima = "Informe a margem mínima em % (de 0 a 100).";
    } else {
      condicao.margem_minima = n;
    }
  }

  // Destino.
  let telefone = "";
  if (form.destino === "cliente") {
    if (info && !info.aceitaCliente) {
      erros.destino = "Este evento não manda para o cliente: escolha um número da equipe.";
    } else {
      telefone = TELEFONE_DO_CLIENTE;
    }
  } else {
    const zapi = telefoneParaZapi(form.telefone);
    if (!zapi) {
      erros.telefone = "Informe um celular com DDD que recebe WhatsApp, ex.: (96) 99111-6169.";
    } else {
      telefone = zapi;
    }
  }

  // Mensagem.
  const mensagem = form.mensagem.trim();
  if (mensagem.length < 5) {
    erros.mensagem = "Escreva a mensagem (pelo menos 5 letras).";
  } else if (mensagem.length > 1000) {
    erros.mensagem = "Mensagem longa demais: o limite é 1.000 caracteres.";
  } else if (info) {
    const desconhecidas = variaveisDesconhecidas(
      mensagem,
      info.variaveis.map((v) => v.chave),
    );
    if (desconhecidas.length > 0) {
      erros.mensagem = `Estas variáveis não existem neste evento e sairiam em branco: ${desconhecidas
        .map((v) => `{{${v}}}`)
        .join(", ")}.`;
    }
  }

  if (
    !Number.isInteger(form.intervaloSegundos) ||
    form.intervaloSegundos < 0 ||
    form.intervaloSegundos > TRINTA_DIAS
  ) {
    erros.intervaloSegundos = "Escolha o intervalo mínimo entre dois avisos.";
  }
  if (
    !Number.isInteger(form.esperaSegundos) ||
    form.esperaSegundos < 0 ||
    form.esperaSegundos > 86400
  ) {
    erros.esperaSegundos = "Escolha quanto esperar antes de enviar.";
  }

  if (Object.keys(erros).length > 0 || !info) return { ok: false, erros, avisos };

  return {
    ok: true,
    avisos,
    registro: {
      nome,
      descricao: form.descricao?.trim() ? form.descricao.trim() : null,
      gatilho: info.gatilho,
      condicao,
      acao: "whatsapp",
      payload: { mensagem, telefone },
      cooldown_segundos: form.intervaloSegundos,
      delay_segundos: form.esperaSegundos,
      ativo: form.ativo,
    },
  };
}

/** A linha como vem do banco (só o que a tela usa). */
export type LinhaAutomacao = {
  id: string;
  nome: string;
  descricao: string | null;
  gatilho: string;
  condicao: Record<string, unknown> | null;
  acao: string;
  payload: Record<string, unknown> | null;
  ativo: boolean;
  cooldown_segundos: number;
  delay_segundos: number;
};

function textoDe(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Para editar: a linha volta a ser formulário. */
export function lerAutomacao(linha: LinhaAutomacao): FormAutomacao {
  const condicao = linha.condicao ?? {};
  const payload = linha.payload ?? {};
  const telefone = textoDe(payload.telefone);
  const status = condicao.status;
  const etapas = Array.isArray(status)
    ? status.map(textoDe)
    : typeof status === "string" && status
      ? [status]
      : [];
  const info = infoDoGatilho(linha.gatilho);

  return {
    nome: linha.nome ?? "",
    descricao: linha.descricao ?? null,
    gatilho: info ? info.gatilho : "",
    etapas,
    estoqueMinimo: condicao.estoque_minimo != null ? textoDe(condicao.estoque_minimo) : "",
    margemMinima: condicao.margem_minima != null ? textoDe(condicao.margem_minima) : "30",
    // Sem telefone no payload o processador usa o telefone do contexto (o
    // cliente). Ao editar, isso vira o destino "cliente" — que agora grava o
    // telefone com o 55 explícito.
    destino:
      telefone === TELEFONE_DO_CLIENTE || (!telefone && info?.aceitaCliente) ? "cliente" : "fixo",
    telefone:
      telefone && telefone !== TELEFONE_DO_CLIENTE
        ? formatarTelefone(chaveWhatsApp(telefone) ?? telefone)
        : "",
    mensagem: textoDe(payload.mensagem),
    intervaloSegundos: Number(linha.cooldown_segundos ?? 3600),
    esperaSegundos: Number(linha.delay_segundos ?? 0),
    ativo: !!linha.ativo,
  };
}

/** As frases do cartão da automação na lista. */
export function resumoDaAutomacao(linha: LinhaAutomacao): {
  quando: string;
  condicao: string | null;
  destino: string;
  intervalo: string;
  espera: string | null;
  executavel: boolean;
  problema: string | null;
} {
  const info = infoDoGatilho(linha.gatilho);
  const condicao = linha.condicao ?? {};
  const payload = linha.payload ?? {};
  const telefone = textoDe(payload.telefone);

  let textoCondicao: string | null = null;
  if (info?.condicao === "status") {
    const lista = Array.isArray(condicao.status)
      ? condicao.status.map(textoDe)
      : typeof condicao.status === "string"
        ? [condicao.status]
        : [];
    textoCondicao =
      lista.length > 0
        ? `nas etapas: ${lista.map((s) => rotuloDe(s)).join(", ")}`
        : "em qualquer mudança de etapa";
  } else if (info?.condicao === "estoque_minimo") {
    textoCondicao =
      condicao.estoque_minimo != null
        ? `com estoque igual ou abaixo de ${textoDe(condicao.estoque_minimo)}`
        : "com estoque igual ou abaixo do mínimo de cada material";
  } else if (info?.condicao === "margem_minima") {
    textoCondicao = `com margem abaixo de ${textoDe(condicao.margem_minima ?? 30)}%`;
  }

  // Linha gravada fora desta tela pode vir sem telefone: o processador então
  // usa o telefone CRU do cadastro (sem o 55) e, sem ele, o telefone padrão
  // do servidor — que pode nem existir. A tela diz isso em vez de inventar.
  const destino =
    telefone === TELEFONE_DO_CLIENTE
      ? "cliente da OS"
      : telefone
        ? formatarTelefone(chaveWhatsApp(telefone) ?? telefone)
        : info?.aceitaCliente
          ? "telefone do cadastro do cliente, sem o 55"
          : "nenhum número definido";

  // O que o processador recusaria na hora de mandar: melhor dizer agora.
  let problema: string | null = null;
  if (!info)
    problema = `Gatilho "${linha.gatilho}" não existe no motor: esta automação nunca dispara.`;
  else if (linha.acao !== "whatsapp")
    problema = `Ação "${linha.acao}" não é executada: o processador só manda WhatsApp.`;
  else if (!textoDe(payload.mensagem).trim())
    problema = "Sem mensagem: o processador recusa o envio.";
  else if (!telefone)
    problema = info.aceitaCliente
      ? "Sem destino gravado: o processador manda para o telefone do cadastro sem o 55, e o Z-API pede o número com o 55. Edite e salve para corrigir."
      : "Sem número: o processador só enviaria para o telefone padrão do servidor, se existir. Edite e informe o número da equipe.";

  return {
    quando: info?.rotulo ?? linha.gatilho,
    condicao: textoCondicao,
    destino,
    intervalo: `no máximo 1 aviso por ${info?.alvo ?? "registro"} a cada ${rotuloDeDuracao(Number(linha.cooldown_segundos ?? 0))}`,
    espera:
      Number(linha.delay_segundos ?? 0) > 0
        ? `espera ${rotuloDeDuracao(Number(linha.delay_segundos))}`
        : null,
    executavel: problema === null,
    problema,
  };
}
