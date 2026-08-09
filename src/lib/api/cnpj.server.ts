import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { apenasDigitos, validarCNPJ } from "@/domain/documentos";

/**
 * Consulta de CNPJ na base pública da Receita Federal, via BrasilAPI
 * (GET /api/cnpj/v1/{cnpj}, sem chave de acesso).
 *
 * Roda no servidor, não no navegador, por dois motivos: não depender da política
 * de CORS de um serviço externo, e não expor o IP de cada usuário ao provedor
 * (a BrasilAPI limita por origem).
 *
 * IMPORTANTE — não existe equivalente para CPF: dado de pessoa física não é
 * público e não há API legítima para consultá-lo. CPF é sempre digitado à mão.
 *
 * Inscrição estadual também não vem daqui: é cadastro estadual, e a base federal
 * não a fornece. Continua sendo preenchida manualmente.
 */

const entradaSchema = z.object({
  cnpj: z.string().min(14).max(20),
});

/** Resposta da BrasilAPI v2 — só os campos que aproveitamos. */
type RespostaBrasilAPI = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  email?: string;
};

export type DadosCNPJ = {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null
  cep: string | null;
  telefones: string | null;
  email: string | null;
};

export type ResultadoConsultaCNPJ =
  | { ok: true; dados: DadosCNPJ }
  | { ok: false; motivo: string };

/** "AVENIDA PAULISTA, 37, ANDAR 4" */
function montarEndereco(r: RespostaBrasilAPI): string | null {
  const partes = [r.logradouro, r.numero, r.complemento]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p !== "");
  return partes.length > 0 ? partes.join(", ") : null;
}

function montarTelefones(r: RespostaBrasilAPI): string | null {
  const lista = [r.ddd_telefone_1, r.ddd_telefone_2]
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t !== "");
  return lista.length > 0 ? lista.join("  |  ") : null;
}

const textoOuNulo = (v: unknown) =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Exportada para teste: converte a resposta crua no formato do formulário. */
export function normalizarRespostaCNPJ(
  cnpj: string,
  r: RespostaBrasilAPI,
): DadosCNPJ {
  return {
    cnpj: apenasDigitos(r.cnpj ?? cnpj),
    razao_social: textoOuNulo(r.razao_social),
    nome_fantasia: textoOuNulo(r.nome_fantasia),
    situacao: textoOuNulo(r.descricao_situacao_cadastral),
    endereco: montarEndereco(r),
    bairro: textoOuNulo(r.bairro),
    cidade: textoOuNulo(r.municipio),
    estado: textoOuNulo(r.uf),
    cep: r.cep ? apenasDigitos(r.cep) : null,
    telefones: montarTelefones(r),
    email: textoOuNulo(r.email)?.toLowerCase() ?? null,
  };
}

export const consultarCNPJ = createServerFn({ method: "POST" })
  .inputValidator(entradaSchema)
  .handler(async ({ data }): Promise<ResultadoConsultaCNPJ> => {
    const digitos = apenasDigitos(data.cnpj);

    // Valida antes de sair para a rede: dígito verificador errado é erro de
    // digitação, não vale gastar uma consulta nem o tempo do usuário.
    if (!validarCNPJ(digitos)) {
      return { ok: false, motivo: "CNPJ inválido — confira os dígitos." };
    }

    try {
      const controlador = new AbortController();
      const expirar = setTimeout(() => controlador.abort(), 8000);

      // Endpoint correto é /api/cnpj/v1/ — /api/v2/cnpj/ devolve o 404 do site,
      // em HTML, não um erro de API.
      const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`, {
        headers: { Accept: "application/json" },
        signal: controlador.signal,
      });
      clearTimeout(expirar);

      if (resposta.status === 404) {
        return { ok: false, motivo: "CNPJ não encontrado na base da Receita." };
      }
      if (resposta.status === 429) {
        return {
          ok: false,
          motivo: "Muitas consultas em sequência. Tente de novo em alguns instantes.",
        };
      }
      if (!resposta.ok) {
        return {
          ok: false,
          motivo: `A consulta falhou (HTTP ${resposta.status}). Preencha manualmente.`,
        };
      }

      const cru = (await resposta.json()) as RespostaBrasilAPI;
      return { ok: true, dados: normalizarRespostaCNPJ(digitos, cru) };
    } catch (erro) {
      const abortou = erro instanceof Error && erro.name === "AbortError";
      return {
        ok: false,
        motivo: abortou
          ? "A consulta demorou demais. Preencha manualmente."
          : "Não foi possível consultar agora. Preencha manualmente.",
      };
    }
  });
