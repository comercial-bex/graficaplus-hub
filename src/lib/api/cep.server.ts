import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { apenasDigitos } from "@/domain/documentos";

/**
 * Consulta de CEP, para o cadastro de cliente preencher rua, bairro, cidade e estado (01/11/2026).
 * O CNPJ já traz o endereço da empresa; quem é pessoa física não tem consulta de documento, e o CEP
 * é o que sobra para "puxar corretamente", como no Holdprint.
 *
 * Roda no servidor pelos mesmos dois motivos da consulta de CNPJ (sem depender de CORS e sem expor o IP
 * de cada usuário). A BrasilAPI vem primeiro; se ela cair, o ViaCEP responde. CEP que nenhum dos dois
 * conhece é "não encontrado" e o cadastro segue à mão.
 */

const entradaSchema = z.object({ cep: z.string().min(8).max(9) });

export type DadosCEP = {
  cep: string;
  /** Só a rua: o número e o complemento quem digita é o cadastro. */
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
};

export type ResultadoConsultaCEP = { ok: true; dados: DadosCEP } | { ok: false; motivo: string };

const texto = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Exportada para teste: aceita a resposta da BrasilAPI (street, neighborhood, city, state) ou do ViaCEP. */
export function normalizarRespostaCEP(cep: string, r: Record<string, unknown>): DadosCEP {
  return {
    cep: apenasDigitos(texto(r.cep) ?? cep),
    endereco: texto(r.street) ?? texto(r.logradouro),
    bairro: texto(r.neighborhood) ?? texto(r.bairro),
    cidade: texto(r.city) ?? texto(r.localidade),
    estado: (texto(r.state) ?? texto(r.uf))?.toUpperCase() ?? null,
  };
}

async function buscar(url: string): Promise<{ status: number; corpo: Record<string, unknown> | null }> {
  const controlador = new AbortController();
  const expirar = setTimeout(() => controlador.abort(), 6000);
  try {
    const resposta = await fetch(url, {
      headers: {
        Accept: "application/json",
        // O Cloudflare da BrasilAPI responde 403 a quem não manda User-Agent (o fetch do servidor não manda).
        "User-Agent": "bex-print-os/1.0 (+https://agenciabex.com.br)",
      },
      signal: controlador.signal,
    });
    const corpo = resposta.ok ? ((await resposta.json()) as Record<string, unknown>) : null;
    return { status: resposta.status, corpo };
  } finally {
    clearTimeout(expirar);
  }
}

export const consultarCEP = createServerFn({ method: "POST" })
  .inputValidator(entradaSchema)
  .handler(async ({ data }): Promise<ResultadoConsultaCEP> => {
    const cep = apenasDigitos(data.cep);
    if (cep.length !== 8) return { ok: false, motivo: "O CEP tem 8 números." };

    try {
      const a = await buscar(`https://brasilapi.com.br/api/cep/v2/${cep}`);
      if (a.corpo) return { ok: true, dados: normalizarRespostaCEP(cep, a.corpo) };
      if (a.status !== 404) {
        // BrasilAPI fora do ar ou limitando: o ViaCEP é a segunda chance.
        const b = await buscar(`https://viacep.com.br/ws/${cep}/json/`);
        if (b.corpo && b.corpo.erro !== true && b.corpo.erro !== "true") {
          return { ok: true, dados: normalizarRespostaCEP(cep, b.corpo) };
        }
      }
      return { ok: false, motivo: "CEP não encontrado. Preencha o endereço à mão." };
    } catch (erro) {
      const abortou = erro instanceof Error && erro.name === "AbortError";
      return {
        ok: false,
        motivo: abortou
          ? "A consulta do CEP demorou demais. Preencha o endereço à mão."
          : "Não foi possível consultar o CEP agora. Preencha o endereço à mão.",
      };
    }
  });
