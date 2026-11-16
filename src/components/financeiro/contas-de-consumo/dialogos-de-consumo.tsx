import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mensagemErro } from "@/lib/erros";
import { PagarContaDialog } from "@/components/financeiro/contas-a-pagar/pagar-conta-dialog";
import {
  AnexosDaContaDialog,
  type AbaDosAnexos,
} from "@/components/financeiro/contas-a-pagar/anexos-da-conta-dialog";
import { anexosPorConta, type AnexoDaConta } from "@/domain/financeiro/contas-a-pagar-anexos";
import {
  dadosDoTipo,
  numeroDoCampo,
  rotuloDaCompetencia,
  type FaturaDeConsumo,
  type UnidadeDeConsumo,
} from "@/domain/financeiro/contas-de-consumo";
import { UnidadeDialog } from "./unidade-dialog";
import { LancarFaturaDialog } from "./lancar-fatura-dialog";
import {
  CHAVES,
  useContasBancariasAtivas,
  useCorrigirDadosDaFatura,
  useFornecedoresAtivos,
  type BancoDaLista,
} from "./use-contas-de-consumo";

/** O diálogo aberto agora nas telas de contas de consumo (um de cada vez). */
export type DialogoDeConsumo =
  | { tipo: "unidade"; unidade: UnidadeDeConsumo | null }
  | { tipo: "lancar"; unidade: UnidadeDeConsumo }
  | { tipo: "pagar"; fatura: FaturaDeConsumo; unidade: UnidadeDeConsumo | null }
  | { tipo: "anexos"; fatura: FaturaDeConsumo; aba: AbaDosAnexos }
  | { tipo: "corrigir"; fatura: FaturaDeConsumo; unidade: UnidadeDeConsumo | null };

export const CHAVE_DOS_ANEXOS = ["anexos-das-faturas-de-consumo"] as const;

/** Anexos das contas das faturas: o clipe com contagem e o diálogo de anexos e histórico de sempre. */
export function useAnexosDasFaturas(faturas: readonly FaturaDeConsumo[]) {
  const ids = faturas.map((f) => f.conta_pagar_id).sort();
  return useQuery({
    queryKey: [...CHAVE_DOS_ANEXOS, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contas_pagar_anexos")
        .select(
          "id, conta_pagar_id, tipo, caminho, nome_arquivo, mime, tamanho_bytes, enviado_por_nome, enviado_em",
        )
        .in("conta_pagar_id", ids)
        .order("enviado_em", { ascending: true });
      if (error) throw error;
      return anexosPorConta((data ?? []) as AnexoDaConta[]);
    },
  });
}

const paraOPagamento = (bancos: readonly BancoDaLista[]) =>
  bancos.map((b) => ({ conta_id: b.id, nome: b.nome, banco: b.banco }));

/**
 * Os diálogos das telas de contas de consumo. Pagar e anexos são os mesmos componentes do Caixa:
 * a fatura de consumo é uma conta a pagar como as outras.
 */
export function DialogosDeConsumo({
  dialogo,
  setDialogo,
  faturas,
  anexos,
  hoje,
}: {
  dialogo: DialogoDeConsumo | null;
  setDialogo: (d: DialogoDeConsumo | null) => void;
  faturas: readonly FaturaDeConsumo[];
  anexos: Map<string, AnexoDaConta[]>;
  hoje: string;
}) {
  const qc = useQueryClient();
  const fornecedores = useFornecedoresAtivos();
  const bancos = useContasBancariasAtivas();
  const listaDeBancos = bancos.data ?? [];

  function recarregar() {
    for (const k of [
      CHAVES.unidades,
      CHAVES.faturas,
      CHAVES.fornecedores,
      CHAVE_DOS_ANEXOS,
      ["contas-pagar"],
      ["contas-pagar-anexos"],
      ["caixa-movimentos"],
      ["vw-fluxo-caixa"],
      ["conferencia-do-caixa"],
    ])
      qc.invalidateQueries({ queryKey: k });
  }

  if (!dialogo) return null;

  if (dialogo.tipo === "unidade")
    return (
      <UnidadeDialog
        unidade={dialogo.unidade}
        fornecedores={fornecedores.data ?? []}
        bancos={listaDeBancos}
        onFechar={() => setDialogo(null)}
        onSalva={() => {
          recarregar();
          setDialogo(null);
        }}
      />
    );

  if (dialogo.tipo === "lancar")
    return (
      <LancarFaturaDialog
        unidade={dialogo.unidade}
        faturas={faturas}
        hoje={hoje}
        onFechar={() => setDialogo(null)}
        onLancada={(f) => {
          recarregar();
          if (!f.jaPaga) {
            setDialogo(null);
            return;
          }
          // "Já está paga": o mesmo Confirmar pagamento de sempre, para a conta recém-lançada.
          setDialogo({
            tipo: "pagar",
            unidade: dialogo.unidade,
            fatura: {
              conta_pagar_id: f.contaId,
              unidade_id: dialogo.unidade.id,
              competencia: "",
              consumo: null,
              bandeira_taxas: null,
              iluminacao_publica: null,
              numero_nf: null,
              contas_pagar: {
                id: f.contaId,
                descricao: f.descricao,
                fornecedor: f.fornecedor,
                valor: f.valor,
                vencimento: f.vencimento,
                status: "aberta",
                data_pagamento: null,
                comprovante_url: null,
              },
            },
          });
        }}
      />
    );

  const conta = dialogo.fatura.contas_pagar;
  if (!conta) return null;

  if (dialogo.tipo === "pagar")
    return (
      <PagarContaDialog
        key={conta.id}
        conta={{
          id: conta.id,
          descricao: conta.descricao,
          fornecedor: conta.fornecedor,
          valor: Number(conta.valor),
          vencimento: conta.vencimento,
        }}
        contasBancarias={paraOPagamento(listaDeBancos)}
        hoje={hoje}
        pacoteAtivo
        origemSugerida={dialogo.unidade?.conta_bancaria_id ?? null}
        onFechar={() => setDialogo(null)}
        onPago={() => {
          recarregar();
          setDialogo(null);
        }}
      />
    );

  if (dialogo.tipo === "anexos")
    return (
      <AnexosDaContaDialog
        key={`${conta.id}-${dialogo.aba}`}
        conta={{
          id: conta.id,
          descricao: conta.descricao,
          status: conta.status,
          comprovante_url: conta.comprovante_url,
        }}
        anexos={anexos.get(conta.id) ?? []}
        abaInicial={dialogo.aba}
        onFechar={() => setDialogo(null)}
        onMudou={recarregar}
      />
    );

  return (
    <CorrigirDadosDialog
      fatura={dialogo.fatura}
      unidade={dialogo.unidade}
      onFechar={() => setDialogo(null)}
      onCorrigida={() => {
        recarregar();
        setDialogo(null);
      }}
    />
  );
}

