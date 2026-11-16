import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { novoIdLocal } from "@/lib/arquivos-no-navegador";
import {
  BUCKET_DE_ANEXOS,
  caminhoDoAnexo,
  mimeDoArquivo,
  problemaDoArquivo,
  type TipoDeAnexo,
} from "@/domain/financeiro/contas-a-pagar-anexos";

/**
 * Quem pode o quê na conta a pagar. As mesmas regras que o banco cobra (migrações 20261116160000 e
 * 20261116170000):
 *   pagar          admin, ou financeiro.read E pagamentos.confirm E pagamentos.create
 *   anexar         admin, ou financeiro.read E (pagamentos.create, .update ou .confirm)
 *   estornar       só admin (decisão de 16/11/2026)
 *   remover anexo  só admin
 * financeiro.read entra porque o vendedor tem confirm e create (para o recebimento da OS) sem ver o
 * financeiro: sem essa condição a 20261116160000 deixava ele pagar conta pela API.
 */
export function usePodeNaContaAPagar() {
  const { hasPermission, hasRole } = useAuth();
  const admin = hasRole("admin");
  const veFinanceiro = hasPermission("financeiro.read");
  return {
    podePagar:
      admin ||
      (veFinanceiro && hasPermission("pagamentos.confirm") && hasPermission("pagamentos.create")),
    podeAnexar:
      admin ||
      (veFinanceiro &&
        (hasPermission("pagamentos.create") ||
          hasPermission("pagamentos.update") ||
          hasPermission("pagamentos.confirm"))),
    podeEstornar: admin,
    podeRemoverAnexo: admin,
  };
}

export interface ArquivoParaEnviar {
  arquivo: File;
  tipo: TipoDeAnexo;
}

export interface ResultadoDoEnvio {
  enviados: number;
  falhas: string[];
}

/**
 * Sobe cada arquivo para o bucket privado e registra no banco. Um por vez, e cada falha vira
 * uma frase: o que subiu fica, o que não subiu é dito pelo nome. O banco confere tipo e tamanho
 * no objeto gravado; se recusar, o arquivo fica órfão no bucket (privado, sem linha) e a pessoa
 * é avisada, em vez de a tela dizer que anexou.
 */
export function useEnviarAnexos() {
  const { podeAnexar } = usePodeNaContaAPagar();
  return useCallback(
    async (contaId: string, itens: readonly ArquivoParaEnviar[]): Promise<ResultadoDoEnvio> => {
      if (!podeAnexar) {
        return { enviados: 0, falhas: ["Anexar arquivo é com o financeiro."] };
      }
      let enviados = 0;
      const falhas: string[] = [];
      for (const { arquivo, tipo } of itens) {
        const problema = problemaDoArquivo(arquivo);
        const mime = mimeDoArquivo(arquivo);
        if (problema || !mime) {
          falhas.push(problema ?? `"${arquivo.name}" não foi aceito.`);
          continue;
        }
        const caminho = caminhoDoAnexo(contaId, novoIdLocal(), mime);
        const subida = await supabase.storage
          .from(BUCKET_DE_ANEXOS)
          .upload(caminho, arquivo, { contentType: mime, upsert: false });
        if (subida.error) {
          falhas.push(`"${arquivo.name}" não subiu: ${subida.error.message}`);
          continue;
        }
        const { error } = await (supabase.rpc as any)("anexar_arquivo_conta_pagar", {
          p_conta_id: contaId,
          p_tipo: tipo,
          p_caminho: caminho,
          p_nome_arquivo: arquivo.name,
        });
        if (error) {
          falhas.push(`"${arquivo.name}" subiu mas não foi registrado: ${error.message}`);
          continue;
        }
        enviados++;
      }
      return { enviados, falhas };
    },
    [podeAnexar],
  );
}

export interface PedidoDePagamento {
  contaId: string;
  dataPagamento: string;
  contaBancariaId: string | null;
}

/**
 * Pagar SÓ depois da confirmação no diálogo, numa chamada só: `pagar_conta_pagar` marca a conta e
 * lança a saída na data informada, na mesma transação, e confere no banco a chave e o financeiro.
 * O caminho de antes (UPDATE na conta + INSERT no caixa, pela tela) saiu em 16/11/2026, com a
 * migração 20261116160000 aplicada: eram duas gravações soltas, e a segunda podia falhar sozinha.
 */
export function usePagarConta() {
  const { podePagar } = usePodeNaContaAPagar();
  return useCallback(
    async (p: PedidoDePagamento): Promise<void> => {
      if (!podePagar) throw new Error("Pagar é com o financeiro.");
      const { error } = await (supabase.rpc as any)("pagar_conta_pagar", {
        p_conta_id: p.contaId,
        p_data_pagamento: p.dataPagamento,
        p_conta_bancaria_id: p.contaBancariaId,
        p_forma_pagamento: null,
      });
      if (error) throw error;
    },
    [podePagar],
  );
}

/** Estornar: só admin, com motivo. O banco reabre a conta e desfaz o que o pagamento lançou. */
export function useEstornarConta() {
  const { hasRole } = useAuth();
  const admin = hasRole("admin");
  return useCallback(
    async (contaId: string, motivo: string): Promise<Record<string, unknown>> => {
      if (!admin) throw new Error("Só o administrador estorna pagamento de conta a pagar.");
      const { data, error } = await (supabase.rpc as any)("estornar_conta_pagar", {
        p_conta_id: contaId,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      return (data ?? {}) as Record<string, unknown>;
    },
    [admin],
  );
}

/**
 * Remover anexo: só admin. A linha sai no banco (e vira histórico); o arquivo, pela API do
 * Storage, que é a única que o Supabase deixa apagar. Se só o arquivo falhar, ele fica no bucket
 * privado sem linha nenhuma apontando para ele, e a pessoa é avisada.
 */
export function useRemoverAnexo() {
  const { hasRole } = useAuth();
  const admin = hasRole("admin");
  return useCallback(
    async (anexoId: string, motivo: string | null): Promise<{ arquivoApagado: boolean }> => {
      if (!admin) throw new Error("Só o administrador remove anexo de conta a pagar.");
      const { data, error } = await (supabase.rpc as any)("remover_anexo_conta_pagar", {
        p_anexo_id: anexoId,
        p_motivo: motivo?.trim() || null,
      });
      if (error) throw error;
      const caminho = (data as { caminho?: string } | null)?.caminho;
      if (!caminho) return { arquivoApagado: false };
      const { error: e2 } = await supabase.storage.from(BUCKET_DE_ANEXOS).remove([caminho]);
      return { arquivoApagado: !e2 };
    },
    [admin],
  );
}

/**
 * Abre ou baixa um arquivo de bucket privado. A janela abre ANTES de pedir a URL assinada: aberta
 * depois do `await`, o bloqueador de pop-up do navegador a engole.
 */
export async function abrirArquivoPrivado(
  bucket: string,
  caminho: string,
  baixarComNome?: string,
): Promise<boolean> {
  const janela = window.open("", "_blank");
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(caminho, 60, baixarComNome ? { download: baixarComNome } : undefined);
  if (error || !data?.signedUrl) {
    janela?.close();
    return false;
  }
  if (janela) {
    janela.opener = null;
    janela.location.href = data.signedUrl;
    return true;
  }
  // Pop-up recusado: um link clicado por código ainda abre (ou baixa) sem tirar a pessoa da tela.
  const link = document.createElement("a");
  link.href = data.signedUrl;
  link.target = "_blank";
  link.rel = "noopener";
  if (baixarComNome) link.download = baixarComNome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}
