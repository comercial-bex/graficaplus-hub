/* eslint-disable @typescript-eslint/no-explicit-any -- prazos_de_entrega ainda não está em types.ts */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Carregando } from "@/components/bex/Carregando";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CHAVE_PRAZOS } from "@/lib/parceiro-api";
import {
  lerTaxaDigitada,
  normalizarPrazos,
  PRAZO_NORMAL,
  rotuloDaPorcentagem,
  type PrazoDeEntrega,
} from "@/domain/parceiros/prazo";

const CHAVE = ["configuracoes", "prazos-de-entrega"] as const;

/**
 * A taxa de cada prazo de produção (o expresso é uma % sobre o valor dos produtos). Vale para os
 * orçamentos novos e para os itens que mudarem: a linha da taxa é recalculada pelo banco quando
 * o item muda, e orçamento já convertido em OS fica como está.
 */
export function TaxaDoPrazo({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const prazos = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("prazos_de_entrega")
        .select("chave, nome, descricao, taxa_percentual, ordem")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return normalizarPrazos((data ?? []) as unknown[]);
    },
  });

  return (
    <Card data-testid="taxa-do-prazo">
      <CardHeader>
        <CardTitle className="text-base">Prazo de produção e taxa de urgência</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {prazos.isLoading && <Carregando linhas={2} />}
        {prazos.error && (
          <p className="text-sm text-destructive">Não foi possível carregar os prazos.</p>
        )}
        {(prazos.data ?? []).map((p) => (
          <LinhaDoPrazo
            key={p.chave}
            prazo={p}
            podeEditar={podeEditar}
            onSalvo={() => {
              qc.invalidateQueries({ queryKey: CHAVE });
              qc.invalidateQueries({ queryKey: CHAVE_PRAZOS });
            }}
          />
        ))}
        <p className="text-xs text-muted-foreground">
          O prazo normal não tem taxa. A taxa do expresso é uma porcentagem do valor dos produtos e
          aparece para o parceiro e para a equipe na hora de escolher o prazo.
        </p>
      </CardContent>
    </Card>
  );
}

function LinhaDoPrazo({
  prazo,
  podeEditar,
  onSalvo,
}: {
  prazo: PrazoDeEntrega;
  podeEditar: boolean;
  onSalvo: () => void;
}) {
  const [texto, setTexto] = useState(String(prazo.taxa_percentual).replace(".", ","));
  const [salvando, setSalvando] = useState(false);
  useEffect(
    () => setTexto(String(prazo.taxa_percentual).replace(".", ",")),
    [prazo.taxa_percentual],
  );

  const valor = lerTaxaDigitada(texto);
  const normal = prazo.chave === PRAZO_NORMAL;
  const mudou = valor !== null && valor !== prazo.taxa_percentual;

  async function salvar() {
    if (valor === null) return;
    setSalvando(true);
    // `.select()` devolve as linhas mudadas: sem permissão o banco não dá erro, só não muda nada.
    const { data, error } = await (supabase as any)
      .from("prazos_de_entrega")
      .update({ taxa_percentual: valor })
      .eq("chave", prazo.chave)
      .select("chave");
    setSalvando(false);
    if (error || !data || data.length === 0) {
      toast.error(
        error?.message ?? "A taxa não foi salva: só administrador e gestor mudam a taxa do prazo.",
      );
      return;
    }
    toast.success(`Taxa do ${prazo.nome.toLowerCase()} agora é ${rotuloDaPorcentagem(valor)}`);
    onSalvo();
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-32 flex-1">
        <span className="text-sm font-medium">{prazo.nome}</span>
        {prazo.descricao && <p className="text-xs text-muted-foreground">{prazo.descricao}</p>}
      </div>
      <div className="w-36 space-y-1">
        <Label htmlFor={`taxa-${prazo.chave}`} className="text-xs">
          Taxa (% dos produtos)
        </Label>
        <Input
          id={`taxa-${prazo.chave}`}
          inputMode="decimal"
          value={texto}
          disabled={!podeEditar || normal || salvando}
          aria-invalid={texto !== "" && valor === null}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>
      {!normal && (
        <Button
          type="button"
          size="sm"
          disabled={!podeEditar || !mudou || salvando}
          onClick={salvar}
        >
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </Button>
      )}
    </div>
  );
}