const textoDe = (v: number | string | null) =>
  v === null || v === undefined ? "" : String(v).replace(".", ",");

/** Consumo, bandeira/taxas, iluminação pública e nota fiscal. Valor e vencimento são da conta. */
function CorrigirDadosDialog({
  fatura,
  unidade,
  onFechar,
  onCorrigida,
}: {
  fatura: FaturaDeConsumo;
  unidade: UnidadeDeConsumo | null;
  onFechar: () => void;
  onCorrigida: () => void;
}) {
  const corrigir = useCorrigirDadosDaFatura();
  const tipo = dadosDoTipo(String(unidade?.tipo ?? "outro"));
  const energia = unidade?.tipo === "energia";
  const [consumo, setConsumo] = useState(textoDe(fatura.consumo));
  const [bandeira, setBandeira] = useState(textoDe(fatura.bandeira_taxas));
  const [iluminacao, setIluminacao] = useState(textoDe(fatura.iluminacao_publica));
  const [nf, setNf] = useState(fatura.numero_nf ?? "");
  const numeros = [consumo, bandeira, iluminacao].map(numeroDoCampo);
  const problema = numeros.some((n) => n !== null && (Number.isNaN(n) || n < 0))
    ? "Só número, sem negativo."
    : null;

  const gravar = useMutation({
    mutationFn: () =>
      corrigir(fatura.conta_pagar_id, {
        consumo: numeros[0],
        bandeiraTaxas: numeros[1],
        iluminacaoPublica: numeros[2],
        numeroNf: nf.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Dados da fatura corrigidos");
      onCorrigida();
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !gravar.isPending && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dados da fatura de {rotuloDaCompetencia(fatura.competencia)}</DialogTitle>
          <DialogDescription>
            Consumo, taxas e nota fiscal. Valor e vencimento se corrigem na conta a pagar.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {tipo.medida && (
            <div className="space-y-1.5">
              <Label htmlFor="corrigir-consumo">Consumo ({tipo.medida})</Label>
              <Input
                id="corrigir-consumo"
                inputMode="decimal"
                value={consumo}
                onChange={(e) => setConsumo(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="corrigir-bandeira">
              {energia ? "Bandeira e taxas (R$)" : "Taxas (R$)"}
            </Label>
            <Input
              id="corrigir-bandeira"
              inputMode="decimal"
              value={bandeira}
              onChange={(e) => setBandeira(e.target.value)}
            />
          </div>
          {energia && (
            <div className="space-y-1.5">
              <Label htmlFor="corrigir-cip">Contribuição de iluminação pública (R$)</Label>
              <Input
                id="corrigir-cip"
                inputMode="decimal"
                value={iluminacao}
                onChange={(e) => setIluminacao(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="corrigir-nf">Número da nota fiscal</Label>
            <Input id="corrigir-nf" value={nf} onChange={(e) => setNf(e.target.value)} />
          </div>
        </div>
        {problema && <p className="text-sm text-destructive">{problema}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={gravar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => gravar.mutate()} disabled={!!problema || gravar.isPending}>
            {gravar.isPending ? "Salvando…" : "Salvar dados"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
