/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusChip } from "@/components/bex/StatusChip";

export type MaterialParaContar = {
  id: string;
  nome: string;
  unidade: string;
  estoque: number;
};

/**
 * A folha de contagem.
 *
 * O inventário existia e funcionava — um material por vez, num diálogo:
 * escolher no dropdown, digitar a quantidade, digitar o motivo, salvar,
 * fechar, repetir. Com 18 materiais isso são 18 diálogos, e o resultado
 * medido em 25/09/2026 foi que **14 deles nunca receberam carga nenhuma**.
 *
 * Não era falta de vontade: era o formato. Quem conta estoque anda pela
 * oficina com uma prancheta e vai anotando tudo de uma vez — o sistema pedia
 * o contrário.
 *
 * Isso não é detalhe de conforto. Com o estoque zerado a OS não reserva
 * material, a baixa não acontece e o custo real não fecha: o primeiro item
 * crítico do painel de pendências explica quase todos os outros.
 */
export function FolhaDeContagem({ materiais }: { materiais: MaterialParaContar[] }) {
  const qc = useQueryClient();
  const [aberta, setAberta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);

  const num = (v: string) => {
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };

  /**
   * Linha em branco NÃO é zero.
   *
   * É a diferença entre "contei e não tinha nada" e "não cheguei a contar
   * este". Tratar as duas como zero zeraria o estoque de tudo que o operador
   * não alcançou na volta — o mesmo zero disfarçado que já mordeu na jornada
   * zerada do custo da hora.
   */
  const preenchidas = useMemo(
    () =>
      materiais
        .map((m) => ({ material: m, valor: contagem[m.id] ?? "" }))
        .filter((l) => l.valor.trim() !== ""),
    [materiais, contagem],
  );

  const invalidas = preenchidas.filter((l) => !(num(l.valor) >= 0));
  const mudam = preenchidas.filter(
    (l) => num(l.valor) >= 0 && num(l.valor) !== Number(l.material.estoque ?? 0),
  );

  async function aplicar() {
    if (preenchidas.length === 0) {
      return toast.error("Nenhuma linha preenchida", {
        description: "Digite a quantidade contada ao menos num material.",
      });
    }
    if (invalidas.length > 0) {
      return toast.error(`${invalidas.length} linha(s) com número inválido`, {
        description: invalidas.map((l) => l.material.nome).join(", "),
      });
    }
    if (motivo.trim().length < 3) {
      return toast.error("Descreva o motivo da contagem", {
        description: 'Por exemplo: "contagem de abertura, 25/09".',
      });
    }

    setSalvando(true);
    setProgresso({ feitos: 0, total: preenchidas.length });
    const erros: string[] = [];
    let ajustados = 0;

    // Uma chamada por material, em série. `ajustar_estoque_material` trava a
    // linha (FOR UPDATE) e mexe em lote: mandar tudo em paralelo disputaria a
    // mesma trava sem ganhar tempo, e embaralharia qual falhou.
    for (let i = 0; i < preenchidas.length; i++) {
      const { material, valor } = preenchidas[i];
      const { data, error } = await (supabase.rpc as any)("ajustar_estoque_material", {
        p_material_id: material.id,
        p_quantidade_contada: num(valor),
        p_motivo: motivo.trim(),
      });
      if (error) erros.push(`${material.nome}: ${mensagemErro(error)}`);
      else if (Number((data as any)?.diferenca ?? 0) !== 0) ajustados++;
      setProgresso({ feitos: i + 1, total: preenchidas.length });
    }

    setSalvando(false);
    setProgresso(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["movimentacoes-estoque"] }),
      qc.invalidateQueries({ queryKey: ["materiais-para-movimentacao"] }),
      qc.invalidateQueries({ queryKey: ["materiais"] }),
    ]);

    if (erros.length > 0) {
      // Parcial é o pior lugar para silêncio: o que entrou, entrou. Dizer
      // exatamente o que ficou de fora é o que permite terminar a contagem.
      toast.error(`${erros.length} de ${preenchidas.length} não entraram`, {
        description: erros.slice(0, 4).join(" · "),
        duration: 12000,
      });
      return;
    }

    toast.success(
      ajustados === 0
        ? "Contagem confere com o sistema — nada mudou"
        : `Contagem aplicada: ${ajustados} material(is) ajustado(s)`,
      { description: "O saldo agora é a soma dos lotes, e a OS já consegue reservar." },
    );
    setAberta(false);
    setContagem({});
    setMotivo("");
  }

  const semSaldo = materiais.filter((m) => Number(m.estoque ?? 0) === 0).length;

  return (
    <Dialog open={aberta} onOpenChange={(v) => !salvando && setAberta(v)}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 md:h-10">
          <ClipboardList className="mr-2 h-4 w-4" />
          Folha de contagem
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contar o estoque inteiro de uma vez</DialogTitle>
          <DialogDescription>
            Ande pela oficina com esta lista e anote o que encontrar. Cada linha vira um
            ajuste de inventário com o mesmo motivo. O que você deixar em branco não é
            tocado — em branco quer dizer &quot;não contei&quot;, não &quot;é zero&quot;.
          </DialogDescription>
        </DialogHeader>

        {semSaldo > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-3 text-sm">
              <strong>
                {semSaldo} de {materiais.length}
              </strong>{" "}
              {semSaldo === 1 ? "material está" : "materiais estão"} com saldo zero. Enquanto
              estiver assim, a OS não reserva material, a baixa não acontece e o custo real da
              peça não fecha.
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          <Label htmlFor="motivo-contagem">Motivo da contagem *</Label>
          <Input
            id="motivo-contagem"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Contagem de abertura, 25/09"
            disabled={salvando}
          />
        </div>

        <div className="rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_5rem_7rem] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Material</span>
            <span className="text-right">Sistema</span>
            <span className="text-right">Contado</span>
          </div>
          <ul className="divide-y divide-border">
            {materiais.map((m) => {
              const valor = contagem[m.id] ?? "";
              const n = num(valor);
              const difere = valor.trim() !== "" && n >= 0 && n !== Number(m.estoque ?? 0);
              return (
                <li key={m.id} className="grid grid-cols-[1fr_5rem_7rem] items-center gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.nome}</p>
                    <p className="text-xs text-muted-foreground">{m.unidade}</p>
                  </div>
                  <span className="text-right font-mono text-sm text-muted-foreground">
                    {Number(m.estoque ?? 0).toLocaleString("pt-BR")}
                  </span>
                  <Input
                    inputMode="decimal"
                    value={valor}
                    disabled={salvando}
                    aria-label={`Quantidade contada de ${m.nome}`}
                    onChange={(e) => setContagem((c) => ({ ...c, [m.id]: e.target.value }))}
                    className={`h-9 text-right font-mono ${difere ? "border-amber-500" : ""}`}
                  />
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusChip label={`${preenchidas.length} contado(s)`} tone="cyan" />
            {mudam.length > 0 && <StatusChip label={`${mudam.length} muda(m)`} tone="amber" />}
            {progresso && (
              <span className="font-mono">
                {progresso.feitos}/{progresso.total}
              </span>
            )}
          </div>
          <Button onClick={aplicar} disabled={salvando} className="h-11 md:h-10">
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {salvando ? "Aplicando..." : "Aplicar contagem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
