import { tokenDoCabecalho } from "@/domain/api/recursos";
import {
  argumentosParaFiltros,
  conteudoDaFerramenta,
  descobrir,
  descrever,
  erroJsonRpc,
  EXEMPLOS,
  FERRAMENTAS,
  INFO_DO_SERVIDOR,
  PAGINAS_DA_SOMA,
  respostaJsonRpc,
  VERSAO_DO_PROTOCOLO,
  type RequisicaoJsonRpc,
} from "@/domain/api/mcp";
import { lerRecurso } from "@/lib/api/v1.server";

/**
 * POST /api/mcp — o servidor MCP do Bex Print pelo transporte HTTP, sem
 * sessão: cada requisição JSON-RPC recebe uma resposta JSON. `initialize`,
 * `tools/list` e `ping` respondem sem token (o cliente precisa deles para se
 * conectar); `tools/call` exige o token pessoal no cabeçalho, e a leitura sai
 * pelo mesmo caminho da API REST (`lerRecurso`), com a mesma RLS.
 */

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

type Resultado = Record<string, unknown>;

async function chamarFerramenta(nome: string, args: Record<string, unknown>, token: string | null): Promise<Resultado> {
  switch (nome) {
    case "bexprint_descobrir": {
      const achados = descobrir(typeof args.termo === "string" ? args.termo : null);
      return conteudoDaFerramenta({
        termo: args.termo ?? null,
        recursos: achados.map((a) => ({ recurso: a.recurso.chave, titulo: a.recurso.titulo, motivo: a.motivo, filtros: a.recurso.filtros })),
        proximo_passo: achados.length > 0 ? "Chame bexprint_descrever no recurso escolhido e depois bexprint_consultar." : "Nenhum recurso casou. Chame bexprint_descobrir sem termo para ver todos.",
      });
    }
    case "bexprint_descrever": {
      const d = descrever(String(args.recurso ?? ""));
      return d ? conteudoDaFerramenta(d) : conteudoDaFerramenta({ erro: "recurso_desconhecido", mensagem: "Use bexprint_descobrir para ver os recursos." }, true);
    }
    case "bexprint_exemplos":
      return conteudoDaFerramenta({ exemplos: EXEMPLOS });
    case "bexprint_consultar":
    case "bexprint_contar": {
      const parametros = argumentosParaFiltros(args);
      if (nome === "bexprint_contar") {
        parametros.set("limite", "1");
        parametros.delete("deslocamento");
      }
      const leitura = await lerRecurso(token, String(args.recurso ?? ""), parametros);
      if (!leitura.ok) return conteudoDaFerramenta({ erro: leitura.codigo, mensagem: leitura.mensagem }, true);
      if (nome === "bexprint_contar") {
        return conteudoDaFerramenta({ recurso: leitura.corpo.recurso, total: leitura.corpo.total });
      }
      return conteudoDaFerramenta(leitura.corpo);
    }
    case "bexprint_somar": {
      const recurso = String(args.recurso ?? "");
      if (recurso !== "contas_receber" && recurso !== "contas_pagar") {
        return conteudoDaFerramenta({ erro: "recurso_invalido", mensagem: "Somar vale para contas_receber e contas_pagar." }, true);
      }
      const base = argumentosParaFiltros({ status: args.status, desde: args.desde, ate: args.ate });
      let soma = 0;
      let linhas = 0;
      let total = 0;
      let parcial = false;
      for (let pagina = 0; pagina < PAGINAS_DA_SOMA; pagina++) {
        const p = new URLSearchParams(base);
        p.set("limite", "100");
        p.set("deslocamento", String(pagina * 100));
        const leitura = await lerRecurso(token, recurso, p);
        if (!leitura.ok) return conteudoDaFerramenta({ erro: leitura.codigo, mensagem: leitura.mensagem }, true);
        const itens = (leitura.corpo.itens ?? []) as { valor?: number | string | null }[];
        total = Number(leitura.corpo.total ?? 0);
        for (const i of itens) soma += Number(i.valor ?? 0) || 0;
        linhas += itens.length;
        if (linhas >= total || itens.length === 0) break;
        if (pagina === PAGINAS_DA_SOMA - 1) parcial = linhas < total;
      }
      return conteudoDaFerramenta({
        recurso,
        campo: "valor",
        filtros: Object.fromEntries(base.entries()),
        soma: Math.round(soma * 100) / 100,
        linhas_somadas: linhas,
        total_de_linhas: total,
        parcial,
        aviso: parcial ? `Somadas as primeiras ${linhas} de ${total} linhas. Refine os filtros para fechar a conta.` : null,
      });
    }
    default:
      return conteudoDaFerramenta({ erro: "ferramenta_desconhecida", mensagem: `Não existe ${nome}. Ferramentas: ${FERRAMENTAS.map((f) => f.name).join(", ")}.` }, true);
  }
}

async function atenderUma(req: RequisicaoJsonRpc, token: string | null): Promise<Record<string, unknown> | null> {
  const id = req.id ?? null;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return erroJsonRpc(id, -32600, "Requisição JSON-RPC 2.0 inválida.");
  }
  // Notificações não têm resposta.
  if (req.method.startsWith("notifications/")) return null;

  switch (req.method) {
    case "initialize":
      return respostaJsonRpc(id, {
        protocolVersion: VERSAO_DO_PROTOCOLO,
        capabilities: { tools: { listChanged: false } },
        serverInfo: INFO_DO_SERVIDOR,
        instructions:
          "MCP de leitura do Bex Print. Comece por bexprint_descobrir, depois bexprint_descrever e bexprint_consultar. Todas as chamadas de ferramenta exigem o token pessoal no cabeçalho Authorization: Bearer ou x-api-key. Só leitura; quem lê é a pessoa dona do token.",
      });
    case "ping":
      return respostaJsonRpc(id, {});
    case "tools/list":
      return respostaJsonRpc(id, { tools: FERRAMENTAS });
    case "tools/call": {
      const nome = String(req.params?.name ?? "");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      if (!token) {
        return respostaJsonRpc(id, conteudoDaFerramenta({ erro: "sem_token", mensagem: "Mande o token pessoal no cabeçalho Authorization: Bearer bxp_… (Ajustes, API e MCP)." }, true));
      }
      return respostaJsonRpc(id, await chamarFerramenta(nome, args, token));
    }
    default:
      return erroJsonRpc(id, -32601, `Método ${req.method} não existe neste servidor.`);
  }
}

export async function atenderMcp(request: Request): Promise<Response> {
  if (request.method === "GET") {
    // Sem fluxo de eventos nesta onda: o cliente fala por POST e recebe JSON.
    return json({ erro: "metodo_nao_permitido", mensagem: "Este MCP responde por POST com JSON-RPC 2.0." }, 405);
  }
  if (request.method === "DELETE") return new Response(null, { status: 200 });

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return json(erroJsonRpc(null, -32700, "Corpo não é JSON."), 400);
  }
  const token = tokenDoCabecalho(request.headers);

  if (Array.isArray(corpo)) {
    const respostas = (await Promise.all(corpo.map((r) => atenderUma(r as RequisicaoJsonRpc, token)))).filter((r) => r !== null);
    return respostas.length === 0 ? new Response(null, { status: 202 }) : json(respostas);
  }
  const resposta = await atenderUma(corpo as RequisicaoJsonRpc, token);
  return resposta === null ? new Response(null, { status: 202 }) : json(resposta);
}
