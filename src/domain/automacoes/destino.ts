import { chaveWhatsApp } from "@/domain/documentos";
import { infoDoGatilho } from "@/domain/automacoes/catalogo";
import { renderizarMensagem } from "@/domain/automacoes/mensagem";

/**
 * A mensagem e o destino de UMA execução de automação, do jeito que o
 * consumidor do envio (`whatsapp-enviar.server.ts`) vai mandar.
 *
 * Até 06/10/2026 quem resolvia isso era a função `process-automations`
 * (Supabase Edge), que ninguém chamava: sem `pg_cron` o motor enfileirava e a
 * fila só enchia. Desde então a automação sai pelo MESMO despachante dos
 * avisos ao cliente, e as regras do destino moram aqui, puras, para o teste
 * ler.
 *
 * A ORDEM do destino é a que a função antiga usava, para nenhuma automação
 * já cadastrada mudar de rumo: `payload.telefone` (aceita {{ }}), senão o
 * telefone do contexto, senão o do cliente no contexto, senão o telefone
 * padrão do servidor (AUTOMATION_DEFAULT_PHONE).
 *
 * O QUE A FUNÇÃO ANTIGA NÃO FAZIA: recusar cliente como destino quando o
 * gatilho diz `aceitaCliente: false` (pagamento atrasado, estoque mínimo,
 * margem baixa — catalogo.ts explica cada um). Cobrança automática é decisão
 * do financeiro, e margem é dinheiro: a tela já não oferece "cliente" nesses
 * gatilhos, mas o payload é JSON livre e uma regra editada à mão chegaria ao
 * cliente do mesmo jeito. A recusa fica no envio, que é a última porta.
 */

type Dados = Record<string, unknown>;

export type ExecucaoParaEnvio = {
  gatilho: string;
  contexto: Dados;
  payload: Dados;
  automacao: { payload: Dados } | null;
  /** AUTOMATION_DEFAULT_PHONE do servidor; null quando não há. */
  telefonePadrao: string | null;
};

function obj(v: unknown): Dados {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Dados) : {};
}

function textoOuNada(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** O payload da execução por cima do da automação, como a função antiga fazia. */
function payloadEfetivo(e: ExecucaoParaEnvio): Dados {
  return { ...obj(e.automacao?.payload), ...obj(e.payload) };
}

function contextoCompleto(e: ExecucaoParaEnvio, payload: Dados): Dados {
  return {
    ...obj(e.contexto),
    payload,
    automacao: e.automacao,
    admin_telefone: e.telefonePadrao ?? "",
  };
}

/** O texto da mensagem, já com as variáveis trocadas; vazio quando não há modelo. */
export function textoDaAutomacao(e: ExecucaoParaEnvio): string {
  const payload = payloadEfetivo(e);
  const modelo = textoOuNada(payload.mensagem);
  if (!modelo) return "";
  return renderizarMensagem(modelo, contextoCompleto(e, payload)).trim();
}

export type Destino = { ok: true; telefone: string } | { ok: false; erro: string };

/** Os telefones do cliente que estão no contexto, normalizados para comparar. */
function telefonesDoCliente(contexto: Dados): string[] {
  const cliente = obj(contexto.cliente);
  return [cliente.telefone, cliente.whatsapp_principal, cliente.telefone_normalizado]
    .map((t) => chaveWhatsApp(typeof t === "string" ? t : null))
    .filter((t): t is string => !!t);
}

export function destinoDaAutomacao(e: ExecucaoParaEnvio): Destino {
  const payload = payloadEfetivo(e);
  const contexto = obj(e.contexto);
  const merged = contextoCompleto(e, payload);
  const info = infoDoGatilho(e.gatilho);

  const modeloDoTelefone = textoOuNada(payload.telefone);
  const bruto =
    (modeloDoTelefone ? textoOuNada(renderizarMensagem(modeloDoTelefone, merged)) : null) ??
    textoOuNada(contexto.telefone) ??
    textoOuNada(obj(contexto.cliente).telefone) ??
    textoOuNada(e.telefonePadrao);

  if (!bruto) {
    return {
      ok: false,
      erro: "sem telefone de destino: a automação não tem número e o servidor não tem AUTOMATION_DEFAULT_PHONE",
    };
  }

  if (info && !info.aceitaCliente) {
    const chave = chaveWhatsApp(bruto);
    const apontaParaCliente =
      (modeloDoTelefone !== null && /\{\{\s*cliente\./i.test(modeloDoTelefone)) ||
      (chave !== null && telefonesDoCliente(contexto).includes(chave));
    if (apontaParaCliente) {
      return {
        ok: false,
        erro: `o gatilho "${info.rotulo}" não manda mensagem ao cliente (decisão do financeiro/gerência): aponte a automação para um número da equipe`,
      };
    }
  }

  return { ok: true, telefone: bruto };
}
